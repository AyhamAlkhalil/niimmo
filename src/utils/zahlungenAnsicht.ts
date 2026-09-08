/**
 * Fachlogik der Zahlungsübersicht (Controlboard → „Alle Zahlungen").
 *
 * Bis zum 07.09.2026 lagen Filter, Sortierung und Monatsgruppierung als
 * useMemo-Blöcke in PaymentManagement.tsx (1664 Zeilen, ungetestet). Die
 * Übersicht ist der Massenarbeitsplatz der Buchhaltung; ihre Regeln gehören
 * nach src/utils/ und unter Test (docs/architektur.md §1, §5).
 *
 * Alle Datumsvergleiche laufen über ISO-Strings (yyyy-MM-dd). `new Date("yyyy-MM-dd")`
 * parst als UTC und verschiebt Buchungen an der Monatsgrenze um einen Tag —
 * das war der Grund für den Timezone-Fehler in der alten Zeitraumfilterung.
 */
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { MIETRELEVANTE_KATEGORIEN, kategorieLabel } from './zahlungKategorie';

export interface ZahlungZeile {
  id: string;
  betrag: number;
  /** ISO yyyy-MM-dd */
  buchungsdatum: string;
  /** dd.MM.yyyy, einmal beim Laden vorberechnet */
  buchungsdatum_formatted: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  zugeordneter_monat: string | null;
  kategorie: string | null;
  mietvertrag_id: string | null;
  immobilie_id: string | null;
  immobilie_name: string | null;
  immobilie_adresse: string | null;
  einheit_id: string | null;
  einheit_typ: string | null;
  einheit_etage: string | null;
  mieter_name: string | null;
}

export type ZuordnungsSicht = 'alle' | 'zugeordnet' | 'nicht-zugeordnet';

/** Auswahlwert für „Zahlungen ohne Kategorie" im Kategoriefilter. */
export const OHNE_KATEGORIE = '__ohne__';

export interface ZahlungenFilter {
  suche: string;
  /** null = alle Kategorien; OHNE_KATEGORIE = nur Zahlungen ohne Kategorie */
  kategorie: string | null;
  zuordnung: ZuordnungsSicht;
  von: Date | undefined;
  bis: Date | undefined;
}

export const LEERER_FILTER: ZahlungenFilter = {
  suche: '',
  kategorie: null,
  zuordnung: 'alle',
  von: undefined,
  bis: undefined,
};

export type SortierFeld = 'datum' | 'betrag' | 'kategorie' | 'zuordnung';
export type SortierRichtung = 'asc' | 'desc';
export interface Sortierung {
  feld: SortierFeld;
  richtung: SortierRichtung;
}

export const STANDARD_SORTIERUNG: Sortierung = { feld: 'datum', richtung: 'desc' };

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** „1.250,50 €" — Buchhaltungsformat mit zwei Nachkommastellen. */
export function formatEuro(betrag: number): string {
  return EUR.format(betrag);
}

/** ISO yyyy-MM-dd → dd.MM.yyyy ohne Date-Objekt (keine Zeitzonenverschiebung). */
export function formatIsoDatum(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

/** „2026-09" → „September 2026" */
export function monatsLabel(monatKey: string): string {
  const [y, m] = monatKey.split('-').map(Number);
  if (!y || !m) return monatKey;
  return format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale: de });
}

export function istZugeordnet(z: Pick<ZahlungZeile, 'mietvertrag_id' | 'immobilie_id'>): boolean {
  return Boolean(z.mietvertrag_id || z.immobilie_id);
}

/**
 * Eine Zahlung, die einen Vertrag bräuchte und keinen hat. Nichtmiete oder
 * Ignorieren ohne Bezug ist dagegen kein offener Vorgang.
 */
