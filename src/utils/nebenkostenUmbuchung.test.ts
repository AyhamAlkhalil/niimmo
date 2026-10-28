import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  UmbuchungGesperrtFehler,
  erlaubteKategorienMitKostenpositionen,
  loeschSperrgrund,
  umbuchungSperrMeldung,
  umbuchungSperrgrund,
} from "./nebenkostenUmbuchung";

// 28.10.2026: Umbuchen einer schon verteilten Zahlung führte zu doppelter Umlage.

const amObjektA = [{ immobilie_id: "objekt-a" }, { immobilie_id: "objekt-a" }];
const AUSGABE = -120;
const GUTSCHRIFT = 48.5;

describe("umbuchungSperrgrund", () => {
  it("lässt eine Zahlung ohne Kostenpositionen frei umbuchen", () => {
    expect(umbuchungSperrgrund([], { immobilieId: "objekt-b" }, AUSGABE)).toBeNull();
    expect(umbuchungSperrgrund([], { immobilieId: null, kategorie: "Miete" }, AUSGABE)).toBeNull();
    expect(umbuchungSperrgrund([], { kategorie: "Nichtmiete", betrag: 10 }, GUTSCHRIFT)).toBeNull();
  });

  it("sperrt den Wechsel auf ein anderes Objekt", () => {
    const grund = umbuchungSperrgrund(amObjektA, { immobilieId: "objekt-b" }, AUSGABE);
    expect(grund).toContain("2 Kostenpositionen");
    expect(grund).toContain("Objektbezug");
    expect(grund?.startsWith("Die Zahlung ist")).toBe(true);
  });

  it("sperrt das Aufheben des Objektbezugs", () => {
    expect(umbuchungSperrgrund(amObjektA, { immobilieId: null }, AUSGABE)).toContain("Objektbezug");
  });

  it("lässt dasselbe Objekt noch einmal zu", () => {
    expect(umbuchungSperrgrund(amObjektA, { immobilieId: "objekt-a" }, AUSGABE)).toBeNull();
  });

  it("sperrt den Wechsel auf eine Kategorie ohne Betriebskosten", () => {
    for (const kategorie of ["Miete", "Ignorieren", "Mietkaution", "Rücklastschrift", "Betriebskostenabrechnung", null]) {
      expect(umbuchungSperrgrund(amObjektA, { kategorie }, AUSGABE)).toContain("Kategorie");
    }
  });

  it("lässt bei einer Ausgabe den Wechsel zwischen Nebenkosten und Nichtmiete zu", () => {
    expect(umbuchungSperrgrund(amObjektA, { kategorie: "Nichtmiete", immobilieId: "objekt-a" }, AUSGABE)).toBeNull();
    expect(umbuchungSperrgrund(amObjektA, { kategorie: "Nebenkosten" }, AUSGABE)).toBeNull();
  });

  it("lässt eine Gutschrift mit Kostenpositionen nur unter Nebenkosten (Review 28.10.2026)", () => {
    // Unter Nichtmiete bliebe die negative Position in der Abrechnung, die Zahlung
    // verschwände aber aus Schritt 1 und ließe sich nicht mehr entkoppeln.
    const grund = umbuchungSperrgrund(amObjektA, { kategorie: "Nichtmiete" }, GUTSCHRIFT);
    expect(grund).toContain("Kategorie „Nichtmiete“");
    expect(grund).toContain("Gutschrift bleibt unter Nebenkosten");
    expect(umbuchungSperrgrund(amObjektA, { kategorie: "Nebenkosten" }, GUTSCHRIFT)).toBeNull();
    expect(erlaubteKategorienMitKostenpositionen(GUTSCHRIFT)).toEqual(["Nebenkosten"]);
    expect(erlaubteKategorienMitKostenpositionen(AUSGABE)).toEqual(["Nebenkosten", "Nichtmiete"]);
  });

  it("sperrt eine Betragsänderung, lässt denselben Betrag zu", () => {
    expect(umbuchungSperrgrund(amObjektA, { betrag: -100 }, AUSGABE)).toContain("Betrag");
    expect(umbuchungSperrgrund(amObjektA, { betrag: 120 }, AUSGABE)).toContain("Betrag");
    expect(umbuchungSperrgrund(amObjektA, { betrag: AUSGABE }, AUSGABE)).toBeNull();
  });

  it("sperrt „Als Nichtmiete“, weil es den Objektbezug entfernt", () => {
    expect(
      umbuchungSperrgrund([{ immobilie_id: "objekt-a" }], { kategorie: "Nichtmiete", immobilieId: null }, AUSGABE)
    ).toContain("einer Kostenposition");
  });
});

describe("umbuchungSperrMeldung", () => {
  it("gibt die eigene Sperre und die Trigger-Ablehnung fachlich weiter", () => {
    expect(umbuchungSperrMeldung(new UmbuchungGesperrtFehler("Die Zahlung ist gesperrt."))).toBe("Die Zahlung ist gesperrt.");
    expect(umbuchungSperrMeldung({ code: "P0001", message: "Die Zahlung ist einer Kostenposition zugeordnet." })).toBe(
      "Die Zahlung ist einer Kostenposition zugeordnet."
    );
  });

  it("verschweigt technische Fehler", () => {
    expect(umbuchungSperrMeldung({ code: "42501", message: "permission denied for table zahlungen" })).toBeNull();
    expect(umbuchungSperrMeldung({ code: "P0001", message: "interner Fehler" })).toBeNull();
    expect(umbuchungSperrMeldung(new Error("Netzwerk"))).toBeNull();
    expect(umbuchungSperrMeldung(null)).toBeNull();
  });
});

describe("loeschSperrgrund", () => {
  // 28.10.2026: Aufteilen löschte die Originalzahlung, die Umlage blieb ohne Zahlung stehen
  it("lässt Zahlungen ohne Kostenpositionen löschen", () => {
    expect(loeschSperrgrund(0)).toBeNull();
    expect(loeschSperrgrund(Number.NaN)).toBeNull();
  });

  it("sperrt mit derselben Meldung wie der Datenbank-Trigger", () => {
    const meldung = loeschSperrgrund(1);
    expect(meldung).toMatch(/^Die Zahlung ist in der Betriebskostenabrechnung einer Kostenposition zugeordnet\. Sie lässt sich deshalb weder löschen noch aufteilen\./);
    expect(loeschSperrgrund(3)).toContain("3 Kostenpositionen");
    // Der Meldungsanfang ist das Erkennungszeichen für umbuchungSperrMeldung
    expect(umbuchungSperrMeldung({ code: "P0001", message: meldung })).toBe(meldung);
  });

  it("steht wortgleich im Trigger der Migration", () => {
    const sql = readFileSync("supabase/migrations/20261028120100_zahlung_umbuchung_sperre.sql", "utf-8");
    expect(sql).toContain("' Sie lässt sich deshalb weder löschen noch aufteilen. '");
    expect(sql).toMatch(/create trigger zahlung_loeschen_pruefen\s+before delete on public\.zahlungen/);
  });
});
