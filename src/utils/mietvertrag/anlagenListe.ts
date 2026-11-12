/**
 * Liste der weiteren Anlagen im Generator (12.11.2026) — ohne pdf-lib, damit die Bibliothek erst beim Speichern
 * geladen wird (`pdfAnlagen.ts`).
 */

/** Ein Eintrag eine Stelle nach oben (-1) oder unten (+1); am Rand bleibt die Liste, wie sie ist. */
export function verschiebe<T>(liste: readonly T[], index: number, richtung: -1 | 1): T[] {
  const ziel = index + richtung;
  if (index < 0 || index >= liste.length || ziel < 0 || ziel >= liste.length) return [...liste];
  const neu = [...liste];
  [neu[index], neu[ziel]] = [neu[ziel], neu[index]];
  return neu;
}

/** „Grundriss.pdf“ → „Grundriss“ für den Titel der Anlage. */
export function anlagenName(dateiname: string): string {
  return dateiname.replace(/\.pdf$/i, '').trim() || 'Anlage';
}
