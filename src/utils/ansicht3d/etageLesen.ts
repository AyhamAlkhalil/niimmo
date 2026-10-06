/**
 * Liest die Lage einer Einheit aus dem Freitext `einheiten.etage`.
 *
 * Die Datenbank kennt keine Geometrie. Die einzige Lageangabe ist dieser Freitext, und er ist
 * frei gepflegt: Am 06.10.2026 standen bei 113 Einheiten 80 verschiedene Schreibweisen darin,
 * darunter „Linkes Erstes Obergeschoss rechts", „Dachgeschoss (Mansarde), links hinten",
 * „Dritte Garage von links", der Tippfehler „Ergeschoss rechts" und ein führender Tabulator.
 *
 * Für die 3D-Ansicht genügt eine schematische Lage. Der Leser ist deshalb tolerant: Was er nicht
 * versteht, landet im Erdgeschoss oder im Nebengebäude, nie im Nichts — jede Einheit muss im
 * Modell auftauchen und anklickbar bleiben.
 */

/** Geschossnummer des Dachgeschosses; liegt immer über dem obersten Vollgeschoss. */
export const DACHGESCHOSS = 99;
export const KELLERGESCHOSS = -1;

export type Lageart =
  | "geschoss"
  | "haus"
  | "garage"
  | "stellplatz"
  | "halle"
  | "nebengebaeude"
  | "werbetafel"
  | "gartenhaus"
  | "turm";

export type Gebaeudeteil = "haupt" | "links" | "rechts" | "anbau";

export interface EtagenLage {
  art: Lageart;
  teil: Gebaeudeteil;
  /** Belegte Geschosse: -1 Keller, 0 Erdgeschoss, 1… Obergeschosse, DACHGESCHOSS. */
  geschosse: number[];
  /** Waagerechte Lage: 0 links, 1 mittig, 2 rechts. */
  spalte: number | null;
  /** Tiefe: 0 vorne, 1 mittig, 2 hinten. */
  reihe: number | null;
  /** Ordnungszahl aus dem Text („Dritte Garage" → 3, „Stellplatz Nr.4" → 4, „Reihenhaus 18b" → 18,02). */
  nummer: number | null;
  hinterhof: boolean;
  doppelt: boolean;
  /** Der Text nannte kein Geschoss; das Erdgeschoss ist nur angenommen. */
  geschossAngenommen: boolean;
}

const ORDINAL_WERT: Record<string, number> = {
  erst: 1,
  zweit: 2,
  dritt: 3,
  viert: 4,
  "fünft": 5,
  fuenft: 5,
  sechst: 6,
  siebent: 7,
  siebt: 7,
  acht: 8,
  neunt: 9,
  zehnt: 10,
};
const ORDINAL_STAMM = "(erst|zweit|dritt|viert|fünft|fuenft|sechst|siebent|siebt|acht|neunt|zehnt)(?:e|er|es|en)";
const ORDINAL = new RegExp(`\\b${ORDINAL_STAMM}\\b`);

const GESCHOSSWORT = "(?:obergeschoss|og|etage|stock)";
const OG_ORDINAL = new RegExp(`\\b${ORDINAL_STAMM}\\s*${GESCHOSSWORT}\\b`);
const OG_ZIFFER_VOR = new RegExp(`(\\d+)\\s*\\.?\\s*${GESCHOSSWORT}\\b`);
const OG_ZIFFER_NACH = /\b(?:obergeschoss|og)\s*(\d+)\b/;
const OG_OHNE_ZAHL = /obergeschoss|\bog\b|\bstock\b/;

// „Tiefparterre" ist ein Souterrain, kein Erdgeschoss — daher der Lookbehind.
const KELLER = /keller|untergeschoss|\bug\b|\bkg\b|souterrain|tiefparterre/;
const ERDGESCHOSS = /erdgeschoss|\beg\b|(?<!tief)parterre/;
const DACH = /dachgeschoss|\bdg\b|mansarde|spitzboden|dachstudio/;

/** Kleinbuchstaben, Leerraum zusammengefasst, bekannter Tippfehler korrigiert. */
export function etageNormalisieren(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    // „Ergeschoss rechts" (Objekt 5, Stand 06.10.2026). Am Wortanfang, damit
    // „Obergeschoss" unberührt bleibt.
    .replace(/\bergeschoss/g, "erdgeschoss")
    .trim();
}

