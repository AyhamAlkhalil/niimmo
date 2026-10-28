/**
 * Euro-Beträge aus Formularfeldern lesen (28.10.2026).
 *
 * Bis dahin las jede Maske selbst — `Number`, `parseFloat`, `replace(",", ".")`. Ein deutsch
 * geschriebener Betrag ging dabei still verloren:
 *
 * | Eingabe      | bisher                        | jetzt                 |
 * |--------------|-------------------------------|-----------------------|
 * | „1.200"      | 1,20 € (Punkt als Dezimal)    | abgelehnt (mehrdeutig)|
 * | „1.200,50"   | 1,20 € („1.200.50" → 1,2)     | 1.200,50 €            |
 * | „1200,50"    | 1.200,50 €                    | 1.200,50 €            |
 *
 * Betroffen waren Kaltmiete, Vorauszahlungen und Kaution im Vertragsentwurf und in der
 * Direkterfassung sowie die Soll-Miete der Einheit.
 *
 * `decimalInput.ts` bleibt bewusst, wie es ist: Dort zählt ein einzelner Punkt als Dezimaltrenner,
 * weil Zählerstände wie „123.456" daran hängen. Beim Euro-Betrag gibt es keine drei
 * Nachkommastellen — „1.200" ist hier ein Tausenderpunkt oder ein Tippfehler, und welches von
 * beiden, lässt sich nicht entscheiden. Deshalb wird der Wert abgelehnt statt geraten.
 *
 * Grundlage ist `leseKautionsbetrag` (vertragKaution.ts); hinzu kommt nur die eindeutige deutsche
 * Schreibweise mit Tausenderpunkten und Komma bzw. mit mehreren Tausenderpunkten.
 */
import { leseKautionsbetrag } from './vertragKaution';

/**
 * Liest einen nicht negativen Euro-Betrag.
 *
 * - `null`, `undefined` und eine leere Eingabe ergeben `null` (nicht erfasst).
 * - Eine Zahl wird übernommen, wenn sie endlich und nicht negativ ist.
 * - „1200", „1200,50", „1200.50", „1.200,50" und „1.234.567" werden gelesen.
 * - `undefined` heißt: kein Betrag — mehrdeutig („1.200"), negativ oder unlesbar.
 */
export function leseEuroBetrag(wert: unknown): number | null | undefined {
  if (typeof wert !== 'string') return leseKautionsbetrag(wert);
  const text = wert.trim();
  // „1.200,50" (auch „1.200," beim Tippen): Vor einem Komma sind Punkte eindeutig Tausendertrenner
  if (/^\d{1,3}(\.\d{3})+,\d*$/.test(text)) return leseKautionsbetrag(text.replace(/\./g, '').replace(',', '.'));
  // „1.234.567": Zwei Punkte können keine Dezimaltrenner sein
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(text)) return leseKautionsbetrag(text.replace(/\./g, ''));
  // Genau drei Stellen nach einem einzelnen Punkt („01.200", „1000.000"): Ein Euro-Betrag hat nie
  // drei Nachkommastellen — Tausenderpunkt oder Tippfehler, also mehrdeutig (QA 28.10.2026).
  // „0.500" bleibt 0,50 €: Vor einem Tausenderpunkt steht nie eine einzelne Null.
  if (/^(?!0\.)\d+\.\d{3}$/.test(text)) return undefined;
  return leseKautionsbetrag(text);
}

/** Hinweis am Feld, wenn `leseEuroBetrag` einen Wert ablehnt. */
export const EURO_BETRAG_HINWEIS = 'Kein eindeutiger Betrag – bitte ohne Tausenderpunkt eingeben, z. B. 1200 oder 1200,50.';

/** Ist der eingetippte Text ein Betrag, der sich nicht lesen lässt? Leer zählt nicht als ungültig. */
export function istUngueltigerEuroBetrag(wert: unknown): boolean {
  return leseEuroBetrag(wert) === undefined;
}
