// Shared calculation logic from MietvertragDetailsModal
import { format } from 'date-fns';
import { getVertragsende } from '@/utils/contractUtils';

/**
 * Forderungen, deren Fälligkeit (faelligkeitsdatum, DB) am Stichtag erreicht ist.
 *
 * Die Rückstandsliste rechnet nur mit diesen, die Mahnung bekam bis zum 27.10.2026 alle:
 * Vom 1. bis 7. jedes Monats (Fälligkeit ist der 8.) war der Mahnbetrag um eine volle
 * Monatsmiete zu hoch, und ab Stufe 3 begründete die aufgerundete Monatszahl im Schreiben
 * die fristlose Kündigung. Ohne Fälligkeitsdatum zählt eine Forderung nicht (wie bisher
 * in der Rückstandsliste).
 *
 * Ein BKA-Guthaben (typ BKA, negativ) zählt ab seinem Monat. Der DB-Trigger setzt bei BKA-Einträgen
 * die Fälligkeit auf Anlage + 30 Tage; bis zum 28.10.2026 galt das auch für Guthaben. Zahlte der
 * Vermieter es aus, stand die Auszahlung sofort im Konto, die Gutschrift erst 30 Tage später — so
 * lange zeigten Liste und Mahnung den Betrag als Rückstand. Eine Minderung (typ Miete, negativ)
 * folgt dagegen der Fälligkeit ihrer Monatsmiete.
 */
export function nurFaelligeForderungen<
  T extends {
    faelligkeitsdatum?: string | null;
    sollmonat?: string | null;
    sollbetrag?: number | string | null;
    typ?: string | null;
  }
>(
  forderungen: readonly T[],
  stichtag: Date = new Date()
): T[] {
  const heute = format(stichtag, 'yyyy-MM-dd');
  return forderungen.filter((f) => {
    if (f.faelligkeitsdatum && f.faelligkeitsdatum.slice(0, 10) <= heute) return true;
    return f.typ === 'BKA' && Number(f.sollbetrag) < 0 && !!f.sollmonat && f.sollmonat.slice(0, 10) <= heute;
  });
}

/** Auf Cent; Summen aus Gleitkommazahlen ließen Reste wie 3,6e-12 stehen (28.10.2026). */
const aufCent = (betrag: number): number => {
  const gerundet = Math.round(betrag * 100) / 100;
  return gerundet === 0 ? 0 : gerundet; // kein „-0“
};

export interface KontoForderung {
  sollmonat?: string | null;
  sollbetrag?: number | string | null;
  faelligkeitsdatum?: string | null;
  typ?: string | null;
  /** Gesetzt bei Rücklastschrift-Gebühren (DB-Trigger create_ruecklastschrift_forderung) */
  ruecklastschrift_am?: string | null;
}

/**
 * Die reguläre Monatsmiete der Sollstellung — nicht BKA, keine Rücklastschrift-Gebühr, nicht negativ (eine
 * erlassene Miete über 0 € zählt, eine eigene Gutschrift nicht). Nur sie zeigt an, dass ein Monat angelegt
 * ist: Eine Gebühr mit sollmonat im Folgemonat (Rücklastschrift ab dem 28.) hätte sonst die erwartete
 * Folgemiete auf 0 gesetzt (Review 29.10.2026).
 */
export const istMonatsmiete = (f: KontoForderung): boolean =>
  (f.typ ?? 'Miete') !== 'BKA' && !f.ruecklastschrift_am && (Number(f.sollbetrag) || 0) >= 0;

/** Die Monatsmiete ist am 8. fällig: sollmonat + 7 Tage (DB-Trigger set_faelligkeitsdatum_trigger). */
const FAELLIGKEITSTAG = 8;

export interface KontoZahlung {
  betrag?: number | string | null;
  buchungsdatum?: string | null;
  kategorie?: string | null;
  zugeordneter_monat?: string | null;
}

