import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { einheitenInReihenfolge, einheitenNummern } from "./einheitenReihenfolge";

// Ziffern in den letzten zwei Zeichen der ID bestimmen die Reihenfolge der Objektübersicht,
// danach das Anlagedatum (sortUnitsByNumber).
const einheiten = [
  { id: "aaaaaaaa-0000-0000-0000-0000000000b7", erstellt_am: "2025-01-01", etage: "EG links" },
  { id: "aaaaaaaa-0000-0000-0000-0000000000a2", erstellt_am: "2025-01-01", etage: "1. OG" },
  { id: "aaaaaaaa-0000-0000-0000-0000000000ff", erstellt_am: "2025-02-01", etage: "Garage" },
  { id: "aaaaaaaa-0000-0000-0000-0000000000ee", erstellt_am: "2025-01-15", etage: "DG" },
];

describe("einheitenInReihenfolge", () => {
  it("ordnet wie die Objektübersicht", () => {
    expect(einheitenInReihenfolge(einheiten).map((e) => e.etage)).toEqual(["1. OG", "EG links", "DG", "Garage"]);
  });

  it("verändert die Eingabe nicht", () => {
    const vorher = einheiten.map((e) => e.id);
    einheitenInReihenfolge(einheiten);
    expect(einheiten.map((e) => e.id)).toEqual(vorher);
  });

  it("hängt nicht von der Lade-Reihenfolge ab", () => {
    expect(einheitenInReihenfolge([...einheiten].reverse())).toEqual(einheitenInReihenfolge(einheiten));
  });
});

describe("einheitenNummern", () => {
  it("nummeriert ab 1 in derselben Reihenfolge", () => {
    const nummern = einheitenNummern(einheiten);
    expect(nummern.get(einheiten[1].id)).toBe(1);
    expect(nummern.get(einheiten[0].id)).toBe(2);
    expect(nummern.get(einheiten[3].id)).toBe(3);
    expect(nummern.get(einheiten[2].id)).toBe(4);
  });
});

describe("Verdrahtung", () => {
  const lies = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

  it("Zählerliste und Hausmeister-Ansicht sortieren wie die Objektübersicht, nicht nach dem leeren Feld zaehler", () => {
    for (const datei of ["../components/dashboard/ZaehlerVerwaltung.tsx", "../components/dashboard/HausmeisterDashboard.tsx"]) {
      const quelle = lies(datei);
      expect(quelle, datei).toContain("einheitenInReihenfolge(");
      expect(quelle, datei).not.toMatch(/order\(['"]zaehler['"]\)/);
    }
  });

  it("die Objektübersicht nummeriert aus allen Einheiten, nicht aus dem Suchergebnis", () => {
    expect(lies("../components/dashboard/ImmobilienDetail.tsx")).toContain("einheitenNummern(");
  });
});
