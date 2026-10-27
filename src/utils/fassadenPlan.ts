/**
 * Fassadenzeichnung für Objektkacheln und Objektkopf (27.10.2026, Richtung „Exposé“).
 *
 * Zu den Objekten gibt es keine Fotos. Statt eines leeren Platzhalters bekommt jedes Objekt
 * eine stilisierte Ansicht wie in einem Exposé: Geschosse und Fensterachsen aus der
 * Einheitenzahl, Dachform und Tönung fest aus der Objekt-ID, damit dasselbe Haus immer gleich
 * aussieht. Die Zeichnung ist Schmuck, keine Bestandsangabe -- die Einheitenzahl enthält auch
 * Garagen und Stellplätze. Information trägt nur der Leerstand: So viele Fenster wie freie
 * Einheiten erscheinen in Karmin, höchstens alle Fenster der Zeichnung.
 */

import { istLaufenderVertrag, type VertragZeitraum } from "@/utils/contractUtils";

export type Bauart = "wohnhaus" | "mischnutzung" | "gewerbe" | "haeuser";
export type Dachform = "sattel" | "flach" | "walm";
export type Baumstand = "links" | "rechts" | "beide" | "keiner";

export interface FassadenPlan {
  bauart: Bauart;
  /** Geschosse einschließlich Erdgeschoss; Index 0 ist das oberste */
  geschosse: number;
  /** Fensterachsen je Geschoss (bei „haeuser“: je Haus) */
  achsen: number;
  /** Anzahl Häuser nebeneinander, nur bei „haeuser“ größer als 1 */
  haeuser: number;
  dach: Dachform;
  /** Index in die vier Tönungen der Zeichnung */
  ton: number;
  baum: Baumstand;
  balkone: boolean;
  /** Achse der Haustür im Erdgeschoss */
  tuerAchse: number;
  /** Fenster in Karmin als Schlüssel „geschoss:achse“ (bei „haeuser“: „haus:geschoss:achse“) */
  freieFenster: string[];
}