/** Zahlungen, die das Mietkonto ausgleichen: Miete, Rücklastschrift und BKA-Zahlungen. */
export const zaehltImMietkonto = (z: KontoZahlung): boolean =>
  !!z.buchungsdatum &&
  (z.kategorie === 'Miete' || z.kategorie === 'Rücklastschrift' || z.kategorie === 'Betriebskostenabrechnung');

/**
 * Als Betriebskostenabrechnung gebuchte Zahlungen sind für die BKA bestimmt (§ 366 Abs. 1 BGB): Was sie
 * über die fälligen BKA-Nachzahlungen hinaus zahlen, deckt zuerst noch nicht fällige BKA-Nachzahlungen;
 * erst was auch darüber hinausgeht, steht dem Mietkonto zur Verfügung. Bis zum 29.10.2026 senkte eine
 * vorab bezahlte BKA-Nachzahlung den Mietrückstand und den Mahnbetrag (Review). Ein fälliges BKA-Guthaben
 * ist keine Zahlung und zählt hier nicht mit.
 */
export function bkaVorauszahlung(
  faellig: readonly KontoForderung[],
  nichtFaellig: readonly KontoForderung[],
  zahlungen: readonly KontoZahlung[]
): number {
  const istBka = (f: KontoForderung) => f.typ === 'BKA';
  const bkaGezahlt = zahlungen
    .filter((z) => zaehltImMietkonto(z) && z.kategorie === 'Betriebskostenabrechnung')
    .reduce((s, z) => s + (Number(z.betrag) || 0), 0);
  const bkaFaellig = faellig.filter(istBka).reduce((s, f) => s + Math.max(0, Number(f.sollbetrag) || 0), 0);
  const bkaOffen = nichtFaellig.filter(istBka).reduce((s, f) => s + Math.max(0, Number(f.sollbetrag) || 0), 0);
  return aufCent(Math.min(Math.max(0, bkaGezahlt - bkaFaellig), bkaOffen));
}

export interface SollVertrag {
  status?: string | null;
  start_datum?: string | null;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
  kaltmiete?: number | string | null;
  betriebskosten?: number | string | null;
}

/** Läuft der Vertrag in irgendeinem Teil des Monats (JJJJ-MM)? Ohne Ende gilt der Status. */
export function laeuftImMonat(vertrag: SollVertrag | null | undefined, monat: string): boolean {
  if (!vertrag) return false;
  const endeMonat = getVertragsende(vertrag)?.slice(0, 7);
  return (!vertrag.start_datum || vertrag.start_datum.slice(0, 7) <= monat) &&
    (endeMonat ? monat <= endeMonat : vertrag.status !== 'beendet');
}

/**
 * Monatsmiete, wie die Sollstellung sie für den Monat (JJJJ-MM) anlegt: Kaltmiete + Betriebskosten, im
 * Monat von Mietbeginn oder -ende taggenau anteilig, auf Cent gerundet; außerhalb der Laufzeit 0.
 * Nachbildung von generate_monthly_mietforderungen (SQL) für Monate, die sie noch nicht angelegt hat.
 */
export function sollMonatsmiete(vertrag: SollVertrag | null | undefined, monat: string): number {
  if (!vertrag) return 0;
  const jahr = Number(monat.slice(0, 4));
  const mon = Number(monat.slice(5, 7));
  const tage = new Date(jahr, mon, 0).getDate();
  const ende = getVertragsende(vertrag)?.slice(0, 10);
  if (!ende && vertrag.status === 'beendet') return 0;
  const start = vertrag.start_datum?.slice(0, 10);
  if ((start && start.slice(0, 7) > monat) || (ende && ende.slice(0, 7) < monat)) return 0;
  const von = start && start.slice(0, 7) === monat ? Number(start.slice(8, 10)) : 1;
  const bis = ende && ende.slice(0, 7) === monat ? Number(ende.slice(8, 10)) : tage;
  const betrag = (Number(vertrag.kaltmiete) || 0) + (Number(vertrag.betriebskosten) || 0);
  if (von === 1 && bis === tage) return aufCent(betrag);
  return anteilWiePostgres(betrag, tage, Math.max(bis - von + 1, 0));
}

