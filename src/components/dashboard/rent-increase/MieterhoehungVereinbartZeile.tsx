import { format } from "date-fns";
import { useVereinbarteMieterhoehung } from "@/hooks/useVereinbarteMieterhoehung";
import { erhoehungUeberfaellig, uebernahmeKonflikt } from "@/utils/mieterhoehungRegeln";

interface MieterhoehungVereinbartZeileProps {
  mietvertragId: string;
  /** Kaltmiete und Betriebskosten am Vertrag — für den Grund, wenn eine fällige Erhöhung nicht übernommen ist. */
  aktuelleKaltmiete: number;
  aktuelleBetriebskosten: number;
}

const euro = (betrag: number | string | null | undefined) =>
  Number(betrag ?? 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tag = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("de-DE") : "–";

/**
 * Zeile unter der Kaltmiete am Vertrag: „Erhöhung auf X € ab … vereinbart“ (28.10.2026).
 *
 * Seit eine Erhöhung erst ab wirksam_ab gilt, steht nach der Zustimmung bis zum Wirksamwerden noch die
 * alte Miete am Vertrag. Ohne diese Zeile sähe niemand am Vertrag, dass eine Erhöhung vereinbart ist.
 * Überfällig (wirksam_ab erreicht, nicht übernommen) wird hervorgehoben; übernommen wird im
 * Erhöhungsdialog („Mögliche Mieterhöhungen“ → „Prüfen“).
 * Leer: nichts. Laden und Fehler: eine kurze, gedämpfte Zeile — ein Fehler sieht nie wie „keine
 * Erhöhung“ aus.
 */
export function MieterhoehungVereinbartZeile({ mietvertragId, aktuelleKaltmiete, aktuelleBetriebskosten }: MieterhoehungVereinbartZeileProps) {
  const { data: vereinbart, isLoading, isError } = useVereinbarteMieterhoehung(mietvertragId);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Mieterhöhungen werden geladen …</p>;
  }
  if (isError) {
    return (
      <p className="text-xs text-destructive" role="alert">
        Vereinbarte Mieterhöhungen ließen sich nicht laden.
      </p>
    );
  }
  if (!vereinbart?.wirksam_ab) return null;

  const ueberfaellig = erhoehungUeberfaellig(vereinbart, format(new Date(), "yyyy-MM-dd"));
  const bkAendert = Number(vereinbart.neue_betriebskosten ?? 0) !== Number(vereinbart.alte_betriebskosten ?? 0);
  const betrag = `${euro(vereinbart.neue_kaltmiete)} kalt${bkAendert ? ` und ${euro(vereinbart.neue_betriebskosten)} Betriebskosten` : ""}`;

  if (!ueberfaellig) {
    return (
      <p className="text-xs text-muted-foreground">
        Erhöhung auf <span className="font-medium text-foreground tabular-nums">{betrag}</span> ab {tag(vereinbart.wirksam_ab)} vereinbart
        {vereinbart.zugestimmt_am ? ` (zugestimmt am ${tag(vereinbart.zugestimmt_am)})` : ""}.
      </p>
    );
  }

  return (
    <p className="text-xs text-destructive" role="alert">
      Erhöhung auf <span className="font-medium tabular-nums">{betrag}</span> seit {tag(vereinbart.wirksam_ab)} vereinbart, aber nicht übernommen
      {uebernahmeKonflikt(vereinbart, aktuelleKaltmiete, aktuelleBetriebskosten) ? " — die Miete am Vertrag hat sich seit dem Verlangen geändert" : ""}.
      {" "}Bitte unter „Mögliche Mieterhöhungen“ prüfen.
    </p>
  );
}

export default MieterhoehungVereinbartZeile;
