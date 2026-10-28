/**
 * Kaution (Soll und Ist) in der Vertragsbearbeitung.
 *
 * Bis zum 26.10.2026 belegte der Bearbeitungsmodus der Vertragsdetails beide
 * Felder mit `|| 0` vor und schrieb sie bei jedem Speichern zurück — eine nicht
 * erfasste Kaution (null) wurde still zu 0. Dasselbe Muster wie bei den
 * Zählerständen (vertragZaehlerstaende.ts); live standen danach 47 Verträge auf
 * 0 und 22 noch leer. Außerdem fehlte am Feld `onValueChange`: Ohne Klick auf den
 * Haken ging die Eingabe verloren.
 *
 * Regeln seither:
 * - Leer bleibt null, eine eingetragene 0 bleibt 0.
 * - Geschrieben wird nur ein Feld, das sich gegenüber dem geladenen Vertrag geändert hat.
 * - Ein negativer oder unlesbarer Betrag wird nicht gespeichert, sondern gemeldet.
 *
 * Seit 28.10.2026 (Migration 20261028145000_kaution_grundwert.sql) wird das Ist nicht mehr von
 * Hand gesetzt. kaution_ist = kaution_ist_grundwert + Summe der Kautionsbuchungen, die Datenbank
 * rechnet es. Von Hand gepflegt wird nur der Grundwert: was außerhalb des Kontos einging (bar,
 * Altbestand vor dem Import). Vorher addierte ein Trigger jede Buchung auf den gespeicherten Wert;
 * wer das Ist von Hand eintrug, bevor der CSV-Abgleich dieselbe Überweisung brachte, bekam es doppelt.
 */

export const KAUTION_FELDER = ["kaution_betrag", "kaution_ist_grundwert"] as const;
export type KautionFeld = (typeof KAUTION_FELDER)[number];
export type KautionAenderungen = Partial<Record<KautionFeld, number | null>>;

/** „Kaution Soll" — für Meldungen an den Nutzer */
export const kautionFeldBezeichnung = (feld: KautionFeld): string =>
  feld === "kaution_betrag" ? "Kaution Soll" : "Kaution Ist (von Hand)";

/**
 * Betrag aus Formular oder Datenbank.
 *
 * `null`, `undefined` und eine leere Eingabe ergeben `null` (nicht erfasst).
 * Text kommt über `ui/input` schon mit Punkt an; ein einzelnes Komma wird
 * trotzdem gelesen. Liefert `undefined`, wenn der Wert kein Betrag ist.
 */
export function leseKautionsbetrag(wert: unknown): number | null | undefined {
  if (wert === null || wert === undefined) return null;
  // -0 wird 0; eine Ziffernfolge, die als Zahl unendlich wird, ist kein Betrag (QA 27.10.2026)
  if (typeof wert === "number") return Number.isFinite(wert) && wert >= 0 ? wert + 0 : undefined;
  if (typeof wert === "string") {
    const text = wert.trim().replace(/^(\d+),(\d*)$/, "$1.$2");
    if (!text) return null;
    // „1.000“ ist ein Tausenderpunkt, kein Betrag von 1 € (QA 27.10.2026: Mieterhöhung auf 1 €)
    if (/^[1-9]\d{0,2}\.\d{3}$/.test(text)) return undefined;
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
    const zahl = Number(text);
    return Number.isFinite(zahl) ? zahl : undefined;
  }
  return undefined;
}

/**
 * Welche Kautionsfelder sich gegenüber dem geladenen Vertrag geändert haben.
 *
 * Berücksichtigt werden nur Felder, die in `bearbeitet` vorkommen. Ein Feld mit
 * nicht lesbarer Eingabe landet in `ungueltig` und nie in `aenderungen`.
 */
export function geaenderteKaution(
  geladen: Partial<Record<KautionFeld, unknown>> | null | undefined,
  bearbeitet: Record<string, unknown>
): { aenderungen: KautionAenderungen; ungueltig: KautionFeld[] } {
  const aenderungen: KautionAenderungen = {};
  const ungueltig: KautionFeld[] = [];
  for (const feld of KAUTION_FELDER) {
    if (bearbeitet[feld] === undefined) continue;
    const neu = leseKautionsbetrag(bearbeitet[feld]);
    if (neu === undefined) {
      ungueltig.push(feld);
      continue;
    }
    // Ein unlesbarer Altwert zählt wie „nicht erfasst" — sonst ließe er sich nie überschreiben
    const alt = leseKautionsbetrag(geladen?.[feld]) ?? null;
    if (neu !== alt) aenderungen[feld] = neu;
  }
  return { aenderungen, ungueltig };
}

/** Zahl aus der Datenbank, auch negativ (Rückzahlung); sonst null. */
function gespeicherterBetrag(wert: unknown): number | null {
  if (typeof wert === "number") return Number.isFinite(wert) ? wert : null;
  if (typeof wert === "string" && wert.trim() !== "") {
    const zahl = Number(wert);
    return Number.isFinite(zahl) ? zahl : null;
  }
  return null;
}

const aufCent = (betrag: number): number => Math.round(betrag * 100) / 100 + 0;

export interface KautionAufteilung {
  /** Kautions-Ist insgesamt (von der Datenbank berechnet); null = nicht erfasst */
  ist: number | null;
  /** Von Hand gepflegter Anteil (bar, Altbestand vor dem Import); null = nicht erfasst */
  vonHand: number | null;
  /** Summe der Kautionsbuchungen (Rückzahlungen negativ) */
  ausBuchungen: number;
}

/**
 * Woraus sich das Kautions-Ist eines geladenen Vertrags zusammensetzt.
 *
 * Die Buchungssumme ergibt sich aus Ist minus Grundwert — dieselbe Regel, nach der die Datenbank
 * das Ist rechnet, ohne eigene Abfrage. Fehlt die Spalte kaution_ist_grundwert (Migration noch
 * nicht eingespielt), gilt das ganze Ist als von Hand gepflegt, wie bis zum 28.10.2026.
 */
export function kautionAufteilung(
  vertrag: { kaution_ist?: unknown; kaution_ist_grundwert?: unknown } | null | undefined
): KautionAufteilung {
  const ist = gespeicherterBetrag(vertrag?.kaution_ist);
  const vonHand =
    vertrag && "kaution_ist_grundwert" in vertrag ? gespeicherterBetrag(vertrag.kaution_ist_grundwert) : ist;
  return { ist, vonHand, ausBuchungen: aufCent((ist ?? 0) - (vonHand ?? 0)) };
}

/**
 * Ist, wie es nach dem Speichern eines neuen Grundwerts dastünde (Vorschau im Bearbeitungsmodus).
 * Leer heißt „nichts von Hand“; eine unlesbare Eingabe ändert die Vorschau nicht.
 */
export function kautionIstVorschau(aufteilung: KautionAufteilung, vonHandEingabe: unknown): number | null {
  const neu = leseKautionsbetrag(vonHandEingabe);
  if (neu === undefined) return aufteilung.ist;
  // Weder von Hand noch aus Buchungen: nicht erfasst (die Datenbank speichert dann NULL)
  if (neu === null && aufteilung.ausBuchungen === 0) return null;
  return aufCent((neu ?? 0) + aufteilung.ausBuchungen);
}
