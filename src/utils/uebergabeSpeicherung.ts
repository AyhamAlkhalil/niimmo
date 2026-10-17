/**
 * Speichern eines Übergabeprotokolls — die Teile, die sich ohne Supabase prüfen lassen.
 *
 * Am 16.10.2026 blieb ein Einzugsprotokoll ungespeichert. Neben dem Dialog, der
 * beim Rausklicken alles verwarf, hätte auch das Speichern selbst nicht
 * funktioniert: Der PDF-Pfad enthielt den Mieternamen, und Supabase Storage
 * lehnt Pfade mit Umlauten ab (`InvalidKey`, am 17.10.2026 gegen den Live-Storage
 * geprüft). Bis dahin waren Zählerstände, Historie und Fotozeilen aber schon
 * geschrieben — ein zweiter Versuch legte Historie und Dokumente doppelt an.
 *
 * Deshalb: Pfade ohne Namen, nur erfasste Zählerstände schreiben, und jeder
 * Schritt so, dass ein Wiederholen nichts verdoppelt.
 */
import { format } from "date-fns";
import { parseZaehlerstand } from "./zaehlerstandUtils";

/**
 * Zeichen, die Supabase Storage in Objektpfaden annimmt (storage-api `isValidKey`).
 * `\w` meint dort nur ASCII — „ü" oder „é" machen den ganzen Upload ungültig.
 */
export const STORAGE_PFAD = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

/** Ablageort des Protokoll-PDFs: Datum und Uhrzeit statt Mieternamen (docs/architektur.md §6). */
export function uebergabePdfPfad(vertragId: string, isEinzug: boolean, jetzt: Date): string {
  const art = isEinzug ? "Einzug" : "Auszug";
  return `uebergabeprotokolle/${vertragId}/Uebergabeprotokoll_${art}_${format(jetzt, "yyyy-MM-dd")}_${format(jetzt, "HHmmss")}.pdf`;
}

/**
 * Dateiendung für einen Foto-Upload. Der Dateiname kommt vom Gerät; ohne Punkt
 * wäre der ganze Name die „Endung" und mit ihm jedes Sonderzeichen im Pfad.
 */
export function dateiendung(dateiname: string, mimeTyp: string): string {
  const ausName = dateiname.includes(".") ? (dateiname.split(".").pop() ?? "").toLowerCase() : "";
  if (/^[a-z0-9]{1,5}$/.test(ausName)) return ausName;
  const ausTyp = (mimeTyp.split(";")[0].split("/")[1] ?? "").trim().toLowerCase().replace(/^jpeg$/, "jpg");
  if (/^[a-z0-9]{1,5}$/.test(ausTyp)) return ausTyp;
  return "jpg";
}

export interface ZaehlerEingaben {
  strom: string;
  gas: string;
  wasser: string;
  warmwasser: string;
}

export const LEERE_ZAEHLER: ZaehlerEingaben = { strom: "", gas: "", wasser: "", warmwasser: "" };

type StandSpalte =
  | "strom_einzug" | "gas_einzug" | "kaltwasser_einzug" | "warmwasser_einzug"
  | "strom_auszug" | "gas_auszug" | "kaltwasser_auszug" | "warmwasser_auszug";

/**
 * Zählerstände für die Vertragszeile — nur erfasste Werte. Ein leeres Feld lässt
 * einen vorhandenen Stand stehen, statt ihn mit null zu überschreiben.
 */
export function vertragsStaende(z: ZaehlerEingaben, isEinzug: boolean): Partial<Record<StandSpalte, number>> {
  const s = isEinzug ? "einzug" : "auszug";
  const paare: Array<[StandSpalte, string]> = [
    [`strom_${s}` as StandSpalte, z.strom],
    [`gas_${s}` as StandSpalte, z.gas],
    [`kaltwasser_${s}` as StandSpalte, z.wasser],
    [`warmwasser_${s}` as StandSpalte, z.warmwasser],
  ];
  const ergebnis: Partial<Record<StandSpalte, number>> = {};
  for (const [spalte, eingabe] of paare) {
    const wert = parseZaehlerstand(eingabe);
    if (wert !== null) ergebnis[spalte] = wert;
  }
  return ergebnis;
}

export type HistorieZaehlerTyp = "strom" | "gas" | "kaltwasser" | "warmwasser";

