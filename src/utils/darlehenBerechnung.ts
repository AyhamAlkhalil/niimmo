/**
 * Darlehen: Restschuld, Zins und Tilgung Monat für Monat — eine Rechnung für Objektansicht,
 * Darlehensverwaltung und Suche.
 *
 * So rechnet die Sparkasse. Am 22.10.2026 gegen die Kontoauszüge März bis September 2026 geprüft:
 * Bei allen zwölf Annuitätendarlehen stimmt jede Buchung centgenau.
 * - Die Rate ist zum Monatsende fällig („TILGUNG PER 30.09.2026", im Februar der letzte Tag).
 * - Zins = Restschuld × Zinssatz ÷ 12, kaufmännisch auf den Cent gerundet (30/360).
 * - Der Rest der Rate tilgt; die letzte Rate ist nur noch Zins plus Restschuld.
 *
 * Ausgangspunkt ist die Restschuld zum Stichtag (`darlehen.restschuld_stichtag`): der Stand nach allen
 * Raten, die bis dahin fällig waren. Bis zum 22.10.2026 gab es keinen Stichtag — die Restschuld stand
 * still auf dem Wert von Ende Februar, und der Tilgungsplan begann jeden Monat neu mit diesem Wert.
 *
 * Gerechnet wird in Cent, damit sich über 300 Raten keine Rundungsfehler aufsummieren.
 */

export interface DarlehenKonditionen {
  restschuld: number | null;
  restschuld_stichtag: string | null;
  zinssatz_prozent: number | null;
  monatliche_rate: number | null;
  /** „Laufzeit bis": Der Plan endet dort, eine Restschuld ist dann auf einmal fällig. */
  ende_datum?: string | null;
}

export interface PlanRate {
  /** Fälligkeit als ISO-Datum. */
  faellig: string;
  rate: number;
  zins: number;
  tilgung: number;
  /** Restschuld nach dieser Rate. */
  restschuld: number;
}

/**
 * - `tilgt`: Der Plan endet bei 0 oder am Laufzeitende.
 * - `nur_zins`: Die Rate deckt genau die Zinsen — endfällig, die Restschuld bleibt stehen.
 * - `zu_lang`: Die Rate tilgt, aber nicht innerhalb von 50 Jahren.
 * - `zins_nicht_gedeckt`: Die Rate ist kleiner als der Zins, die Schuld wüchse.
 * - `getilgt`: Es ist nichts mehr offen.
 * - `unvollstaendig`: Restschuld, Zinssatz oder Rate fehlen.
 */
export type PlanStatus = 'tilgt' | 'nur_zins' | 'zu_lang' | 'zins_nicht_gedeckt' | 'getilgt' | 'unvollstaendig';

export interface Tilgungsplan {
  status: PlanStatus;
  raten: PlanRate[];
  /** Restschuld nach der letzten Rate des Plans. */
  restschuldAmEnde: number | null;
  /** Der Plan endet am Laufzeitende, nicht weil die Schuld getilgt ist. */
  endetAmLaufzeitende: boolean;
}

/** Obergrenze für den Plan: 50 Jahre. */
const MAX_RATEN = 600;

const pad = (n: number) => String(n).padStart(2, '0');
const cent = (euro: number) => Math.round(euro * 100);
const euro = (cents: number) => cents / 100;

/** Fälligkeit der Rate eines Monats (1–12): der 30., im Februar der letzte Tag. */
export function faelligkeit(jahr: number, monat: number): string {
  const letzterTag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return `${jahr}-${pad(monat)}-${pad(Math.min(30, letzterTag))}`;
}

function folgemonat([jahr, monat]: [number, number]): [number, number] {
  return monat === 12 ? [jahr + 1, 1] : [jahr, monat + 1];
}

/** Monat der ersten Rate, die nach dem Stichtag fällig wird. */
function ersterRatenmonat(stichtag: string): [number, number] {
  const monat: [number, number] = [Number(stichtag.slice(0, 4)), Number(stichtag.slice(5, 7))];
  return stichtag >= faelligkeit(...monat) ? folgemonat(monat) : monat;
}

/** Monatszins in Cent; der Satz in Zehntausendstel Prozent (4,07 % → 40700). */
function monatszins(restCent: number, satz: number): number {
  return Math.round((restCent * satz) / 12_000_000);
}

