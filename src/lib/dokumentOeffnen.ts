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

/**
 * Lädt eine Datei aus dem Bucket „dokumente“ mit sprechendem Namen herunter (seit 12.11.2026 für den Mietvertrag:
 * „Dateiname muss passen — man kann den Mietvertrag ja beliebig oft erstellen“). „Ansehen“ zeigt die Datei im
 * Browser, dessen Speichern-Knopf aber nur den Speicherpfad kennt; deshalb ein eigener Knopf. Liefert false bei Fehler.
 */
export async function dokumentHerunterladen(pfad: string, dateiname: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from("dokumente").download(pfad);
    if (error || !data) return false;
    const adresse = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = adresse;
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
    return true;
  } catch {
    return false;
  }
}
