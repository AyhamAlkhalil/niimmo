import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMietvertragData(vertragId: string, isOpen: boolean) {
  const queryClient = useQueryClient();

  // Real-time subscriptions
  useEffect(() => {
    if (!isOpen || !vertragId) return;

    const channel = supabase
      .channel(`mietvertrag-details-${vertragId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mietforderungen', filter: `mietvertrag_id=eq.${vertragId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
          queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
          queryClient.invalidateQueries({ queryKey: ['immobilien'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'zahlungen', filter: `mietvertrag_id=eq.${vertragId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
          queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
          queryClient.invalidateQueries({ queryKey: ['immobilien'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mietvertrag', filter: `id=eq.${vertragId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
          queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
          queryClient.invalidateQueries({ queryKey: ['immobilien'] });
          queryClient.invalidateQueries({ queryKey: ['einheiten'] });
          queryClient.invalidateQueries({ predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'mietvertrag-detail'
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mieter' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-mieter-detail', vertragId] });
          queryClient.invalidateQueries({ queryKey: ['all-tenants'] });
          queryClient.invalidateQueries({ queryKey: ['mieter'] });
          queryClient.invalidateQueries({ predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'mietvertrag-detail'
          });
          queryClient.invalidateQueries({ predicate: (query) =>
            Array.isArray(query.queryKey) &&
            (query.queryKey[0] === 'mietvertrag-mieter' || query.queryKey[0] === 'mietvertrag-mieter-detail')
          });
          queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, vertragId, queryClient]);

  // Queries
  const { data: vertrag, isLoading: vertragLoading } = useQuery({
    queryKey: ['mietvertrag-detail', vertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select('*')
        .eq('id', vertragId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isOpen && !!vertragId,
  });

  const { data: fetchedEinheit } = useQuery({
    queryKey: ['einheit-detail', vertrag?.einheit_id],
    queryFn: async () => {
      if (!vertrag?.einheit_id) return null;
      const { data, error } = await supabase
        .from('einheiten')
        .select('*')
        .eq('id', vertrag.einheit_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isOpen && !!vertrag?.einheit_id,
  });

  const { data: mieter } = useQuery({
    queryKey: ['mietvertrag-mieter-detail', vertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag_mieter')
        .select(`mieter:mieter_id ( id, vorname, nachname, hauptmail, telnr, geburtsdatum, aktualisiert_am, erstellt_am, weitere_mails )`)
        .eq('mietvertrag_id', vertragId);
      if (error) throw error;
      return data?.map(mm => mm.mieter) || [];
    },
    enabled: isOpen && !!vertragId,
  });

  const { data: zahlungen } = useQuery({
    queryKey: ['zahlungen-detail', vertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .eq('mietvertrag_id', vertragId)
        .order('buchungsdatum', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: allMietvertraege } = useQuery({
    queryKey: ['all-mietvertraege'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id, einheit_id,
          einheiten ( immobilie_id, immobilien ( name, adresse ) ),
          mietvertrag_mieter ( mieter:mieter_id ( vorname, nachname ) )
        `);
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen,
  });

  const { data: forderungen } = useQuery({
    queryKey: ['mietforderungen', vertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietforderungen')
        .select('*, ist_faellig, faelligkeitsdatum, faellig_seit')
        .eq('mietvertrag_id', vertragId)
        .order('sollmonat', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen && !!vertragId,
  });

  const { data: dokumente } = useQuery({
    queryKey: ['dokumente-detail', vertragId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dokumente')
        .select('*')
        .eq('mietvertrag_id', vertragId)
        .eq('geloescht', false)
        .order('hochgeladen_am', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen && !!vertragId,
  });

  return {
    vertrag,
    vertragLoading,
    fetchedEinheit,
    mieter,
    zahlungen,
    allMietvertraege,
    forderungen,
    dokumente,
    queryClient,
  };
}
