/**
 * Gesetzliche Grenzen der Mieterhöhung bis zur ortsüblichen Vergleichsmiete.
 *
 * Bis zum 06.09.2026 rechnete der Erhöhungsdialog mit 20 % bzw. 30 %
 * (RentIncreaseModal.tsx:59) — beide Werte zu hoch. Eine Erhöhung über die
 * Kappungsgrenze hinaus ist nach § 558 Abs. 3 BGB in Höhe des Überschusses
 * unwirksam; die Buchhaltung bekam die zu hohe Grenze grün bestätigt.
 *
 * Die übrigen Stellen im System rechneten bereits richtig: agent-api
 * (index.ts:992), der Hinweis an der Immobilie und die Vertragsklausel in
 * wohnraumKlauseln.ts. Diese Datei ist ab jetzt die Quelle für das Frontend;
 * die Deno-Kopie in agent-api ist bei Änderungen mitzuziehen.
 */

import { format } from 'date-fns';
import { leseKautionsbetrag } from './vertragKaution';

/** § 558 Abs. 3 Satz 1 BGB — Regelfall: höchstens 20 % in drei Jahren. */
export const KAPPUNGSGRENZE_REGEL_PROZENT = 20;

/**
 * § 558 Abs. 3 Satz 2 BGB — in Gebieten mit angespanntem Wohnungsmarkt,
 * die eine Landesverordnung ausweist: höchstens 15 % in drei Jahren.
 */
export const KAPPUNGSGRENZE_ANGESPANNT_PROZENT = 15;

/** § 558 Abs. 1 BGB — die Miete muss 15 Monate unverändert gewesen sein. */
export const SPERRFRIST_MONATE = 15;

/**
 * § 558b Abs. 2 BGB — der Mieter hat bis zum Ende des zweiten Monats nach
 * Zugang Zeit zu überlegen; erst danach wird die Erhöhung fällig.
 */
export const UEBERLEGUNGSFRIST_MONATE = 2;

export function kappungsgrenzeProzent(istAngespannterMarkt: boolean): number {
  return istAngespannterMarkt ? KAPPUNGSGRENZE_ANGESPANNT_PROZENT : KAPPUNGSGRENZE_REGEL_PROZENT;
}

/** Höchstbetrag, auf den die Kaltmiete angehoben werden darf. */
export function maximaleKaltmiete(aktuelleKaltmiete: number, istAngespannterMarkt: boolean): number {
  const grenze = kappungsgrenzeProzent(istAngespannterMarkt);
  return aktuelleKaltmiete * (1 + grenze / 100);
}

/**
 * Der erste Monat, für den die erhöhte Miete geschuldet wird: Ablauf des
 * zweiten Kalendermonats nach Zugang des Verlangens (§ 558b Abs. 1, 2 BGB).
 * Beispiel: Zugang im März → erhöhte Miete ab Juni.
 */
export function wirksamAb(zugang: Date): Date {
  return new Date(zugang.getFullYear(), zugang.getMonth() + UEBERLEGUNGSFRIST_MONATE + 1, 1);
}

/**
 * wirksamAb als Kalendertag für die Datenbank (mieterhoehungen.wirksam_ab).
 * Nicht über toISOString(): Die lokale Mitternacht des Monatsersten liegt in deutscher
 * Zeit am Vortag in UTC — gespeichert wurde bis zum 27.10.2026 immer der Monatsletzte
 * davor (Zugang 27.10.2026 → '2026-12-31' statt '2027-01-01').
 */
export function wirksamAbTag(zugang: Date): string {
  return format(wirksamAb(zugang), 'yyyy-MM-dd');
}

/**
 * Neue Kaltmiete und Betriebskosten aus den Eingabefeldern des Mieterhöhungsdialogs.
 *
 * Bis zum 27.10.2026 rechneten Schreiben und Speichern mit `parseFloat(...) || 0`: Ein
 * geleertes BK-Feld kam als 0 € ins Schreiben und — mit Haken „zugestimmt“ — an den Vertrag;
 * eine leere Kaltmiete wurde zu NaN. Die Kaltmiete muss ein positiver Betrag sein, die
 * Betriebskosten dürfen 0, aber nicht leer sein.
 */
export function neueMieteAusEingabe(
  kaltmiete: string,
  betriebskosten: string
): { kaltmiete: number; betriebskosten: number } | { fehler: string } {
  const unlesbar = (feld: string) => `${feld} ist nicht lesbar – bitte ohne Tausenderpunkt eingeben, z. B. 1000,50.`;
  const kalt = leseKautionsbetrag(kaltmiete);
  if (kalt === undefined) return { fehler: unlesbar('Die neue Kaltmiete') };
  if (kalt === null || kalt <= 0) return { fehler: 'Bitte eine neue Kaltmiete über 0 € eintragen.' };
  const bk = leseKautionsbetrag(betriebskosten);
  if (bk === undefined) return { fehler: unlesbar('Die Angabe zu den Betriebskosten') };
  if (bk === null) return { fehler: 'Bitte die neuen Betriebskosten eintragen (0 € ist möglich).' };
  return { kaltmiete: kalt, betriebskosten: bk };
}

/**
 * Ausgangsmiete der Kappungsgrenze (§ 558 Abs. 3 BGB): die Miete drei Jahre vor dem Wirksamwerden.
 * Bis zum 27.10.2026 rechnete der Dialog von der heutigen Miete: 500 € → 550 € (vor einem Jahr) →
 * angeboten wurden bis 660 € statt 600 €. Gibt es im Fenster eine gespeicherte, wirksame Erhöhung,
 * ist deren alte Miete die Basis. Steht nur ein Datum der letzten Erhöhung im Fenster (ohne Vorgang),
 * ist die Basis unbekannt: dann die heutige Miete mit sicher = false, der Dialog warnt.
 */
export function kappungsBasis(
  aktuelleKaltmiete: number,
  wirksamAbIso: string,
  letzteErhoehungAm: string | null | undefined,
  erhoehungen: ReadonlyArray<{ wirksam_ab: string | null; alte_kaltmiete: number | string | null; status?: string | null }>
): { betrag: number; sicher: boolean } {
  const [j, m, t] = wirksamAbIso.split('-').map(Number);
  const fensterBeginn = format(new Date(j - 3, m - 1, t), 'yyyy-MM-dd');
  const imFenster = erhoehungen
    .filter((e) => (e.status ?? 'wirksam') === 'wirksam' && e.wirksam_ab && e.wirksam_ab.slice(0, 10) > fensterBeginn && e.alte_kaltmiete !== null)
    .sort((a, b) => (a.wirksam_ab as string).localeCompare(b.wirksam_ab as string));
  if (imFenster.length > 0) return { betrag: Number(imFenster[0].alte_kaltmiete), sicher: true };
  if (letzteErhoehungAm && letzteErhoehungAm.slice(0, 10) > fensterBeginn) return { betrag: aktuelleKaltmiete, sicher: false };
  return { betrag: aktuelleKaltmiete, sicher: true };
}
