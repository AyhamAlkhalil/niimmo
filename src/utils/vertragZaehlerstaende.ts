/**
 * Zählerstände bei Ein- und Auszug am Mietvertrag bearbeiten.
 *
 * Bis zum 23.10.2026 belegte der Bearbeitungsmodus der Vertragsdetails alle acht
 * Zählerfelder mit `|| 0` vor und schrieb sie bei jedem Speichern zurück — auch
 * wenn sich nur die Kaltmiete geändert hatte — samt Historienzeile mit dem
 * heutigen Datum. Live entstanden so 535 Zeilen mit Stand 0 in
 * `zaehlerstand_historie`; leere Stände wurden im Vertrag zu 0, und die
 * Plausibilitätsprüfung der Übergabe verglich gegen diese 0. Am 26.10.2026
 * wurde der Altbestand bereinigt: Die Null-Zeilen sind gelöscht, die Nullfelder
 * am Vertrag stehen auf null — bis auf 8 Einzugsstände mit echtem Auszugsstand,
 * bei denen ein neuer Zähler denkbar ist (.tmp/bereinigung-zaehlernullen-2026-10-26).
 *
 * Regeln seither:
 * - Ein leerer Stand bleibt `null`, eine eingetragene 0 bleibt 0.
 * - Geschrieben wird nur ein Feld, das sich gegenüber dem geladenen Vertrag geändert hat.
 * - Eine Historienzeile entsteht nur für ein geändertes Feld mit Wert.
 * - Ihr Datum ist der Vertragsbeginn (Einzug) bzw. das Vertragsende nach
 *   getVertragsende() (Auszug); fehlt es, gilt der heutige Tag.
 */
import { getVertragsende } from "@/utils/contractUtils";
import { istGueltigeZaehlerstandEingabe, parseZaehlerstand } from "@/utils/zaehlerstandUtils";

export const VERTRAG_ZAEHLER_TYPEN = ["kaltwasser", "warmwasser", "strom", "gas"] as const;
export type VertragZaehlerTyp = (typeof VERTRAG_ZAEHLER_TYPEN)[number];
export type VertragZaehlerAnlass = "einzug" | "auszug";
export type VertragZaehlerFeld = `${VertragZaehlerTyp}_${VertragZaehlerAnlass}`;

export const VERTRAG_ZAEHLER_FELDER: readonly VertragZaehlerFeld[] = VERTRAG_ZAEHLER_TYPEN.flatMap((typ) => [
  `${typ}_einzug` as const,
  `${typ}_auszug` as const,
]);

export type ZaehlerstandAenderungen = Partial<Record<VertragZaehlerFeld, number | null>>;

export const istVertragZaehlerFeld = (feld: string): feld is VertragZaehlerFeld =>
  (VERTRAG_ZAEHLER_FELDER as readonly string[]).includes(feld);

const anlassVon = (feld: VertragZaehlerFeld): VertragZaehlerAnlass =>
  feld.endsWith("_einzug") ? "einzug" : "auszug";

const typVon = (feld: VertragZaehlerFeld): VertragZaehlerTyp =>
  feld.slice(0, feld.lastIndexOf("_")) as VertragZaehlerTyp;

const TYP_BEZEICHNUNG: Record<VertragZaehlerTyp, string> = {
  kaltwasser: "Kaltwasser",
  warmwasser: "Warmwasser",
  strom: "Strom",
  gas: "Gas",
};

/** „Strom bei Einzug" — für Meldungen an den Nutzer */
export const zaehlerFeldBezeichnung = (feld: VertragZaehlerFeld): string =>
  `${TYP_BEZEICHNUNG[typVon(feld)]} bei ${anlassVon(feld) === "einzug" ? "Einzug" : "Auszug"}`;

/**
 * Wert aus Formular oder Datenbank als Zählerstand.
 *
 * `null`, `undefined` und eine leere Eingabe ergeben `null` (nicht erfasst).
 * Eine Zahl bleibt, wie sie ist — auch 0. Text läuft über parseZaehlerstand(),
 * damit mehrdeutige Eingaben nicht still abgeschnitten werden.
 * Liefert `undefined`, wenn der Wert kein Zählerstand ist.
 */
export function leseZaehlerstand(wert: unknown): number | null | undefined {
  if (wert === null || wert === undefined) return null;
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : undefined;
  if (typeof wert === "string") {
    if (!wert.trim()) return null;
    return istGueltigeZaehlerstandEingabe(wert) ? parseZaehlerstand(wert) : undefined;
  }
  return undefined;
}

