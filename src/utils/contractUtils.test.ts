import { describe, it, expect } from "vitest";
import {
  getVertragsende,
  istGekuendigt,
  mietendeFelder,
  istLaufenderVertrag,
  getLaufenderVertrag,
  summiereLaufendeMieten,
} from "./contractUtils";

const STICHTAG = new Date(2026, 8, 3); // 03.09.2026

describe("getVertragsende", () => {
  it("nimmt ende_datum als fuehrende Quelle", () => {
    expect(getVertragsende({ ende_datum: "2026-09-30", kuendigungsdatum: "2026-11-30" }))
      .toBe("2026-09-30");
  });

  it("faellt auf kuendigungsdatum zurueck, wenn ende_datum fehlt", () => {
    // Altbestand und Importe koennen weiterhin ohne ende_datum ankommen.
    expect(getVertragsende({ ende_datum: null, kuendigungsdatum: "2026-09-30" }))
      .toBe("2026-09-30");
  });

  it("liefert null fuer unbefristete Vertraege", () => {
    expect(getVertragsende({ ende_datum: null, kuendigungsdatum: null })).toBeNull();
    expect(getVertragsende(null)).toBeNull();
  });
});

describe("istGekuendigt", () => {
  it("unterscheidet Kuendigung von blosser Befristung", () => {
    expect(istGekuendigt({ kuendigungsdatum: "2026-09-30" })).toBe(true);
    // Befristet bis 2030, aber niemand hat gekuendigt.
    expect(istGekuendigt({ kuendigungsdatum: null })).toBe(false);
  });
});

describe("istLaufenderVertrag", () => {
  it("zaehlt aktive und gekuendigte Vertraege, die heute laufen", () => {
    expect(istLaufenderVertrag(
      { status: "aktiv", start_datum: "2024-01-01", ende_datum: null }, STICHTAG)).toBe(true);
    expect(istLaufenderVertrag(
      { status: "gekuendigt", start_datum: "2023-02-01", ende_datum: "2026-11-30" }, STICHTAG)).toBe(true);
  });

  it("schliesst beendete Vertraege aus", () => {
    expect(istLaufenderVertrag(
      { status: "beendet", start_datum: "2020-01-01", ende_datum: "2025-06-30" }, STICHTAG)).toBe(false);
  });

  it("schliesst noch nicht begonnene Vertraege aus", () => {
    // Objekt 2 Celle, Reihenhaus 18a: Status aktiv, Beginn erst 15.10.2026.
    // Ohne diese Pruefung standen 1.400 EUR Kaltmiete als heutiger Ertrag in
    // der Mietaufstellung, das Dashboard wies sie nicht aus.
    expect(istLaufenderVertrag(
      { status: "aktiv", start_datum: "2026-10-15", ende_datum: null }, STICHTAG)).toBe(false);
  });

  it("schliesst abgelaufene Vertraege aus, auch wenn der Status noch aktiv ist", () => {
    expect(istLaufenderVertrag(
      { status: "aktiv", start_datum: "2020-01-01", ende_datum: "2026-08-31" }, STICHTAG)).toBe(false);
  });

  it("laesst den letzten Tag des Mietverhaeltnisses noch gelten", () => {
    expect(istLaufenderVertrag(
      { status: "gekuendigt", start_datum: "2020-01-01", ende_datum: "2026-09-03" }, STICHTAG)).toBe(true);
  });

  it("beruecksichtigt kuendigungsdatum, wenn ende_datum fehlt", () => {
    expect(istLaufenderVertrag(
      { status: "gekuendigt", start_datum: "2020-01-01", ende_datum: null, kuendigungsdatum: "2025-12-31" },
      STICHTAG)).toBe(false);
  });
});

describe("getLaufenderVertrag", () => {
  it("liefert null statt eines beendeten Vertrags", () => {
    // getCurrentContract faellt hier auf den beendeten Vertrag zurueck --
    // fuer Mietsummen ist die Einheit aber Leerstand.
    const contracts = [{ status: "beendet", start_datum: "2020-01-01", ende_datum: "2025-06-30" }];
    expect(getLaufenderVertrag(contracts, STICHTAG)).toBeNull();
  });

  it("waehlt aus Vor- und Nachmieter den heute laufenden", () => {
    const contracts = [
      { id: "alt", status: "beendet", start_datum: "2019-01-01", ende_datum: "2025-12-31" },
      { id: "neu", status: "aktiv", start_datum: "2026-01-01", ende_datum: null },
    ];
    expect(getLaufenderVertrag(contracts, STICHTAG)?.id).toBe("neu");
  });

  it("zaehlt bei doppelt erfassten Vertraegen nur einen", () => {
    const contracts = [
      { id: "a", status: "aktiv", start_datum: "2024-01-01", ende_datum: null },
      { id: "b", status: "aktiv", start_datum: "2025-06-01", ende_datum: null },
    ];
    expect(getLaufenderVertrag(contracts, STICHTAG)?.id).toBe("b");
  });

  it("gibt null bei leerer Einheit", () => {
    expect(getLaufenderVertrag([], STICHTAG)).toBeNull();
    expect(getLaufenderVertrag(undefined, STICHTAG)).toBeNull();
  });
});

