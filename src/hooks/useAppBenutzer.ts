import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Darf die angemeldete Person Probleme melden?
 *
 * Maßgeblich ist das interne Personenverzeichnis `app_benutzer`: Nur wer dort
 * aktiv ist und `darf_aufgaben` trägt, sieht den Melde-Knopf. Zugeordnet wird
 * über das Anmeldekonto, ersatzweise über die E-Mail-Adresse. Die eigentliche
 * Sperre liegt in der Datenbank.
 */
export function useAppBenutzer() {
  const { user } = useAuth();

  const { data: darfMelden = false, isLoading } = useQuery({
    queryKey: ["app-benutzer-darf-melden", user?.id],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("app_benutzer")
        .select("auth_user_id, email")
        .eq("aktiv", true)
        .eq("darf_aufgaben", true);

      if (error) throw error;
      const meineMail = user?.email?.toLowerCase();
      return (data ?? []).some(
        (b) =>
          b.auth_user_id === user?.id ||
          (!b.auth_user_id && !!meineMail && b.email?.toLowerCase() === meineMail),
      );
    },
    enabled: !!user?.id,
    // Das Verzeichnis ändert sich praktisch nie.
    staleTime: 30 * 60 * 1000,
  });

  return { darfMelden, isLoading };
}
