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

function generateMahnungHtml(data: MahnungEmailRequest): string {
  const zahlungsfristDatum = new Date();
  zahlungsfristDatum.setDate(zahlungsfristDatum.getDate() + data.zahlungsfristTage);
  const fristFormatted = zahlungsfristDatum.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
      eskalationsText = '<strong>Dies ist unsere letzte Mahnung.</strong> Sollte der Gesamtbetrag nicht innerhalb der genannten Frist auf unserem Konto eingehen, werden wir ohne weitere Ankündigung rechtliche Schritte einleiten und das Mietverhältnis fristlos kündigen. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.';
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
  const { error: authError } = await authClient.auth.getUser();
  if (authError) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const data: MahnungEmailRequest = await req.json();
    console.log('Mahnung E-Mail wird versendet:', { recipient: data.recipientEmail, mahnstufe: data.mahnstufe });

    // SMTP config
    const smtpHost = Deno.env.get("MAHNUNG_SMTP_HOST") || Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("MAHNUNG_SMTP_PORT") || Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("MAHNUNG_SMTP_USER") || Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("MAHNUNG_SMTP_PASS") || Deno.env.get("SMTP_PASS");
    const smtpFromEmail = Deno.env.get("MAHNUNG_SMTP_FROM_EMAIL") || Deno.env.get("SMTP_FROM_EMAIL") || "mahnung@niimmo.de";
    const smtpFromName = Deno.env.get("MAHNUNG_SMTP_FROM_NAME") || Deno.env.get("SMTP_FROM_NAME") || "NilImmo Hausverwaltung";

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFromEmail) {
      throw new Error("SMTP-Konfiguration für Mahnungen unvollständig. Bitte MAHNUNG_SMTP_* Secrets konfigurieren.");
    }

    // Load PDF from Supabase Storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let pdfBuffer: Buffer | null = null;
    let pdfFilename = `Mahnung_Stufe${data.mahnstufe}_${new Date().toISOString().split('T')[0]}.pdf`;
    if (data.pdfPath) {
      console.log('Loading PDF from storage:', data.pdfPath);
      const { data: fileData, error: fileError } = await supabase.storage
        .from('dokumente')
        .download(data.pdfPath);

      if (fileError) {
        console.error('PDF download error:', fileError);
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

    if (data.ccEmails && data.ccEmails.length > 0) {
      mailOptions.cc = data.ccEmails.join(', ');
    }

    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];
    }

    await transporter.sendMail(mailOptions);
    console.log('Mahnung E-Mail erfolgreich versendet an:', data.recipientEmail);

    // Log to system_logs
    await supabase.from('system_logs').insert({
      message: `Mahnung Stufe ${data.mahnstufe} per E-Mail versendet an ${data.recipientName} (${data.recipientEmail}). Gesamtbetrag: ${data.gesamtbetrag.toFixed(2)}€. Objekt: ${data.immobilieName}`
    });

    // Update mahnstufe on contract
    const neueMahnstufe = Math.min(data.mahnstufe, 3);
    await supabase.from('mietvertrag').update({
      mahnstufe: neueMahnstufe,
      letzte_mahnung_am: new Date().toISOString(),
      naechste_mahnung_am: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }).eq('id', data.mietvertragId);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Mahnung Stufe ${data.mahnstufe} erfolgreich per E-Mail versendet`,
        recipient: data.recipientEmail,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-mahnung function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
