import { describe, it, expect } from "vitest";
import { DACHGESCHOSS, bereichsname, bereichsrang, etageLesen, etageNormalisieren } from "./etageLesen";

// Die Etagentexte stammen wörtlich aus dem Bestand (Stand 06.10.2026), einschließlich
// Tippfehler, Tabulator und führender Leerzeichen.

describe("etageNormalisieren", () => {
  it("fasst Leerraum zusammen und korrigiert den Tippfehler „Ergeschoss“", () => {
    expect(etageNormalisieren("\tErdgeschoss und Kellergeschoss")).toBe("erdgeschoss und kellergeschoss");
    expect(etageNormalisieren("Ergeschoss rechts")).toBe("erdgeschoss rechts");
    // „Obergeschoss" enthält „ergeschoss", darf aber nicht verändert werden.
    expect(etageNormalisieren("Erstes Obergeschoss ")).toBe("erstes obergeschoss");
    expect(etageNormalisieren(null)).toBe("");
  });
});

describe("etageLesen – Geschosse", () => {
  it("liest Erdgeschoss, Obergeschosse und Dachgeschoss", () => {
    expect(etageLesen("Erdgeschoss links", "Wohnung")).toMatchObject({ art: "geschoss", geschosse: [0], spalte: 0 });
    expect(etageLesen("Erstes Obergeschoss rechts", "Wohnung")).toMatchObject({ geschosse: [1], spalte: 2 });
    expect(etageLesen("Zweites Obergeschoss", "Wohnung")).toMatchObject({ geschosse: [2], spalte: null });
    expect(etageLesen("Dachgeschoss", "Wohnung")).toMatchObject({ geschosse: [DACHGESCHOSS] });
  });

  it("versteht Abkürzungen und Ziffern", () => {
    expect(etageLesen("1. OG links", "Wohnung").geschosse).toEqual([1]);
    expect(etageLesen("3.OG", "Wohnung").geschosse).toEqual([3]);
    expect(etageLesen("OG 2", "Wohnung").geschosse).toEqual([2]);
    expect(etageLesen("EG", "Wohnung").geschosse).toEqual([0]);
    expect(etageLesen("DG rechts", "Wohnung").geschosse).toEqual([DACHGESCHOSS]);
    expect(etageLesen("Hochparterre", "Wohnung").geschosse).toEqual([0]);
    expect(etageLesen("Tiefparterre", "Wohnung").geschosse).toEqual([-1]);
  });

  it("erkennt Einheiten über zwei Geschosse", () => {
    expect(etageLesen("Erdgeschoss + Kellergeschoss", "Wohnung").geschosse).toEqual([-1, 0]);
    expect(etageLesen("\tErdgeschoss und Kellergeschoss", "Wohnung").geschosse).toEqual([-1, 0]);
    expect(etageLesen("Erdgeschoss und Kellergeschoss", "Gewerbe").geschosse).toEqual([-1, 0]);
  });

  it("liest Kellerabteile mit Nummer", () => {
    expect(etageLesen("Kellergeschoss 4", "Wohnung")).toMatchObject({ geschosse: [-1], nummer: 4 });
    expect(etageLesen("Kellergeschoss Lager", "Lager")).toMatchObject({ art: "geschoss", geschosse: [-1], nummer: null });
  });

  it("nimmt die Geschossnummer nicht als Ordnungszahl", () => {
    expect(etageLesen("2. OG links", "Wohnung").nummer).toBeNull();
    expect(etageLesen("Zweites Obergeschoss links", "Wohnung").nummer).toBeNull();
  });
});

describe("etageLesen – Gebäudeteile und Lage", () => {
  it("trennt linkes und rechtes Haus von der Seitenangabe", () => {
    expect(etageLesen("Linkes Erstes Obergeschoss rechts", "Wohnung")).toMatchObject({ teil: "links", geschosse: [1], spalte: 2 });
    expect(etageLesen("Rechtes Zweites Obergeschoss links", "Wohnung")).toMatchObject({ teil: "rechts", geschosse: [2], spalte: 0 });
    // Schreibvariante im Bestand: „Rechts" statt „Rechtes".
    expect(etageLesen("Rechts Erdgeschoss links", "Wohnung")).toMatchObject({ teil: "rechts", geschosse: [0], spalte: 0 });
  });

  it("liest „rechts“ ohne folgendes Geschoss als Seite, nicht als Gebäudeteil", () => {
    expect(etageLesen("Erdgeschoss rechts", "Wohnung")).toMatchObject({ teil: "haupt", spalte: 2 });
    expect(etageLesen("Ergeschoss rechts", "Wohnung")).toMatchObject({ teil: "haupt", geschosse: [0], spalte: 2 });
  });

  it("liest Seite und Tiefe in der Mansarde", () => {
    expect(etageLesen("Dachgeschoss (Mansarde), links hinten", "Wohnung")).toMatchObject({ geschosse: [DACHGESCHOSS], spalte: 0, reihe: 2 });
    expect(etageLesen("Dachgeschoss (Mansarde), links mittig", "Wohnung")).toMatchObject({ spalte: 0, reihe: 1 });
    expect(etageLesen("Dachgeschoss (Mansarde), rechts vorne", "Wohnung")).toMatchObject({ spalte: 2, reihe: 0 });
  });

  it("liest „mittig“ allein als mittlere Spalte", () => {
    expect(etageLesen("Erstes Obergeschoss mittig", "Wohnung")).toMatchObject({ spalte: 1, reihe: null });
  });

  it("ordnet den Anbau zu und behält dessen Nummer", () => {
    expect(etageLesen("Erdgeschoss Anbau Nummer 2", "Gewerbe")).toMatchObject({ teil: "anbau", geschosse: [0], nummer: 2 });
    expect(etageLesen("Obergeschoss Anbau", "Wohnung")).toMatchObject({ teil: "anbau", geschosse: [1] });
  });
});

