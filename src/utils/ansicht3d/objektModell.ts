/**
 * Setzt aus den Einheiten eines Objekts ein schematisches 3D-Modell zusammen.
 *
 * Grundlage ist allein die gelesene Lage jeder Einheit (siehe etageLesen.ts). Daraus entstehen
 * Gebäudeteile mit Geschossen, ein Dach (mit Wohnungen darin, wenn es ein Dachgeschoss gibt),
 * Reihenhäuser, Garagenzeilen, Stellplätze, Nebengebäude und Kleinbauten. Maße sind Szenen-
 * einheiten, keine Meter: Ein Vollgeschoss ist 0,9 hoch, die Breite einer Wohnung wächst mit
 * ihrer Fläche. Das Modell soll die Lage der Parteien zueinander zeigen, keinen Grundriss.
 *
 * Koordinaten: x nach rechts, y nach oben, z nach vorn zur Straße. Das Grundstück ist am Ende
 * auf (0, 0) zentriert.
 */

import { DACHGESCHOSS, KELLERGESCHOSS, etageLesen, type EtagenLage, type Gebaeudeteil } from "./etageLesen";

export interface EinheitFuerModell {
  id: string;
  etage: string | null;
  einheitentyp: string | null;
  qm: number | null;
}

export type Bausteinform =
  | "raum"
  | "dach"
  | "haus"
  | "garage"
  | "stellplatz"
  | "halle"
  | "nebengebaeude"
  | "werbetafel"
  | "gartenhaus"
  | "turm";

export interface Quader {
  /** Mitte der Grundfläche. */
  x: number;
  z: number;
  /** Unterkante. */
  y: number;
  breite: number;
  hoehe: number;
  tiefe: number;
}

export interface Fensterseiten {
  vorne: boolean;
  hinten: boolean;
  links: boolean;
  rechts: boolean;
}

export interface Baustein extends Quader {
  schluessel: string;
  /** null: Allgemeinfläche ohne Einheit, z. B. ein Geschoss, für das es keine Einheit gibt. */
  einheitId: string | null;
  form: Bausteinform;
  geschoss: number | null;
  /** Nur Dach: Ausschnitt quer zum First, relativ zur Firstlinie bei z. `tiefe` ist die ganze Dachtiefe. */
  dachschnitt?: { z0: number; z1: number };
  fenster: Fensterseiten;
}

export type Zierart = "sockel" | "satteldach" | "flachdach" | "gesims" | "tuer" | "schornstein" | "weg" | "hof" | "baum";

export interface Zierteil extends Quader {
  schluessel: string;
  art: Zierart;
  /** Baum: 0 Laubbaum, 1 Nadelbaum. */
  variante?: number;
}

export interface ObjektModell {
  bausteine: Baustein[];
  zierteile: Zierteil[];
  /** Grundstücksmaße; die Mitte liegt bei (0, 0). */
  breite: number;
  tiefe: number;
  /** Höchster Punkt der Bebauung. */
  hoehe: number;
  /** Ankerpunkt für die Beschriftung über dem Hauptgebäude. */
  anker: { x: number; y: number; z: number };
}

/** Maße in Szeneneinheiten. */
export const MASSE = {
  sockel: 0.1,
  keller: 0.7,
  geschoss: 0.9,
  dachMitWohnung: 1.15,
  dachOhneWohnung: 0.85,
  dachUeberstand: 0.14,
  flachdach: 0.1,
  mindestbreite: 2.2,
  hausTiefe: 2.7,
  hausDach: 1.0,
  garagenBreite: 1.05,
  doppelgaragenBreite: 2.0,
  garagenTiefe: 2.0,
  garagenHoehe: 0.85,
  stellplatzBreite: 0.95,
  stellplatzTiefe: 1.7,
  nebenTiefe: 1.9,
  nebenHoehe: 1.0,
  hallenHoehe: 1.35,
  gruppenAbstand: 0.85,
} as const;

const RAND = { links: 1.1, rechts: 1.1, hinten: 1.0, vorne: 1.9 };

interface Eintrag {
  id: string;
  qm: number | null;
  lage: EtagenLage;
}

interface Zelle {
  einheitId: string | null;
  qm: number | null;
}

interface Spalte {
  zellen: Zelle[];
  nominal: number;
  /** Abstand der linken Kante vom linken Rand des Gebäudeteils. */
  links: number;
  breite: number;
}

interface Ebene {
  geschoss: number;
  spalten: Spalte[];
  hoehe: number;
}

interface Abschnitt {
  teil: Gebaeudeteil;
  breite: number;
  tiefe: number;
  ebenen: Ebene[];
  dach: Spalte[] | null;
  flachdach: boolean;
}

