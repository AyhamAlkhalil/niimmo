import { parseZaehlerstand } from "@/utils/zaehlerstandUtils";

/**
 * Was das Speichern eines Zählers in einer Erfassungsmaske bedeutet (Zählerverwaltung,
 * Hausmeister-Ansicht, Hausanschluss in der Objektübersicht).
 *
 * Seit dem 26.11.2026 ist der aktuelle Stand immer die jüngste Ablesung der Historie; das hält
 * die Datenbank selbst zusammen (Migration 20261126100000). Die Masken schreiben deshalb nur noch
 * Ablesungen. Bis dahin hatte jede Maske eigene Regeln: Die Hausmeister-Ansicht schrieb keine
 * Historie, der Hausanschluss in der Objektübersicht ließ ein älteres Datum den neueren Stand
 * überschreiben, und die Zählerverwaltung verwarf ein zurückgestelltes Datum ohne Meldung
 * (Kundenmeldung 07.11.2026: „ich kann den angezeigten Stand nicht mehr älter machen“).
 *
 * Regeln:
 * - Neuer Stand → neue Ablesung zum angegebenen Tag (leer: heute). Ist sie älter als der aktuelle
 *   Stand, landet sie nur in der Historie — das meldet die Maske.
 * - Gleicher Stand, anderes Datum → das Datum der aktuellen Ablesung wird korrigiert, in beide Richtungen.
 *   Ein geleertes Datumsfeld bei gleichem Stand ändert nichts.
 * - Leeres Feld bei vorhandenem Stand → nicht erlaubt; eine Ablesung wird in der Historie gelöscht.
 * - Datum in der Zukunft, nicht lesbarer oder negativer Stand → nicht erlaubt.
 */

export interface AktuelleAblesung {
  stand: number | string | null | undefined;
  datum: string | null | undefined;
}

export type AblesungAktion =
  | { art: "keine" }
  | { art: "neu"; stand: number; datum: string; wirdAktuell: boolean }
  | { art: "datum_korrigieren"; stand: number; vonDatum: string; aufDatum: string }
  | { art: "ungueltig"; grund: string };

const alsZahl = (wert: number | string | null | undefined): number | null => {
  if (wert === null || wert === undefined || wert === "") return null;
  const zahl = Number(wert);
  return Number.isFinite(zahl) ? zahl : null;
};

const tag = (datum: string | null | undefined): string | null => (datum ? datum.slice(0, 10) : null);

export function ablesungAktion(
  eingabe: { stand: string; datum: string },
  aktuell: AktuelleAblesung,
  heute: string
): AblesungAktion {
  const altStand = alsZahl(aktuell.stand);
  const altDatum = tag(aktuell.datum);
  const text = eingabe.stand.trim();

  if (!text) {
    return altStand === null
      ? { art: "keine" }
      : { art: "ungueltig", grund: "Ein Zählerstand lässt sich hier nicht leeren. Eine falsche Ablesung bitte in der Historie löschen." };
  }

  const stand = parseZaehlerstand(text);
  if (stand === null) return { art: "ungueltig", grund: `„${text}“ ist kein gültiger Zählerstand.` };

  const datumEingabe = tag(eingabe.datum.trim());
  // Gleicher Stand und das Datumsfeld geleert: nichts verschieben (Review 26.11.2026). Sonst rückte die
  // Ablesung still auf heute.
  if (altStand !== null && stand === altStand && !datumEingabe) return { art: "keine" };
  const datum = datumEingabe || heute;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { art: "ungueltig", grund: "Das Ablesedatum ist ungültig." };
  if (datum > heute) return { art: "ungueltig", grund: "Das Ablesedatum liegt in der Zukunft." };

  if (altStand !== null && stand === altStand) {
    if (!altDatum || datum === altDatum) return { art: "keine" };
    return { art: "datum_korrigieren", stand, vonDatum: altDatum, aufDatum: datum };
  }
  return { art: "neu", stand, datum, wirdAktuell: !altDatum || datum >= altDatum };
}

/** Kurztext für die Rückmeldung nach dem Speichern */
export function ablesungHinweis(aktion: AblesungAktion, aktuell: AktuelleAblesung): string | null {
  if (aktion.art === "neu" && !aktion.wirdAktuell) {
    const datum = tag(aktuell.datum);
    const [j, m, t] = (datum ?? "").split("-");
    return `Nur in der Historie gespeichert: Der aktuelle Stand${datum ? ` vom ${t}.${m}.${j}` : ""} ist neuer.`;
  }
  return null;
}
