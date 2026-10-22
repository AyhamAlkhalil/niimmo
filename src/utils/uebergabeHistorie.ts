/**
 * Übergaben in der Historie einer Einheit: welche Ablesungen zu welchem Vertrag
 * gehören, gruppiert nach Ein- und Auszug.
 *
 * Seit 22.10.2026 trägt jede Übergabe-Ablesung ihren Vertrag
 * (zaehlerstand_historie.mietvertrag_id). Ältere Einträge ohne diese Angabe
 * werden über das Datum zugeordnet: ein Einzug zum Vertrag, der um diesen Tag
 * beginnt, ein Auszug zum Vertrag, der um diesen Tag endet.
 */

export interface UebergabeAblesung {
  id: string;
  zaehler_typ: string;
  stand: number | null;
  datum: string;
  quelle: string | null;
  mietvertrag_id: string | null;
  protokoll_pfad: string | null;
  foto_pfad: string | null;
  erfassung: string | null;
  zaehler_nummer: string | null;
}

export interface VertragZeitraum {
  id: string;
  /** yyyy-MM-dd */
  start: string | null;
  /** yyyy-MM-dd — Vertragsende nach getVertragsende() */
  ende: string | null;
}

export type UebergabeArt = "einzug" | "auszug";

export interface UebergabeEreignis {
  art: UebergabeArt;
  datum: string;
  ablesungen: UebergabeAblesung[];
  protokollPfad: string | null;
}

/** Feste Reihenfolge der Zähler innerhalb einer Übergabe, wie im Protokoll */
const ZAEHLER_REIHENFOLGE = ["strom", "gas", "kaltwasser", "warmwasser"];

/** Ein Übergabetermin liegt selten genau auf Vertragsbeginn oder -ende. */
const TOLERANZ_TAGE = 45;

export function uebergabeArt(quelle: string | null): UebergabeArt | null {
  if (quelle === "Übergabe (Einzug)") return "einzug";
  if (quelle === "Übergabe (Auszug)") return "auszug";
  return null;
}

const tage = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Liegen zwei Verträge gleich nah, wird nicht geraten — der Eintrag bleibt ohne Zuordnung. */
function vertragNachDatum(art: UebergabeArt, datum: string, vertraege: VertragZeitraum[]): string | null {
  let bester: { id: string; abstand: number } | null = null;
  let gleichstand = false;
  for (const v of vertraege) {
    const bezug = art === "einzug" ? v.start : v.ende;
    if (!bezug) continue;
    const abstand = tage(bezug, datum);
    if (Number.isNaN(abstand) || abstand > TOLERANZ_TAGE) continue;
    if (!bester || abstand < bester.abstand) {
      bester = { id: v.id, abstand };
      gleichstand = false;
    } else if (abstand === bester.abstand && v.id !== bester.id) {
      gleichstand = true;
    }
  }
  return bester && !gleichstand ? bester.id : null;
}

/**
 * Je Vertrag die Übergaben (älteste zuerst). Ablesungen, die sich keinem
 * Vertrag zuordnen lassen, landen unter dem Schlüssel `null`.
 */
export function uebergabenJeVertrag(
  vertraege: VertragZeitraum[],
  ablesungen: UebergabeAblesung[]
): Map<string | null, UebergabeEreignis[]> {
  const gruppen = new Map<string, { vertrag: string | null; ereignis: UebergabeEreignis }>();
  for (const a of ablesungen) {
    const art = uebergabeArt(a.quelle);
    if (!art) continue;
    const vertrag = a.mietvertrag_id ?? vertragNachDatum(art, a.datum, vertraege);
    const schluessel = `${vertrag ?? "-"}|${art}|${a.datum}`;
    let g = gruppen.get(schluessel);
    if (!g) {
      g = { vertrag, ereignis: { art, datum: a.datum, ablesungen: [], protokollPfad: null } };
      gruppen.set(schluessel, g);
    }
    g.ereignis.ablesungen.push(a);
    if (!g.ereignis.protokollPfad && a.protokoll_pfad) g.ereignis.protokollPfad = a.protokoll_pfad;
  }
  const ergebnis = new Map<string | null, UebergabeEreignis[]>();
  for (const { vertrag, ereignis } of gruppen.values()) {
    const liste = ergebnis.get(vertrag) ?? [];
    liste.push(ereignis);
    ergebnis.set(vertrag, liste);
  }
  const reihenfolge = (e: UebergabeEreignis) => `${e.datum}|${e.art === "einzug" ? 0 : 1}`;
  const zaehlerRang = (typ: string) => {
    const i = ZAEHLER_REIHENFOLGE.indexOf(typ);
    return i === -1 ? ZAEHLER_REIHENFOLGE.length : i;
  };
  for (const liste of ergebnis.values()) {
    // Schlichter Zeichenvergleich: yyyy-MM-dd sortiert so richtig, und anders als
    // localeCompare hängt das Ergebnis nicht an der Spracheinstellung
    liste.sort((x, y) => (reihenfolge(x) < reihenfolge(y) ? -1 : reihenfolge(x) > reihenfolge(y) ? 1 : 0));
    for (const e of liste) e.ablesungen.sort((x, y) => zaehlerRang(x.zaehler_typ) - zaehlerRang(y.zaehler_typ));
  }
  return ergebnis;
}
