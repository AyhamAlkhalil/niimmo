import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import nodemailer from "npm:nodemailer@6.9.10";

/**
 * Verschickt die Kündigungsbestätigung an die Mieter eines Vertrags.
 *
 * Seit 16.09.2026. Das PDF entsteht im Browser (kuendigungPdfGenerator.ts) und
 * liegt unter kuendigungen/<vertragId>/. Empfänger, Vertragsende und Objekt
 * kommen aus der Datenbank, nicht aus dem Request (docs/architektur.md §7).
 */

// Muss mit src/config/company.ts übereinstimmen — Deno kann die Datei nicht importieren.
const COMPANY = {
  name: "NiImmo Wohnungsbaugesellschaft mbH",
  strasse: "Egestorffstraße 11",
  plzOrt: "31319 Sehnde",
  telefon: "05138 - 600 72 72",
  email: "info@niimmo.de",
};

const ALLOWED_ORIGINS = [
  'https://immobilien-blick-dashboard.lovable.app',
  'https://id-preview--8e9e2f9b-7950-413f-adfd-90b0d2663ae1.lovable.app',
  'https://dashboard.niimmo.de',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

interface Anfrage {
  mietvertragId?: string;
  pdfPath?: string;
  empfaenger?: string[];
  /** Im Dialog gewählte Briefanrede, z. B. „Sehr geehrte Frau Beispiel," */
  briefanrede?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function datumDeutsch(iso: string): string {
  const [jahr, monat, tag] = iso.slice(0, 10).split('-');
  return `${tag}.${monat}.${jahr}`;
}

// Muss mit mietobjekt() in src/utils/kuendigungsbestaetigung.ts übereinstimmen.
// vertragsart steht live fast überall auf dem Vorgabewert 'wohnraum' —
// maßgeblich ist der Einheitentyp.
const NACH_EINHEITENTYP: Record<string, string> = {
  'Wohnung': 'die Wohnung',
  'Haus (Doppelhaushälfte, Reihenhaus)': 'das Haus',
  'Gewerbe': 'die Gewerbeeinheit',
  'Büro': 'die Gewerbeeinheit',
  'Lager': 'die Lagerfläche',
  'Stellplatz': 'den Stellplatz',
  'Garage': 'die Garage',
  'Sonstiges': 'das Mietobjekt',
};

function mietobjekt(vertragsart: string | null, einheitentyp: string | null | undefined): string {
  if (vertragsart === 'gewerbe') return 'die Gewerbeeinheit';
  if (vertragsart === 'stellplatz') return 'den Stellplatz';
  if (vertragsart === 'sonstiges') return 'das Mietobjekt';
  return (einheitentyp && NACH_EINHEITENTYP[einheitentyp]) || 'die Wohnung';
}

/**
 * Nimmt das erste vollständig konfigurierte Postfach. Die übrigen Functions
 * mischen die Fallbacks je Variable — fehlt dort etwa UEBERGABE_SMTP_PASS,
 * meldet sich der Übergabe-Benutzer mit dem Mahnungs-Passwort an. Hier wird
 * immer ein ganzer Satz gewählt.
 *
 * Reihenfolge: eigenes Postfach, falls eingerichtet; sonst das der Übergabe,
 * weil die Bestätigung zum Auszug gehört und nicht zum Mahnwesen.
 */
function smtpPostfach() {
  for (const praefix of ['KUENDIGUNG', 'UEBERGABE', 'MAHNUNG']) {
    const host = Deno.env.get(`${praefix}_SMTP_HOST`);
    const user = Deno.env.get(`${praefix}_SMTP_USER`);
    const pass = Deno.env.get(`${praefix}_SMTP_PASS`);
    if (!host || !user || !pass) continue;
    return {
      praefix,
      host,
      port: parseInt(Deno.env.get(`${praefix}_SMTP_PORT`) || '587'),
      user,
      pass,
      fromEmail: Deno.env.get(`${praefix}_SMTP_FROM_EMAIL`) || user,
      fromName: Deno.env.get(`${praefix}_SMTP_FROM_NAME`) || COMPANY.name,
    };
  }
  return null;
}

function mailHtml(p: { anrede: string; objekt: string; lage: string; ende: string }): string {
  const logoUrl = 'https://dashboard.niimmo.de/nilimmo-logo.png';
  const lage = escapeHtml(p.lage);
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background-color:#3a3a3a;padding:24px 32px;text-align:center;">
    <img src="${logoUrl}" alt="NiImmo" height="40" style="margin-bottom:12px;display:inline-block;" />
    <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">Bestätigung Ihrer Kündigung</h1>
  </td></tr>
  <tr><td style="padding:32px;font-size:15px;line-height:1.6;">
    <p style="margin:0 0 16px;">${escapeHtml(p.anrede)}</p>
    <p style="margin:0 0 16px;">anbei erhalten Sie unsere schriftliche Bestätigung Ihrer Kündigung. Das Mietverhältnis über ${p.objekt}${lage ? ` ${lage}` : ''} endet zum <strong>${p.ende}</strong>.</p>
    <p style="margin:0 0 16px;">Das Bestätigungsschreiben mit allen Hinweisen zur Rückgabe ist dieser E-Mail als PDF beigefügt. Für die Übergabe vereinbaren wir rechtzeitig vorher einen Termin mit Ihnen.</p>
    <p style="margin:24px 0 0;">Mit freundlichen Grüßen<br><strong>${COMPANY.name}</strong></p>
  </td></tr>
  <tr><td style="background-color:#f8f9fa;padding:16px 32px;border-top:1px solid #eee;text-align:center;">
    <p style="margin:0;font-size:12px;color:#999;">${COMPANY.name} • ${COMPANY.strasse} • ${COMPANY.plzOrt}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#999;">Tel. ${COMPANY.telefon} • ${COMPANY.email}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  // Post an Mieter ist Verwaltungsarbeit — wie Mahnung und Abrechnung nur für Admins.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: istAdmin, error: rolleError } = await supabase.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return json({ error: 'Nur Administratoren dürfen Kündigungsbestätigungen versenden.' }, 403, corsHeaders);
  }

  try {
    const anfrage: Anfrage = await req.json();
    const mietvertragId = (anfrage.mietvertragId ?? '').trim();
    const pdfPath = (anfrage.pdfPath ?? '').trim();

    if (!UUID.test(mietvertragId)) {
      return json({ error: 'mietvertragId fehlt oder ist ungültig.' }, 400, corsHeaders);
    }
    // Nur die Bestätigung dieses Vertrags darf angehängt werden.
    if (!pdfPath.startsWith(`kuendigungen/${mietvertragId}/`) || pdfPath.includes('..') || !pdfPath.endsWith('.pdf')) {
      return json({ error: 'Der Anhang gehört nicht zu diesem Mietvertrag.' }, 403, corsHeaders);
    }

    const { data: vertrag, error: vertragError } = await supabase
      .from('mietvertrag')
      .select('id, ende_datum, kuendigungsdatum, vertragsart, einheiten ( bezeichnung, einheitentyp, immobilien ( name, adresse ) )')
      .eq('id', mietvertragId)
      .maybeSingle();
    if (vertragError) {
      console.error('Vertrag nicht lesbar:', { mietvertragId });
      return json({ error: 'Der Mietvertrag konnte nicht geladen werden.' }, 500, corsHeaders);
    }
    if (!vertrag) {
      return json({ error: 'Mietvertrag nicht gefunden.' }, 404, corsHeaders);
    }

    // Wie getVertragsende() im Frontend: ende_datum führt.
    const vertragsende = vertrag.ende_datum || vertrag.kuendigungsdatum;
    if (!vertragsende) {
      return json({ error: 'Am Vertrag ist kein Vertragsende eingetragen. Es wurde nichts versendet.' }, 409, corsHeaders);
    }

    const { data: vertragsMieter, error: mieterError } = await supabase
      .from('mietvertrag_mieter')
      .select('mieter ( hauptmail, weitere_mails )')
      .eq('mietvertrag_id', mietvertragId);
    if (mieterError) {
      console.error('Mieter des Vertrags nicht lesbar:', { mietvertragId });
      return json({ error: 'Empfänger konnten nicht geprüft werden.' }, 500, corsHeaders);
    }

    const erlaubt = new Set<string>();
    for (const zeile of vertragsMieter ?? []) {
      const m = (zeile as Record<string, { hauptmail?: string | null; weitere_mails?: string | null }>).mieter;
      if (m?.hauptmail?.includes('@')) erlaubt.add(m.hauptmail.trim().toLowerCase());
      for (const weitere of (m?.weitere_mails ?? '').split(/[,;\s]+/)) {
        if (weitere.includes('@')) erlaubt.add(weitere.trim().toLowerCase());
      }
    }

    const empfaenger = [...new Set((anfrage.empfaenger ?? []).map(a => String(a).trim().toLowerCase()).filter(Boolean))];
    if (empfaenger.length === 0) {
      return json({ error: 'Keine Empfängeradresse ausgewählt.' }, 400, corsHeaders);
    }
    if (empfaenger.some(a => !erlaubt.has(a))) {
      return json({ error: 'Mindestens eine Adresse ist an diesem Mietvertrag nicht hinterlegt. Bitte zuerst in den Mieterdaten eintragen.' }, 403, corsHeaders);
    }

    const postfach = smtpPostfach();
    if (!postfach) {
      console.error('Kein vollständiges SMTP-Postfach konfiguriert.');
      return json({ error: 'Der Mailversand ist nicht eingerichtet. Es wurde nichts versendet.' }, 500, corsHeaders);
    }

    const { data: datei, error: dateiError } = await supabase.storage.from('dokumente').download(pdfPath);
    if (dateiError || !datei) {
      console.error('Bestätigung nicht ladbar:', { mietvertragId });
      return json({ error: 'Das Bestätigungsschreiben konnte nicht geladen werden. Es wurde nichts versendet.' }, 502, corsHeaders);
    }
    const pdf = Buffer.from(await datei.arrayBuffer());

    const einheit = (vertrag as { einheiten?: { bezeichnung?: string | null; einheitentyp?: string | null; immobilien?: { name?: string | null; adresse?: string | null } | null } | null }).einheiten;
    const lage = [einheit?.bezeichnung, einheit?.immobilien?.adresse]
      .map(t => (t ?? '').trim())
      .filter(Boolean)
      .join(', ');

    // Die Anrede ist die einzige Textstelle vom Client — einzeilig, begrenzt, im HTML maskiert.
    const anredeRoh = typeof anfrage.briefanrede === 'string'
      ? anfrage.briefanrede.replace(/[\r\n\t]+/g, ' ').trim()
      : '';
    const anrede = anredeRoh.length > 0 && anredeRoh.length <= 200 && anredeRoh.endsWith(',')
      ? anredeRoh
      : 'Sehr geehrte Damen und Herren,';

    const ende = datumDeutsch(vertragsende);
    const objekt = mietobjekt(vertrag.vertragsart, einheit?.einheitentyp);

    const transporter = nodemailer.createTransport({
      host: postfach.host,
      port: postfach.port,
      secure: postfach.port === 465,
      auth: { user: postfach.user, pass: postfach.pass },
    });

    await transporter.sendMail({
      from: `"${postfach.fromName}" <${postfach.fromEmail}>`,
      to: empfaenger.join(', '),
      subject: `Bestätigung Ihrer Kündigung${lage ? ` – ${lage}` : ''}`,
      text:
        `${anrede}\n\n` +
        `anbei erhalten Sie unsere schriftliche Bestätigung Ihrer Kündigung. ` +
        `Das Mietverhältnis über ${objekt}${lage ? ` ${lage}` : ''} endet zum ${ende}.\n\n` +
        `Das Bestätigungsschreiben mit allen Hinweisen zur Rückgabe ist dieser E-Mail als PDF beigefügt. ` +
        `Für die Übergabe vereinbaren wir rechtzeitig vorher einen Termin mit Ihnen.\n\n` +
        `Mit freundlichen Grüßen\n${COMPANY.name}\n\n` +
        `${COMPANY.strasse}, ${COMPANY.plzOrt} · Tel. ${COMPANY.telefon} · ${COMPANY.email}\n`,
      html: mailHtml({ anrede, objekt, lage, ende }),
      attachments: [{
        filename: `Kuendigungsbestaetigung_${ende.replace(/\./g, '-')}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
    });
    transporter.close();

    // Keine Namen oder Adressen ins Protokoll — nur IDs und Anzahl.
    console.log('Kündigungsbestätigung versendet:', { mietvertragId, empfaenger: empfaenger.length, postfach: postfach.praefix });
    await supabase.from('system_logs').insert({
      message: `Kündigungsbestätigung per E-Mail an ${empfaenger.length} Empfänger versendet (Mietvertrag ${mietvertragId}).`,
    });

    return json({ success: true, empfaenger: empfaenger.length }, 200, corsHeaders);
  } catch (error: unknown) {
    // SMTP-Fehlertexte enthalten oft die abgelehnte Adresse oder Serverdetails —
    // nach außen und ins Protokoll geht nur der Code.
    const e = (error ?? {}) as { code?: string; responseCode?: number };
    console.error('[send-kuendigungsbestaetigung] Versand fehlgeschlagen', { code: e.code, responseCode: e.responseCode });
    const code = [e.code, e.responseCode].filter(Boolean).join(' ');
    return json({ error: `Der Versand ist fehlgeschlagen${code ? ` (${code})` : ''}. Es wurde nichts versendet.` }, 500, corsHeaders);
  }
});
