import { format } from 'date-fns';
import { getVertragsende } from './contractUtils';
import { istMonatsmiete, sollMonatsmiete, type KontoForderung, type SollVertrag } from './rueckstandsberechnung';

/**
 * Monatsmiete eines Vertrags für einen Monat, aus dem Vertrag gerechnet und in Kaltmiete und Betriebskosten
 * aufgeteilt. Basis der Soll-Miete auf der Startseite (29.10.2026, Kunde: „Die Soll-Miete soll aus den
 * Mietverträgen berechnet werden — sie sind die Basis“). Bis dahin summierte monatsSaldo die Forderungen des
 * Monats, darin auch Rücklastschriftgebühren.
 *
 * Kaltmiete + Betriebskosten, im Monat von Mietbeginn oder -ende taggenau anteilig wie die Sollstellung
 * (sollMonatsmiete). Einzige Ausnahme: Eine offizielle Mieterhöhung, im laufenden Monat nach dem Ersten erfasst,
 * gilt erst ab dem Folgemonat (Entscheidung 29.10.2026, Trigger update_forderungen_on_rent_change). Der Vertrag
 * trägt dann schon die neue Miete und speichert die bisherige nicht; sie steht nur noch in der Monatsmiete, die
 * die Sollstellung vorher aus dem Vertrag angelegt hat. Live 29.10.2026: fünf Verträge, am 28.10. erhöht.
 */
export interface MonatsmieteVertrag extends SollVertrag {
  id: string;
  letzte_mieterhoehung_am?: string | null;
}

export interface MonatsmieteForderung extends KontoForderung {
  mietvertrag_id: string | null;
}

export interface VertragsMonatsmiete {
  gesamt: number;
  kaltmiete: number;
  betriebskosten: number;
  /** Monat mit Mietbeginn oder -ende: taggenau anteilig */
  anteilig: boolean;
  /** Erhöhung erst ab dem Folgemonat: In diesem Monat gilt noch die bisherige Miete */
  vorErhoehung: boolean;
}

const zahl = (wert: unknown): number => {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
};

const rund = (betrag: number): number => {
  const r = Math.round(betrag * 100) / 100;
  return r === 0 ? 0 : r;
};

/** Gilt eine Erhöhung des Vertrags erst ab dem Folgemonat von `monat` (JJJJ-MM)? */
export const erhoehungAbFolgemonat = (v: MonatsmieteVertrag, monat: string): boolean => {
  const am = v.letzte_mieterhoehung_am?.slice(0, 10);
  return !!am && am.slice(0, 7) === monat && am.slice(8, 10) !== '01';
};

export function vertragsMonatsmiete(
  v: MonatsmieteVertrag,
  monat: string,
  forderungen: readonly MonatsmieteForderung[]
): VertragsMonatsmiete {
  const kv = zahl(v.kaltmiete);
  const bv = zahl(v.betriebskosten);
  const vm = kv + bv;
  const jahr = Number(monat.slice(0, 4));
  const letzterTag = format(new Date(jahr, Number(monat.slice(5, 7)), 0), 'yyyy-MM-dd');
  const start = v.start_datum?.slice(0, 10);
  const ende = getVertragsende(v)?.slice(0, 10);
  const anteilig = (!!start && start > `${monat}-01`) || (!!ende && ende < letzterTag);

  // Auch im Monat eines Ein- oder Auszugs: Der Trigger lässt die anteilige Monatsmiete bei der bisherigen Miete
  // (Review 29.10.2026; bis dahin nur im vollen Monat, die neue Miete stand dann schon anteilig in der Soll-Miete)
  if (erhoehungAbFolgemonat(v, monat)) {
    // Die Sollstellung legt je Vertrag und Monat eine Monatsmiete an; stehen doch zwei da oder ist sie erlassen
    // (0 €), gilt die höchste — eine erlassene sagt nichts über die bisherige Miete (Review 29.10.2026)
    const bisher = rund(Math.max(0, ...forderungen
      .filter((f) => f.mietvertrag_id === v.id && (f.sollmonat ?? '').slice(0, 7) === monat && istMonatsmiete(f))
      .map((f) => zahl(f.sollbetrag))));
    if (bisher > 0) {
      // Die Erhöhung betrifft die Kaltmiete; die Betriebskosten bleiben die des Vertrags, im anteiligen Monat
      // taggenau wie die Sollstellung
      const bkMonat = anteilig ? sollMonatsmiete({ ...v, kaltmiete: 0 }, monat) : bv;
      const betriebskosten = Math.min(bkMonat, bisher);
      return { gesamt: bisher, kaltmiete: rund(bisher - betriebskosten), betriebskosten, anteilig, vorErhoehung: true };
    }
  }

  const gesamt = sollMonatsmiete(v, monat);
  if (!anteilig) return { gesamt, kaltmiete: rund(gesamt - Math.min(bv, gesamt)), betriebskosten: Math.min(bv, gesamt), anteilig, vorErhoehung: false };
  // Anteilig in ganzen Cent: 877,42 × 200 / 1.600 ergab in Euro gerechnet 109,67 statt 109,68
  const betriebskosten = vm > 0 ? Math.min(Math.round((Math.round(gesamt * 100) * bv) / vm) / 100, gesamt) : 0;
  return { gesamt, kaltmiete: rund(gesamt - betriebskosten), betriebskosten, anteilig, vorErhoehung: false };
}
