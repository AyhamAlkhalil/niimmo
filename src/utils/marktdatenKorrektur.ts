/**
 * Manuelle Korrektur von Basiszinssatz und VPI auf der Startseite.
 *
 * Bis zum 28.10.2026 schrieb die Startseite den Wert mit `stichtag = heute` und ohne Prüfung:
 * - Ein rohes `<input type="number">` verwarf das Dezimalkomma — „1,52“ wurde zu 152 %.
 * - Die View `aktuelle_marktdaten` nimmt je Typ die Zeile mit dem jüngsten Stichtag. Der VPI hat
 *   als Stichtag seinen Bezugsmonat, der Monate hinter dem Abruf liegt: Eine Korrektur mit
 *   heutigem Datum verdrängte alle später veröffentlichten amtlichen Werte.
 * - `fetch-marktdaten` legt den Basiszins je Monat an (Stichtag Monatserster, live geprüft am
 *   28.10.2026), getBasiszinssatz nimmt die jüngste Zeile bis zum Datum. Eine Korrektur mit
 *   heutigem Datum galt erst ab heute statt ab Beginn des Halbjahrs (§ 247 Abs. 1 BGB: Änderung
 *   zum 01.01. und 01.07.). Eine Zeile nur zum Periodenbeginn hätten die Monatszeilen danach verdeckt.
 *
 * Jetzt: Der Basiszins wird für jeden Monatsersten vom Periodenbeginn bis zum laufenden Monat
 * geschrieben, der VPI für den gewählten Bezugsmonat. Der Upsert-Konflikt (typ, stichtag) ersetzt
 * dabei die amtliche Zeile desselben Stichtags.
 */
import { alsIsoTag } from './contractUtils';

export type MarktdatenTyp = 'basiszinssatz' | 'vpi';

/** Frühester Bezugsmonat einer VPI-Korrektur (Basis 2020 = 100, ältere Monate korrigiert niemand mehr). */
export const VPI_FRUEHESTER_MONAT = '2000-01';

/** Plausibler Wertebereich; der Basiszins war 2013–2022 negativ (tiefster Wert −0,88 %). */
export const MARKTDATEN_BEREICH: Record<MarktdatenTyp, { min: number; max: number }> = {
  basiszinssatz: { min: -5, max: 15 },
  vpi: { min: 50, max: 300 },
};

/** Wert aus dem Feld (über `ui/input` schon mit Punkt); undefined, wenn unlesbar oder außerhalb des Bereichs. */
export function leseMarktwert(typ: MarktdatenTyp, eingabe: string): number | undefined {
  const text = eingabe.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return undefined;
  const wert = Number(text);
  const { min, max } = MARKTDATEN_BEREICH[typ];
  return Number.isFinite(wert) && wert >= min && wert <= max ? wert : undefined;
}

/** Beginn des laufenden Basiszins-Halbjahrs (01.01. bzw. 01.07.) als JJJJ-MM-TT. */
export function basiszinsPeriodenBeginn(heute: Date): string {
  return `${heute.getFullYear()}-${heute.getMonth() < 6 ? '01' : '07'}-01`;
}

/** Vorschlag für den Bezugsmonat einer VPI-Korrektur: der Monat nach dem letzten Wert, höchstens der laufende. */
export function vorgeschlagenerVpiMonat(letzterStichtag: string | null | undefined, heute: Date): string {
  const laufend = alsIsoTag(heute).slice(0, 7);
  if (!letzterStichtag || !/^\d{4}-\d{2}/.test(letzterStichtag)) return laufend;
  const [jahr, monat] = letzterStichtag.split('-').map(Number);
  const folgemonat = alsIsoTag(new Date(jahr, monat, 1)).slice(0, 7);
  return folgemonat < laufend ? folgemonat : laufend;
}

/**
 * Zeilen für den Upsert in `marktdaten`, oder ein Fehlertext für das Feld.
 * `vpiMonat` ist JJJJ-MM (Eingabe `type="month"`).
 */
export function marktdatenKorrektur(
  typ: MarktdatenTyp,
  eingabe: string,
  heute: Date,
  vpiMonat?: string
): { zeilen: Array<{ typ: MarktdatenTyp; wert: number; stichtag: string }> } | { fehler: string } {
  const wert = leseMarktwert(typ, eingabe);
  const { min, max } = MARKTDATEN_BEREICH[typ];
  if (wert === undefined) {
    return {
      fehler: typ === 'basiszinssatz'
        ? `Bitte einen Basiszins zwischen ${min} und ${max} % eingeben, z. B. 1,52.`
        : `Bitte einen VPI zwischen ${min} und ${max} eingeben, z. B. 125,6.`,
    };
  }
  const laufenderMonat = alsIsoTag(heute).slice(0, 7);
  if (typ === 'vpi') {
    if (!vpiMonat || !/^\d{4}-(0[1-9]|1[0-2])$/.test(vpiMonat)) return { fehler: 'Bitte den Bezugsmonat des VPI wählen.' };
    // Chrome meldet beim Tippen der Jahreszahl Zwischenwerte wie „0002-10“ (QA 28.10.2026)
    if (vpiMonat < VPI_FRUEHESTER_MONAT) return { fehler: 'Bitte einen Bezugsmonat ab dem Jahr 2000 wählen.' };
    if (vpiMonat > laufenderMonat) return { fehler: 'Der Bezugsmonat liegt in der Zukunft.' };
    return { zeilen: [{ typ, wert, stichtag: `${vpiMonat}-01` }] };
  }
  const zeilen: Array<{ typ: MarktdatenTyp; wert: number; stichtag: string }> = [];
  const beginn = basiszinsPeriodenBeginn(heute);
  for (let monat = Number(beginn.slice(5, 7)); monat <= heute.getMonth() + 1; monat++) {
    zeilen.push({ typ, wert, stichtag: `${beginn.slice(0, 4)}-${String(monat).padStart(2, '0')}-01` });
  }
  return { zeilen };
}
