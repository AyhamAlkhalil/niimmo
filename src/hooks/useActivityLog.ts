import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type ActivityAction =
  | "login"
  | "logout"
  | "mietvertrag_geaendert"
  | "mieterhoehung_dokumentiert"
  | "kuendigung_durchgefuehrt"
  | "kaution_geaendert"
  | "zahlung_zugeordnet"
  | "zahlung_kategorie_geaendert"
  | "dokument_hochgeladen"
  | "mahnung_gesendet"
  | "pdf_generiert"
  | "mietforderung_erstellt"
  | "zählerstand_geaendert";

export const useActivityLog = () => {
  const { user } = useAuth();

  const logActivity = useCallback(
    async (
      action: ActivityAction,
      entityType?: string,
      entityId?: string,
      details?: Record<string, unknown>
    ) => {
      if (!user?.id) return;

      // Fire-and-forget: Fehler nie zum User propagieren
      void (async () => {
        await supabase.from("activity_logs").insert({
          user_id: user.id,
          user_email: user.email ?? null,
          action,
          entity_type: entityType ?? null,
          entity_id: entityId ?? null,
          details: details ?? null,
        });
      })();
    },
    [user]
  );

  return { logActivity };
};
