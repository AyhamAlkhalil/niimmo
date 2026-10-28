/**
 * Gesetzliche Grenzen der Mieterhöhung bis zur ortsüblichen Vergleichsmiete.
 *
 * Bis zum 06.09.2026 rechnete der Erhöhungsdialog mit 20 % bzw. 30 %
 * (RentIncreaseModal.tsx:59) — beide Werte zu hoch. Eine Erhöhung über die
 * Kappungsgrenze hinaus ist nach § 558 Abs. 3 BGB in Höhe des Überschusses
 * unwirksam; die Buchhaltung bekam die zu hohe Grenze grün bestätigt.
 *
 * Die übrigen Stellen im System rechneten bereits richtig: der Hinweis an der
 * Immobilie und die Vertragsklausel in wohnraumKlauseln.ts. Diese Datei ist ab
 * jetzt die Quelle für das Frontend (die Deno-Kopie im Telegram-Assistenten
 * entfiel mit ihm am 28.10.2026).
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
 *
 * Mit `bisherigeKaltmiete` muss die neue Kaltmiete darüber liegen (28.10.2026) — wie die
 * Datenbank es verlangt (CHECK mieterhoehungen_erhoeht_tatsaechlich) und der Generator
 * (pruefeErhoehungsdaten). Bisher sah der Nutzer bei gleicher Kaltmiete nur „Vorschau nicht
 * möglich“; geänderte Betriebskosten allein sind kein Verlangen nach § 558 BGB (sondern § 560).
 */