/** Alle Raten ab dem ersten Monat nach dem Stichtag, bis die Schuld getilgt oder das Laufzeitende erreicht ist. */
export function berechneTilgungsplan(d: DarlehenKonditionen, stichtag: string): Tilgungsplan {
  const leer = (status: PlanStatus, rest: number | null): Tilgungsplan => ({
    status,
    raten: [],
    restschuldAmEnde: rest,
    endetAmLaufzeitende: false,
  });
  if (d.restschuld == null) return leer('unvollstaendig', null);
  let rest = cent(d.restschuld);
  if (rest <= 0) return leer('getilgt', 0);
  const rate = cent(d.monatliche_rate ?? 0);
  if (d.zinssatz_prozent == null || d.zinssatz_prozent < 0 || rate <= 0) return leer('unvollstaendig', euro(rest));

  const satz = Math.round(d.zinssatz_prozent * 10_000);
  if (rate < monatszins(rest, satz)) return leer('zins_nicht_gedeckt', euro(rest));
  const nurZins = rate === monatszins(rest, satz);

  const raten: PlanRate[] = [];
  let monat = ersterRatenmonat(stichtag);
  let endetAmLaufzeitende = false;
  while (rest > 0 && raten.length < MAX_RATEN) {
    const faellig = faelligkeit(...monat);
    if (d.ende_datum && faellig > d.ende_datum) {
      endetAmLaufzeitende = true;
      break;
    }
    const zins = monatszins(rest, satz);
    const tilgung = Math.min(rate - zins, rest);
    rest -= tilgung;
    raten.push({ faellig, rate: euro(zins + tilgung), zins: euro(zins), tilgung: euro(tilgung), restschuld: euro(rest) });
    monat = folgemonat(monat);
  }

  const status: PlanStatus = nurZins ? 'nur_zins' : rest > 0 && !endetAmLaufzeitende ? 'zu_lang' : 'tilgt';
  return { status, raten, restschuldAmEnde: euro(rest), endetAmLaufzeitende };
}

export interface DarlehenStand {
  status: PlanStatus;
  /** Die Restschuld ist ohne Stichtag gepflegt und wird als heutiger Stand genommen. */
  ohneStichtag: boolean;
  /** Restschuld nach allen Raten, die bis heute fällig waren. */
  restschuld: number | null;
  /** Nächste Rate mit Zins- und Tilgungsanteil. */
  naechsteRate: PlanRate | null;
  /** Seit dem Stichtag fällig gewordene Raten — für den Abgleich mit dem Kontoauszug. */
  faelligeRaten: PlanRate[];
  /** Raten ab heute bis zum Ende des Plans. */
  kommendeRaten: PlanRate[];
  /** Fälligkeit der letzten Rate, wenn das Darlehen damit getilgt ist. */
  getilgtAm: string | null;
  /** Restschuld am Laufzeitende, wenn dann noch etwas offen ist. */
  restschuldAmLaufzeitende: number | null;
  /** Das Laufzeitende ist erreicht und es ist noch etwas offen — die Anschlussfinanzierung fehlt in den Daten. */
  laufzeitAbgelaufen: boolean;
  /** Zinsen aller kommenden Raten; ohne absehbares Ende (endfällig ohne Laufzeitende) null. */
  zinsenBisEnde: number | null;
}

/** Stand eines Darlehens am Tag `heute` (ISO-Datum). */
export function darlehenStand(d: DarlehenKonditionen, heute: string): DarlehenStand {
  const ohneStichtag = d.restschuld != null && !d.restschuld_stichtag;
  const plan = berechneTilgungsplan(d, d.restschuld_stichtag || heute);
  const stand: DarlehenStand = {
    status: plan.status,
    ohneStichtag,
    restschuld: plan.status === 'getilgt' ? 0 : d.restschuld,
    naechsteRate: null,
    faelligeRaten: [],
    kommendeRaten: [],
    getilgtAm: null,
    restschuldAmLaufzeitende: null,
    laufzeitAbgelaufen: false,
    zinsenBisEnde: plan.status === 'getilgt' ? 0 : null,
  };

  const faellige = plan.raten.filter((r) => r.faellig <= heute);
  const kommende = plan.raten.filter((r) => r.faellig > heute);
  stand.faelligeRaten = faellige;
  stand.kommendeRaten = kommende;
  stand.naechsteRate = kommende[0] ?? null;
  if (faellige.length > 0) stand.restschuld = faellige[faellige.length - 1].restschuld;
  if (stand.restschuld === 0) stand.status = 'getilgt';
  if (plan.restschuldAmEnde === 0 && plan.raten.length > 0) stand.getilgtAm = plan.raten[plan.raten.length - 1].faellig;
  // Endet die Laufzeit vor der ersten Rate nach dem Stichtag, ist der Plan leer — die Restschuld steht trotzdem fest.
  if (plan.endetAmLaufzeitende && plan.restschuldAmEnde) {
    stand.restschuldAmLaufzeitende = plan.restschuldAmEnde;
    stand.laufzeitAbgelaufen = !!d.ende_datum && d.ende_datum <= heute;
  }
  if (hatAbsehbaresEnde(stand, d)) {
    stand.zinsenBisEnde = euro(kommende.reduce((s, r) => s + cent(r.zins), 0));
  }
  return stand;
}

