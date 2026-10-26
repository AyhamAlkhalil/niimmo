import { describe, expect, it } from "vitest";
import {
  VERTRAG_ZAEHLER_FELDER,
  geaenderteZaehlernummern,
  geaenderteZaehlerstaende,
  istVertragZaehlerFeld,
  leseZaehlerstand,
  zaehlerFeldBezeichnung,
  zaehlerstandHistorieDatum,
  zaehlerstandHistorienZeilen,
} from "./vertragZaehlerstaende";

const HEUTE = "2026-10-23";

const leererVertrag = {
  kaltwasser_einzug: null,
  warmwasser_einzug: null,
  strom_einzug: null,
  gas_einzug: null,
  kaltwasser_auszug: null,
  warmwasser_auszug: null,
  strom_auszug: null,
  gas_auszug: null,
};

const einheit = {
  id: "einheit-1",
  kaltwasser_zaehler: "KW-1",
  warmwasser_zaehler: "",
  strom_zaehler: "ST-9",
  gas_zaehler: null,
};

describe("leseZaehlerstand", () => {
  it("liest leer als null, nicht als 0", () => {
    expect(leseZaehlerstand(null)).toBeNull();
    expect(leseZaehlerstand(undefined)).toBeNull();
    expect(leseZaehlerstand("")).toBeNull();
    expect(leseZaehlerstand("   ")).toBeNull();
  });

  it("lässt eine eingetragene 0 als 0 stehen", () => {
    expect(leseZaehlerstand(0)).toBe(0);
    expect(leseZaehlerstand("0")).toBe(0);
  });

  it("liest Zahlen und normalisierte Eingaben", () => {
    expect(leseZaehlerstand(128.456)).toBe(128.456);
    expect(leseZaehlerstand("128.456")).toBe(128.456);
    expect(leseZaehlerstand("128,456")).toBe(128.456);
    expect(leseZaehlerstand("128.")).toBe(128);
  });

  it("meldet unlesbare Eingaben als undefined statt sie abzuschneiden", () => {
    expect(leseZaehlerstand("abc")).toBeUndefined();
    expect(leseZaehlerstand("12,34,5")).toBeUndefined();
    expect(leseZaehlerstand("-")).toBeUndefined();
    expect(leseZaehlerstand(".")).toBeUndefined();
    expect(leseZaehlerstand(Number.NaN)).toBeUndefined();
    expect(leseZaehlerstand({})).toBeUndefined();
  });
});

describe("istVertragZaehlerFeld", () => {
  it("kennt genau die acht Felder", () => {
    expect(VERTRAG_ZAEHLER_FELDER).toHaveLength(8);
    expect(istVertragZaehlerFeld("gas_auszug")).toBe(true);
    expect(istVertragZaehlerFeld("kaltmiete")).toBe(false);
    expect(istVertragZaehlerFeld("strom_zaehler")).toBe(false);
  });

  it("benennt die Felder lesbar", () => {
    expect(zaehlerFeldBezeichnung("strom_einzug")).toBe("Strom bei Einzug");
    expect(zaehlerFeldBezeichnung("warmwasser_auszug")).toBe("Warmwasser bei Auszug");
  });
});

describe("geaenderteZaehlerstaende", () => {
  it("meldet nichts, wenn die vorbelegten Werte unverändert bleiben (Befund: nur Kaltmiete geändert)", () => {
    const geladen = { ...leererVertrag, strom_einzug: 4711 };
    // So belegt der Bearbeitungsmodus seit 23.10.2026 vor: die geladenen Werte, null bleibt null
    const bearbeitet = { ...geladen, kaltmiete: 650 };
    expect(geaenderteZaehlerstaende(geladen, bearbeitet)).toEqual({ aenderungen: {}, ungueltig: [] });
  });

  it("wertet einen unveränderten Text gleich der geladenen Zahl als unverändert", () => {
    const geladen = { ...leererVertrag, kaltwasser_einzug: 128.456 };
    expect(geaenderteZaehlerstaende(geladen, { kaltwasser_einzug: "128.456" }).aenderungen).toEqual({});
  });

  it("schreibt ein geleertes Feld als null und eine neue 0 als 0", () => {
    const geladen = { ...leererVertrag, strom_einzug: 4711 };
    const { aenderungen } = geaenderteZaehlerstaende(geladen, { strom_einzug: "", gas_einzug: "0" });
    expect(aenderungen).toEqual({ strom_einzug: null, gas_einzug: 0 });
  });

  it("macht aus einem leeren Feld keine 0", () => {
    const { aenderungen } = geaenderteZaehlerstaende(leererVertrag, { kaltwasser_auszug: "" });
    expect(aenderungen).toEqual({});
  });

  it("übergeht Felder, die nicht bearbeitet wurden", () => {
    const geladen = { ...leererVertrag, strom_einzug: 4711 };
    const { aenderungen } = geaenderteZaehlerstaende(geladen, { gas_auszug: 12 });
    expect(aenderungen).toEqual({ gas_auszug: 12 });
  });

  it("sammelt unlesbare Eingaben getrennt und schreibt sie nicht", () => {
    const ergebnis = geaenderteZaehlerstaende(leererVertrag, { strom_einzug: "12,34,5", gas_einzug: 3 });
    expect(ergebnis.ungueltig).toEqual(["strom_einzug"]);
    expect(ergebnis.aenderungen).toEqual({ gas_einzug: 3 });
  });

  it("kommt ohne geladenen Vertrag aus", () => {
    expect(geaenderteZaehlerstaende(null, { strom_einzug: 5 }).aenderungen).toEqual({ strom_einzug: 5 });
  });
});