interface Rechteck {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Eine Gruppe wird erst vermessen und dann an ihre Stelle gesetzt (linke Kante, Vorderkante). */
interface Gruppe {
  breite: number;
  tiefe: number;
  setzen: (x0: number, zVorne: number) => void;
}

const klemmen = (wert: number, min: number, max: number) => Math.min(max, Math.max(min, wert));

const runden = (wert: number) => Math.round(wert * 1000) / 1000;

/** Breite einer Wohnung nach ihrer Fläche; ohne Angabe wie 60 m². */
export function nominalBreite(qm: number | null): number {
  return klemmen(0.8 + (qm ?? 60) / 50, 1.0, 2.8);
}

function vergleich(a: Eintrag, b: Eintrag): number {
  const spalte = (a.lage.spalte ?? 1) - (b.lage.spalte ?? 1);
  if (spalte !== 0) return spalte;
  const nummer = (a.lage.nummer ?? Number.POSITIVE_INFINITY) - (b.lage.nummer ?? Number.POSITIVE_INFINITY);
  if (nummer !== 0 && !Number.isNaN(nummer)) return nummer;
  return a.id.localeCompare(b.id);
}

function spalteAus(zellen: Zelle[]): Spalte {
  const mittel = zellen.reduce((summe, z) => summe + nominalBreite(z.qm), 0) / zellen.length;
  return { zellen, nominal: mittel, links: 0, breite: 0 };
}

/**
 * Ordnet die Einheiten eines Geschosses in Spalten. Einheiten mit Seiten- und Tiefenangabe
 * („links hinten") teilen sich eine Spalte, alle anderen bekommen eine eigene. Ab fünf
 * Spalten ohne Tiefenangabe rückt die zweite Hälfte nach hinten — sonst würde ein Keller mit
 * sieben Abteilen das ganze Haus in die Breite ziehen.
 */
function spaltenBilden(eintraege: Eintrag[]): Spalte[] {
  const sortiert = [...eintraege].sort(vergleich);
  const spalten: { zellen: (Zelle & { reihe: number })[] }[] = [];
  const nachSeite = new Map<number, { zellen: (Zelle & { reihe: number })[] }>();
  for (const eintrag of sortiert) {
    const zelle = { einheitId: eintrag.id, qm: eintrag.qm, reihe: eintrag.lage.reihe ?? 1 };
    if (eintrag.lage.spalte !== null && eintrag.lage.reihe !== null) {
      let spalte = nachSeite.get(eintrag.lage.spalte);
      if (!spalte) {
        spalte = { zellen: [] };
        nachSeite.set(eintrag.lage.spalte, spalte);
        spalten.push(spalte);
      }
      spalte.zellen.push(zelle);
    } else {
      spalten.push({ zellen: [zelle] });
    }
  }
  for (const spalte of spalten) spalte.zellen.sort((a, b) => a.reihe - b.reihe);

  if (spalten.length >= 5 && spalten.every((s) => s.zellen.length === 1)) {
    const vorne = Math.ceil(spalten.length / 2);
    return spalten.slice(0, vorne).map((spalte, i) => {
      const hinten = spalten[vorne + i];
      return spalteAus(hinten ? [spalte.zellen[0], hinten.zellen[0]] : [spalte.zellen[0]]);
    });
  }
  return spalten.map((s) => spalteAus(s.zellen));
}

function verteilen(spalten: Spalte[], breite: number): void {
  const summe = spalten.reduce((s, sp) => s + sp.nominal, 0);
  let links = 0;
  for (const spalte of spalten) {
    spalte.breite = (spalte.nominal / summe) * breite;
    spalte.links = links;
    links += spalte.breite;
  }
}

const leereSpalte = (): Spalte => ({ zellen: [{ einheitId: null, qm: null }], nominal: 1.6, links: 0, breite: 0 });

/**
 * Ein Keller, der nur aus Einheiten besteht, die auch im Erdgeschoss liegen („Erdgeschoss und
 * Kellergeschoss"), liegt genau unter deren Erdgeschossteil. Der Rest des Kellers ist
 * Allgemeinfläche — sonst gehörte der ganze Keller scheinbar dieser einen Partei.
 */
function kellerUnterErdgeschoss(ebenen: Ebene[], durchgehend: Set<string>): void {
  const keller = ebenen.find((e) => e.geschoss === KELLERGESCHOSS);
  const erdgeschoss = ebenen.find((e) => e.geschoss === 0);
  if (!keller || !erdgeschoss) return;
  const nurDurchgehend = keller.spalten.every((s) => s.zellen.every((z) => z.einheitId && durchgehend.has(z.einheitId)));
  if (!nurDurchgehend) return;

  const neu: Spalte[] = [];
  for (const spalte of erdgeschoss.spalten) {
    // Die Spalte samt Tiefenteilung übernehmen; Zellen ohne durchgehende Einheit werden Allgemeinfläche.
    const zellen = spalte.zellen.map((z) => (z.einheitId && durchgehend.has(z.einheitId) ? z : { einheitId: null, qm: null }));
    const leer = zellen.every((z) => z.einheitId === null);
    const letzte = neu[neu.length - 1];
    if (leer && letzte && letzte.zellen.length === 1 && letzte.zellen[0].einheitId === null) {
      letzte.breite += spalte.breite;
      continue;
    }
    neu.push({ zellen: leer ? [{ einheitId: null, qm: null }] : zellen, nominal: spalte.nominal, links: spalte.links, breite: spalte.breite });
  }
  keller.spalten = neu;
}

function abschnittPlanen(eintraege: Eintrag[], teil: Gebaeudeteil, flachdach: boolean): Abschnitt {
  const jeGeschoss = new Map<number, Eintrag[]>();
  const durchgehend = new Set<string>();
  for (const eintrag of eintraege) {
    if (eintrag.lage.geschosse.includes(KELLERGESCHOSS) && eintrag.lage.geschosse.includes(0)) durchgehend.add(eintrag.id);
    for (const geschoss of eintrag.lage.geschosse) {
      const liste = jeGeschoss.get(geschoss) ?? [];
      liste.push(eintrag);
      jeGeschoss.set(geschoss, liste);
    }
  }

  const regulaer = [...jeGeschoss.keys()].filter((g) => g !== DACHGESCHOSS);
  const hatKeller = regulaer.some((g) => g < 0);
  const oberstes = Math.max(0, ...regulaer);

  // Lücken werden mit Allgemeinfläche gefüllt, damit kein Geschoss schwebt.
  const ebenen: Ebene[] = [];
  for (let geschoss = hatKeller ? KELLERGESCHOSS : 0; geschoss <= oberstes; geschoss++) {
    const liste = jeGeschoss.get(geschoss) ?? [];
    ebenen.push({
      geschoss,
      spalten: liste.length > 0 ? spaltenBilden(liste) : [leereSpalte()],
      hoehe: geschoss < 0 ? MASSE.keller : MASSE.geschoss,
    });
  }
  const dachEintraege = jeGeschoss.get(DACHGESCHOSS) ?? [];
  const dach = dachEintraege.length > 0 ? spaltenBilden(dachEintraege) : null;

  const breiten = ebenen.map((e) => e.spalten.reduce((s, sp) => s + sp.nominal, 0));
  if (dach) breiten.push(dach.reduce((s, sp) => s + sp.nominal, 0));
  const breite = Math.max(MASSE.mindestbreite, ...breiten);
  for (const ebene of ebenen) verteilen(ebene.spalten, breite);
  if (dach) verteilen(dach, breite);
  kellerUnterErdgeschoss(ebenen, durchgehend);

  const tiefe = teil === "anbau" ? klemmen(breite * 0.6, 1.8, 2.4) : klemmen(breite * 0.55, 2.4, 3.2);
  return { teil, breite, tiefe, ebenen, dach, flachdach: flachdach && !dach };
}

const KEINE_FENSTER: Fensterseiten = { vorne: false, hinten: false, links: false, rechts: false };

class Baukasten {
  readonly bausteine: Baustein[] = [];
  readonly zierteile: Zierteil[] = [];
  readonly tueren: { x: number; z: number }[] = [];
  private zaehler = 0;