/**
 * Höchstes Obergeschoss, das das Modell baut. Darüber ist es ein Tippfehler („2026. OG"):
 * Ohne Grenze baute das Modell eine Million Geschosse, und ab 99 fiele die Zahl mit
 * DACHGESCHOSS zusammen (QA-Fund vom 06.10.2026).
 */
export const HOECHSTES_OBERGESCHOSS = 20;

const obergeschoss = (n: number) => Math.min(HOECHSTES_OBERGESCHOSS, Math.max(1, n));

function obergeschossNummer(text: string): number | null {
  const ordinal = text.match(OG_ORDINAL);
  if (ordinal) return ORDINAL_WERT[ordinal[1]];
  const vor = text.match(OG_ZIFFER_VOR);
  if (vor) return obergeschoss(Number(vor[1]));
  const nach = text.match(OG_ZIFFER_NACH);
  if (nach) return obergeschoss(Number(nach[1]));
  if (OG_OHNE_ZAHL.test(text)) return 1;
  return null;
}

function nummerLesen(text: string, ordinalZaehlt: boolean): number | null {
  const ohneGeschoss = text
    .replace(new RegExp(OG_ORDINAL.source, "g"), " ")
    .replace(new RegExp(OG_ZIFFER_VOR.source, "g"), " ")
    .replace(new RegExp(OG_ZIFFER_NACH.source, "g"), " ");
  if (ordinalZaehlt) {
    const wort = ohneGeschoss.match(ORDINAL);
    if (wort) return ORDINAL_WERT[wort[1]];
  }
  const ziffer = ohneGeschoss.match(/(\d+)\s*([a-z])?(?![a-z])/);
  if (!ziffer) return null;
  const zusatz = ziffer[2] ? (ziffer[2].charCodeAt(0) - 96) / 100 : 0;
  return Number(ziffer[1]) + zusatz;
}

function teilLesen(text: string): { teil: Gebaeudeteil; rest: string } {
  if (/anbau|hinterhaus|seitenfl(ü|ue)gel|nebenhaus/.test(text)) return { teil: "anbau", rest: text };
  const links = text.match(/^(linkes|linker|linke)\s+/);
  if (links) return { teil: "links", rest: text.slice(links[0].length) };
  // „Rechts Erdgeschoss links" (Objekt 11) meint das rechte Haus. „Rechts" zählt nur als
  // Gebäudeteil, wenn ein Geschoss folgt — sonst ist es eine Seitenangabe.
  const rechts = text.match(/^(rechtes|rechter|rechte|rechts)\s+(?=erd|ober|dach|keller|unter|erst|zweit|dritt|viert|\d)/);
  if (rechts) return { teil: "rechts", rest: text.slice(rechts[0].length) };
  return { teil: "haupt", rest: text };
}

function seiteLesen(text: string): { spalte: number | null; reihe: number | null } {
  const links = /\blinks\b/.test(text);
  const rechts = /\brechts\b/.test(text);
  const mitte = /\b(mittig|mitte|mittlere|mittlerer|mittleres)\b/.test(text);
  const vorne = /\b(vorne|vorn|vorderseite|straßenseite|strassenseite)\b/.test(text);
  const hinten = /\b(hinten|rückseite|rueckseite|hofseite)\b/.test(text);

  const seitlich = links !== rechts;
  const spalte = seitlich ? (links ? 0 : 2) : mitte && !links && !rechts ? 1 : null;
  // „links mittig" heißt: linke Spalte, mittlere Tiefe.
  const reihe = vorne ? 0 : hinten ? 2 : mitte && seitlich ? 1 : null;
  return { spalte, reihe };
}

/** Typen, die eine Lage im Haus festlegen — bei ihnen entscheidet der Text nicht über die Bauart. */
const RAUMTYPEN = new Set(["Wohnung", "Gewerbe", "Lager"]);

function artVorab(text: string, typ: string): Lageart | null {
  if (typ === "Garage") return "garage";
  if (typ === "Stellplatz") return "stellplatz";
  if (typ.startsWith("Haus")) return "haus";
  // „Erdgeschoss, über der Garage" bleibt eine Wohnung; nur ohne eindeutigen Typ zählt der Text.
  if (RAUMTYPEN.has(typ)) return null;
  if (/garage/.test(text)) return "garage";
  if (/stellplatz|parkplatz|carport/.test(text)) return "stellplatz";
  if (/werbe(tafel|fläche|flaeche|anlage)|plakat/.test(text)) return "werbetafel";
  if (/gartenhaus|schuppen|gerätehaus|geraetehaus/.test(text)) return "gartenhaus";
  if (/turm/.test(text)) return "turm";
  return null;
}

