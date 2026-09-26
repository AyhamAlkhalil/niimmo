import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { findeUeberschneidungen, ueberschneidungsHinweis } from "./contractOverlapValidation";

const vorgaenger = {
  id: "alt",
  start_datum: "2023-01-01",
  ende_datum: "2026-03-31",
  kuendigungsdatum: null,
  status: "gekuendigt",
  mieterNamen: "Vormieter",
};

describe("findeUeberschneidungen", () => {
  it("Nachmieter ab dem Folgetag überschneidet sich nicht", () => {
    expect(findeUeberschneidungen("2026-04-01", null, [vorgaenger])).toEqual([]);
  });

  it("Nachmieter vor dem Mietende des Vorgängers wird gemeldet", () => {
    const treffer = findeUeberschneidungen("2026-03-15", null, [vorgaenger]);
    expect(treffer).toHaveLength(1);
    expect(treffer[0].endDate).toBe("2026-03-31");
  });

  it("gleicher Tag für Auszug und Einzug zählt als Überschneidung", () => {
    expect(findeUeberschneidungen("2026-03-31", null, [vorgaenger])).toHaveLength(1);
  });

  it("ende_datum und kuendigungsdatum gelten wie in getVertragsende", () => {
    // ende_datum führt, auch wenn ein abweichendes kuendigungsdatum gesetzt ist
    const beide = { ...vorgaenger, ende_datum: "2026-03-31", kuendigungsdatum: "2026-06-30" };
    expect(findeUeberschneidungen("2026-04-01", null, [beide])).toEqual([]);

    // ohne ende_datum greift das kuendigungsdatum -- unabhängig vom Status
    const nurKuendigung = { ...vorgaenger, status: "aktiv", ende_datum: null, kuendigungsdatum: "2026-03-31" };
    expect(findeUeberschneidungen("2026-04-01", null, [nurKuendigung])).toEqual([]);
    expect(findeUeberschneidungen("2026-03-20", null, [nurKuendigung])).toHaveLength(1);
  });

  it("unbefristeter Vertrag überschneidet sich mit jedem späteren Beginn", () => {
    const offen = { ...vorgaenger, ende_datum: null, status: "aktiv" };
    expect(findeUeberschneidungen("2030-01-01", null, [offen])).toHaveLength(1);
  });

  it("befristeter neuer Zeitraum vor dem bestehenden Vertrag überschneidet sich nicht", () => {
    expect(findeUeberschneidungen("2022-01-01", "2022-12-31", [vorgaenger])).toEqual([]);
    expect(findeUeberschneidungen("2022-01-01", "2023-01-01", [vorgaenger])).toHaveLength(1);
  });

  it("bestehender Vertrag ohne Beginn wird nicht übersprungen", () => {
    const ohneBeginn = { ...vorgaenger, start_datum: null as unknown as string };
    expect(findeUeberschneidungen("2020-01-01", "2020-12-31", [ohneBeginn])).toHaveLength(1);
    expect(findeUeberschneidungen("2026-04-01", null, [ohneBeginn])).toEqual([]);
  });

  it("Uhrzeitanteile verschieben keinen Tag", () => {
    expect(findeUeberschneidungen("2026-04-01T00:00:00+02:00", null, [vorgaenger])).toEqual([]);
  });
});

describe("ueberschneidungsHinweis", () => {
  it("nennt Mieter, Status und Laufzeit", () => {
    const text = ueberschneidungsHinweis(findeUeberschneidungen("2026-03-15", null, [vorgaenger]));
    expect(text).toContain("Vormieter (gekuendigt), ab 01.01.2023 bis 31.03.2026");
  });

  it("ohne Treffer kein Hinweis", () => {
    expect(ueberschneidungsHinweis([])).toBeUndefined();
  });
});
