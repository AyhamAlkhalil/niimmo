import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  getVertragsende,
  istGekuendigt,
  mietendeFelder,
  fristloseKuendigungFelder,
  raeumungsfristInTagen,
  vertragsendeDerKuendigung,
  istVergangenerTag,
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

describe("fristloseKuendigungFelder", () => {
  it("setzt Kündigungsdatum und Mietende gleich auf das Ende der Räumungsfrist", () => {
    // 27.10.2026: kuendigungsdatum stand auf dem Versandtag, der Nachtlauf beendete den Vertrag am Folgetag
    expect(fristloseKuendigungFelder(14, new Date(2026, 9, 27, 15))).toEqual({
      status: "gekuendigt",
      kuendigungsdatum: "2026-11-10",
      ende_datum: "2026-11-10",
    });
  });

  it("rechnet den Kalendertag lokal, auch kurz nach Mitternacht und über den Jahreswechsel", () => {
    expect(fristloseKuendigungFelder(14, new Date(2026, 11, 20, 0, 30)).ende_datum).toBe("2027-01-03");
    expect(fristloseKuendigungFelder(1, new Date(2026, 2, 28, 1, 0)).ende_datum).toBe("2026-03-29");
  });

  it("macht aus einer Bruchteilsfrist nie den Versandtag und begrenzt Tippfehler", () => {
    expect(fristloseKuendigungFelder(0.5, new Date(2026, 9, 1)).ende_datum).toBe("2026-10-15");
    expect(fristloseKuendigungFelder(2.9, new Date(2026, 9, 1)).ende_datum).toBe("2026-10-03");
    expect(fristloseKuendigungFelder(1e12, new Date(2026, 9, 1)).ende_datum).toBe("2026-10-15");
    expect(fristloseKuendigungFelder(14, new Date("x")).ende_datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("nimmt 14 Tage, wenn die Frist fehlt oder ungültig ist", () => {
    expect(fristloseKuendigungFelder(Number.NaN, new Date(2026, 9, 27)).ende_datum).toBe("2026-11-10");
    expect(fristloseKuendigungFelder(0, new Date(2026, 9, 27)).ende_datum).toBe("2026-11-10");
  });
});

describe("istVergangenerTag", () => {
  it("wertet den letzten Vertragstag noch nicht als vergangen", () => {
    // 27.10.2026: new Date('2026-10-31') < new Date() galt am 31.10. ab 01:00 Uhr
    expect(istVergangenerTag("2026-10-31", new Date(2026, 9, 31, 1, 30))).toBe(false);
    expect(istVergangenerTag("2026-10-31", new Date(2026, 9, 31, 23, 59))).toBe(false);
    expect(istVergangenerTag("2026-10-31", new Date(2026, 10, 1, 0, 1))).toBe(true);
  });

  it("ist für fehlende Daten false", () => {
    expect(istVergangenerTag(null)).toBe(false);
    expect(istVergangenerTag("")).toBe(false);
    // Ein ungültiges „heute“ darf keinen Vertrag beenden
    expect(istVergangenerTag("2026-10-31", new Date("x"))).toBe(false);
  });

  it("entscheidet auch beim automatischen Beenden in der Objektansicht", () => {
    // 27.10.2026: useAutoExpireContract setzte per `terminationDate > today` am letzten Tag 'beendet'
    const hook = readFileSync("src/hooks/useAutoExpireContracts.ts", "utf-8");
    expect(hook).toMatch(/if \(!istVergangenerTag\(kuendigungsdatum\)\) return;/);
    expect(hook).not.toMatch(/new Date\(kuendigungsdatum\)/);
  });
});

describe("raeumungsfristInTagen", () => {
  it("normalisiert wie das Vertragsende: abrunden, 1 bis 365, sonst 14", () => {
    expect(raeumungsfristInTagen(21)).toBe(21);
    expect(raeumungsfristInTagen(10.9)).toBe(10);
    expect(raeumungsfristInTagen(400)).toBe(14);
    expect(raeumungsfristInTagen(-3)).toBe(14);
    expect(raeumungsfristInTagen(Number.NaN)).toBe(14);
  });

  it("gibt dem Schreiben dasselbe Räumungsende wie dem Vertrag", () => {
    // 27.10.2026: Das Schreiben rechnete mit parseInt(...) || 14 und nannte bei „400“ heute + 400
    const modal = readFileSync("src/components/dashboard/MahnungErstellungModal.tsx", "utf-8");
    expect(modal).toMatch(/const raeumungsfristStr = fristloseKuendigungFelder\(parseInt\(raeumungsfristTage\)\)\.ende_datum/);
    expect(modal).not.toMatch(/parseInt\(raeumungsfristTage\) \|\| 14/);
  });
});

describe("vertragsendeDerKuendigung", () => {
  it("lässt eine fristlose Kündigung mit der Räumungsfrist enden, nicht am Kündigungstag", () => {
    // 27.10.2026: Der Nachtlauf beendete den Vertrag am Folgetag, die Nutzungsentschädigung fiel weg
    expect(vertragsendeDerKuendigung("ausserordentlich_fristlos", "2026-10-27", "2026-11-10")).toBe("2026-11-10");
    expect(vertragsendeDerKuendigung("ausserordentlich_fristlos", "2026-10-27", "")).toBe("2026-10-27");
    expect(vertragsendeDerKuendigung("ausserordentlich_fristlos", "2026-10-27", "2026-10-01")).toBe("2026-10-27");
  });

  it("nimmt bei ordentlicher Kündigung das Zum-Datum", () => {
    expect(vertragsendeDerKuendigung("ordentlich", "2027-01-31", "2027-02-15")).toBe("2027-01-31");
    expect(vertragsendeDerKuendigung("ausserordentlich_mit_frist", "2026-12-31", null)).toBe("2026-12-31");
  });

  it("wird vom Kündigungsdialog für beide Felder verwendet", () => {
    const dialog = readFileSync("src/components/dashboard/termination/TerminationDialog.tsx", "utf-8");
    expect(dialog).toMatch(/const vertragsende = vertragsendeDerKuendigung\(kuendigungstyp, kuendigungsdatum, auszugsdatum\);/);
    expect(dialog).toMatch(/kuendigungsdatum: vertragsende,[\s\S]{0,600}ende_datum: vertragsende,/);
  });
});
