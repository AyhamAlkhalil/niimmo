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

/**
 * „Vorname Nachname“ eines Mieters ohne „null“ oder doppelte Leerzeichen; die Spalten dürfen leer
 * sein. Bis zum 27.10.2026 stand bei fehlendem Nachnamen „null“ in Übergabeprotokoll und Mails.
 */
export function mieterName(m: { vorname?: string | null; nachname?: string | null }): string {
  return [m.vorname, m.nachname].map((t) => (t ?? '').trim()).filter(Boolean).join(' ');
}
