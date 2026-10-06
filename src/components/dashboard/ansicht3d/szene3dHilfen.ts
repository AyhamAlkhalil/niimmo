/**
 * Farben, Materialien und Geometrien der 3D-Ansicht.
 *
 * Statusfarben kommen aus den Rollen-Tokens in index.css (success, warning, destructive,
 * primary) und werden zur Laufzeit gelesen — dieselbe Quelle wie die Oberfläche
 * (docs/architektur.md §5). Die übrigen Farben sind Szenenmaterial (Rasen, Dach, Straße) ohne
 * fachliche Bedeutung und stehen nur hier. Vermietete Einheiten bleiben bewusst neutral: Farbe
 * bekommt nur, was Aufmerksamkeit braucht.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ParteiStatus } from "@/utils/ansicht3d/parteiStatus";

export type Tageszeit = "tag" | "abend";
export type Flaeche = "fassade" | "dach";
export type Hervorhebung = "normal" | "hover" | "auswahl" | "gedimmt";
/** Zustand eines Bausteins; „allgemein" ist Fläche ohne Einheit. */
export type Bausteinstatus = ParteiStatus | "allgemein";

export interface Stimmung {
  tageszeit: Tageszeit;
  hintergrund: string;
  himmel: string;
  boden: string;
  hemisphaere: number;
  sonne: string;
  sonnenstaerke: number;
  /** Richtung, aus der das Licht kommt (wird normiert). */
  sonnenrichtung: [number, number, number];
  umgebung: number;
  belichtung: number;
}

export const STIMMUNGEN: Record<Tageszeit, Stimmung> = {
  tag: {
    tageszeit: "tag",
    hintergrund: "linear-gradient(180deg, #e3ebf3 0%, #f1efe9 58%, #e9e3d9 100%)",
    himmel: "#e2ecf7",
    boden: "#d9cfbf",
    hemisphaere: 1.05,
    sonne: "#fff2df",
    sonnenstaerke: 2.4,
    sonnenrichtung: [0.55, 1, 0.42],
    umgebung: 0.38,
    belichtung: 1.0,
  },
  abend: {
    tageszeit: "abend",
    hintergrund: "linear-gradient(180deg, #0a1222 0%, #15203a 55%, #263252 100%)",
    himmel: "#4a5f9a",
    boden: "#1b2130",
    hemisphaere: 0.62,
    sonne: "#b4c4ff",
    sonnenstaerke: 0.75,
    sonnenrichtung: [-0.5, 1, 0.35],
    umgebung: 0.1,
    belichtung: 1.05,
  },
};

/** Szenenmaterial ohne fachliche Bedeutung. */
export const SZENENFARBEN = {
  fassade: "#f3efe8",
  allgemein: "#e2ddd4",
  dach: "#b9b1a6",
  sockel: "#cbc2b5",
  gesims: "#fbf9f5",
  fensterglas: "#62788f",
  fensterrahmen: "#fbfaf7",
  tuer: "#8b705b",
  rasen: "#c9d8b1",
  grundstuecksrand: "#e7e1d7",
  weg: "#e8e2d8",
  hof: "#d9d3c9",
  grundplatte: "#ece6dc",
  grundplattenrand: "#d6cec2",
  strasse: "#c6c2bb",
  gehweg: "#e1dbd2",
  markierung: "#f7f5f0",
  laterne: "#8e8a84",
  laub: ["#9ab889", "#8cab7d", "#a6c194"],
  nadel: "#6f8f6b",
  stamm: "#8a7462",
  autos: ["#8193a8", "#c67e6c", "#e6e1d8", "#6b7a83", "#b9a37e"],
} as const;

/** Licht in den Fenstern am Abend: Wo jemand wohnt, brennt Licht. */
const FENSTERLICHT: Record<Bausteinstatus, string> = {
  vermietet: "#ffd08a",
  gekuendigt: "#ffab5c",
  kommend: "#a9cfff",
  leer: "#263044",
  allgemein: "#39435a",
};

type Rolle = "success" | "warning" | "destructive" | "primary";

