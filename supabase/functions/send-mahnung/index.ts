import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import nodemailer from "npm:nodemailer@6.9.10";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PDF_DATEINAME = /^[A-Za-z0-9_.-]+\.pdf$/;
// Eine Adresse ohne Leerraum, Komma, Semikolon, spitze Klammern oder Anfuehrungszeichen
const MAILADRESSE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;
const MAX_KOPIEN = 5;

/** Nur ein PDF direkt im Mahnungsordner dieses Vertrags (mietvertragId ist vorher als UUID geprueft). */
function mahnungsPdfErlaubt(pfad: string, mietvertragId: string): boolean {
  const praefix = `mahnungen/${mietvertragId}/`;
  if (!pfad.startsWith(praefix)) return false;
  const dateiname = pfad.slice(praefix.length);
  return PDF_DATEINAME.test(dateiname) && !dateiname.includes('..');
}

interface MahnungEmailRequest {
  recipientEmail: string;
  recipientName: string;
  ccEmails?: string[];
  mahnstufe: number;
  gesamtbetrag: number;
  rueckstandBetrag: number;
  mahngebuehren: number;
  verzugszinsen: number;
  zusaetzlicheKosten: number;
  zahlungsfristTage: number;
  immobilieName: string;
  immobilieAdresse: string;
  pdfPath: string;
  mietvertragId: string;
  forderungen?: Array<{ sollmonat: string; sollbetrag: number }>;
}

/**
 * Kalendertag in deutscher Zeit, um versatzTage verschoben, als TT.MM.JJJJ. Die Function laeuft
 * in UTC: Zwischen 0 und 2 Uhr nannte die Mail bis zum 27.10.2026 Datum und Frist einen Tag
 * frueher als das Schreiben, das im Browser entsteht.
 */
function berlinerTag(versatzTage: number): string {
  const [tag, monat, jahr] = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date())
    .split('.')
    .map(Number);
  // UTC-Mittag: Addieren von Tagen ueber eine Zeitumstellung hinweg bleibt auf dem Kalendertag
  const ziel = new Date(Date.UTC(jahr, monat - 1, tag + versatzTage, 12));
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(ziel);
}

