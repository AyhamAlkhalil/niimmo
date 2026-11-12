import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { VertragsDokument } from '@/utils/mietvertrag/fassungen';

/**
 * Vertragsdokumente (Kategorie „Mietvertrag“) eines Vertrags — für den Stand des Mietvertrags an Einheit und
 * Vertragsansicht (12.11.2026). Der Schlüssel liegt unter `['dokumente-detail', vertragId]`: Wer dort invalidiert
 * (Reiter Dokumente, Generator), aktualisiert auch diesen Stand.
 */
export function useMietvertragFassungen(vertragId: string, aktiv = true) {
  return useQuery({
    queryKey: ['dokumente-detail', vertragId, 'mietvertrag'],
    enabled: aktiv && !!vertragId,
    queryFn: async (): Promise<VertragsDokument[]> => {
      const { data, error } = await supabase
        .from('dokumente')
        .select('id, titel, pfad, hochgeladen_am, kategorie, geloescht')
        .eq('mietvertrag_id', vertragId)
        .eq('kategorie', 'Mietvertrag')
        .eq('geloescht', false)
        .order('hochgeladen_am', { ascending: false })
        // Live höchstens ein gutes Dutzend je Vertrag; die Grenze nur gegen stille Kürzung bei 1000
        .range(0, 499);
      if (error) throw error;
      return data ?? [];
    },
  });
}
