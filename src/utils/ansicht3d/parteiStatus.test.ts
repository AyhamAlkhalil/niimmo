import { describe, it, expect } from "vitest";
import { einheitenNummern, kennzahlen, parteiZustand, vermietungsquote, type VertragFuerStatus } from "./parteiStatus";

const STICHTAG = new Date(2026, 9, 6); // 06.10.2026

const v = (id: string, felder: Partial<VertragFuerStatus>): VertragFuerStatus => ({
  id,
  status: "aktiv",
  start_datum: "2020-01-01",
  ende_datum: null,
  kuendigungsdatum: null,
  kaltmiete: 500,
  betriebskosten: 150,
  ...felder,
});

describe("parteiZustand", () => {
  it("meldet einen laufenden Vertrag als vermietet", () => {
    const z = parteiZustand([v("a", {})], STICHTAG);
    expect(z).toMatchObject({ status: "vermietet", seit: "2020-01-01", bis: null });
    expect(z.oeffnen?.id).toBe("a");
  });

  it("meldet einen gekündigten, noch laufenden Vertrag als gekündigt – mit Ende", () => {
    const z = parteiZustand([v("a", { status: "gekuendigt", kuendigungsdatum: "2026-12-31", ende_datum: "2026-12-31" })], STICHTAG);
    expect(z).toMatchObject({ status: "gekuendigt", bis: "2026-12-31" });
  });

  it("wertet eine Kündigung auch bei Status „aktiv“ (Datenstand vor dem Workflow)", () => {
    expect(parteiZustand([v("a", { kuendigungsdatum: "2027-03-31" })], STICHTAG).status).toBe("gekuendigt");
  });

  it("zeigt eine bloße Befristung als vermietet mit Ende", () => {
    expect(parteiZustand([v("a", { ende_datum: "2028-06-30" })], STICHTAG)).toMatchObject({ status: "vermietet", bis: "2028-06-30" });
  });

  it("meldet Leerstand seit dem letzten Vertragsende", () => {
    const z = parteiZustand(
      [v("alt", { status: "beendet", start_datum: "2018-01-01", ende_datum: "2021-05-31" }), v("neuer", { status: "beendet", start_datum: "2021-07-01", ende_datum: "2026-06-30" })],
      STICHTAG
    );
    expect(z).toMatchObject({ status: "leer", seit: "2026-06-30", vertrag: null });
    // Geöffnet wird der zuletzt begonnene Vertrag, damit die Historie erreichbar bleibt.
    expect(z.oeffnen?.id).toBe("neuer");
  });

  it("zählt einen aktiven, aber abgelaufenen Vertrag nicht als vermietet", () => {
    expect(parteiZustand([v("a", { ende_datum: "2026-09-30" })], STICHTAG).status).toBe("leer");
  });

  it("erkennt eine Neuvermietung, die erst beginnt", () => {
    const z = parteiZustand([v("alt", { status: "beendet", ende_datum: "2026-09-30" }), v("neu", { start_datum: "2026-11-01" })], STICHTAG);
    expect(z).toMatchObject({ status: "kommend", ab: "2026-11-01", seit: "2026-09-30" });
    expect(z.oeffnen?.id).toBe("neu");
  });

  it("liefert für eine Einheit ohne Vertrag Leerstand ohne Datum", () => {
    expect(parteiZustand([], STICHTAG)).toEqual({ status: "leer", vertrag: null, oeffnen: null, seit: null, bis: null, ab: null });
  });
});

describe("kennzahlen", () => {
  it("zählt die Zustände und summiert nur laufende Mieten", () => {
    const zustaende = [
      parteiZustand([v("a", { kaltmiete: 600, betriebskosten: 200 })], STICHTAG),
      parteiZustand([v("b", { kaltmiete: 400, betriebskosten: 100, kuendigungsdatum: "2026-12-31" })], STICHTAG),
      parteiZustand([v("c", { kaltmiete: 999, start_datum: "2026-12-01" })], STICHTAG),
      parteiZustand([], STICHTAG),
    ];
    const k = kennzahlen(zustaende);
    expect(k).toEqual({ einheiten: 4, vermietet: 1, gekuendigt: 1, kommend: 1, leer: 1, kaltmiete: 1000, warmmiete: 1300 });
    expect(vermietungsquote(k)).toBe(0.5);
  });

  it("teilt nicht durch null", () => {
    expect(vermietungsquote(kennzahlen([]))).toBe(0);
  });
});

describe("einheitenNummern", () => {
  it("zählt je Objekt wie die Karten der Objektansicht", () => {
    const nummern = einheitenNummern([
      { id: "aaaa-1203", immobilie_id: "x" },
      { id: "aaaa-1201", immobilie_id: "x" },
      { id: "aaaa-1202", immobilie_id: "x" },
      { id: "bbbb-0901", immobilie_id: "y" },
    ]);
    expect(nummern.get("aaaa-1201")).toBe(1);
    expect(nummern.get("aaaa-1203")).toBe(3);
    expect(nummern.get("bbbb-0901")).toBe(1);
  });
});