export interface DarlehenSumme {
  restschuld: number;
  rate: number;
  zins: number;
  tilgung: number;
  /**
   * Raten, die sich nicht in Zins und Tilgung aufteilen lassen: Konditionen unvollständig oder die Laufzeit
   * ist abgelaufen, ohne dass eine Anschlussfinanzierung eingetragen ist. Gezählt wird die hinterlegte Rate —
   * wie in der Mietaufstellung für die Bank —, damit der Überschuss nicht zu hoch ausfällt.
   */
  ohneAufteilung: number;
  /** Darlehen ohne Restschuld; die Summe ist dann zu niedrig. */
  ohneRestschuld: number;
}

/** Summen über mehrere Darlehen: Restschuld heute und die nächste Rate mit ihrer Aufteilung. */
export function summiereDarlehen(darlehen: { stand: DarlehenStand; monatliche_rate: number | null }[]): DarlehenSumme {
  const s = { restschuld: 0, rate: 0, zins: 0, tilgung: 0, ohneAufteilung: 0, ohneRestschuld: 0 };
  for (const { stand, monatliche_rate } of darlehen) {
    if (stand.restschuld == null) s.ohneRestschuld += 1;
    s.restschuld += cent(stand.restschuld ?? 0);
    const ohneAufteilung =
      stand.status === 'unvollstaendig' || stand.status === 'zins_nicht_gedeckt' || stand.laufzeitAbgelaufen;
    if (stand.naechsteRate) {
      s.rate += cent(stand.naechsteRate.rate);
      s.zins += cent(stand.naechsteRate.zins);
      s.tilgung += cent(stand.naechsteRate.tilgung);
    } else if (ohneAufteilung && monatliche_rate) {
      s.rate += cent(monatliche_rate);
      s.ohneAufteilung += cent(monatliche_rate);
    }
  }
  return {
    restschuld: euro(s.restschuld),
    rate: euro(s.rate),
    zins: euro(s.zins),
    tilgung: euro(s.tilgung),
    ohneAufteilung: euro(s.ohneAufteilung),
    ohneRestschuld: s.ohneRestschuld,
  };
}

function hatAbsehbaresEnde(stand: DarlehenStand, d: DarlehenKonditionen): boolean {
  if (stand.status === 'tilgt' || stand.status === 'getilgt') return true;
  return stand.status === 'nur_zins' && !!d.ende_datum;
}

/** Ob die kommenden Raten ein Ende haben und damit in einen Zahlungsplan gehören. */
export function gehoertInZahlungsplan(stand: DarlehenStand): boolean {
  return stand.kommendeRaten.length > 0 && stand.zinsenBisEnde != null;
}

export interface PlanZeitraum {
  /** „2026-10" je Monat, „2026" je Jahr. */
  schluessel: string;
  /** Erste und letzte Fälligkeit im Zeitraum. */
  von: string;
  bis: string;
  rate: number;
  zins: number;
  tilgung: number;
  /** Summe der Restschulden am Ende des Zeitraums. */
  restschuld: number;
}

/**
 * Kommende Raten mehrerer Darlehen, je Monat oder je Jahr zusammengefasst — der Zahlungsplan eines
 * Objekts. Darlehen ohne absehbares Ende (endfällig ohne Laufzeitende) gehören nicht hinein.
 */
export function zahlungsplan(staende: DarlehenStand[], je: 'monat' | 'jahr'): PlanZeitraum[] {
  const plaene = staende.filter(gehoertInZahlungsplan);
  const schluessel = (faellig: string) => (je === 'monat' ? faellig.slice(0, 7) : faellig.slice(0, 4));

  const zeitraeume = new Map<string, { von: string; bis: string; rate: number; zins: number; tilgung: number }>();
  // Je Darlehen: Restschuld (in Cent) nach seiner letzten Rate in einem Zeitraum
  const restJeDarlehen = plaene.map(() => new Map<string, number>());
  plaene.forEach((stand, i) => {
    for (const r of stand.kommendeRaten) {
      const k = schluessel(r.faellig);
      const z = zeitraeume.get(k) ?? { von: r.faellig, bis: r.faellig, rate: 0, zins: 0, tilgung: 0 };
      if (r.faellig < z.von) z.von = r.faellig;
      if (r.faellig > z.bis) z.bis = r.faellig;
      z.rate += cent(r.rate);
      z.zins += cent(r.zins);
      z.tilgung += cent(r.tilgung);
      zeitraeume.set(k, z);
      restJeDarlehen[i].set(k, cent(r.restschuld));
    }
  });

  const zuletzt = plaene.map((s) => cent(s.restschuld ?? 0));
  return [...zeitraeume.keys()].sort().map((k) => {
    const z = zeitraeume.get(k)!;
    restJeDarlehen.forEach((m, i) => {
      if (m.has(k)) zuletzt[i] = m.get(k)!;
    });
    return {
      schluessel: k,
      von: z.von,
      bis: z.bis,
      rate: euro(z.rate),
      zins: euro(z.zins),
      tilgung: euro(z.tilgung),
      restschuld: euro(zuletzt.reduce((s, c) => s + c, 0)),
    };
  });
}

