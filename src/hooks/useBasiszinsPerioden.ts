import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BASISZINSSATZ_PERIODEN_FALLBACK } from "@/utils/verzugszinsen";

/**
 * Liefert alle Basiszinssatz-Perioden aus der marktdaten-Tabelle.
 * Faellt auf BASISZINSSATZ_PERIODEN_FALLBACK zurueck wenn DB nicht verfuegbar.
 */
export function useBasiszinsPerioden() {
  const { data, isLoading } = useQuery({
    queryKey: ["basiszins-perioden"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("marktdaten")
        .select("stichtag, wert")
        .eq("typ", "basiszinssatz")
        .order("stichtag", { ascending: false });

      if (error) {
        console.error('[useBasiszinsPerioden] DB-Fehler — Fallback wird verwendet:', error);
        return null;
      }
      if (!data || data.length === 0) return null;

      return data.map((row) => ({
        ab: row.stichtag,
        satz: row.wert,
      }));
    },
    staleTime: 1000 * 60 * 30, // 30 Minuten
  });

  return {
    perioden: data ?? BASISZINSSATZ_PERIODEN_FALLBACK,
    isLoading,
    fromDB: !!data,
  };
}

/**
 * Liefert den aktuellen VPI-Wert aus der marktdaten-Tabelle.
 */
export function useAktuellerVpi() {
  const { data, isLoading } = useQuery({
    queryKey: ["aktueller-vpi"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("aktuelle_marktdaten")
        .select("wert, stichtag")
        .eq("typ", "vpi")
        .maybeSingle();

      if (error || !data) return null;
      return { wert: data.wert, stichtag: data.stichtag };
    },
    staleTime: 1000 * 60 * 30,
  });

  return { vpi: data, isLoading };
}
