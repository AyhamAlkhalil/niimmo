// Exakte Version (28.10.2026): Ein unversionierter Import zog still jede neue 2.x und brachte so die agent-api zum Absturz
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

// Diese Edge Function wird taeglich per Cron aufgerufen und holt:
// 1. Basiszinssatz der Bundesbank (API, CSV-Format)
// 2. Verbraucherpreisindex (VPI) von Destatis (Open Data CSV)

const BUNDESBANK_API = 'https://api.statistiken.bundesbank.de/rest/data/BBIN1/M.DE.BBK.BBKBAS2.EUR.ME';
const DESTATIS_VPI_CSV = 'https://www.destatis.de/static/de_/opendata/data/verbraucherpreisindex_gesamtindex_bv41.csv';

Deno.serve(async (req) => {
  // Auth: Bearer Token erforderlich (Anon-Key reicht, da intern service_role genutzt wird)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Supabase-Client mit service_role (aus Edge Function Env, nicht aus Request)
  // Damit kann die Function in marktdaten schreiben (RLS: nur service_role)
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
