import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Die einzige verbliebene Benachrichtigung (seit 14.09.2026): Steht eine eigene
 * Meldung auf erledigt, erscheint beim nächsten Öffnen der Anwendung ein Hinweis
 * und gilt danach als gelesen. Glocke und Posteingang gibt es nicht mehr.
 *
 * Erzeugt wird der Eintrag vom Datenbank-Trigger beim Statuswechsel auf `fertig`.
 */
export function useErledigtHinweise() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    let abgebrochen = false;

    void (async () => {
      // Die Zugriffsregel liefert ohnehin nur eigene Benachrichtigungen.
      const { data, error } = await supabase
        .from("benachrichtigungen")
        .select("id, titel")
        .eq("typ", "erledigt")
        .is("gelesen_am", null)
        .order("erstellt_am", { ascending: true })
        .range(0, 49);

      if (abgebrochen || error || !data || data.length === 0) return;

      data.forEach((eintrag) => toast.success(eintrag.titel, { duration: 8000 }));

      await supabase
        .from("benachrichtigungen")
        .update({ gelesen_am: new Date().toISOString() })
        .in(
          "id",
          data.map((eintrag) => eintrag.id),
        );
    })();

    return () => {
      abgebrochen = true;
    };
  }, [user?.id]);
}
