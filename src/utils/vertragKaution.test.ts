import { describe, expect, it } from "vitest";
import { geaenderteKaution, kautionFeldBezeichnung, leseKautionsbetrag } from "./vertragKaution";

describe("leseKautionsbetrag", () => {
  it("liefert für -0 eine 0 und für übergroße Ziffernfolgen keinen Betrag", () => {
    // QA 27.10.2026
    expect(Object.is(leseKautionsbetrag(-0), 0)).toBe(true);
    expect(leseKautionsbetrag("9".repeat(400))).toBeUndefined();
  });

  it("liest leer als null, nicht als 0", () => {
    expect(leseKautionsbetrag(null)).toBeNull();
    expect(leseKautionsbetrag(undefined)).toBeNull();
    expect(leseKautionsbetrag("")).toBeNull();
    expect(leseKautionsbetrag("   ")).toBeNull();
  });

  it("liest „1.000“ nicht als 1 €", () => {
    // QA 27.10.2026: neueMieteAusEingabe('1.000', '10') setzte die Kaltmiete auf 1 €
    expect(leseKautionsbetrag("1.000")).toBeUndefined();
    expect(leseKautionsbetrag("12.500")).toBeUndefined();
    expect(leseKautionsbetrag("0.125")).toBe(0.125);
    expect(leseKautionsbetrag("1000.50")).toBe(1000.5);
  });

  it("lässt eine eingetragene 0 als 0 stehen", () => {
    expect(leseKautionsbetrag(0)).toBe(0);
    expect(leseKautionsbetrag("0")).toBe(0);
  });

  it("liest Beträge aus Formular und Datenbank", () => {
    expect(leseKautionsbetrag(1500)).toBe(1500);
    expect(leseKautionsbetrag("1500")).toBe(1500);
    expect(leseKautionsbetrag("1500.5")).toBe(1500.5);
    expect(leseKautionsbetrag("1500.")).toBe(1500);
    expect(leseKautionsbetrag(".5")).toBe(0.5);
    expect(leseKautionsbetrag("1500,50")).toBe(1500.5);
    expect(leseKautionsbetrag(" 900 ")).toBe(900);
  });

  it("meldet negative und unlesbare Beträge als undefined", () => {
    expect(leseKautionsbetrag(-1)).toBeUndefined();
    expect(leseKautionsbetrag("-50")).toBeUndefined();
    expect(leseKautionsbetrag("abc")).toBeUndefined();
    expect(leseKautionsbetrag(".")).toBeUndefined();
    expect(leseKautionsbetrag("1.2.3")).toBeUndefined();
    expect(leseKautionsbetrag(Number.NaN)).toBeUndefined();
    expect(leseKautionsbetrag(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(leseKautionsbetrag({})).toBeUndefined();
  });
});

describe("geaenderteKaution", () => {
  it("schreibt eine unberührte leere Kaution nicht als 0 zurück", () => {
    const { aenderungen, ungueltig } = geaenderteKaution(
      { kaution_betrag: null, kaution_ist: null },
      { kaution_betrag: null, kaution_ist: null }
    );
    expect(aenderungen).toEqual({});
    expect(ungueltig).toEqual([]);
  });

  it("erkennt ein leer gelassenes Feld als unverändert", () => {
    expect(geaenderteKaution({ kaution_betrag: null }, { kaution_betrag: "" }).aenderungen).toEqual({});
  });

  it("übernimmt nur Felder, die sich geändert haben", () => {
    const { aenderungen } = geaenderteKaution(
      { kaution_betrag: 1500, kaution_ist: 0 },
      { kaution_betrag: "1500", kaution_ist: "750.5" }
    );
    expect(aenderungen).toEqual({ kaution_ist: 750.5 });
  });

  it("unterscheidet eine eingetragene 0 von leer", () => {
    expect(geaenderteKaution({ kaution_betrag: null }, { kaution_betrag: "0" }).aenderungen).toEqual({ kaution_betrag: 0 });
    expect(geaenderteKaution({ kaution_betrag: 0 }, { kaution_betrag: "" }).aenderungen).toEqual({ kaution_betrag: null });
  });

  it("ignoriert Felder, die nicht bearbeitet wurden", () => {
    expect(geaenderteKaution({ kaution_betrag: 1500, kaution_ist: 0 }, { kaltmiete: 800 }).aenderungen).toEqual({});
  });

  it("meldet unlesbare Eingaben und übernimmt sie nicht", () => {
    const { aenderungen, ungueltig } = geaenderteKaution(
      { kaution_betrag: 1500, kaution_ist: 0 },
      { kaution_betrag: "-5", kaution_ist: "300" }
    );
    expect(ungueltig).toEqual(["kaution_betrag"]);
    expect(aenderungen).toEqual({ kaution_ist: 300 });
  });

  it("lässt einen unlesbaren Altwert überschreiben", () => {
    expect(geaenderteKaution({ kaution_betrag: -10 }, { kaution_betrag: "" }).aenderungen).toEqual({});
    expect(geaenderteKaution({ kaution_betrag: -10 }, { kaution_betrag: "100" }).aenderungen).toEqual({ kaution_betrag: 100 });
  });

  it("verträgt einen fehlenden Vertrag", () => {
    expect(geaenderteKaution(null, { kaution_betrag: "200" }).aenderungen).toEqual({ kaution_betrag: 200 });
  });
});

describe("kautionFeldBezeichnung", () => {
  it("benennt Soll und Ist", () => {
    expect(kautionFeldBezeichnung("kaution_betrag")).toBe("Kaution Soll");
    expect(kautionFeldBezeichnung("kaution_ist")).toBe("Kaution Ist");
  });
});