function generateMahnungHtml(data: MahnungEmailRequest): string {
  // Bei leerem Fristfeld kam null an -- die Mail nannte dann den heutigen Tag als Frist,
  // das PDF heute + 7 (27.10.2026). Gleiche Vorgabe wie im PDF.
  const fristTage = Number.isFinite(Number(data.zahlungsfristTage)) && Number(data.zahlungsfristTage) > 0
    ? Number(data.zahlungsfristTage)
    : 7;
  const fristFormatted = berlinerTag(fristTage);
  const heute = berlinerTag(0);

  let eskalationsText = '';
  let headerColor = '#E67E22';
  switch (data.mahnstufe) {
    case 1:
      eskalationsText = 'Wir bitten Sie höflich, den ausstehenden Betrag bis zum genannten Datum zu begleichen. Sollte die Zahlung bereits unterwegs sein, betrachten Sie dieses Schreiben als gegenstandslos.';
      headerColor = '#E67E22';
      break;
    case 2:
      eskalationsText = 'Trotz unserer ersten Mahnung haben wir bislang keinen Zahlungseingang feststellen können. Wir fordern Sie daher nachdrücklich auf, den offenen Betrag umgehend zu begleichen. Sollten Sie nicht innerhalb der genannten Frist zahlen, behalten wir uns die Einleitung weiterer Maßnahmen vor.';
      headerColor = '#E74C3C';
      break;
    case 3:
    default:
      // Das beigefügte Schreiben spricht die fristlose Kündigung aus, und der Vertrag steht danach auf
      // „gekündigt“. Bis zum 27.10.2026 kündigte die Mail sie nur an („werden … kündigen“).
      eskalationsText = '<strong>Mit dem beigefügten Schreiben kündigen wir das Mietverhältnis fristlos.</strong> Bitte gleichen Sie den Gesamtbetrag dennoch innerhalb der genannten Frist aus und beachten Sie die im Schreiben genannte Räumungsfrist. Die entstehenden Kosten gehen zu Ihren Lasten.';
      headerColor = '#C0392B';
      break;
  }

  let forderungenRows = '';
  if (data.forderungen && data.forderungen.length > 0) {
    forderungenRows = data.forderungen.map(f => {
      const monat = new Date(f.sollmonat).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${monat}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${f.sollbetrag.toFixed(2)} €</td></tr>`;
    }).join('');
  }

  const logoUrl = 'https://dashboard.niimmo.de/nilimmo-logo.png';

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background-color:${headerColor};padding:24px 32px;text-align:center;">
  <img src="${logoUrl}" alt="NilImmo" height="40" style="margin-bottom:12px;display:inline-block;" />
  <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">${data.mahnstufe}. Mahnung — Mietrückstand</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;">Datum: ${heute}</p>
  <p style="margin:0 0 8px;font-size:15px;">Sehr geehrte/r <strong>${data.recipientName}</strong>,</p>
  <p style="margin:0 0 20px;font-size:15px;">bezüglich Ihres Mietvertrags für das Objekt <strong>${data.immobilieName}</strong>, ${data.immobilieAdresse}, besteht folgender Zahlungsrückstand:</p>
  ${forderungenRows ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #ddd;border-radius:4px;overflow:hidden;">
    <tr style="background-color:#f8f8f8;">
      <th style="padding:10px 12px;text-align:left;font-size:14px;border-bottom:2px solid #ddd;">Monat</th>
      <th style="padding:10px 12px;text-align:right;font-size:14px;border-bottom:2px solid #ddd;">Betrag</th>
    </tr>
    ${forderungenRows}
  </table>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background-color:#fdf2f0;border-radius:6px;padding:4px;">
    <tr><td style="padding:8px 16px;font-size:14px;">Mietrückstand</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.rueckstandBetrag.toFixed(2)} €</td></tr>
    <tr><td style="padding:8px 16px;font-size:14px;">Mahngebühren</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.mahngebuehren.toFixed(2)} €</td></tr>
    ${data.verzugszinsen > 0 ? `<tr><td style="padding:8px 16px;font-size:14px;">Verzugszinsen</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.verzugszinsen.toFixed(2)} €</td></tr>` : ''}
    ${data.zusaetzlicheKosten > 0 ? `<tr><td style="padding:8px 16px;font-size:14px;">Zusätzliche Kosten</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.zusaetzlicheKosten.toFixed(2)} €</td></tr>` : ''}
    <tr style="border-top:2px solid ${headerColor};">
      <td style="padding:12px 16px;font-size:16px;font-weight:700;color:${headerColor};">Gesamtbetrag</td>
      <td style="padding:12px 16px;text-align:right;font-size:18px;font-weight:700;color:${headerColor};">${data.gesamtbetrag.toFixed(2)} €</td>
    </tr>
  </table>
  <div style="background-color:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin-bottom:20px;border-radius:0 4px 4px 0;">
    <p style="margin:0;font-size:14px;font-weight:600;">Bitte überweisen Sie den Gesamtbetrag von ${data.gesamtbetrag.toFixed(2)} € bis spätestens zum <strong>${fristFormatted}</strong>.</p>
  </div>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6;">${eskalationsText}</p>
  <p style="margin:0 0 8px;font-size:14px;">Das Mahnungsschreiben ist dieser E-Mail als PDF beigefügt.</p>
  <p style="margin:0 0 4px;font-size:14px;">Mit freundlichen Grüßen</p>
  <p style="margin:0 0 0;font-size:14px;font-weight:600;">Ihre Hausverwaltung — NilImmo</p>
</td></tr>
<tr><td style="background-color:#f8f8f8;padding:20px 32px;border-top:1px solid #eee;">
  <p style="margin:0 0 4px;font-size:11px;color:#888;text-align:center;">NilImmo Hausverwaltung</p>
  <p style="margin:0 0 4px;font-size:11px;color:#888;text-align:center;">Diese E-Mail wurde automatisch generiert. Bei Fragen wenden Sie sich bitte an Ihre Hausverwaltung.</p>
  <p style="margin:0;font-size:11px;color:#888;text-align:center;">Mahnstufe: ${data.mahnstufe} | Datum: ${heute}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Mail-Protokoll (21.09.2026) ───────────────────────────────────────────────
// Betreff und Text entstanden bisher nur hier und waren nach dem Versand weg.
// Jede Mail wird deshalb vor dem Versand gespeichert und danach auf `gesendet`
// oder `fehler` gesetzt. Scheitert das Protokollieren, wird trotzdem versendet:
// ein fehlendes Protokoll ist ärgerlich, eine nicht versendete Mail schlimmer.
async function mailVormerken(
  client: ReturnType<typeof createClient>,
  eintrag: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await client.from('mails').insert(eintrag).select('id').single();
    if (error) {
      console.error('[mails] Vormerken fehlgeschlagen:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (fehler) {
    console.error('[mails] Vormerken fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
    return null;
  }
}

async function mailAbschliessen(
  client: ReturnType<typeof createClient>,
  id: string | null,
  status: 'gesendet' | 'fehler',
  fehlertext?: string,
): Promise<void> {
  if (!id) return;
  try {
    await client
      .from('mails')
      .update({
        status,
        gesendet_am: status === 'gesendet' ? new Date().toISOString() : null,
        fehler: fehlertext ?? null,
      })
      .eq('id', id);
  } catch (fehler) {
    console.error('[mails] Abschluss fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
  }
}

/** Grobe Klartextfassung des HTML-Briefs, damit das Protokoll lesbar ist. */
function htmlZuText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  // Beides pruefen: Ein fehlender Nutzer ohne Fehlerobjekt kam sonst durch.
  if (authError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Diese Funktion verschickt Post an Mieter und aendert die Mahnstufe --
  // das ist Verwaltungsarbeit und keine Hausmeistertaetigkeit.
  const rollenClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const data: MahnungEmailRequest = await req.json();
    // Keine Mieternamen, Mailadressen oder Betraege ins Protokoll -- nur IDs.
    console.log('Mahnung wird versendet:', { mietvertragId: data.mietvertragId });

    // SMTP config
    const smtpHost = Deno.env.get("MAHNUNG_SMTP_HOST") || Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("MAHNUNG_SMTP_PORT") || Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("MAHNUNG_SMTP_USER") || Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("MAHNUNG_SMTP_PASS") || Deno.env.get("SMTP_PASS");
    const smtpFromEmail = Deno.env.get("MAHNUNG_SMTP_FROM_EMAIL") || Deno.env.get("SMTP_FROM_EMAIL") || "mahnung@niimmo.de";
    const smtpFromName = Deno.env.get("MAHNUNG_SMTP_FROM_NAME") || Deno.env.get("SMTP_FROM_NAME") || "NiImmo Hausverwaltung";

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFromEmail) {
      console.error('SMTP-Konfiguration fuer Mahnungen unvollstaendig (MAHNUNG_SMTP_*)');
      return new Response(JSON.stringify({ success: false, error: 'Der Mailversand für Mahnungen ist nicht eingerichtet. Es wurde nichts versendet.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load PDF from Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Die Vertrags-ID geht in die Pfadpruefung unten ein und muss deshalb eine
    // UUID sein: Mit "x/../.." als ID haette die Praefixpruefung selbst auf
    // fremde Ordner gezeigt.
    if (typeof data.mietvertragId !== 'string' || !UUID.test(data.mietvertragId)) {
      return new Response(JSON.stringify({ error: 'mietvertragId fehlt oder ist ungültig' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Der Storage-Pfad kam ungeprueft aus dem Request und wurde mit
    // Service-Role geladen: Damit liess sich jede Datei des Buckets an eine
    // frei gewaehlte Adresse schicken. Er muss zu diesem Vertrag gehoeren.
    // Seit 17.10.2026 als Erlaubnisliste: Die Storage-URL wird vom URL-Parser
    // normalisiert, und der loest nicht nur "..", sondern auch "%2e%2e" und
    // ".%2E" auf -- "mahnungen/<id>/%2e%2e/%2e%2e/x" landete bei x. Nach dem
    // Praefix darf deshalb nur ein einzelner Dateiname ohne "%" und "/" stehen,
    // so wie ihn utils/storagePfad.ts baut.
    if (data.pdfPath && (typeof data.pdfPath !== 'string' || !mahnungsPdfErlaubt(data.pdfPath, data.mietvertragId))) {
      console.error('Pfad gehoert nicht zum Vertrag');
      return new Response(JSON.stringify({ error: 'Der Anhang gehört nicht zu diesem Mietvertrag.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Ebenso die Empfaengeradresse: Sie muss an einem Mieter dieses Vertrags
    // hinterlegt sein, statt aus dem Request zu stammen.
    const { data: vertragsMieter, error: mieterError } = await supabase
      .from('mietvertrag_mieter')
      .select('mieter(hauptmail, weitere_mails)')
      .eq('mietvertrag_id', data.mietvertragId);

    if (mieterError) {
      console.error('Mieter des Vertrags nicht lesbar');
      return new Response(JSON.stringify({ error: 'Empfänger konnte nicht geprüft werden.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const erlaubteAdressen = new Set<string>();
    for (const zeile of vertragsMieter ?? []) {
      const m = (zeile as Record<string, { hauptmail?: string | null; weitere_mails?: string | null }>).mieter;
      if (m?.hauptmail) erlaubteAdressen.add(m.hauptmail.trim().toLowerCase());
      // Haupt- und weitere Adressen zerlegt wie mailadressenDerMieter() in der App (27.10.2026)
      for (const teil of `${m?.hauptmail ?? ''} ${m?.weitere_mails ?? ''}`.split(/[,;\s<>]+/)) {
        if (teil.includes('@')) erlaubteAdressen.add(teil.trim().toLowerCase());
      }
    }

    const empfaenger = (data.recipientEmail ?? '').trim().toLowerCase();
    if (!erlaubteAdressen.has(empfaenger)) {
      console.error('Empfaenger gehoert nicht zum Vertrag');
      return new Response(
        JSON.stringify({ error: 'Die Empfängeradresse ist an diesem Mietvertrag nicht hinterlegt. Bitte zuerst in den Mieterdaten eintragen.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // CC ist in der App bewusst ein freies Feld (Kopie ans eigene Postfach, an die Kanzlei).
    // Bis zum 27.10.2026 ging sein Inhalt ungeprueft in den Mailkopf; jetzt nur wohlgeformte
    // Adressen, hoechstens fuenf.
    const kopie = Array.isArray(data.ccEmails)
      ? data.ccEmails.map((adresse) => String(adresse ?? '').trim()).filter(Boolean)
      : [];
    if (kopie.length > MAX_KOPIEN || kopie.some((adresse) => !MAILADRESSE.test(adresse))) {
      return new Response(JSON.stringify({ error: `Die CC-Adressen sind ungültig. Erlaubt sind höchstens ${MAX_KOPIEN} vollständige Mailadressen. Es wurde nichts versendet.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Die Stufe in Schreiben und Mail rechnet die App aus dem Stand beim Oeffnen des Dialogs
    // (gespeicherte Stufe + 1). Hatte inzwischen jemand anders gemahnt, gingen Schreiben und
    // Mail mit der alten Stufe raus, waehrend der Vertrag eine Stufe weiter zaehlte; auf Stufe 3
    // kam eine "4. Mahnung" heraus (27.10.2026). Die angefragte Stufe muss zur gespeicherten passen.
    const { data: vertragVorher, error: vorherFehler } = await supabase
      .from('mietvertrag')
      .select('mahnstufe')
      .eq('id', data.mietvertragId)
      .maybeSingle();
    if (vorherFehler || !vertragVorher) {
      console.error('Mahnstufe nicht lesbar:', vorherFehler?.message ?? 'Vertrag nicht gefunden');
      return new Response(JSON.stringify({ error: 'Die Mahnstufe des Vertrags konnte nicht gelesen werden. Es wurde nichts versendet.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const bisherigeStufe = Number(vertragVorher.mahnstufe) || 0;
    if (bisherigeStufe >= 3) {
      return new Response(JSON.stringify({ error: 'Der Vertrag steht bereits auf Mahnstufe 3. Es wurde nichts versendet.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (data.mahnstufe !== bisherigeStufe + 1) {
      return new Response(JSON.stringify({ error: `Der Vertrag steht inzwischen auf Mahnstufe ${bisherigeStufe}. Bitte den Dialog neu öffnen, damit Schreiben und Mail die richtige Stufe nennen. Es wurde nichts versendet.` }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let pdfBuffer: Buffer | null = null;
    // Datum in deutscher Zeit; toISOString() lag zwischen 0 und 2 Uhr auf dem Vortag
    let pdfFilename = `Mahnung_Stufe${data.mahnstufe}_${berlinerTag(0).split('.').reverse().join('-')}.pdf`;
    if (data.pdfPath) {
      console.log('Loading PDF from storage:', data.pdfPath);
      const { data: fileData, error: fileError } = await supabase.storage
        .from('dokumente')
        .download(data.pdfPath);

      if (fileError) {
        // Frueher nur geloggt: Der Mieter bekam dann eine Mahnungs-Mail ohne
        // das Mahnschreiben, die Antwort meldete trotzdem Erfolg, und die
        // Mahnstufe stieg. Ohne Anhang wird nicht versendet.
        console.error('PDF download error:', fileError);
        return new Response(
          JSON.stringify({ error: 'Das Mahnschreiben konnte nicht geladen werden. Es wurde nichts versendet und die Mahnstufe nicht erhöht.' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        console.log('PDF loaded successfully, size:', pdfBuffer.length);
      }
    }

    // Generate HTML email
    const htmlBody = generateMahnungHtml(data);
    const betreff = data.mahnstufe === 3
      ? `${data.mahnstufe}. und letzte Mahnung — Mietrückstand | ${data.immobilieName}`
      : `${data.mahnstufe}. Mahnung — Mietrückstand | ${data.immobilieName}`;

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailOptions: any = {
      from: `${smtpFromName} <${smtpFromEmail}>`,
      to: data.recipientEmail,
      subject: betreff,
      html: htmlBody,
    };

    if (kopie.length > 0) {
      mailOptions.cc = kopie.join(', ');
    }

    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];
    }

    const mailId = await mailVormerken(supabase, {
      typ: 'mahnung',
      status: 'entwurf',
      betreff,
      text: htmlZuText(htmlBody),
      html: htmlBody,
      empfaenger: [data.recipientEmail],
      kopie,
      anhang_pfad: data.pdfPath || null,
      anhang_name: pdfBuffer ? pdfFilename : null,
      mietvertrag_id: data.mietvertragId,
      erstellt_von: userData.user.id,
      nutzlast: { mahnstufe: data.mahnstufe },
    });

    try {
      await transporter.sendMail(mailOptions);
    } catch (versandFehler) {
      await mailAbschliessen(
        supabase,
        mailId,
        'fehler',
        versandFehler instanceof Error ? versandFehler.message : 'Unbekannter Fehler',
      );
      throw versandFehler;
    }
    await mailAbschliessen(supabase, mailId, 'gesendet');

    // Erst nach erfolgreichem Versand: Die neue Mahnstufe kam frueher ungeprueft aus dem
    // Request -- damit konnte jeder Aufrufer jeden Vertrag unmittelbar auf Stufe 3 setzen und
    // die Regel umgehen, dass die Stufe nur durch tatsaechlichen Versand steigt. Jetzt ist sie
    // vor dem Versand gegen den gespeicherten Stand geprueft (bisherigeStufe + 1).
    //
    // Das Schreiben wird geprueft (27.10.2026): Scheiterte es, meldete die Function trotzdem
    // Erfolg und die naechste Mahnung trug dieselbe Stufe. Hat zwischen Pruefung und Versand
    // jemand anders gemahnt, trifft das Update keine Zeile. Die Mail ist an dieser Stelle schon
    // raus -- deshalb kein Fehler (ein Neuversuch verschickte sie doppelt), sondern eine
    // Warnung, die der Dialog sichtbar anzeigt.
    let warnung: string | null = null;
    const neueMahnstufe = data.mahnstufe;

    console.log('Mahnung versendet:', { mietvertragId: data.mietvertragId, mahnstufe: neueMahnstufe });
    await supabase.from('system_logs').insert({
      message: `Mahnung Stufe ${neueMahnstufe} per E-Mail versendet (Mietvertrag ${data.mietvertragId}).`
    });

    let stufenUpdate = supabase.from('mietvertrag').update({
      mahnstufe: neueMahnstufe,
      letzte_mahnung_am: new Date().toISOString(),
      naechste_mahnung_am: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }).eq('id', data.mietvertragId);
    stufenUpdate = vertragVorher.mahnstufe === null
      ? stufenUpdate.is('mahnstufe', null)
      : stufenUpdate.eq('mahnstufe', vertragVorher.mahnstufe);
    const { data: aktualisiert, error: stufeFehler } = await stufenUpdate.select('id');
    if (stufeFehler || !aktualisiert || aktualisiert.length === 0) {
      warnung = `Die Mahnung ist versendet, die Mahnstufe wurde aber nicht auf ${neueMahnstufe} erhöht. Bitte die Stufe am Vertrag prüfen.`;
      console.error('Mahnstufe nicht gespeichert:', stufeFehler?.message ?? 'Stand hat sich zwischenzeitlich geaendert');
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Mahnung Stufe ${data.mahnstufe} erfolgreich per E-Mail versendet`,
        recipient: data.recipientEmail,
        warnung,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Die Meldung des Mailservers (Host, Kennung, Antwortcode) bleibt im Protokoll und in der
    // Tabelle mails; an den Aufrufer ging sie bis zum 27.10.2026 roh zurueck.
    console.error('Error in send-mahnung function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Die Mahnung konnte nicht versendet werden. Die Mahnstufe wurde nicht erhöht; Einzelheiten stehen im Protokoll der Function.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
