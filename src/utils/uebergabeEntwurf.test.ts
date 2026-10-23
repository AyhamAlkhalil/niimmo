import { describe, it, expect } from "vitest";
import {
  entwurfSchluessel,
  entwurfLesen,
  entwurfSchreiben,
  entwurfLoeschen,
  entwuerfeAufraeumen,
  entwuerfeAuflisten,
  hatEingaben,
  type DurchsuchbareAblage,
  type UebergabeEingaben,
} from "./uebergabeEntwurf";

class TestAblage implements DurchsuchbareAblage {
  daten = new Map<string, string>();
  voll = false;
  get length() {
    return this.daten.size;
  }
  key(i: number) {
    return [...this.daten.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.daten.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.voll) throw new Error("QuotaExceededError");
    this.daten.set(k, v);
  }
  removeItem(k: string) {
    this.daten.delete(k);
  }
}

const V1 = "vertrag-1";
/** Fester Bezugspunkt — der Entwurf verfällt nach 30 Tagen, die Tests sollen das nicht mit der Uhr tun. */
const JETZT = new Date("2026-10-17T10:00:00Z");

const leer = (): UebergabeEingaben => ({
  uebergabeDatum: "2026-10-16",
  schluessel: { haustuer: "", wohnung: "", briefkasten: "", keller: "" },
  zaehlerstaende: { [V1]: { strom: "", gas: "", wasser: "", warmwasser: "" } },
  zaehlerfotos: { [V1]: {} },
  notizen: "",
  notizenFotos: [],
  unterschriftVermieter: null,
  unterschriftMieter: null,
  versorgerAuswahl: [],
  mieterEmails: {},
});

describe("entwurfSchluessel", () => {
  it("hängt nicht an der Reihenfolge der Verträge und trennt Ein- von Auszug", () => {
    expect(entwurfSchluessel(["b", "a"], true)).toBe(entwurfSchluessel(["a", "b"], true));
    expect(entwurfSchluessel(["a"], true)).not.toBe(entwurfSchluessel(["a"], false));
  });
});

describe("hatEingaben", () => {
  it("ein frisch geöffnetes Formular hat nichts zu verlieren", () => {
    expect(hatEingaben(leer())).toBe(false);
  });

  it.each([
    ["Schlüssel", (e: UebergabeEingaben) => { e.schluessel.keller = "2"; }],
    ["Zählerstand", (e: UebergabeEingaben) => { e.zaehlerstaende[V1].wasser = "12,5"; }],
    ["Zählerfoto", (e: UebergabeEingaben) => { e.zaehlerfotos[V1].gas = ["zaehlerfotos/v/a.jpg"]; }],
    ["Notiz", (e: UebergabeEingaben) => { e.notizen = "Kratzer im Flur"; }],
    ["Zustandsfoto", (e: UebergabeEingaben) => { e.notizenFotos = ["uebergabefotos/v/a.jpg"]; }],
    ["Unterschrift", (e: UebergabeEingaben) => { e.unterschriftMieter = "data:image/png;base64,AAAA"; }],
    ["Versorger", (e: UebergabeEingaben) => { e.versorgerAuswahl = ["strom"]; }],
  ])("%s zählt als Eingabe", (_name, setzen) => {
    const e = leer();
    setzen(e);
    expect(hatEingaben(e)).toBe(true);
  });

  it("nur Leerzeichen zählen nicht", () => {
    const e = leer();
    e.notizen = "   ";
    expect(hatEingaben(e)).toBe(false);
  });
});

