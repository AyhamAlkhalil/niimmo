import { describe, it, expect } from "vitest";
import {
  sortiereAufgaben,
  PRIORITAET_REIHENFOLGE,
  PRIORITAET_DARSTELLUNG,
  STATUS_DARSTELLUNG,
  STATUS_REIHENFOLGE,
} from "./aufgabenDarstellung";
import type { AufgabenPrioritaet, AufgabenStatus } from "@/hooks/useAufgaben";

/**
 * Die Sortierung entscheidet, was die Verwaltung im Board oben sieht.
 * Vertrag laut Code: Erledigtes ans Ende, davor die dringendste Aufgabe,
 * bei gleicher Dringlichkeit die zuletzt gemeldete zuerst.
 */

type TestAufgabe = {
  id: string;
  status: AufgabenStatus;
  prioritaet: AufgabenPrioritaet;
  erstellt_am: string;
};

function aufgabe(
  id: string,
  prioritaet: AufgabenPrioritaet,
  erstellt_am: string,
  status: AufgabenStatus = "offen",
): TestAufgabe {
  return { id, status, prioritaet, erstellt_am };
}

const ids = (liste: TestAufgabe[]) => liste.map((a) => a.id);

describe("sortiereAufgaben – Erledigtes ans Ende", () => {
  it("schiebt fertige Aufgaben hinter alle offenen, auch wenn sie dringender sind", () => {
    const liste = [
      aufgabe("fertig-kritisch", "kritisch", "2026-09-03T10:00:00+00:00", "fertig"),
      aufgabe("offen-niedrig", "niedrig", "2026-01-01T10:00:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["offen-niedrig", "fertig-kritisch"]);
  });

  it("behandelt nur 'fertig' als erledigt – 'in_testing' bleibt oben", () => {
    // "Zum Pruefen" ist noch Arbeit fuer die Verwaltung und darf nicht wegrutschen.
    const liste = [
      aufgabe("fertig", "kritisch", "2026-09-03T10:00:00+00:00", "fertig"),
      aufgabe("zum-pruefen", "mittel", "2026-09-01T10:00:00+00:00", "in_testing"),
      aufgabe("geplant", "mittel", "2026-08-01T10:00:00+00:00", "geplant"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["zum-pruefen", "geplant", "fertig"]);
  });

  it("sortiert auch innerhalb der erledigten Aufgaben nach Dringlichkeit und Datum", () => {
    const liste = [
      aufgabe("fertig-niedrig", "niedrig", "2026-09-03T10:00:00+00:00", "fertig"),
      aufgabe("fertig-kritisch", "kritisch", "2026-01-01T10:00:00+00:00", "fertig"),
      aufgabe("offen", "niedrig", "2026-01-01T10:00:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual([
      "offen",
      "fertig-kritisch",
      "fertig-niedrig",
    ]);
  });
});

describe("sortiereAufgaben – Dringlichkeit", () => {
  it("ordnet kritisch vor hoch vor mittel vor niedrig", () => {
    const liste = [
      aufgabe("niedrig", "niedrig", "2026-09-03T10:00:00+00:00"),
      aufgabe("hoch", "hoch", "2026-09-03T10:00:00+00:00"),
      aufgabe("mittel", "mittel", "2026-09-03T10:00:00+00:00"),
      aufgabe("kritisch", "kritisch", "2026-09-03T10:00:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["kritisch", "hoch", "mittel", "niedrig"]);
  });

  it("stellt die Dringlichkeit ueber das Meldedatum", () => {
    // Die alte kritische Meldung schlaegt den frischen Kleinkram.
    const liste = [
      aufgabe("neu-niedrig", "niedrig", "2026-09-03T10:00:00+00:00"),
      aufgabe("alt-kritisch", "kritisch", "2024-01-01T10:00:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["alt-kritisch", "neu-niedrig"]);
  });

  it("bildet dieselbe Reihenfolge ab wie PRIORITAET_REIHENFOLGE", () => {
    // Filterleiste und Sortierung duerfen nicht auseinanderlaufen.
    const liste = [...PRIORITAET_REIHENFOLGE]
      .reverse()
      .map((p) => aufgabe(p, p, "2026-09-03T10:00:00+00:00"));

    expect(ids(sortiereAufgaben(liste))).toEqual(PRIORITAET_REIHENFOLGE);
  });
});

describe("sortiereAufgaben – Meldedatum", () => {
  it("stellt bei gleicher Dringlichkeit die neuere Meldung nach oben", () => {
    const liste = [
      aufgabe("alt", "hoch", "2026-01-15T08:00:00+00:00"),
      aufgabe("neu", "hoch", "2026-09-03T08:00:00+00:00"),
      aufgabe("mittelalt", "hoch", "2026-05-20T08:00:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["neu", "mittelalt", "alt"]);
  });

  it("unterscheidet auch Meldungen am selben Tag", () => {
    const liste = [
      aufgabe("vormittag", "mittel", "2026-09-03T09:15:00+00:00"),
      aufgabe("abend", "mittel", "2026-09-03T18:45:00+00:00"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["abend", "vormittag"]);
  });
});

describe("sortiereAufgaben – Randfaelle", () => {
  it("liefert fuer eine leere Liste eine leere Liste", () => {
    expect(sortiereAufgaben([])).toEqual([]);
  });

  it("liefert eine einelementige Liste unveraendert zurueck", () => {
    const einzeln = aufgabe("nur-eine", "mittel", "2026-09-03T10:00:00+00:00");
    expect(sortiereAufgaben([einzeln])).toEqual([einzeln]);
  });

  it("veraendert die uebergebene Liste nicht", () => {
    // React-Query-Caches werden geteilt: Ein In-Place-Sort wuerde fremde
    // Ansichten still umordnen.
    const liste = [
      aufgabe("a", "niedrig", "2026-01-01T10:00:00+00:00"),
      aufgabe("b", "kritisch", "2026-02-01T10:00:00+00:00"),
      aufgabe("c", "hoch", "2026-03-01T10:00:00+00:00"),
    ];
    const vorher = ids(liste);

    const sortiert = sortiereAufgaben(liste);

    expect(ids(liste)).toEqual(vorher);
    expect(sortiert).not.toBe(liste);
    expect(ids(sortiert)).toEqual(["b", "c", "a"]);
  });

  it("reicht dieselben Objekte durch, statt sie zu kopieren", () => {
    const eintrag = aufgabe("a", "hoch", "2026-09-03T10:00:00+00:00");
    expect(sortiereAufgaben([eintrag])[0]).toBe(eintrag);
  });

  it("haelt die Eingabereihenfolge, wenn Status, Dringlichkeit und Datum gleich sind", () => {
    const zeitpunkt = "2026-09-03T10:00:00+00:00";
    const liste = [
      aufgabe("erste", "hoch", zeitpunkt),
      aufgabe("zweite", "hoch", zeitpunkt),
      aufgabe("dritte", "hoch", zeitpunkt),
      aufgabe("vierte", "hoch", zeitpunkt),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual(["erste", "zweite", "dritte", "vierte"]);
  });

  it("bleibt auch bei vielen gleichwertigen Eintraegen stabil", () => {
    const zeitpunkt = "2026-09-03T10:00:00+00:00";
    const liste = Array.from({ length: 30 }, (_, i) =>
      aufgabe(`nr-${i}`, "mittel", zeitpunkt),
    );

    expect(ids(sortiereAufgaben(liste))).toEqual(ids(liste));
  });

  it("sortiert eine gemischte Liste vollstaendig durch", () => {
    const liste = [
      aufgabe("fertig-alt", "hoch", "2025-01-01T10:00:00+00:00", "fertig"),
      aufgabe("offen-mittel-neu", "mittel", "2026-09-01T10:00:00+00:00"),
      aufgabe("arbeit-kritisch", "kritisch", "2026-02-01T10:00:00+00:00", "in_entwicklung"),
      aufgabe("fertig-neu", "hoch", "2026-08-01T10:00:00+00:00", "fertig"),
      aufgabe("offen-mittel-alt", "mittel", "2026-03-01T10:00:00+00:00"),
      aufgabe("geplant-hoch", "hoch", "2026-04-01T10:00:00+00:00", "geplant"),
    ];

    expect(ids(sortiereAufgaben(liste))).toEqual([
      "arbeit-kritisch",
      "geplant-hoch",
      "offen-mittel-neu",
      "offen-mittel-alt",
      "fertig-neu",
      "fertig-alt",
    ]);
  });
});

describe("Beschriftungen", () => {
  it("hat fuer jede Dringlichkeit und jeden Status eine Beschriftung", () => {
    // Sonst steht im Board ein leeres Etikett.
    for (const p of PRIORITAET_REIHENFOLGE) {
      expect(PRIORITAET_DARSTELLUNG[p]?.label).toBeTruthy();
    }
    for (const s of STATUS_REIHENFOLGE) {
      expect(STATUS_DARSTELLUNG[s]?.label).toBeTruthy();
    }
  });
});
