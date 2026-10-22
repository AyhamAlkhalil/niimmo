import { describe, it, expect } from "vitest";
import {
  bausteinAnhaengen,
  handyAnsicht,
  istUebergabeSchritt,
  pruefpunkte,
  referenzstand,
  referenzText,
  schrittZustaende,
  zaehlerHinweise,
  type AblaufEingaben,
} from "./uebergabeAblauf";

const V = "vertrag-1";

const eingaben = (aenderung: Partial<AblaufEingaben> = {}): AblaufEingaben => ({
  uebergabeDatum: "2026-10-20",
  zaehlerstaende: { [V]: { strom: "4.711,5", gas: "", wasser: "88,25", warmwasser: "" } },
  zaehlerfotos: { [V]: {} },
  unterschriftVermieter: true,
  unterschriftMieter: true,
  ...aenderung,
});

describe("referenzstand", () => {
  it("nimmt die jüngste Ablesung vor dem Übergabetag", () => {
    const r = referenzstand(
      [
        { stand: 100, datum: "2026-01-01" },
        { stand: 300, datum: "2026-06-01" },
        { stand: 900, datum: "2026-12-01" },
      ],
      null,
      "2026-10-20"
    );
    expect(r).toEqual({ stand: 300, datum: "2026-06-01", quelle: "ablesung" });
  });

  it("vergleicht beim Auszug mit dem Einzugsstand, wenn er jünger ist", () => {
    expect(referenzstand([{ stand: 50, datum: "2025-01-01" }], { stand: 120, datum: "2026-04-01" }, "2026-10-20")).toEqual({
      stand: 120,
      datum: "2026-04-01",
      quelle: "einzug",
    });
  });

  it("ohne Datum nur, wenn sonst nichts da ist", () => {
    expect(referenzstand([], { stand: 7, datum: null }, "2026-10-20")?.stand).toBe(7);
    expect(referenzstand([{ stand: 9, datum: "2026-01-01" }], { stand: 7, datum: null }, "2026-10-20")?.stand).toBe(9);
  });

  it("vergleicht nur den Tag, auch bei Zeitstempeln", () => {
    expect(referenzstand([{ stand: 5, datum: "2026-10-20T10:00:00Z" }], null, "2026-10-20")).toEqual({ stand: 5, datum: "2026-10-20", quelle: "ablesung" });
    expect(referenzstand([{ stand: 5, datum: "20.10.2026" }], null, "2026-01-01")).toEqual({ stand: 5, datum: null, quelle: "ablesung" });
  });

  it("liefert nichts ohne verwertbaren Stand", () => {
    expect(referenzstand([{ stand: null, datum: "2026-01-01" }], { stand: null, datum: null }, "2026-10-20")).toBeNull();
  });
});

describe("zaehlerHinweise", () => {
  const ref = { stand: 4711.5, datum: "2026-04-01", quelle: "einzug" as const };

  it("sperrt nur bei unlesbarer Eingabe", () => {
    expect(zaehlerHinweise("12,34,5", 0, null)).toEqual([{ art: "unlesbar", sperrt: true }]);
  });

  it("fragt nach, wenn ein Foto da ist, aber kein Stand", () => {
    expect(zaehlerHinweise("", 1, ref)).toEqual([{ art: "foto_ohne_stand", sperrt: false }]);
    expect(zaehlerHinweise("", 0, ref)).toEqual([]);
  });

  it("meldet einen Stand unter dem letzten bekannten", () => {
    expect(zaehlerHinweise("4700", 0, ref)).toEqual([{ art: "kleiner", sperrt: false }]);
    // Ein einzelner Punkt ist für den Parser ein Dezimaltrenner: „5.900" wird 5,9 —
    // genau dieser Irrtum fällt über den Vergleich auf
    expect(zaehlerHinweise("5.900", 0, ref)).toEqual([{ art: "kleiner", sperrt: false }]);
    expect(zaehlerHinweise("4.711,5", 0, ref)).toEqual([]);
  });

  it("meldet einen Sprung, wie ihn ein vergessenes Komma erzeugt", () => {
    expect(zaehlerHinweise("47115", 0, ref)).toEqual([{ art: "sprung", sperrt: false }]);
    expect(zaehlerHinweise("5900", 0, ref)).toEqual([]);
    // Neuer Zähler mit kleinem Stand: zehnfach, aber unter 1000 Unterschied
    expect(zaehlerHinweise("60", 0, { stand: 5, datum: null, quelle: "ablesung" })).toEqual([]);
  });
});

