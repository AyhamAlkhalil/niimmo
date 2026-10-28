// Exakte Version (28.10.2026): Ein unversionierter Import zog still jede neue 2.x und brachte so die agent-api zum Absturz
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

// Diese Edge Function ruft pg_cron monatlich auf (Job niimmo-fetch-marktdaten, am 1. um 04:00 UTC) und holt:
// 1. Basiszinssatz der Bundesbank (API, CSV-Format)
// 2. Verbraucherpreisindex (VPI) von Destatis (Open Data CSV)

const BUNDESBANK_API = 'https://api.statistiken.bundesbank.de/rest/data/BBIN1/M.DE.BBK.BBKBAS2.EUR.ME';
const DESTATIS_VPI_CSV = 'https://www.destatis.de/static/de_/opendata/data/verbraucherpreisindex_gesamtindex_bv41.csv';

// Mindestlänge des Cron-Schlüssels: Ein kurzer oder leerer Wert in CRON_SECRET darf nie als
// gültige Freigabe gelten (eingerichtet wird ein Zufallswert aus 32 Byte, 64 Hex-Zeichen).
const CRON_SCHLUESSEL_MIN_LAENGE = 32;

function antwort(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Vergleich in konstanter Zeit: beide Werte erst hashen, dann jedes Byte vergleichen. */
async function gleicherSchluessel(gesendet: string, erwartet: string): Promise<boolean> {
  const kodierer = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', kodierer.encode(gesendet)),
    crypto.subtle.digest('SHA-256', kodierer.encode(erwartet)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let unterschied = 0;
  for (let i = 0; i < x.length; i++) unterschied |= x[i] ^ y[i];
  return unterschied === 0;
}

/**
 * Freigabe: der Cron-Job mit Header x-cron-key (= Edge-Secret CRON_SECRET, den Wert liest pg_cron
 * aus Supabase Vault, Name cron_secret) oder ein angemeldeter Admin.
 *
 * Bis zum 28.10.2026 genügte ein beliebiger Text nach „Bearer “: Jeder mit dem öffentlichen
 * anon-Key konnte die Function auslösen, die mit Service-Role in marktdaten schreibt. Der Cron-Job
 * (jobid 7) schickte ein festes Token, das zu keinem Secret passte.
 */
async function freigabe(req: Request): Promise<Response | null> {
  const cronSchluessel = req.headers.get('x-cron-key');
  const erwartet = Deno.env.get('CRON_SECRET') ?? '';
  if (cronSchluessel && erwartet.length >= CRON_SCHLUESSEL_MIN_LAENGE && await gleicherSchluessel(cronSchluessel, erwartet)) {
    return null;
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return antwort({ error: 'Unauthorized' }, 401);
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return antwort({ error: 'Unauthorized' }, 401);
  }
  // Wie process-payments und classify-nebenkosten: Rolle über is_admin, sonst 403
  const rollenClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return antwort({ error: 'Forbidden' }, 403);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return antwort({ error: 'Method not allowed' }, 405);
  }
  const abgelehnt = await freigabe(req);
  if (abgelehnt) return abgelehnt;

  // Supabase-Client mit service_role (aus Edge Function Env, nicht aus Request), erst nach der
  // Freigabe erzeugt. Damit kann die Function in marktdaten schreiben (RLS: nur service_role)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const results: { basiszinssatz?: string; vpi?: string; errors: string[] } = { errors: [] };

  // ============================================================
  // 1. Basiszinssatz von der Bundesbank API
  // ============================================================
  try {
    const bbRes = await fetch(`${BUNDESBANK_API}?format=csv&lang=en&lastNObservations=6`, {
      headers: { 'Accept': 'text/csv' }
    });

    if (!bbRes.ok) {
      throw new Error(`Bundesbank API returned ${bbRes.status}`);
    }

    const csvText = await bbRes.text();
    const lines = csvText.split('\n').filter(l => l.trim() && !l.startsWith('"'));

    // Finde die letzte Zeile mit einem gueltigen Wert
    let latestDate = '';
    let latestValue = 0;

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const period = parts[0].trim(); // z.B. "2026-03"
        const value = parseFloat(parts[1].trim());
        if (period.match(/^\d{4}-\d{2}$/) && !isNaN(value)) {
          latestDate = period;
          latestValue = value;
        }
      }
    }

    if (latestDate && !isNaN(latestValue)) {
      // Stichtag: Erster des Monats
      const stichtag = `${latestDate}-01`;

      const { error } = await supabase.from('marktdaten').upsert({
        typ: 'basiszinssatz',
        wert: latestValue,
        stichtag,
        quelle: 'Bundesbank API (BBIN1.M.DE.BBK.BBKBAS2.EUR.ME)',
        abgerufen_am: new Date().toISOString(),
      }, {
        onConflict: 'typ,stichtag'
      });

      if (error) {
        results.errors.push(`Basiszinssatz DB-Fehler: ${error.message}`);
      } else {
        results.basiszinssatz = `${latestValue}% (Stichtag: ${stichtag})`;
      }
    } else {
      results.errors.push('Basiszinssatz: Kein gueltiger Wert im CSV gefunden');
    }
  } catch (e) {
    results.errors.push(`Basiszinssatz Fehler: ${(e as Error).message}`);
  }

  // ============================================================
  // 2. Verbraucherpreisindex (VPI) von Destatis
  // ============================================================
  try {
    const vpiRes = await fetch(DESTATIS_VPI_CSV);

    if (!vpiRes.ok) {
      throw new Error(`Destatis CSV returned ${vpiRes.status}`);
    }

    const csvText = await vpiRes.text();
    const lines = csvText.split('\n').filter(l => l.trim());

    // CSV-Struktur (Semikolon-getrennt, Komma-Dezimal):
    // Datum; Originalwert 2020=100; Veränderung gg. Vorjahr %; ...
    // 01/02/2026; 123,1; 1,9; ...
    let latestDate = '';
    let latestValue = 0;

    for (const line of lines) {
      const parts = line.split(';').map(p => p.trim());
      if (parts.length >= 2) {
        const dateStr = parts[0]; // DD/MM/YYYY
        const dateMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dateMatch) {
          const valueStr = parts[1].replace(',', '.');
          const value = parseFloat(valueStr);
          if (!isNaN(value) && value > 0) {
            latestDate = dateStr;
            latestValue = value;
          }
        }
      }
    }

    if (latestDate && latestValue > 0) {
      // DD/MM/YYYY -> YYYY-MM-DD
      const dateMatch = latestDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)!;
      const stichtag = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

      const { error } = await supabase.from('marktdaten').upsert({
        typ: 'vpi',
        wert: latestValue,
        stichtag,
        quelle: 'Destatis Open Data (VPI Gesamtindex, 2020=100)',
        abgerufen_am: new Date().toISOString(),
      }, {
        onConflict: 'typ,stichtag'
      });

      if (error) {
        results.errors.push(`VPI DB-Fehler: ${error.message}`);
      } else {
        results.vpi = `${latestValue} (Stichtag: ${stichtag}, Basis 2020=100)`;
      }
    } else {
      results.errors.push('VPI: Kein gueltiger Wert im CSV gefunden');
    }
  } catch (e) {
    results.errors.push(`VPI Fehler: ${(e as Error).message}`);
  }

  // ============================================================
  // Ergebnis
  // ============================================================
  const success = results.errors.length === 0;

  return new Response(JSON.stringify({
    success,
    timestamp: new Date().toISOString(),
    ...results,
  }), {
    status: success ? 200 : 207, // 207 Multi-Status wenn teilweise fehlgeschlagen
    headers: { 'Content-Type': 'application/json' },
  });
});
