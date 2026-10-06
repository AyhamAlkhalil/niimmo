/**
 * Ordnet die Grundstücke der 3D-Ansicht zu einem Quartier: Reihen von Grundstücken, vor jeder
 * Reihe eine Straße. Die Reihenfolge bleibt die der Hauptansicht (nach Namen), gelesen wie eine
 * Seite — hinten links beginnt es, vorne rechts endet es.
 */

export interface Grundstueck {
  id: string;
  breite: number;
  tiefe: number;
}

export interface Platz extends Grundstueck {
  /** Mitte des Grundstücks. */
  x: number;
  z: number;
  reihe: number;
}

export interface Strasse {
  x: number;
  z: number;
  laenge: number;
  /** Breite quer zur Fahrtrichtung, Gehwege eingeschlossen. */
  breite: number;
}

export interface Quartier {
  plaetze: Platz[];
  strassen: Strasse[];
  breite: number;
  tiefe: number;
  /** Radius eines Kreises um die Mitte, der alles einschließt — für die Kameradistanz. */
  radius: number;
}

export const QUARTIER_MASSE = {
  /** Gartenabstand zwischen Nachbargrundstücken. */
  abstand: 0.8,
  strasse: 2.6,
  /** Überstand der Straßen und der Grundplatte über die Grundstücke hinaus. */
  rand: 2.0,
} as const;

/** Wie viele Grundstücke je Reihe: etwas breiter als quadratisch, weil der Blick von vorn kommt. */
export function reihenAufteilung(anzahl: number): number[] {
  if (anzahl <= 0) return [];
  const proReihe = Math.max(1, Math.ceil(Math.sqrt(anzahl * 1.4)));
  const reihen = Math.ceil(anzahl / proReihe);
  const grund = Math.floor(anzahl / reihen);
  const rest = anzahl % reihen;
  return Array.from({ length: reihen }, (_, i) => grund + (i < rest ? 1 : 0));
}

export function quartierAnordnen(grundstuecke: Grundstueck[]): Quartier {
  if (grundstuecke.length === 0) return { plaetze: [], strassen: [], breite: 0, tiefe: 0, radius: 0 };
  const { abstand, strasse, rand } = QUARTIER_MASSE;

  const reihen: Grundstueck[][] = [];
  let index = 0;
  for (const anzahl of reihenAufteilung(grundstuecke.length)) {
    reihen.push(grundstuecke.slice(index, index + anzahl));
    index += anzahl;
  }
  const reihenBreite = (reihe: Grundstueck[]) => reihe.reduce((s, g) => s + g.breite, 0) + abstand * (reihe.length - 1);
  const breiteste = Math.max(...reihen.map(reihenBreite));

  const plaetze: Platz[] = [];
  const strassen: Strasse[] = [];
  let z = 0;
  reihen.forEach((reihe, reihenIndex) => {
    // Alle Grundstücke einer Reihe stoßen vorn an dieselbe Straße.
    const vorne = z + Math.max(...reihe.map((g) => g.tiefe));
    let x = -reihenBreite(reihe) / 2;
    for (const g of reihe) {
      plaetze.push({ ...g, x: x + g.breite / 2, z: vorne - g.tiefe / 2, reihe: reihenIndex });
      x += g.breite + abstand;
    }
    strassen.push({ x: 0, z: vorne + strasse / 2, laenge: breiteste + 2 * rand, breite: strasse });
    z = vorne + strasse;
  });

  const mitte = z / 2;
  for (const platz of plaetze) platz.z -= mitte;
  for (const s of strassen) s.z -= mitte;

  const breite = breiteste + 2 * rand;
  const tiefe = z + 2 * rand;
  return { plaetze, strassen, breite, tiefe, radius: Math.hypot(breite / 2, tiefe / 2) };
}
