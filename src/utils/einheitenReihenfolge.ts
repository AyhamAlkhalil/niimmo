import { sortUnitsByNumber } from "@/utils/contractUtils";

/**
 * Reihenfolge und Nummer der Einheiten eines Objekts, wie die Objektübersicht sie
 * zeigt („Einheit 1“, „Einheit 2“ …).
 *
 * Eine gepflegte Wohnungsnummer gibt es nicht: `einheiten.zaehler` und
 * `bezeichnung` sind bei allen Einheiten leer (Stand 23.10.2026). Die Nummer, die
 * die Nutzer kennen, ist die Position in dieser Reihenfolge. Bis zum 24.11.2026
 * sortierten Zählerliste und Hausmeister-Ansicht nach dem leeren Feld `zaehler` —
 * also in zufälliger Reihenfolge — und zeigten keine Nummer (Kundenmeldungen
 * 07.11. und 23.11.2026: „Sortierung der Einheiten bitte wie in der Objektübersicht“).
 */
export interface EinheitFuerReihenfolge {
  id: string;
  erstellt_am?: string | null;
}

/** Einheiten in der Reihenfolge der Objektübersicht; die Eingabe bleibt unverändert. */
export function einheitenInReihenfolge<T extends EinheitFuerReihenfolge>(einheiten: readonly T[]): T[] {
  return sortUnitsByNumber([...einheiten]) as T[];
}

/**
 * Nummer je Einheit (ab 1). Immer aus allen Einheiten des Objekts bilden, nie aus
 * einer gefilterten Liste — sonst wird aus „Einheit 12“ bei einer Suche „Einheit 1“.
 */
export function einheitenNummern(einheiten: readonly EinheitFuerReihenfolge[]): Map<string, number> {
  return new Map(einheitenInReihenfolge(einheiten).map((einheit, index) => [einheit.id, index + 1]));
}