describe("zaehlerstandHistorieDatum", () => {
  const vertrag = { start_datum: "2024-03-01", ende_datum: "2026-09-30", kuendigungsdatum: "2026-08-31" };

  it("datiert den Einzug auf den Vertragsbeginn", () => {
    expect(zaehlerstandHistorieDatum("strom_einzug", vertrag, HEUTE)).toBe("2024-03-01");
  });

  it("datiert den Auszug auf das Vertragsende nach getVertragsende()", () => {
    // ende_datum ist führend, nicht kuendigungsdatum
    expect(zaehlerstandHistorieDatum("gas_auszug", vertrag, HEUTE)).toBe("2026-09-30");
    expect(zaehlerstandHistorieDatum("gas_auszug", { ...vertrag, ende_datum: null }, HEUTE)).toBe("2026-08-31");
  });

  it("nimmt heute, wenn das Datum fehlt", () => {
    expect(zaehlerstandHistorieDatum("strom_einzug", { start_datum: null }, HEUTE)).toBe(HEUTE);
    expect(zaehlerstandHistorieDatum("strom_auszug", { start_datum: "2024-03-01" }, HEUTE)).toBe(HEUTE);
    expect(zaehlerstandHistorieDatum("strom_auszug", null, HEUTE)).toBe(HEUTE);
  });
});

describe("zaehlerstandHistorienZeilen", () => {
  const vertrag = { start_datum: "2024-03-01", ende_datum: "2026-09-30", kuendigungsdatum: null };

  it("legt je geändertem Feld mit Wert eine Zeile an", () => {
    const zeilen = zaehlerstandHistorienZeilen(
      { kaltwasser_einzug: 12.5, strom_auszug: 0 },
      vertrag,
      einheit,
      HEUTE
    );
    expect(zeilen).toEqual([
      { einheit_id: "einheit-1", zaehler_typ: "kaltwasser", zaehler_nummer: "KW-1", stand: 12.5, datum: "2024-03-01", quelle: "einzug", mietvertrag_id: null },
      { einheit_id: "einheit-1", zaehler_typ: "strom", zaehler_nummer: "ST-9", stand: 0, datum: "2026-09-30", quelle: "auszug", mietvertrag_id: null },
    ]);
  });

  it("legt für ein geleertes Feld keine Zeile an", () => {
    expect(zaehlerstandHistorienZeilen({ gas_einzug: null }, vertrag, einheit, HEUTE)).toEqual([]);
  });

  it("legt ohne Änderungen keine Zeile an", () => {
    expect(zaehlerstandHistorienZeilen({}, vertrag, einheit, HEUTE)).toEqual([]);
  });

  it("trägt eine leere Zählernummer als null ein", () => {
    const [zeile] = zaehlerstandHistorienZeilen({ warmwasser_einzug: 3 }, vertrag, einheit, HEUTE);
    expect(zeile.zaehler_nummer).toBeNull();
    const [ohneNummer] = zaehlerstandHistorienZeilen({ gas_einzug: 3 }, vertrag, einheit, HEUTE);
    expect(ohneNummer.zaehler_nummer).toBeNull();
  });

  it("datiert nach dem gespeicherten Vertragsstand, wenn der Beginn im selben Zug geändert wird", () => {
    const [zeile] = zaehlerstandHistorienZeilen(
      { strom_einzug: 100 },
      { ...vertrag, start_datum: "2024-04-01" },
      einheit,
      HEUTE
    );
    expect(zeile.datum).toBe("2024-04-01");
  });
});

describe("zaehlerstandHistorienZeilen mit Vertrag", () => {
  it("trägt den Vertrag mit, damit die Übergabe den eigenen Stand erkennt", () => {
    const zeilen = zaehlerstandHistorienZeilen({ strom_einzug: 100 }, { start_datum: "2024-03-01", ende_datum: null, kuendigungsdatum: null }, { id: "e1" }, "2026-10-24", "v1");
    expect(zeilen[0].mietvertrag_id).toBe("v1");
  });
});

describe("geaenderteZaehlernummern", () => {
  it("schreibt unberührte Nummern nicht zurück, eine fehlende nicht als ''", () => {
    expect(
      geaenderteZaehlernummern(einheit, {
        kaltwasser_zaehler: "KW-1",
        warmwasser_zaehler: "",
        strom_zaehler: "ST-9",
        gas_zaehler: "",
      })
    ).toEqual({});
  });

  it("übernimmt nur geänderte Nummern, getrimmt", () => {
    expect(geaenderteZaehlernummern(einheit, { kaltwasser_zaehler: " KW-2 ", strom_zaehler: "ST-9 " })).toEqual({ kaltwasser_zaehler: "KW-2" });
  });

  it("macht eine geleerte Nummer zu null", () => {
    expect(geaenderteZaehlernummern(einheit, { strom_zaehler: "   " })).toEqual({ strom_zaehler: null });
    expect(geaenderteZaehlernummern(einheit, { strom_zaehler: null })).toEqual({ strom_zaehler: null });
  });

  it("ignoriert Felder, die nicht bearbeitet wurden", () => {
    expect(geaenderteZaehlernummern(einheit, { qm: 50 })).toEqual({});
    expect(geaenderteZaehlernummern(null, { gas_zaehler: "G-1" })).toEqual({ gas_zaehler: "G-1" });
    expect(geaenderteZaehlernummern(einheit, { strom_zaehler: {} })).toEqual({});
  });

  it("gibt beim Zählertausch der Historienzeile die neue Nummer", () => {
    const nummern = geaenderteZaehlernummern(einheit, { kaltwasser_zaehler: "KW-NEU" });
    const [zeile] = zaehlerstandHistorienZeilen({ kaltwasser_einzug: 1.5 }, { start_datum: "2026-10-01" }, { ...einheit, ...nummern }, HEUTE);
    expect(zeile.zaehler_nummer).toBe("KW-NEU");
  });
});
