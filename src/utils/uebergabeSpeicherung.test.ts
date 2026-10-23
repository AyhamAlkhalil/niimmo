import { describe, it, expect } from "vitest";
import { STORAGE_PFAD } from "./storagePfad";
import {
  uebergabePdfPfad,
  vertragsStaende,
  historieEintraege,
  historieAufteilen,
  rueckbauLesen,
  aktuelleStaende,
  fehlendeDokumente,
  dateienHochladen,
  LEERE_ZAEHLER,
} from "./uebergabeSpeicherung";

const VERTRAG = "faa7c50f-dfe1-4900-b8cd-000000000001";

describe("uebergabePdfPfad", () => {
  it("enthält nur Zeichen, die Supabase Storage annimmt", () => {
    const pfad = uebergabePdfPfad(VERTRAG, true, new Date(2026, 9, 16, 16, 29, 3));
    expect(pfad).toBe(`uebergabeprotokolle/${VERTRAG}/Uebergabeprotokoll_Einzug_2026-10-16_162903.pdf`);
    expect(STORAGE_PFAD.test(pfad)).toBe(true);
  });

  it("unterscheidet zwei Speicherläufe am selben Tag", () => {
    const a = uebergabePdfPfad(VERTRAG, false, new Date(2026, 9, 16, 9, 0, 0));
    const b = uebergabePdfPfad(VERTRAG, false, new Date(2026, 9, 16, 9, 0, 1));
    expect(a).not.toBe(b);
    expect(a).toContain("_Auszug_");
  });

});

describe("vertragsStaende", () => {
  it("schreibt nur erfasste Werte — ein leeres Feld überschreibt keinen vorhandenen Stand", () => {
    expect(vertragsStaende({ ...LEERE_ZAEHLER, strom: "1.234,5" }, true)).toEqual({ strom_einzug: 1234.5 });
  });

  it("ordnet Kaltwasser und Auszug den richtigen Spalten zu", () => {
    expect(vertragsStaende({ strom: "1", gas: "2", wasser: "3,5", warmwasser: "4" }, false)).toEqual({
      strom_auszug: 1,
      gas_auszug: 2,
      kaltwasser_auszug: 3.5,
      warmwasser_auszug: 4,
    });
  });

  it("liefert für ein leeres Formular nichts", () => {
    expect(vertragsStaende(LEERE_ZAEHLER, true)).toEqual({});
  });
});

describe("historieEintraege", () => {
  it("legt je erfasstem Zähler einen Eintrag an, Wasser als kaltwasser", () => {
    const eintraege = historieEintraege("e1", "i1", { ...LEERE_ZAEHLER, wasser: "12,5", gas: "0" }, "2026-10-16", "Übergabe (Einzug)", "u1");
    expect(eintraege).toEqual([
      { einheit_id: "e1", immobilie_id: "i1", zaehler_typ: "gas", stand: 0, datum: "2026-10-16", quelle: "Übergabe (Einzug)", erstellt_von: "u1" },
      { einheit_id: "e1", immobilie_id: "i1", zaehler_typ: "kaltwasser", stand: 12.5, datum: "2026-10-16", quelle: "Übergabe (Einzug)", erstellt_von: "u1" },
    ]);
  });
});

describe("historieEintraege mit Herkunft", () => {
  it("trägt Vertrag, Protokoll, Zählernummer, Foto und Erfassung ein", () => {
    const eintraege = historieEintraege(
      "e1",
      "i1",
      { ...LEERE_ZAEHLER, strom: "4.711,5", wasser: "12,5" },
      "2026-10-22",
      "Übergabe (Auszug)",
      "u1",
      {
        mietvertragId: "v1",
        protokollPfad: "uebergabeprotokolle/v1/Uebergabeprotokoll_Auszug_2026-10-22_101010.pdf",
        je: {
          strom: { nummer: " 1 ABC00 0000 0001 ", foto: "zaehlerfotos/v1/strom_auszug_1_0.jpg", erfassung: "foto", erkannt: 4711.5 },
          wasser: { nummer: "", foto: null },
        },
      }
    );
    expect(eintraege).toEqual([
      {
        einheit_id: "e1", immobilie_id: "i1", zaehler_typ: "strom", stand: 4711.5, datum: "2026-10-22", quelle: "Übergabe (Auszug)", erstellt_von: "u1",
        mietvertrag_id: "v1", protokoll_pfad: "uebergabeprotokolle/v1/Uebergabeprotokoll_Auszug_2026-10-22_101010.pdf",
        zaehler_nummer: "1 ABC00 0000 0001", foto_pfad: "zaehlerfotos/v1/strom_auszug_1_0.jpg", erfassung: "foto", erkannter_stand: 4711.5,
      },
      {
        einheit_id: "e1", immobilie_id: "i1", zaehler_typ: "kaltwasser", stand: 12.5, datum: "2026-10-22", quelle: "Übergabe (Auszug)", erstellt_von: "u1",
        mietvertrag_id: "v1", protokoll_pfad: "uebergabeprotokolle/v1/Uebergabeprotokoll_Auszug_2026-10-22_101010.pdf",
        zaehler_nummer: null, foto_pfad: null, erfassung: "hand", erkannter_stand: null,
      },
    ]);
  });
});