describe("Entwurf schreiben und lesen", () => {
  it("bringt alle Eingaben unverändert zurück", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.schluessel.haustuer = "2";
    e.zaehlerstaende[V1] = { strom: "1.234,5", gas: "", wasser: "12,5", warmwasser: "" };
    e.zaehlerfotos[V1] = { strom: ["zaehlerfotos/v/s.jpg"] };
    e.notizen = "Fenster beschlagen";
    e.notizenFotos = ["uebergabefotos/v/n.jpg"];
    e.unterschriftVermieter = "data:image/png;base64,AAAA";
    e.versorgerAuswahl = ["gas"];
    e.mieterEmails = { m1: "a@example.org" };

    const schluessel = entwurfSchluessel([V1], true);
    expect(entwurfSchreiben(ablage, schluessel, e, new Date("2026-10-16T14:29:03Z"))).toBe(true);

    const gelesen = entwurfLesen(ablage, schluessel, [V1], JETZT);
    expect(gelesen).toEqual({ version: 1, gespeichertAm: "2026-10-16T14:29:03.000Z", ...e });
  });

  it("übernimmt Zählerstände nur für die übergebenen Verträge und füllt neue auf", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.zaehlerstaende = { [V1]: { strom: "5", gas: "", wasser: "", warmwasser: "" }, fremd: { strom: "9", gas: "", wasser: "", warmwasser: "" } };
    entwurfSchreiben(ablage, "k", e, JETZT);
    const gelesen = entwurfLesen(ablage, "k", [V1, "vertrag-2"], JETZT);
    expect(Object.keys(gelesen!.zaehlerstaende).sort()).toEqual([V1, "vertrag-2"]);
    expect(gelesen!.zaehlerstaende[V1].strom).toBe("5");
    expect(gelesen!.zaehlerstaende["vertrag-2"]).toEqual({ strom: "", gas: "", wasser: "", warmwasser: "" });
  });

  it("verwirft beschädigte, fremde oder veraltete Einträge", () => {
    const ablage = new TestAblage();
    ablage.setItem("kaputt", "{nicht json");
    ablage.setItem("fremd", JSON.stringify({ version: 2 }));
    ablage.setItem("liste", "[]");
    expect(entwurfLesen(ablage, "kaputt", [V1], JETZT)).toBeNull();
    expect(entwurfLesen(ablage, "fremd", [V1], JETZT)).toBeNull();
    expect(entwurfLesen(ablage, "liste", [V1], JETZT)).toBeNull();
    expect(entwurfLesen(ablage, "fehlt", [V1], JETZT)).toBeNull();
  });

  it("räumt falsche Typen auf, statt sie ins Formular zu tragen", () => {
    const ablage = new TestAblage();
    ablage.setItem("k", JSON.stringify({
      version: 1,
      gespeichertAm: "2026-10-16T14:29:03.000Z",
      uebergabeDatum: "16.10.2026",
      schluessel: { haustuer: 2 },
      zaehlerstaende: { [V1]: { strom: 123 } },
      zaehlerfotos: { [V1]: { strom: ["a.jpg", 4] } },
      notizenFotos: "a.jpg",
      unterschriftMieter: "",
      unterschriftVermieter: "data:image/svg+xml;base64,PHN2Zz4=",
    }));
    const gelesen = entwurfLesen(ablage, "k", [V1], JETZT)!;
    expect(gelesen.uebergabeDatum).toBeNull();
    expect(gelesen.schluessel.haustuer).toBe("");
    expect(gelesen.zaehlerstaende[V1].strom).toBe("");
    expect(gelesen.zaehlerfotos[V1].strom).toEqual(["a.jpg"]);
    expect(gelesen.notizenFotos).toEqual([]);
    expect(gelesen.unterschriftMieter).toBeNull();
    expect(gelesen.unterschriftVermieter).toBeNull();
  });

  it("nimmt ein unmögliches Datum nicht ins Formular — format() würde bei jedem Öffnen abstürzen", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.uebergabeDatum = "2026-02-31";
    entwurfSchreiben(ablage, "k", e, JETZT);
    expect(entwurfLesen(ablage, "k", [V1], JETZT)!.uebergabeDatum).toBeNull();
  });

  it("verwirft und entfernt einen Entwurf ohne gültigen Zeitstempel", () => {
    const ablage = new TestAblage();
    ablage.setItem("k", JSON.stringify({ version: 1, gespeichertAm: "gestern" }));
    expect(entwurfLesen(ablage, "k", [V1], JETZT)).toBeNull();
    expect(ablage.getItem("k")).toBeNull();
  });

  it("verfällt nach 30 Tagen ohne Änderung und wird dabei entfernt", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.notizen = "alt";
    entwurfSchreiben(ablage, "k", e, new Date("2026-09-17T09:00:00Z"));
    expect(entwurfLesen(ablage, "k", [V1], new Date("2026-10-17T08:00:00Z"))?.notizen).toBe("alt");
    expect(entwurfLesen(ablage, "k", [V1], new Date("2026-10-17T10:00:00Z"))).toBeNull();
    expect(ablage.getItem("k")).toBeNull();
  });

  it("entfernt einen unlesbaren Eintrag", () => {
    const ablage = new TestAblage();
    ablage.setItem("k", "{nicht json");
    entwurfLesen(ablage, "k", [V1], JETZT);
    expect(ablage.getItem("k")).toBeNull();
  });

  it("meldet einen vollen Speicher, statt still nichts zu sichern", () => {
    const ablage = new TestAblage();
    ablage.voll = true;
    expect(entwurfSchreiben(ablage, "k", leer(), new Date())).toBe(false);
    expect(entwurfSchreiben(null, "k", leer(), new Date())).toBe(false);
  });

  it("löscht den Entwurf", () => {
    const ablage = new TestAblage();
    entwurfSchreiben(ablage, "k", leer(), JETZT);
    entwurfLoeschen(ablage, "k");
    expect(entwurfLesen(ablage, "k", [V1], JETZT)).toBeNull();
    expect(() => entwurfLoeschen(null, "k")).not.toThrow();
  });
});

