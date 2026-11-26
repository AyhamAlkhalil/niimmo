import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ablesungAktion, ablesungHinweis } from "./zaehlerAblesung";

const HEUTE = "2026-11-26";
const aktuell = { stand: 21936.049, datum: "2026-11-07" };

describe("ablesungAktion", () => {
  it("neuer Stand wird eine Ablesung, ohne Datum zu heute", () => {
    expect(ablesungAktion({ stand: "22000,5", datum: "" }, aktuell, HEUTE)).toEqual({
      art: "neu", stand: 22000.5, datum: HEUTE, wirdAktuell: true,
    });
  });

  it("ein älterer Stand landet nur in der Historie und wird gemeldet", () => {
    const aktion = ablesungAktion({ stand: "21000", datum: "2026-01-01" }, aktuell, HEUTE);
    expect(aktion).toEqual({ art: "neu", stand: 21000, datum: "2026-01-01", wirdAktuell: false });
    expect(ablesungHinweis(aktion, aktuell)).toBe("Nur in der Historie gespeichert: Der aktuelle Stand vom 07.11.2026 ist neuer.");
  });

  it("gleicher Stand mit anderem Datum korrigiert das Datum, auch zurück (Meldung 07.11.2026)", () => {
    expect(ablesungAktion({ stand: "21936.049", datum: "2026-10-29" }, aktuell, HEUTE)).toEqual({
      art: "datum_korrigieren", stand: 21936.049, vonDatum: "2026-11-07", aufDatum: "2026-10-29",
    });
    expect(ablesungAktion({ stand: "21936,049", datum: "2026-11-20" }, aktuell, HEUTE)).toMatchObject({ art: "datum_korrigieren" });
  });

  it("nichts geändert → keine Aktion", () => {
    expect(ablesungAktion({ stand: "21936.049", datum: "2026-11-07" }, aktuell, HEUTE)).toEqual({ art: "keine" });
    expect(ablesungAktion({ stand: "", datum: "" }, { stand: null, datum: null }, HEUTE)).toEqual({ art: "keine" });
  });

  it("gleicher Stand mit geleertem Datumsfeld verschiebt nichts", () => {
    expect(ablesungAktion({ stand: "21936.049", datum: "" }, aktuell, HEUTE)).toEqual({ art: "keine" });
  });

  it("ein vorhandener Stand lässt sich nicht leeren", () => {
    expect(ablesungAktion({ stand: "  ", datum: "2026-11-07" }, aktuell, HEUTE)).toMatchObject({ art: "ungueltig" });
  });

  it("Zukunft, Unlesbares und Minus sind ungültig", () => {
    expect(ablesungAktion({ stand: "100", datum: "2026-11-27" }, aktuell, HEUTE)).toMatchObject({ art: "ungueltig" });
    expect(ablesungAktion({ stand: "12.345.678", datum: "" }, aktuell, HEUTE)).toMatchObject({ art: "ungueltig" });
    expect(ablesungAktion({ stand: "-5", datum: "" }, aktuell, HEUTE)).toMatchObject({ art: "ungueltig" });
    expect(ablesungAktion({ stand: "5", datum: "11/26/2026" }, aktuell, HEUTE)).toMatchObject({ art: "ungueltig" });
  });

  it("ohne bisherigen Stand wird jede Ablesung aktuell", () => {
    expect(ablesungAktion({ stand: "4275", datum: "2020-01-01" }, { stand: null, datum: null }, HEUTE)).toEqual({
      art: "neu", stand: 4275, datum: "2020-01-01", wirdAktuell: true,
    });
  });

  it("Stand aus der Datenbank als Text und Datum mit Uhrzeit", () => {
    expect(ablesungAktion({ stand: "40.71", datum: "2026-01-23" }, { stand: "40.71", datum: "2026-01-23T00:00:00" }, HEUTE)).toEqual({ art: "keine" });
  });

  it("kein Hinweis, wenn die Ablesung aktuell wird oder nur das Datum korrigiert wird", () => {
    expect(ablesungHinweis({ art: "neu", stand: 1, datum: HEUTE, wirdAktuell: true }, aktuell)).toBeNull();
    expect(ablesungHinweis({ art: "datum_korrigieren", stand: 1, vonDatum: "2026-11-07", aufDatum: "2026-10-29" }, aktuell)).toBeNull();
  });
});

describe("Verdrahtung: Masken schreiben nur Ablesungen", () => {
  const lies = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
  // Der aktuelle Stand folgt seit 26.11.2026 in der Datenbank der Historie (Migration 20261126100000)
  const DIREKT_GESCHRIEBEN = /(_stand_aktuell|_stand\$\{suffix\}|_datum\$\{suffix\})`\]\s*=|\[standField\]\s*:|\[datumField\]\s*:/;

  it.each([
    "../components/dashboard/ZaehlerVerwaltung.tsx",
    "../components/dashboard/HausmeisterDashboard.tsx",
    "../components/dashboard/ImmobilienDetail.tsx",
  ])("%s", (datei) => {
    const quelle = lies(datei);
    expect(quelle).toContain("ablesungAktion(");
    expect(quelle).toContain("ablesungSpeichern(");
    expect(quelle).not.toMatch(DIREKT_GESCHRIEBEN);
  });

  it("Korrekturen in der Historie und in der Vertragsbearbeitung laden alle Zähleransichten neu", () => {
    expect(lies("../components/dashboard/ZaehlerHistorie.tsx")).toContain("zaehlerAnsichtenAktualisieren(");
    const vertrag = lies("../hooks/useMietvertragMutations.ts");
    expect(vertrag).toContain("zaehlerAnsichtenAktualisieren(");
    expect(vertrag).toContain("geleerteZaehlerstaende(");
  });

  it("die Migration hält aktuellen Stand und Historie in beide Richtungen zusammen", () => {
    const sql = lies("../../supabase/migrations/20261126100000_aktueller_zaehlerstand_aus_historie.sql");
    expect(sql).toMatch(/create trigger zaehlerstand_historie_nachziehen\s+after insert or delete or update/);
    expect(sql).toMatch(/create trigger zaehlerstand_direkt_als_ablesung\s+after update of kaltwasser_stand_aktuell/);
    expect(sql).toMatch(/on public\.immobilien/);
  });
});
