import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  klickAufSchwebendeKnoepfe,
  schwebendeKnoepfeDurchlassen,
  SCHWEBENDE_KNOEPFE_ATTRIBUT,
} from "./schwebendeKnoepfe";

/** Element-Ersatz: `closest` findet den Behälter nur, wenn das Ziel darin liegt. */
const ziel = (imBehaelter: boolean) => ({
  closest: (selektor: string) =>
    imBehaelter && selektor === `[${SCHWEBENDE_KNOEPFE_ATTRIBUT}]` ? {} : null,
});

describe("klickAufSchwebendeKnoepfe", () => {
  it("erkennt einen Klick in die Knopfleiste", () => {
    expect(klickAufSchwebendeKnoepfe(ziel(true) as unknown as EventTarget)).toBe(true);
  });

  it("ein Klick daneben zählt nicht", () => {
    expect(klickAufSchwebendeKnoepfe(ziel(false) as unknown as EventTarget)).toBe(false);
  });

  it("verträgt Ziele ohne closest (Text, Fenster, null)", () => {
    expect(klickAufSchwebendeKnoepfe(null)).toBe(false);
    expect(klickAufSchwebendeKnoepfe({} as EventTarget)).toBe(false);
  });
});

describe("schwebendeKnoepfeDurchlassen", () => {
  it("verhindert das Schließen nur beim Klick auf die Knöpfe", () => {
    const aufKnopf = { target: ziel(true) as unknown as EventTarget, preventDefault: vi.fn() };
    const daneben = { target: ziel(false) as unknown as EventTarget, preventDefault: vi.fn() };
    schwebendeKnoepfeDurchlassen(aufKnopf);
    schwebendeKnoepfeDurchlassen(daneben);
    expect(aufKnopf.preventDefault).toHaveBeenCalledOnce();
    expect(daneben.preventDefault).not.toHaveBeenCalled();
  });
});

describe("Verdrahtung", () => {
  const lies = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");

  it("alle schließbaren Fenster-Bausteine lassen die Knöpfe durch", () => {
    for (const datei of ["../components/ui/dialog.tsx", "../components/ui/sheet.tsx", "../components/ui/drawer.tsx"]) {
      expect(lies(datei), datei).toContain("schwebendeKnoepfeDurchlassen(");
    }
  });

  it("der Behälter trägt das Kennzeichen und nimmt trotz gesperrter Seite Klicks an", () => {
    const quelle = lies("../components/dashboard/SchwebendeKnoepfe.tsx");
    expect(quelle).toContain("SCHWEBENDE_KNOEPFE_ATTRIBUT");
    expect(quelle).toContain("pointer-events-auto");
  });
});