export interface KontoauszugBuchung {
  buchungsdatum: string;
  betrag: number;
  verwendungszweck: string | null;
}

export interface KontoauszugRate {
  buchungsdatum: string;
  /** Fälligkeit laut „TILGUNG PER 30.09.2026"; ohne den Vermerk null. */
  faellig: string | null;
  rate: number;
  zins: number | null;
  tilgung: number | null;
}

const deBetrag = (text: string) => Number(text.replace(/\./g, '').replace(',', '.'));

/**
 * Liest eine Darlehensrate aus dem Kontoauszug. Die Sparkasse schreibt in den Verwendungszweck
 * „RECHN.ZINS 6.002,35 TILG./ENTG. 2.311,97 TILGUNG PER 30.09.2026"; ein endfälliges Darlehen
 * („DARLEHENSABSCHLUSS") trägt nur den Betrag.
 */
export function leseKontoauszugRate(b: KontoauszugBuchung): KontoauszugRate {
  const text = b.verwendungszweck ?? '';
  const zins = text.match(/RECHN\.ZINS (\d{1,3}(?:\.\d{3})*,\d{2})/);
  const tilgung = text.match(/TILG\.\/ENTG\. (\d{1,3}(?:\.\d{3})*,\d{2})/);
  const per = text.match(/TILGUNG PER \d{2}\.(\d{2})\.(\d{4})/);
  return {
    buchungsdatum: b.buchungsdatum,
    faellig: per ? faelligkeit(Number(per[2]), Number(per[1])) : null,
    rate: Math.abs(b.betrag),
    zins: zins ? deBetrag(zins[1]) : null,
    tilgung: tilgung ? deBetrag(tilgung[1]) : null,
  };
}

export interface Abgleich {
  /** Raten seit dem Stichtag, zu denen eine Buchung gefunden wurde. */
  geprueft: number;
  /** Fälligkeit der jüngsten geprüften Rate. */
  bis: string | null;
  /** Erste Buchung, die nicht zum Plan passt. */
  abweichung: { buchung: KontoauszugRate; plan: PlanRate } | null;
}

const TAG_MS = 86_400_000;
const tageZwischen = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / TAG_MS;
const gleich = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Prüft den Plan gegen die Buchungen seit dem Stichtag. Eine Buchung gehört zur Rate ihres
 * „TILGUNG PER"-Datums; fehlt es, zur Rate, deren Fälligkeit höchstens fünf Tage entfernt liegt
 * (fällt der 30. aufs Wochenende, bucht die Bank am Werktag davor oder danach). Trägt das Konto
 * den Vermerk, ist eine Buchung ohne ihn keine Rate (Sondertilgung, Gebühr) und bleibt außen vor —
 * eine Sondertilgung fällt dann an der nächsten Rate auf, deren Zins nicht mehr zum Plan passt.
 */
export function gleicheMitKontoauszugAb(stand: DarlehenStand, buchungen: KontoauszugRate[]): Abgleich {
  const ergebnis: Abgleich = { geprueft: 0, bis: null, abweichung: null };
  const mitVermerk = buchungen.some((b) => b.faellig);
  const geprueft = new Set<string>();
  const sortiert = [...buchungen].sort((a, b) => (a.faellig ?? a.buchungsdatum).localeCompare(b.faellig ?? b.buchungsdatum));
  for (const buchung of sortiert) {
    if (mitVermerk && !buchung.faellig) continue;
    const plan = buchung.faellig
      ? stand.faelligeRaten.find((r) => r.faellig === buchung.faellig)
      : stand.faelligeRaten.find((r) => tageZwischen(r.faellig, buchung.buchungsdatum) <= 5);
    if (!plan) continue;
    geprueft.add(plan.faellig);
    ergebnis.geprueft = geprueft.size;
    if (!ergebnis.bis || plan.faellig > ergebnis.bis) ergebnis.bis = plan.faellig;
    const passt =
      gleich(buchung.rate, plan.rate) &&
      (buchung.zins == null || gleich(buchung.zins, plan.zins)) &&
      (buchung.tilgung == null || gleich(buchung.tilgung, plan.tilgung));
    if (!passt && !ergebnis.abweichung) ergebnis.abweichung = { buchung, plan };
  }
  return ergebnis;
}
