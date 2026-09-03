import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import nodemailer from "npm:nodemailer@6.9.10";

/**
 * Passwort zuruecksetzen.
 *
 * Warum eigene Function und nicht der eingebaute Mailversand von Supabase:
 * Fuer Auth-Mails ist in diesem Projekt kein SMTP hinterlegt (smtp_host leer).
 * Es griffe der geteilte Absender von Supabase mit 2 Mails pro Stunde — fuer
 * eine Passwort-Zuruecksetzung unbrauchbar. Der SMTP der Mahnungen ist dagegen
 * im Betrieb bestaetigt und wird hier wiederverwendet.
 *
 * Der Link zeigt bewusst auf die eigene Anwendung und nicht auf den
 * Weiterleitungs-Mechanismus von Supabase: Dessen Freigabeliste enthaelt
 * Adressen mehrerer fremder Projekte. Die Anwendung loest den Token selbst per
 * verifyOtp ein, damit ist die Liste ohne Bedeutung.
 *
 * Antwortet immer mit 200, auch bei unbekannter Adresse — sonst liesse sich
 * ueber diesen Endpunkt herausfinden, welche Adressen ein Konto haben.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Wartezeit zwischen zwei Mails an dieselbe Adresse. */
const SPERRE_SEKUNDEN = 120;

const ANTWORT = {
  ok: true,
  meldung:
    "Falls für diese Adresse ein Zugang besteht, ist eine E-Mail mit dem Link unterwegs.",
};

function antworte(status = 200) {
  return new Response(JSON.stringify(ANTWORT), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    const adresse = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!adresse || !adresse.includes("@")) {
      return antworte();
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Nur hinterlegte interne Personen. Wer nicht im Verzeichnis steht,
    // bekommt keine Mail — und erfaehrt das auch nicht.
    const { data: person } = await supabase
      .from("app_benutzer")
      .select("id, anzeigename, letzte_reset_mail, aktiv")
      .ilike("email", adresse)
      .maybeSingle();

    if (!person || !person.aktiv) {
      return antworte();
    }

    if (person.letzte_reset_mail) {
      const vergangen = (Date.now() - new Date(person.letzte_reset_mail).getTime()) / 1000;
      if (vergangen < SPERRE_SEKUNDEN) {
        return antworte();
      }
    }

    const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
    if (!appUrl) {
      console.error("APP_URL ist nicht gesetzt — es kann kein Link gebaut werden.");
      return antworte(500);
    }

    const { data: link, error: linkFehler } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: adresse,
    });

    if (linkFehler || !link?.properties?.hashed_token) {
      console.error("Zurücksetz-Link konnte nicht erzeugt werden:", linkFehler?.message);
      return antworte();
    }

    // Der Token steht hinter der Raute: So landet er nicht in Server-Protokollen
    // oder im Verlauf zwischengeschalteter Systeme.
    const zielUrl = `${appUrl}/passwort-neu#token=${encodeURIComponent(link.properties.hashed_token)}`;

    const smtpHost = Deno.env.get("AUTH_SMTP_HOST") || Deno.env.get("MAHNUNG_SMTP_HOST");
    const smtpPort = parseInt(
      Deno.env.get("AUTH_SMTP_PORT") || Deno.env.get("MAHNUNG_SMTP_PORT") || "587",
    );
    const smtpUser = Deno.env.get("AUTH_SMTP_USER") || Deno.env.get("MAHNUNG_SMTP_USER");
    const smtpPass = Deno.env.get("AUTH_SMTP_PASS") || Deno.env.get("MAHNUNG_SMTP_PASS");
    const absenderMail =
      Deno.env.get("AUTH_SMTP_FROM_EMAIL") ||
      Deno.env.get("MAHNUNG_SMTP_FROM_EMAIL") ||
      "mahnung@niimmo.de";
    const absenderName =
      Deno.env.get("AUTH_SMTP_FROM_NAME") ||
      Deno.env.get("MAHNUNG_SMTP_FROM_NAME") ||
      "NiImmo Verwaltung";

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error("SMTP-Konfiguration unvollständig.");
      return antworte(500);
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `${absenderName} <${absenderMail}>`,
      to: adresse,
      subject: "NiImmo — Passwort zurücksetzen",
      text:
        `Hallo ${person.anzeigename},\n\n` +
        `über den folgenden Link vergeben Sie ein neues Passwort für das NiImmo Dashboard:\n\n` +
        `${zielUrl}\n\n` +
        `Der Link gilt eine Stunde und lässt sich nur einmal verwenden.\n\n` +
        `Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — ` +
        `ohne den Link ändert sich nichts.\n`,
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6">` +
        `<p>Hallo ${person.anzeigename},</p>` +
        `<p>über den folgenden Link vergeben Sie ein neues Passwort für das NiImmo Dashboard:</p>` +
        `<p><a href="${zielUrl}" style="display:inline-block;background:#b91c1c;color:#fff;` +
        `padding:10px 18px;border-radius:6px;text-decoration:none">Neues Passwort vergeben</a></p>` +
        `<p style="font-size:12px;color:#555">Der Link gilt eine Stunde und lässt sich nur einmal verwenden.<br>` +
        `Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — ohne den Link ändert sich nichts.</p>` +
        `</div>`,
    });

    await supabase
      .from("app_benutzer")
      .update({ letzte_reset_mail: new Date().toISOString() })
      .eq("id", person.id);

    return antworte();
  } catch (fehler) {
    console.error("Unerwarteter Fehler:", fehler instanceof Error ? fehler.message : fehler);
    // Auch hier keine Auskunft nach außen.
    return antworte();
  }
});
