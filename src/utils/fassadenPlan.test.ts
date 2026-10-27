import { describe, expect, it } from "vitest";
import { bauartAus, fassadenPlan, freieEinheiten, objektBelegung, streuwert } from "./fassadenPlan";

describe("fassadenPlan", () => {
  it("zeichnet dasselbe Objekt immer gleich", () => {
    const a = fassadenPlan({ id: "objekt-1", objekttyp: "Wohnhaus", einheiten: 12, frei: 2 });
    const b = fassadenPlan({ id: "objekt-1", objekttyp: "Wohnhaus", einheiten: 12, frei: 2 });
    expect(a).toEqual(b);
  });

  it("leitet die Bauart aus der Objektart ab", () => {
    expect(bauartAus("Gewerbe", 1)).toBe("gewerbe");
    expect(bauartAus("Mischnutzung", 14)).toBe("mischnutzung");
    expect(bauartAus("Wohnhaus", 13)).toBe("wohnhaus");
    expect(bauartAus("Wohnhaus", 2)).toBe("haeuser");
    expect(bauartAus(null, 9)).toBe("wohnhaus");
  });

  it("hält Geschosse und Achsen in zeichenbaren Grenzen", () => {
    for (const einheiten of [0, 1, 4, 9, 14, 19, 60]) {
      const plan = fassadenPlan({ id: `x${einheiten}`, objekttyp: "Wohnhaus", einheiten, frei: 0 });
      expect(plan.geschosse).toBeGreaterThanOrEqual(2);
      expect(plan.geschosse).toBeLessThanOrEqual(5);
      expect(plan.achsen).toBeGreaterThanOrEqual(2);
      expect(plan.achsen).toBeLessThanOrEqual(6);
      expect(plan.tuerAchse).toBeGreaterThanOrEqual(0);
      expect(plan.tuerAchse).toBeLessThan(plan.achsen);
    }
  });

  it("färbt so viele Fenster wie Einheiten frei sind", () => {
    const plan = fassadenPlan({ id: "objekt-2", objekttyp: "Wohnhaus", einheiten: 13, frei: 3 });
    expect(plan.freieFenster).toHaveLength(3);
    expect(new Set(plan.freieFenster).size).toBe(3);
  });

  it("färbt nie die Tür und bei Mischnutzung nicht das Erdgeschoss", () => {
    const plan = fassadenPlan({ id: "objekt-3", objekttyp: "Mischnutzung", einheiten: 14, frei: 99 });
    const erdgeschoss = plan.geschosse - 1;
    expect(plan.freieFenster.length).toBe((plan.geschosse - 1) * plan.achsen);
    expect(plan.freieFenster.some((k) => k.startsWith(`${erdgeschoss}:`))).toBe(false);

    const wohnhaus = fassadenPlan({ id: "objekt-4", objekttyp: "Wohnhaus", einheiten: 9, frei: 99 });
    expect(wohnhaus.freieFenster).not.toContain(`${wohnhaus.geschosse - 1}:${wohnhaus.tuerAchse}`);
    expect(wohnhaus.freieFenster.length).toBe(wohnhaus.geschosse * wohnhaus.achsen - 1);
  });

  it("verträgt fehlende und unsinnige Werte", () => {
    const plan = fassadenPlan({ id: "", objekttyp: undefined, einheiten: Number.NaN, frei: -4 });
    expect(plan.freieFenster).toEqual([]);
    expect(plan.bauart).toBe("haeuser");
    expect(plan.haeuser).toBe(1);
  });

  it("baut Gewerbe flach und Häuser mit Satteldach", () => {
    expect(fassadenPlan({ id: "g", objekttyp: "Gewerbe", einheiten: 1, frei: 0 }).dach).toBe("flach");
    const haeuser = fassadenPlan({ id: "h", objekttyp: "Wohnhaus", einheiten: 2, frei: 1 });
    expect(haeuser.dach).toBe("sattel");
    expect(haeuser.haeuser).toBe(2);
    expect(haeuser.freieFenster[0]).toMatch(/^\d:\d:\d$/);
  });
});