describe("aktuelleStaende", () => {
  it("liefert je erfasstem Zähler die Spalten der Einheit, Kaltwasser als kaltwasser", () => {
    expect(aktuelleStaende({ ...LEERE_ZAEHLER, strom: "1.234,5", wasser: "7" })).toEqual([
      { standSpalte: "strom_stand_aktuell", datumSpalte: "strom_stand_datum", stand: 1234.5 },
      { standSpalte: "kaltwasser_stand_aktuell", datumSpalte: "kaltwasser_stand_datum", stand: 7 },
    ]);
    expect(aktuelleStaende(LEERE_ZAEHLER)).toEqual([]);
  });
});

describe("historieAufteilen", () => {
  const neu = historieEintraege("e1", null, { strom: "10", gas: "20", wasser: "", warmwasser: "" }, "2026-10-16", "Übergabe (Auszug)", null);

  it("trägt beim ersten Lauf alles ein", () => {
    expect(historieAufteilen(neu, [])).toEqual({ einfuegen: neu, aktualisieren: [] });
  });

  it("aktualisiert beim Wiederholen, was schon steht, statt es zu verdoppeln", () => {
    const { einfuegen, aktualisieren } = historieAufteilen(neu, [{ einheit_id: "e1", zaehler_typ: "strom" }]);
    expect(aktualisieren.map((e) => e.zaehler_typ)).toEqual(["strom"]);
    expect(einfuegen.map((e) => e.zaehler_typ)).toEqual(["gas"]);
  });

  it("trennt nach Einheit", () => {
    const { einfuegen } = historieAufteilen(neu, [{ einheit_id: "e2", zaehler_typ: "strom" }]);
    expect(einfuegen).toHaveLength(2);
  });
});

describe("fehlendeDokumente", () => {
  const zeile = (pfad: string, mietvertrag_id: string) => ({ pfad, mietvertrag_id, titel: "t" });

  it("lässt bereits eingetragene Pfade weg", () => {
    const geplant = [zeile("zaehlerfotos/v1/a.jpg", "v1"), zeile("zaehlerfotos/v1/b.jpg", "v1")];
    expect(fehlendeDokumente(geplant, [{ pfad: "zaehlerfotos/v1/a.jpg", mietvertrag_id: "v1" }])).toEqual([geplant[1]]);
  });

  it("betrachtet denselben Pfad an einem anderen Vertrag als fehlend", () => {
    const geplant = [zeile("uebergabefotos/v1/a.jpg", "v2")];
    expect(fehlendeDokumente(geplant, [{ pfad: "uebergabefotos/v1/a.jpg", mietvertrag_id: "v1" }])).toEqual(geplant);
  });

  it("entfernt Doppelte innerhalb eines Laufs", () => {
    const geplant = [zeile("x.jpg", "v1"), zeile("x.jpg", "v1")];
    expect(fehlendeDokumente(geplant, [])).toHaveLength(1);
  });
});