/**
 * Welche Zählerfelder sich gegenüber dem geladenen Vertrag geändert haben.
 *
 * Berücksichtigt werden nur Felder, die in `bearbeitet` vorkommen. Ein Feld mit
 * nicht lesbarer Eingabe landet in `ungueltig` und nie in `aenderungen`.
 */
export function geaenderteZaehlerstaende(
  geladen: Partial<Record<VertragZaehlerFeld, unknown>> | null | undefined,
  bearbeitet: Record<string, unknown>
): { aenderungen: ZaehlerstandAenderungen; ungueltig: VertragZaehlerFeld[] } {
  const aenderungen: ZaehlerstandAenderungen = {};
  const ungueltig: VertragZaehlerFeld[] = [];
  for (const feld of VERTRAG_ZAEHLER_FELDER) {
    if (bearbeitet[feld] === undefined) continue;
    const neu = leseZaehlerstand(bearbeitet[feld]);
    if (neu === undefined) {
      ungueltig.push(feld);
      continue;
    }
    // Ein unlesbarer Altwert zählt wie „nicht erfasst" — sonst ließe er sich nie überschreiben
    const alt = leseZaehlerstand(geladen?.[feld]) ?? null;
    if (neu !== alt) aenderungen[feld] = neu;
  }
  return { aenderungen, ungueltig };
}

export interface VertragDatumsangaben {
  start_datum?: string | null;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
}

/** Datum der Historienzeile: Einzug zum Vertragsbeginn, Auszug zum Vertragsende, sonst heute. */
export function zaehlerstandHistorieDatum(
  feld: VertragZaehlerFeld,
  vertrag: VertragDatumsangaben | null | undefined,
  heute: string
): string {
  const datum = anlassVon(feld) === "einzug" ? vertrag?.start_datum : getVertragsende(vertrag);
  return datum ? datum.slice(0, 10) : heute;
}

export interface VertragZaehlerEinheit {
  id: string;
  kaltwasser_zaehler?: string | null;
  warmwasser_zaehler?: string | null;
  strom_zaehler?: string | null;
  gas_zaehler?: string | null;
}

export const ZAEHLERNUMMER_FELDER = VERTRAG_ZAEHLER_TYPEN.map((typ) => `${typ}_zaehler` as const);
export type ZaehlernummerFeld = (typeof ZAEHLERNUMMER_FELDER)[number];
export type ZaehlernummerAenderungen = Partial<Record<ZaehlernummerFeld, string | null>>;

/**
 * Welche Zählernummern der Einheit sich geändert haben. Leer zählt als „nicht
 * gesetzt" (null): Bis zum 26.10.2026 schrieb der Bearbeitungsmodus jede Nummer
 * bei jedem Speichern zurück, eine fehlende als ''. Berücksichtigt werden nur
 * Felder, die in `bearbeitet` vorkommen.
 */
export function geaenderteZaehlernummern(
  geladen: Partial<Record<ZaehlernummerFeld, string | null>> | null | undefined,
  bearbeitet: Record<string, unknown>
): ZaehlernummerAenderungen {
  const aenderungen: ZaehlernummerAenderungen = {};
  for (const feld of ZAEHLERNUMMER_FELDER) {
    const wert = bearbeitet[feld];
    if (wert !== null && typeof wert !== "string" && typeof wert !== "number") continue;
    const neu = wert === null ? null : String(wert).trim() || null;
    const alt = geladen?.[feld]?.trim() || null;
    if (neu !== alt) aenderungen[feld] = neu;
  }
  return aenderungen;
}

export interface VertragZaehlerHistorienZeile {
  einheit_id: string;
  zaehler_typ: VertragZaehlerTyp;
  zaehler_nummer: string | null;
  stand: number;
  datum: string;
  quelle: VertragZaehlerAnlass;
  /** Seit 24.10.2026: Die Übergabe erkennt daran den Stand des eigenen Vertrags */
  mietvertrag_id: string | null;
}