describe("streuwert", () => {
  it("liefert eine feste vorzeichenlose Zahl", () => {
    expect(streuwert("abc")).toBe(streuwert("abc"));
    expect(streuwert("abc")).not.toBe(streuwert("abd"));
    expect(streuwert("abc")).toBeGreaterThanOrEqual(0);
  });
});

describe("freieEinheiten", () => {
  const stichtag = new Date("2026-10-27T12:00:00");
  it("zählt Einheiten ohne laufenden Vertrag", () => {
    const vertraege = [
      { einheit_id: "a", status: "aktiv", start_datum: "2020-01-01", ende_datum: null, kuendigungsdatum: null },
      // gekündigt, läuft aber noch
      { einheit_id: "b", status: "gekuendigt", start_datum: "2020-01-01", ende_datum: "2026-12-31", kuendigungsdatum: null },
      // schon beendet
      { einheit_id: "c", status: "gekuendigt", start_datum: "2020-01-01", ende_datum: "2026-09-30", kuendigungsdatum: null },
      // beginnt erst später
      { einheit_id: "d", status: "aktiv", start_datum: "2027-01-01", ende_datum: null, kuendigungsdatum: null },
    ];
    expect(freieEinheiten(["a", "b", "c", "d", "e"], vertraege, stichtag)).toBe(3);
  });

  it("zählt eine Einheit mit zwei Verträgen nur einmal als belegt", () => {
    const vertraege = [
      { einheit_id: "a", status: "aktiv", start_datum: "2020-01-01", ende_datum: null, kuendigungsdatum: null },
      { einheit_id: "a", status: "gekuendigt", start_datum: "2019-01-01", ende_datum: "2026-12-31", kuendigungsdatum: null },
    ];
    expect(freieEinheiten(["a", "b"], vertraege, stichtag)).toBe(1);
  });

  it("verträgt fehlende Verträge", () => {
    expect(freieEinheiten(["a"], undefined, stichtag)).toBe(1);
    expect(freieEinheiten([], null, stichtag)).toBe(0);
  });
});

describe("objektBelegung", () => {
  const stichtag = new Date("2026-10-27T12:00:00");
  const v = (einheit_id: string | null, status: string, start: string, ende: string | null = null) =>
    ({ einheit_id, status, start_datum: start, ende_datum: ende, kuendigungsdatum: null });

  it("zählt Einheiten, nicht Vertragszeilen", () => {
    const b = objektBelegung(
      ["a", "b", "c", "d"],
      [
        v("a", "aktiv", "2020-01-01"),
        // gekündigt, läuft noch, Folgevertrag beginnt erst später
        v("b", "gekuendigt", "2020-01-01", "2026-12-31"),
        v("b", "aktiv", "2027-01-01"),
        // gekündigt und schon abgelaufen
        v("c", "gekuendigt", "2019-01-01", "2026-09-30"),
      ],
      4,
      stichtag,
    );
    expect(b).toEqual({ gesamt: 4, frei: 2, gekuendigt: 1, belegungProzent: 50 });
  });

  it("ignoriert Verträge fremder Einheiten", () => {
    const b = objektBelegung(["a"], [v("x", "aktiv", "2020-01-01"), v(null, "aktiv", "2020-01-01")], 1, stichtag);
    expect(b.frei).toBe(1);
    expect(b.belegungProzent).toBe(0);
  });

  it("nimmt ohne angelegte Einheiten die Sollzahl als frei", () => {
    expect(objektBelegung([], null, 3, stichtag)).toEqual({ gesamt: 3, frei: 3, gekuendigt: 0, belegungProzent: 0 });
    expect(objektBelegung([], [], null, stichtag).gesamt).toBe(0);
  });
});
