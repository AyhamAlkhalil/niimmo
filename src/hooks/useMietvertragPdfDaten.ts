/**
 * Lädt alles, was für die Vertragserzeugung nötig ist, und bringt es in die
 * Form, die der Generator erwartet. Die Umrechnung selbst steht in
 * `utils/mietvertrag/datenAusDb.ts` — der Vertragsentwurf nutzt dieselbe.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { vertragsDaten } from '@/utils/mietvertrag/datenAusDb';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';

export function useMietvertragPdfDaten(vertragId: string | null, aktiv: boolean) {
  return useQuery({
    queryKey: ['mietvertrag-pdf-daten', vertragId],
    enabled: aktiv && !!vertragId,
    queryFn: async (): Promise<MietvertragDaten> => {
      const { data: vertrag, error: vertragError } = await supabase
        .from('mietvertrag')
        .select('*')
        .eq('id', vertragId!)
        .single();
      if (vertragError) throw vertragError;

      const { data: einheit, error: einheitError } = await supabase
        .from('einheiten')
        .select('*')
        .eq('id', vertrag.einheit_id)
        .single();
      if (einheitError) throw einheitError;

      const { data: immobilie, error: immobilieError } = await supabase
        .from('immobilien')
        .select('*')
        .eq('id', einheit.immobilie_id!)
        .single();
      if (immobilieError) throw immobilieError;

      // Vermieter: der am Objekt hinterlegte, sonst der Standardvermieter
      const vermieterQuery = immobilie.vermieter_id
        ? supabase.from('vermieter').select('*').eq('id', immobilie.vermieter_id).maybeSingle()
        : supabase.from('vermieter').select('*').eq('ist_standard', true).maybeSingle();
      const { data: vermieter, error: vermieterError } = await vermieterQuery;
      if (vermieterError) throw vermieterError;

      const { data: mieterRows, error: mieterError } = await supabase
        .from('mietvertrag_mieter')
        .select('rolle, position, mieter:mieter_id (*)')
        .eq('mietvertrag_id', vertragId!)
        .order('position');
      if (mieterError) throw mieterError;

      const { data: nebenkostenarten } = await supabase
        .from('nebenkostenarten')
        .select('name, verteilerschluessel_art, ist_umlagefaehig')
        .eq('immobilie_id', immobilie.id);

      const { data: nebenobjektRows } = await supabase
        .from('mietvertrag_einheiten')
        .select('teilmiete, einheit:einheit_id (bezeichnung, etage)')
        .eq('mietvertrag_id', vertragId!)
        .eq('rolle', 'nebenobjekt');

      return vertragsDaten({
        vertrag,
        einheit,
        immobilie,
        vermieter,
        mieter: (mieterRows ?? []).map(r => r.mieter).filter((m): m is NonNullable<typeof m> => !!m),
        nebenkostenarten: nebenkostenarten ?? [],
        nebenobjekte: (nebenobjektRows ?? []).map(n => ({
          teilmiete: n.teilmiete,
          bezeichnung: n.einheit?.bezeichnung ?? null,
          etage: n.einheit?.etage ?? null,
        })),
      });
    },
  });
}