const hochZehn = (n: number): bigint => BigInt(10) ** BigInt(n);
/** Ganzzahlige Division, halb vom Nullpunkt weg gerundet (beide Werte ≥ 0) */
const teileGerundet = (zaehler: bigint, nenner: bigint): bigint => {
  const q = zaehler / nenner;
  return (zaehler % nenner) * BigInt(2) >= nenner ? q + BigInt(1) : q;
};

/**
 * round((betrag / tage) * n, 2) genau wie Postgres numeric (monatsanteil, generate_monthly_mietforderungen):
 * Die Division rundet auf die Stellenzahl aus select_div_scale (16 signifikante Stellen, Basis 10000),
 * das Produkt ist exakt, round() rundet halb vom Nullpunkt weg. Mit Gleitkomma wichen genaue
 * Halbcent-Fälle um 1 Cent ab (QA 29.10.2026: 3.231,65 € · 15/30 ergibt 1.615,83 €, nicht 1.615,82 €).
 */
function anteilWiePostgres(betrag: number, tage: number, n: number): number {
  const cent = BigInt(Math.round(Math.abs(betrag) * 100));
  if (cent === BigInt(0) || n <= 0) return 0;
  const ganz = cent / BigInt(100);
  const gewicht = ganz > BigInt(0) ? Math.floor((ganz.toString().length - 1) / 4) : -1;
  const ersteZiffer = ganz > BigInt(0) ? ganz / hochZehn(gewicht * 4) : (cent % BigInt(100)) * BigInt(100);
  const qGewicht = gewicht - (ersteZiffer <= BigInt(tage) ? 1 : 0);
  const stellen = Math.max(16 - qGewicht * 4, 2);
  const quotient = teileGerundet(cent * hochZehn(stellen), BigInt(100) * BigInt(tage));
  const ergebnisCent = teileGerundet(quotient * BigInt(n), hochZehn(stellen - 2));
  const wert = Number(ergebnisCent) / 100;
  return betrag < 0 ? -wert : wert;
}

export interface RueckstandsBerechnung {
  gesamtForderungen: number;
  gesamtZahlungen: number;
  rueckstand: number;
}

export const calculateMietvertragRueckstand = (
  mietvertrag: any,
  forderungen: readonly any[],
  zahlungen: readonly any[]
): RueckstandsBerechnung => {
  if (!mietvertrag || !forderungen || !zahlungen) {
    return { gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 };
  }

  // Alle übergebenen Forderungen mit Monat, ohne Fälligkeitsprüfung — die macht der Aufrufer
  // (berechneMietkontostand). Bis zum 28.10.2026 lief hier eine „Vorauszahlungs-Verschiebung“, die
  // nur zugeordneter_monat umschrieb und die Summe nie änderte; bei Zahlungen ohne id ersetzte sie
  // eine durch die andere.
  const gesamtForderungen = forderungen
    .filter((f) => f.sollmonat)
    .reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);

  // Unkategorisierte Zahlungen zählen nicht als Miete; BKA-Zahlungen gleichen BKA-Forderungen aus
  const gesamtZahlungen = zahlungen
    .filter(zaehltImMietkonto)
    .reduce((sum, z) => sum + (Number(z.betrag) || 0), 0);

  // Rücklastschrift-Gebühren werden nicht abgezogen: Der DB-Trigger legt dafür eine Forderung an
  const rueckstand = gesamtForderungen - gesamtZahlungen;

  return {
    gesamtForderungen: aufCent(gesamtForderungen),
    gesamtZahlungen: aufCent(gesamtZahlungen),
    rueckstand: aufCent(rueckstand),
  };
};

export interface Mietkontostand extends RueckstandsBerechnung {
  /** Überzahlung, die mit noch nicht fälligen Forderungen verrechnet ist — weder Rückstand noch Guthaben */
  vorauszahlung: number;
  /** Summe der Forderungen, die am Stichtag noch nicht fällig sind */
  nichtFaellig: number;
}

