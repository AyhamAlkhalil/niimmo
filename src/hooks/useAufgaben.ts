import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AufnahmeKontext, Bildschirmaufnahme } from "@/utils/bildschirmaufnahme";
import type { Json } from "@/integrations/supabase/types";

/**
 * Meldungen: anlegen und als Liste ansehen.
 *
 * Seit dem 14.09.2026 bewusst schlank. Kommentare, Markieren, Zuständigkeit und
 * Bearbeiten in der Anwendung sind entfallen — abgearbeitet wird außerhalb, die
 * Liste zeigt nur, was gemeldet wurde und ob es erledigt ist.
 */

const BUCKET = "dokumente";
const ORDNER = "aufgaben";

export const AUFGABEN_SCHLUESSEL = ["aufgaben"] as const;

export type AufgabenStatus = "offen" | "geplant" | "in_entwicklung" | "in_testing" | "fertig";

export interface Aufgabe {
  id: string;
  titel: string;
  beschreibung: string | null;
  status: AufgabenStatus;
  erstellt_am: string;
  erledigt_am: string | null;
  seiten_titel: string | null;
  screenshot_pfade: string[];
  melder: { anzeigename: string } | null;
}

/** Alle Meldungen, neueste zuerst. */
export function useAufgabenListe() {
  return useQuery({
    queryKey: AUFGABEN_SCHLUESSEL,
    queryFn: async (): Promise<Aufgabe[]> => {
      const { data, error } = await supabase
        .from("dev_tickets")
        .select(
          `id, titel, beschreibung, status, erstellt_am, erledigt_am, seiten_titel, screenshot_pfade,
           melder:app_benutzer!dev_tickets_melder_id_fkey (anzeigename)`,
        )
        .order("erstellt_am", { ascending: false })
        .range(0, 499);

      if (error) throw error;
      return (data ?? []) as unknown as Aufgabe[];
    },
  });
}

/** Signierte Adresse für ein Bildschirmfoto, gültig für eine Stunde. */
export async function signiereScreenshot(pfad: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export interface NeueMeldung {
  titel: string;
  beschreibung?: string;
  aufnahme?: Bildschirmaufnahme | null;
  kontext?: AufnahmeKontext | null;
}

/**
 * Reihenfolge ist bewusst: erst das Bild hochladen, dann die Meldung schreiben —
 * so entsteht kein Eintrag, dessen Bild fehlt. Bleibt ein Bild ohne Meldung
 * liegen, ist das folgenlos.
 */
export function useAufgabeAnlegen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eingabe: NeueMeldung): Promise<void> => {
      const pfade: string[] = [];

      if (eingabe.aufnahme) {
        const pfad = `${ORDNER}/${zufallsOrdner()}/${eingabe.aufnahme.datei.name}`;
        const { error: uploadFehler } = await supabase.storage
          .from(BUCKET)
          .upload(pfad, eingabe.aufnahme.datei, {
            contentType: eingabe.aufnahme.datei.type,
            upsert: false,
          });
        if (uploadFehler) throw uploadFehler;
        pfade.push(pfad);
      }

      const { error } = await supabase.from("dev_tickets").insert({
        // melder_id und erstellt_von füllt die Datenbank selbst; Art und
        // Dringlichkeit bleiben auf ihren Vorgabewerten.
        titel: eingabe.titel,
        beschreibung: eingabe.beschreibung || null,
        status: "offen",
        quelle: eingabe.aufnahme ? "bildschirmmeldung" : "manuell",
        screenshot_pfade: pfade,
        seiten_pfad: eingabe.kontext?.pfad ?? null,
        seiten_titel: eingabe.kontext?.titel ?? null,
        technischer_kontext: eingabe.kontext
          ? (JSON.parse(JSON.stringify(eingabe.kontext)) as Json)
          : null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
    },
  });
}

function zufallsOrdner(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
