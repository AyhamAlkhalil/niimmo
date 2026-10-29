import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { berechneMietkontostand, calculateMieteZahlungen, nurFaelligeForderungen } from "@/utils/rueckstandsberechnung";
import { mietrueckstand, rueckstandInMonatsmieten, rueckstandSeit } from "@/utils/rueckstandSeit";
import { monatsSaldo, type MonatsSaldo } from "@/utils/monatsSaldo";
import { laeuftImMonat } from "@/utils/rueckstandsberechnung";
import { format } from "date-fns";
import { useEffect } from "react";

// Lädt alle Seiten einer Supabase-Query (umgeht das serverseitige 1000-Zeilen-Limit)
async function loadAllPages<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const result: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    result.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return result;
}

export interface FehlendeMietzahlung {
  mietvertrag_id: string;
  fehlend_betrag: number;
  gesamt_forderungen: number;
  gesamt_zahlungen: number;
  /** Überzahlung, die mit noch nicht fälligen Forderungen verrechnet ist (weder Rückstand noch Guthaben) */
  vorauszahlung: number;
  /** BKA-Zahlungen ohne passende BKA-Forderung — nicht im Betrag enthalten (Sonderfall, 29.10.2026) */
  bka_ohne_forderung: number;
  /**
   * Gegenbetrag an weiteren Verträgen desselben Mieters (Guthaben bei Rückstand und umgekehrt), z. B. eine
   * Sammelzahlung für Wohnung und Garage. Die Software teilt nie selbst auf (Entscheidung 28.10.2026).
   */
  verbundener_gegenbetrag: number;
  miete_zahlungen: number;
  immobilie_name: string;
  immobilie_adresse: string;
  einheit_typ: string;
  einheit_etage: string;
  einheit_nummer: string;
  einheit_qm: number;
  mieter_name: string;
  mieter_email: string;
  alle_mieter: any[];
  mietvertrag: any;
  dokumente: any[];
  kaltmiete: number;
  betriebskosten: number;
  mietvertrag_status: string;
  mahnstufe: number;
  // Neue Fälligkeitsinformationen
  faellige_forderungen: number;
  noch_nicht_faellige_forderungen: number;
  faellige_forderungen_betrag: number;
  noch_nicht_faellige_forderungen_betrag: number;
  naechste_faelligkeit?: string;
  // Guthaben-Information
  ist_guthaben: boolean;
  /** Ältester offener Monat (JJJJ-MM) eines Rückstands, null bei Guthaben (utils/rueckstandSeit.ts) */
  rueckstand_seit: string | null;
  /** Kaltmiete + Betriebskosten laut Vertrag */
  monatsmiete: number;
  /** Mietanteil des Rückstands in Monatsmieten, abgerundet; ohne BKA-Nachzahlungen und Gebühren (utils/rueckstandSeit.ts) */
  rueckstand_monatsmieten: number | null;
}


/**
 * Rückstandsliste und Monatszahlen der Startseite aus einer Abfrage und mit einem Stichtag: So passen
 * „Noch offen“ oben und die Rückstände darunter zusammen (29.10.2026).
 */
/** BKA-Zahlung ohne passende BKA-Forderung — unabhängig vom Saldo zu prüfen (Sonderfall, 29.10.2026) */
export interface BkaHinweis {
  mietvertrag_id: string;
  betrag: number;
  immobilie_name: string;
  einheit: string;
  mieter_name: string;
  mietvertrag_status: string;
}

/** Ein Vertrag hinter „Noch offen“ auf der Startseite (29.10.2026) */
export interface OffeneMiete {
  mietvertrag_id: string;
  mieter_name: string;
  immobilie_name: string;
  einheit: string;
  offen: number;
  /** Ein Teil der Monatsmiete ist schon bezahlt */
  teilweise_bezahlt: boolean;
  /**
   * Dieselben Mieter, derselbe Schlüssel: Wohnung und Garage eines Mieters sind zwei Zeilen, aber ein Mieter
   * in der Überschrift „N Mieter haben … nicht bezahlt“ (Review 29.10.2026)
   */
  mieter_schluessel: string;
}

export interface Mietkonto {
  eintraege: FehlendeMietzahlung[];
  monat: MonatsSaldo;
  /** Wer die Miete des laufenden Monats noch nicht (ganz) bezahlt hat, größter Betrag zuerst */
  offenImMonat: OffeneMiete[];
  /** Auch Verträge mit ausgeglichenem Saldo: Die BKA-Zahlung steht dort sonst nirgends in der Liste */
  bkaOhneForderung: BkaHinweis[];
}