/** FNV-1a: kleiner, fester Streuwert -- dieselbe ID ergibt immer dasselbe Haus */
export function streuwert(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const begrenzt = (wert: number, min: number, max: number) => Math.min(max, Math.max(min, wert));

const ganzzahl = (wert: number | null | undefined) =>
  typeof wert === "number" && Number.isFinite(wert) ? Math.max(0, Math.floor(wert)) : 0;

export function bauartAus(objekttyp: string | null | undefined, einheiten: number): Bauart {
  const typ = (objekttyp ?? "").toLowerCase();
  if (typ.includes("gewerbe")) return "gewerbe";
  if (typ.includes("misch")) return "mischnutzung";
  // Ein bis drei Einheiten ohne Gewerbe: Einzel-, Doppel- oder kleines Reihenhaus
  return einheiten <= 3 ? "haeuser" : "wohnhaus";
}

/** Fester Mischer (mulberry32), damit die Karmin-Fenster nicht immer in derselben Ecke sitzen */
function mischer(startwert: number) {
  let s = startwert >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fassadenPlan(eingabe: {
  id: string;
  objekttyp?: string | null;
  einheiten: number | null | undefined;
  frei: number | null | undefined;
}): FassadenPlan {
  const einheiten = ganzzahl(eingabe.einheiten);
  const frei = ganzzahl(eingabe.frei);
  const wert = streuwert(eingabe.id || "objekt");
  const bauart = bauartAus(eingabe.objekttyp, einheiten);

  let geschosse: number;
  let achsen: number;
  let haeuser = 1;
  if (bauart === "gewerbe") {
    geschosse = 2;
    achsen = 6;
  } else if (bauart === "haeuser") {
    geschosse = 2;
    achsen = 2;
    haeuser = begrenzt(einheiten, 1, 3);
  } else {
    geschosse = begrenzt(Math.ceil(einheiten / 4) + 1, 2, 5);
    achsen = begrenzt(Math.round(einheiten / geschosse) + 2, 3, 6);
  }

  const dachformen: Dachform[] = ["sattel", "flach", "walm"];
  const dach: Dachform = bauart === "gewerbe" ? "flach" : bauart === "haeuser" ? "sattel" : dachformen[wert % 3];
  const baeume: Baumstand[] = ["links", "rechts", "beide", "keiner"];
  const tuerAchse = achsen % 2 === 1 ? (achsen - 1) / 2 : achsen / 2 - ((wert >>> 9) % 2);

  // Mögliche Karmin-Fenster: alle Fenster außer der Tür; bei Mischnutzung und Gewerbe zählt
  // das Erdgeschoss nicht mit (dort liegen Schaufenster und Eingang)
  const plaetze: string[] = [];
  const unterstesWohngeschoss = bauart === "mischnutzung" || bauart === "gewerbe" ? geschosse - 2 : geschosse - 1;
  for (let haus = 0; haus < haeuser; haus++) {
    for (let g = 0; g <= unterstesWohngeschoss; g++) {
      for (let a = 0; a < achsen; a++) {
        const istTuer = g === geschosse - 1 && (bauart === "haeuser" ? a === 0 : a === tuerAchse);
        if (istTuer) continue;
        plaetze.push(bauart === "haeuser" ? `${haus}:${g}:${a}` : `${g}:${a}`);
      }
    }
  }
  const zufall = mischer(wert);
  for (let i = plaetze.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [plaetze[i], plaetze[j]] = [plaetze[j], plaetze[i]];
  }

  return {
    bauart,
    geschosse,
    achsen,
    haeuser,
    dach,
    ton: (wert >>> 3) % 4,
    baum: baeume[(wert >>> 5) % 4],
    balkone: bauart === "wohnhaus" && ((wert >>> 7) & 1) === 0,
    tuerAchse,
    freieFenster: plaetze.slice(0, Math.min(frei, plaetze.length)),
  };
}

/**
 * Einheiten ohne laufenden Vertrag (für die Karmin-Fenster im Objektkopf). Maßgeblich ist
 * dieselbe Stichtagsregel wie für die Mietsummen, nicht der rohe Vertragsstatus.
 */
export function freieEinheiten(
  einheitIds: string[],
  vertraege: (VertragZeitraum & { einheit_id: string | null })[] | null | undefined,
  stichtag: Date = new Date(),
): number {
  const belegt = new Set(
    (vertraege ?? []).filter((v) => istLaufenderVertrag(v, stichtag)).map((v) => v.einheit_id),
  );
  return einheitIds.filter((id) => !belegt.has(id)).length;
}

export interface ObjektBelegung {
  gesamt: number;
  frei: number;
  /** Einheiten, deren laufender Vertrag gekündigt ist */
  gekuendigt: number;
  belegungProzent: number;
}

/**
 * Belegung für die Objektkachel (27.10.2026). Vorher zählte die Kachel Vertragszeilen nach
 * rohem Status: Ein gekündigter, schon abgelaufener Vertrag galt noch als belegt, und ein
 * Folgevertrag in derselben Einheit zählte doppelt. Jetzt gilt dieselbe Stichtagsregel wie
 * im Objektkopf (freieEinheiten), damit Kachel und Objektseite dieselben Zahlen zeigen.
 * Ohne angelegte Einheiten gilt die Sollzahl am Objekt als frei.
 */
export function objektBelegung(
  einheitIds: string[],
  vertraege: (VertragZeitraum & { einheit_id: string | null })[] | null | undefined,
  einheitenAnzahl: number | null | undefined,
  stichtag: Date = new Date(),
): ObjektBelegung {
  if (einheitIds.length === 0) {
    const gesamt = ganzzahl(einheitenAnzahl);
    return { gesamt, frei: gesamt, gekuendigt: 0, belegungProzent: 0 };
  }
  const ids = new Set(einheitIds);
  const laufend = (vertraege ?? []).filter((v) => v.einheit_id && ids.has(v.einheit_id) && istLaufenderVertrag(v, stichtag));
  const belegt = new Set(laufend.map((v) => v.einheit_id)).size;
  const gekuendigt = new Set(laufend.filter((v) => v.status === "gekuendigt").map((v) => v.einheit_id)).size;
  const gesamt = ids.size;
  return {
    gesamt,
    frei: gesamt - belegt,
    gekuendigt,
    belegungProzent: Math.round((belegt / gesamt) * 100),
  };
}
