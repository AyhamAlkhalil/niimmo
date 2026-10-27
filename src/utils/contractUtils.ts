/**
 * Centralized contract and property utility functions
 * Replaces duplicate logic across components
 */

import { supabase } from "@/integrations/supabase/client";

export interface ContractFilter {
  mietstatus: "all" | "aktiv" | "gekuendigt" | "beendet";
  zahlungsstatus: "all" | "paid" | "unpaid";
}

export interface SortConfig {
  field: string | null;
  direction: "asc" | "desc";
}

/**
 * Filters contracts to include all relevant statuses (active, terminated, and ended)
 * For search functionality, we want to include all contracts
 */
export const filterAllContracts = (contracts: any[]): any[] => {
  return contracts.filter(contract => 
    contract.status === 'aktiv' || contract.status === 'gekuendigt' || contract.status === 'beendet'
  );
};

/**
 * Legacy function kept for backward compatibility - now includes ended contracts
 * @deprecated Use filterAllContracts instead
 */
export const filterActiveAndTerminatedContracts = (contracts: any[]): any[] => {
  return filterAllContracts(contracts);
};

/**
 * Sorts units by number (ascending), with fallbacks to creation date and ID
 */
export const sortUnitsByNumber = (units: any[]): any[] => {
  return units.sort((a, b) => {
    const extractNum = (val?: string | number) => {
      if (val == null) return null;
      const s = val.toString();
      const match = s.match(/\d+/g);
      if (match && match.length) {
        return parseInt(match.join(''), 10);
      }
      return null;
    };
    
    const aNum = extractNum(a.nummer ?? (a.id ? a.id.slice(-2) : undefined));
    const bNum = extractNum(b.nummer ?? (b.id ? b.id.slice(-2) : undefined));
    
    if (aNum != null && bNum != null && aNum !== bNum) {
      return aNum - bNum;
    }
    if (aNum != null && bNum == null) return -1;
    if (aNum == null && bNum != null) return 1;
    
    // Fallback: sort by creation date
    const aCreated = a.erstellt_am ? new Date(a.erstellt_am).getTime() : 0;
    const bCreated = b.erstellt_am ? new Date(b.erstellt_am).getTime() : 0;
    if (aCreated !== bCreated) return aCreated - bCreated;
    
    // Final fallback: ID
    return (a.id || '').localeCompare(b.id || '');
  });
};

/**
 * Sorts properties alphabetically by name (ascending) with natural number sorting
 */