/**
 * Lage einer Einheit aus Etagentext und Einheitentyp.
 * Der Typ entscheidet vor dem Text: Eine Garage bleibt eine Garage, auch wenn der Text schweigt.
 */
export function etageLesen(
  etage: string | null | undefined,
  einheitentyp: string | null | undefined,
  qm?: number | null
): EtagenLage {
  const text = etageNormalisieren(etage);
  const typ = einheitentyp ?? "";
  const { teil, rest } = teilLesen(text);
  const { spalte, reihe } = seiteLesen(rest);
  const vorab = artVorab(text, typ);

  const basis = {
    teil,
    spalte,
    reihe,
    hinterhof: /hinterhof|garagenhof|\bhof\b/.test(text),
    doppelt: /doppel/.test(text),
    geschossAngenommen: false,
  };

  if (vorab) {
    return {
      ...basis,
      art: vorab,
      teil: vorab === "haus" ? "haupt" : teil,
      geschosse: [],
      nummer: nummerLesen(rest, vorab === "garage" || vorab === "stellplatz"),
    };
  }

  const geschosse = new Set<number>();
  if (KELLER.test(rest)) geschosse.add(KELLERGESCHOSS);
  if (ERDGESCHOSS.test(rest)) geschosse.add(0);
  const og = obergeschossNummer(rest);
  if (og !== null) geschosse.add(og);
  if (DACH.test(rest)) geschosse.add(DACHGESCHOSS);

  const nummer = nummerLesen(rest, false);
  if (geschosse.size > 0) {
    return { ...basis, art: "geschoss", geschosse: [...geschosse].sort((a, b) => a - b), nummer };
  }

  // Ohne Geschoss: Wohnungen gehören trotzdem ins Haus, Gewerbe- und Lagerflächen ins Nebengebäude.
  if (typ === "Wohnung") {
    return { ...basis, art: "geschoss", geschosse: [0], nummer, geschossAngenommen: true };
  }
  const ganzesGebaeude = /haus|gebäude|gebaeude|halle/.test(rest) || (qm ?? 0) >= 150;
  return { ...basis, art: ganzesGebaeude ? "halle" : "nebengebaeude", geschosse: [], nummer };
}

const GESCHOSS_NAMEN = ["Erdgeschoss", "1. Obergeschoss", "2. Obergeschoss", "3. Obergeschoss", "4. Obergeschoss"];

/** Überschrift für die Gruppierung der Parteienliste. */
export function bereichsname(lage: EtagenLage): string {
  switch (lage.art) {
    case "haus":
      return "Häuser";
    case "garage":
      return "Garagen";
    case "stellplatz":
      return "Stellplätze";
    case "halle":
    case "nebengebaeude":
      return "Nebengebäude";
    case "werbetafel":
    case "gartenhaus":
    case "turm":
      return "Sonstiges";
    case "geschoss": {
      const oberstes = lage.geschosse[lage.geschosse.length - 1];
      if (oberstes === DACHGESCHOSS) return "Dachgeschoss";
      if (oberstes === KELLERGESCHOSS) return "Kellergeschoss";
      const name = GESCHOSS_NAMEN[oberstes] ?? `${oberstes}. Obergeschoss`;
      return lage.teil === "anbau" ? `${name} · Anbau` : name;
    }
  }
}

/** Sortierrang der Bereiche: oben im Haus zuerst, dann Keller, dann Außenanlagen. */
export function bereichsrang(lage: EtagenLage): number {
  if (lage.art === "geschoss") {
    const oberstes = lage.geschosse[lage.geschosse.length - 1];
    const anbau = lage.teil === "anbau" ? 0.5 : 0;
    if (oberstes === DACHGESCHOSS) return anbau;
    return 100 - oberstes + anbau;
  }
  const rang: Record<Lageart, number> = {
    geschoss: 0,
    haus: 150,
    halle: 200,
    nebengebaeude: 201,
    garage: 210,
    stellplatz: 220,
    werbetafel: 230,
    gartenhaus: 231,
    turm: 232,
  };
  return rang[lage.art];
}