describe("etageLesen – Außenanlagen und Sonderfälle", () => {
  it("zählt Garagen in Worten ab", () => {
    expect(etageLesen("Dritte Garage von links", "Garage")).toMatchObject({ art: "garage", nummer: 3 });
    expect(etageLesen(" Erste Garage von links", "Garage")).toMatchObject({ art: "garage", nummer: 1 });
    expect(etageLesen("Fünfte Garage (rechts)", "Garage")).toMatchObject({ art: "garage", nummer: 5 });
    expect(etageLesen("Hinterhof Doppelgarage", "Garage")).toMatchObject({ art: "garage", hinterhof: true, doppelt: true });
  });

  it("liest Stellplatznummern", () => {
    expect(etageLesen("Stellplatz Nr.4", "Stellplatz")).toMatchObject({ art: "stellplatz", nummer: 4 });
    expect(etageLesen("Stellplatz 2", "Stellplatz")).toMatchObject({ art: "stellplatz", nummer: 2 });
  });

  it("sortiert Reihenhäuser mit Buchstabenzusatz", () => {
    const typ = "Haus (Doppelhaushälfte, Reihenhaus)";
    expect(etageLesen("Reihenhaus 18", typ)).toMatchObject({ art: "haus", nummer: 18 });
    expect(etageLesen("Reihenhaus 18b", typ).nummer).toBeCloseTo(18.02);
    expect(etageLesen("Haushälfte links", typ)).toMatchObject({ art: "haus", spalte: 0 });
    expect(etageLesen("Gemeindehaus", typ).art).toBe("haus");
  });

  it("lässt bei Wohnung, Gewerbe und Lager den Typ entscheiden, nicht ein Wort im Text", () => {
    expect(etageLesen("Erdgeschoss, über der Garage", "Wohnung")).toMatchObject({ art: "geschoss", geschosse: [0] });
    expect(etageLesen("Turmstraße, Erdgeschoss", "Gewerbe").art).toBe("geschoss");
    expect(etageLesen("Garage hinten", null).art).toBe("garage");
  });

  it("begrenzt Obergeschosse bei Tippfehlern", () => {
    expect(etageLesen("2026. OG", "Wohnung").geschosse).toEqual([20]);
    // 99 ist der Code des Dachgeschosses und darf nicht entstehen.
    expect(etageLesen("OG 99", "Wohnung").geschosse).toEqual([20]);
  });

  it("erkennt Kleinbauten am Text", () => {
    expect(etageLesen("Werbetafel", "Sonstiges").art).toBe("werbetafel");
    expect(etageLesen("Gartenhaus", "Sonstiges").art).toBe("gartenhaus");
    expect(etageLesen(" Turmhaus", "Sonstiges").art).toBe("turm");
  });

  it("legt Flächen ohne Geschoss ins Nebengebäude, ganze Gebäude in eine Halle", () => {
    expect(etageLesen("Werkstatt", "Gewerbe", 45).art).toBe("nebengebaeude");
    expect(etageLesen("Lagerraum", "Gewerbe", null).art).toBe("nebengebaeude");
    expect(etageLesen("Lager", "Lager", 37).art).toBe("nebengebaeude");
    expect(etageLesen("Haus/Gebäude", "Gewerbe", 240).art).toBe("halle");
    expect(etageLesen(null, "Gewerbe", 400).art).toBe("halle");
  });

  it("verliert keine Wohnung ohne Geschossangabe", () => {
    expect(etageLesen(null, "Wohnung")).toMatchObject({ art: "geschoss", geschosse: [0], geschossAngenommen: true });
    expect(etageLesen("Wohnung links", "Wohnung")).toMatchObject({ geschosse: [0], spalte: 0, geschossAngenommen: true });
  });
});

describe("bereichsname und bereichsrang", () => {
  it("benennt die Gruppen der Parteienliste", () => {
    expect(bereichsname(etageLesen("Dachgeschoss rechts", "Wohnung"))).toBe("Dachgeschoss");
    expect(bereichsname(etageLesen("Erstes Obergeschoss links", "Wohnung"))).toBe("1. Obergeschoss");
    expect(bereichsname(etageLesen("Erdgeschoss + Kellergeschoss", "Wohnung"))).toBe("Erdgeschoss");
    expect(bereichsname(etageLesen("Kellergeschoss 2", "Wohnung"))).toBe("Kellergeschoss");
    expect(bereichsname(etageLesen("Obergeschoss Anbau", "Wohnung"))).toBe("1. Obergeschoss · Anbau");
    expect(bereichsname(etageLesen("Zweite Garage von links", "Garage"))).toBe("Garagen");
  });

  it("sortiert von oben nach unten, Außenanlagen zuletzt", () => {
    const texte = ["Kellergeschoss 1", "Erdgeschoss links", "Dachgeschoss", "Zweites Obergeschoss links", "Stellplatz 1"];
    const sortiert = [...texte].sort(
      (a, b) =>
        bereichsrang(etageLesen(a, a.startsWith("Stellplatz") ? "Stellplatz" : "Wohnung")) -
        bereichsrang(etageLesen(b, b.startsWith("Stellplatz") ? "Stellplatz" : "Wohnung"))
    );
    expect(sortiert).toEqual(["Dachgeschoss", "Zweites Obergeschoss links", "Erdgeschoss links", "Kellergeschoss 1", "Stellplatz 1"]);
  });
});
