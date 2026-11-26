import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { einheitenNummern } from "@/utils/einheitenReihenfolge";

/**
 * Nummer einer Einheit wie in Objektübersicht und Zählerliste („Einheit 5“). Bis zum 26.11.2026 zeigte
 * der Kopf der Vertragsdetails stattdessen die letzten zwei Zeichen der ID („Einheit 3f“), sodass sich
 * dieselbe Einheit in Zählerliste und Vertrag nicht wiedererkennen ließ.
 */
export function useEinheitNummer(einheit?: { id?: string | null; immobilie_id?: string | null } | null): number | undefined {
  const immobilieId = einheit?.immobilie_id ?? null;
  const { data: nummern } = useQuery({
    queryKey: ["einheiten-reihenfolge", immobilieId],
    enabled: !!immobilieId,
    queryFn: async () => {
      const { data, error } = await supabase.from("einheiten").select("id, erstellt_am").eq("immobilie_id", immobilieId!);
      if (error) throw error;
      return einheitenNummern(data ?? []);
    },
  });
  return einheit?.id ? nummern?.get(einheit.id) : undefined;
}