export function brauchtZuordnung(z: Pick<ZahlungZeile, 'mietvertrag_id' | 'immobilie_id' | 'kategorie'>): boolean {
  return !istZugeordnet(z) && MIETRELEVANTE_KATEGORIEN.has(z.kategorie ?? '');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Tagesgenauer ISO-Stichtag in Ortszeit. */
export function alsIsoTag(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Betragssuche: „1250,50", „1.250,50", „1250.5" und „1250,50 €" treffen
 * dieselbe Buchung, mit und ohne Vorzeichen.
 */
function betragPasst(betrag: number, suche: string): boolean {
  const s = suche.replace(/[\s€]/g, '');
  if (!s || !/^[-\d.,]+$/.test(s)) return false;
  const abs = Math.abs(betrag);
  const varianten = [
    abs.toFixed(2),
    abs.toFixed(2).replace('.', ','),
    String(abs),
    EUR.format(abs).replace(/[\s€]/g, ''),
  ];
  const gesucht = s.replace(/^-/, '');
  return varianten.some((v) => v.includes(gesucht));
}

function textPasst(z: ZahlungZeile, suche: string): boolean {
  const felder = [
    z.verwendungszweck,
    z.empfaengername,
    z.iban,
    z.mieter_name,
    z.immobilie_name,
    z.immobilie_adresse,
    z.kategorie,
    z.zugeordneter_monat,
  ];
  return felder.some((f) => f && f.toLowerCase().includes(suche));
}

export function filtereZahlungen(zahlungen: readonly ZahlungZeile[], filter: ZahlungenFilter): ZahlungZeile[] {
  const suche = filter.suche.trim().toLowerCase();
  const von = filter.von ? alsIsoTag(filter.von) : null;
  const bis = filter.bis ? alsIsoTag(filter.bis) : null;

  return zahlungen.filter((z) => {
    if (suche) {
      if (!textPasst(z, suche) && !betragPasst(z.betrag, suche) && !z.buchungsdatum_formatted.includes(suche)) {
        return false;
      }
    }
    if (filter.kategorie === OHNE_KATEGORIE) {
      if (z.kategorie) return false;
    } else if (filter.kategorie && z.kategorie !== filter.kategorie) {
      return false;
    }
    if (filter.zuordnung === 'zugeordnet' && !istZugeordnet(z)) return false;
    if (filter.zuordnung === 'nicht-zugeordnet' && istZugeordnet(z)) return false;
    if (von && z.buchungsdatum < von) return false;
    if (bis && z.buchungsdatum > bis) return false;
    return true;
  });
}

/** Rang für die Sortierung nach Zuordnung: offene Vorgänge zuerst. */
function zuordnungsRang(z: ZahlungZeile): number {
  if (brauchtZuordnung(z)) return 0;
  if (!istZugeordnet(z)) return 1;
  return 2;
}

const datumAbsteigend = (a: ZahlungZeile, b: ZahlungZeile) => b.buchungsdatum.localeCompare(a.buchungsdatum);

/**
 * Sortiert stabil; gleiche Schlüssel bleiben nach Datum absteigend geordnet,
 * damit z. B. „Betrag aufsteigend" innerhalb gleicher Beträge nicht springt.
 */
export function sortiereZahlungen(zahlungen: readonly ZahlungZeile[], sortierung: Sortierung): ZahlungZeile[] {
  const dir = sortierung.richtung === 'asc' ? 1 : -1;
  let vergleich: (a: ZahlungZeile, b: ZahlungZeile) => number;
  switch (sortierung.feld) {
    case 'betrag':
      vergleich = (a, b) => (a.betrag - b.betrag) * dir;
      break;
    case 'kategorie':
      vergleich = (a, b) => kategorieLabel(a.kategorie).localeCompare(kategorieLabel(b.kategorie), 'de') * dir;
      break;
    case 'zuordnung':
      vergleich = (a, b) => (zuordnungsRang(a) - zuordnungsRang(b)) * dir;
      break;
    case 'datum':
    default:
      vergleich = (a, b) => a.buchungsdatum.localeCompare(b.buchungsdatum) * dir;
  }
  return [...zahlungen].sort((a, b) => vergleich(a, b) || datumAbsteigend(a, b));
}

export interface MonatsGruppe {
  /** yyyy-MM */
  monatKey: string;
  label: string;
  zahlungen: ZahlungZeile[];
  summe: number;
}

export function summeBetraege(zahlungen: readonly Pick<ZahlungZeile, 'betrag'>[]): number {
  return Math.round(zahlungen.reduce((s, z) => s + z.betrag, 0) * 100) / 100;
}

/**
 * Gruppiert nach Buchungsmonat. Die Reihenfolge der Gruppen folgt der
 * Datumsrichtung; innerhalb einer Gruppe bleibt die übergebene Reihenfolge.
 */
export function gruppiereNachMonat(zahlungen: readonly ZahlungZeile[], richtung: SortierRichtung): MonatsGruppe[] {
  const gruppen = new Map<string, ZahlungZeile[]>();
  for (const z of zahlungen) {
    const key = z.buchungsdatum.slice(0, 7);
    const liste = gruppen.get(key);
    if (liste) liste.push(z);
    else gruppen.set(key, [z]);
  }
  const keys = [...gruppen.keys()].sort((a, b) => (richtung === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
  return keys.map((monatKey) => {
    const liste = gruppen.get(monatKey)!;
    return { monatKey, label: monatsLabel(monatKey), zahlungen: liste, summe: summeBetraege(liste) };
  });
}

export type ZeitraumVorgabe = 'dieser-monat' | 'letzter-monat' | 'letzte-3-monate' | 'dieses-jahr' | 'letztes-jahr';

export const ZEITRAUM_VORGABEN: ReadonlyArray<{ wert: ZeitraumVorgabe; label: string }> = [
  { wert: 'dieser-monat', label: 'Dieser Monat' },
  { wert: 'letzter-monat', label: 'Letzter Monat' },
  { wert: 'letzte-3-monate', label: 'Letzte 3 Monate' },
  { wert: 'dieses-jahr', label: 'Dieses Jahr' },
  { wert: 'letztes-jahr', label: 'Letztes Jahr' },
];

export function zeitraumVoreinstellung(vorgabe: ZeitraumVorgabe, heute: Date = new Date()): { von: Date; bis: Date } {
  const j = heute.getFullYear();
  const m = heute.getMonth();
  switch (vorgabe) {
    case 'dieser-monat':
      return { von: new Date(j, m, 1), bis: new Date(j, m + 1, 0) };
    case 'letzter-monat':
      return { von: new Date(j, m - 1, 1), bis: new Date(j, m, 0) };
    case 'letzte-3-monate':
      return { von: new Date(j, m - 2, 1), bis: new Date(j, m + 1, 0) };
    case 'dieses-jahr':
      return { von: new Date(j, 0, 1), bis: new Date(j, 11, 31) };
    case 'letztes-jahr':
    default:
      return { von: new Date(j - 1, 0, 1), bis: new Date(j - 1, 11, 31) };
  }
}

export function hatAktivenFilter(filter: ZahlungenFilter): boolean {
  return Boolean(filter.suche.trim() || filter.kategorie || filter.zuordnung !== 'alle' || filter.von || filter.bis);
}

/**
 * Welche Monate offen gezeigt werden. Standard ist eingeklappt — die
 * Buchhaltung hat sich das am 08.09.2026 ausdrücklich gewünscht: Die Übersicht
 * beginnt mit einer Monatsliste samt Anzahl und Summe, aufgeklappt wird gezielt.
 * Zwei Ausnahmen, damit Treffer nicht versteckt bleiben: Bei einer Textsuche
 * und wenn nur ein Monat übrig ist, sind alle Gruppen offen.
 */
export function effektivOffeneMonate(
  gruppen: readonly Pick<MonatsGruppe, 'monatKey'>[],
  ausgeklappt: ReadonlySet<string>,
  sucheAktiv: boolean
): ReadonlySet<string> {
  if (sucheAktiv || gruppen.length === 1) return new Set(gruppen.map((g) => g.monatKey));
  return ausgeklappt;
}