describe("offener Rückbau im Entwurf", () => {
  const RUECKBAU = {
    historieIds: ["11111111-1111-4111-8111-111111111111"],
    zeilen: [{ tabelle: "mietvertrag" as const, id: "22222222-2222-4222-8222-222222222222", neu: { strom_auszug: 4711 }, vorher: { strom_auszug: null } }],
    pdfPfad: "uebergabeprotokolle/22222222-2222-4222-8222-222222222222/auszug-2026-10-23-1500.pdf",
  };

  it("bleibt über Schließen und Öffnen erhalten", () => {
    const ablage = new TestAblage();
    const e = { ...leer(), offenerRueckbau: RUECKBAU };
    entwurfSchreiben(ablage, "k", e, JETZT);
    expect(entwurfLesen(ablage, "k", [V1], JETZT)?.offenerRueckbau).toEqual(RUECKBAU);
  });

  it("hält den Entwurf am Leben, auch wenn sonst nichts erfasst ist", () => {
    expect(hatEingaben({ ...leer(), offenerRueckbau: RUECKBAU })).toBe(true);
  });

  it("verwirft einen beschädigten Rückbau, ohne den Entwurf zu verlieren", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.notizen = "x";
    ablage.setItem("k", JSON.stringify({ version: 1, gespeichertAm: JETZT.toISOString(), ...e, offenerRueckbau: { historieIds: ["x,id.neq.0"], zeilen: [] } }));
    const gelesen = entwurfLesen(ablage, "k", [V1], JETZT);
    expect(gelesen?.notizen).toBe("x");
    expect(gelesen?.offenerRueckbau).toBeUndefined();
  });
});

describe("entwuerfeAufraeumen", () => {
  const TAG = 24 * 60 * 60 * 1000;

  it("entfernt verfallene und unlesbare Entwürfe aller Verträge, lässt frische und fremde Einträge stehen", () => {
    const ablage = new TestAblage();
    const frisch = entwurfSchluessel(["a"], true);
    const alt = entwurfSchluessel(["b"], false);
    const kaputt = entwurfSchluessel(["c"], true);
    const falscheFassung = entwurfSchluessel(["d"], true);
    entwurfSchreiben(ablage, frisch, leer(), new Date(JETZT.getTime() - 29 * TAG));
    entwurfSchreiben(ablage, alt, leer(), new Date(JETZT.getTime() - 31 * TAG));
    ablage.setItem(kaputt, "{nicht json");
    ablage.setItem(falscheFassung, JSON.stringify({ version: 2, gespeichertAm: JETZT.toISOString() }));
    ablage.setItem("andere-anwendung", "{nicht json");

    expect(entwuerfeAufraeumen(ablage, JETZT)).toBe(3);
    expect([...ablage.daten.keys()].sort()).toEqual(["andere-anwendung", frisch].sort());
  });

  it("verträgt eine Ablage, die beim Aufzählen wirft, und fehlende Ablage", () => {
    const ablage = new TestAblage();
    ablage.key = () => {
      throw new Error("SecurityError");
    };
    expect(entwuerfeAufraeumen(ablage, JETZT)).toBe(0);
    expect(entwuerfeAufraeumen(null, JETZT)).toBe(0);
  });
});

describe("entwuerfeAuflisten", () => {
  it("listet angefangene Übergaben mit Art und Verträgen, jüngste zuerst", () => {
    const ablage = new TestAblage();
    const mitStand = () => {
      const e = leer();
      e.zaehlerstaende[V1].strom = "12";
      return e;
    };
    entwurfSchreiben(ablage, entwurfSchluessel([V1], true), mitStand(), new Date(JETZT.getTime() - 60_000));
    entwurfSchreiben(ablage, entwurfSchluessel(["b", V1], false), { ...mitStand(), zaehlerstaende: { b: { strom: "1", gas: "", wasser: "", warmwasser: "" } } }, JETZT);
    // leer, kaputt und fremd erscheinen nicht
    entwurfSchreiben(ablage, entwurfSchluessel(["leer"], true), leer(), JETZT);
    ablage.setItem(entwurfSchluessel(["kaputt"], true), "{");
    ablage.setItem("niimmo-uebergabe-entwurf:quatsch", JSON.stringify({ version: 1, gespeichertAm: JETZT.toISOString() }));

    const liste = entwuerfeAuflisten(ablage, JETZT);
    expect(liste.map((e) => [e.isEinzug, e.vertragIds])).toEqual([
      [false, ["b", V1]],
      [true, [V1]],
    ]);
  });

  it("merkt sich den Schritt im Entwurf", () => {
    const ablage = new TestAblage();
    entwurfSchreiben(ablage, "k", { ...leer(), schritt: "zaehler" }, JETZT);
    expect(entwurfLesen(ablage, "k", [V1], JETZT)?.schritt).toBe("zaehler");
    entwurfSchreiben(ablage, "k", leer(), JETZT);
    expect(entwurfLesen(ablage, "k", [V1], JETZT)?.schritt).toBeUndefined();
  });
});
