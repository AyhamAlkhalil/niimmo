/**
 * Auswertung der Antwort von `send-uebergabe-email`.
 *
 * Die Function antwortet mit 200, sobald mindestens eine Mail angenommen wurde,
 * und führt die übrigen in `failedEmails`. Bis zum 19.10.2026 wertete der
 * Maildialog nur den Statuscode aus und meldete jeden Teilversand als vollen
 * Erfolg — eine abgelehnte Adresse fiel niemandem auf.
 */
export interface VersandAuswertung {
  gesendet: string[];
  fehlgeschlagen: string[];
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
  return { gesendet, fehlgeschlagen };
}
