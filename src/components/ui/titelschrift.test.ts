import { describe, expect, it } from "vitest";
import { titelKlassen } from "./titelschrift";

describe("titelKlassen", () => {
  it("setzt Titel ohne Größe in die Titelschrift", () => {
    expect(titelKlassen(undefined)).toContain("font-display");
    expect(titelKlassen("flex items-center gap-2")).toContain("font-display");
  });

  it("setzt große Titel in die Titelschrift", () => {
    expect(titelKlassen("text-xl")).toContain("font-display");
    expect(titelKlassen("text-2xl leading-none")).toContain("font-display");
  });

  it("setzt kleine Titel mittelkräftig statt im zarten Titelschnitt", () => {
    for (const k of ["text-xs", "text-sm", "text-base", "text-lg", "flex text-lg gap-2", "md:text-lg"]) {
      const klassen = titelKlassen(k);
      expect(klassen).not.toContain("font-display");
      expect(klassen).toContain("font-medium");
    }
  });

  it("erkennt auch verschachtelte und besondere Präfixe", () => {
    for (const k of ["2xl:text-lg", "md:hover:text-sm", "!text-lg", "sm:!text-base", "text-lg/6", "data-[state=open]:text-sm", "quer:text-xs"]) {
      expect(titelKlassen(k)).not.toContain("font-display");
    }
  });

  it("verwechselt verwandte Klassen nicht mit Größen", () => {
    expect(titelKlassen("text-lg-ish")).toContain("font-display");
    expect(titelKlassen("text-foreground")).toContain("font-display");
  });

  it("nimmt eine abweichende Standardgröße", () => {
    expect(titelKlassen(undefined, "text-3xl")).toContain("text-3xl");
  });
});
