import { format } from 'date-fns';
import { laeuftImMonat } from './rueckstandsberechnung';
import { vertragsMonatsmiete, type MonatsmieteVertrag } from './vertragsMonatsmiete';

/**
 * Soll-Miete des Folgemonats für den Pfeil an den Kennzahlen der Startseite (29.10.2026, Kunde: „Pfeil ist einfach
 * nur damit man sieht, ob es nächsten Monat mehr wird oder weniger“). Gerechnet wie die Soll-Miete dieses Monats:
 * je laufendem Vertrag (aktiv, gekündigt) die im Folgemonat gültige Miete, bei Ein- oder Auszug anteilig.
 *
 * Gültig im Folgemonat ist die Miete des Vertrags, dazu, was zum Ersten des Folgemonats im Voraus vereinbart und
 * noch nicht übernommen ist — so stellt die Datenbank vor der Sollstellung um:
 * - zugestimmter Erhöhungsvorgang, wirksam spätestens am Ersten (mieterhoehungen_anwenden; Betriebskosten nur, wenn
 *   das Verlangen sie ändert, wie mieterhoehung_anwenden_intern);
 * - Staffelstufe, gültig spätestens am Ersten (staffelmieten_anwenden, lesbare Stufen wie die SQL-Funktion
 *   staffelstufen).
 * Eine Erhöhung, die erst ab dem 2. des Folgemonats gilt, zählt dort noch nicht (Trigger
 * update_forderungen_on_rent_change: ab dem Monat danach).
 */
export interface FolgemonatVertrag extends MonatsmieteVertrag {
  mietanpassung_art?: string | null;
  staffelplan?: unknown;
}

export interface Mieterhoehungsvorgang {
  mietvertrag_id: string;
  status: string;
  wirksam_ab: string;
  alte_kaltmiete: number | string | null;
  neue_kaltmiete: number | string;
  alte_betriebskosten: number | string | null;
  neue_betriebskosten: number | string | null;
}

export interface SollFolgemonat {
  /** JJJJ-MM */
  monat: string;
  gesamt: number;
  kaltmiete: number;
  betriebskosten: number;
}

const zahl = (wert: unknown): number => {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
};

const rund = (betrag: number): number => {
  const r = Math.round(betrag * 100) / 100;
  return r === 0 ? 0 : r;
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const BETRAG = /^\d+(\.\d+)?$/;

/** Lesbare Stufen eines Staffelplans ([{gueltig_ab, kaltmiete}]) wie die SQL-Funktion staffelstufen */
function staffelstufen(plan: unknown): { gueltigAb: string; kaltmiete: number }[] {
  if (!Array.isArray(plan)) return [];
  const stufen: { gueltigAb: string; kaltmiete: number }[] = [];
  for (const s of plan) {
    if (!s || typeof s !== 'object') continue;
    const { gueltig_ab: gueltigAb, kaltmiete } = s as { gueltig_ab?: unknown; kaltmiete?: unknown };
    const betrag = typeof kaltmiete === 'number' ? kaltmiete : typeof kaltmiete === 'string' && BETRAG.test(kaltmiete) ? Number(kaltmiete) : NaN;
    if (typeof gueltigAb === 'string' && DATUM.test(gueltigAb) && Number.isFinite(betrag) && betrag > 0) {
      stufen.push({ gueltigAb, kaltmiete: betrag });
    }
  }
  return stufen;
}

/** Der Vertrag mit der zum Ersten von `ersterTag` gültigen Miete */
function gueltigAm(v: FolgemonatVertrag, ersterTag: string, vorgaenge: readonly Mieterhoehungsvorgang[]): FolgemonatVertrag {
  const vorgang = vorgaenge
    .filter((m) => m.mietvertrag_id === v.id && m.status === 'zugestimmt' && m.wirksam_ab.slice(0, 10) <= ersterTag)
    .sort((a, b) => a.wirksam_ab.localeCompare(b.wirksam_ab))
    .pop();
  if (vorgang) {
    const bkAendert = vorgang.neue_betriebskosten != null && zahl(vorgang.neue_betriebskosten) !== zahl(vorgang.alte_betriebskosten);
    // Hat sich die Miete seit dem Verlangen geändert, übernimmt der Nachtlauf nicht von selbst (MIETE_GEAENDERT,
    // „Trotzdem übernehmen“ im Dialog) — dann gilt im Folgemonat weiter der Vertrag (Review 29.10.2026)
    const geaendert = zahl(v.kaltmiete) !== zahl(vorgang.alte_kaltmiete) ||
      (bkAendert && zahl(v.betriebskosten) !== zahl(vorgang.alte_betriebskosten));
    if (!geaendert) {
      return { ...v, kaltmiete: zahl(vorgang.neue_kaltmiete), betriebskosten: bkAendert ? zahl(vorgang.neue_betriebskosten) : v.betriebskosten };
    }
  }
  if (v.mietanpassung_art === 'staffel') {
    const stufe = staffelstufen(v.staffelplan)
      .filter((s) => s.gueltigAb <= ersterTag)
      .sort((a, b) => a.gueltigAb.localeCompare(b.gueltigAb))
      .pop();
    const uebernommen = v.letzte_mieterhoehung_am?.slice(0, 10);
    if (stufe && (!uebernommen || stufe.gueltigAb > uebernommen)) return { ...v, kaltmiete: stufe.kaltmiete };
  }
  return v;
}

export function sollFolgemonat(
  vertraege: readonly FolgemonatVertrag[],
  vorgaenge: readonly Mieterhoehungsvorgang[],
  stichtag: Date = new Date()
): SollFolgemonat {
  const ersterTag = format(new Date(stichtag.getFullYear(), stichtag.getMonth() + 1, 1), 'yyyy-MM-dd');
  const monat = ersterTag.slice(0, 7);
  let gesamt = 0;
  let kaltmiete = 0;
  let betriebskosten = 0;
  for (const v of vertraege) {
    if ((v.status !== 'aktiv' && v.status !== 'gekuendigt') || !laeuftImMonat(v, monat)) continue;
    // Keine Forderungen: Für den Folgemonat gibt es noch keine, es gilt allein der Vertrag
    const m = vertragsMonatsmiete(gueltigAm(v, ersterTag, vorgaenge), monat, []);
    gesamt += m.gesamt;
    kaltmiete += m.kaltmiete;
    betriebskosten += m.betriebskosten;
  }
  return { monat, gesamt: rund(gesamt), kaltmiete: rund(kaltmiete), betriebskosten: rund(betriebskosten) };
}
