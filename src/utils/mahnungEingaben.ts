/**
 * Beträge im Mahnungsdialog.
 *
 * Bis zum 28.10.2026 las der Dialog Rückstand, Mahnkosten und Zinssumme mit `parseFloat`.
 * `ui/input` lässt einen einzelnen Punkt stehen (decimalInput.ts) — „1.250“ wurde so zu
 * 1,25 €, und Schreiben und Mail nannten diesen Betrag ohne jede Meldung. Gelesen wird
 * jetzt wie die Kaution (`leseKautionsbetrag`): „1.250“ ist kein Betrag, sondern wird
 * gemeldet und sperrt Speichern und Senden.
 */
import { leseKautionsbetrag } from './vertragKaution';

export const MAHNUNG_BETRAGSFELDER = {
  rueckstand: 'Gesamtrückstand',
  mahnkostenProSchreiben: 'Mahnkosten pro Schreiben',
  verzugszinsen: 'Zwischensumme Verzugszinsen',
} as const;

export type MahnungBetragsfeld = keyof typeof MAHNUNG_BETRAGSFELDER;

export interface MahnungBetraege {
  /** Gelesene Beträge; ein leeres Feld zählt 0, ein unlesbares ebenfalls (und steht in `ungueltig`). */
  werte: Record<MahnungBetragsfeld, number>;
  ungueltig: MahnungBetragsfeld[];
}

export function leseMahnungBetraege(eingaben: Record<MahnungBetragsfeld, string>): MahnungBetraege {
  const werte: Record<MahnungBetragsfeld, number> = { rueckstand: 0, mahnkostenProSchreiben: 0, verzugszinsen: 0 };
  const ungueltig: MahnungBetragsfeld[] = [];
  for (const feld of Object.keys(MAHNUNG_BETRAGSFELDER) as MahnungBetragsfeld[]) {
    const wert = leseKautionsbetrag(eingaben[feld]);
    if (wert === undefined) ungueltig.push(feld);
    else werte[feld] = wert ?? 0;
  }
  return { werte, ungueltig };
}

/**
 * Anzahl der Mahnschreiben: leer zählt 0, sonst nur ganze Zahlen ab 0. Bis zum 28.10.2026 nahm
 * parseInt auch „-2“ an — Mahnkosten von −10 € (QA). undefined heißt unlesbar und sperrt.
 */
export function leseAnzahlSchreiben(anzahl: string): number | undefined {
  const text = anzahl.trim();
  if (!text) return 0;
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/** Mahnkosten gesamt auf den Cent, nie negativ; Unlesbares zählt 0 (und sperrt ohnehin). */
export function mahnkostenGesamtText(proSchreiben: string, anzahl: string): string {
  const preis = leseKautionsbetrag(proSchreiben) ?? 0;
  const stueck = leseAnzahlSchreiben(anzahl) ?? 0;
  return (preis * stueck).toFixed(2);
}

/** Meldung am Formular; leer, wenn alle Beträge lesbar sind. */
export function mahnungBetragsMeldung(ungueltig: MahnungBetragsfeld[]): string {
  if (ungueltig.length === 0) return '';
  const felder = ungueltig.map((f) => MAHNUNG_BETRAGSFELDER[f]).join(', ');
  return `Kein gültiger Betrag: ${felder}. Bitte ohne Tausenderpunkt eingeben, z. B. 1250,00.`;
}