const ERSATZ: Record<Rolle, string> = {
  success: "hsl(142, 60%, 32%)",
  warning: "hsl(32, 90%, 36%)",
  destructive: "hsl(0, 84%, 60%)",
  primary: "hsl(217, 91%, 60%)",
};

/** Liest eine Rollenfarbe aus index.css („142 60% 32%") als THREE.Color. */
export function rollenfarbe(rolle: Rolle): THREE.Color {
  try {
    const roh = getComputedStyle(document.documentElement).getPropertyValue(`--${rolle}`).trim();
    const teile = roh.split(/\s+/);
    if (teile.length >= 3) return new THREE.Color().setStyle(`hsl(${teile[0]}, ${teile[1]}, ${teile[2]})`);
  } catch {
    // Ohne DOM (Tests) oder bei fehlendem Token: Ersatzwert unten.
  }
  return new THREE.Color().setStyle(ERSATZ[rolle]);
}

/** Rollenfarbe als CSS-Wert für die Legende. */
export function rollenfarbeCss(rolle: Rolle): string {
  return `#${rollenfarbe(rolle).getHexString()}`;
}

const STATUSROLLE: Partial<Record<Bausteinstatus, Rolle>> = {
  gekuendigt: "warning",
  leer: "destructive",
  kommend: "primary",
};

/**
 * Helligkeit der Statustöne. Der Farbton kommt aus dem Token, Sättigung und Helligkeit werden
 * auf Pastell gesetzt: Die Tokens sind dunkel, weil sie als Schriftfarbe lesbar sein müssen —
 * als Fassade wirkte „warning" damit braun statt orange.
 */
const PASTELL: Record<Flaeche, { s: number; l: number }> = { fassade: { s: 0.72, l: 0.76 }, dach: { s: 0.5, l: 0.66 } };

