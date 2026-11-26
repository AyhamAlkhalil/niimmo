import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AblesungAktion } from "@/utils/zaehlerAblesung";

/** Zähler an einer Einheit oder am Hausanschluss eines Objekts */
export type ZaehlerOrt = { einheitId: string } | { immobilieId: string };

/**
 * Schreibt eine Ablesung nach `ablesungAktion` (utils/zaehlerAblesung.ts). Den aktuellen Stand an
 * Einheit bzw. Objekt zieht die Datenbank aus der Historie nach (Trigger zaehlerstand_historie_nachziehen,
 * Migration 20261126100000) — keine Maske schreibt ihn mehr selbst.
 *
 * `typ` ist der zaehler_typ der Historie: kaltwasser, warmwasser, strom, gas an der Einheit;
 * wasser, strom, gas und wasser_2, strom_2, gas_2 am Hausanschluss.
 */
export async function ablesungSpeichern(
  ort: ZaehlerOrt,
  typ: string,
  aktion: AblesungAktion,
  zaehlerNummer: string | null
): Promise<void> {
  if (aktion.art !== "neu" && aktion.art !== "datum_korrigieren") return;
  const ortSpalten = "einheitId" in ort ? { einheit_id: ort.einheitId } : { immobilie_id: ort.immobilieId };

  const einfuegen = async (stand: number, datum: string) => {
    const { data, error } = await supabase
      .from("zaehlerstand_historie")
      .insert({ ...ortSpalten, zaehler_typ: typ, zaehler_nummer: zaehlerNummer?.trim() || null, stand, datum, quelle: "manuell" })
      .select("id");
    if (error) throw error;
    // RLS lässt einen verweigerten Schreibzugriff still ins Leere laufen
    if (!data || data.length === 0) throw new Error("Ablesung wurde nicht gespeichert");
  };

  if (aktion.art === "neu") {
    await einfuegen(aktion.stand, aktion.datum);
    return;
  }

  // Datum der aktuellen Ablesung korrigieren: die Zeile mit diesem Stand und Datum verschieben
  let abfrage = supabase
    .from("zaehlerstand_historie")
    .update({ datum: aktion.aufDatum })
    .eq("zaehler_typ", typ)
    .eq("stand", aktion.stand)
    .eq("datum", aktion.vonDatum);
  abfrage = "einheitId" in ort ? abfrage.eq("einheit_id", ort.einheitId) : abfrage.eq("immobilie_id", ort.immobilieId).is("einheit_id", null);
  const { data, error } = await abfrage.select("id");
  if (error) throw error;
  // Ohne passende Zeile (Altbestand): als Ablesung zum neuen Tag eintragen
  if (!data || data.length === 0) await einfuegen(aktion.stand, aktion.aufDatum);
}

/** Nach jeder Änderung an Zählern: alle Ansichten neu laden, die Stände zeigen */
export async function zaehlerAnsichtenAktualisieren(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    ["zaehler-verwaltung-immobilien", "hausmeister-immobilien", "immobilie", "einheiten", "einheit-detail", "zaehlerstand-historie"].map(
      (schluessel) => queryClient.invalidateQueries({ queryKey: [schluessel] })
    )
  );
}
