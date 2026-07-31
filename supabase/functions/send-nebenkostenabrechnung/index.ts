import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Buffer } from "node:buffer";
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

interface NebenkostenAbrechnungEmailRequest {
  recipientEmail: string;
  recipientName: string;
  pdfBase64: string;
  immobilieAdresse: string;
  einheitBezeichnung: string;
  abrechnungsjahr: number;
  saldo: number;
}

function generateEmailHtml(data: NebenkostenAbrechnungEmailRequest): string {
  const isNachzahlung = data.saldo > 0;
  const betragFormatted = Math.abs(data.saldo).toFixed(2);
  const headerColor = isNachzahlung ? '#C0392B' : '#27AE60';
  const logoUrl = 'https://dashboard.niimmo.de/nilimmo-logo.png';
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const ergebnisText = isNachzahlung
    ? `<strong>Nachzahlungsbetrag: ${betragFormatted} €</strong><br>Bitte überweisen Sie diesen Betrag innerhalb von 30 Tagen.`
    : `<strong>Guthaben: ${betragFormatted} €</strong><br>Dieses Guthaben wird mit Ihrer nächsten Mietzahlung verrechnet.`;

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <tr><td style="background-color:${headerColor};padding:24px 32px;text-align:center;">
    <img src="${logoUrl}" alt="NiImmo" height="40" style="margin-bottom:12px;display:inline-block;" />
    <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">Betriebskostenabrechnung ${data.abrechnungsjahr}</h1>
  </td></tr>

  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;">Sehr geehrte/r ${data.recipientName},</p>
    <p style="margin:0 0 20px;">anbei erhalten Sie Ihre Betriebskostenabrechnung für das Jahr <strong>${data.abrechnungsjahr}</strong> für die Einheit <strong>${data.einheitBezeichnung}</strong>, ${data.immobilieAdresse}.</p>

    <div style="background-color:${isNachzahlung ? '#FFF5F5' : '#F0FFF4'};border:2px solid ${headerColor};border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0;font-size:15px;color:${headerColor};">${ergebnisText}</p>
    </div>

    <p style="margin:0 0 16px;">Die vollständige Abrechnung mit allen Einzelpositionen finden Sie im beigefügten PDF.</p>
    <p style="margin:0 0 16px;">Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>

    <p style="margin:24px 0 0;">Mit freundlichen Grüßen,<br>
    <strong>NiImmo Verwaltung GmbH</strong></p>
  </td></tr>

  <tr><td style="background-color:#f8f9fa;padding:16px 32px;border-top:1px solid #eee;text-align:center;">
    <p style="margin:0;font-size:12px;color:#999;">NiImmo Verwaltung GmbH • ${data.immobilieAdresse}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#bbb;">Erstellt am ${heute}</p>
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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const data: NebenkostenAbrechnungEmailRequest = await req.json();

    if (!data.recipientEmail || !data.pdfBase64) {
      return new Response(JSON.stringify({ error: 'recipientEmail und pdfBase64 sind erforderlich' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const smtpHost = Deno.env.get('MAHNUNG_SMTP_HOST');
    const smtpPort = parseInt(Deno.env.get('MAHNUNG_SMTP_PORT') || '587');
    const smtpUser = Deno.env.get('MAHNUNG_SMTP_USER');
    const smtpPass = Deno.env.get('MAHNUNG_SMTP_PASS');
    const smtpFrom = Deno.env.get('MAHNUNG_SMTP_FROM') || 'mahnung@niimmo.de';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return new Response(JSON.stringify({ error: 'SMTP nicht konfiguriert' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const pdfBuffer = Buffer.from(data.pdfBase64, 'base64');
    const filename = `Betriebskostenabrechnung_${data.abrechnungsjahr}_${data.recipientName.replace(/\s+/g, '_')}.pdf`;

    await transporter.sendMail({
      from: `"NiImmo Verwaltung" <${smtpFrom}>`,
      to: data.recipientEmail,
      subject: `Betriebskostenabrechnung ${data.abrechnungsjahr} – ${data.einheitBezeichnung}`,
      html: generateEmailHtml(data),
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
