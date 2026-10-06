import { describe, it, expect } from "vitest";
import { DACHGESCHOSS } from "./etageLesen";
import { MASSE, objektModell, type Baustein, type EinheitFuerModell, type ObjektModell } from "./objektModell";

// Einheiten-IDs sind hier sprechend; die Etagentexte stammen aus dem Bestand (Stand 06.10.2026).
const e = (id: string, etage: string | null, einheitentyp: string | null = "Wohnung", qm: number | null = 70): EinheitFuerModell => ({
  id,
  etage,
  einheitentyp,
  qm,
});

const teileVon = (modell: ObjektModell, id: string): Baustein[] => modell.bausteine.filter((b) => b.einheitId === id);

/** Zwei Quader überschneiden sich im Grundriss und in der Höhe echt (Berührung zählt nicht). */
function ueberschneiden(a: Baustein, b: Baustein): boolean {
  const eps = 1e-6;
  return (
    Math.abs(a.x - b.x) < (a.breite + b.breite) / 2 - eps &&
    Math.abs(a.z - b.z) < (a.tiefe + b.tiefe) / 2 - eps &&
    a.y < b.y + b.hoehe - eps &&
    b.y < a.y + a.hoehe - eps
  );
}

describe("objektModell – Grundsätze", () => {
  // Ein Haus wie Objekt 12: drei Geschosse und Dachgeschoss je links/rechts, Garagen, Gartenhaus, Turmhaus.
  const einheiten = [
    e("eg-l", "Erdgeschoss links", "Wohnung", 100),
    e("eg-r", "Erdgeschoss rechts", "Wohnung", 52),
    e("og1-l", "Erstes Obergeschoss links"),
    e("og1-r", "Erstes Obergeschoss rechts"),
    e("og2-l", "Zweites Obergeschoss links"),
    e("og2-r", "Zweites Obergeschoss rechts"),
    e("dg-l", "Dachgeschoss links", "Wohnung", 63),
    e("dg-r", "Dachgeschoss rechts", "Wohnung", 54),
    e("g3", " Dritte Garage von links", "Garage", null),
    e("g1", " Erste Garage von links", "Garage", null),
    e("g4", "Vierte Garage von links", "Garage", null),
    e("g2", " Zweite Garage von links", "Garage", null),
    e("garten", "Gartenhaus", "Sonstiges", null),
    e("turm", " Turmhaus", "Sonstiges", null),
  ];
  const modell = objektModell(einheiten, "Wohnhaus", "objekt-12");

  it("bildet jede Einheit mindestens einmal ab", () => {
    for (const einheit of einheiten) {
      expect(teileVon(modell, einheit.id).length, einheit.id).toBeGreaterThan(0);
    }
  });

  it("stapelt die Geschosse in der richtigen Reihenfolge", () => {
    const y = (id: string) => teileVon(modell, id)[0].y;
    expect(y("eg-l")).toBeLessThan(y("og1-l"));
    expect(y("og1-l")).toBeLessThan(y("og2-l"));
    expect(y("og2-l")).toBeLessThan(y("dg-l"));
    expect(teileVon(modell, "dg-l")[0]).toMatchObject({ form: "dach", geschoss: DACHGESCHOSS });
  });

  it("legt links links und rechts rechts", () => {
    const x = (id: string) => teileVon(modell, id)[0].x;
    expect(x("eg-l")).toBeLessThan(x("eg-r"));
    expect(x("og2-l")).toBeLessThan(x("og2-r"));
    expect(x("dg-l")).toBeLessThan(x("dg-r"));
  });

  it("gibt der größeren Wohnung die breitere Fassade", () => {
    expect(teileVon(modell, "eg-l")[0].breite).toBeGreaterThan(teileVon(modell, "eg-r")[0].breite);
  });

  it("reiht Garagen nach ihrer Ordnungszahl, nicht nach der Eingabe", () => {
    const x = ["g1", "g2", "g3", "g4"].map((id) => teileVon(modell, id)[0].x);
    expect([...x].sort((a, b) => a - b)).toEqual(x);
  });

  it("lässt keine zwei Bausteine ineinander stehen", () => {
    const b = modell.bausteine;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        expect(ueberschneiden(b[i], b[j]), `${b[i].schluessel} / ${b[j].schluessel}`).toBe(false);
      }
    }
  });

  it("hält alles innerhalb des Grundstücks", () => {
    for (const t of [...modell.bausteine, ...modell.zierteile]) {
      expect(Math.abs(t.x) + t.breite / 2, t.schluessel).toBeLessThanOrEqual(modell.breite / 2 + 1e-6);
      expect(Math.abs(t.z) + t.tiefe / 2, t.schluessel).toBeLessThanOrEqual(modell.tiefe / 2 + 1e-6);
    }
  });

  it("ist für dieselben Daten stabil", () => {
    expect(objektModell(einheiten, "Wohnhaus", "objekt-12")).toEqual(modell);
  });
});

