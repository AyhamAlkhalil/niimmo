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
  /** geänderte Spalten mit dem Wert davor */
  zeilen: Array<{ tabelle: "mietvertrag" | "einheiten"; id: string; neu: Record<string, number | string>; vorher: Record<string, unknown> }>;
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
  fortschritt?: (fertig: number, gesamt: number) => void,
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
      fortschritt?.(i + 1, dateien.length);
    } catch {
      // Eine fehlerhafte Anzeige darf keinen Upload abbrechen
    }
  }
  return { pfade, fehlgeschlagen };
}
