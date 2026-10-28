import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  geaenderteKaution,
  kautionAufteilung,
  kautionFeldBezeichnung,
  kautionIstVorschau,
  leseKautionsbetrag,
} from "./vertragKaution";

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
      { kaution_betrag: null, kaution_ist_grundwert: null },
      { kaution_betrag: null, kaution_ist_grundwert: null }
    );
    expect(aenderungen).toEqual({});
    expect(ungueltig).toEqual([]);
  });

  it("erkennt ein leer gelassenes Feld als unverändert", () => {
    expect(geaenderteKaution({ kaution_betrag: null }, { kaution_betrag: "" }).aenderungen).toEqual({});
  });

  it("übernimmt nur Felder, die sich geändert haben", () => {
    const { aenderungen } = geaenderteKaution(
      { kaution_betrag: 1500, kaution_ist_grundwert: 0 },
      { kaution_betrag: "1500", kaution_ist_grundwert: "750.5" }
    );
    expect(aenderungen).toEqual({ kaution_ist_grundwert: 750.5 });
  });

  it("unterscheidet eine eingetragene 0 von leer", () => {
    expect(geaenderteKaution({ kaution_betrag: null }, { kaution_betrag: "0" }).aenderungen).toEqual({ kaution_betrag: 0 });
    expect(geaenderteKaution({ kaution_betrag: 0 }, { kaution_betrag: "" }).aenderungen).toEqual({ kaution_betrag: null });
  });

  it("ignoriert Felder, die nicht bearbeitet wurden", () => {
    expect(geaenderteKaution({ kaution_betrag: 1500, kaution_ist_grundwert: 0 }, { kaltmiete: 800 }).aenderungen).toEqual({});
  });

  it("meldet unlesbare Eingaben und übernimmt sie nicht", () => {
    const { aenderungen, ungueltig } = geaenderteKaution(
      { kaution_betrag: 1500, kaution_ist_grundwert: 0 },
      { kaution_betrag: "-5", kaution_ist_grundwert: "300" }
    );
    expect(ungueltig).toEqual(["kaution_betrag"]);
    expect(aenderungen).toEqual({ kaution_ist_grundwert: 300 });
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
    expect(kautionFeldBezeichnung("kaution_ist_grundwert")).toBe("Kaution Ist (von Hand)");
  });
});

// 28.10.2026: Das Ist rechnet die Datenbank (Grundwert + Kautionsbuchungen); von Hand nur der Grundwert
describe("geaenderteKaution schreibt nie das berechnete Ist", () => {
  it("ignoriert ein mitgeschicktes kaution_ist", () => {
    const geladen: Record<string, unknown> = { kaution_ist: 1500 };
    expect(geaenderteKaution(geladen, { kaution_ist: "3000" }).aenderungen).toEqual({});
  });
});

describe("kautionAufteilung", () => {
  it("trennt Buchungen und Anteil von Hand", () => {
    expect(kautionAufteilung({ kaution_ist: "1849.46", kaution_ist_grundwert: "1349.46" })).toEqual({
      ist: 1849.46,
      vonHand: 1349.46,
      ausBuchungen: 500,
    });
  });

  it("zeigt eine Rückzahlung als negative Buchungssumme", () => {
    expect(kautionAufteilung({ kaution_ist: 0, kaution_ist_grundwert: 3600 })).toEqual({ ist: 0, vonHand: 3600, ausBuchungen: -3600 });
  });

  it("behandelt nicht erfasste Werte als null", () => {
    expect(kautionAufteilung({ kaution_ist: null, kaution_ist_grundwert: null })).toEqual({ ist: null, vonHand: null, ausBuchungen: 0 });
    expect(kautionAufteilung(null)).toEqual({ ist: null, vonHand: null, ausBuchungen: 0 });
  });

  it("rechnet ohne die neue Spalte wie bisher: alles von Hand", () => {
    expect(kautionAufteilung({ kaution_ist: 900 })).toEqual({ ist: 900, vonHand: 900, ausBuchungen: 0 });
  });

  it("rundet auf Cent", () => {
    expect(kautionAufteilung({ kaution_ist: 0.3, kaution_ist_grundwert: 0.1 }).ausBuchungen).toBe(0.2);
  });
});

describe("kautionIstVorschau", () => {
  const aufteilung = { ist: 1849.46, vonHand: 1349.46, ausBuchungen: 500 };

  it("rechnet die Eingabe von Hand auf die Buchungen", () => {
    expect(kautionIstVorschau(aufteilung, "1000")).toBe(1500);
    expect(kautionIstVorschau(aufteilung, "0")).toBe(500);
    expect(kautionIstVorschau(aufteilung, "")).toBe(500);
  });

  it("lässt die Vorschau bei unlesbarer Eingabe stehen", () => {
    expect(kautionIstVorschau(aufteilung, "1.000")).toBe(1849.46);
    expect(kautionIstVorschau(aufteilung, "-5")).toBe(1849.46);
  });

  it("ist ohne Buchungen und ohne Eingabe nicht erfasst", () => {
    expect(kautionIstVorschau({ ist: 200, vonHand: 200, ausBuchungen: 0 }, "")).toBeNull();
  });
});

describe("Kautionsbearbeitung schreibt nur den Anteil von Hand", () => {
  const hook = readFileSync("src/hooks/useMietvertragMutations.ts", "utf-8");
  const abschnitt = readFileSync("src/components/dashboard/mietvertrag-details/MietvertragKautionSection.tsx", "utf-8");

  it("setzt kaution_ist nirgends mehr von Hand", () => {
    expect(hook).toContain("{ kaution_ist_grundwert: numericValue }");
    expect(hook).not.toMatch(/\{ kaution_ist: numericValue \}/);
    expect(hook).toMatch(/kaution_ist_grundwert: \(?vertrag(?: as [^)]*\))?\?\.kaution_ist_grundwert \?\? null/);
    expect(abschnitt).not.toContain("'kaution_ist',");
    expect(abschnitt).toContain("kautionAufteilung(vertrag)");
  });
});
