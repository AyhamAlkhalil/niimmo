import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import nodemailer from "npm:nodemailer@6.9.10";

// Muss mit src/config/company.ts übereinstimmen — Deno kann die Datei nicht importieren.
const COMPANY = {
  name: "NiImmo Wohnungsbaugesellschaft mbH",
  strasse: "Egerstorffstraße 11",
  plzOrt: "33119 Sehnde",
  telefon: "05138 - 600 72 72",
  email: "mikyas@niimmo.de",
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

interface NebenkostenAbrechnungEmailRequest {
  /** Alle Vertragspartner. `recipientEmail` bleibt für Altaufrufe unterstützt. */
  recipientEmails?: string[];
  recipientEmail?: string;
  recipientName: string;
  pdfBase64: string;
  immobilieAdresse: string;
  einheitBezeichnung: string;
  abrechnungsjahr: number;
  saldo: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function generateEmailHtml(data: NebenkostenAbrechnungEmailRequest): string {
  const isNachzahlung = data.saldo > 0.01;
  const isGuthaben = data.saldo < -0.01;
  const betragFormatted = Math.abs(data.saldo).toFixed(2);
  const headerColor = isNachzahlung ? '#C0392B' : isGuthaben ? '#27AE60' : '#555555';
  const logoUrl = 'https://dashboard.niimmo.de/nilimmo-logo.png';
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const ergebnisText = isNachzahlung
    ? `<strong>Nachzahlungsbetrag: ${betragFormatted} €</strong><br>Bitte überweisen Sie diesen Betrag innerhalb von 30 Tagen auf das bekannte Mietkonto.`
    : isGuthaben
    ? `<strong>Guthaben: ${betragFormatted} €</strong><br>Das Guthaben wird Ihnen umgehend erstattet.`
    : `<strong>Die Abrechnung ist ausgeglichen.</strong><br>Es ergibt sich weder eine Nachzahlung noch ein Guthaben.`;

  const name = escapeHtml(data.recipientName);
  const adresse = escapeHtml(data.immobilieAdresse);
  const einheit = escapeHtml(data.einheitBezeichnung);

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
    <p style="margin:0 0 16px;">Sehr geehrte/r ${name},</p>
    <p style="margin:0 0 20px;">anbei erhalten Sie Ihre Betriebskostenabrechnung für das Jahr <strong>${data.abrechnungsjahr}</strong> für die Einheit <strong>${einheit}</strong>, ${adresse}.</p>

    <div style="background-color:${isNachzahlung ? '#FFF5F5' : isGuthaben ? '#F0FFF4' : '#F7F7F7'};border:2px solid ${headerColor};border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <p style="margin:0;font-size:15px;color:${headerColor};">${ergebnisText}</p>
    </div>

    <p style="margin:0 0 16px;">Die vollständige Abrechnung mit allen Einzelpositionen finden Sie im beigefügten PDF.</p>
    <p style="margin:0 0 16px;">Einwendungen gegen die Abrechnung können Sie innerhalb von zwölf Monaten nach Zugang geltend machen (§ 556 Abs. 3 BGB). Die zugrunde liegenden Belege können Sie nach Terminvereinbarung einsehen.</p>

    <p style="margin:24px 0 0;">Mit freundlichen Grüßen,<br>
    <strong>${COMPANY.name}</strong></p>
  </td></tr>

  <tr><td style="background-color:#f8f9fa;padding:16px 32px;border-top:1px solid #eee;text-align:center;">
    <p style="margin:0;font-size:12px;color:#999;">${COMPANY.name} • ${COMPANY.strasse} • ${COMPANY.plzOrt}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#999;">Tel. ${COMPANY.telefon} • ${COMPANY.email}</p>
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
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  // Nur Admins dürfen Post an Mieter auslösen. Ohne diese Prüfung könnte jeder
  // eingeloggte Account (auch Hausmeister) beliebige PDFs an beliebige Adressen senden.
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
  if (authError || !userData.user) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: isAdmin, error: roleError } = await serviceClient.rpc('is_admin', {
    _user_id: userData.user.id,
  });
  if (roleError || !isAdmin) {
    return json({ error: 'Nur Administratoren dürfen Abrechnungen versenden.' }, 403, corsHeaders);
  }

  try {
    const data: NebenkostenAbrechnungEmailRequest = await req.json();

    const empfaenger = (data.recipientEmails ?? (data.recipientEmail ? [data.recipientEmail] : []))
      .map((mail) => mail.trim())
      .filter((mail) => EMAIL_PATTERN.test(mail));

    if (empfaenger.length === 0) {
      return json({ error: 'Keine gültige Empfängeradresse übergeben' }, 400, corsHeaders);
    }
    if (!data.pdfBase64) {
      return json({ error: 'pdfBase64 ist erforderlich' }, 400, corsHeaders);
    }

    const smtpHost = Deno.env.get('MAHNUNG_SMTP_HOST');
    const smtpPort = parseInt(Deno.env.get('MAHNUNG_SMTP_PORT') || '587');
    const smtpUser = Deno.env.get('MAHNUNG_SMTP_USER');
    const smtpPass = Deno.env.get('MAHNUNG_SMTP_PASS');
    // Eigener Absender, sonst kommt die Abrechnung aus dem Mahnungs-Postfach.
    const smtpFrom = Deno.env.get('NEBENKOSTEN_SMTP_FROM')
      || Deno.env.get('MAHNUNG_SMTP_FROM')
      || 'mahnung@niimmo.de';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: 'SMTP nicht konfiguriert' }, 500, corsHeaders);
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const pdfBuffer = Buffer.from(data.pdfBase64, 'base64');
    const safeName = data.recipientName.replace(/[^\wÄÖÜäöüß -]/g, '').replace(/\s+/g, '_');
    const filename = `Betriebskostenabrechnung_${data.abrechnungsjahr}_${safeName}.pdf`;

    await transporter.sendMail({
      from: `"${COMPANY.name}" <${smtpFrom}>`,
      to: empfaenger.join(', '),
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

    return json({ success: true, recipients: empfaenger }, 200, corsHeaders);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    console.error('[send-nebenkostenabrechnung]', message);
    return json({ error: message }, 500, corsHeaders);
  }
});
