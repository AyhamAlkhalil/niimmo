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

/**
 * Das Übergabedatum aus dem Titel: „Übergabeprotokoll (Einzug) – 17.04.2026",
 * „2026-04-17 …" oder, wie bei den von Hand hochgeladenen, „20260417 Übergabeprotokoll
 * Einzug.pdf". Bis zum 24.10.2026 kannte es nur die erste Form; bei 24 Protokollen
 * stand dann der Tag des Hochladens, bis zu 461 Tage daneben.
 */
export function datumAusTitel(titel: string | null): string | null {
  const text = titel ?? "";
  const formen: Array<[RegExp, (t: RegExpMatchArray) => [string, string, string]]> = [
    [/(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/g, (t) => [t[3], t[2], t[1]]],
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (t) => [t[1], t[2], t[3]]],
    [/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/g, (t) => [t[1], t[2], t[3]]],
  ];
  for (const [muster, teile] of formen) {
    // Jedes Vorkommen versuchen: Nach einem ungültigen („31.02.") kann ein gültiges folgen
    for (const treffer of text.matchAll(muster)) {
      const [j, m, t] = teile(treffer);
      // Nur ein Tag, den es gibt — „31.02.2026“ in einem Titel ist kein Datum
      const d = new Date(Date.UTC(Number(j), Number(m) - 1, Number(t)));
      if (Number(j) >= 1990 && d.getUTCDate() === Number(t) && d.getUTCMonth() === Number(m) - 1) return `${j}-${m}-${t}`;
    }
  }
  return null;
}

/**
 * Je Vertrag und Art das Datum des jüngsten PDF-Protokolls (zuletzt hochgeladen):
 * das Übergabedatum aus dem Titel, sonst der Zeitpunkt des Hochladens. Bis zum
 * 23.10.2026 stand immer der Upload da — ein Auszug vom 31.08.2025 erschien als
 * „Protokoll vom 05.02.2026". Fotos zählen nicht.
 */
export function letzteProtokolle(zeilen: ProtokollZeile[]): Map<string, Partial<Record<UebergabeArt, string>>> {
  const ergebnis = new Map<string, Partial<Record<UebergabeArt, string>>>();
  const hochgeladen = new Map<string, Partial<Record<UebergabeArt, string>>>();
  for (const z of zeilen) {
    if (!z.mietvertrag_id || !z.hochgeladen_am) continue;
    const istPdf = z.dateityp === "application/pdf" || /\.pdf$/i.test(z.pfad ?? "") || /\.pdf$/i.test(z.titel ?? "");
    if (!istPdf) continue;
    const art = protokollArt(z.titel, z.pfad);
    if (!art) continue;
    const bisher = ergebnis.get(z.mietvertrag_id) ?? {};
    const zuletzt = hochgeladen.get(z.mietvertrag_id) ?? {};
    if (!zuletzt[art] || zuletzt[art]! < z.hochgeladen_am) {
      zuletzt[art] = z.hochgeladen_am;
      bisher[art] = datumAusTitel(z.titel) ?? z.hochgeladen_am;
    }
    ergebnis.set(z.mietvertrag_id, bisher);
    hochgeladen.set(z.mietvertrag_id, zuletzt);
  }
  return ergebnis;
}