describe("dateienHochladen", () => {
  it("meldet je Datei den Pfad, sobald sie angekommen ist", async () => {
    const gemeldet: Array<string | null> = [];
    await dateienHochladen(
      [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")],
      (d) => `x/${d.name}`,
      async (pfad) => ({ error: pfad === "x/b.jpg" ? new Error("weg") : null }),
      (_f, _g, pfad) => gemeldet.push(pfad),
      0
    );
    expect(gemeldet).toEqual(["x/a.jpg", null]);
  });

  const datei = (name: string) => new File(["x"], name, { type: "image/jpeg" });
  const pfadFuer = (d: File, i: number) => `zaehlerfotos/v/${i}_${d.name}`;

  it("behält die angekommenen Fotos, wenn ein späteres scheitert", async () => {
    const hochladen = async (pfad: string) => ({ error: pfad.includes("kaputt") ? new Error("Netz") : null });
    const ergebnis = await dateienHochladen([datei("a.jpg"), datei("kaputt.jpg"), datei("c.jpg")], pfadFuer, hochladen, undefined, 0);
    expect(ergebnis).toEqual({ pfade: ["zaehlerfotos/v/0_a.jpg", "zaehlerfotos/v/2_c.jpg"], fehlgeschlagen: 1 });
  });

  it("versucht es ein zweites Mal mit demselben Pfad", async () => {
    const aufrufe: string[] = [];
    const hochladen = async (pfad: string) => {
      aufrufe.push(pfad);
      return { error: aufrufe.length === 1 ? new Error("Zeitüberschreitung") : null };
    };
    const ergebnis = await dateienHochladen([datei("a.jpg")], pfadFuer, hochladen, undefined, 0);
    expect(ergebnis.pfade).toEqual(["zaehlerfotos/v/0_a.jpg"]);
    expect(aufrufe).toEqual(["zaehlerfotos/v/0_a.jpg", "zaehlerfotos/v/0_a.jpg"]);
  });

  it("gibt nach zwei Fehlversuchen auf, auch wenn der Upload wirft", async () => {
    let aufrufe = 0;
    const hochladen = async () => {
      aufrufe++;
      throw new Error("offline");
    };
    expect(await dateienHochladen([datei("a.jpg")], pfadFuer, hochladen, undefined, 0)).toEqual({ pfade: [], fehlgeschlagen: 1 });
    expect(aufrufe).toBe(2);
  });

  it("meldet den Fortschritt je Datei", async () => {
    const stand: string[] = [];
    await dateienHochladen([datei("a.jpg"), datei("b.jpg")], pfadFuer, async () => ({ error: null }), (f, g) => stand.push(`${f}/${g}`), 0);
    expect(stand).toEqual(["1/2", "2/2"]);
  });

  it("wertet einen hängenden Versuch nach dem Zeitlimit als gescheitert und versucht es erneut", async () => {
    let aufrufe = 0;
    const hochladen = () => {
      aufrufe++;
      return aufrufe === 1 ? new Promise<{ error: unknown }>(() => {}) : Promise.resolve({ error: null });
    };
    const ergebnis = await dateienHochladen([datei("a.jpg")], pfadFuer, hochladen, undefined, 0, 20);
    expect(ergebnis).toEqual({ pfade: ["zaehlerfotos/v/0_a.jpg"], fehlgeschlagen: 0 });
    expect(aufrufe).toBe(2);
  });

  it("zählt eine Datei, deren Pfad sich nicht bilden lässt, als gescheitert und macht weiter", async () => {
    const pfad = (d: File, i: number) => {
      if (i === 1) throw new Error("kaputt");
      return `x/${i}`;
    };
    const ergebnis = await dateienHochladen([datei("a"), datei("b"), datei("c")], pfad, async () => ({ error: null }), undefined, 0);
    expect(ergebnis).toEqual({ pfade: ["x/0", "x/2"], fehlgeschlagen: 1 });
  });

  it("lässt sich von einer werfenden Fortschrittsanzeige nicht abbrechen", async () => {
    const ergebnis = await dateienHochladen([datei("a"), datei("b")], pfadFuer, async () => ({ error: null }), () => {
      throw new Error("Anzeige");
    }, 0);
    expect(ergebnis.pfade).toHaveLength(2);
  });
});


describe("rueckbauLesen", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const gut = {
    historieIds: [ID],
    zeilen: [{ tabelle: "einheiten", id: ID, neu: { strom_stand_aktuell: 5, strom_stand_datum: "2026-10-23" }, vorher: { strom_stand_aktuell: null, strom_stand_datum: null } }],
    pdfPfad: `uebergabeprotokolle/${ID}/einzug-2026-10-23-1500.pdf`,
  };

  it("liest einen vollständigen Rückbau", () => {
    expect(rueckbauLesen(gut)).toEqual(gut);
  });

  it("nimmt eine vorhandene Historienzeile mit Protokollpfad als Bedingung an", () => {
    const r = { historieIds: [], zeilen: [{ tabelle: "zaehlerstand_historie", id: ID, neu: { protokoll_pfad: gut.pdfPfad }, vorher: { stand: 4, protokoll_pfad: null } }] };
    expect(rueckbauLesen(r)?.zeilen).toHaveLength(1);
  });

  it.each([
    ["kein Objekt", null],
    ["leer", { historieIds: [], zeilen: [] }],
    ["fremde Tabelle", { ...gut, zeilen: [{ ...gut.zeilen[0], tabelle: "mieter" }] }],
    ["ID ohne Form", { ...gut, historieIds: ["1; drop"] }],
    ["ID als Filter", { ...gut, zeilen: [{ ...gut.zeilen[0], id: "x,id.neq.0" }] }],
    ["verschachtelter Wert", { ...gut, zeilen: [{ ...gut.zeilen[0], vorher: { a: { b: 1 } } }] }],
    ["Bedingung ohne Spalten", { ...gut, zeilen: [{ ...gut.zeilen[0], neu: {} }] }],
    ["Bedingung mit null", { ...gut, zeilen: [{ ...gut.zeilen[0], neu: { a: null } }] }],
    ["fremde Spalte", { ...gut, zeilen: [{ ...gut.zeilen[0], vorher: { kaltmiete: 1 } }] }],
    ["Spaltenname als Filter", { ...gut, zeilen: [{ ...gut.zeilen[0], neu: { "id.neq.0,or=(1": 1 } }] }],
    ["unendlicher Wert", { ...gut, zeilen: [{ ...gut.zeilen[0], neu: { strom_stand_aktuell: Infinity } }] }],
  ])("verwirft %s", (_, roh) => {
    expect(rueckbauLesen(roh)).toBeNull();
  });

  it.each([
    "mietvertraege/x.pdf",
    `uebergabeprotokolle/${ID}/../../mietvertraege/x.pdf`,
    `uebergabeprotokolle/${ID}/%2e%2e/x.pdf`,
    `uebergabeprotokolle/${ID}/x.pdf\n`,
    `uebergabeprotokolle/${ID}/x.jpg`,
  ])("verwirft den Rückbau bei fremdem Protokollpfad: %s", (pfad) => {
    expect(rueckbauLesen({ ...gut, pdfPfad: pfad })).toBeNull();
  });
});