export const useRueckstaende = () => {
  const queryClient = useQueryClient();

  // Set up real-time subscriptions for instant updates
  useEffect(() => {
    const channel = supabase
      .channel('rueckstaende-updates')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'mietforderungen'
        },
        (payload) => {
          // Invalidate the rueckstaende query to trigger recalculation
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
          // Also invalidate specific contract queries if we know the contract ID
          if ((payload.new as any)?.mietvertrag_id) {
            queryClient.invalidateQueries({ queryKey: ['mietforderungen', (payload.new as any).mietvertrag_id] });
            queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', (payload.new as any).mietvertrag_id] });
          }
          if ((payload.old as any)?.mietvertrag_id) {
            queryClient.invalidateQueries({ queryKey: ['mietforderungen', (payload.old as any).mietvertrag_id] });
            queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', (payload.old as any).mietvertrag_id] });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'zahlungen'
        },
        (payload) => {
          // Invalidate the rueckstaende query to trigger recalculation
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
          // Also invalidate specific contract queries if we know the contract ID
          if ((payload.new as any)?.mietvertrag_id) {
            queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', (payload.new as any).mietvertrag_id] });
            queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', (payload.new as any).mietvertrag_id] });
          }
          if ((payload.old as any)?.mietvertrag_id) {
            queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', (payload.old as any).mietvertrag_id] });
            queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', (payload.old as any).mietvertrag_id] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useMietkonto();
};

/** Dieselben Daten ohne eigenes Echtzeit-Abo — für die Startseiten-Kennzahlen neben der Rückstandsliste. */
export const useMietkonto = () =>
  useQuery({
    queryKey: ['rueckstaende'],
    staleTime: 60 * 1000,
    refetchOnMount: true,
    queryFn: async (): Promise<Mietkonto> => {
      const stichtag = new Date();
      // Kleine Tabellen (<1000 Zeilen) normal laden, große mit Pagination
      const [
        { data: mietvertraege, error: mietvertrageError },
        { data: einheiten, error: einheitenError },
        { data: immobilien, error: immobilienError },
        { data: mietvertragMieter, error: mmError },
      ] = await Promise.all([
        supabase.from('mietvertrag').select('*'),
        supabase.from('einheiten').select('*'),
        supabase.from('immobilien').select('*'),
        supabase.from('mietvertrag_mieter').select(`
          mietvertrag_id,
          mieter_id,
          mieter!mietvertrag_mieter_mieter_id_fkey(
            id,
            vorname,
            nachname,
            hauptmail,
            telnr
          )
        `),
      ]);

      if (mietvertrageError) throw mietvertrageError;
      if (einheitenError) throw einheitenError;
      if (immobilienError) throw immobilienError;
      if (mmError) throw mmError;

      // Große Tabellen mit Pagination laden (umgeht serverseitiges 1000-Zeilen-Limit)
      const [alleForderungen, alleZahlungen] = await Promise.all([
        loadAllPages<any>((from, to) =>
          supabase
            .from('mietforderungen')
            .select('id, mietvertrag_id, sollmonat, sollbetrag, ist_faellig, faelligkeitsdatum, faellig_seit, typ, ruecklastschrift_am')
            // Ohne ORDER BY ist die Zeilenfolge zwischen den Seiten undefiniert (27.10.2026)
            .order('id')
            .range(from, to)
        ),
        loadAllPages<any>((from, to) =>
          supabase
            .from('zahlungen')
            .select('id, mietvertrag_id, betrag, buchungsdatum, kategorie, zugeordneter_monat, ruecklastschrift_gebuehr')
            // Ohne ORDER BY ist die Zeilenfolge zwischen den Seiten undefiniert (27.10.2026)
            .order('id')
            .range(from, to)
        ),
      ]);

      const rueckstaende: FehlendeMietzahlung[] = [];
      const bkaHinweise: BkaHinweis[] = [];

      // Berechne für jeden Mietvertrag (aktiv, gekündigt, beendet)
      for (const mietvertrag of mietvertraege || []) {
        // Alle Verträge berücksichtigen, die potenziell Rückstände haben könnten
        // (aktiv, gekündigt, beendet)

        // Kein Ausschluss nach Miete: Ein Vertrag mit Miete 0 und offenem Saldo fehlte bis zum
        // 27.10.2026 in der Liste, während das Vertragsdetail ihn zeigte. Gefiltert wird unten nach Saldo.

        // Filter vorgeladene Daten für diesen Mietvertrag
        const mietvertragForderungen = alleForderungen?.filter(f => f.mietvertrag_id === mietvertrag.id) || [];
        const mietvertragZahlungen = alleZahlungen?.filter(z => z.mietvertrag_id === mietvertrag.id) || [];

        // Nur fällige Forderungen; eine Überzahlung auf noch nicht fällige Miete ist Vorauszahlung, kein
        // Guthaben. Dieselbe Rechnung wie Vertragsdetail und Mahnbetrag (MietvertragDetailsModal).
        const { gesamtForderungen, gesamtZahlungen, rueckstand, vorauszahlung, bkaOhneForderung } = berechneMietkontostand(
          mietvertrag,
          mietvertragForderungen,
          mietvertragZahlungen,
          stichtag
        );

        if (bkaOhneForderung !== 0) {
          const einheitH = einheiten?.find(e => e.id === mietvertrag.einheit_id);
          const mieterH = mietvertragMieter?.find(mm => mm.mietvertrag_id === mietvertrag.id)?.mieter;
          bkaHinweise.push({
            mietvertrag_id: mietvertrag.id,
            betrag: bkaOhneForderung,
            immobilie_name: immobilien?.find(i => i.id === einheitH?.immobilie_id)?.name || 'Unbekannt',
            einheit: [einheitH?.einheitentyp, einheitH?.etage].filter(Boolean).join(' · '),
            mieter_name: mieterH ? `${mieterH.vorname} ${mieterH.nachname}` : 'Unbekannt',
            mietvertrag_status: mietvertrag.status,
          });
        }

        // Zeige nur Nettostand (Rückstand oder Guthaben nach Aufrechnung)
        // Filtere auch sehr kleine Beträge unter 1 Cent aus
        if (Math.abs(rueckstand) >= 0.01) {
          // Lade zusätzliche Informationen
          const einheit = einheiten?.find(e => e.id === mietvertrag.einheit_id);
          const immobilie = immobilien?.find(i => i.id === einheit?.immobilie_id);
          const alleMieter = mietvertragMieter?.filter(mm => mm.mietvertrag_id === mietvertrag.id) || [];
          const ersteMieter = alleMieter[0];

          // Berechne Miete-Zahlungen separat
          const mieteZahlungenSumme = calculateMieteZahlungen(mietvertragZahlungen);

        // Berechne Fälligkeitsinformationen - alle Forderungen verwenden (ohne Startdatum-Filter)
        const alleForderungenAbStart = mietvertragForderungen.filter(f => {
          return f.sollmonat; // Nur Forderungen mit sollmonat
        });
        
        const faelligeForderungen = alleForderungenAbStart.filter(f => f.ist_faellig === true);
        const nichtFaelligeForderungen = alleForderungenAbStart.filter(f => f.ist_faellig !== true);
        
        const faelligeForderungenBetrag = faelligeForderungen.reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);
        const nichtFaelligeForderungenBetrag = nichtFaelligeForderungen.reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);
        // Seit wann und wie viele Monatsmieten (29.10.2026): nach derselben Fälligkeitsregel wie der Saldo
        const faelligBisHeute = nurFaelligeForderungen(mietvertragForderungen, stichtag);
        const monatsmiete = (Number(mietvertrag.kaltmiete) || 0) + (Number(mietvertrag.betriebskosten) || 0);
          
          rueckstaende.push({
            mietvertrag_id: mietvertrag.id,
            fehlend_betrag: Math.abs(rueckstand), // Betrag immer positiv anzeigen
            gesamt_forderungen: gesamtForderungen,
            gesamt_zahlungen: gesamtZahlungen,
            vorauszahlung,
            bka_ohne_forderung: bkaOhneForderung,
            verbundener_gegenbetrag: 0,
            miete_zahlungen: mieteZahlungenSumme,
            immobilie_name: immobilie?.name || 'Unbekannt',
            immobilie_adresse: immobilie?.adresse || 'Unbekannt',
            einheit_typ: einheit?.einheitentyp || 'Unbekannt',
            einheit_etage: einheit?.etage || 'Unbekannt',
            einheit_nummer: einheit?.zaehler ? String(einheit.zaehler).padStart(2, '0') : '',
            einheit_qm: einheit?.qm || 0,
            mieter_name: ersteMieter?.mieter ? 
              `${ersteMieter.mieter.vorname} ${ersteMieter.mieter.nachname}` : 'Unbekannt',
            mieter_email: ersteMieter?.mieter?.hauptmail || 'Unbekannt',
            alle_mieter: alleMieter,
            mietvertrag: mietvertrag,
            // Nicht mehr geladen (27.10.2026): Kein Leser; die ungeblätterte Abfrage lieferte 1000
            // zufällige von 1605 Zeilen, und ihr Scheitern ließ die ganze Liste ausfallen
            dokumente: [],
            kaltmiete: mietvertrag.kaltmiete || 0,
            betriebskosten: mietvertrag.betriebskosten || 0,
            mietvertrag_status: mietvertrag.status === 'aktiv' ? 'Aktiv' : 
                                mietvertrag.status === 'gekuendigt' ? 'Gekündigt' : 'Beendet',
            mahnstufe: mietvertrag.mahnstufe || 0,
            // Fälligkeitsinformationen
            faellige_forderungen: faelligeForderungen.length,
            noch_nicht_faellige_forderungen: nichtFaelligeForderungen.length,
            faellige_forderungen_betrag: faelligeForderungenBetrag,
            noch_nicht_faellige_forderungen_betrag: nichtFaelligeForderungenBetrag,
            // Guthaben-Information
            ist_guthaben: rueckstand < 0,
            rueckstand_seit: rueckstandSeit(faelligBisHeute, mietvertragZahlungen, rueckstand),
            monatsmiete,
            rueckstand_monatsmieten: rueckstandInMonatsmieten(mietrueckstand(faelligBisHeute, rueckstand), monatsmiete),
          });
        }
      }
      
      // Sammelzahlung erkennen, nicht aufteilen: Rückstand an einem Vertrag, Guthaben an einem anderen
      // desselben Mieters (Live 29.10.2026: zwei Garagen zu je 50 €, 100 € Guthaben und 150 € Rückstand)
      const offen = rueckstaende.filter((e) => e.mietvertrag_status !== 'Beendet');
      for (const eintrag of offen) {
        const mieterIds = new Set(eintrag.alle_mieter.map((m: { mieter_id?: string }) => m.mieter_id).filter(Boolean));
        eintrag.verbundener_gegenbetrag = offen
          .filter((andere) => andere.mietvertrag_id !== eintrag.mietvertrag_id && andere.ist_guthaben !== eintrag.ist_guthaben)
          .filter((andere) => andere.alle_mieter.some((m: { mieter_id?: string }) => mieterIds.has(m.mieter_id)))
          .reduce((s, andere) => s + andere.fehlend_betrag, 0);
      }

      // Dieselben Verträge wie die Summen der Liste (aktiv und gekündigt), soweit sie in diesem Monat laufen
      const monatKey = format(stichtag, 'yyyy-MM');
      const monat = monatsSaldo(
        (mietvertraege || []).filter((mv) => (mv.status === 'aktiv' || mv.status === 'gekuendigt') && laeuftImMonat(mv, monatKey)),
        alleForderungen,
        alleZahlungen,
        stichtag
      );

      // Arbeitsliste unter „Noch offen“: Mieter, Objekt und Einheit je offenem Vertrag
      const offenImMonat: OffeneMiete[] = monat.offeneVertraege.map((o) => {
        const mv = mietvertraege?.find((m) => m.id === o.mietvertragId);
        const einheit = einheiten?.find((e) => e.id === mv?.einheit_id);
        // Feste Reihenfolge (nach Nachname): Die Abfrage hat kein ORDER BY, „A und B“ sprang sonst zu „B und A“
        const mieter = (mietvertragMieter || [])
          .filter((mm) => mm.mietvertrag_id === o.mietvertragId && mm.mieter)
          .map((mm) => mm.mieter)
          .sort((a, b) => `${a.nachname ?? ''} ${a.vorname ?? ''}`.localeCompare(`${b.nachname ?? ''} ${b.vorname ?? ''}`, 'de'));
        const namen = mieter.map((m) => `${m.vorname ?? ''} ${m.nachname ?? ''}`.trim()).filter(Boolean);
        return {
          mietvertrag_id: o.mietvertragId,
          mieter_name: namen.length === 0 ? 'Unbekannt' : namen.length <= 2 ? namen.join(' und ') : `${namen[0]} u. a.`,
          immobilie_name: immobilien?.find((i) => i.id === einheit?.immobilie_id)?.name || 'Unbekannt',
          einheit: [einheit?.einheitentyp, einheit?.etage].filter(Boolean).join(' · '),
          offen: o.offen,
          teilweise_bezahlt: o.offen < o.soll,
          mieter_schluessel: mieter.length > 0 ? mieter.map((m) => m.id).sort().join('|') : o.mietvertragId,
        };
      });
      return { eintraege: rueckstaende, monat, offenImMonat, bkaOhneForderung: bkaHinweise };
    }
  });