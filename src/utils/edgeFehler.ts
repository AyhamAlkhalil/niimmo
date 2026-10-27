/**
 * Fehlertext einer Edge Function für die Oberfläche.
 *
 * `supabase.functions.invoke` liefert bei Status 4xx/5xx nur „Edge Function returned a
 * non-2xx status code“; den Grund, den die Function als `{ error }` zurückgibt, trägt
 * `error.context` (die Response). Bis zum 27.10.2026 sah der Nutzer beim Mahnversand
 * deshalb nie, warum nichts versendet wurde (Empfänger nicht hinterlegt, Stufe veraltet …).
 */
export async function edgeFehlertext(fehler: unknown, ersatz: string): Promise<string> {
  const kontext = (fehler as { context?: unknown } | null)?.context as Response | undefined;
  if (kontext && typeof kontext.clone === 'function') {
    try {
      const inhalt = await kontext.clone().json();
      if (inhalt && typeof inhalt.error === 'string' && inhalt.error.trim()) return inhalt.error;
    } catch {
      // keine JSON-Antwort
    }
  }
  return fehler instanceof Error && fehler.message ? fehler.message : ersatz;
}
