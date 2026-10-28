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

interface KontoForderung {
  sollmonat?: string | null;
  sollbetrag?: number | string | null;
  faelligkeitsdatum?: string | null;
  typ?: string | null;
}

/** Die Monatsmiete ist am 8. fällig: sollmonat + 7 Tage (DB-Trigger set_faelligkeitsdatum_trigger). */
const FAELLIGKEITSTAG = 8;

interface KontoZahlung {
  betrag?: number | string | null;
  buchungsdatum?: string | null;
  kategorie?: string | null;
  zugeordneter_monat?: string | null;
}

/** Zahlungen, die das Mietkonto ausgleichen: Miete, Rücklastschrift und BKA-Zahlungen. */
const zaehltImMietkonto = (z: KontoZahlung): boolean =>
  !!z.buchungsdatum &&
  (z.kategorie === 'Miete' || z.kategorie === 'Rücklastschrift' || z.kategorie === 'Betriebskostenabrechnung');

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
  /** Überzahlung, die noch nicht fällige Miete deckt — weder Rückstand noch Guthaben */
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
 * Jetzt deckt eine Überzahlung zuerst die noch nicht fälligen Forderungen und die Zahlungen auf
 * künftige Monate (Vorauszahlung); Guthaben ist nur, was darüber hinausgeht. Der Rückstand bleibt
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
  if (basis.rueckstand >= 0) {
    return { ...basis, vorauszahlung: 0, nichtFaellig };
  }

  // Zahlungen auf Monate ohne angelegte Miete: nach dem laufenden Monat, und der laufende bis zum 7.,
  // solange die Sollstellung (05:00 UTC am 1.) ihn noch nicht angelegt hat. Nie nach Vertragsende —
  // dort ist eine Überzahlung echtes Guthaben.
  const monat = heute.slice(0, 7);
  const vertrag = mietvertrag as { status?: string | null; ende_datum?: string | null; kuendigungsdatum?: string | null };
  const endeMonat = getVertragsende(vertrag)?.slice(0, 7);
  const forderungsmonate = new Set(mitMonat.map((f) => (f.sollmonat as string).slice(0, 7)));
  const istKuenftig = (m: string) =>
    (endeMonat ? m <= endeMonat : vertrag.status !== 'beendet') &&
    (m > monat || (m === monat && stichtag.getDate() < FAELLIGKEITSTAG && !forderungsmonate.has(m)));
  const aufKuenftigeMonate = zahlungen
    .filter((z) => zaehltImMietkonto(z) && typeof z.zugeordneter_monat === 'string' && istKuenftig(z.zugeordneter_monat.slice(0, 7)))
    .reduce((s, z) => s + (Number(z.betrag) || 0), 0);

  const offen = Math.max(0, summeNichtFaellig) + Math.max(0, aufKuenftigeMonate);
  const vorauszahlung = aufCent(Math.min(-basis.rueckstand, offen));

  return { ...basis, rueckstand: aufCent(basis.rueckstand + vorauszahlung), vorauszahlung, nichtFaellig };
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
