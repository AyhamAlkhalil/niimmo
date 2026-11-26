import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AblesungAktion } from "@/utils/zaehlerAblesung";
import { zaehlerstandAnzeige } from "@/utils/zaehlerstandUtils";

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
): Promise<string | null> {
  if (aktion.art !== "neu" && aktion.art !== "datum_korrigieren") return null;
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
    return null;
  }

  // Datum der aktuellen Ablesung korrigieren. Sie ist die jüngste Zeile dieses Tages (so wählt der Trigger);
  // genau diese eine Zeile verschieben und den Stand in JavaScript vergleichen statt per Filter auf numeric
  // (Review 26.11.2026: ein ungenauer Treffer hätte eine zweite, ältere Zeile angelegt).
  let suche = supabase
    .from("zaehlerstand_historie")
    .select("id, stand")
    .eq("zaehler_typ", typ)
    .eq("datum", aktion.vonDatum);
  suche = "einheitId" in ort ? suche.eq("einheit_id", ort.einheitId) : suche.eq("immobilie_id", ort.immobilieId).is("einheit_id", null);
  const { data: zeilen, error: suchFehler } = await suche.order("erstellt_am", { ascending: false }).order("id", { ascending: false });
  if (suchFehler) throw suchFehler;
  const zeile = (zeilen ?? []).find((z) => z.stand !== null && Number(z.stand) === aktion.stand);
  if (zeile) {
    const { data, error } = await supabase.from("zaehlerstand_historie").update({ datum: aktion.aufDatum }).eq("id", zeile.id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Ablesung wurde nicht geändert");
  } else {
    // Ohne passende Zeile (Altbestand): als Ablesung zum neuen Tag eintragen
    await einfuegen(aktion.stand, aktion.aufDatum);
  }

  // Liegt zwischen altem und neuem Tag eine andere Ablesung, gilt jetzt diese — sagen, statt still zu wechseln
  const [standSpalte, datumSpalte] =
    "einheitId" in ort
      ? [`${typ}_stand_aktuell`, `${typ}_stand_datum`]
      : [`allgemein_${typ.replace("_2", "")}_stand${typ.endsWith("_2") ? "_2" : ""}`, `allgemein_${typ.replace("_2", "")}_datum${typ.endsWith("_2") ? "_2" : ""}`];
  const { data: nachher } = await supabase
    .from("einheitId" in ort ? "einheiten" : "immobilien")
    .select(`${standSpalte}, ${datumSpalte}`)
    .eq("id", "einheitId" in ort ? ort.einheitId : ort.immobilieId)
    .maybeSingle();
  const jetzt = nachher as unknown as Record<string, unknown> | null;
  const jetztDatum = typeof jetzt?.[datumSpalte] === "string" ? (jetzt[datumSpalte] as string) : null;
  if (jetztDatum && jetztDatum !== aktion.aufDatum) {
    const [j, m, t] = jetztDatum.slice(0, 10).split("-");
    return `Datum geändert. Als aktueller Stand gilt jetzt die Ablesung vom ${t}.${m}.${j} (${zaehlerstandAnzeige(jetzt?.[standSpalte] as number | string | null)}).`;
  }
  return null;
}

/** Nach jeder Änderung an Zählern: alle Ansichten neu laden, die Stände zeigen */
export async function zaehlerAnsichtenAktualisieren(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    ["zaehler-verwaltung-immobilien", "hausmeister-immobilien", "immobilie", "einheiten", "einheit-detail", "zaehlerstand-historie"].map(
      (schluessel) => queryClient.invalidateQueries({ queryKey: [schluessel] })
    )
  );
}
