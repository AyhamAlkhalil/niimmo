import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { alleSeiten } from "@/utils/supabaseSeiten";

export type EinheitZeile3D = Pick<Database["public"]["Tables"]["einheiten"]["Row"], "id" | "immobilie_id" | "etage" | "einheitentyp" | "qm">;

export type VertragZeile3D = Pick<
  Database["public"]["Tables"]["mietvertrag"]["Row"],
  "id" | "einheit_id" | "status" | "start_datum" | "ende_datum" | "kuendigungsdatum"
>;

interface MieterZeile {
  mietvertrag_id: string;
  mieter: { vorname: string | null; nachname: string | null } | null;
}

/** Query-Keys der 3D-Ansicht; nach Änderungen in Dialogen werden sie neu geladen. */
export const ANSICHT3D_KEYS = [["ansicht3d-einheiten"], ["ansicht3d-vertraege"], ["ansicht3d-mieter"]] as const;

/**
 * Alles, was die 3D-Ansicht zur Navigation braucht, in drei Abfragen über alle Objekte — nicht
 * je Objekt (docs/architektur.md §4). Seitenweise, weil PostgREST still nach 1000 Zeilen
 * abschneidet. Die Verträge dienen nur dazu, den richtigen Vertrag zu öffnen und den Mieter zu
 * nennen; Beträge lädt die Ansicht bewusst nicht (Wunsch vom 07.10.2026: Navigation, keine Zahlen).
 *
 * Ohne staleTime: Wer über die Objektseite einen Vertrag ändert und zurückkommt, sieht beim
 * erneuten Öffnen den neuen Stand; bis die Antwort da ist, bleibt der alte sichtbar.
 */
export function useAnsicht3dDaten() {
  const queryClient = useQueryClient();

  const einheiten = useQuery({
    queryKey: ["ansicht3d-einheiten"],
    queryFn: () =>
      alleSeiten<EinheitZeile3D>((von, bis, mitZaehlung) =>
        supabase
          .from("einheiten")
          .select("id, immobilie_id, etage, einheitentyp, qm", { count: mitZaehlung ? "exact" : undefined })
          .order("id")
          .range(von, bis)
      ),
  });

  const vertraege = useQuery({
    queryKey: ["ansicht3d-vertraege"],
    queryFn: () =>
      alleSeiten<VertragZeile3D>((von, bis, mitZaehlung) =>
        supabase
          .from("mietvertrag")
          .select("id, einheit_id, status, start_datum, ende_datum, kuendigungsdatum", { count: mitZaehlung ? "exact" : undefined })
          .order("id")
          .range(von, bis)
      ),
  });

  const mieter = useQuery({
    queryKey: ["ansicht3d-mieter"],
    queryFn: () =>
      alleSeiten<MieterZeile>((von, bis, mitZaehlung) =>
        supabase
          .from("mietvertrag_mieter")
          .select("mietvertrag_id, mieter:mieter_id (vorname, nachname)", { count: mitZaehlung ? "exact" : undefined })
          // Eindeutige Reihenfolge, sonst rutschen Zeilen an Seitengrenzen doppelt oder gar nicht durch.
          .order("mietvertrag_id")
          .order("mieter_id")
          .range(von, bis)
          .then((antwort) => ({ data: antwort.data as unknown as MieterZeile[] | null, error: antwort.error, count: antwort.count }))
      ),
  });

  const mieterJeVertrag = useMemo(() => {
    const karte = new Map<string, string[]>();
    for (const zeile of mieter.data ?? []) {
      const name = [zeile.mieter?.vorname, zeile.mieter?.nachname].filter(Boolean).join(" ").trim();
      if (!name) continue;
      karte.set(zeile.mietvertrag_id, [...(karte.get(zeile.mietvertrag_id) ?? []), name]);
    }
    return karte;
  }, [mieter.data]);

  const neuLaden = useCallback(() => {
    for (const key of ANSICHT3D_KEYS) queryClient.invalidateQueries({ queryKey: [...key] });
  }, [queryClient]);

  return {
    einheiten: einheiten.data,
    vertraege: vertraege.data,
    mieterJeVertrag,
    laedt: einheiten.isLoading || vertraege.isLoading || mieter.isLoading,
    /** Es gibt keine (vollständigen) Daten — die Szene kann nicht gezeigt werden. */
    fehler: (einheiten.isError && !einheiten.data) || (vertraege.isError && !vertraege.data) || (mieter.isError && !mieter.data),
    /** Daten sind da, aber eine Aktualisierung ist gescheitert: Stand ist womöglich veraltet. */
    aktualisierungFehler: (einheiten.isError && !!einheiten.data) || (vertraege.isError && !!vertraege.data) || (mieter.isError && !!mieter.data),
    neuLaden,
  };
}
