import { supabase } from "@/integrations/supabase/client";

const SIGNIER_ZEITLIMIT_MS = 15_000;

/**
 * Öffnet eine Datei aus dem Bucket „dokumente" in einem neuen Tab.
 *
 * Das Fenster wird sofort beim Klick geöffnet und erst nach dem Signieren auf
 * die Adresse gesetzt: Safari blockiert window.open, wenn es erst nach einem
 * await kommt. Liefert false, wenn sich die Datei nicht signieren ließ, das
 * Signieren hängt oder der Browser das Fenster blockiert — der Aufrufer zeigt
 * dann eine Meldung, statt dass der Klick still ins Leere geht.
 */
export async function dokumentOeffnen(pfad: string): Promise<boolean> {
  const fenster = window.open("", "_blank");
  let signiert: string | null = null;
  try {
    const ergebnis = await Promise.race([
      supabase.storage.from("dokumente").createSignedUrl(pfad, 600),
      new Promise<null>((r) => setTimeout(() => r(null), SIGNIER_ZEITLIMIT_MS)),
    ]);
    signiert = ergebnis && !ergebnis.error ? ergebnis.data?.signedUrl ?? null : null;
  } catch {
    signiert = null;
  }
  if (!signiert) {
    fenster?.close();
    return false;
  }
  if (fenster) {
    fenster.opener = null;
    fenster.location.href = signiert;
    return true;
  }
  // Ohne „noopener": nur so meldet window.open ein blockiertes Fenster mit null
  const zweiter = window.open(signiert, "_blank");
  if (!zweiter) return false;
  zweiter.opener = null;
  return true;
}