describe("objektModell – Sonderfälle aus dem Bestand", () => {
  it("baut zwei Hausteile nebeneinander (Objekt 11)", () => {
    const modell = objektModell([
      e("l-eg-l", "Linkes Erdgeschoss links"),
      e("l-eg-r", "Linkes Erdgeschoss rechts"),
      e("r-eg-l", "Rechts Erdgeschoss links"),
      e("r-eg-r", "Rechtes Erdgeschoss rechts"),
    ]);
    const x = (id: string) => teileVon(modell, id)[0].x;
    expect(x("l-eg-l")).toBeLessThan(x("l-eg-r"));
    expect(x("l-eg-r")).toBeLessThan(x("r-eg-l"));
    expect(x("r-eg-l")).toBeLessThan(x("r-eg-r"));
  });

  it("teilt die Mansarde nach Seite und Tiefe (Objekt 1)", () => {
    const modell = objektModell([
      e("eg", "Erdgeschoss", "Gewerbe", 75),
      e("lh", "Dachgeschoss (Mansarde), links hinten", "Wohnung", 8),
      e("lm", "Dachgeschoss (Mansarde), links mittig", "Wohnung", 8),
      e("lv", "Dachgeschoss (Mansarde), links vorne", "Wohnung", 8),
      e("rh", "Dachgeschoss (Mansarde), rechts hinten", "Wohnung", 8),
      e("rv", "Dachgeschoss (Mansarde), rechts vorne", "Wohnung", 8),
    ]);
    const schnitt = (id: string) => teileVon(modell, id)[0].dachschnitt!;
    // Vorne liegt bei größerem z.
    expect(schnitt("lv").z0).toBeGreaterThan(schnitt("lm").z0);
    expect(schnitt("lm").z0).toBeGreaterThan(schnitt("lh").z0);
    expect(schnitt("rv").z0).toBeGreaterThan(schnitt("rh").z0);
    expect(teileVon(modell, "lv")[0].x).toBeLessThan(teileVon(modell, "rv")[0].x);
  });

  it("legt einen Keller nur aus „EG und KG“ genau unter dessen Erdgeschossteil (Objekt 5)", () => {
    const modell = objektModell([
      e("eg-l", "Erdgeschoss links", "Wohnung", 63),
      e("eg-kg", "\tErdgeschoss und Kellergeschoss", "Wohnung", 98),
      e("eg-r", "Ergeschoss rechts", "Wohnung", 41),
    ]);
    const teile = teileVon(modell, "eg-kg");
    expect(teile.map((t) => t.geschoss).sort()).toEqual([-1, 0]);
    const [keller, eg] = [...teile].sort((a, b) => a.y - b.y);
    expect(keller.x).toBeCloseTo(eg.x);
    expect(keller.breite).toBeCloseTo(eg.breite);
    // Der Rest des Kellers ist Allgemeinfläche, nicht Teil der Wohnung.
    const allgemein = modell.bausteine.filter((b) => b.einheitId === null && b.geschoss === -1);
    expect(allgemein.length).toBeGreaterThan(0);
  });

  it("verliert keinen Kellerteil, wenn zwei durchgehende Einheiten eine Spalte teilen", () => {
    // Sechs Erdgeschosseinheiten ohne Seite rücken in drei Spalten zu je vorne/hinten;
    // a und d landen in derselben Spalte und reichen beide in den Keller.
    const modell = objektModell([
      e("a", "Erdgeschoss + Kellergeschoss"),
      e("b", "Erdgeschoss"),
      e("c", "Erdgeschoss"),
      e("d", "Erdgeschoss und Kellergeschoss"),
      e("e", "Erdgeschoss"),
      e("f", "Erdgeschoss"),
    ]);
    for (const id of ["a", "d"]) {
      expect(teileVon(modell, id).map((t) => t.geschoss).sort(), id).toEqual([-1, 0]);
    }
  });

  it("rückt sieben Kellerabteile in zwei Reihen (Objekt 3)", () => {
    const keller = Array.from({ length: 6 }, (_, i) => e(`kg${i + 1}`, `Kellergeschoss ${i + 1}`, "Wohnung", 15));
    const modell = objektModell([...keller, e("lager", "Kellergeschoss Lager", "Lager", 8), e("eg", "Erdgeschoss", "Wohnung", 111)]);
    const kellerTeile = modell.bausteine.filter((b) => b.geschoss === -1);
    // Vier Spalten statt sieben: Die zweite Hälfte steht hinter der ersten.
    expect(new Set(kellerTeile.map((b) => b.x)).size).toBe(4);
    expect(Math.max(...kellerTeile.map((b) => b.breite))).toBeLessThan(objektModell([e("eg", "Erdgeschoss", "Wohnung", 111)]).bausteine[0].breite * 2);
    expect(kellerTeile.every((b) => b.hoehe === MASSE.keller)).toBe(true);
  });

  it("füllt fehlende Geschosse mit Allgemeinfläche", () => {
    const modell = objektModell([e("eg", "Erdgeschoss"), e("og2", "Zweites Obergeschoss")]);
    const luecke = modell.bausteine.filter((b) => b.einheitId === null && b.geschoss === 1);
    expect(luecke).toHaveLength(1);
  });

  it("macht aus einer einzelnen Gewerbeeinheit ohne Etage eine Halle (Objekt 8)", () => {
    const modell = objektModell([e("halle", null, "Gewerbe", null)], "Gewerbe");
    expect(modell.bausteine).toHaveLength(1);
    expect(modell.bausteine[0].form).toBe("halle");
  });

  it("baut Reihenhäuser nebeneinander, jedes mit eigenem Dach (Objekt 2)", () => {
    const typ = "Haus (Doppelhaushälfte, Reihenhaus)";
    const modell = objektModell(["18c", "18", "18a", "18b"].map((n) => e(n, `Reihenhaus ${n}`, typ, 137)));
    const koerper = modell.bausteine.filter((b) => b.form === "haus");
    expect(koerper.map((b) => b.einheitId)).toEqual(["18", "18a", "18b", "18c"]);
    for (const id of ["18", "18a", "18b", "18c"]) {
      expect(teileVon(modell, id).map((b) => b.form).sort()).toEqual(["dach", "haus"]);
    }
  });

  it("deckt Gewerbeobjekte flach", () => {
    const modell = objektModell([e("eg", "Erdgeschoss", "Gewerbe")], "Gewerbe");
    expect(modell.zierteile.some((z) => z.art === "flachdach")).toBe(true);
    expect(modell.zierteile.some((z) => z.art === "satteldach")).toBe(false);
  });

  it("liefert für ein Objekt ohne Einheiten ein leeres Grundstück", () => {
    const modell = objektModell([]);
    expect(modell.bausteine).toEqual([]);
    expect(modell.breite).toBeGreaterThan(0);
  });
});

