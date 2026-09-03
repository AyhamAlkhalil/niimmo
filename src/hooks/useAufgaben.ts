import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { AppBenutzer } from "./useAppBenutzer";
import type { AufnahmeKontext, Bildschirmaufnahme } from "@/utils/bildschirmaufnahme";
import type { Json } from "@/integrations/supabase/types";

/**
 * Aufgaben-Board.
 *
 * Grundlage ist die vorhandene Ticket-Tabelle; sie war bisher nirgends
 * eingebunden. Bildschirmfotos liegen als Pfade im privaten Dokumenten-Bucket
 * unter `aufgaben/` und bekommen erst beim Anzeigen eine signierte Adresse.
 */

export const AUFGABEN_SCHLUESSEL = ["aufgaben"] as const;

const BUCKET = "dokumente";
const ORDNER = "aufgaben";

export type AufgabenTyp = "bug" | "feature" | "aufgabe";
export type AufgabenStatus = "offen" | "geplant" | "in_entwicklung" | "in_testing" | "fertig";
export type AufgabenPrioritaet = "kritisch" | "hoch" | "mittel" | "niedrig";

type BenutzerKurz = Pick<AppBenutzer, "id" | "anzeigename" | "kuerzel" | "funktion">;

export interface Aufgabe {
  id: string;
  typ: AufgabenTyp;
  titel: string;
  kurzbeschreibung: string | null;
  beschreibung: string | null;
  status: AufgabenStatus;
  prioritaet: AufgabenPrioritaet;
  erstellt_am: string;
  aktualisiert_am: string;
  erledigt_am: string | null;
  quelle: "manuell" | "bildschirmmeldung";
  seiten_pfad: string | null;
  seiten_titel: string | null;
  technischer_kontext: Record<string, unknown> | null;
  screenshot_pfade: string[];
  verantwortlich_id: string | null;
  melder_id: string | null;
  verantwortlich: BenutzerKurz | null;
  melder: BenutzerKurz | null;
  erwaehnungen: { benutzer_id: string; benutzer: BenutzerKurz | null }[];
}

const AUSWAHL = `
  id, typ, titel, kurzbeschreibung, beschreibung, status, prioritaet,
  erstellt_am, aktualisiert_am, erledigt_am, quelle, seiten_pfad, seiten_titel,
  technischer_kontext, screenshot_pfade, verantwortlich_id, melder_id,
  verantwortlich:app_benutzer!dev_tickets_verantwortlich_id_fkey (id, anzeigename, kuerzel, funktion),
  melder:app_benutzer!dev_tickets_melder_id_fkey (id, anzeigename, kuerzel, funktion),
  erwaehnungen:dev_ticket_erwaehnungen (
    benutzer_id,
    benutzer:app_benutzer!dev_ticket_erwaehnungen_benutzer_id_fkey (id, anzeigename, kuerzel, funktion)
  )
`;

export function useAufgaben() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const abfrage = useQuery({
    queryKey: AUFGABEN_SCHLUESSEL,
    queryFn: async (): Promise<Aufgabe[]> => {
      const { data, error } = await supabase
        .from("dev_tickets")
        .select(AUSWAHL)
        .order("sort_order", { ascending: true })
        .order("erstellt_am", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as Aufgabe[];
    },
    enabled: !!user?.id,
  });

  // Das Board bleibt aktuell, wenn jemand anderes etwas ändert.
  useEffect(() => {
    if (!user?.id) return;
    const kanal = supabase
      .channel("aufgaben-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_tickets" }, () => {
        queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(kanal);
    };
  }, [user?.id, queryClient]);

  return abfrage;
}

export interface AnlageErgebnis {
  aufgabenId: string;
  /** Die Aufgabe steht, nur das Markieren der Personen schlug fehl. */
  markierungenFehlgeschlagen: boolean;
}