export const sortPropertiesByName = (properties: any[]): any[] => {
  return properties.sort((a, b) => {
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
};

/**
 * Gets the most current rental contract for a unit
 * Priority: 1. Active contracts, 2. Terminated contracts, 3. Most recent ended contract by start date
 */
export const getCurrentContract = (contracts: any[]): any | null => {
  if (contracts.length === 0) return null;
  
  // Sort contracts by start date descending to ensure consistent ordering
  const sortedContracts = [...contracts].sort((a, b) => {
    const dateA = a.start_datum ? new Date(a.start_datum).getTime() : 0;
    const dateB = b.start_datum ? new Date(b.start_datum).getTime() : 0;
    return dateB - dateA; // Most recent first
  });
  
  // First, try to find an active contract
  const activeContract = sortedContracts.find(c => c.status === 'aktiv');
  if (activeContract) return activeContract;
  
  // Second, try to find a terminated contract (most recent one)
  const terminatedContract = sortedContracts.find(c => c.status === 'gekuendigt');
  if (terminatedContract) return terminatedContract;
  
  // Finally, if only ended contracts, return the most recent one
  return sortedContracts.find(c => c.status === 'beendet') || sortedContracts[0];
};

/**
 * Das massgebliche Ende eines Mietverhaeltnisses.
 *
 * `ende_datum` ist die fuehrende Quelle: Der Kuendigungs-Workflow schreibt den
 * Kuendigungstermin seit dem 03.09.2026 dorthin mit. Zuvor fuehrten beide
 * Felder dieselbe Aussage getrennt -- die Einheiten-Karte zeigte
 * `kuendigungsdatum`, die Vertragsdetails `ende_datum`, und bei 23 Vertraegen
 * wichen sie voneinander ab.
 *
 * `kuendigungsdatum` bleibt nur noch Fallback fuer Datensaetze, die von aussen
 * (Import, Altbestand) ohne `ende_datum` hereinkommen.
 */
export const getVertragsende = (
  vertrag: { ende_datum?: string | null; kuendigungsdatum?: string | null } | null | undefined
): string | null => {
  if (!vertrag) return null;
  return vertrag.ende_datum || vertrag.kuendigungsdatum || null;
};

/**
 * Felder fuer ein neues Mietende.
 *
 * Ist der Vertrag gekuendigt, wird `kuendigungsdatum` mitgefuehrt -- beide Felder meinen
 * dasselbe Mietende. Am 24.09.2026 hatten zwei gekuendigte Vertraege nach Aenderung im
 * Detailfenster ein anderes `ende_datum` als `kuendigungsdatum`; Historie und Uebergabe
 * zeigten dadurch ein anderes Ende als Karte und Detailfenster.
 *
 * Leeren ist bei einer Kuendigung nicht moeglich: getVertragsende() fiele dann auf das alte
 * Kuendigungsdatum zurueck, und das geloeschte Ende stuende sofort wieder da.
 */
export const mietendeFelder = (
  neuesEnde: string | null,
  vertrag: { kuendigungsdatum?: string | null } | null | undefined
): { ende_datum: string | null; kuendigungsdatum?: string } | { fehler: string } => {
  if (!istGekuendigt(vertrag)) return { ende_datum: neuesEnde };
  if (!neuesEnde) {
    return { fehler: "Der Vertrag ist gekündigt – das Mietende kann nicht leer sein. Bitte ein Datum eintragen." };
  }
  return { ende_datum: neuesEnde, kuendigungsdatum: neuesEnde };
};

/**
 * Vertragsfelder nach einer Mahnung mit fristloser Kuendigung (Stufe 3): beide Felder auf
 * das Ende der Raeumungsfrist, wie mietendeFelder() es verlangt.
 *
 * Bis zum 27.10.2026 stand `kuendigungsdatum` auf dem Versandtag und `ende_datum` auf dem
 * Raeumungsende. Der Nachtlauf update_expired_terminated_contracts prueft
 * `kuendigungsdatum < CURRENT_DATE` und setzte den Vertrag schon in der Folgenacht auf
 * 'beendet': Leerstand im Objekt, keine Sollstellung bis zur Raeumung, waehrend
 * getVertragsende() weiter das spaetere Datum nannte. Bis zur Rueckgabe schuldet der
 * Mieter Nutzungsentschaedigung in Hoehe der Miete (§ 546a BGB).
 */
/**
 * Raeumungsfrist in ganzen Tagen, fuer Schreiben und Vertrag gleich: erst abrunden, dann pruefen
 * (0,5 Tage waeren sonst „heute raeumen“), mehr als ein Jahr ist ein Tippfehler, sonst 14.
 * Bis zum 27.10.2026 rechnete das Schreiben mit `parseInt(...) || 14` und nannte bei „400“ oder
 * „-3“ ein anderes Raeumungsende, als der Vertrag bekam.
 */
export const raeumungsfristInTagen = (eingabe: number): number => {
  const ganz = Math.floor(eingabe);
  return Number.isFinite(ganz) && ganz > 0 && ganz <= 365 ? ganz : 14;
};

export const fristloseKuendigungFelder = (
  raeumungsfristTage: number,
  versandtag: Date = new Date()
): { status: "gekuendigt"; kuendigungsdatum: string; ende_datum: string } => {
  const tage = raeumungsfristInTagen(raeumungsfristTage);
  const basis = Number.isNaN(versandtag.getTime()) ? new Date() : versandtag;
  const ende = new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + tage);
  const tag = alsIsoTag(ende);
  return { status: "gekuendigt", kuendigungsdatum: tag, ende_datum: tag };
};

/**
 * Vertragsende einer Kuendigung durch den Vermieter (TerminationDialog). Bei der fristlosen Kuendigung
 * endet das Mietverhaeltnis mit der Raeumungsfrist, nicht am Kuendigungstag: Bis zum 27.10.2026 bekamen
 * beide Felder den Kuendigungstag, der Nachtlauf beendete den Vertrag am Folgetag, und die
 * Nutzungsentschaedigung bis zur Raeumung (§ 546a BGB) fiel aus der Sollstellung -- wie bei Mahnstufe 3
 * (fristloseKuendigungFelder). Ordentlich und mit Frist: das Datum, zu dem gekuendigt wird.
 */
export const vertragsendeDerKuendigung = (
  typ: string | null | undefined,
  kuendigungsdatum: string,
  raeumungBis?: string | null
): string =>
  typ === "ausserordentlich_fristlos" && raeumungBis && raeumungBis.slice(0, 10) > kuendigungsdatum.slice(0, 10)
    ? raeumungBis.slice(0, 10)
    : kuendigungsdatum;

/** True, wenn das Ende auf einer belegten Kuendigung beruht und nicht auf einer Befristung. */
export const istGekuendigt = (
  vertrag: { kuendigungsdatum?: string | null } | null | undefined
): boolean => Boolean(vertrag?.kuendigungsdatum);

/** Tagesgenauer ISO-Stichtag ohne Zeitzonen-Verschiebung. */
export const alsIsoTag = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * True, wenn der Kalendertag (JJJJ-MM-TT) vor heute liegt — der letzte Vertragstag selbst
 * zaehlt noch als laufend, wie in istLaufenderVertrag() und im Nachtlauf (`< CURRENT_DATE`).
 * `new Date('2026-10-31') < new Date()` galt am 31.10. ab 01:00 Uhr deutscher Zeit, und die
 * Vertragsbearbeitung setzte den Vertrag so am letzten Tag auf 'beendet' (27.10.2026).
 */
export const istVergangenerTag = (tag: string | null | undefined, heute: Date = new Date()): boolean =>
  !!tag && !Number.isNaN(heute.getTime()) && tag.slice(0, 10) < alsIsoTag(heute);

export interface VertragZeitraum {
  status?: string | null;
  start_datum?: string | null;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
}

/**
 * Laeuft das Mietverhaeltnis am Stichtag tatsaechlich?
 *
 * Massgeblich fuer jede Mietsumme. Vorher hatte jede Auswertung ihre eigene
 * Regel: Das Dashboard verlangte Start <= heute und Ende >= heute, die
 * Mietaufstellung pruefte gar keine Daten, die Mietuebersicht zaehlte sogar
 * beendete Vertraege mit. Dieselbe Kaltmiete stand deshalb an drei Stellen mit
 * drei Betraegen -- 50.078 EUR, 51.478 EUR und 55.196 EUR.
 */
export const istLaufenderVertrag = (
  vertrag: VertragZeitraum | null | undefined,
  stichtag: Date = new Date()
): boolean => {
  if (!vertrag) return false;
  if (vertrag.status !== "aktiv" && vertrag.status !== "gekuendigt") return false;

  const tag = alsIsoTag(stichtag);
  if (vertrag.start_datum && vertrag.start_datum > tag) return false;

  const ende = getVertragsende(vertrag);
  if (ende && ende < tag) return false;

  return true;
};

/**
 * Der am Stichtag laufende Vertrag einer Einheit, sonst null (= Leerstand).
 *
 * Anders als getCurrentContract faellt diese Funktion nicht auf beendete oder
 * noch nicht begonnene Vertraege zurueck -- fuer Mietsummen ist ein Vertrag,
 * der erst in Wochen beginnt, kein Ertrag.
 */
export const getLaufenderVertrag = <T extends VertragZeitraum>(
  contracts: T[] | null | undefined,
  stichtag: Date = new Date()
): T | null => {
  const laufende = (contracts ?? []).filter((c) => istLaufenderVertrag(c, stichtag));
  if (laufende.length === 0) return null;
  if (laufende.length === 1) return laufende[0];
  // Mehrere gleichzeitig laufende Vertraege auf einer Einheit sind ein
  // Datenfehler. Damit die Summe nicht doppelt zaehlt, gewinnt der zuletzt
  // begonnene.
  return [...laufende].sort((a, b) => (b.start_datum ?? "").localeCompare(a.start_datum ?? ""))[0];
};

/**
 * Kalt- und Betriebskostensumme eines Bestands: je Einheit nur der am Stichtag
 * laufende Vertrag (getLaufenderVertrag).
 *
 * Der Objektkopf summierte bis zum 07.10.2026 alle aktiven und gekuendigten
 * Vertraege. Bei einem Mieterwechsel standen der gekuendigte Vormieter und der
 * Nachmieter, der erst im Folgemonat einzieht, gleichzeitig in der Summe --
 * Objekt 5 zeigte 9.280 EUR statt 7.970 EUR Kaltmiete (Kundenmeldung vom 02.10.2026).
 */
export const summiereLaufendeMieten = <
  T extends VertragZeitraum & {
    einheit_id?: string | null;
    kaltmiete?: number | null;
    betriebskosten?: number | null;
  }
>(
  vertraege: T[] | null | undefined,
  stichtag: Date = new Date()
): { kaltmiete: number; betriebskosten: number } => {
  const jeEinheit = new Map<string, T[]>();
  (vertraege ?? []).forEach((v, i) => {
    // Ohne Einheit kann kein Nachfolger kollidieren -- jeder Vertrag zaehlt fuer sich.
    const schluessel = v.einheit_id ?? `ohne-einheit-${i}`;
    jeEinheit.set(schluessel, [...(jeEinheit.get(schluessel) ?? []), v]);
  });

  let kaltmiete = 0;
  let betriebskosten = 0;
  for (const liste of jeEinheit.values()) {
    const laufend = getLaufenderVertrag(liste, stichtag);
    if (!laufend) continue;
    kaltmiete += Number(laufend.kaltmiete) || 0;
    betriebskosten += Number(laufend.betriebskosten) || 0;
  }
  return { kaltmiete, betriebskosten };
};

/**
 * Formats currency values consistently
 */
export const formatCurrency = (value: number | null | undefined): string => {
  if (value == null) return '€0';
  return `€${Number(value).toLocaleString('de-DE')}`;
};

/**
 * Formats area values consistently
 */
export const formatArea = (value: number | null | undefined): string => {
  if (value == null) return '0 m²';
  return `${value} m²`;
};