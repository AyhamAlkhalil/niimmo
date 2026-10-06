/**
 * Zustand einer Mietpartei für die 3D-Ansicht: vermietet, gekündigt, Neuvermietung in Sicht
 * oder Leerstand — jeweils mit dem Vertrag, der beim Klick geöffnet wird.
 *
 * „Läuft der Vertrag?" beantwortet ausschließlich getLaufenderVertrag() (docs/architektur.md §2);
 * dieses Modul ordnet nur ein, was dabei herauskommt.
 */

import {
  alsIsoTag,
  getLaufenderVertrag,
  getVertragsende,
  istGekuendigt,
  sortUnitsByNumber,
  type VertragZeitraum,
} from "@/utils/contractUtils";

export type ParteiStatus = "vermietet" | "gekuendigt" | "kommend" | "leer";

export interface VertragFuerStatus extends VertragZeitraum {
  id: string;
  kaltmiete?: number | null;
  betriebskosten?: number | null;
}

export interface ParteiZustand<V extends VertragFuerStatus = VertragFuerStatus> {
  status: ParteiStatus;
  /** Laufender Vertrag, bei „kommend" der künftige. */
  vertrag: V | null;
  /** Vertrag für die Detailansicht: laufend, künftig oder zuletzt begonnen. */
  oeffnen: V | null;
  /** vermietet/gekündigt: Mietbeginn. leer/kommend: Ende des letzten Vertrags. */
  seit: string | null;
  /** Kündigungs- oder Befristungsende des laufenden Vertrags. */
  bis: string | null;
  /** Beginn des künftigen Vertrags. */
  ab: string | null;
}

const LAUFEND_ODER_GEKUENDIGT = new Set(["aktiv", "gekuendigt"]);

export function parteiZustand<V extends VertragFuerStatus>(vertraege: V[], stichtag: Date = new Date()): ParteiZustand<V> {
  const tag = alsIsoTag(stichtag);
  const laufend = getLaufenderVertrag(vertraege, stichtag);
  if (laufend) {
    const gekuendigt = laufend.status === "gekuendigt" || istGekuendigt(laufend);
    return {
      status: gekuendigt ? "gekuendigt" : "vermietet",
      vertrag: laufend,
      oeffnen: laufend,
      seit: laufend.start_datum ?? null,
      bis: getVertragsende(laufend),
      ab: null,
    };
  }

  const kommend =
    vertraege
      .filter((v) => LAUFEND_ODER_GEKUENDIGT.has(v.status ?? "") && !!v.start_datum && v.start_datum > tag)
      .sort((a, b) => (a.start_datum ?? "").localeCompare(b.start_datum ?? ""))[0] ?? null;
  const letztesEnde =
    vertraege
      .map((v) => getVertragsende(v))
      .filter((ende): ende is string => !!ende && ende < tag)
      .sort()
      .pop() ?? null;

  if (kommend) {
    return { status: "kommend", vertrag: kommend, oeffnen: kommend, seit: letztesEnde, bis: null, ab: kommend.start_datum ?? null };
  }
  const zuletzt = [...vertraege].sort((a, b) => (b.start_datum ?? "").localeCompare(a.start_datum ?? ""))[0] ?? null;
  return { status: "leer", vertrag: null, oeffnen: zuletzt, seit: letztesEnde, bis: null, ab: null };
}

export interface Kennzahlen {
  einheiten: number;
  vermietet: number;
  gekuendigt: number;
  kommend: number;
  leer: number;
  /** Summe der laufenden Kaltmieten. */
  kaltmiete: number;
  /** Kaltmiete plus Betriebskosten der laufenden Verträge. */
  warmmiete: number;
}

/** Ein fehlender oder unlesbarer Betrag zählt als 0, damit eine Summe nie NaN wird. */
const betrag = (wert: number | string | null | undefined): number => {
  const zahl = Number(wert ?? 0);
  return Number.isFinite(zahl) ? zahl : 0;
};

export function kennzahlen(zustaende: ParteiZustand[]): Kennzahlen {
  const k: Kennzahlen = { einheiten: zustaende.length, vermietet: 0, gekuendigt: 0, kommend: 0, leer: 0, kaltmiete: 0, warmmiete: 0 };
  for (const z of zustaende) {
    k[z.status] += 1;
    // Nur laufende Verträge tragen zur Miete bei; ein künftiger Vertrag ist noch kein Ertrag.
    if (z.status === "vermietet" || z.status === "gekuendigt") {
      const kalt = betrag(z.vertrag?.kaltmiete);
      k.kaltmiete += kalt;
      k.warmmiete += kalt + betrag(z.vertrag?.betriebskosten);
    }
  }
  return k;
}

/** Anteil der belegten Einheiten (vermietet oder gekündigt, aber noch laufend). */
export function vermietungsquote(k: Kennzahlen): number {
  return k.einheiten === 0 ? 0 : (k.vermietet + k.gekuendigt) / k.einheiten;
}

/**
 * „Einheit 3" wie auf den Karten der Objektansicht: Position nach sortUnitsByNumber() innerhalb
 * des Objekts (EinheitCard zählt genauso). So heißt eine Partei in beiden Ansichten gleich.
 */
export function einheitenNummern<E extends { id: string; immobilie_id: string | null }>(einheiten: E[]): Map<string, number> {
  const jeObjekt = new Map<string, E[]>();
  for (const e of einheiten) {
    const schluessel = e.immobilie_id ?? "";
    jeObjekt.set(schluessel, [...(jeObjekt.get(schluessel) ?? []), e]);
  }
  const nummern = new Map<string, number>();
  for (const liste of jeObjekt.values()) {
    sortUnitsByNumber([...liste]).forEach((e, i) => nummern.set(e.id, i + 1));
  }
  return nummern;
}
