/**
 * Auswertung der Antwort von `send-uebergabe-email`.
 *
 * Die Function antwortet mit 200, sobald mindestens eine Mail angenommen wurde,
 * und führt die übrigen in `failedEmails`. Bis zum 19.10.2026 wertete der
 * Maildialog nur den Statuscode aus und meldete jeden Teilversand als vollen
 * Erfolg — eine abgelehnte Adresse fiel niemandem auf.
 */
/**
 * Dieselbe Prüfung wie in send-uebergabe-email. Eine ungültige Adresse lehnt die
 * Function für den ganzen Versand ab — der Dialog markiert sie deshalb vorher.
 */
export function istMailadresse(email: string | null | undefined): boolean {
  const text = email?.trim() ?? "";
  // Steuerzeichen (auch NUL) haben in einer Adresse nichts verloren
  const steuerzeichen = [...text].some((z) => z.charCodeAt(0) < 0x20 || z.charCodeAt(0) === 0x7f);
  return !!text && text.length <= 254 && !steuerzeichen && /^[^\s@<>,;"():\\[\]]+@[^\s@<>,;"():\\[\]]+\.[^\s@<>,;"():\\[\]]+$/.test(text);
}

/**
 * Ein Adressfeld kann mehrere Adressen tragen ("a@x.de, b@y.de") — so stehen bei
 * zwei Objekten die Versorger in den Stammdaten. Liefert die einzelnen Adressen
 * (doppelte nur einmal) oder null, wenn das Feld leer ist oder eine Adresse nicht
 * taugt. Seit 23.10.2026; vorher lehnte die Function solche Felder ganz ab.
 */
export function mailadressen(feld: string | null | undefined): string[] | null {
  const teile = (feld ?? "").split(/[\s,;]+/).filter(Boolean);
  if (teile.length === 0 || !teile.every(istMailadresse)) return null;
  return teile.filter((t, i) => teile.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i);
}

/**
 * Die Meldung aus der Antwort einer Edge Function. supabase-js liefert bei einem
 * Fehlerstatus nur „Edge Function returned a non-2xx status code“; der Grund
 * steht im Body.
 */
export async function funktionsFehlertext(fehler: unknown, ersatz: string): Promise<string> {
  try {
    const ctx = (fehler as { context?: { json?: () => Promise<{ error?: unknown }> } })?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
    }
  } catch {
    // Antwort ohne JSON-Body
  }
  return ersatz;
}

export interface VersandAuswertung {
  gesendet: string[];
  fehlgeschlagen: string[];
  /** Grund je abgelehnter Adresse, wie ihn die Function meldet (z. B. „Mailserver nicht erreichbar“) */
  gruende: Record<string, string>;
}

const adresseAus = (eintrag: unknown): string | null => {
  if (typeof eintrag === "string") return eintrag;
  if (eintrag && typeof eintrag === "object" && typeof (eintrag as { email?: unknown }).email === "string") {
    return (eintrag as { email: string }).email;
  }
  return null;
};

/**
 * Fehlt `sentEmails` in der Antwort, gelten alle nicht als gescheitert
 * gemeldeten Adressen als versendet — ein 200 heißt, die Function hat versendet.
 */
export function versandAuswerten(antwort: unknown, alleAdressen: string[]): VersandAuswertung {
  const a = antwort && typeof antwort === "object" ? (antwort as Record<string, unknown>) : {};
  const fehlgeschlagen = Array.isArray(a.failedEmails)
    ? a.failedEmails.map(adresseAus).filter((x): x is string => x !== null)
    : [];
  const gesendet = Array.isArray(a.sentEmails)
    ? a.sentEmails.filter((x): x is string => typeof x === "string")
    : alleAdressen.filter((x) => !fehlgeschlagen.includes(x));
  const gruende: Record<string, string> = {};
  if (Array.isArray(a.failedEmails)) {
    for (const eintrag of a.failedEmails) {
      const adresse = adresseAus(eintrag);
      const grund = (eintrag as { error?: unknown })?.error;
      if (adresse && typeof grund === "string" && grund.trim()) gruende[adresse] = grund;
    }
  }
  return { gesendet, fehlgeschlagen, gruende };
}
