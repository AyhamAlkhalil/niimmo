/**
 * Welche Zähler ein Objekt hat — am Hausanschluss und in den Einheiten.
 *
 * Kundenmeldungen 07.11.2026 („im Obj 11 Gehrden haben wir zwei Wasserzähler, keinen zentralen
 * Gaszähler … selbst auswählen … bei den Stammdaten des Objektes“) und 23.11.2026 („dass ich
 * auswählen kann, welche Sachen ich hier stehen haben will … keinen Warmwasserzähler“).
 *
 * Bis zum 24.11.2026 schaltete `hat_<art>` den Hausanschluss und die Spalten der Einheiten
 * zugleich, und „Wasser“ nahm Kalt- und Warmwasser nur gemeinsam weg. Seither (Migration
 * 20261124100000):
 * - `hat_wasser` / `hat_strom` / `hat_gas`: nur der Hausanschluss.
 * - `hausanschluss_zweiter_zaehler`: Hausanschlüsse mit zweitem Zähler (Felder `allgemein_<art>_*_2`).
 * - `zaehlerarten_einheiten`: die Zählerarten der Einheiten.
 *
 * Fehlen die Spalten in einer Abfrage, gilt das alte Verhalten: alle Arten, kein zweiter Zähler.
 */

export const EINHEIT_ZAEHLERARTEN = ["kaltwasser", "warmwasser", "strom", "gas"] as const;
export type EinheitZaehlerart = (typeof EINHEIT_ZAEHLERARTEN)[number];

export const HAUSANSCHLUSS_ZAEHLERARTEN = ["wasser", "strom", "gas"] as const;
export type HausanschlussZaehlerart = (typeof HAUSANSCHLUSS_ZAEHLERARTEN)[number];

export const ZAEHLERART_BEZEICHNUNG: Record<EinheitZaehlerart | HausanschlussZaehlerart, string> = {
  kaltwasser: "Kaltwasser",
  warmwasser: "Warmwasser",
  wasser: "Wasser",
  strom: "Strom",
  gas: "Gas",
};

export interface ObjektZaehlerKonfiguration {
  hat_wasser?: boolean | null;
  hat_strom?: boolean | null;
  hat_gas?: boolean | null;
  zaehlerarten_einheiten?: readonly string[] | null;
  hausanschluss_zweiter_zaehler?: readonly string[] | null;
}

/** Zählerarten der Einheiten in fester Reihenfolge (KW, WW, Strom, Gas). */
export function einheitZaehlerarten(objekt: ObjektZaehlerKonfiguration | null | undefined): EinheitZaehlerart[] {
  const liste = objekt?.zaehlerarten_einheiten;
  if (!Array.isArray(liste)) return [...EINHEIT_ZAEHLERARTEN];
  return EINHEIT_ZAEHLERARTEN.filter((art) => liste.includes(art));
}

/** Hausanschlüsse mit (erstem) Zähler. */
export function hausanschlussZaehlerarten(objekt: ObjektZaehlerKonfiguration | null | undefined): HausanschlussZaehlerart[] {
  return HAUSANSCHLUSS_ZAEHLERARTEN.filter((art) => objekt?.[`hat_${art}`] !== false);
}

/** Hausanschlüsse mit zweitem Zähler — nur, wo auch der erste vorhanden ist. */
export function hausanschlussZweiterZaehler(
  objekt: ObjektZaehlerKonfiguration | null | undefined
): HausanschlussZaehlerart[] {
  const liste = objekt?.hausanschluss_zweiter_zaehler;
  if (!Array.isArray(liste)) return [];
  return hausanschlussZaehlerarten(objekt).filter((art) => liste.includes(art));
}

/** Liste nach dem Umschalten einer Art, in der festen Reihenfolge von `alle`. */
export function artUmschalten<T extends string>(
  alle: readonly T[],
  liste: readonly string[] | null | undefined,
  art: T,
  an: boolean
): T[] {
  const vorher = new Set(Array.isArray(liste) ? liste : alle);
  if (an) vorher.add(art);
  else vorher.delete(art);
  return alle.filter((eintrag) => vorher.has(eintrag));
}

/**
 * Zählerarten für die Karte „Zählerstände & Verbrauch“ eines Vertrags: die des Objekts, dazu
 * jede Art, für die der Vertrag schon einen Ein- oder Auszugsstand hat — erfasste Stände sollen
 * nicht verschwinden, nur weil die Art später abgewählt wurde.
 */
export function vertragZaehlerarten(
  objekt: ObjektZaehlerKonfiguration | null | undefined,
  vertrag: Partial<Record<`${EinheitZaehlerart}_${"einzug" | "auszug"}`, unknown>> | null | undefined
): EinheitZaehlerart[] {
  const gewaehlt = new Set(einheitZaehlerarten(objekt));
  const belegt = (wert: unknown) => wert !== null && wert !== undefined && wert !== "";
  return EINHEIT_ZAEHLERARTEN.filter(
    (art) => gewaehlt.has(art) || belegt(vertrag?.[`${art}_einzug`]) || belegt(vertrag?.[`${art}_auszug`])
  );
}

/**
 * Versorger, die das Objekt braucht: für jeden Hausanschluss und für jede Zählerart der Einheiten
 * (Kalt- und Warmwasser gehören zum Wasserversorger). Ohne zentralen Gaszähler bleibt der
 * Gasversorger so sichtbar, solange die Wohnungen eigene Gaszähler haben.
 */
export function versorgerArten(objekt: ObjektZaehlerKonfiguration | null | undefined): HausanschlussZaehlerart[] {
  const hausanschluss = new Set<string>(hausanschlussZaehlerarten(objekt));
  const einheiten = einheitZaehlerarten(objekt).map((art) => (art === "kaltwasser" || art === "warmwasser" ? "wasser" : art));
  return HAUSANSCHLUSS_ZAEHLERARTEN.filter((art) => hausanschluss.has(art) || einheiten.includes(art));
}