/**
 * Stand des Mietkontos am Stichtag: fällige Forderungen gegen alle Zahlungen. `rueckstand` > 0 ist
 * Rückstand, < 0 Guthaben. Verbindlich für Rückstandsliste, Vertragsdetail und Mahnbetrag.
 *
 * Bis zum 28.10.2026 galt jede Überzahlung als Guthaben. Die Monatsmiete ist erst am 8. fällig, wer
 * vorher zahlt, stand bis dahin mit einer Monatsmiete Guthaben in der Liste: am 05.10.2026 68 Verträge
 * mit 47.127 €, 48 davon nur wegen pünktlich gezahlter Oktobermiete. Ebenso Zahlungen ab dem 28., die
 * die Datenbank schon dem Folgemonat zuordnet (calculate_zugeordneter_monat), bevor die Sollstellung
 * am 1. dessen Forderung anlegt.
 *
 * Jetzt gilt als Vorauszahlung, was seit dem letzten Fälligkeitstag eingezahlt wurde und die kommende
 * Miete deckt; Guthaben ist, was darüber hinausgeht oder schon vorher bestand. Der Rückstand bleibt
 * unverändert: Zahlungen tilgen zuerst die fällige Schuld (§ 366 Abs. 2 BGB).
 */
export function berechneMietkontostand(
  mietvertrag: unknown,
  forderungen: readonly KontoForderung[],
  zahlungen: readonly KontoZahlung[],
  stichtag: Date = new Date()
): Mietkontostand {
  if (!mietvertrag || !forderungen || !zahlungen) {
    return { gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0, vorauszahlung: 0, nichtFaellig: 0 };
  }
  const heute = format(stichtag, 'yyyy-MM-dd');
  const mitMonat = forderungen.filter((f) => f.sollmonat);
  const faellig = nurFaelligeForderungen(mitMonat, stichtag);
  const basis = calculateMietvertragRueckstand(mietvertrag, faellig, zahlungen);

  // Noch nicht fällig ist, was eine Fälligkeit nach dem Stichtag hat; ohne Datum zählt eine Forderung nirgends
  const zaehltSchon = new Set(faellig);
  const nichtFaellige = mitMonat.filter(
    (f) => !zaehltSchon.has(f) && !!f.faelligkeitsdatum && f.faelligkeitsdatum.slice(0, 10) > heute
  );
  const summeNichtFaellig = nichtFaellige.reduce((s, f) => s + (Number(f.sollbetrag) || 0), 0);
  const nichtFaellig = aufCent(summeNichtFaellig);

  // Eine vorab bezahlte BKA-Nachzahlung steht für die BKA bereit und mindert den Mietrückstand nicht
  const vorausBka = bkaVorauszahlung(faellig, nichtFaellige, zahlungen);
  const saldo = aufCent(basis.rueckstand + vorausBka);
  if (saldo >= 0) {
    return { ...basis, rueckstand: saldo, vorauszahlung: vorausBka, nichtFaellig };
  }

  // Vorauszahlung auf die Miete ist nur, was nach dem letzten Fälligkeitstag eingezahlt oder ausdrücklich
  // einem kommenden Monat zugeordnet wurde und die kommende Miete deckt; was davor schon zu viel war,
  // bleibt Guthaben. Der Zahltag entscheidet, nicht der Trigger-Monat: Die DB ordnet erst ab dem 28. dem
  // Folgemonat zu, gezahlt wird die Folgemiete aber ab etwa dem 16. (28.10.2026 live: 320 € am 25.,
  // 725 € am 25., 100 € am 21.). BKA-Zahlungen sind oben schon verrechnet.
  const monat = heute.slice(0, 7);
  const kommenderMonat = stichtag.getDate() >= FAELLIGKEITSTAG
    ? format(new Date(stichtag.getFullYear(), stichtag.getMonth() + 1, 1), 'yyyy-MM')
    : monat;
  const letzterFaelligkeitstag = format(
    new Date(stichtag.getFullYear(), stichtag.getMonth() - (stichtag.getDate() >= FAELLIGKEITSTAG ? 0 : 1), FAELLIGKEITSTAG),
    'yyyy-MM-dd'
  );
  // Rücklastschriften heben eine Zahlung auf; Auszahlungen und Erstattungen sind keine Vorauszahlung
  const seitherGezahlt = Math.max(
    0,
    zahlungen
      .filter((z) =>
        zaehltImMietkonto(z) &&
        z.kategorie !== 'Betriebskostenabrechnung' &&
        ((z.buchungsdatum as string).slice(0, 10) > letzterFaelligkeitstag ||
          (typeof z.zugeordneter_monat === 'string' && z.zugeordneter_monat.slice(0, 7) >= kommenderMonat))
      )
      .reduce((s, z) => {
        const betrag = Number(z.betrag) || 0;
        return s + (betrag > 0 || z.kategorie === 'Rücklastschrift' ? betrag : 0);
      }, 0)
  );

  // Gedeckt wird, was angelegt und noch nicht fällig ist, und die kommende Monatsmiete, solange die
  // Sollstellung (05:00 UTC am 1.) sie noch nicht angelegt hat: ab dem 8. die des Folgemonats, davor die
  // des laufenden. Dazu Zahlungen auf spätere Monate ohne Monatsmiete. Nie außerhalb der Laufzeit.
  const vertrag = mietvertrag as SollVertrag;
  const laeuftIm = (m: string) => laeuftImMonat(vertrag, m);
  const mietmonate = new Set(mitMonat.filter(istMonatsmiete).map((f) => (f.sollmonat as string).slice(0, 7)));
  // Erwartet wird genau, was die Sollstellung anlegen wird (Vertragsmiete, anteilig bei Beginn/Ende)
  const kommendeMiete = mietmonate.has(kommenderMonat) ? 0 : Math.max(0, sollMonatsmiete(vertrag, kommenderMonat));
  const aufSpaetereMonate = zahlungen
    .filter((z) => {
      if (!zaehltImMietkonto(z) || z.kategorie === 'Betriebskostenabrechnung' || typeof z.zugeordneter_monat !== 'string') return false;
      const m = z.zugeordneter_monat.slice(0, 7);
      return m > kommenderMonat && !mietmonate.has(m) && laeuftIm(m);
    })
    .reduce((s, z) => s + (Number(z.betrag) || 0), 0);
  const deckung = Math.max(0, summeNichtFaellig - vorausBka) + kommendeMiete + Math.max(0, aufSpaetereMonate);

  const vorausMiete = aufCent(Math.min(-saldo, deckung, seitherGezahlt));
  const vorauszahlung = aufCent(vorausBka + vorausMiete);

  return { ...basis, rueckstand: aufCent(saldo + vorausMiete), vorauszahlung, nichtFaellig };
}

