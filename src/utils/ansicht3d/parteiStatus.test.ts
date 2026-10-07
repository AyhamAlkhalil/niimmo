import { describe, it, expect } from "vitest";
import { parteiZustand, type VertragFuerStatus } from "./parteiStatus";

const STICHTAG = new Date(2026, 9, 6); // 06.10.2026

const v = (id: string, felder: Partial<VertragFuerStatus>): VertragFuerStatus => ({
  id,
  status: "aktiv",
  start_datum: "2020-01-01",
  ende_datum: null,
  kuendigungsdatum: null,
  ...felder,
});

describe("parteiZustand", () => {
  it("meldet einen laufenden Vertrag als vermietet", () => {
    const z = parteiZustand([v("a", {})], STICHTAG);
    expect(z.status).toBe("vermietet");
    expect(z.vertrag?.id).toBe("a");
  });

  it("meldet einen gekündigten, noch laufenden Vertrag als gekündigt", () => {
    const z = parteiZustand([v("a", { status: "gekuendigt", kuendigungsdatum: "2026-12-31", ende_datum: "2026-12-31" })], STICHTAG);
    expect(z.status).toBe("gekuendigt");
    expect(z.vertrag?.id).toBe("a");
  });

  it("wertet eine Kündigung auch bei Status „aktiv“ (Datenstand vor dem Workflow)", () => {
    expect(parteiZustand([v("a", { kuendigungsdatum: "2027-03-31" })], STICHTAG).status).toBe("gekuendigt");
  });

  it("zeigt eine bloße Befristung als vermietet", () => {
    expect(parteiZustand([v("a", { ende_datum: "2028-06-30" })], STICHTAG).status).toBe("vermietet");
  });

  it("meldet Leerstand ohne Vertrag, wenn alle Verträge beendet sind", () => {
    const z = parteiZustand(
      [v("alt", { status: "beendet", start_datum: "2018-01-01", ende_datum: "2021-05-31" }), v("neuer", { status: "beendet", start_datum: "2021-07-01", ende_datum: "2026-06-30" })],
      STICHTAG
    );
    expect(z).toEqual({ status: "leer", vertrag: null });
  });

  it("zählt einen aktiven, aber abgelaufenen Vertrag nicht als vermietet", () => {
    expect(parteiZustand([v("a", { ende_datum: "2026-09-30" })], STICHTAG).status).toBe("leer");
  });

  it("erkennt eine Neuvermietung, die erst beginnt", () => {
    const z = parteiZustand([v("alt", { status: "beendet", ende_datum: "2026-09-30" }), v("neu", { start_datum: "2026-11-01" })], STICHTAG);
    expect(z.status).toBe("kommend");
    expect(z.vertrag?.id).toBe("neu");
  });

  it("liefert für eine Einheit ohne Vertrag Leerstand", () => {
    expect(parteiZustand([], STICHTAG)).toEqual({ status: "leer", vertrag: null });
  });
});
