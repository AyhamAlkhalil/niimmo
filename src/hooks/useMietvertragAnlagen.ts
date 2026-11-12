import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

export interface AnlagenKandidat {
  id: string;
  titel: string;
  pfad: string;
}

/**
 * Für „Weitere Anlagen“ im Generator (12.11.2026): die zuletzt gewählten Anlagen (`mietvertrag.pdf_anlagen`, in
 * Reihenfolge) und die PDF-Dokumente des Vertrags, die sich anhängen lassen. Vertragsdokumente selbst (Kategorie
 * „Mietvertrag“: erstellte, unterschriebene, eingescannte Fassungen) stehen nicht zur Wahl.
 */
export function useMietvertragAnlagen(vertragId: string, aktiv: boolean) {
  return useQuery({
    queryKey: ['dokumente-detail', vertragId, 'pdf-anlagen'],
    enabled: aktiv && !!vertragId,
    // Je Öffnen frisch — sonst fehlte eine gerade im Reiter Dokumente hochgeladene Datei
    staleTime: 0,
    queryFn: async (): Promise<{ gemerkt: string[]; kandidaten: AnlagenKandidat[] }> => {
      const [vertrag, dokumente] = await Promise.all([
        supabase.from('mietvertrag').select('pdf_anlagen').eq('id', vertragId).maybeSingle(),
        supabase
          .from('dokumente')
          .select('id, titel, pfad, dateityp, kategorie')
          .eq('mietvertrag_id', vertragId)
          .eq('geloescht', false)
          .order('hochgeladen_am', { ascending: false })
          .range(0, 499),
      ]);
      if (vertrag.error) throw vertrag.error;
      if (dokumente.error) throw dokumente.error;
      const kandidaten = (dokumente.data ?? [])
        .filter(d => !!d.pfad && d.kategorie !== 'Mietvertrag' && (d.dateityp === 'application/pdf' || /\.pdf$/i.test(d.pfad)))
        .map(d => ({ id: d.id, titel: d.titel?.trim() || (d.pfad.split('/').pop() ?? 'Dokument'), pfad: d.pfad }));
      return { gemerkt: vertrag.data?.pdf_anlagen ?? [], kandidaten };
    },
  });
}
