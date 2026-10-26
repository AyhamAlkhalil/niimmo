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
 */

export const KAUTION_FELDER = ["kaution_betrag", "kaution_ist"] as const;
export type KautionFeld = (typeof KAUTION_FELDER)[number];
export type KautionAenderungen = Partial<Record<KautionFeld, number | null>>;

/** „Kaution Soll" — für Meldungen an den Nutzer */
export const kautionFeldBezeichnung = (feld: KautionFeld): string =>
  feld === "kaution_betrag" ? "Kaution Soll" : "Kaution Ist";

/**
 * Betrag aus Formular oder Datenbank.
 *
 * `null`, `undefined` und eine leere Eingabe ergeben `null` (nicht erfasst).
 * Text kommt über `ui/input` schon mit Punkt an; ein einzelnes Komma wird
 * trotzdem gelesen. Liefert `undefined`, wenn der Wert kein Betrag ist.
 */
export function leseKautionsbetrag(wert: unknown): number | null | undefined {
  if (wert === null || wert === undefined) return null;
  if (typeof wert === "number") return Number.isFinite(wert) && wert >= 0 ? wert : undefined;
  if (typeof wert === "string") {
    const text = wert.trim().replace(/^(\d+),(\d*)$/, "$1.$2");
    if (!text) return null;
    return /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : undefined;
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