describe("mietendeFelder", () => {
  it("befristeter Vertrag: nur ende_datum, auch leer", () => {
    expect(mietendeFelder("2027-01-31", { kuendigungsdatum: null })).toEqual({ ende_datum: "2027-01-31" });
    expect(mietendeFelder(null, {})).toEqual({ ende_datum: null });
  });

  it("gekündigter Vertrag: kuendigungsdatum wird mitgeführt", () => {
    expect(mietendeFelder("2026-10-31", { kuendigungsdatum: "2026-11-30" }))
      .toEqual({ ende_datum: "2026-10-31", kuendigungsdatum: "2026-10-31" });
  });

  it("gekündigter Vertrag: Mietende darf nicht leer werden", () => {
    expect(mietendeFelder(null, { kuendigungsdatum: "2026-11-30" })).toHaveProperty("fehler");
  });
});

describe("summiereLaufendeMieten", () => {
  // Nachgebildet nach Objekt 5 am 02.10.2026 (Kundenmeldung): Wohnung und Stellplatz
  // sind gekuendigt zum 31.10., die Nachmieter ziehen am 01.11. ein.
  const bestand = [
    { einheit_id: "e01", status: "aktiv", start_datum: "2021-01-01", ende_datum: null, kaltmiete: 550, betriebskosten: 100 },
    { einheit_id: "e06", status: "aktiv", start_datum: "2026-10-01", ende_datum: null, kaltmiete: 1150, betriebskosten: 180 },
    { einheit_id: "e07", status: "gekuendigt", start_datum: "2025-06-01", ende_datum: "2026-10-31", kuendigungsdatum: "2026-11-30", kaltmiete: 1200, betriebskosten: 200 },
    { einheit_id: "e07", status: "aktiv", start_datum: "2026-11-01", ende_datum: null, kaltmiete: 1260, betriebskosten: 200 },
    { einheit_id: "e10", status: "gekuendigt", start_datum: "2025-06-01", ende_datum: "2026-10-31", kuendigungsdatum: "2026-11-30", kaltmiete: 50, betriebskosten: 0 },
    { einheit_id: "e10", status: "aktiv", start_datum: "2026-11-01", ende_datum: null, kaltmiete: 50, betriebskosten: 0 },
  ];

  it("zaehlt bei einem Mieterwechsel nur den Vormieter, solange er noch wohnt", () => {
    // Vorher: 4.260 EUR Kaltmiete, weil Vor- und Nachmieter gleichzeitig zaehlten.
    expect(summiereLaufendeMieten(bestand, new Date(2026, 9, 2))).toEqual({ kaltmiete: 2950, betriebskosten: 480 });
  });

  it("zaehlt nach dem Auszug nur den Nachmieter", () => {
    expect(summiereLaufendeMieten(bestand, new Date(2026, 10, 15))).toEqual({ kaltmiete: 3010, betriebskosten: 480 });
  });

  it("laesst noch nicht begonnene und beendete Vertraege weg", () => {
    const vertraege = [
      { einheit_id: "a", status: "aktiv", start_datum: "2026-12-01", ende_datum: null, kaltmiete: 900, betriebskosten: 90 },
      { einheit_id: "b", status: "beendet", start_datum: "2020-01-01", ende_datum: "2025-12-31", kaltmiete: 700, betriebskosten: 70 },
    ];
    expect(summiereLaufendeMieten(vertraege, STICHTAG)).toEqual({ kaltmiete: 0, betriebskosten: 0 });
  });

  it("zaehlt Vertraege ohne Einheit einzeln", () => {
    const vertraege = [
      { einheit_id: null, status: "aktiv", start_datum: "2024-01-01", ende_datum: null, kaltmiete: 400, betriebskosten: 40 },
      { einheit_id: null, status: "aktiv", start_datum: "2024-01-01", ende_datum: null, kaltmiete: 300, betriebskosten: 30 },
    ];
    expect(summiereLaufendeMieten(vertraege, STICHTAG)).toEqual({ kaltmiete: 700, betriebskosten: 70 });
  });

  it("liefert 0 ohne Vertraege", () => {
    expect(summiereLaufendeMieten(undefined)).toEqual({ kaltmiete: 0, betriebskosten: 0 });
  });
});