describe("objektModell – Robustheit (QA-Funde vom 06.10.2026)", () => {
  /** Alle Invarianten auf einmal: jede Einheit da, nichts NaN, nichts außerhalb, keine Durchdringung. */
  function invarianten(modell: ObjektModell, einheiten: EinheitFuerModell[], fall: string) {
    for (const einheit of einheiten) expect(teileVon(modell, einheit.id).length, `${fall}: ${einheit.id} fehlt`).toBeGreaterThan(0);
    for (const t of [...modell.bausteine, ...modell.zierteile]) {
      for (const wert of [t.x, t.y, t.z, t.breite, t.hoehe, t.tiefe]) expect(Number.isFinite(wert), `${fall}: ${t.schluessel}`).toBe(true);
      // Koordinaten sind auf drei Stellen gerundet; daher die Toleranz.
      expect(Math.abs(t.x) + t.breite / 2, `${fall}: ${t.schluessel}`).toBeLessThanOrEqual(modell.breite / 2 + 2e-3);
      expect(Math.abs(t.z) + t.tiefe / 2, `${fall}: ${t.schluessel}`).toBeLessThanOrEqual(modell.tiefe / 2 + 2e-3);
    }
    const b = modell.bausteine;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        // Dachstücke derselben Spalte teilen sich den Hüllquader; entscheidend ist ihr Ausschnitt quer zum First.
        const [s1, s2] = [b[i].dachschnitt, b[j].dachschnitt];
        if (s1 && s2 && !(s1.z0 < s2.z1 - 5e-3 && s2.z0 < s1.z1 - 5e-3)) continue;
        // Rundung auf drei Stellen erlaubt 5e-3.
        const echt =
          Math.abs(b[i].x - b[j].x) < (b[i].breite + b[j].breite) / 2 - 5e-3 &&
          Math.abs(b[i].z - b[j].z) < (b[i].tiefe + b[j].tiefe) / 2 - 5e-3 &&
          b[i].y < b[j].y + b[j].hoehe - 5e-3 &&
          b[j].y < b[i].y + b[i].hoehe - 5e-3;
        expect(echt, `${fall}: ${b[i].schluessel} / ${b[j].schluessel}`).toBe(false);
      }
    }
  }

  it("setzt Garagen hinter seitlich gestapelte Nebenanlagen", () => {
    const einheiten = [
      e("eg", "Erdgeschoss"),
      e("sp", "Stellplatz 1", "Stellplatz", null),
      e("lager", "Lager", "Lager", 30),
      ...[1, 2, 3, 4].map((n) => e(`g${n}`, `${n}. Garage`, "Garage", null)),
    ];
    invarianten(objektModell(einheiten, "Wohnhaus", "s"), einheiten, "Nebenanlagen");
  });

  it("baut bei einem Tippfehler im Geschoss kein Hochhaus", () => {
    const modell = objektModell([e("a", "999999. OG"), e("b", "OG 99")]);
    expect(Math.max(...modell.bausteine.map((b) => b.geschoss ?? 0))).toBeLessThanOrEqual(20);
    expect(modell.bausteine.every((b) => b.form !== "dach")).toBe(true);
  });

  it("rechnet mit einer unlesbaren Fläche wie ohne Angabe", () => {
    const einheiten = [e("a", "Erdgeschoss", "Wohnung", Number.NaN), e("b", "Erdgeschoss", "Wohnung", Number.POSITIVE_INFINITY)];
    invarianten(objektModell(einheiten), einheiten, "qm");
  });

  it("hält die Invarianten für 300 zufällige Objekte", () => {
    let saat = 20261006;
    const zufall = () => (saat = (saat * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const waehle = <T,>(liste: readonly T[]) => liste[Math.floor(zufall() * liste.length)];
    const texte = [
      "Erdgeschoss", "Erdgeschoss links", "Erdgeschoss rechts", "Erstes Obergeschoss mittig", "Zweites Obergeschoss links",
      "Dachgeschoss", "Dachgeschoss (Mansarde), links hinten", "Kellergeschoss 2", "Erdgeschoss + Kellergeschoss",
      "Linkes Erdgeschoss links", "Rechtes Erstes Obergeschoss rechts", "Erdgeschoss Anbau Nummer 1", "Obergeschoss Anbau",
      "Dritte Garage von links", "Hinterhof Doppelgarage", "Stellplatz Nr.3", "Reihenhaus 18a", "Haushälfte links",
      "Werbetafel", "Gartenhaus", "Turmhaus", "Werkstatt", "Lagerraum", "Haus/Gebäude", "", null,
    ] as const;
    const typen = ["Wohnung", "Gewerbe", "Garage", "Stellplatz", "Haus (Doppelhaushälfte, Reihenhaus)", "Lager", "Sonstiges", null] as const;
    for (let fall = 0; fall < 300; fall++) {
      const einheiten = Array.from({ length: 1 + Math.floor(zufall() * 30) }, (_, i) =>
        e(`f${fall}-${i}`, waehle(texte), waehle(typen), zufall() < 0.2 ? null : Math.round(5 + zufall() * 250))
      );
      invarianten(objektModell(einheiten, waehle(["Wohnhaus", "Gewerbe", "Mischnutzung", null]), `s${fall}`), einheiten, `Fall ${fall}`);
    }
  });
});
