/**
 * Zustand einer Mietpartei für die 3D-Ansicht: vermietet, gekündigt, Neuvermietung in Sicht
 * oder Leerstand — mit dem Vertrag, der beim Klick geöffnet wird (bei Leerstand keiner; dann
 * zeigt die Ansicht den Verlauf der Einheit).
 *
 * „Läuft der Vertrag?" beantwortet ausschließlich getLaufenderVertrag() (docs/architektur.md §2);
 * dieses Modul ordnet nur ein, was dabei herauskommt.
 */

import {
  alsIsoTag,
  getLaufenderVertrag,
  istGekuendigt,
  type VertragZeitraum,
} from "@/utils/contractUtils";

export type ParteiStatus = "vermietet" | "gekuendigt" | "kommend" | "leer";

export interface VertragFuerStatus extends VertragZeitraum {
  id: string;
}

export interface ParteiZustand<V extends VertragFuerStatus = VertragFuerStatus> {
  status: ParteiStatus;
  /** Laufender Vertrag, bei „kommend" der künftige, bei Leerstand keiner. */
  vertrag: V | null;
}

const LAUFEND_ODER_GEKUENDIGT = new Set(["aktiv", "gekuendigt"]);

export function parteiZustand<V extends VertragFuerStatus>(vertraege: V[], stichtag: Date = new Date()): ParteiZustand<V> {
  const laufend = getLaufenderVertrag(vertraege, stichtag);
  if (laufend) {
    const gekuendigt = laufend.status === "gekuendigt" || istGekuendigt(laufend);
    return { status: gekuendigt ? "gekuendigt" : "vermietet", vertrag: laufend };
  }

  const tag = alsIsoTag(stichtag);
  const kommend =
    vertraege
      .filter((v) => LAUFEND_ODER_GEKUENDIGT.has(v.status ?? "") && !!v.start_datum && v.start_datum > tag)
      .sort((a, b) => (a.start_datum ?? "").localeCompare(b.start_datum ?? ""))[0] ?? null;
  if (kommend) return { status: "kommend", vertrag: kommend };
  return { status: "leer", vertrag: null };
}
