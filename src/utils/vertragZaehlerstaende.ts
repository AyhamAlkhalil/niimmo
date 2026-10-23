/**
 * Zählerstände bei Ein- und Auszug am Mietvertrag bearbeiten.
 *
 * Bis zum 23.10.2026 belegte der Bearbeitungsmodus der Vertragsdetails alle acht
 * Zählerfelder mit `|| 0` vor und schrieb sie bei jedem Speichern zurück — auch
 * wenn sich nur die Kaltmiete geändert hatte — samt Historienzeile mit dem
 * heutigen Datum. Live entstanden so 535 Zeilen mit Stand 0 in
 * `zaehlerstand_historie`; leere Stände wurden im Vertrag zu 0, und die
 * Plausibilitätsprüfung der Übergabe verglich gegen diese 0.
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

export interface VertragZaehlerHistorienZeile {
  einheit_id: string;
  zaehler_typ: VertragZaehlerTyp;
  zaehler_nummer: string | null;
  stand: number;
  datum: string;
  quelle: VertragZaehlerAnlass;
}

/**
 * Historienzeilen für geänderte Zählerstände. Ein geleertes Feld (null) erzeugt
 * keine Zeile — die Historie hält Ablesungen fest, kein „nicht erfasst".
 *
 * `vertrag` ist der Stand nach dem Speichern, damit ein im selben Zug geänderter
 * Vertragsbeginn oder ein geändertes Ende schon das Datum bestimmt.
 */
export function zaehlerstandHistorienZeilen(
  aenderungen: ZaehlerstandAenderungen,
  vertrag: VertragDatumsangaben | null | undefined,
  einheit: VertragZaehlerEinheit,
  heute: string
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
    });
  }
  return zeilen;
}
