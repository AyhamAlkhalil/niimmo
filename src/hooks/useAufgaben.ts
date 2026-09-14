import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AufnahmeKontext, Bildschirmaufnahme } from "@/utils/bildschirmaufnahme";
import type { Json } from "@/integrations/supabase/types";

/**
 * Problem melden: Bildschirmfoto hochladen, Meldung in `dev_tickets` schreiben.
 *
 * Seit dem 14.09.2026 das Einzige, was die Anwendung am Aufgabensystem noch tut.
 * Board, Kommentare, Markieren und Benachrichtigungen sind entfallen — Meldungen
 * werden außerhalb der Anwendung abgearbeitet.
 */

const BUCKET = "dokumente";
const ORDNER = "aufgaben";

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
  });
}

function zufallsOrdner(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
