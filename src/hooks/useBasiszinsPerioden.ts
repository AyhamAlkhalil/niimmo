import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BASISZINSSATZ_PERIODEN_FALLBACK, mitAelterenPerioden } from "@/utils/verzugszinsen";

// Query-Keys zum Invalidieren nach einer manuellen Korrektur (DashboardStats). Bis zum 28.10.2026
// lud nur die Startseite neu; Mahnung und Mieterhöhung rechneten bis zu 30 Minuten mit dem alten Wert.
export const BASISZINS_PERIODEN_KEY = ["basiszins-perioden"] as const;
export const AKTUELLER_VPI_KEY = ["aktueller-vpi"] as const;

/**
 * Liefert alle Basiszinssatz-Perioden aus der marktdaten-Tabelle.
 * Faellt auf BASISZINSSATZ_PERIODEN_FALLBACK zurueck wenn DB nicht verfuegbar.
 */
export function useBasiszinsPerioden() {
  const { data, isLoading } = useQuery({
    queryKey: BASISZINS_PERIODEN_KEY,
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
    perioden: data ? mitAelterenPerioden(data) : BASISZINSSATZ_PERIODEN_FALLBACK,
    isLoading,
    fromDB: !!data,
  };
}

/**
 * Liefert den aktuellen VPI-Wert aus der marktdaten-Tabelle.
 */
export function useAktuellerVpi() {
  const { data, isLoading } = useQuery({
    queryKey: AKTUELLER_VPI_KEY,
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