// Einfache Berechnung für Miete-Zahlungen (alle mit Kategorie "Miete")
export const calculateMieteZahlungen = (zahlungen: any[]): number => {
  return zahlungen
    .filter(z => z.kategorie === 'Miete')
    .reduce((sum, z) => sum + (Number(z.betrag) || 0), 0);
};

// Berechnung der gesamten Rücklastschrift-Gebühren
export const calculateRuecklastschriftGebuehren = (zahlungen: any[]): number => {
  return zahlungen
    .filter(z => z.kategorie === 'Rücklastschrift')
    .reduce((sum, z) => sum + (Number(z.ruecklastschrift_gebuehr) || 0), 0);
};

/**
 * Betrag einer Forderung aus dem Bearbeitungsfeld der Vertragsansicht (MietvertragTimelineView).
 * Negativ ist erlaubt (BKA-Guthaben), 0 auch (bewusst erlassen) — leer oder unlesbar nicht:
 * Bis zum 27.10.2026 wurde daraus per `parseFloat(...) || 0` still eine Forderung über 0 €.
 */
export function leseForderungsbetrag(text: string): number | null {
  const roh = text.trim().replace(/^(-?\d+),(\d*)$/, '$1.$2');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(roh)) return null;
  const betrag = Math.round(Number(roh) * 100) / 100;
  if (!Number.isFinite(betrag)) return null;
  return betrag === 0 ? 0 : betrag; // kein „-0,00“
}