describe("pruefpunkte und schrittZustaende", () => {
  it("ein vollständiges Protokoll hat nur grüne Punkte", () => {
    const punkte = pruefpunkte(eingaben(), [V]);
    expect(punkte.every((p) => p.art === "ok")).toBe(true);
    expect(punkte.find((p) => p.schritt === "zaehler")?.text).toBe("2 von 4 Zählerständen erfasst.");
  });

  it("fehlendes Datum und unlesbarer Stand sperren", () => {
    const punkte = pruefpunkte(eingaben({ uebergabeDatum: null, zaehlerstaende: { [V]: { strom: "1,2,3" } } }), [V]);
    const z = schrittZustaende(punkte);
    expect(z.allgemein).toBe("fehler");
    expect(z.zaehler).toBe("fehler");
  });

  it("fehlende Unterschrift und Foto ohne Stand sind Hinweise, keine Sperre", () => {
    const punkte = pruefpunkte(
      eingaben({ unterschriftMieter: false, zaehlerfotos: { [V]: { gas: 1 } } }),
      [V]
    );
    expect(punkte).toContainEqual({ schritt: "unterschriften", art: "hinweis", text: "Unterschrift fehlt: Mieter." });
    expect(punkte).toContainEqual({ schritt: "zaehler", art: "hinweis", text: "1 Zähler hat ein Foto, aber keinen Stand." });
    expect(punkte.some((p) => p.art === "fehler")).toBe(false);
  });

  it("meldet einen auffälligen Stand gegenüber dem Vergleichswert", () => {
    const punkte = pruefpunkte(
      eingaben({ referenzen: { [V]: { strom: { stand: 9000, datum: "2026-04-01", quelle: "einzug" } } } }),
      [V]
    );
    expect(punkte.some((p) => p.schritt === "zaehler" && p.art === "hinweis" && p.text.includes("auffällig"))).toBe(true);
  });

  it("ohne Zählerstand ein Hinweis", () => {
    const punkte = pruefpunkte(eingaben({ zaehlerstaende: { [V]: {} } }), [V]);
    expect(punkte).toContainEqual({ schritt: "zaehler", art: "hinweis", text: "Kein Zählerstand erfasst." });
  });
});

describe("Hilfen", () => {
  it("erkennt gültige Schritte", () => {
    expect(istUebergabeSchritt("zaehler")).toBe(true);
    expect(istUebergabeSchritt("abschluss")).toBe(false);
    expect(istUebergabeSchritt(3)).toBe(false);
  });

  it("hängt Bausteine einmal als neue Zeile an", () => {
    expect(bausteinAnhaengen("", "Keine Mängel festgestellt.")).toBe("Keine Mängel festgestellt.");
    expect(bausteinAnhaengen("Kratzer im Flur  \n", "Keine Mängel festgestellt.")).toBe("Kratzer im Flur\nKeine Mängel festgestellt.");
    expect(bausteinAnhaengen("Keine Mängel festgestellt.", "Keine Mängel festgestellt.")).toBe("Keine Mängel festgestellt.");
  });
});

describe("referenzText", () => {
  it("nennt Stand, Einheit und Datum", () => {
    expect(referenzText({ stand: 4711.5, datum: "2026-04-01", quelle: "einzug" }, "kWh")).toBe("der Einzugsstand (4.711,5 kWh am 01.04.2026)");
    expect(referenzText({ stand: 88, datum: null, quelle: "ablesung" }, "m³")).toBe("der letzte bekannte Stand (88 m³)");
    // Ein kaputtes Datum darf das Zählerfeld nicht zum Absturz bringen
    expect(referenzText({ stand: 1, datum: "kaputt", quelle: "ablesung" }, "m³")).toBe("der letzte bekannte Stand (1 m³)");
  });
});

describe("handyAnsicht", () => {
  it("iPhone hochkant und quer bekommen das Handy-Panel", () => {
    expect(handyAnsicht(390, 844, true)).toBe(true);
    expect(handyAnsicht(844, 390, true)).toBe(true);
    expect(handyAnsicht(932, 430, true)).toBe(true);
    expect(handyAnsicht(667, 375, true)).toBe(true);
  });

  it("iPad und Laptop behalten den Dialog — auch ein Laptop mit niedrigem Fenster", () => {
    expect(handyAnsicht(1180, 820, true)).toBe(false);
    expect(handyAnsicht(820, 1180, true)).toBe(false);
    expect(handyAnsicht(1366, 650, false)).toBe(false);
    // iPad quer mit Safari-Leisten: sichtbar unter 768 hoch, bleibt trotzdem Dialog
    expect(handyAnsicht(1180, 746, true)).toBe(false);
    expect(handyAnsicht(1133, 670, true)).toBe(false);
    expect(handyAnsicht(1366, 650, true)).toBe(false);
    // iPad 10,2" quer (1080×810): mit Leisten rund 760 px sichtbar
    expect(handyAnsicht(1080, 759, true)).toBe(false);
    // iPad mini quer (1133×744) mit Leisten
    expect(handyAnsicht(1133, 660, true)).toBe(false);
  });

  it("ein schmales Fenster ist immer das Panel", () => {
    expect(handyAnsicht(600, 900, false)).toBe(true);
  });

  it("Grenzwerte: Breite 768 und kurze Seite 600 zählen schon als groß", () => {
    expect(handyAnsicht(767, 1000, false)).toBe(true);
    expect(handyAnsicht(768, 1000, false)).toBe(false);
    expect(handyAnsicht(1000, 599, true)).toBe(true);
    expect(handyAnsicht(1000, 600, true)).toBe(false);
    // Ohne Touch entscheidet nur die Breite, auch bei sehr niedrigem Fenster
    expect(handyAnsicht(1280, 400, false)).toBe(false);
  });
});
