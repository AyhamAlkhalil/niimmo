/**
 * Welche Übergabeprotokolle es zu einem Vertrag schon gibt — für den Hinweis
 * in der Vertragsliste. Ein zweites Protokoll am selben Vertrag entstand bisher
 * oft nur, weil niemand sah, dass schon eines gespeichert war.
 *
 * Die Art steht im Titel („Übergabeprotokoll (Einzug) – 17.04.2026") oder im
 * Pfad („…/Uebergabeprotokoll_Einzug_2026-04-17_…pdf"); ältere, von Hand
 * hochgeladene Protokolle tragen sie oft nur im Dateinamen oder gar nicht.
 */
export type UebergabeArt = "einzug" | "auszug";

export function protokollArt(titel: string | null | undefined, pfad: string | null | undefined): UebergabeArt | null {
  const text = `${titel ?? ""} ${pfad ?? ""}`.toLowerCase();
  const einzug = text.includes("einzug");
  const auszug = text.includes("auszug");
  if (einzug === auszug) return null;
  return einzug ? "einzug" : "auszug";
}

export interface ProtokollZeile {
  mietvertrag_id: string | null;
  titel: string | null;
  pfad: string | null;
  dateityp: string | null;
  hochgeladen_am: string | null;
}

/** Je Vertrag und Art der Zeitpunkt des jüngsten PDF-Protokolls. Fotos zählen nicht. */
export function letzteProtokolle(zeilen: ProtokollZeile[]): Map<string, Partial<Record<UebergabeArt, string>>> {
  const ergebnis = new Map<string, Partial<Record<UebergabeArt, string>>>();
  for (const z of zeilen) {
    if (!z.mietvertrag_id || !z.hochgeladen_am) continue;
    const istPdf = z.dateityp === "application/pdf" || /\.pdf$/i.test(z.pfad ?? "") || /\.pdf$/i.test(z.titel ?? "");
    if (!istPdf) continue;
    const art = protokollArt(z.titel, z.pfad);
    if (!art) continue;
    const bisher = ergebnis.get(z.mietvertrag_id) ?? {};
    if (!bisher[art] || bisher[art]! < z.hochgeladen_am) bisher[art] = z.hochgeladen_am;
    ergebnis.set(z.mietvertrag_id, bisher);
  }
  return ergebnis;
}
