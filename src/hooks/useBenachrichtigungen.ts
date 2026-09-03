import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAppBenutzer } from "./useAppBenutzer";

/**
 * Posteingang einer Person.
 *
 * Die Einträge entstehen ausschließlich in der Datenbank (Trigger), damit keine
 * Meldung verlorengeht, wenn der Browser zwischendurch geschlossen wird. Der
 * Client liest nur und setzt „gelesen".
 */

export type BenachrichtigungsTyp = "erwaehnung" | "zuweisung" | "kommentar" | "status";

export interface Benachrichtigung {
  id: string;
  ticket_id: string | null;
  typ: BenachrichtigungsTyp;
  titel: string;
  text: string | null;
  gelesen_am: string | null;
  erstellt_am: string;
  ausgeloest_von: string | null;
  ausloeser: { anzeigename: string; kuerzel: string } | null;
}

const ABFRAGE_SCHLUESSEL = ["benachrichtigungen"] as const;

export function useBenachrichtigungen() {
  const queryClient = useQueryClient();
  const { ichSelbst } = useAppBenutzer();
  const meineId = ichSelbst?.id ?? null;

  const { data: eintraege = [], isLoading } = useQuery({
    queryKey: [...ABFRAGE_SCHLUESSEL, meineId],
    queryFn: async (): Promise<Benachrichtigung[]> => {
      if (!meineId) return [];

      const { data, error } = await supabase
        .from("benachrichtigungen")
        .select(
          `id, ticket_id, typ, titel, text, gelesen_am, erstellt_am, ausgeloest_von,
           ausloeser:app_benutzer!benachrichtigungen_ausgeloest_von_fkey (anzeigename, kuerzel)`,
        )
        // Die Zugriffsregel schraenkt bereits auf eigene Zeilen ein. Der
        // Filter steht trotzdem hier, damit die Absicht nicht allein an der
        // Regel haengt und die Begrenzung auf 50 sicher die eigenen trifft.
        .eq("empfaenger_id", meineId)
        .order("erstellt_am", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data ?? []) as unknown as Benachrichtigung[];
    },
    enabled: !!meineId,
  });

  const ungelesen = eintraege.filter((e) => !e.gelesen_am);

  const alsGelesenMarkieren = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("benachrichtigungen")
        .update({ gelesen_am: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ABFRAGE_SCHLUESSEL, meineId] });
    },
  });

  return {
    eintraege,
    ungelesen,
    anzahlUngelesen: ungelesen.length,
    isLoading,
    alsGelesenMarkieren: (ids: string[]) => alsGelesenMarkieren.mutate(ids),
    alleAlsGelesenMarkieren: () => alsGelesenMarkieren.mutate(ungelesen.map((e) => e.id)),
  };
}

/**
 * Live-Zustellung. Bewusst getrennt von der Abfrage und genau EINMAL gemountet
 * (siehe App): Die Glocke steckt sowohl im Kopfbereich als auch in der
 * schwebenden Leiste — zwei Abonnements würden denselben Kanal doppelt öffnen
 * und jede Meldung zweimal einblenden.
 */
export function useBenachrichtigungsStrom() {
  const queryClient = useQueryClient();
  const { ichSelbst } = useAppBenutzer();
  const meineId = ichSelbst?.id ?? null;

  useEffect(() => {
    if (!meineId) return;

    const kanal = supabase
      .channel(`benachrichtigungen-${meineId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "benachrichtigungen",
          filter: `empfaenger_id=eq.${meineId}`,
        },
        (nachricht) => {
          const neu = nachricht.new as { titel?: string; text?: string | null };
          queryClient.invalidateQueries({ queryKey: [...ABFRAGE_SCHLUESSEL, meineId] });
          toast(neu.titel ?? "Neue Benachrichtigung", {
            description: neu.text ?? undefined,
            duration: 8000,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(kanal);
    };
  }, [meineId, queryClient]);
}
