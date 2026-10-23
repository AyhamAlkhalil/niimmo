import { describe, it, expect } from "vitest";
import { pdfText } from "./pdfText";

describe("pdfText", () => {
  it("lässt Deutsch, Euro, Gedankenstrich und m² unverändert", () => {
    const text = "Küche: Fliese gesprungen – 2 Stück, 12 m², 50 € „ok“ … Straße";
    expect(pdfText(text)).toBe(text);
  });

  it("ersetzt Minus, Vergleichszeichen und Pfeile", () => {
    expect(pdfText("−2 cm, ≥ 3, ≤ 4 → neu")).toBe("-2 cm, >= 3, <= 4 -> neu");
  });

  it("bringt fremde Akzente auf den Grundbuchstaben", () => {
    // á gibt es in WinAnsi, ř nicht
    expect(pdfText("Şahin Yılmaz, Łukasz Dvořák")).toBe("Sahin Yilmaz, Lukasz Dvorák");
  });

  it("entfernt Emojis samt Verbindern und Hauttönen", () => {
    expect(pdfText("Alles gut 👍🏽 Danke 🙂")).toBe("Alles gut  Danke ");
    expect(pdfText("Familie 👨‍👩‍👧 da")).toBe("Familie  da");
    expect(pdfText("Herz ❤️")).toBe("Herz ");
  });

  it("setzt zusammengesetzte Akzente zusammen statt sie zu verlieren", () => {
    expect(pdfText("Café")).toBe("Café");
  });

  it("macht aus dem Rest ein Fragezeichen und behält Zeilenumbrüche", () => {
    expect(pdfText("Zeile 1\nZeile 2 漢")).toBe("Zeile 1\nZeile 2 ?");
  });

  it("verträgt leere Werte", () => {
    expect(pdfText(null)).toBe("");
    expect(pdfText(undefined)).toBe("");
  });

  it("entfernt Flaggen und Tag-Sequenzen ganz", () => {
    expect(pdfText("Grüße 🇩🇪!")).toBe("Grüße !");
    expect(pdfText("🏴󠁧󠁢󠁥󠁮󠁧󠁿")).toBe("");
    expect(pdfText("1️⃣ Schlüssel")).toBe("1 Schlüssel");
  });

  it("macht aus CRLF und anderen Zeilenenden \\n und entfernt Steuerzeichen", () => {
    expect(pdfText("a\r\nb\rc\u2028d")).toBe("a\nb\nc\nd");
    expect(pdfText("a\u0000b\u000bc\u0085d")).toBe("abc\nd");
  });
});
