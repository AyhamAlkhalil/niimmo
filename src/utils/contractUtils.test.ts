import { describe, it, expect } from "vitest";
import {
  getVertragsende,
  istGekuendigt,
  istLaufenderVertrag,
  getLaufenderVertrag,
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
