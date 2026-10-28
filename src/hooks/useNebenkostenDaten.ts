import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { kostenAnteilImZeitraum, positionenImZeitraum } from "@/utils/nebenkostenBerechnung";
import { alleSeiten } from "@/utils/supabaseSeiten";
import {
  NICHT_ZUORDENBARE_KATEGORIEN,
  istZuordenbareZahlung,
  summeUmzulegenderKostenarten,
} from "@/utils/nebenkostenGutschrift";
import {
  UmbuchungGesperrtFehler,
  umbuchungSperrgrund,
  type UmbuchungsAenderung,
} from "@/utils/nebenkostenUmbuchung";
import {
  findeKategorieNachId,
  findeKategorieNachName,
} from "@/components/dashboard/nebenkosten/nebenkostenKategorien";

// Lebt seit 27.10.2026 in utils (testbar); die Schritte importieren es weiter von hier.
export { positionenImZeitraum };
// Seit 28.10.2026 in utils/nebenkostenGutschrift.ts, weil Gutschriften der Versorger
// dazukamen und die Regel getestet sein muss.
export { NICHT_ZUORDENBARE_KATEGORIEN, istZuordenbareZahlung };

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
  /** Wer die Position angelegt hat. Bis 11.09.2026 nirgends gesetzt. */
  erstellt_von: string | null;
  nebenkostenart: {
    id: string;
    name: string;
    verteilerschluessel_art: string | null;
    ist_umlagefaehig: boolean;
  } | null;
}

export interface NebenkostenZahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  kategorie: string | null;
}

export const nebenkostenZahlungenKey = (immobilieId: string) =>
  ["immobilie-nebenkosten-zahlungen", immobilieId] as const;

/**
 * Buchungen eines Objekts, die in Schritt 1 zugeordnet werden können: alle
 * Ausgaben und, seit 28.10.2026, die Gutschriften der Versorger (Eingang unter
 * Nebenkosten). Vorher lud jede Stelle nur `betrag < 0`, eine Erstattung kam nie
 * in die Abrechnung. Schritt 1 und die Übersicht teilen sich den Cache-Schlüssel
 * und deshalb auch diese Abfrage. Seitenweise, weil PostgREST still bei 1000
 * Zeilen abschneidet.
 */
export function ladeNebenkostenZahlungen(immobilieId: string): Promise<NebenkostenZahlung[]> {
  return alleSeiten<NebenkostenZahlung>((von, bis, mitZaehlung) =>
    supabase
      .from("zahlungen")
      .select("id, betrag, buchungsdatum, verwendungszweck, empfaengername, iban, kategorie", {
        count: mitZaehlung ? "exact" : undefined,
      })
      .eq("immobilie_id", immobilieId)
      .or("betrag.lt.0,and(betrag.gt.0,kategorie.eq.Nebenkosten)")
      .order("buchungsdatum", { ascending: false })
      .order("id") // eindeutige Reihenfolge über die Seiten
      .range(von, bis)
  );
}

/**
 * Prüft unmittelbar vor dem Schreiben an der Datenbank, ob die Zahlung
 * Kostenpositionen trägt, die das Umbuchen verbieten, und wirft dann eine
 * fachliche Meldung. Der Zählwert aus der Oberfläche kann veraltet sein; der
 * Trigger auf `zahlungen` setzt die Regel zusätzlich serverseitig durch.
 */
export async function pruefeUmbuchung(
  zahlungId: string,
  aenderung: UmbuchungsAenderung
): Promise<void> {
  // Der Betrag entscheidet mit: Eine Gutschrift darf nur unter Nebenkosten bleiben.
  const [positionen, zahlung] = await Promise.all([
    supabase.from("kostenpositionen").select("immobilie_id").eq("zahlung_id", zahlungId),
    supabase.from("zahlungen").select("betrag").eq("id", zahlungId).maybeSingle(),
  ]);
  if (positionen.error) throw positionen.error;
  if (zahlung.error) throw zahlung.error;
  const grund = umbuchungSperrgrund(positionen.data ?? [], aenderung, Number(zahlung.data?.betrag ?? 0));
  if (grund) throw new UmbuchungGesperrtFehler(grund);
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

/**
 * Umlagefähige (bzw. nicht umlagefähige) Kosten im Zeitraum, zeitanteilig gewichtet —
 * seit 28.10.2026 wie in Schritt 3 je Kostenart netto: Arten, deren Gutschriften die
 * Kosten übersteigen, und Positionen ohne Kostenart zählen nicht mit.
 */
export function summeImZeitraum(
  positionen: KostenpositionMitArt[] | undefined,
  von: Date,
  bis: Date,
  nurUmlagefaehig: boolean
): number {
  return summeUmzulegenderKostenarten(
    positionenImZeitraum(positionen, von, bis).filter((kp) => kp.ist_umlagefaehig === nurUmlagefaehig),
    (kp) => kostenAnteilImZeitraum(kp, von, bis),
    (kp) =>
      kp.nebenkostenart
        ? findeKategorieNachName(kp.nebenkostenart.name)?.id ?? `custom_${kp.nebenkostenart.id}`
        : null
  );
}
