/**
 * Namensdarstellung interner Personen.
 *
 * Bewusst ein eigenes Modul ohne Laufzeit-Abhängigkeiten: In `useAppBenutzer`
 * hing daran über den Supabase-Client der `localStorage`, den es außerhalb des
 * Browsers nicht gibt — schon ein Import hätte dort abgebrochen.
 */

/** Kurzform für Listen: „Ayham Alkhalil" wird zu „Ayham A." */
export function kurzName(benutzer: { anzeigename: string }): string {
  const teile = benutzer.anzeigename.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "";
  if (teile.length === 1) return teile[0];
  return `${teile[0]} ${teile[teile.length - 1].charAt(0)}.`;
}