  baustein(teil: Omit<Baustein, "schluessel">): void {
    this.bausteine.push({ ...teil, schluessel: `${teil.einheitId ?? "frei"}-${this.zaehler++}` });
  }

  zier(teil: Omit<Zierteil, "schluessel">): void {
    this.zierteile.push({ ...teil, schluessel: `${teil.art}-${this.zaehler++}` });
  }

  /** Haustür mit Vordach; der Weg zur Straße kommt dazu, sobald das Grundstück feststeht. */
  tuer(x: number, y: number, zFassade: number): void {
    this.zier({ art: "tuer", x, y, z: zFassade, breite: 0.42, hoehe: 0.64, tiefe: 0.06 });
    this.tueren.push({ x, z: zFassade });
  }
}

function abschnittSetzen(
  kasten: Baukasten,
  abschnitt: Abschnitt,
  x0: number,
  zVorne: number,
  nachbarn: { links: boolean; rechts: boolean },
  mitTuer: boolean,
  mitSchornstein: boolean
): number {
  const { breite, tiefe } = abschnitt;
  const mitteX = x0 + breite / 2;
  const mitteZ = zVorne - tiefe / 2;

  kasten.zier({ art: "sockel", x: mitteX, y: 0, z: mitteZ, breite: breite + 0.08, hoehe: MASSE.sockel, tiefe: tiefe + 0.08 });

  let y = MASSE.sockel;
  let erdgeschossY = y;
  for (const [ebenenIndex, ebene] of abschnitt.ebenen.entries()) {
    if (ebene.geschoss === 0) erdgeschossY = y;
    ebene.spalten.forEach((spalte, spaltenIndex) => {
      const anzahl = spalte.zellen.length;
      spalte.zellen.forEach((zelle, i) => {
        kasten.baustein({
          einheitId: zelle.einheitId,
          form: "raum",
          geschoss: ebene.geschoss,
          x: x0 + spalte.links + spalte.breite / 2,
          y,
          z: zVorne - ((i + 0.5) * tiefe) / anzahl,
          breite: spalte.breite,
          hoehe: ebene.hoehe,
          tiefe: tiefe / anzahl,
          fenster: {
            vorne: i === 0,
            hinten: i === anzahl - 1,
            links: spaltenIndex === 0 && !nachbarn.links,
            rechts: spaltenIndex === ebene.spalten.length - 1 && !nachbarn.rechts,
          },
        });
      });
    });
    y += ebene.hoehe;
    // Geschossband zwischen zwei Geschossen; über dem obersten liegt das Dach.
    if (ebenenIndex < abschnitt.ebenen.length - 1) {
      kasten.zier({ art: "gesims", x: mitteX, y: y - 0.025, z: mitteZ, breite: breite + 0.05, hoehe: 0.05, tiefe: tiefe + 0.05 });
    }
  }

  if (mitTuer) {
    const erdgeschoss = abschnitt.ebenen.find((e) => e.geschoss === 0);
    // Die Tür sitzt an der Spaltengrenze, die der Mitte am nächsten liegt — dort ist das Treppenhaus.
    const grenzen = erdgeschoss ? erdgeschoss.spalten.slice(1).map((s) => s.links) : [];
    const tuerX = grenzen.length > 0 ? grenzen.reduce((a, b) => (Math.abs(b - breite / 2) < Math.abs(a - breite / 2) ? b : a)) : breite / 2;
    kasten.tuer(x0 + tuerX, erdgeschossY, zVorne);
  }

  let oben = y;
  if (abschnitt.dach) {
    const dachTiefe = tiefe + 2 * MASSE.dachUeberstand;
    for (const spalte of abschnitt.dach) {
      const anzahl = spalte.zellen.length;
      spalte.zellen.forEach((zelle, i) => {
        const z1 = dachTiefe / 2 - (i * dachTiefe) / anzahl;
        kasten.baustein({
          einheitId: zelle.einheitId,
          form: "dach",
          geschoss: DACHGESCHOSS,
          x: x0 + spalte.links + spalte.breite / 2,
          y,
          z: mitteZ,
          breite: spalte.breite,
          hoehe: MASSE.dachMitWohnung,
          tiefe: dachTiefe,
          dachschnitt: { z0: runden(z1 - dachTiefe / anzahl), z1: runden(z1) },
          fenster: KEINE_FENSTER,
        });
      });
    }
    oben = y + MASSE.dachMitWohnung;
  } else if (abschnitt.flachdach) {
    kasten.zier({ art: "flachdach", x: mitteX, y, z: mitteZ, breite: breite + 0.1, hoehe: MASSE.flachdach, tiefe: tiefe + 0.1 });
    oben = y + MASSE.flachdach;
  } else {
    kasten.zier({
      art: "satteldach",
      x: mitteX,
      y,
      z: mitteZ,
      breite: breite + 2 * MASSE.dachUeberstand,
      hoehe: MASSE.dachOhneWohnung,
      tiefe: tiefe + 2 * MASSE.dachUeberstand,
    });
    oben = y + MASSE.dachOhneWohnung;
  }

  if (mitSchornstein && !abschnitt.flachdach) {
    const dachHoehe = abschnitt.dach ? MASSE.dachMitWohnung : MASSE.dachOhneWohnung;
    kasten.zier({ art: "schornstein", x: x0 + breite * 0.72, y: y + dachHoehe * 0.35, z: mitteZ - tiefe * 0.16, breite: 0.2, hoehe: dachHoehe * 0.85, tiefe: 0.2 });
  }
  return oben;
}

/** Mehrgeschossiges Haus aus einem oder mehreren Gebäudeteilen, rechts ggf. ein Anbau. */
function hausGruppe(kasten: Baukasten, eintraege: Eintrag[], flachdach: boolean, merkeHoehe: (h: number) => void): Gruppe {
  const reihenfolge: Gebaeudeteil[] = ["links", "haupt", "rechts"];
  const haupt = reihenfolge
    .map((teil) => eintraege.filter((e) => e.lage.teil === teil))
    .filter((liste) => liste.length > 0)
    .map((liste) => abschnittPlanen(liste, liste[0].lage.teil, flachdach));
  const anbauEintraege = eintraege.filter((e) => e.lage.teil === "anbau");
  // Ohne Hauptgebäude wird der Anbau selbst zum Haus.
  const abschnitte = haupt.length > 0 ? haupt : [abschnittPlanen(anbauEintraege, "haupt", flachdach)];
  const anbau = haupt.length > 0 && anbauEintraege.length > 0 ? abschnittPlanen(anbauEintraege, "anbau", true) : null;

  const versatz = (i: number) => (i % 2) * 0.22;
  const breite = abschnitte.reduce((s, a) => s + a.breite, 0) + (anbau?.breite ?? 0);
  const tiefe = Math.max(...abschnitte.map((a, i) => a.tiefe + versatz(i)), anbau ? anbau.tiefe + 0.35 : 0) + 2 * MASSE.dachUeberstand;

  return {
    breite,
    tiefe,
    setzen: (x0, zVorne) => {
      const vorne = zVorne - MASSE.dachUeberstand;
      let x = x0;
      abschnitte.forEach((abschnitt, i) => {
        const oben = abschnittSetzen(
          kasten,
          abschnitt,
          x,
          vorne - versatz(i),
          { links: i > 0, rechts: i < abschnitte.length - 1 || anbau !== null },
          true,
          i === 0
        );
        merkeHoehe(oben);
        x += abschnitt.breite;
      });
      if (anbau) {
        merkeHoehe(abschnittSetzen(kasten, anbau, x, vorne - 0.35, { links: true, rechts: false }, false, false));
      }
    },
  };
}

/** Reihen- oder Doppelhäuser: je Partei ein ganzes Haus mit eigenem Dachstück. */
function haeuserGruppe(kasten: Baukasten, eintraege: Eintrag[], merkeHoehe: (h: number) => void): Gruppe {
  const sortiert = [...eintraege].sort(vergleich);
  const breiten = sortiert.map((e) => klemmen(1.3 + (e.qm ?? 120) / 110, 1.7, 2.5));
  const versetzt = sortiert.length >= 3;
  const tiefe = MASSE.hausTiefe + (versetzt ? 0.16 : 0) + 0.24;
  return {
    breite: breiten.reduce((s, b) => s + b, 0),
    tiefe,
    setzen: (x0, zVorne) => {
      let x = x0;
      sortiert.forEach((eintrag, i) => {
        const breite = breiten[i];
        const vorne = zVorne - 0.12 - (versetzt && i % 2 === 1 ? 0.16 : 0);
        const mitteX = x + breite / 2;
        const mitteZ = vorne - MASSE.hausTiefe / 2;
        const hoehe = 2 * MASSE.geschoss;
        kasten.zier({ art: "sockel", x: mitteX, y: 0, z: mitteZ, breite: breite + 0.04, hoehe: MASSE.sockel, tiefe: MASSE.hausTiefe + 0.08 });
        kasten.baustein({
          einheitId: eintrag.id,
          form: "haus",
          geschoss: null,
          x: mitteX,
          y: MASSE.sockel,
          z: mitteZ,
          breite,
          hoehe,
          tiefe: MASSE.hausTiefe,
          fenster: { vorne: true, hinten: true, links: i === 0, rechts: i === sortiert.length - 1 },
        });
        const dachTiefe = MASSE.hausTiefe + 0.24;
        kasten.baustein({
          einheitId: eintrag.id,
          form: "dach",
          geschoss: null,
          x: mitteX,
          y: MASSE.sockel + hoehe,
          z: mitteZ,
          breite,
          hoehe: MASSE.hausDach,
          tiefe: dachTiefe,
          dachschnitt: { z0: runden(-dachTiefe / 2), z1: runden(dachTiefe / 2) },
          fenster: KEINE_FENSTER,
        });
        if (i % 2 === 0) {
          kasten.zier({ art: "schornstein", x: mitteX + breite * 0.25, y: MASSE.sockel + hoehe + 0.3, z: mitteZ - 0.45, breite: 0.18, hoehe: 0.75, tiefe: 0.18 });
        }
        kasten.tuer(mitteX - breite * 0.18, MASSE.sockel, vorne);
        merkeHoehe(MASSE.sockel + hoehe + MASSE.hausDach);
        x += breite;
      });
    },
  };
}

/** Eine Reihe gleichartiger Einheiten nebeneinander, Vorderseite zur Straße. */
function reihenGruppe(
  kasten: Baukasten,
  eintraege: Eintrag[],
  form: Bausteinform,
  mass: (e: Eintrag) => { breite: number; hoehe: number; tiefe: number },
  zusatz: { dach?: boolean; hof?: number; ordinalZuerst?: boolean },
  merkeHoehe: (h: number) => void
): Gruppe {
  const sortiert = [...eintraege].sort((a, b) => {
    // Garagen und Stellplätze zählt man ab („Dritte Garage von links"); die Nummer geht vor der Seite.
    if (zusatz.ordinalZuerst) {
      const nummer = (a.lage.nummer ?? Number.POSITIVE_INFINITY) - (b.lage.nummer ?? Number.POSITIVE_INFINITY);
      if (nummer !== 0 && !Number.isNaN(nummer)) return nummer;
    }
    return vergleich(a, b);
  });
  const masse = sortiert.map(mass);
  const breite = masse.reduce((s, m) => s + m.breite, 0);
  const tiefe = Math.max(...masse.map((m) => m.tiefe)) + (zusatz.hof ?? 0);
  return {
    breite,
    tiefe,
    setzen: (x0, zVorne) => {
      const hinten = zVorne - (zusatz.hof ?? 0);
      if (zusatz.hof) {
        kasten.zier({ art: "hof", x: x0 + breite / 2, y: 0, z: zVorne - tiefe / 2, breite: breite + 0.3, hoehe: 0.012, tiefe: tiefe + 0.2 });
      }
      let x = x0;
      let hoechste = 0;
      sortiert.forEach((eintrag, i) => {
        const m = masse[i];
        kasten.baustein({
          einheitId: eintrag.id,
          form,
          geschoss: null,
          x: x + m.breite / 2,
          y: 0,
          z: hinten - m.tiefe / 2,
          breite: m.breite - 0.04,
          hoehe: m.hoehe,
          tiefe: m.tiefe,
          fenster: { vorne: true, hinten: false, links: i === 0, rechts: i === sortiert.length - 1 },
        });
        hoechste = Math.max(hoechste, m.hoehe);
        x += m.breite;
      });
      if (zusatz.dach) {
        const t = Math.max(...masse.map((m) => m.tiefe));
        kasten.zier({ art: "flachdach", x: x0 + breite / 2, y: hoechste, z: hinten - t / 2, breite: breite + 0.12, hoehe: 0.07, tiefe: t + 0.12 });
        hoechste += 0.07;
      }
      merkeHoehe(hoechste);
    },
  };
}

function einzelGruppe(
  kasten: Baukasten,
  eintrag: Eintrag,
  form: Bausteinform,
  mass: { breite: number; hoehe: number; tiefe: number },
  extra: (x: number, y: number, z: number) => number,
  merkeHoehe: (h: number) => void
): Gruppe {
  return {
    breite: mass.breite,
    tiefe: mass.tiefe,
    setzen: (x0, zVorne) => {
      const x = x0 + mass.breite / 2;
      const z = zVorne - mass.tiefe / 2;
      kasten.baustein({
        einheitId: eintrag.id,
        form,
        geschoss: null,
        x,
        y: 0,
        z,
        ...mass,
        fenster: { vorne: true, hinten: true, links: true, rechts: true },
      });
      merkeHoehe(extra(x, mass.hoehe, z));
    },
  };
}

function rechteckVon(teile: Quader[]): Rechteck {
  const r: Rechteck = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const t of teile) {
    r.x0 = Math.min(r.x0, t.x - t.breite / 2);
    r.x1 = Math.max(r.x1, t.x + t.breite / 2);
    r.z0 = Math.min(r.z0, t.z - t.tiefe / 2);
    r.z1 = Math.max(r.z1, t.z + t.tiefe / 2);
  }
  return r;
}

