import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ErhoehungsVorgang } from "@/utils/mieterhoehungRegeln";

/** Query-Key; RentIncreaseModal invalidiert ihn nach Zustimmung und Übernahme. */
export const vereinbarteMieterhoehungKey = (mietvertragId: string) => ["mieterhoehung-vereinbart", mietvertragId] as const;

/**
 * Die vereinbarte, noch nicht übernommene Mieterhöhung eines Vertrags (Status 'zugestimmt'), sonst null.
 *
 * Seit 28.10.2026 gilt eine Erhöhung erst ab wirksam_ab (§ 558b Abs. 1 BGB): Bis dahin steht am Vertrag
 * noch die alte Miete, die Datenbank stellt sie zum Wirksamwerden um (Migration 20261028142000). Damit
 * die Vereinbarung am Vertrag sichtbar ist, liest dieser Hook sie gesondert. Höchstens eine Zeile je
 * Vertrag (Unique-Index mieterhoehungen_eine_vereinbarte_je_vertrag). RLS lässt nur Admins lesen — für
 * andere Rollen ist das Ergebnis leer, nicht fehlerhaft.
 */
export function useVereinbarteMieterhoehung(mietvertragId: string | null | undefined) {
  return useQuery({
    queryKey: vereinbarteMieterhoehungKey(mietvertragId ?? ""),
    enabled: !!mietvertragId,
    queryFn: async (): Promise<ErhoehungsVorgang | null> => {
      const { data, error } = await supabase
        .from("mieterhoehungen")
        .select("id, verlangt_am, wirksam_ab, zugestimmt_am, alte_kaltmiete, alte_betriebskosten, neue_kaltmiete, neue_betriebskosten, status")
        .eq("mietvertrag_id", mietvertragId as string)
        .eq("status", "zugestimmt")
        .order("wirksam_ab", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ErhoehungsVorgang | null;
    },
    staleTime: 60 * 1000,
  });
}
