import { describe, it, expect } from "vitest";
import {
  entwurfSchluessel,
  entwurfLesen,
  entwurfSchreiben,
  entwurfLoeschen,
  hatEingaben,
  type Ablage,
  type UebergabeEingaben,
} from "./uebergabeEntwurf";

class TestAblage implements Ablage {
  daten = new Map<string, string>();
  voll = false;
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

    const gelesen = entwurfLesen(ablage, schluessel, [V1]);
    expect(gelesen).toEqual({ version: 1, gespeichertAm: "2026-10-16T14:29:03.000Z", ...e });
  });

  it("übernimmt Zählerstände nur für die übergebenen Verträge und füllt neue auf", () => {
    const ablage = new TestAblage();
    const e = leer();
    e.zaehlerstaende = { [V1]: { strom: "5", gas: "", wasser: "", warmwasser: "" }, fremd: { strom: "9", gas: "", wasser: "", warmwasser: "" } };
    entwurfSchreiben(ablage, "k", e, new Date());
    const gelesen = entwurfLesen(ablage, "k", [V1, "vertrag-2"]);
    expect(Object.keys(gelesen!.zaehlerstaende).sort()).toEqual([V1, "vertrag-2"]);
    expect(gelesen!.zaehlerstaende[V1].strom).toBe("5");
    expect(gelesen!.zaehlerstaende["vertrag-2"]).toEqual({ strom: "", gas: "", wasser: "", warmwasser: "" });
  });

  it("verwirft beschädigte, fremde oder veraltete Einträge", () => {
    const ablage = new TestAblage();
    ablage.setItem("kaputt", "{nicht json");
    ablage.setItem("fremd", JSON.stringify({ version: 2 }));
    ablage.setItem("liste", "[]");
    expect(entwurfLesen(ablage, "kaputt", [V1])).toBeNull();
    expect(entwurfLesen(ablage, "fremd", [V1])).toBeNull();
    expect(entwurfLesen(ablage, "liste", [V1])).toBeNull();
    expect(entwurfLesen(ablage, "fehlt", [V1])).toBeNull();
  });

  it("räumt falsche Typen auf, statt sie ins Formular zu tragen", () => {
    const ablage = new TestAblage();
    ablage.setItem("k", JSON.stringify({
      version: 1,
      uebergabeDatum: "16.10.2026",
      schluessel: { haustuer: 2 },
      zaehlerstaende: { [V1]: { strom: 123 } },
      zaehlerfotos: { [V1]: { strom: ["a.jpg", 4] } },
      notizenFotos: "a.jpg",
      unterschriftMieter: "",
    }));
    const gelesen = entwurfLesen(ablage, "k", [V1])!;
    expect(gelesen.uebergabeDatum).toBeNull();
    expect(gelesen.schluessel.haustuer).toBe("");
    expect(gelesen.zaehlerstaende[V1].strom).toBe("");
    expect(gelesen.zaehlerfotos[V1].strom).toEqual(["a.jpg"]);
    expect(gelesen.notizenFotos).toEqual([]);
    expect(gelesen.unterschriftMieter).toBeNull();
  });

  it("meldet einen vollen Speicher, statt still nichts zu sichern", () => {
    const ablage = new TestAblage();
    ablage.voll = true;
    expect(entwurfSchreiben(ablage, "k", leer(), new Date())).toBe(false);
    expect(entwurfSchreiben(null, "k", leer(), new Date())).toBe(false);
  });

  it("löscht den Entwurf", () => {
    const ablage = new TestAblage();
    entwurfSchreiben(ablage, "k", leer(), new Date());
    entwurfLoeschen(ablage, "k");
    expect(entwurfLesen(ablage, "k", [V1])).toBeNull();
    expect(() => entwurfLoeschen(null, "k")).not.toThrow();
  });
});