export interface HistorieEintrag {
  einheit_id: string;
  immobilie_id: string | null;
  zaehler_typ: HistorieZaehlerTyp;
  stand: number;
  datum: string;
  quelle: string;
  erstellt_von: string | null;
}

export function historieEintraege(
  einheitId: string,
  immobilieId: string | null,
  z: ZaehlerEingaben,
  datum: string,
  quelle: string,
  erstelltVon: string | null
): HistorieEintrag[] {
  const paare: Array<[HistorieZaehlerTyp, string]> = [
    ["strom", z.strom],
    ["gas", z.gas],
    ["kaltwasser", z.wasser],
    ["warmwasser", z.warmwasser],
  ];
  return paare.flatMap(([zaehler_typ, eingabe]) => {
    const stand = parseZaehlerstand(eingabe);
    return stand === null
      ? []
      : [{ einheit_id: einheitId, immobilie_id: immobilieId, zaehler_typ, stand, datum, quelle, erstellt_von: erstelltVon }];
  });
}

/**
 * Je Einheit, Zähler, Tag und Übergabeart gibt es genau eine Ablesung. Was es
 * schon gibt — aus einem abgebrochenen Lauf oder einer Korrektur am selben Tag —,
 * wird aktualisiert statt ein zweites Mal eingetragen.
 */
export function historieAufteilen(
  neu: HistorieEintrag[],
  vorhanden: Array<{ einheit_id: string; zaehler_typ: string }>
): { einfuegen: HistorieEintrag[]; aktualisieren: HistorieEintrag[] } {
  const bekannt = new Set(vorhanden.map((v) => `${v.einheit_id}|${v.zaehler_typ}`));
  const einfuegen: HistorieEintrag[] = [];
  const aktualisieren: HistorieEintrag[] = [];
  for (const eintrag of neu) {
    (bekannt.has(`${eintrag.einheit_id}|${eintrag.zaehler_typ}`) ? aktualisieren : einfuegen).push(eintrag);
  }
  return { einfuegen, aktualisieren };
}

/** Dokumentzeilen, deren Pfad am selben Vertrag noch nicht eingetragen ist. */
export function fehlendeDokumente<T extends { pfad: string; mietvertrag_id: string | null }>(
  geplant: T[],
  vorhanden: Array<{ pfad: string; mietvertrag_id: string | null }>
): T[] {
  const bekannt = new Set(vorhanden.map((v) => `${v.mietvertrag_id}|${v.pfad}`));
  const gesehen = new Set<string>();
  return geplant.filter((d) => {
    const schluessel = `${d.mietvertrag_id}|${d.pfad}`;
    if (bekannt.has(schluessel) || gesehen.has(schluessel)) return false;
    gesehen.add(schluessel);
    return true;
  });
}

export interface HochladeErgebnis {
  /** Pfade der Fotos, die angekommen sind — in der Reihenfolge der Auswahl */
  pfade: string[];
  fehlgeschlagen: number;
}

/**
 * Lädt Fotos einzeln hoch, jedes mit einem zweiten Versuch nach kurzer Pause.
 * Bis zum 17.10.2026 brach der erste Fehler die ganze Auswahl ab: Bei
 * schwachem Netz (Keller, Zählerraum) fielen damit auch die schon
 * hochgeladenen Fotos derselben Auswahl aus dem Protokoll. Der Pfad bleibt je
 * Datei derselbe, ein Wiederholen überschreibt also höchstens die eigene Datei.
 */
export async function dateienHochladen(
  dateien: ArrayLike<File>,
  pfadFuer: (datei: File, index: number) => string,
  hochladen: (pfad: string, datei: File) => PromiseLike<{ error: unknown }>,
  fortschritt?: (fertig: number, gesamt: number) => void,
  pauseMs = 1000
): Promise<HochladeErgebnis> {
  const pfade: string[] = [];
  let fehlgeschlagen = 0;
  for (let i = 0; i < dateien.length; i++) {
    const datei = dateien[i];
    const pfad = pfadFuer(datei, i);
    let angekommen = false;
    for (let versuch = 0; versuch < 2 && !angekommen; versuch++) {
      if (versuch > 0) await new Promise((r) => setTimeout(r, pauseMs));
      try {
        const { error } = await hochladen(pfad, datei);
        angekommen = !error;
      } catch {
        angekommen = false;
      }
    }
    if (angekommen) pfade.push(pfad);
    else fehlgeschlagen++;
    fortschritt?.(i + 1, dateien.length);
  }
  return { pfade, fehlgeschlagen };
}
