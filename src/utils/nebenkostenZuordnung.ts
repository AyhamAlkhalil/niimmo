/**
 * Fachlogik des Reiters „Nebenkosten" in der Zahlungsverwaltung: Ausgaben der
 * Kategorien Nebenkosten und Nichtmiete werden Objekten zugeordnet — von Hand
 * oder über den KI-Vorschlag aus `nebenkosten_klassifizierungen`.
 *
 * Bis zum 10.09.2026 lebte diese Logik in NebenkostenZuordnungTab.tsx (916
 * Zeilen, Kartenliste mit Ziehen und Ablegen, ohne Test). Seitdem nutzt der
 * Reiter dieselbe Tabelle wie „Alle Zahlungen"; hier steht, was daran
 * fachlich ist.
 */
import { ZahlungZeile, formatIsoDatum } from './zahlungenAnsicht';

export type NebenkostenSicht = 'offen' | 'zugeordnet' | 'ausgeblendet';
export type NebenkostenKategorie = 'alle' | 'Nebenkosten' | 'Nichtmiete';
export type KiKonfidenz = 'high' | 'medium' | 'low';

export interface KiVorschlag {
  zahlung_id: string;
  confidence: KiKonfidenz;
  category: string;
  suggested_immobilie_id: string | null;
  suggested_immobilie_name: string | null;
  reasoning: string;
}

/** Rohzeile der Abfrage, mit eingebettetem Objekt. */
export interface NebenkostenZahlungRoh {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  kategorie: string | null;
  immobilie_id: string | null;
  immobilie?: { id: string; name: string | null; adresse: string | null } | null;
}

export function alsZahlungZeile(roh: NebenkostenZahlungRoh): ZahlungZeile {
  return {
    id: roh.id,
    betrag: roh.betrag,
    buchungsdatum: roh.buchungsdatum,
    buchungsdatum_formatted: formatIsoDatum(roh.buchungsdatum),
    verwendungszweck: roh.verwendungszweck,
    empfaengername: roh.empfaengername,
    iban: roh.iban,
    zugeordneter_monat: null,
    kategorie: roh.kategorie,
    mietvertrag_id: null,
    immobilie_id: roh.immobilie_id,
    immobilie_name: roh.immobilie?.name ?? null,
    immobilie_adresse: roh.immobilie?.adresse ?? null,
    einheit_id: null,
    einheit_typ: null,
    einheit_etage: null,
    mieter_name: null,
  };
}

/**
 * In welche Sicht eine Buchung gehört. Ausgeblendet ist nur, was keinen
 * Objektbezug hat und von der Buchhaltung ausdrücklich übersprungen wurde.
 */
export function sichtVon(z: Pick<ZahlungZeile, 'id' | 'immobilie_id'>, ausgeblendet: ReadonlySet<string>): NebenkostenSicht {
  if (z.immobilie_id) return 'zugeordnet';
  if (ausgeblendet.has(z.id)) return 'ausgeblendet';
  return 'offen';
}

export function filtereNachSicht(
  zeilen: readonly ZahlungZeile[],
  sicht: NebenkostenSicht,
  kategorie: NebenkostenKategorie,
  ausgeblendet: ReadonlySet<string>
): ZahlungZeile[] {
  return zeilen.filter((z) => sichtVon(z, ausgeblendet) === sicht && (kategorie === 'alle' || z.kategorie === kategorie));
}

export function zaehleSichten(zeilen: readonly ZahlungZeile[], ausgeblendet: ReadonlySet<string>): Record<NebenkostenSicht, number> {
  const z: Record<NebenkostenSicht, number> = { offen: 0, zugeordnet: 0, ausgeblendet: 0 };
  for (const zeile of zeilen) z[sichtVon(zeile, ausgeblendet)] += 1;
  return z;
}

export const KONFIDENZ_LABEL: Record<KiKonfidenz, string> = { high: 'sicher', medium: 'mittel', low: 'unsicher' };

/**
 * Kurzer Hinweis je Buchung für die Zuordnungsspalte: das vorgeschlagene
 * Objekt, sonst die erkannte Kostenart. Nur für Buchungen ohne Objekt — ein
 * Vorschlag zu einer bereits zugeordneten Buchung ist erledigt.
 */
export function vorschlagHinweise(vorschlaege: readonly KiVorschlag[], zeilen: readonly ZahlungZeile[]): Map<string, string> {
  const offen = new Set(zeilen.filter((z) => !z.immobilie_id).map((z) => z.id));
  const hinweise = new Map<string, string>();
  for (const v of vorschlaege) {
    if (!offen.has(v.zahlung_id)) continue;
    const ziel = v.suggested_immobilie_name ?? v.category;
    if (ziel) hinweise.set(v.zahlung_id, ziel);
  }
  return hinweise;
}

export function vorschlaegeNachZahlung(vorschlaege: readonly KiVorschlag[]): Map<string, KiVorschlag> {
  return new Map(vorschlaege.map((v) => [v.zahlung_id, v]));
}

/** Wie viele Buchungen je Objekt bereits zugeordnet sind — für die Objektliste. */
export function anzahlJeObjekt(zeilen: readonly Pick<ZahlungZeile, 'immobilie_id'>[]): Map<string, number> {
  const anzahl = new Map<string, number>();
  for (const z of zeilen) {
    if (!z.immobilie_id) continue;
    anzahl.set(z.immobilie_id, (anzahl.get(z.immobilie_id) ?? 0) + 1);
  }
  return anzahl;
}
