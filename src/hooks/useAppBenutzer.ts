import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Internes Personenverzeichnis für Erwähnungen.
 *
 * Es liegt bewusst nicht in `auth.users`: Die Buchhaltung soll markierbar sein,
 * obwohl es dafür noch kein Anmeldekonto gibt. Sobald das Konto angelegt wird,
 * greift die Zuordnung über die E-Mail-Adresse von selbst.
 *
 * Die Leseberechtigung liegt in der Datenbank — der Hausmeister erhält hier
 * eine leere Liste und damit auch kein eigenes Profil.
 */

export type BenutzerFunktion =
  | "geschaeftsfuehrung"
  | "entwicklung"
  | "buchhaltung"
  | "hausmeister";

export interface AppBenutzer {
  id: string;
  auth_user_id: string | null;
  email: string;
  anzeigename: string;
  kuerzel: string;
  funktion: BenutzerFunktion;
  darf_aufgaben: boolean;
  aktiv: boolean;
  sortierung: number;
}

export const FUNKTION_BEZEICHNUNG: Record<BenutzerFunktion, string> = {
  geschaeftsfuehrung: "Geschäftsführung",
  entwicklung: "Entwicklung",
  buchhaltung: "Buchhaltung",
  hausmeister: "Hausmeister",
};

export function useAppBenutzer() {
  const { user } = useAuth();

  const { data: benutzer = [], isLoading } = useQuery({
    // Mit der Konto-Kennung im Schluessel: Welche Zeilen sichtbar sind, haengt
    // an der Zugriffsregel des angemeldeten Kontos.
    queryKey: ["app-benutzer", user?.id],
    queryFn: async (): Promise<AppBenutzer[]> => {
      const { data, error } = await supabase
        .from("app_benutzer")
        .select("id, auth_user_id, email, anzeigename, kuerzel, funktion, darf_aufgaben, aktiv, sortierung")
        .eq("aktiv", true)
        .eq("darf_aufgaben", true)
        .order("sortierung");

      if (error) throw error;
      return (data ?? []) as AppBenutzer[];
    },
    enabled: !!user?.id,
    // Das Verzeichnis ändert sich praktisch nie.
    staleTime: 30 * 60 * 1000,
  });

  const ichSelbst = useMemo(() => {
    if (!user) return null;
    const perKonto = benutzer.find((b) => b.auth_user_id === user.id);
    if (perKonto) return perKonto;
    const meineMail = user.email?.toLowerCase();
    return benutzer.find((b) => b.email.toLowerCase() === meineMail) ?? null;
  }, [benutzer, user]);

  const entwickler = useMemo(
    () => benutzer.find((b) => b.funktion === "entwicklung") ?? null,
    [benutzer],
  );

  return {
    benutzer,
    ichSelbst,
    /** Vorbelegung für „Verantwortlich", damit ein Klick genügt. */
    entwickler,
    /** Nur wer im Verzeichnis steht, darf melden — greift zusätzlich zur Rollenprüfung. */
    darfMelden: !!ichSelbst,
    isLoading,
  };
}