export function neueMieteAusEingabe(
  kaltmiete: string,
  betriebskosten: string,
  bisherigeKaltmiete?: number
): { kaltmiete: number; betriebskosten: number } | { fehler: string } {
  const unlesbar = (feld: string) => `${feld} ist nicht lesbar – bitte ohne Tausenderpunkt eingeben, z. B. 1000,50.`;
  const kalt = leseKautionsbetrag(kaltmiete);
  if (kalt === undefined) return { fehler: unlesbar('Die neue Kaltmiete') };
  if (kalt === null || kalt <= 0) return { fehler: 'Bitte eine neue Kaltmiete über 0 € eintragen.' };
  if (bisherigeKaltmiete !== undefined && !(kalt > bisherigeKaltmiete)) {
    const bisher = bisherigeKaltmiete.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { fehler: `Die neue Kaltmiete muss über der bisherigen von ${bisher} € liegen. Geänderte Betriebskosten allein sind keine Mieterhöhung nach § 558 BGB.` };
  }
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
/** Vorgänge, die als vereinbarte Erhöhung zählen: übernommen ('wirksam') oder zugestimmt und noch offen. */
const ZAEHLT_ALS_ERHOEHUNG = new Set(['wirksam', 'zugestimmt']);

export function kappungsBasis(
  aktuelleKaltmiete: number,
  wirksamAbIso: string,
  letzteErhoehungAm: string | null | undefined,
  erhoehungen: ReadonlyArray<{ wirksam_ab: string | null; alte_kaltmiete: number | string | null; status?: string | null }>
): { betrag: number; sicher: boolean } {
  const [j, m, t] = wirksamAbIso.split('-').map(Number);
  const fensterBeginn = format(new Date(j - 3, m - 1, t), 'yyyy-MM-dd');
  // Seit 28.10.2026 zählt auch eine zugestimmte, noch nicht übernommene Erhöhung: Sie ist vereinbart,
  // und ihre alte Miete ist ebenso die Ausgangsmiete im Fenster (sonst würde zweimal erhöht).
  const imFenster = erhoehungen
    .filter((e) => ZAEHLT_ALS_ERHOEHUNG.has(e.status ?? 'wirksam') && e.wirksam_ab && e.wirksam_ab.slice(0, 10) > fensterBeginn && e.alte_kaltmiete !== null)
    .sort((a, b) => (a.wirksam_ab as string).localeCompare(b.wirksam_ab as string));
  if (imFenster.length > 0) return { betrag: Number(imFenster[0].alte_kaltmiete), sicher: true };
  if (letzteErhoehungAm && letzteErhoehungAm.slice(0, 10) > fensterBeginn) return { betrag: aktuelleKaltmiete, sicher: false };
  return { betrag: aktuelleKaltmiete, sicher: true };
}

export interface ErhoehungsVorgang {
  id: string;
  verlangt_am: string | null;
  wirksam_ab: string | null;
  alte_kaltmiete: number | string | null;
  alte_betriebskosten?: number | string | null;
  neue_kaltmiete: number | string | null;
  neue_betriebskosten: number | string | null;
  status: string | null;
  zugestimmt_am?: string | null;
}

/**
 * Das offene Erhöhungsverlangen eines Vertrags: der jüngste Vorgang mit Status `verlangt`.
 *
 * Bis zum 28.10.2026 hieß es nach dem Speichern „Sobald der Mieter zustimmt, hier erneut öffnen und
 * den Haken setzen“. Das erzeugte ein zweites Schreiben mit heutigem Datum und einen zweiten Vorgang;
 * wirksam_ab und letzte_mieterhoehung_am zählten ab der Zustimmung statt ab dem Verlangen, und der
 * alte Vorgang blieb für immer `verlangt`. Der Dialog bietet stattdessen an, die Zustimmung zu diesem
 * Verlangen zu erfassen.
 */
export function offenesVerlangen<T extends ErhoehungsVorgang>(erhoehungen: ReadonlyArray<T>): T | null {
  const offen = erhoehungen
    .filter((e) => e.status === 'verlangt' && e.wirksam_ab && e.neue_kaltmiete !== null)
    .sort((a, b) => (b.verlangt_am ?? '').localeCompare(a.verlangt_am ?? ''));
  return offen[0] ?? null;
}

/**
 * Alle offenen Verlangen eines Vertrags. Ein neues Schreiben ohne Zustimmung ersetzt sie; sie werden
 * nach dem Speichern auf `zurueckgezogen` gesetzt, statt für immer `verlangt` zu bleiben (28.10.2026).
 */
export function offeneVerlangenIds(erhoehungen: ReadonlyArray<ErhoehungsVorgang>): string[] {
  return erhoehungen.filter((e) => e.status === 'verlangt').map((e) => e.id);
}

/**
 * Neue Miete aus einem gespeicherten Verlangen. Betriebskosten null heißt: die Vorauszahlung des
 * Vertrags bleibt, statt still auf 0 € zu fallen (Review 28.10.2026; die Spalte ist live NOT NULL,
 * die Regel schützt vor Altbestand und künftigen Schreibwegen). null, wenn die Kaltmiete fehlt.
 */
export function mieteAusVerlangen(v: ErhoehungsVorgang): { kaltmiete: number; betriebskosten: number | null } | null {
  const kaltmiete = Number(v.neue_kaltmiete);
  if (v.neue_kaltmiete === null || !Number.isFinite(kaltmiete) || kaltmiete <= 0) return null;
  if (v.neue_betriebskosten === null || v.neue_betriebskosten === undefined) return { kaltmiete, betriebskosten: null };
  const betriebskosten = Number(v.neue_betriebskosten);
  return Number.isFinite(betriebskosten) && betriebskosten >= 0 ? { kaltmiete, betriebskosten } : null;
}

const cent = (wert: number | string | null | undefined) => Math.round(Number(wert ?? 0) * 100);

/** Hat sich die Vertragsmiete seit dem Verlangen geändert — Kaltmiete oder Betriebskosten? */
export function mieteSeitVerlangenGeaendert(v: ErhoehungsVorgang, aktuelleKaltmiete: number, aktuelleBetriebskosten: number): boolean {
  if (cent(v.alte_kaltmiete) !== cent(aktuelleKaltmiete)) return true;
  return v.alte_betriebskosten !== null && v.alte_betriebskosten !== undefined && cent(v.alte_betriebskosten) !== cent(aktuelleBetriebskosten);
}

/**
 * Um so viel ist die Monatsforderung zu hoch, wenn die Vertragsmiete vor dem Wirksamwerden gesetzt
 * wird (§ 558b Abs. 1 BGB): neue minus heutige Miete, Betriebskosten nur, wenn sie sich ändern.
 */
export function mehrforderungProMonat(
  miete: { kaltmiete: number; betriebskosten: number | null },
  aktuelleKaltmiete: number,
  aktuelleBetriebskosten: number
): number {
  const differenz = cent(miete.kaltmiete) - cent(aktuelleKaltmiete)
    + (miete.betriebskosten === null ? 0 : cent(miete.betriebskosten) - cent(aktuelleBetriebskosten));
  return differenz / 100;
}

/*
 * Seit 28.10.2026 gilt eine Mieterhöhung erst ab wirksam_ab (§ 558b Abs. 1 BGB). Eine erfasste
 * Zustimmung macht den Vorgang 'zugestimmt'; die Vertragsmiete stellt erst die Datenbank um
 * (mieterhoehungen_anwenden im Nachtlauf vor der Sollstellung, Migration 20261028142000).
 * Bis dahin setzte der Dialog die Miete sofort, und Rückstand und Mahnung rechneten zwei bis drei
 * Monate mit einem zu hohen Soll.
 */

/** Die vereinbarte, noch nicht übernommene Erhöhung eines Vertrags (Status 'zugestimmt'), sonst null. */
export function vereinbarteErhoehung<T extends ErhoehungsVorgang>(erhoehungen: ReadonlyArray<T>): T | null {
  const vereinbart = erhoehungen
    .filter((e) => e.status === 'zugestimmt' && e.wirksam_ab)
    .sort((a, b) => (b.wirksam_ab as string).localeCompare(a.wirksam_ab as string));
  return vereinbart[0] ?? null;
}

/**
 * Überfällig: Der Tag nach wirksam_ab ist erreicht, der Vorgang steht aber noch auf 'zugestimmt'. Der
 * Nachtlauf hat ihn dann übersprungen (meist, weil sich die Miete seit dem Verlangen geändert hat).
 * heuteIso als Kalendertag JJJJ-MM-TT in deutscher Zeit.
 *
 * Erst ab dem Folgetag (Review 28.10.2026): Die Datenbank rechnet in UTC und übernimmt um 05:00 UTC. Am
 * Monatsersten zwischen 0 und 2 Uhr deutscher Zeit ist dort noch der Vortag — „überfällig“ wäre falsch,
 * und „Trotzdem übernehmen“ endete mit NOCH_NICHT_WIRKSAM.
 */
export function erhoehungUeberfaellig(v: Pick<ErhoehungsVorgang, 'status' | 'wirksam_ab'>, heuteIso: string): boolean {
  return v.status === 'zugestimmt' && !!v.wirksam_ab && v.wirksam_ab.slice(0, 10) < heuteIso;
}

/**
 * Was eine Zustimmung von vornherein ausschließt — dieselben Regeln wie mieterhoehung_zustimmung_pruefen
 * in der Datenbank (Review 28.10.2026): Staffel- oder Indexmiete (§§ 557a Abs. 2, 557b Abs. 2 BGB) und ein
 * Vertragsende vor dem Wirksamwerden. vertragsende wie getVertragsende(): ende_datum, sonst
 * kuendigungsdatum. Gibt den Hinweis der Datenbank zurück oder null.
 */
export function zustimmungHindernis(vertrag: {
  mietanpassungArt?: string | null;
  vertragsende?: string | null;
  wirksamAbIso: string;
}): 'STAFFEL_ODER_INDEX' | 'VERTRAG_ENDET_VORHER' | null {
  if (vertrag.mietanpassungArt === 'staffel' || vertrag.mietanpassungArt === 'index') return 'STAFFEL_ODER_INDEX';
  if (vertrag.vertragsende && vertrag.vertragsende.slice(0, 10) < vertrag.wirksamAbIso.slice(0, 10)) return 'VERTRAG_ENDET_VORHER';
  return null;
}

/** Warum eine überfällige Erhöhung (vermutlich) nicht übernommen wurde — für den Hinweis im Dialog. */
export function ueberfaelligGrund(
  v: ErhoehungsVorgang,
  aktuelleKaltmiete: number,
  aktuelleBetriebskosten: number,
  vertrag: { mietanpassungArt?: string | null; vertragsende?: string | null } = {}
): string {
  const hindernis = v.wirksam_ab ? zustimmungHindernis({ ...vertrag, wirksamAbIso: v.wirksam_ab }) : null;
  if (hindernis) return uebernahmeMeldung(hindernis);
  if (uebernahmeKonflikt(v, aktuelleKaltmiete, aktuelleBetriebskosten)) {
    return 'Die Miete am Vertrag hat sich seit dem Verlangen geändert, deshalb wurde nicht automatisch übernommen.';
  }
  return 'Der Nachtlauf hat sie nicht übernommen. Bitte die Miete am Vertrag prüfen.';
}

/**
 * Würde die Datenbank die Übernahme ablehnen (Hinweis MIETE_GEAENDERT)? Dieselbe Regel wie in
 * mieterhoehung_anwenden_intern: Die Kaltmiete am Vertrag ist weder die alte noch schon die neue des
 * Verlangens, oder das Verlangen ändert die Betriebskosten und die am Vertrag sind nicht mehr die alten.
 * Ändert das Verlangen die Betriebskosten nicht, ist eine spätere Anpassung der Vorauszahlung (§ 560 BGB)
 * kein Konflikt — sie bleibt bei der Übernahme stehen.
 */
export function uebernahmeKonflikt(v: ErhoehungsVorgang, aktuelleKaltmiete: number, aktuelleBetriebskosten: number): boolean {
  const verlangenAendertBk = cent(v.neue_betriebskosten) !== cent(v.alte_betriebskosten);
  const bkNachher = verlangenAendertBk ? cent(v.neue_betriebskosten) : cent(aktuelleBetriebskosten);
  const schonUebernommen = cent(aktuelleKaltmiete) === cent(v.neue_kaltmiete) && cent(aktuelleBetriebskosten) === bkNachher;
  if (schonUebernommen) return false;
  if (cent(aktuelleKaltmiete) !== cent(v.alte_kaltmiete)) return true;
  return verlangenAendertBk && cent(aktuelleBetriebskosten) !== cent(v.alte_betriebskosten);
}

/**
 * Wie viele Monatsforderungen eine späte Zustimmung höchstens anhebt: vom Monat des Wirksamwerdens bis
 * einschließlich des laufenden Monats. 0, wenn wirksam_ab noch nicht erreicht ist. Höchstens, weil die
 * Datenbank geminderte oder von Hand geänderte Forderungen stehen lässt.
 */
export function nachzuberechnendeMonate(wirksamAbIso: string, heute: Date): number {
  const [jahr, monat] = wirksamAbIso.slice(0, 10).split('-').map(Number);
  const anzahl = (heute.getFullYear() - jahr) * 12 + (heute.getMonth() + 1 - monat) + 1;
  return wirksamAbIso.slice(0, 10) <= format(heute, 'yyyy-MM-dd') ? Math.max(anzahl, 0) : 0;
}

/** Fachliche Meldung zu den Hinweisen der Datenbankfunktionen mieterhoehung_zustimmen/_anwenden. */
export function uebernahmeMeldung(hinweis: string | null | undefined, ersatz?: string): string {
  switch (hinweis) {
    case 'MIETE_GEAENDERT':
      return 'Die Miete am Vertrag hat sich seit dem Verlangen geändert. Bitte prüfen und gegebenenfalls „Trotzdem übernehmen“ wählen.';
    case 'STAFFEL_ODER_INDEX':
      return 'Der Vertrag hat eine Staffel- oder Indexmiete; eine Erhöhung nach § 558 BGB ist ausgeschlossen.';
    case 'VERTRAG_ENDET_VORHER':
      return 'Der Vertrag endet vor dem Wirksamwerden der Erhöhung.';
    case 'NICHT_OFFEN':
      return 'Das Verlangen ist nicht mehr offen. Bitte den Dialog neu öffnen.';
    case 'NOCH_NICHT_WIRKSAM':
      // Meist am Monatsersten kurz nach Mitternacht: Die Datenbank rechnet in UTC noch mit dem Vortag
      return 'Die Erhöhung wird heute früh automatisch übernommen.';
    case 'NICHT_ZUGESTIMMT':
      return 'Der Vorgang ist nicht mehr als zugestimmt erfasst. Bitte den Dialog neu öffnen.';
    case 'SCHON_VEREINBART':
      return 'Für diesen Vertrag ist schon eine Erhöhung vereinbart. Eine weitere ist erst nach deren Wirksamwerden möglich.';
    case 'NUR_UEBER_ZURUECKNEHMEN':
      return 'Eine Zustimmung lässt sich nur über „Zustimmung zurücknehmen“ aufheben.';
    case 'NICHT_GEFUNDEN':
      return 'Vorgang oder Vertrag wurde nicht gefunden. Bitte den Dialog neu öffnen.';
    case 'NUR_ADMIN':
      return 'Nur Administratoren dürfen Mieterhöhungen erfassen.';
    default:
      return ersatz || 'Die Mieterhöhung konnte nicht gespeichert werden.';
  }
}