export interface NeueAufgabe {
  titel: string;
  typ: AufgabenTyp;
  prioritaet: AufgabenPrioritaet;
  beschreibung?: string;
  verantwortlichId: string | null;
  erwaehnteIds: string[];
  aufnahme?: Bildschirmaufnahme | null;
  kontext?: AufnahmeKontext | null;
}

/**
 * Legt eine Aufgabe an. Reihenfolge ist bewusst: erst das Bild hochladen, dann
 * die Aufgabe schreiben — so entsteht kein Eintrag, dessen Bild fehlt. Bleibt
 * ein Bild ohne Aufgabe liegen, ist das folgenlos.
 */
export function useAufgabeAnlegen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eingabe: NeueAufgabe): Promise<AnlageErgebnis> => {
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

      const { data, error } = await supabase
        .from("dev_tickets")
        .insert({
          // melder_id und erstellt_von fuellt die Datenbank selbst
          // (Spalten-Vorgabewerte mein_app_benutzer_id() bzw. auth.uid()).
          titel: eingabe.titel,
          typ: eingabe.typ,
          prioritaet: eingabe.prioritaet,
          beschreibung: eingabe.beschreibung || null,
          status: "offen",
          quelle: eingabe.aufnahme ? "bildschirmmeldung" : "manuell",
          verantwortlich_id: eingabe.verantwortlichId,
          screenshot_pfade: pfade,
          seiten_pfad: eingabe.kontext?.pfad ?? null,
          seiten_titel: eingabe.kontext?.titel ?? null,
          technischer_kontext: eingabe.kontext
            ? (JSON.parse(JSON.stringify(eingabe.kontext)) as Json)
            : null,
        })
        .select("id")
        .single();

      if (error) throw error;
      const aufgabenId = data.id as string;

      // Die verantwortliche Person wird schon über die Zuweisung benachrichtigt;
      // eine zusätzliche Erwähnung wäre eine doppelte Meldung.
      const zuMarkieren = eingabe.erwaehnteIds.filter((id) => id !== eingabe.verantwortlichId);
      if (zuMarkieren.length) {
        const { error: erwaehnungsFehler } = await supabase
          .from("dev_ticket_erwaehnungen")
          .insert(zuMarkieren.map((benutzer_id) => ({ ticket_id: aufgabenId, benutzer_id })));

        // Die Aufgabe steht bereits. Wuerde hier geworfen, meldete die
        // Oberflaeche einen Fehlschlag, der Nutzer drueckte erneut — und es
        // entstuende eine zweite Aufgabe samt zweitem Bild. Stattdessen wird
        // die Aufgabe zurueckgegeben und der Teilfehler gesondert gemeldet.
        if (erwaehnungsFehler) {
          return { aufgabenId, markierungenFehlgeschlagen: true };
        }
      }

      return { aufgabenId, markierungenFehlgeschlagen: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
    },
  });
}

export function useAufgabeAendern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      aenderung,
    }: {
      id: string;
      aenderung: Partial<{
        titel: string;
        typ: AufgabenTyp;
        status: AufgabenStatus;
        prioritaet: AufgabenPrioritaet;
        kurzbeschreibung: string | null;
        beschreibung: string | null;
        verantwortlich_id: string | null;
      }>;
    }) => {
      const { error } = await supabase.from("dev_tickets").update(aenderung).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
    },
  });
}

export function useAufgabeLoeschen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dev_tickets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
    },
  });
}

export function useErwaehnungSetzen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      benutzerId,
      markieren,
    }: {
      ticketId: string;
      benutzerId: string;
      markieren: boolean;
    }) => {
      if (markieren) {
        const { error } = await supabase
          .from("dev_ticket_erwaehnungen")
          .insert({ ticket_id: ticketId, benutzer_id: benutzerId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("dev_ticket_erwaehnungen")
          .delete()
          .eq("ticket_id", ticketId)
          .eq("benutzer_id", benutzerId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUFGABEN_SCHLUESSEL });
    },
  });
}

/** Signierte Adresse für ein Bildschirmfoto, gültig für eine Stunde. */
export async function signiereScreenshot(pfad: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

function zufallsOrdner(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
