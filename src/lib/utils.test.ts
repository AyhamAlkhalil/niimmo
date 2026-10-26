import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("ersetzt eigene Schatten durch Schatten des Aufrufers", () => {
    expect(cn("shadow-card", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-card", "shadow-lg")).toBe("shadow-lg");
    expect(cn("shadow-knopf", "shadow-sm")).toBe("shadow-sm");
    expect(cn("shadow-sm", "shadow-dialog")).toBe("shadow-dialog");
    expect(cn("shadow-popover", "shadow-feld")).toBe("shadow-feld");
  });

  it("lässt Schatten mit Zustand neben dem Grundschatten stehen", () => {
    expect(cn("shadow-card", "hover:shadow-card-hover")).toBe("shadow-card hover:shadow-card-hover");
  });

  it("kennt die eigene Übergangskurve", () => {
    expect(cn("ease-sanft", "ease-in")).toBe("ease-in");
    expect(cn("ease-out", "ease-sanft")).toBe("ease-sanft");
  });

  it("ersetzt Markenfarben wie andere Farben", () => {
    expect(cn("bg-card", "bg-brand-soft")).toBe("bg-brand-soft");
    expect(cn("text-foreground", "text-brand")).toBe("text-brand");
  });
});
