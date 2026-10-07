import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateMietvertragRueckstand, calculateMieteZahlungen } from "@/utils/rueckstandsberechnung";
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

  return useQuery({
    queryKey: ['rueckstaende'],
    staleTime: 60 * 1000,
    refetchOnMount: true,
    queryFn: async () => {
      // Kleine Tabellen (<1000 Zeilen) normal laden, große mit Pagination
      const [
        { data: mietvertraege, error: mietvertrageError },
        { data: einheiten, error: einheitenError },
        { data: immobilien, error: immobilienError },
        { data: mietvertragMieter, error: mmError },
        { data: dokumente, error: dokumenteError },
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
        supabase.from('dokumente').select('*'),
      ]);

      if (mietvertrageError) throw mietvertrageError;
      if (einheitenError) throw einheitenError;
      if (immobilienError) throw immobilienError;
      if (mmError) throw mmError;
      if (dokumenteError) throw dokumenteError;

      // Große Tabellen mit Pagination laden (umgeht serverseitiges 1000-Zeilen-Limit)
      const [alleForderungen, alleZahlungen] = await Promise.all([
        loadAllPages<any>((from, to) =>
          supabase
            .from('mietforderungen')
            .select('id, mietvertrag_id, sollmonat, sollbetrag, ist_faellig, faelligkeitsdatum, faellig_seit, typ')
            .range(from, to)
        ),
        loadAllPages<any>((from, to) =>
          supabase
            .from('zahlungen')
            .select('id, mietvertrag_id, betrag, buchungsdatum, kategorie, zugeordneter_monat, ruecklastschrift_gebuehr')
            .range(from, to)
        ),
      ]);

      const rueckstaende: FehlendeMietzahlung[] = [];

      // Berechne für jeden Mietvertrag (aktiv, gekündigt, beendet)
      for (const mietvertrag of mietvertraege || []) {
        // Alle Verträge berücksichtigen, die potenziell Rückstände haben könnten
        // (aktiv, gekündigt, beendet)

        // Skip wenn keine Miete definiert ist
        if ((mietvertrag.kaltmiete || 0) === 0 && (mietvertrag.betriebskosten || 0) === 0) continue;

        // Filter vorgeladene Daten für diesen Mietvertrag
        const mietvertragForderungen = alleForderungen?.filter(f => f.mietvertrag_id === mietvertrag.id) || [];
        const mietvertragZahlungen = alleZahlungen?.filter(z => z.mietvertrag_id === mietvertrag.id) || [];

        // RÜCKSTANDSTABELLE: Nur Forderungen berücksichtigen, deren Fälligkeitsdatum (DB) bereits erreicht ist
        // Dies unterscheidet sich von den Mietvertrag-Details, wo ALLE Forderungen sofort zählen
        // Hinweis: 'T00:00:00' erzwingt lokale Zeitzone-Interpretation statt UTC (verhindert Off-by-one in CET/CEST)
        const heute = new Date();
        heute.setHours(0, 0, 0, 0);
        const faelligeForderungen = mietvertragForderungen.filter(f => {
          if (!f.faelligkeitsdatum) return false;
          return new Date(f.faelligkeitsdatum + 'T00:00:00') <= heute;
        });

        const { gesamtForderungen, gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
          mietvertrag,
          faelligeForderungen,
          mietvertragZahlungen
        );

        // Zeige nur Nettostand (Rückstand oder Guthaben nach Aufrechnung)
        // Filtere auch sehr kleine Beträge unter 1 Cent aus
        if (Math.abs(rueckstand) >= 0.01) {
          // Lade zusätzliche Informationen
          const einheit = einheiten?.find(e => e.id === mietvertrag.einheit_id);
          const immobilie = immobilien?.find(i => i.id === einheit?.immobilie_id);
          const alleMieter = mietvertragMieter?.filter(mm => mm.mietvertrag_id === mietvertrag.id) || [];
          const ersteMieter = alleMieter[0];
          const mietvertragDokumente = dokumente?.filter(dok => dok.mietvertrag_id === mietvertrag.id) || [];

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
          
          rueckstaende.push({
            mietvertrag_id: mietvertrag.id,
            fehlend_betrag: Math.abs(rueckstand), // Betrag immer positiv anzeigen
            gesamt_forderungen: gesamtForderungen,
            gesamt_zahlungen: gesamtZahlungen,
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
            dokumente: mietvertragDokumente,
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
          });
        }
      }
      
      return rueckstaende;
    }
  });
};