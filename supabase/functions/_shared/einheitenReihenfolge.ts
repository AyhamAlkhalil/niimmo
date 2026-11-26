/**
 * Reihenfolge und Nummer der Einheiten eines Objekts, wie die Objektübersicht sie zeigt („Einheit 1“, „Einheit 2“ …).
 * Liegt seit dem 26.11.2026 hier, damit App und MCP-Server (Edge Function mcp) dieselbe Nummer nennen.
 *
 * Eine gepflegte Wohnungsnummer gibt es nicht: `einheiten.zaehler` und `bezeichnung` sind bei allen Einheiten leer
 * (Stand 23.10.2026). Die Nummer, die die Nutzer kennen, ist die Position in dieser Reihenfolge: Ziffern der letzten
 * zwei Zeichen der ID (bzw. `nummer`, falls vorhanden), dann Anlagedatum, dann ID — die Regel, nach der die
 * Objektübersicht schon vorher sortierte (früher sortUnitsByNumber in src/utils/contractUtils.ts). Bis zum
 * 24.11.2026 sortierten Zählerliste und Hausmeister-Ansicht nach dem leeren Feld `zaehler`, also zufällig.
 */
export interface EinheitFuerReihenfolge {
  id: string;
  erstellt_am?: string | null;
  nummer?: string | number | null;
}

const ziffern = (wert: string | number | null | undefined): number | null => {
  if (wert === null || wert === undefined) return null;
  const treffer = String(wert).match(/\d+/g);
  return treffer && treffer.length > 0 ? parseInt(treffer.join(''), 10) : null;
};

// Ein unlesbares Datum zählt wie keins; NaN im Vergleich machte die Reihenfolge von der Eingabe abhängig (QA 24.11.2026)
const zeit = (datum: string | null | undefined): number => {
  const ms = datum ? new Date(datum).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

/** Vergleich zweier Einheiten in der Reihenfolge der Objektübersicht */
export function vergleicheEinheiten(a: EinheitFuerReihenfolge, b: EinheitFuerReihenfolge): number {
  const aNum = ziffern(a.nummer ?? (a.id ? a.id.slice(-2) : undefined));
  const bNum = ziffern(b.nummer ?? (b.id ? b.id.slice(-2) : undefined));
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum !== null && bNum === null) return -1;
  if (aNum === null && bNum !== null) return 1;
  const zeitA = zeit(a.erstellt_am);
  const zeitB = zeit(b.erstellt_am);
  if (zeitA !== zeitB) return zeitA - zeitB;
  return (a.id || '').localeCompare(b.id || '');
}

/** Einheiten in der Reihenfolge der Objektübersicht; die Eingabe bleibt unverändert. */
export function einheitenInReihenfolge<T extends EinheitFuerReihenfolge>(einheiten: readonly T[]): T[] {
  return [...einheiten].sort(vergleicheEinheiten);
}

/**
 * Nummer je Einheit (ab 1). Immer aus allen Einheiten des Objekts bilden, nie aus einer gefilterten Liste — sonst
 * wird aus „Einheit 12“ bei einer Suche „Einheit 1“.
 */
export function einheitenNummern(einheiten: readonly EinheitFuerReihenfolge[]): Map<string, number> {
  return new Map(einheitenInReihenfolge(einheiten).map((einheit, index) => [einheit.id, index + 1]));
}

/**
 * Trifft eine Suche die angezeigte Nummer? „12“ oder „Einheit 12“ findet genau Einheit 12 — nicht Einheit 1 oder
 * 112, und „ein“ findet nicht jede Einheit (Review 24.11.2026).
 */
export function sucheTrifftEinheitNummer(suche: string, nummer: number | undefined): boolean {
  if (nummer === undefined) return false;
  const treffer = suche.trim().toLowerCase().match(/^(?:einheit\s*)?(\d+)$/);
  return !!treffer && Number(treffer[1]) === nummer;
}
