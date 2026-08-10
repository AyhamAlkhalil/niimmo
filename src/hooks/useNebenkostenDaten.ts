import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { kostenAnteilImZeitraum } from "@/utils/nebenkostenBerechnung";
import {
  findeKategorieNachId,
  findeKategorieNachName,
} from "@/components/dashboard/nebenkosten/nebenkostenKategorien";

/**
 * Gemeinsame Datenzugriffe der Betriebskostenabrechnung.
 *
 * Vorher hielt jeder Schritt eine eigene Query mit eigenem Cache-Key und
 * abweichendem Filter. Dadurch sah Schritt 1 andere Kostenpositionen als
 * Schritt 3, und eine Zahlung konnte in zwei Abrechnungsjahren gleichzeitig als
 * "noch offen" erscheinen und doppelt umgelegt werden.
 *
 * Es werden bewusst ALLE Kostenpositionen einer Immobilie geladen (statt nach
 * Jahr gefiltert): nur so lässt sich erkennen, ob eine Zahlung bereits in einem
 * anderen Jahr verplant wurde.
 */

export interface KostenpositionMitArt {
  id: string;
  zahlung_id: string | null;
  nebenkostenart_id: string | null;
  immobilie_id: string;
  gesamtbetrag: number;
  zeitraum_von: string;
  zeitraum_bis: string;
  bezeichnung: string | null;
  quelle: string;
  ist_umlagefaehig: boolean;
  nebenkostenart: {
    id: string;
    name: string;
    verteilerschluessel_art: string | null;
    ist_umlagefaehig: boolean;
  } | null;
}

/**
 * Zahlungskategorien, die nie Betriebskosten sind. Ohne diesen Filter standen
 * Mieteingänge in der Zuordnungsliste und konnten über Math.abs() als Kosten
 * gebucht werden.
 */
export const NICHT_ZUORDENBARE_KATEGORIEN = [
  "Miete",
  "Mietkaution",
  "Ignorieren",
  "Rücklastschrift",
];

export function istZuordenbareZahlung(
  zahlung: { betrag: number; kategorie: string | null },
): boolean {
  if (zahlung.betrag >= 0) return false;
  return !zahlung.kategorie || !NICHT_ZUORDENBARE_KATEGORIEN.includes(zahlung.kategorie);
}

export const kostenpositionenKey = (immobilieId: string) =>
  ["kostenpositionen", immobilieId] as const;

export const nebenkostenartenKey = (immobilieId: string) =>
  ["nebenkostenarten", immobilieId] as const;

export function useKostenpositionen(immobilieId: string) {
  return useQuery({
    queryKey: kostenpositionenKey(immobilieId),
    queryFn: async (): Promise<KostenpositionMitArt[]> => {
      const { data, error } = await supabase
        .from("kostenpositionen")
        .select(
          "*, nebenkostenart:nebenkostenart_id(id, name, verteilerschluessel_art, ist_umlagefaehig)"
        )
        .eq("immobilie_id", immobilieId)
        .order("zeitraum_von", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as KostenpositionMitArt[];
    },
    enabled: !!immobilieId,
  });
}

export function useNebenkostenarten(immobilieId: string) {
  return useQuery({
    queryKey: nebenkostenartenKey(immobilieId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nebenkostenarten")
        .select("*")
        .eq("immobilie_id", immobilieId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!immobilieId,
  });
}

/** Invalidiert alle Caches, die von einer Zuordnungsänderung betroffen sind. */
export function useInvalidateNebenkosten(immobilieId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: kostenpositionenKey(immobilieId) });
    queryClient.invalidateQueries({ queryKey: nebenkostenartenKey(immobilieId) });
  };
}

/**
 * Findet die Nebenkostenart einer Immobilie zur BetrKV-Kategorie oder legt sie an.
 *
 * Der Lookup läuft über die zentrale Normalisierung. Die frühere Variante in
 * Schritt 1 verglich einen umlautfreien Namen mit der Kategorie-ID und traf bei
 * fünf Kategorien nie — bei jeder Zuordnung entstand eine weitere Nebenkostenart.
 */
export async function findeOderErstelleNebenkostenart(
  immobilieId: string,
  kategorieId: string,
  vorhandeneArten: { id: string; name: string }[] | undefined
): Promise<string> {
  const kategorie = findeKategorieNachId(kategorieId);
  if (!kategorie) throw new Error(`Unbekannte Kategorie: ${kategorieId}`);

  const vorhanden = vorhandeneArten?.find(
    (art) => findeKategorieNachName(art.name)?.id === kategorie.id
  );
  if (vorhanden) return vorhanden.id;

  const { data: neueArt, error } = await supabase
    .from("nebenkostenarten")
    .insert({
      immobilie_id: immobilieId,
      name: kategorie.name,
      ist_umlagefaehig: kategorie.umlagefaehig,
      verteilerschluessel_art: kategorie.schluessel,
    })
    .select("id")
    .single();

  if (error) {
    // Unique-Constraint (immobilie_id, lower(name)): parallel bereits angelegt.
    if (error.code === "23505") {
      const { data: nachgeladen } = await supabase
        .from("nebenkostenarten")
        .select("id")
        .eq("immobilie_id", immobilieId)
        .eq("name", kategorie.name)
        .maybeSingle();
      if (nachgeladen) return nachgeladen.id;
    }
    throw error;
  }

  return neueArt.id;
}

/** Alle Positionen, die den Zeitraum berühren — inkl. jahresübergreifender Rechnungen. */
export function positionenImZeitraum<T extends { zeitraum_von: string; zeitraum_bis: string }>(
  positionen: T[] | undefined,
  von: Date,
  bis: Date
): T[] {
  if (!positionen) return [];
  const vonIso = von.toISOString().slice(0, 10);
  const bisIso = bis.toISOString().slice(0, 10);
  return positionen.filter((p) => p.zeitraum_von <= bisIso && p.zeitraum_bis >= vonIso);
}

/**
 * Summiert je Zahlung, wie viel davon bereits auf Kostenpositionen verteilt ist —
 * über alle Abrechnungsjahre hinweg.
 */
export function verteilteBetraegeProZahlung(
  positionen: KostenpositionMitArt[] | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  positionen?.forEach((kp) => {
    if (!kp.zahlung_id) return;
    map.set(kp.zahlung_id, (map.get(kp.zahlung_id) || 0) + kp.gesamtbetrag);
  });
  return map;
}

/** Umlagefähige Kosten im Zeitraum, zeitanteilig gewichtet. */
export function summeImZeitraum(
  positionen: KostenpositionMitArt[] | undefined,
  von: Date,
  bis: Date,
  nurUmlagefaehig: boolean
): number {
  return positionenImZeitraum(positionen, von, bis)
    .filter((kp) => kp.ist_umlagefaehig === nurUmlagefaehig)
    .reduce((sum, kp) => sum + kostenAnteilImZeitraum(kp, von, bis), 0);
}