export function grundfarbe(status: Bausteinstatus, flaeche: Flaeche): THREE.Color {
  const basis = new THREE.Color(flaeche === "dach" ? SZENENFARBEN.dach : status === "allgemein" ? SZENENFARBEN.allgemein : SZENENFARBEN.fassade);
  const rolle = STATUSROLLE[status];
  if (!rolle) return basis;
  const hsl = { h: 0, s: 0, l: 0 };
  rollenfarbe(rolle).getHSL(hsl, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(hsl.h, PASTELL[flaeche].s, PASTELL[flaeche].l, THREE.SRGBColorSpace);
}

/** Farbe für Legende und Liste: so, wie die Fassade in der Szene erscheint. */
export function legendenfarbe(status: Bausteinstatus): string {
  return `#${grundfarbe(status, "fassade").getHexString()}`;
}

export function fensterlicht(status: Bausteinstatus): THREE.Color {
  return new THREE.Color(FENSTERLICHT[status]);
}

/**
 * Materialien je Stimmung. Gleiche Kombinationen teilen sich ein Material, damit ein Wechsel
 * der Hervorhebung nur eine Referenz tauscht und kein neues Shaderprogramm braucht.
 */
export class Materialien {
  private readonly cache = new Map<string, THREE.Material>();
  private readonly hervorhebungsfarbe = rollenfarbe("primary");
  private readonly gedimmt = new THREE.Color("#e9e5de");

  constructor(readonly stimmung: Stimmung) {}

  private holen<T extends THREE.Material>(schluessel: string, erzeugen: () => T): T {
    let material = this.cache.get(schluessel) as T | undefined;
    if (!material) {
      material = erzeugen();
      this.cache.set(schluessel, material);
    }
    return material;
  }

  partei(status: Bausteinstatus, flaeche: Flaeche, hervorhebung: Hervorhebung): THREE.MeshStandardMaterial {
    return this.holen(`partei:${status}:${flaeche}:${hervorhebung}`, () => {
      const farbe = grundfarbe(status, flaeche);
      if (hervorhebung === "gedimmt") farbe.lerp(this.gedimmt, this.stimmung.tageszeit === "abend" ? 0.35 : 0.6);
      const material = new THREE.MeshStandardMaterial({ color: farbe, roughness: flaeche === "dach" ? 0.78 : 0.86, metalness: 0 });
      if (hervorhebung === "hover" || hervorhebung === "auswahl") {
        material.emissive = this.hervorhebungsfarbe.clone();
        material.emissiveIntensity = hervorhebung === "auswahl" ? 0.42 : 0.24;
      }
      return material;
    });
  }

  einfach(name: keyof typeof SZENENFARBEN | "glas" | "glasLeuchtend" | "laternenlicht" | "tuerlicht", farbe?: string): THREE.Material {
    return this.holen(`einfach:${name}:${farbe ?? ""}`, () => {
      if (name === "glas") {
        return new THREE.MeshStandardMaterial({ color: SZENENFARBEN.fensterglas, roughness: 0.14, metalness: 0.4, envMapIntensity: 1.5 });
      }
      if (name === "glasLeuchtend") {
        // Abendlicht: unbeleuchtet und ohne Tonemapping, damit die Fenster wirklich leuchten.
        return new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
      }
      if (name === "laternenlicht" || name === "tuerlicht") {
        const abend = this.stimmung.tageszeit === "abend";
        return new THREE.MeshBasicMaterial({ color: abend ? "#ffe2b0" : "#f4efe6", toneMapped: !abend });
      }
      const wert = farbe ?? (SZENENFARBEN[name] as string);
      return new THREE.MeshStandardMaterial({ color: wert, roughness: name === "strasse" ? 0.95 : 0.88, metalness: 0 });
    });
  }

  rueckstand(): THREE.MeshStandardMaterial {
    return this.holen("rueckstand", () => {
      const farbe = rollenfarbe("destructive");
      return new THREE.MeshStandardMaterial({ color: farbe, emissive: farbe, emissiveIntensity: 0.35, roughness: 0.4 });
    });
  }

  entsorgen(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// Geometrien. Gleiche Maße teilen sich eine Geometrie; der Cache lebt so lange wie die Seite.
// ---------------------------------------------------------------------------------------------

const geometrien = new Map<string, THREE.BufferGeometry>();

function gecacht(schluessel: string, erzeugen: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometrie = geometrien.get(schluessel);
  if (!geometrie) {
    geometrie = erzeugen();
    geometrien.set(schluessel, geometrie);
  }
  return geometrie;
}

const r3 = (wert: number) => wert.toFixed(3);

/** Quader mit leicht gerundeten Kanten, Ursprung in der Mitte der Unterseite. */
export function quaderGeometrie(breite: number, hoehe: number, tiefe: number, radius = 0.035): THREE.BufferGeometry {
  return gecacht(`quader:${r3(breite)}:${r3(hoehe)}:${r3(tiefe)}:${radius}`, () => {
    const r = Math.max(0.001, Math.min(radius, breite / 2 - 0.001, hoehe / 2 - 0.001, tiefe / 2 - 0.001));
    const geometrie = new RoundedBoxGeometry(breite, hoehe, tiefe, 2, r);
    geometrie.translate(0, hoehe / 2, 0);
    return geometrie;
  });
}

/** Einheitswürfel mit Ursprung in der Mitte der Unterseite — für Instanzen und Kleinteile. */
export function wuerfelGeometrie(): THREE.BufferGeometry {
  return gecacht("wuerfel", () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
}

/** Mittiger Einheitswürfel (für Fenster, die auf einer Fassade sitzen). */
export function wuerfelMittigGeometrie(): THREE.BufferGeometry {
  return gecacht("wuerfel-mittig", () => new THREE.BoxGeometry(1, 1, 1));
}

/**
 * Ausschnitt eines Satteldachs quer zum First: Der First läuft entlang x bei z = 0, die
 * Traufen liegen bei z = ±tiefe/2. Ein Dachgeschoss mit „vorne/mittig/hinten" wird so in
 * Streifen geschnitten; ohne Schnitt (z0 = -tiefe/2, z1 = tiefe/2) entsteht das ganze Dach.
 */
export function dachGeometrie(breite: number, tiefe: number, firsthoehe: number, z0 = -tiefe / 2, z1 = tiefe / 2): THREE.BufferGeometry {
  return gecacht(`dach:${r3(breite)}:${r3(tiefe)}:${r3(firsthoehe)}:${r3(z0)}:${r3(z1)}`, () => {
    const halb = tiefe / 2;
    const dachlinie = (z: number) => Math.max(0, firsthoehe * (1 - Math.abs(z) / halb));
    // Umriss in der Ebene (z, y); Extrusion entlang x.
    const punkte: [number, number][] = [
      [z0, 0],
      [z1, 0],
      [z1, dachlinie(z1)],
    ];
    if (z0 < 0 && z1 > 0) punkte.push([0, firsthoehe]);
    punkte.push([z0, dachlinie(z0)]);
    const umriss = new THREE.Shape(punkte.map(([z, y]) => new THREE.Vector2(z, y)));
    const geometrie = new THREE.ExtrudeGeometry(umriss, { depth: breite, bevelEnabled: false, steps: 1 });
    // Formebene (x = z, y = y) → Welt: Extrusionsachse wird x, Umriss-x wird z.
    geometrie.rotateY(-Math.PI / 2);
    geometrie.translate(breite / 2, 0, 0);
    geometrie.computeVertexNormals();
    return geometrie;
  });
}

/** Pyramidendach mit quadratischer Grundfläche, Ursprung in der Mitte der Unterseite. */
export function pyramideGeometrie(breite: number, hoehe: number): THREE.BufferGeometry {
  return gecacht(`pyramide:${r3(breite)}:${r3(hoehe)}`, () => {
    const geometrie = new THREE.ConeGeometry(breite / Math.SQRT2, hoehe, 4, 1);
    geometrie.rotateY(Math.PI / 4);
    geometrie.translate(0, hoehe / 2, 0);
    return geometrie;
  });
}

/** Platte mit abgerundeten Ecken (Grundstück, Grundplatte), Oberseite bei y = 0. */
export function plattenGeometrie(breite: number, tiefe: number, dicke: number, radius: number): THREE.BufferGeometry {
  return gecacht(`platte:${r3(breite)}:${r3(tiefe)}:${r3(dicke)}:${r3(radius)}`, () => {
    const b = breite / 2;
    const t = tiefe / 2;
    const r = Math.min(radius, b, t);
    const form = new THREE.Shape();
    form.moveTo(-b + r, -t);
    form.lineTo(b - r, -t);
    form.quadraticCurveTo(b, -t, b, -t + r);
    form.lineTo(b, t - r);
    form.quadraticCurveTo(b, t, b - r, t);
    form.lineTo(-b + r, t);
    form.quadraticCurveTo(-b, t, -b, t - r);
    form.lineTo(-b, -t + r);
    form.quadraticCurveTo(-b, -t, -b + r, -t);
    const geometrie = new THREE.ExtrudeGeometry(form, { depth: dicke, bevelEnabled: false, curveSegments: 6 });
    // Die Form liegt in x/y; gekippt liegt sie flach, die Oberseite bei y = 0.
    geometrie.rotateX(-Math.PI / 2);
    geometrie.translate(0, -dicke, 0);
    return geometrie;
  });
}

/** Weicher Schatten unter der Grundplatte als Verlaufstextur. */
export function schattenTextur(): THREE.Texture {
  const leinwand = document.createElement("canvas");
  leinwand.width = 128;
  leinwand.height = 128;
  const ctx = leinwand.getContext("2d");
  if (ctx) {
    const verlauf = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    verlauf.addColorStop(0, "rgba(30, 28, 24, 0.42)");
    verlauf.addColorStop(0.55, "rgba(30, 28, 24, 0.2)");
    verlauf.addColorStop(1, "rgba(30, 28, 24, 0)");
    ctx.fillStyle = verlauf;
    ctx.fillRect(0, 0, 128, 128);
  }
  const textur = new THREE.CanvasTexture(leinwand);
  textur.colorSpace = THREE.SRGBColorSpace;
  return textur;
}
