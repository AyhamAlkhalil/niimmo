import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  artUmschalten,
  EINHEIT_ZAEHLERARTEN,
  einheitZaehlerarten,
  HAUSANSCHLUSS_ZAEHLERARTEN,
  hausanschlussZaehlerarten,
  hausanschlussZweiterZaehler,
  versorgerArten,
  vertragZaehlerarten,
} from "./zaehlerarten";

// Gehrden laut Meldung vom 07.11.2026: zwei Wasserzähler am Hausanschluss, kein zentraler Gaszähler,
// die Wohnungen haben je einen eigenen Gaszähler.
const gehrden = {
  hat_wasser: true,
  hat_strom: true,
  hat_gas: false,
  hausanschluss_zweiter_zaehler: ["wasser"],
  zaehlerarten_einheiten: ["kaltwasser", "warmwasser", "strom", "gas"],
};

describe("einheitZaehlerarten", () => {
  it("folgt der Wahl am Objekt, unabhängig vom Hausanschluss", () => {
    expect(einheitZaehlerarten(gehrden)).toEqual(["kaltwasser", "warmwasser", "strom", "gas"]);
    expect(einheitZaehlerarten({ ...gehrden, zaehlerarten_einheiten: ["gas", "kaltwasser"] })).toEqual(["kaltwasser", "gas"]);
  });

  it("Warmwasser lässt sich allein abwählen", () => {
    expect(einheitZaehlerarten({ zaehlerarten_einheiten: ["kaltwasser", "strom", "gas"] })).toEqual(["kaltwasser", "strom", "gas"]);
  });

  it("ohne Angabe alle vier (Abfragen ohne die Spalte)", () => {
    expect(einheitZaehlerarten(undefined)).toEqual([...EINHEIT_ZAEHLERARTEN]);
    expect(einheitZaehlerarten({ hat_gas: false })).toEqual([...EINHEIT_ZAEHLERARTEN]);
  });

  it("eine leere Liste heißt: keine Zähler in den Einheiten", () => {
    expect(einheitZaehlerarten({ zaehlerarten_einheiten: [] })).toEqual([]);
  });
});

describe("Hausanschluss", () => {
  it("kein zentraler Gaszähler, zwei Wasserzähler", () => {
    expect(hausanschlussZaehlerarten(gehrden)).toEqual(["wasser", "strom"]);
    expect(hausanschlussZweiterZaehler(gehrden)).toEqual(["wasser"]);
  });

  it("ohne Angabe alle drei, aber kein zweiter Zähler", () => {
    expect(hausanschlussZaehlerarten({})).toEqual([...HAUSANSCHLUSS_ZAEHLERARTEN]);
    expect(hausanschlussZweiterZaehler({})).toEqual([]);
  });

  it("ein zweiter Zähler ohne ersten erscheint nicht", () => {
    expect(hausanschlussZweiterZaehler({ hat_gas: false, hausanschluss_zweiter_zaehler: ["gas", "strom"] })).toEqual(["strom"]);
  });
});

describe("versorgerArten", () => {
  it("Gasversorger bleibt, wenn nur die Wohnungen Gaszähler haben", () => {
    expect(versorgerArten(gehrden)).toEqual(["wasser", "strom", "gas"]);
  });

  it("entfällt erst, wenn weder Hausanschluss noch Einheiten die Art haben", () => {
    expect(versorgerArten({ hat_gas: false, zaehlerarten_einheiten: ["kaltwasser", "strom"] })).toEqual(["wasser", "strom"]);
    expect(versorgerArten({ hat_wasser: false, zaehlerarten_einheiten: ["warmwasser"] })).toEqual(["wasser", "strom", "gas"]);
  });
});

describe("artUmschalten", () => {
  it("hält die feste Reihenfolge", () => {
    expect(artUmschalten(EINHEIT_ZAEHLERARTEN, ["gas", "kaltwasser"], "warmwasser", true)).toEqual(["kaltwasser", "warmwasser", "gas"]);
    expect(artUmschalten(EINHEIT_ZAEHLERARTEN, ["kaltwasser", "warmwasser"], "warmwasser", false)).toEqual(["kaltwasser"]);
  });

  it("geht ohne bisherige Liste von allen aus", () => {
    expect(artUmschalten(EINHEIT_ZAEHLERARTEN, null, "warmwasser", false)).toEqual(["kaltwasser", "strom", "gas"]);
    expect(artUmschalten(HAUSANSCHLUSS_ZAEHLERARTEN, [], "wasser", true)).toEqual(["wasser"]);
  });
});

describe("vertragZaehlerarten", () => {
  const ohneWarmwasser = { zaehlerarten_einheiten: ["kaltwasser", "strom", "gas"] };

  it("abgewählte Arten fehlen, solange der Vertrag keinen Stand dafür hat", () => {
    expect(vertragZaehlerarten(ohneWarmwasser, { warmwasser_einzug: null, warmwasser_auszug: "" })).toEqual(["kaltwasser", "strom", "gas"]);
  });

  it("ein erfasster Ein- oder Auszugsstand bleibt sichtbar", () => {
    expect(vertragZaehlerarten(ohneWarmwasser, { warmwasser_einzug: 12.5 })).toEqual([...EINHEIT_ZAEHLERARTEN]);
    expect(vertragZaehlerarten(ohneWarmwasser, { warmwasser_auszug: 0 })).toEqual([...EINHEIT_ZAEHLERARTEN]);
  });
});

describe("Verdrahtung", () => {
  const lies = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

  it("die Ansichten lesen die Wahl über diese Funktionen, nicht mehr über hat_* allein", () => {
    const verwaltung = lies("../components/dashboard/ZaehlerVerwaltung.tsx");
    expect(verwaltung).toContain("einheitZaehlerarten(");
    expect(verwaltung).toContain("hausanschlussZweiterZaehler(");
    expect(verwaltung).toContain("zaehlerarten_einheiten");
    expect(verwaltung).not.toMatch(/hat_wasser !== false\) \{ types\.push\('kaltwasser'\)/);

    expect(lies("../components/dashboard/HausmeisterDashboard.tsx")).toContain("einheitZaehlerarten(");
    expect(lies("../components/dashboard/ImmobilienDetail.tsx")).toContain("hausanschlussZweiterZaehler(");
    expect(lies("../components/dashboard/mietvertrag-details/MietvertragMeterReadings.tsx")).toContain("vertragZaehlerarten(");
  });
});
