import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Buffer } from "node:buffer";
import nodemailer from "npm:nodemailer@6.9.10";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

interface EmailRecipient {
  mieterId: string;
  email: string;
  name: string;
}

interface EmailRequest {
  recipients: EmailRecipient[];
  subject: string;
  body: string;
  contractIds: string[];
  uebergabeDatum: string;
  pdfPath?: string;
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

// ── Eingangspruefung (19.10.2026) ─────────────────────────────────────────────
// Bis dahin pruefte die Function vom Anhang nur das Praefix uebergabeprotokolle/.
// Der URL-Parser loest aber auch %2e%2e als ".." auf; damit liess sich jede Datei
// des Buckets anhaengen. Jetzt gilt eine Erlaubnisliste: genau ein PDF direkt im
// Protokollordner eines der uebergebenen Vertraege (wie send-mahnung).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROTOKOLL_PFAD = /^uebergabeprotokolle\/([0-9a-f-]{36})\/([A-Za-z0-9_.-]+\.pdf)$/i;
const ADRESSE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const MAX_EMPFAENGER = 20;

function protokollErlaubt(pfad: string, vertragIds: string[]): boolean {
  const treffer = PROTOKOLL_PFAD.exec(pfad);
  if (!treffer || treffer[2].includes('..')) return false;
  const ordner = treffer[1].toLowerCase();
  return vertragIds.some((id) => id.toLowerCase() === ordner);
}

/** Text fuer den HTML-Teil: Der Brief kommt als Klartext aus dem Dialog. */
function htmlMaskieren(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Prueft die Anfrage; liefert die Fehlermeldung fuer den Dialog oder null. */
function anfrageFehler(daten: Partial<EmailRequest> | null): string | null {
  if (!daten || typeof daten !== 'object' || Array.isArray(daten)) return 'Ungültige Anfrage.';
  const { recipients, subject, body, contractIds, pdfPath } = daten;
  if (!Array.isArray(recipients) || recipients.length === 0) return 'Keine Empfänger angegeben.';
  if (recipients.length > MAX_EMPFAENGER) return `Höchstens ${MAX_EMPFAENGER} Empfänger je Versand.`;
  for (const r of recipients) {
    if (!r || typeof r.email !== 'string' || r.email.length > 254 || !ADRESSE.test(r.email.trim())) {
      return 'Mindestens eine Empfängeradresse ist ungültig.';
    }
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 300 || /[\r\n]/.test(subject)) {
    return 'Der Betreff fehlt oder ist ungültig.';
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 20000) return 'Die Nachricht fehlt oder ist zu lang.';
  if (!Array.isArray(contractIds) || contractIds.length === 0 || contractIds.length > 20 || !contractIds.every((id) => typeof id === 'string' && UUID.test(id))) {
    return 'Ungültige Vertragsangabe.';
  }
  if (pdfPath !== undefined && pdfPath !== null && (typeof pdfPath !== 'string' || !protokollErlaubt(pdfPath, contractIds))) {
    return 'Als Anhang ist nur das Übergabeprotokoll dieses Vertrags zulässig.';
  }
  return null;
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

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  if (authError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Diese Funktion verschickt Post an Mieter und Versorger und haengt Dateien
  // aus dem Dokumenten-Bucket an. Die Empfaenger koennen Dritte sein (Strom,
  // Gas, Wasser), lassen sich also nicht gegen eine Liste pruefen -- umso
  // wichtiger ist, dass nur die Verwaltung sie aufrufen kann.
  const rollenClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const json = (inhalt: unknown, status: number) =>
    new Response(JSON.stringify(inhalt), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    let anfrage: Partial<EmailRequest>;
    try {
      anfrage = await req.json();
    } catch {
      return json({ error: 'Ungültige Anfrage.' }, 400);
    }
    const fehler = anfrageFehler(anfrage);
    if (fehler) {
      return json({ error: fehler }, fehler.startsWith('Als Anhang') ? 403 : 400);
    }
    const { subject, body } = anfrage as EmailRequest;
    const pdfPath = anfrage.pdfPath || undefined;
    const recipients = (anfrage.recipients as EmailRecipient[]).map((r) => ({ ...r, email: r.email.trim() }));

    // SMTP config — dedicated Übergabe secrets with fallback
    const smtpHost = Deno.env.get("UEBERGABE_SMTP_HOST") || Deno.env.get("MAHNUNG_SMTP_HOST") || Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("UEBERGABE_SMTP_PORT") || Deno.env.get("MAHNUNG_SMTP_PORT") || Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("UEBERGABE_SMTP_USER") || Deno.env.get("MAHNUNG_SMTP_USER") || Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("UEBERGABE_SMTP_PASS") || Deno.env.get("MAHNUNG_SMTP_PASS") || Deno.env.get("SMTP_PASS");
    const smtpFromEmail = Deno.env.get("UEBERGABE_SMTP_FROM_EMAIL") || Deno.env.get("MAHNUNG_SMTP_FROM_EMAIL") || Deno.env.get("SMTP_FROM_EMAIL") || "mahnung@niimmo.de";
    const smtpFromName = Deno.env.get("UEBERGABE_SMTP_FROM_NAME") || Deno.env.get("MAHNUNG_SMTP_FROM_NAME") || Deno.env.get("SMTP_FROM_NAME") || "NiImmo Hausverwaltung";

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFromEmail) {
      console.error('SMTP-Konfiguration unvollständig (UEBERGABE_SMTP_* / MAHNUNG_SMTP_*)');
      return json({ error: 'Der Mailversand ist nicht eingerichtet. Es wurde nichts versendet.' }, 500);
    }

    // Load PDF attachment if path provided
    let pdfBuffer: Buffer | null = null;
    if (pdfPath) {
      // Pfad ist oben gegen die Erlaubnisliste geprueft (anfrageFehler)
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      console.log('Loading PDF from storage:', pdfPath);
      const { data: fileData, error: fileError } = await supabase.storage
        .from('dokumente')
        .download(pdfPath);

      if (fileError) {
        // Nicht verschlucken: Sonst geht die Mail ohne Protokoll hinaus und
        // meldet trotzdem Erfolg.
        console.error('PDF download error:', fileError);
        return new Response(
          JSON.stringify({ error: 'Das Übergabeprotokoll konnte nicht geladen werden. Es wurde nichts versendet.' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        console.log('PDF loaded successfully, size:', pdfBuffer.length);
      }
    }

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

    const sentEmails: string[] = [];
    const failedEmails: { email: string; error: string }[] = [];
    const htmlBody = htmlMaskieren(body).replace(/\n/g, "<br>");

    const mailId = await mailVormerken(rollenClient, {
      typ: 'uebergabe',
      status: 'entwurf',
      betreff: subject,
      text: body,
      html: htmlBody,
      empfaenger: recipients.map((r) => r.email),
      anhang_pfad: pdfPath ?? null,
      anhang_name: pdfBuffer ? `Uebergabeprotokoll_${new Date().toISOString().split('T')[0]}.pdf` : null,
      erstellt_von: userData.user.id,
    });

    for (const recipient of recipients) {
      try {
        const mailOptions: any = {
          from: `${smtpFromName} <${smtpFromEmail}>`,
          to: recipient.email,
          subject: subject,
          text: body,
          html: htmlBody,
        };

        if (pdfBuffer) {
          mailOptions.attachments = [{
            filename: `Uebergabeprotokoll_${new Date().toISOString().split('T')[0]}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }];
        }

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to: ${recipient.email}`);
        sentEmails.push(recipient.email);
      } catch (emailError) {
        console.error(`Failed to send email to ${recipient.email}:`, emailError);
        // Die Ursache vom Mailserver bleibt im Mail-Protokoll und im Log; an den
        // Browser geht nur, welche Adresse nicht angenommen wurde
        failedEmails.push({
          email: recipient.email,
          error: emailError instanceof Error ? emailError.message : "Unknown error",
        });
      }
    }

    transporter.close();

    // Teilversand bleibt ein Versand: Das Protokoll haelt fest, wer nicht erreicht wurde.
    await mailAbschliessen(
      rollenClient,
      mailId,
      sentEmails.length > 0 ? 'gesendet' : 'fehler',
      failedEmails.length > 0 ? failedEmails.map((f) => `${f.email}: ${f.error}`).join('; ') : undefined,
    );

    if (sentEmails.length === 0 && failedEmails.length > 0) {
      return json({
        error: `Keine E-Mail wurde zugestellt (${failedEmails.map((f) => f.email).join(", ")}). Bitte die Adressen prüfen.`,
        success: false,
      }, 502);
    }

    return json({
      success: true,
      sentEmails,
      failedEmails: failedEmails.map((f) => ({ email: f.email, error: 'nicht zugestellt' })),
      message: `${sentEmails.length} E-Mail(s) erfolgreich versendet${
        failedEmails.length > 0 ? `, ${failedEmails.length} fehlgeschlagen` : ""
      }`,
    }, 200);
  } catch (error) {
    // Keine internen Meldungen (SMTP, Storage) an den Browser
    console.error("Error in send-uebergabe-email function:", error);
    return json({ error: 'Die E-Mails konnten nicht versendet werden.', success: false }, 500);
  }
});
