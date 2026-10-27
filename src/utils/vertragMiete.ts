/**
 * Kaltmiete, Betriebskosten und Rücklastschrift-Gebühr in der Vertragsbearbeitung.
 *
 * Bis zum 27.10.2026 machte der Bearbeitungsmodus aus einem geleerten Betragsfeld
 * `parseFloat('')` → NaN → 0 und speicherte es mit „Erfolgreich gespeichert“. Der Trigger
 * update_forderungen_on_rent_change setzte daraufhin alle Forderungen ab dem laufenden
 * Monat herunter. Außerdem wurde jedes Feld bei jedem Speichern zurückgeschrieben, und
 * die Vorbelegung `|| 7,50` machte aus einer bewusst eingetragenen Gebühr von 0 € still
 * 7,50 € (live 3 Verträge). Dasselbe Muster wie bei der Kaution (vertragKaution.ts).
 *
 * Regeln:
 * - Wer einen gepflegten Betrag leert, bekommt eine Meldung statt einer 0.
 * - Ein Feld, das schon leer geladen wurde und leer bleibt, ist keine Änderung.
 * - Geschrieben wird nur ein Feld, das sich gegenüber dem geladenen Vertrag geändert hat.
 * - Ein negativer oder unlesbarer Betrag wird nicht gespeichert, sondern gemeldet.
 */
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from "@/constants/config";
import { leseKautionsbetrag } from "./vertragKaution";

export const MIET_FELDER = ["kaltmiete", "betriebskosten", "ruecklastschrift_gebuehr"] as const;
export type MietFeld = (typeof MIET_FELDER)[number];
export type MietAenderungen = Partial<Record<MietFeld, number>>;

export const mietFeldBezeichnung = (feld: MietFeld): string =>
  feld === "kaltmiete" ? "Kaltmiete" : feld === "betriebskosten" ? "Betriebskosten" : "Rücklastschrift-Gebühr";

/** Wert, mit dem der Bearbeitungsmodus ein Feld vorbelegt — 0 bleibt 0, nur fehlend wird zur Vorgabe. */
export function mietfeldVorbelegung(feld: MietFeld, geladen: unknown): number | null {
  const wert = leseKautionsbetrag(geladen) ?? null;
  if (feld === "ruecklastschrift_gebuehr") return wert ?? RUECKLASTSCHRIFT_GEBUEHR_EUR;
  return wert;
}

export function geaenderteMietbetraege(
  geladen: Partial<Record<MietFeld, unknown>> | null | undefined,
  bearbeitet: Record<string, unknown>
): { aenderungen: MietAenderungen; fehlend: MietFeld[]; ungueltig: MietFeld[] } {
  const aenderungen: MietAenderungen = {};
  const fehlend: MietFeld[] = [];
  const ungueltig: MietFeld[] = [];
  for (const feld of MIET_FELDER) {
    if (bearbeitet[feld] === undefined) continue;
    const neu = leseKautionsbetrag(bearbeitet[feld]);
    if (neu === undefined) {
      ungueltig.push(feld);
      continue;
    }
    const alt = mietfeldVorbelegung(feld, geladen?.[feld]);
    if (neu === null) {
      if (alt !== null) fehlend.push(feld);
      continue;
    }
    if (neu !== alt) aenderungen[feld] = neu;
  }
  return { aenderungen, fehlend, ungueltig };
}

/**
 * Ein Zahlenfeld der Mietübersicht (EditableMietUebersichtModal) vor dem Speichern.
 *
 * Bis zum 27.10.2026 machte die Zelle aus einem geleerten Feld `wert ?? 0` und speicherte
 * es mit „✓ Gespeichert“ — bei den Betriebskosten ohne Rückfrage, bei der Kaltmiete nach
 * dem Dialog Erhöhung/Korrektur mit 0 als neuem Wert. Der Trigger senkte dann die Forderungen.
 * Kaltmiete und Betriebskosten des Vertrags brauchen einen Betrag; Fläche und Soll-Miete
 * der Einheit dürfen leer sein (unbekannt) und werden dann als leer gespeichert, nicht als 0.
 */
export function uebersichtsBetrag(feld: string, wert: unknown): { wert: number | null } | { fehler: string } {
  const betrag = leseKautionsbetrag(wert);
  if (betrag === undefined) return { fehler: "Bitte einen gültigen, nicht negativen Wert eingeben." };
  if (betrag === null && (feld === "kaltmiete" || feld === "betriebskosten")) {
    return { fehler: `${mietFeldBezeichnung(feld)} fehlt – ein leeres Feld wird nicht als 0 € gespeichert.` };
  }
  return { wert: betrag };
}
