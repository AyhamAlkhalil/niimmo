import { describe, expect, it } from "vitest";
import {
  istGutschrift,
  istNochOffen,
  istZuordenbareZahlung,
  kostenbetragAusZahlung,
  offenerKostenbetrag,
  trenneKostenartenNachSumme,
} from "./nebenkostenGutschrift";

// 28.10.2026: Erstattungen der Versorger fehlten in der Betriebskostenabrechnung.

describe("istZuordenbareZahlung", () => {
  it("lässt Ausgaben wie bisher zu, Mieteingänge und Kautionen nicht", () => {
    expect(istZuordenbareZahlung({ betrag: -120, kategorie: "Nebenkosten" })).toBe(true);
    expect(istZuordenbareZahlung({ betrag: -120, kategorie: "Nichtmiete" })).toBe(true);
    expect(istZuordenbareZahlung({ betrag: -120, kategorie: null })).toBe(true);
    expect(istZuordenbareZahlung({ betrag: -120, kategorie: "Miete" })).toBe(false);
    expect(istZuordenbareZahlung({ betrag: -120, kategorie: "Rücklastschrift" })).toBe(false);
  });

  it("lässt eine Gutschrift unter Nebenkosten zu, andere Eingänge nicht", () => {
    expect(istZuordenbareZahlung({ betrag: 48.5, kategorie: "Nebenkosten" })).toBe(true);
    expect(istZuordenbareZahlung({ betrag: 48.5, kategorie: "Nichtmiete" })).toBe(false);
    expect(istZuordenbareZahlung({ betrag: 48.5, kategorie: "Betriebskostenabrechnung" })).toBe(false);
    expect(istZuordenbareZahlung({ betrag: 850, kategorie: "Miete" })).toBe(false);
    expect(istZuordenbareZahlung({ betrag: 0, kategorie: "Nebenkosten" })).toBe(false);
  });

  it("erkennt die Gutschrift", () => {
    expect(istGutschrift({ betrag: 10, kategorie: "Nebenkosten" })).toBe(true);
    expect(istGutschrift({ betrag: -10, kategorie: "Nebenkosten" })).toBe(false);
  });
});

describe("kostenbetragAusZahlung", () => {
  it("dreht das Vorzeichen wie im Bestand: Ausgabe positiv, Gutschrift negativ", () => {
    expect(kostenbetragAusZahlung(-120.4)).toBe(120.4);
    expect(kostenbetragAusZahlung(48.5)).toBe(-48.5);
    expect(Object.is(kostenbetragAusZahlung(0), 0)).toBe(true);
  });
});

describe("istNochOffen / offenerKostenbetrag", () => {
  it("rechnet Ausgaben wie bisher", () => {
    expect(istNochOffen(-120, 0)).toBe(true);
    expect(istNochOffen(-120, 100)).toBe(true);
    expect(istNochOffen(-120, 119.99)).toBe(false);
    expect(istNochOffen(-120, 120)).toBe(false);
    expect(offenerKostenbetrag(-120, 100)).toBe(20);
  });

  it("hält eine voll zugeordnete Gutschrift nicht mehr für offen", () => {
    // Vorher: verteilt (-48,50) < |betrag| (48,50) - 0,01 war immer wahr.
    expect(istNochOffen(48.5, 0)).toBe(true);
    expect(istNochOffen(48.5, -20)).toBe(true);
    expect(istNochOffen(48.5, -48.5)).toBe(false);
    expect(offenerKostenbetrag(48.5, -20)).toBe(-28.5);
  });

  it("rechnet in Cent und stolpert nicht über Gleitkommareste", () => {
    expect(istNochOffen(-0.3, 0.1 + 0.2)).toBe(false);
    expect(istNochOffen(0.3, -(0.1 + 0.2))).toBe(false);
  });
});

describe("trenneKostenartenNachSumme", () => {
  it("legt eine Kostenart mit Gutschrift netto um", () => {
    // Abschläge 600 €, Erstattung 120 € → 480 € werden umgelegt.
    const { umzulegen, negativ } = trenneKostenartenNachSumme([{ id: "entwaesserung", total: 600 - 120 }]);
    expect(umzulegen.map((k) => k.total)).toEqual([480]);
    expect(negativ).toEqual([]);
  });

  it("legt eine negative Summe nicht um und gibt sie gesondert zurück", () => {
    const { umzulegen, negativ } = trenneKostenartenNachSumme([
      { id: "wasser", total: 300 },
      { id: "entwaesserung", total: -45.2 },
      { id: "ausgeglichen", total: 0.004 },
    ]);
    expect(umzulegen.map((k) => k.id)).toEqual(["wasser"]);
    expect(negativ.map((k) => k.id)).toEqual(["entwaesserung"]);
  });
});

describe("Gutschriften im Zeitanteil und in Summen (Review 28.10.2026)", () => {
  it("rechnet den Zeitanteil einer negativen Position linear wie bei Kosten", async () => {
    const { kostenAnteilImZeitraum } = await import("./nebenkostenBerechnung");
    const abrVon = new Date(2025, 0, 1);
    const abrBis = new Date(2025, 11, 31);
    // ganz im Jahr: voller Betrag, Vorzeichen bleibt
    expect(kostenAnteilImZeitraum({ zeitraum_von: "2025-01-01", zeitraum_bis: "2025-12-31", gesamtbetrag: -120 }, abrVon, abrBis)).toBe(-120);
    // halb im Jahr (01.07.2024–30.06.2025): Kosten und Gutschrift spiegelbildlich
    const kosten = kostenAnteilImZeitraum({ zeitraum_von: "2024-07-01", zeitraum_bis: "2025-06-30", gesamtbetrag: 365 }, abrVon, abrBis);
    const gutschrift = kostenAnteilImZeitraum({ zeitraum_von: "2024-07-01", zeitraum_bis: "2025-06-30", gesamtbetrag: -365 }, abrVon, abrBis);
    expect(gutschrift).toBeCloseTo(-kosten, 10);
    expect(gutschrift).toBeLessThan(0);
  });

  it("summiert nur Kostenarten mit positiver Nettosumme und keine Positionen ohne Kostenart", async () => {
    const { summeUmzulegenderKostenarten } = await import("./nebenkostenGutschrift");
    const positionen = [
      { art: "wasser", betrag: 300 },
      { art: "entwaesserung", betrag: 100 },
      { art: "entwaesserung", betrag: -145 }, // Gutschrift überwiegt: Art fällt heraus
      { art: "grundsteuer", betrag: 200 },
      { art: "grundsteuer", betrag: -50 }, // wird verrechnet
      { art: null, betrag: 24 }, // ohne Kostenart: nicht umgelegt
    ];
    expect(summeUmzulegenderKostenarten(positionen, (p) => p.betrag, (p) => p.art)).toBe(450);
  });
});
