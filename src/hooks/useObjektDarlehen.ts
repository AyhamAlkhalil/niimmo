import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { leseKontoauszugRate, type KontoauszugRate } from "@/utils/darlehenBerechnung";

export type ObjektDarlehen = Pick<
  Tables<"darlehen">,
  | "id"
  | "bezeichnung"
  | "bank"
  | "kontonummer"
  | "darlehensbetrag"
  | "restschuld"
  | "restschuld_stichtag"
  | "zinssatz_prozent"
  | "monatliche_rate"
  | "ende_datum"
> & {
  /** Weitere Objekte, denen dasselbe Darlehen zugeordnet ist. */
  auchObjekte: string[];
};

/** Darlehen eines Objekts. Lesen darf nur die Rolle admin (RLS), sonst kommt eine leere Liste. */
export function useObjektDarlehen(immobilieId: string, aktiv: boolean) {
  return useQuery({
    queryKey: ["objekt-darlehen", immobilieId],
    enabled: aktiv,
    queryFn: async (): Promise<ObjektDarlehen[]> => {
      const { data, error } = await supabase
        .from("darlehen_immobilien")
        .select(
          "darlehen(id, bezeichnung, bank, kontonummer, darlehensbetrag, restschuld, restschuld_stichtag, zinssatz_prozent, monatliche_rate, ende_datum)",
        )
        .eq("immobilie_id", immobilieId);
      if (error) throw error;
      const darlehen = (data ?? []).flatMap((z) => (z.darlehen ? [z.darlehen] : []));
      if (darlehen.length === 0) return [];

      const { data: geteilt, error: geteiltError } = await supabase
        .from("darlehen_immobilien")
        .select("darlehen_id, immobilien(name)")
        .in("darlehen_id", darlehen.map((d) => d.id))
        .neq("immobilie_id", immobilieId);
      if (geteiltError) throw geteiltError;

      return darlehen
        .map((d) => ({
          ...d,
          auchObjekte: (geteilt ?? []).filter((g) => g.darlehen_id === d.id).flatMap((g) => (g.immobilien ? [g.immobilien.name] : [])),
        }))
        .sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, "de", { numeric: true }));
    },
  });
}

/**
 * Raten aus dem Kontoauszug seit dem frühesten Stichtag, je Darlehen — für den Abgleich mit dem Plan.
 * Die Buchungen tragen die IBAN des Darlehenskontos, so wie sie in `darlehen.kontonummer` steht.
 */
export function useDarlehenBuchungen(immobilieId: string, darlehen: ObjektDarlehen[] | undefined) {
  const konten = (darlehen ?? []).filter((d) => d.kontonummer && d.restschuld_stichtag);
  const ab = konten.map((d) => d.restschuld_stichtag!).sort()[0] ?? null;
  return useQuery({
    queryKey: ["darlehen-buchungen", immobilieId, ab],
    enabled: konten.length > 0,
    queryFn: async (): Promise<Map<string, KontoauszugRate[]>> => {
      const { data, error } = await supabase
        .from("zahlungen")
        .select("iban, buchungsdatum, betrag, verwendungszweck")
        .in("iban", konten.map((d) => d.kontonummer!))
        .gte("buchungsdatum", ab!)
        // Raten sind Abbuchungen; Gutschriften (Storno, Erstattung) gehören nicht in den Abgleich.
        .lt("betrag", 0)
        .order("buchungsdatum", { ascending: false })
        // Eine Rate je Darlehen und Monat: 500 Zeilen reichen auch bei zwei Darlehen für Jahre ohne neuen
        // Stichtag; absteigend sortiert, damit bei Überlauf die ältesten wegfallen.
        .limit(500);
      if (error) throw error;
      return new Map(
        konten.map((d) => [d.id, (data ?? []).filter((z) => z.iban === d.kontonummer).map(leseKontoauszugRate)]),
      );
    },
  });
}