/** Kleiner deterministischer Zufall, damit Bäume bei jedem Öffnen gleich stehen. */
function zufall(saat: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < saat.length; i++) h = Math.imul(h ^ saat.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function baeumePflanzen(kasten: Baukasten, grund: Rechteck, saat: string): void {
  const naechste = zufall(saat);
  const belegt = [...kasten.bausteine, ...kasten.zierteile.filter((z) => z.art !== "baum")];
  const frei = (x: number, z: number, abstand: number) =>
    belegt.every(
      (t) =>
        x < t.x - t.breite / 2 - abstand ||
        x > t.x + t.breite / 2 + abstand ||
        z < t.z - t.tiefe / 2 - abstand ||
        z > t.z + t.tiefe / 2 + abstand
    );
  const mitteZ = (grund.z0 + grund.z1) / 2;
  // Lage als Anteil am Grundstücksrand; der Abstand zum Rand folgt aus der Kronengröße.
  const kandidaten: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0, 0.5],
    [1, 0.5],
    [0.5, 0],
  ];
  const flaeche = (grund.x1 - grund.x0) * (grund.z1 - grund.z0);
  const hoechstens = klemmen(Math.round(flaeche / 18), 2, 6);
  let gepflanzt = 0;
  for (const [fx, fz] of kandidaten) {
    if (gepflanzt >= hoechstens) break;
    const groesse = 0.75 + naechste() * 0.45;
    const rand = groesse / 2 + 0.08;
    const x = fx === 0.5 ? (grund.x0 + grund.x1) / 2 : fx === 0 ? grund.x0 + rand : grund.x1 - rand;
    const z = fz === 0.5 ? mitteZ : fz === 0 ? grund.z0 + rand : grund.z1 - rand;
    if (!frei(x, z, 0.45)) continue;
    kasten.zier({
      art: "baum",
      x,
      y: 0,
      z,
      breite: groesse,
      hoehe: groesse * (1.5 + naechste() * 0.6),
      tiefe: groesse,
      variante: naechste() < 0.3 ? 1 : 0,
    });
    belegt.push(kasten.zierteile[kasten.zierteile.length - 1]);
    gepflanzt++;
  }
}

