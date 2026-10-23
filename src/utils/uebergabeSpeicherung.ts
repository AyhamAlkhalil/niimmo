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
import { parseZaehlerstand } from "./zaehlerstandUtils";
import { schriftstueckPfad } from "./storagePfad";

/** Ablageort des Protokoll-PDFs: Datum und Uhrzeit statt Mieternamen (utils/storagePfad.ts). */
export function uebergabePdfPfad(vertragId: string, isEinzug: boolean, jetzt: Date): string {
  return schriftstueckPfad("uebergabeprotokolle", vertragId, `Uebergabeprotokoll_${isEinzug ? "Einzug" : "Auszug"}`, jetzt);
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

/** Wie ein Stand entstand — Spalte zaehlerstand_historie.erfassung (Prüfregel in der Datenbank) */
export type Erfassung = "hand" | "foto" | "foto_korrigiert";

export interface HistorieEintrag {
  einheit_id: string;
  immobilie_id: string | null;
  zaehler_typ: HistorieZaehlerTyp;
  stand: number;
  datum: string;
  quelle: string;
  erstellt_von: string | null;
  // Herkunft (seit 22.10.2026, setzt nur die Übergabe)
  mietvertrag_id?: string | null;
  zaehler_nummer?: string | null;
  protokoll_pfad?: string | null;
  foto_pfad?: string | null;
  erfassung?: Erfassung | null;
  erkannter_stand?: number | null;
}

/**
 * Woher eine Übergabe-Ablesung kommt. Bis zum 22.10.2026 stand in der Historie
 * nur die Quelle — welcher Vertrag, welches Protokoll, welches Foto, ließ sich
 * nicht mehr feststellen, und ohne Zählernummer rechnete die Verbrauchsspalte nicht.
 */
export interface HistorieHerkunft {
  mietvertragId: string | null;
  protokollPfad: string | null;
  /** je Zähler, Schlüssel wie im Formular (wasser = Kaltwasser) */
  je?: Partial<Record<keyof ZaehlerEingaben, { nummer?: string | null; foto?: string | null; erfassung?: Erfassung; erkannt?: number | null }>>;
}

const HISTORIE_TYP: Array<[keyof ZaehlerEingaben, HistorieZaehlerTyp]> = [
  ["strom", "strom"],
  ["gas", "gas"],
  ["wasser", "kaltwasser"],
  ["warmwasser", "warmwasser"],
];

const textOderNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function historieEintraege(
  einheitId: string,
  immobilieId: string | null,
  z: ZaehlerEingaben,
  datum: string,
  quelle: string,
  erstelltVon: string | null,
  herkunft?: HistorieHerkunft
): HistorieEintrag[] {
  return HISTORIE_TYP.flatMap(([feld, zaehler_typ]) => {
    const stand = parseZaehlerstand(z[feld]);
    if (stand === null) return [];
    const eintrag: HistorieEintrag = { einheit_id: einheitId, immobilie_id: immobilieId, zaehler_typ, stand, datum, quelle, erstellt_von: erstelltVon };
    if (herkunft) {
      const je = herkunft.je?.[feld];
      eintrag.mietvertrag_id = herkunft.mietvertragId;
      eintrag.protokoll_pfad = herkunft.protokollPfad;
      eintrag.zaehler_nummer = textOderNull(je?.nummer);
      eintrag.foto_pfad = textOderNull(je?.foto);
      eintrag.erfassung = je?.erfassung ?? "hand";
      eintrag.erkannter_stand = je?.erkannt ?? null;
    }
    return [eintrag];
  });
}

/**
 * Was ein Speicherlauf geschrieben hat — damit ein zweiter Versuch mit anderen
 * Eingaben (anderes Datum, geleerter Zähler) die Reste des ersten zurücknimmt.
 * Ohne das blieben nach einem Abbruch Historienzeilen mit dem alten Datum und
 * Stände am Vertrag stehen, die im gespeicherten Protokoll gar nicht vorkommen.
 * Zurückgenommen wird nur, wo noch der eigene Wert steht.
 */
export interface Rueckbau {
  /** von diesem Dialog eingefügte Zeilen in zaehlerstand_historie */
  historieIds: string[];
  /**
   * Geänderte Spalten mit dem Wert davor. `neu` ist zugleich die Bedingung:
   * Zurückgesetzt wird nur, wo noch genau diese Werte stehen. Bei einer schon
   * vorhandenen Historienzeile ist das der Protokollpfad dieses Laufs.
   */
  zeilen: Array<{
    tabelle: "mietvertrag" | "einheiten" | "zaehlerstand_historie";
    id: string;
    neu: Record<string, number | string>;
    vorher: Record<string, unknown>;
  }>;
  /**
   * Protokoll-PDF dieses Laufs (seit 23.10.2026). Es wird mit entfernt, und
   * eingefügte Historienzeilen werden nur gelöscht, solange sie noch darauf
   * verweisen — hat ein zweites Gerät sie inzwischen übernommen, bleiben sie.
   */
  pdfPfad?: string | null;
}

/** Schlichte Datensatz-ID (UUID oder Kurzform), nichts, was sich als Filter lesen ließe */
const ID = /^[\w-]{1,64}$/;
const RUECKBAU_TABELLEN = ["mietvertrag", "einheiten", "zaehlerstand_historie"] as const;
/** Nur die Spalten, die das Speichern der Übergabe schreibt — ein veränderter Entwurf kann sonst beliebige setzen */
const ZAEHLER_SPALTEN = ["strom", "gas", "kaltwasser", "warmwasser"];
const RUECKBAU_SPALTEN: Record<(typeof RUECKBAU_TABELLEN)[number], string[]> = {
  mietvertrag: ZAEHLER_SPALTEN.flatMap((t) => [`${t}_einzug`, `${t}_auszug`]),
  einheiten: ZAEHLER_SPALTEN.flatMap((t) => [`${t}_stand_aktuell`, `${t}_stand_datum`]),
  zaehlerstand_historie: ["stand", "mietvertrag_id", "zaehler_nummer", "protokoll_pfad", "foto_pfad", "erfassung", "erkannter_stand"],
};
/** Genau ein PDF im Protokollordner eines Vertrags, wie es uebergabePdfPfad erzeugt (kein .., kein %) */
const PROTOKOLL_PFAD = /^uebergabeprotokolle\/[0-9a-f-]{36}\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.pdf$/i;
const einfacherWert = (v: unknown) =>
  v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean";
const flach = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every(einfacherWert);

/**
 * Liest einen im Entwurf gemerkten Rückbau. Ein abgebrochenes Speichern, das sich
 * nicht sofort zurücknehmen ließ (kein Netz), wird so beim nächsten Öffnen
 * nachgeholt — bis zum 23.10.2026 lag der Rückbau nur im Speicher des Dialogs
 * und ging mit dem Schließen verloren. Was nicht in Form ist, ergibt null.
 */
export function rueckbauLesen(roh: unknown): Rueckbau | null {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return null;
  const r = roh as Record<string, unknown>;
  if (!Array.isArray(r.historieIds) || !r.historieIds.every((id) => typeof id === "string" && ID.test(id))) return null;
  if (!Array.isArray(r.zeilen)) return null;
  const zeilen: Rueckbau["zeilen"] = [];
  for (const z of r.zeilen) {
    const zeile = z as Record<string, unknown>;
    if (!zeile || typeof zeile !== "object") return null;
    if (!RUECKBAU_TABELLEN.includes(zeile.tabelle as (typeof RUECKBAU_TABELLEN)[number])) return null;
    if (typeof zeile.id !== "string" || !ID.test(zeile.id)) return null;
    if (!flach(zeile.neu) || !flach(zeile.vorher)) return null;
    const erlaubt = RUECKBAU_SPALTEN[zeile.tabelle as (typeof RUECKBAU_TABELLEN)[number]];
    if (![...Object.keys(zeile.neu), ...Object.keys(zeile.vorher)].every((spalte) => erlaubt.includes(spalte))) return null;
    if (!Object.values(zeile.neu).every((v) => typeof v === "string" || typeof v === "number")) return null;
    if (Object.keys(zeile.neu).length === 0) return null;
    zeilen.push({
      tabelle: zeile.tabelle as Rueckbau["zeilen"][number]["tabelle"],
      id: zeile.id,
      neu: zeile.neu as Record<string, number | string>,
      vorher: zeile.vorher,
    });
  }
  // Ein vorhandener, aber fremder Pfad verwirft alles: Ohne ihn liefe das Löschen
  // der Historie ohne die Bedingung „verweist noch auf dieses Protokoll“
  if (r.pdfPfad !== undefined && r.pdfPfad !== null && !(typeof r.pdfPfad === "string" && PROTOKOLL_PFAD.test(r.pdfPfad) && !r.pdfPfad.includes(".."))) {
    return null;
  }
  const pdfPfad = typeof r.pdfPfad === "string" ? r.pdfPfad : null;
  if (r.historieIds.length === 0 && zeilen.length === 0 && !pdfPfad) return null;
  return { historieIds: r.historieIds as string[], zeilen, pdfPfad };
}

export interface AktuellerStand {
  /** Spalten der Tabelle einheiten, z. B. kaltwasser_stand_aktuell / kaltwasser_stand_datum */
  standSpalte: string;
  datumSpalte: string;
  stand: number;
}

/**
 * Der „aktuelle Stand" der Einheit (Zählerverwaltung) aus den erfassten Werten.
 * Geschrieben wird er nur, wenn das Übergabedatum nicht älter ist als der dort
 * hinterlegte Stand — das prüft der Aufrufer im Filter des Updates. Bis zum
 * 22.10.2026 zog die Übergabe ihn nie nach; er war bei allen Einheiten leer.
 */
export function aktuelleStaende(z: ZaehlerEingaben): AktuellerStand[] {
  return HISTORIE_TYP.flatMap(([feld, typ]) => {
    const stand = parseZaehlerstand(z[feld]);
    return stand === null ? [] : [{ standSpalte: `${typ}_stand_aktuell`, datumSpalte: `${typ}_stand_datum`, stand }];
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

/** Höchstdauer eines Upload-Versuchs: ein 8-MB-Foto über langsames Mobilnetz braucht gut eine Minute. */
export const UPLOAD_ZEITLIMIT_MS = 120_000;

/**
 * Lädt Fotos einzeln hoch, jedes mit einem zweiten Versuch nach kurzer Pause.
 * Bis zum 17.10.2026 brach der erste Fehler die ganze Auswahl ab: Bei
 * schwachem Netz (Keller, Zählerraum) fielen damit auch die schon
 * hochgeladenen Fotos derselben Auswahl aus dem Protokoll. Der Pfad bleibt je
 * Datei derselbe, ein Wiederholen überschreibt also höchstens die eigene Datei.
 *
 * Ein Versuch, der nach `zeitlimitMs` weder Antwort noch Fehler hat (Netz mitten
 * im Upload weg), zählt als gescheitert — sonst blieben Vorschau und Speichern
 * im Dialog für immer gesperrt.
 */
export async function dateienHochladen(
  dateien: ArrayLike<File>,
  pfadFuer: (datei: File, index: number) => string,
  hochladen: (pfad: string, datei: File) => PromiseLike<{ error: unknown }>,
  /** Nach jeder Datei; `pfad` ist ihr Pfad, wenn sie angekommen ist, sonst null */
  fortschritt?: (fertig: number, gesamt: number, pfad: string | null) => void,
  pauseMs = 1000,
  zeitlimitMs = UPLOAD_ZEITLIMIT_MS
): Promise<HochladeErgebnis> {
  const pfade: string[] = [];
  let fehlgeschlagen = 0;
  for (let i = 0; i < dateien.length; i++) {
    const datei = dateien[i];
    let angekommen = false;
    let pfad: string | null = null;
    try {
      pfad = pfadFuer(datei, i);
    } catch {
      pfad = null;
    }
    for (let versuch = 0; versuch < 2 && pfad && !angekommen; versuch++) {
      if (versuch > 0) await new Promise((r) => setTimeout(r, pauseMs));
      let zeitgeber: ReturnType<typeof setTimeout> | undefined;
      try {
        const zuSpaet = new Promise<{ error: unknown }>((r) => {
          zeitgeber = setTimeout(() => r({ error: new Error("Zeitlimit überschritten") }), zeitlimitMs);
        });
        const { error } = await Promise.race([Promise.resolve(hochladen(pfad, datei)), zuSpaet]);
        angekommen = !error;
      } catch {
        angekommen = false;
      } finally {
        clearTimeout(zeitgeber);
      }
    }
    if (angekommen && pfad) pfade.push(pfad);
    else fehlgeschlagen++;
    try {
      fortschritt?.(i + 1, dateien.length, angekommen ? pfad : null);
    } catch {
      // Eine fehlerhafte Anzeige darf keinen Upload abbrechen
    }
  }
  return { pfade, fehlgeschlagen };
}
