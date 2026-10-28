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
  nutzlast?: Record<string, unknown>,
): Promise<void> {
  if (!id) return;
  try {
    await client
      .from('mails')
      .update({
        status,
        gesendet_am: status === 'gesendet' ? new Date().toISOString() : null,
        fehler: fehlertext ?? null,
        ...(nutzlast ? { nutzlast } : {}),
      })
      .eq('id', id);
  } catch (fehler) {
    console.error('[mails] Abschluss fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
  }
}

// ── Eingangspruefung (19.10.2026, Erlaubnisliste seit 28.10.2026 aus der DB) ──
// Bis 19.10. pruefte die Function vom Anhang nur das Praefix uebergabeprotokolle/.
// Der URL-Parser loest aber auch %2e%2e als ".." auf; damit liess sich jede Datei
// des Buckets anhaengen. Danach galt ein Dateimuster im Protokollordner des Vertrags.
// Das liess nur 9 der 69 gespeicherten Protokolle zu: von Hand hochgeladene Scans
// liegen anderswo, aeltere Dateinamen tragen ein Komma. Seit 28.10.2026 entscheidet
// der Bestand: Der Pfad muss als Uebergabeprotokoll eines der uebergebenen Vertraege
// in `dokumente` stehen. Vorher eine strenge Formpruefung, damit kein Pfadtrick
// (%, \, ..) die Datenbankpruefung umgeht.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Zeichen, die in den gespeicherten Protokollpfaden vorkommen (am 28.10.2026 live gezaehlt:
// Buchstaben, Ziffern, . _ - / , und Leerzeichen) — kein %, kein \, keine Steuerzeichen
const PFAD_ZEICHEN = /^[A-Za-z0-9_.,\/ -]+$/;
const ANHANG_UNZULAESSIG = 'Als Anhang ist nur das Übergabeprotokoll dieses Vertrags zulässig.';
// Ohne ( ) : \ [ ]: nodemailer liest sonst „bcc:b@y.de“ als Gruppe oder Kommentar
const ADRESSE = /^[^\s@<>,;"():\\[\]]+@[^\s@<>,;"():\\[\]]+\.[^\s@<>,;"():\\[\]]+$/;
const MAX_EMPFAENGER = 20;

/**
 * Ein Adressfeld kann mehrere Adressen tragen ("a@x.de, b@y.de"); so stehen bei
 * zwei Objekten die Versorger in den Stammdaten. Bis zum 19.10.2026 nahm
 * nodemailer solche Listen an, die strengere Pruefung lehnte sie dann ab und die
 * Abmeldung bei diesen Versorgern scheiterte (23.10.2026). Jede Adresse wird
 * einzeln geprueft; ist eine ungueltig, gilt das ganze Feld als ungueltig.
 */
function adressenAus(feld: string): string[] | null {
  const teile = feld.split(/[\s,;]+/).filter(Boolean);
  if (teile.length === 0 || !teile.every((t) => t.length <= 254 && ADRESSE.test(t))) return null;
  return teile.filter((t, i) => teile.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i);
}

type Ursache = 'empfaenger' | 'groesse' | 'zugang' | 'server';

/**
 * Ordnet einen Versandfehler fuer die Meldung im Dialog ein, ohne Serverdetails.
 * Massgeblich sind die festen Felder von nodemailer (code, command, Statuscode und
 * erweiterter Code wie 5.3.4), nicht der Meldungstext: Der enthaelt die Adresse,
 * und „Mailbox size exceeded“ ist ein volles Postfach, kein zu grosses Protokoll.
 */
function ursacheAus(fehler: unknown): Ursache {
  const e = (fehler ?? {}) as { code?: string; command?: string; responseCode?: number; response?: string };
  const antwort = typeof e.response === 'string' ? e.response : '';
  const befehl = typeof e.command === 'string' ? e.command.toUpperCase() : '';
  if (e.code === 'EAUTH' || e.responseCode === 535 || befehl.startsWith('AUTH')) return 'zugang';
  if (/\b5\.3\.4\b/.test(antwort) || (befehl === 'DATA' && e.responseCode === 552 && !/\b5\.2\.2\b/.test(antwort))) return 'groesse';
  // RCPT mit 5.7.x (Relay verweigert) oder 4xx (Greylisting) betrifft das Postfach des Absenders
  const rcptAbgelehnt = befehl.startsWith('RCPT') && (e.responseCode ?? 0) >= 500 && !/\b5\.7\.\d\b/.test(antwort);
  if (rcptAbgelehnt || /\b5\.1\.\d\b|\b5\.2\.2\b/.test(antwort)) return 'empfaenger';
  return 'server';
}

const URSACHE_TEXT: Record<Ursache, string> = {
  empfaenger: 'vom Empfänger abgelehnt (Adresse falsch oder Postfach voll)',
  groesse: 'Protokoll zu groß für den Mailserver',
  zugang: 'Anmeldung am Mailpostfach abgelehnt',
  server: 'vom Mailserver nicht angenommen',
};

/** Form des Anhangpfads: ein PDF im Bucket, ohne leere, "."- oder ".."-Segmente */
function anhangFormOk(pfad: string): boolean {
  if (pfad.length === 0 || pfad.length > 512 || !PFAD_ZEICHEN.test(pfad)) return false;
  if (pfad.startsWith('/') || !/\.pdf$/i.test(pfad)) return false;
  return pfad.split('/').every((teil) => teil.trim() !== '' && teil !== '.' && teil !== '..');
}

/**
 * Der Anhang muss als Uebergabeprotokoll eines der Vertraege in `dokumente` stehen.
 * Liefert den Vertrag der Fundstelle, null wenn nicht eingetragen; wirft bei DB-Fehler.
 */
async function protokollVertrag(
  client: ReturnType<typeof createClient>,
  pfad: string,
  vertragIds: string[],
): Promise<string | null> {
  const { data, error } = await client
    .from('dokumente')
    .select('mietvertrag_id')
    .eq('pfad', pfad)
    .eq('kategorie', 'Übergabeprotokoll')
    .eq('geloescht', false)
    .in('mietvertrag_id', vertragIds)
    .limit(1);
  if (error) throw new Error(`dokumente: ${error.message}`);
  const zeile = (data as { mietvertrag_id: string | null }[] | null)?.[0];
  return zeile?.mietvertrag_id ?? null;
}

type Rolle = 'mieter' | 'cc' | 'strom' | 'gas' | 'wasser' | 'unbekannt';

/**
 * Rolle eines Empfaengers fuer das Mail-Protokoll (28.10.2026). Die Dialoge schicken je
 * Empfaenger `mieterId`: die Mieter-ID, "cc" oder den Versorger (strom/gas/wasser). Eine
 * Mieter-ID zaehlt nur, wenn der Mieter zu einem der Vertraege gehoert. Die Rolle steuert
 * nichts, sie zeigt spaeter nur an, ob Mieter oder Versorger das Protokoll schon haben.
 */
function rolleAus(mieterId: unknown, vertragsMieter: Set<string>): Rolle {
  if (mieterId === 'cc') return 'cc';
  if (mieterId === 'strom' || mieterId === 'gas' || mieterId === 'wasser') return mieterId;
  if (typeof mieterId === 'string' && UUID.test(mieterId) && vertragsMieter.has(mieterId.toLowerCase())) return 'mieter';
  return 'unbekannt';
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
  let anzahl = 0;
  for (const r of recipients) {
    const adressen = r && typeof r.email === 'string' && r.email.length <= 1000 ? adressenAus(r.email) : null;
    if (!adressen) return 'Mindestens eine Empfängeradresse ist ungültig.';
    anzahl += adressen.length;
  }
  if (anzahl > MAX_EMPFAENGER) return `Höchstens ${MAX_EMPFAENGER} Empfänger je Versand.`;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 300 || /[\r\n]/.test(subject)) {
    return 'Der Betreff fehlt oder ist ungültig.';
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 20000) return 'Die Nachricht fehlt oder ist zu lang.';
  if (!Array.isArray(contractIds) || contractIds.length === 0 || contractIds.length > 20 || !contractIds.every((id) => typeof id === 'string' && UUID.test(id))) {
    return 'Ungültige Vertragsangabe.';
  }
  // Ob der Pfad wirklich ein Protokoll dieser Vertraege ist, prueft danach protokollVertrag
  if (pdfPath !== undefined && pdfPath !== null && (typeof pdfPath !== 'string' || !anhangFormOk(pdfPath))) {
    return ANHANG_UNZULAESSIG;
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
    const contractIds = (anfrage.contractIds as string[]).map((id) => id.toLowerCase());
    const pdfPath = anfrage.pdfPath || undefined;

    // Erlaubnisliste aus dem Bestand (28.10.2026): nur ein eingetragenes Uebergabeprotokoll
    // eines der Vertraege. Der Vertrag der Fundstelle steht danach im Mail-Protokoll.
    let protokollVertragId: string | null = null;
    if (pdfPath) {
      try {
        protokollVertragId = await protokollVertrag(rollenClient, pdfPath, contractIds);
      } catch (pruefFehler) {
        console.error('Anhangpruefung fehlgeschlagen:', pruefFehler instanceof Error ? pruefFehler.message : 'unbekannt');
        return json({ error: 'Das Übergabeprotokoll konnte nicht geprüft werden. Es wurde nichts versendet.' }, 500);
      }
      if (!protokollVertragId) return json({ error: ANHANG_UNZULAESSIG }, 403);
    }

    // Mieter der Vertraege, damit eine Mieter-ID im Protokoll als Mieter zaehlt. Scheitert
    // das Lesen, wird trotzdem versendet — die Rolle ist nur Anzeige.
    const vertragsMieter = new Set<string>();
    const { data: mieterLinks, error: mieterFehler } = await rollenClient
      .from('mietvertrag_mieter')
      .select('mieter_id')
      .in('mietvertrag_id', contractIds);
    if (mieterFehler) console.error('[mails] Mieter der Vertraege nicht gelesen:', mieterFehler.message);
    for (const l of (mieterLinks as { mieter_id: string }[] | null) ?? []) vertragsMieter.add(String(l.mieter_id).toLowerCase());

    // Je Adresse eine eigene Mail; doppelte Adressen nur einmal
    const gesehen = new Set<string>();
    const recipients: EmailRecipient[] = [];
    const rollen: { email: string; rolle: Rolle }[] = [];
    for (const r of anfrage.recipients as EmailRecipient[]) {
      for (const email of adressenAus(r.email) ?? []) {
        if (gesehen.has(email.toLowerCase())) continue;
        gesehen.add(email.toLowerCase());
        recipients.push({ ...r, email });
        rollen.push({ email, rolle: rolleAus(r.mieterId, vertragsMieter) });
      }
    }

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
      // Pfad ist oben geprueft: Form (anfrageFehler) und Eintrag in dokumente (protokollVertrag)
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: fileData, error: fileError } = await supabase.storage
        .from('dokumente')
        .download(pdfPath);

      if (fileError) {
        // Nicht verschlucken: Sonst geht die Mail ohne Protokoll hinaus und
        // meldet trotzdem Erfolg.
        console.error('PDF download error:', fileError.message);
        return new Response(
          JSON.stringify({ error: 'Das Übergabeprotokoll konnte nicht geladen werden. Es wurde nichts versendet.' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
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
    const failedEmails: { email: string; error: string; ursache: Ursache }[] = [];
    const htmlBody = htmlMaskieren(body).replace(/\n/g, "<br>");

    // Dateiname mit dem Übergabedatum aus der Anfrage; bis zum 27.10.2026 stand dort der UTC-Tag des
    // Versands (zwischen 0 und 2 Uhr deutscher Zeit der Vortag). Der Ersatz ohne Datum nahm bis zum
    // 28.10.2026 noch denselben UTC-Tag — jetzt der Kalendertag in Berlin, auch über die Zeitumstellung.
    const berlin = Object.fromEntries(
      new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date())
        .map((teil) => [teil.type, teil.value]),
    );
    const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(anfrage?.uebergabeDatum ?? '')) ? String(anfrage.uebergabeDatum) : `${berlin.year}-${berlin.month}-${berlin.day}`;
    const anhangName = `Uebergabeprotokoll_${tag}.pdf`;
    // Vertrag, Rollen und spaeter das Ergebnis je Adresse (28.10.2026): Bis dahin liess sich
    // nach dem Schliessen des Dialogs nicht mehr feststellen, ob und an wen das Protokoll ging.
    const nutzlast: Record<string, unknown> = { vertrag_ids: contractIds, uebergabe_datum: tag, empfaenger: rollen };
    const mailId = await mailVormerken(rollenClient, {
      typ: 'uebergabe',
      status: 'entwurf',
      betreff: subject,
      text: body,
      html: htmlBody,
      empfaenger: recipients.map((r) => r.email),
      anhang_pfad: pdfPath ?? null,
      anhang_name: pdfBuffer ? anhangName : null,
      mietvertrag_id: protokollVertragId,
      nutzlast,
      erstellt_von: userData.user.id,
    });

    for (const recipient of recipients) {
      try {
        const mailOptions: any = {
          from: `${smtpFromName} <${smtpFromEmail}>`,
          // Als Objekt: So parst nodemailer die Adresse nicht noch einmal
          to: { name: '', address: recipient.email },
          subject: subject,
          text: body,
          html: htmlBody,
        };

        if (pdfBuffer) {
          mailOptions.attachments = [{
            filename: anhangName,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }];
        }

        await transporter.sendMail(mailOptions);
        sentEmails.push(recipient.email);
      } catch (emailError) {
        // Ins Log nur Codes: Die Meldung des Mailservers enthaelt meist die Adresse
        const e = (emailError ?? {}) as { code?: string; responseCode?: number };
        console.error('Versand fehlgeschlagen:', { code: e.code ?? null, responseCode: e.responseCode ?? null });
        // Die volle Ursache bleibt im Mail-Protokoll; an den Browser geht nur die Einordnung
        failedEmails.push({
          email: recipient.email,
          error: emailError instanceof Error ? emailError.message : "Unknown error",
          ursache: ursacheAus(emailError),
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
      { ...nutzlast, zugestellt: sentEmails, abgelehnt: failedEmails.map((f) => f.email) },
    );

    console.log(`Versand: ${sentEmails.length} zugestellt, ${failedEmails.length} fehlgeschlagen`);

    if (sentEmails.length === 0 && failedEmails.length > 0) {
      // Bis zum 23.10.2026 hiess es hier immer „Adressen pruefen“, auch wenn das
      // Protokoll zu gross oder der Mailserver nicht erreichbar war
      const ursachen = new Set(failedEmails.map((f) => f.ursache));
      const einzige = ursachen.size === 1 ? [...ursachen][0] : null;
      const meldung =
        einzige === 'groesse'
          ? 'Das Protokoll ist zu groß für den Mailserver. Es wurde nichts zugestellt.'
          : einzige === 'zugang'
            ? 'Der Mailserver hat die Anmeldung des Postfachs abgelehnt. Es wurde nichts versendet — bitte die Zugangsdaten prüfen lassen.'
            : einzige === 'server'
              ? 'Der Mailserver hat die Mails nicht angenommen. Bitte später erneut versuchen.'
            : `Keine E-Mail wurde zugestellt (${failedEmails.map((f) => `${f.email}: ${URSACHE_TEXT[f.ursache]}`).join("; ")}).`;
      return json({ error: meldung, success: false }, 502);
    }

    return json({
      success: true,
      sentEmails,
      failedEmails: failedEmails.map((f) => ({ email: f.email, error: URSACHE_TEXT[f.ursache] })),
      message: `${sentEmails.length} E-Mail(s) erfolgreich versendet${
        failedEmails.length > 0 ? `, ${failedEmails.length} fehlgeschlagen` : ""
      }`,
    }, 200);
  } catch (error) {
    // Keine internen Meldungen (SMTP, Storage) an den Browser
    console.error("Error in send-uebergabe-email function:", error instanceof Error ? error.message : 'unbekannt');
    return json({ error: 'Die E-Mails konnten nicht versendet werden.', success: false }, 500);
  }
});