/**
 * Das Modell eines Objekts. `objekttyp` „Gewerbe" bekommt Flachdächer; `saat` macht die
 * Bepflanzung je Objekt verschieden, aber stabil.
 */
export function objektModell(einheiten: EinheitFuerModell[], objekttyp?: string | null, saat = ""): ObjektModell {
  // Fläche nur, wenn sie eine Zahl ist; alles andere gilt als „ohne Angabe" (sonst NaN-Maße).
  const eintraege: Eintrag[] = einheiten.map((e) => {
    const qm = typeof e.qm === "number" && Number.isFinite(e.qm) ? e.qm : null;
    return { id: e.id, qm, lage: etageLesen(e.etage, e.einheitentyp, qm) };
  });
  const nach = (art: EtagenLage["art"]) => eintraege.filter((e) => e.lage.art === art);

  const kasten = new Baukasten();
  let hoehe = 0;
  const merkeHoehe = (h: number) => {
    hoehe = Math.max(hoehe, h);
  };

  const geschosse = nach("geschoss");
  let haeuser = nach("haus");
  let hallen = nach("halle");
  let neben = nach("nebengebaeude");
  // Ein Objekt nur aus Nebenflächen (z. B. eine Gewerbeeinheit ohne Etagenangabe) ist eine Halle.
  if (geschosse.length === 0 && haeuser.length === 0 && hallen.length === 0) {
    hallen = neben;
    neben = [];
  }

  const halleMass = (e: Eintrag) => {
    const breite = klemmen(2.2 + (e.qm ?? 120) / 80, 2.8, 5.0);
    return { breite, hoehe: MASSE.hallenHoehe, tiefe: klemmen(breite * 0.72, 2.4, 3.6) };
  };
  const halleGruppe = (e: Eintrag) =>
    einzelGruppe(kasten, e, "halle", halleMass(e), (x, h, z) => {
      const m = halleMass(e);
      kasten.zier({ art: "flachdach", x, y: h, z, breite: m.breite + 0.12, hoehe: 0.08, tiefe: m.tiefe + 0.12 });
      kasten.zier({ art: "hof", x, y: 0, z: z + m.tiefe / 2 + 0.35, breite: m.breite * 0.8, hoehe: 0.012, tiefe: 0.7 });
      return h + 0.08;
    }, merkeHoehe);

  let haupt: Gruppe | null = null;
  if (geschosse.length > 0) {
    haupt = hausGruppe(kasten, geschosse, objekttyp === "Gewerbe", merkeHoehe);
  } else if (haeuser.length > 0) {
    haupt = haeuserGruppe(kasten, haeuser, merkeHoehe);
    haeuser = [];
  } else if (hallen.length > 0) {
    haupt = halleGruppe(hallen[0]);
    hallen = hallen.slice(1);
  }

  const seitlich: Gruppe[] = [];
  const hinten: Gruppe[] = [];

  const stellplaetze = nach("stellplatz");
  if (stellplaetze.length > 0) {
    seitlich.push(
      reihenGruppe(kasten, stellplaetze, "stellplatz", () => ({ breite: MASSE.stellplatzBreite, hoehe: 0.02, tiefe: MASSE.stellplatzTiefe }), { hof: 0.9, ordinalZuerst: true }, merkeHoehe)
    );
  }
  if (haeuser.length > 0) seitlich.push(haeuserGruppe(kasten, haeuser, merkeHoehe));
  for (const halle of hallen) seitlich.push(halleGruppe(halle));
  if (neben.length > 0) {
    seitlich.push(
      reihenGruppe(
        kasten,
        neben,
        "nebengebaeude",
        (e) => ({ breite: klemmen(1.0 + (e.qm ?? 30) / 30, 1.3, 2.6), hoehe: MASSE.nebenHoehe, tiefe: MASSE.nebenTiefe }),
        { dach: true, hof: 0.6 },
        merkeHoehe
      )
    );
  }

  const garagen = nach("garage");
  if (garagen.length > 0) {
    hinten.push(
      reihenGruppe(
        kasten,
        garagen,
        "garage",
        (e) => ({ breite: e.lage.doppelt ? MASSE.doppelgaragenBreite : MASSE.garagenBreite, hoehe: MASSE.garagenHoehe, tiefe: MASSE.garagenTiefe }),
        { dach: true, hof: 0.9, ordinalZuerst: true },
        merkeHoehe
      )
    );
  }
  for (const e of nach("gartenhaus")) {
    hinten.push(
      einzelGruppe(kasten, e, "gartenhaus", { breite: 1.2, hoehe: 0.75, tiefe: 1.0 }, (x, h, z) => {
        kasten.baustein({
          einheitId: e.id,
          form: "dach",
          geschoss: null,
          x,
          y: h,
          z,
          breite: 1.2,
          hoehe: 0.45,
          tiefe: 1.2,
          dachschnitt: { z0: -0.6, z1: 0.6 },
          fenster: KEINE_FENSTER,
        });
        return h + 0.45;
      }, merkeHoehe)
    );
  }
  for (const e of nach("turm")) {
    hinten.push(einzelGruppe(kasten, e, "turm", { breite: 1.0, hoehe: 2.4, tiefe: 1.0 }, (_x, h) => h + 0.8, merkeHoehe));
  }

  // Ohne jedes Gebäude (Objekt ohne Einheiten): ein leeres Grundstück.
  if (!haupt) {
    haupt = seitlich.shift() ?? hinten.shift() ?? null;
  }

  let hauptRechteck: Rechteck = { x0: 0, x1: 2.4, z0: -2.4, z1: 0 };
  if (haupt) {
    haupt.setzen(0, 0);
    hauptRechteck = { x0: 0, x1: haupt.breite, z0: -haupt.tiefe, z1: 0 };
  }

  const seitenX = hauptRechteck.x1 + 1.0;
  let z = 0;
  for (const gruppe of seitlich) {
    gruppe.setzen(seitenX, z);
    z -= gruppe.tiefe + MASSE.gruppenAbstand;
  }
  const seitenUnten = seitlich.length > 0 ? z + MASSE.gruppenAbstand : 0;
  // Die hintere Reihe läuft nach rechts. Reicht sie bis unter die seitlich gestapelten Gruppen,
  // beginnt sie erst hinter deren letzter — sonst durchdrängen sich Garagen und Nebengebäude
  // (QA-Fund vom 06.10.2026: Stellplätze + Lager seitlich, vier Garagen hinten).
  const hintenBreite = hinten.reduce((s, g) => s + g.breite, 0) + MASSE.gruppenAbstand * Math.max(0, hinten.length - 1);
  const ragtUnterSeite = seitlich.length > 0 && hauptRechteck.x0 + hintenBreite > seitenX - MASSE.gruppenAbstand;
  const hintenStart = Math.min(hauptRechteck.z0, ragtUnterSeite ? seitenUnten : Infinity) - 1.1;
  let x = hauptRechteck.x0;
  for (const gruppe of hinten) {
    gruppe.setzen(x, hintenStart);
    x += gruppe.breite + MASSE.gruppenAbstand;
  }
  nach("werbetafel").forEach((e, i) => {
    const breite = 1.6;
    einzelGruppe(kasten, e, "werbetafel", { breite, hoehe: 1.9, tiefe: 0.12 }, (_x, h) => h, merkeHoehe).setzen(
      hauptRechteck.x0 - 0.9 - (i + 1) * (breite + 0.35),
      0.5
    );
  });

  const belegung = rechteckVon([...kasten.bausteine, ...kasten.zierteile]);
  const leer = kasten.bausteine.length === 0;
  const grund: Rechteck = leer
    ? { x0: -2, x1: 2, z0: -2, z1: 2 }
    : { x0: belegung.x0 - RAND.links, x1: belegung.x1 + RAND.rechts, z0: belegung.z0 - RAND.hinten, z1: belegung.z1 + RAND.vorne };

  // Wege von jeder Haustür zur Straße.
  for (const tuer of kasten.tueren) {
    const laenge = grund.z1 - tuer.z;
    if (laenge > 0.05) {
      kasten.zier({ art: "weg", x: tuer.x, y: 0, z: tuer.z + laenge / 2, breite: 0.55, hoehe: 0.012, tiefe: laenge });
    }
  }
  baeumePflanzen(kasten, grund, saat);

  const mitteX = (grund.x0 + grund.x1) / 2;
  const mitteZ = (grund.z0 + grund.z1) / 2;
  const verschieben = <T extends Quader>(t: T): T => ({ ...t, x: runden(t.x - mitteX), z: runden(t.z - mitteZ) });

  return {
    bausteine: kasten.bausteine.map(verschieben),
    zierteile: kasten.zierteile.map(verschieben),
    breite: runden(grund.x1 - grund.x0),
    tiefe: runden(grund.z1 - grund.z0),
    hoehe: runden(Math.max(hoehe, 0.5)),
    anker: {
      x: runden((hauptRechteck.x0 + hauptRechteck.x1) / 2 - mitteX),
      y: runden(Math.max(hoehe, 0.5) + 0.35),
      z: runden((hauptRechteck.z0 + hauptRechteck.z1) / 2 - mitteZ),
    },
  };
}
