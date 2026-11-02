import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Unterzeichner, UnterzeichnerEintrag } from "@/utils/unterzeichner";

export const BRIEFUNTERZEICHNER_KEY = ["briefunterzeichner"] as const;

/** Fachliche Meldung statt `error.message` (architektur.md §7) */
export class UnterzeichnerSpeicherFehler extends Error {}

/**
 * Wer Schreiben unterzeichnen kann, aus `briefunterzeichner` (seit 02.11.2026). Eintragen, Ändern und Entfernen
 * direkt aus dem Auswahlfeld der Dialoge. Lesen und Schreiben nur für Admins (RLS) — der Hausmeister erreicht die
 * vier Dialoge nicht, er hat ein eigenes Dashboard.
 */
export function useBriefunterzeichner() {
  const queryClient = useQueryClient();

  const { data: eintraege = [], isLoading, isError } = useQuery({
    queryKey: BRIEFUNTERZEICHNER_KEY,
    queryFn: async (): Promise<UnterzeichnerEintrag[]> => {
      const { data, error } = await supabase
        .from("briefunterzeichner")
        .select("id, email, kontaktname, unterschrift, funktion, telefon")
        .order("unterschrift");
      if (error) throw error;
      return data ?? [];
    },
  });

  const neuLaden = () => queryClient.invalidateQueries({ queryKey: BRIEFUNTERZEICHNER_KEY });

  const speichern = useMutation({
    mutationFn: async ({ id, daten }: { id?: string; daten: Unterzeichner }): Promise<string> => {
      const { data, error } = id
        ? await supabase.from("briefunterzeichner").update(daten).eq("id", id).select("id").single()
        : await supabase.from("briefunterzeichner").insert(daten).select("id").single();
      if (error) {
        console.error("[useBriefunterzeichner] Speichern fehlgeschlagen:", error.code);
        throw new UnterzeichnerSpeicherFehler(
          error.code === "23505" ? "Diese E-Mail ist schon eingetragen." : "Die Angaben konnten nicht gespeichert werden.",
        );
      }
      return data.id;
    },
    onSettled: neuLaden,
  });

  const entfernen = useMutation({
    mutationFn: async (id: string) => {
      // Ohne Recht löscht RLS still nichts; das darf nicht wie ein Erfolg aussehen
      const { data, error } = await supabase.from("briefunterzeichner").delete().eq("id", id).select("id");
      if (error || !data?.length) {
        console.error("[useBriefunterzeichner] Entfernen fehlgeschlagen:", error?.code ?? "keine Zeile");
        throw new UnterzeichnerSpeicherFehler("Die Person konnte nicht entfernt werden.");
      }
    },
    onSettled: neuLaden,
  });

  return { eintraege, isLoading, isError, speichern, entfernen };
}
