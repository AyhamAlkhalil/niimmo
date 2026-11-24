/**
 * Die schwebenden Knöpfe unten rechts (Kamera-Knopf zum Melden, Aufgaben-Board)
 * liegen außerhalb jedes Fensters. Ein offener Dialog wertet einen Klick darauf
 * als Klick nach draußen und schließt sich -- samt allem, was im Fenster schon
 * eingetragen war. Bis zum 24.11.2026 war der Knopf bei offenem Fenster zudem gar
 * nicht klickbar (Kundenmeldung 23.11.2026: „weder einen Screenshot machen noch
 * eine Task eröffnen“).
 */

/** Kennzeichen am Behälter der schwebenden Knöpfe. */
export const SCHWEBENDE_KNOEPFE_ATTRIBUT = "data-schwebende-knoepfe";

/** Liegt das Ziel eines Klicks in den schwebenden Knöpfen? */
export function klickAufSchwebendeKnoepfe(ziel: EventTarget | null): boolean {
  const element = ziel as { closest?: (selektor: string) => unknown } | null;
  if (!element || typeof element.closest !== "function") return false;
  return element.closest(`[${SCHWEBENDE_KNOEPFE_ATTRIBUT}]`) != null;
}

/**
 * Für `onPointerDownOutside` der Fenster-Bausteine: Ein Klick auf die
 * schwebenden Knöpfe schließt das Fenster nicht.
 */
export function schwebendeKnoepfeDurchlassen(ereignis: { target: EventTarget | null; preventDefault: () => void }): void {
  if (klickAufSchwebendeKnoepfe(ereignis.target)) ereignis.preventDefault();
}
