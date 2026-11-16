/**
 * Centralized contract and property utility functions
 * Replaces duplicate logic across components
 */

import { supabase } from "@/integrations/supabase/client";
import {
  getVertragsende,
  getLaufenderVertrag,
  istLaufenderVertrag,
  summiereLaufendeMieten,
  type VertragZeitraum,
} from '../../supabase/functions/_shared/mietkonto.ts';

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

  // Zuerst der heute laufende Vertrag (Kanon). Bis zum 27.10.2026 gewann jeder 'aktiv': Bei einem
  // Mieterwechsel zeigte die Einheitskarte den Nachmieter, der erst im Folgemonat einzieht, statt
  // des gekuendigten Vormieters, der noch wohnt (live 2 Einheiten).
  const laufend = getLaufenderVertrag(contracts);
  if (laufend) return laufend;
  
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
 * Das massgebliche Ende eines Mietverhaeltnisses: `ende_datum` fuehrt, `kuendigungsdatum` nur als Ersatz.
 * Die Definition samt Begruendung steht seit dem 30.10.2026 im Rechenkern
 * (supabase/functions/_shared/mietkonto.ts), den auch die Edge Function send-mahnung nutzt.
 */
export { getVertragsende };

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
 * Status nach einer Aenderung des Mietendes in der Vertragsbearbeitung: vergangenes Ende -> beendet;
 * ein beendeter Vertrag mit Ende ab heute oder ohne Ende laeuft wieder (gekuendigt mit
 * Kuendigungsdatum, sonst aktiv); sonst bleibt der Status. Bis zum 27.10.2026 kam ein beendeter
 * Vertrag nie zurueck: Wer das Mietende versehentlich auf 2025 statt 2026 setzte, behielt nach der
 * Korrektur „beendet“ -- keine Sollstellung, Leerstand, fehlte in allen Summen.
 * Nur wenn sich das Ende wirklich ändert: Sonst holte schon das Öffnen und Speichern des Felds einen
 * beendeten Vertrag ohne Ende (Übergabe, manueller Abschluss) zurück in Summen und Sollstellung.
 */
export const statusNachMietende = (
  bisherigerStatus: string | null | undefined,
  bisherigesEnde: string | null | undefined,
  neuesEnde: string | null,
  kuendigungsdatum: string | null | undefined,
  heute: Date = new Date()
): "beendet" | "gekuendigt" | "aktiv" | undefined => {
  if ((bisherigesEnde?.slice(0, 10) || null) === (neuesEnde?.slice(0, 10) || null)) return undefined;
  if (istVergangenerTag(neuesEnde, heute)) return "beendet";
  if (bisherigerStatus === "beendet") return kuendigungsdatum ? "gekuendigt" : "aktiv";
  return undefined;
};

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
export const fristloseKuendigungFelder = (
  raeumungsfristTage: number,
  versandtag: Date = new Date(),
  bestehendesEnde?: string | null
): { status: "gekuendigt"; kuendigungsdatum: string; ende_datum: string } => {
  const tage = raeumungsfristInTagen(raeumungsfristTage);
  const basis = Number.isNaN(versandtag.getTime()) ? new Date() : versandtag;
  const ende = new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + tage);
  const raeumung = alsIsoTag(ende);
  // Endet der Vertrag ohnehin frueher (ordentliche Kuendigung, Befristung), bleibt es dabei:
  // Bis zum 27.10.2026 schob Stufe 3 ein Ende zum 31.10. auf den 10.11., und die Sollstellung
  // legte eine volle Novembermiete an.
  // Ein schon vergangenes Ende zählt nicht: Das Schreiben nannte sonst eine abgelaufene Räumungsfrist
  const frueher = bestehendesEnde?.slice(0, 10);
  const heute = alsIsoTag(basis);
  const tag = frueher && frueher >= heute && frueher < raeumung ? frueher : raeumung;
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

// istLaufenderVertrag, getLaufenderVertrag und summiereLaufendeMieten liegen seit dem 16.11.2026 im Rechenkern
// (supabase/functions/_shared/mietkonto.ts), damit auch der MCP-Server (Edge Function mcp) Leerstand und Mietsummen
// nach derselben Regel bildet. Hier nur weitergereicht.
export { istLaufenderVertrag, getLaufenderVertrag, summiereLaufendeMieten };
export type { VertragZeitraum };

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