/**
 * Historienzeilen für geänderte Zählerstände. Ein geleertes Feld (null) erzeugt
 * keine Zeile — die Historie hält Ablesungen fest, kein „nicht erfasst".
 *
 * `vertrag` ist der Stand nach dem Speichern, damit ein im selben Zug geänderter
 * Vertragsbeginn oder ein geändertes Ende schon das Datum bestimmt. Ebenso
 * `einheit`: Bei einem Zählertausch gehört der neue Stand zur neuen Nummer —
 * bis zum 26.10.2026 bekam die Zeile die alte.
 */
export function zaehlerstandHistorienZeilen(
  aenderungen: ZaehlerstandAenderungen,
  vertrag: VertragDatumsangaben | null | undefined,
  einheit: VertragZaehlerEinheit,
  heute: string,
  mietvertragId: string | null = null
): VertragZaehlerHistorienZeile[] {
  const zeilen: VertragZaehlerHistorienZeile[] = [];
  for (const feld of VERTRAG_ZAEHLER_FELDER) {
    const stand = aenderungen[feld];
    if (typeof stand !== "number" || !Number.isFinite(stand)) continue;
    const typ = typVon(feld);
    zeilen.push({
      einheit_id: einheit.id,
      zaehler_typ: typ,
      zaehler_nummer: einheit[`${typ}_zaehler`]?.trim() || null,
      stand,
      datum: zaehlerstandHistorieDatum(feld, vertrag, heute),
      quelle: anlassVon(feld),
      mietvertrag_id: mietvertragId,
    });
  }
  return zeilen;
}

export interface ZaehlerVerbrauch {
  /** Verbrauch in der Einheit des Zählers, auf drei Nachkommastellen gerundet */
  wert: number;
  /** Bis wann gerechnet wurde: Auszugsstand oder letzte Ablesung an der Einheit */
  bis: "auszug" | "letzte_ablesung";
  /** Datum der letzten Ablesung (nur bei `letzte_ablesung`) */
  datum: string | null;
}

export interface ZaehlerVerbrauchEingabe {
  einzug: number | string | null | undefined;
  auszug: number | string | null | undefined;
  /** Letzter Stand an der Einheit (`einheiten.<typ>_stand_aktuell`) */
  aktuell: number | string | null | undefined;
  aktuellDatum: string | null | undefined;
  vertrag: VertragDatumsangaben | null | undefined;
}

const alsZahl = (wert: number | string | null | undefined): number | null => {
  if (wert === null || wert === undefined || wert === "") return null;
  const zahl = Number(wert);
  return Number.isFinite(zahl) ? zahl : null;
};

/**
 * Verbrauch für die Karte „Zählerstände & Verbrauch“ in den Vertragsdetails.
 *
 * Bis zum 24.11.2026 rechnete die Karte nur Einzug bis Auszug; bei einem laufenden
 * Vertrag stand dort nichts, obwohl die Zählerliste eine aktuelle Ablesung zeigte
 * (Kundenmeldung 23.11.2026). Seither gilt:
 * - Erst ab einem Einzugsstand über 0 (8 Einzugsnullen sind nicht belegt, 26.10.2026).
 * - Mit Auszugsstand: Auszug minus Einzug.
 * - Sonst die letzte Ablesung der Einheit, aber nur, wenn sie in die Vertragszeit fällt
 *   (nicht vor Beginn, nicht nach dem Ende nach getVertragsende()) — sonst gehört sie zu
 *   einem anderen Mieter.
 * - Ein Stand unter dem Einzugsstand ergibt nichts: Meist wurde der Zähler getauscht.
 */
export function zaehlerVerbrauch(e: ZaehlerVerbrauchEingabe): ZaehlerVerbrauch | null {
  const einzug = alsZahl(e.einzug);
  if (einzug === null || einzug <= 0) return null;
  const runde = (wert: number) => Math.round(wert * 1000) / 1000;

  const auszug = alsZahl(e.auszug);
  if (auszug !== null) {
    return auszug > einzug ? { wert: runde(auszug - einzug), bis: "auszug", datum: null } : null;
  }

  const aktuell = alsZahl(e.aktuell);
  const datum = e.aktuellDatum?.slice(0, 10) ?? null;
  if (aktuell === null || !datum || aktuell <= einzug) return null;
  const beginn = e.vertrag?.start_datum?.slice(0, 10) ?? null;
  const ende = getVertragsende(e.vertrag)?.slice(0, 10) ?? null;
  if (!beginn || datum < beginn) return null;
  if (ende && datum > ende) return null;
  return { wert: runde(aktuell - einzug), bis: "letzte_ablesung", datum };
}
