import { describe, expect, it } from "vitest";
import { downloadDateiname, endungAusPfad } from "./dokumentDateiname";

describe("endungAusPfad", () => {
  it("liest die Endung aus dem letzten Pfadteil", () => {
    expect(endungAusPfad("mietvertrag/abc/1730000000000.pdf")).toBe("pdf");
    expect(endungAusPfad("uebergabe/abc/Foto.JPG")).toBe("jpg");
    expect(endungAusPfad("a.b/c/datei.docx")).toBe("docx");
  });

  it("liefert null ohne erkennbare Endung", () => {
    expect(endungAusPfad("ordner.mit.punkt/datei")).toBeNull();
    expect(endungAusPfad("ordner/.versteckt")).toBeNull();
    expect(endungAusPfad("ordner/datei.")).toBeNull();
    expect(endungAusPfad("ordner/datei.viel-zu-lang")).toBeNull();
    expect(endungAusPfad("")).toBeNull();
    expect(endungAusPfad(null)).toBeNull();
    expect(endungAusPfad(undefined)).toBeNull();
  });
});

describe("downloadDateiname", () => {
  it("hängt die Endung an einen Titel mit Datum am Ende an (Befund: „.2026“ als Endung)", () => {
    expect(downloadDateiname("Übergabeprotokoll – 01.10.2026", "uebergabe/x/1.pdf")).toBe(
      "Übergabeprotokoll – 01.10.2026.pdf"
    );
  });

  it("lässt einen Titel, der die Endung schon trägt, unverändert", () => {
    expect(downloadDateiname("Mietvertrag.pdf", "a/b.pdf")).toBe("Mietvertrag.pdf");
    expect(downloadDateiname("Scan.PDF", "a/b.pdf")).toBe("Scan.PDF");
  });

  it("hängt die Endung auch an, wenn der Titel eine andere trägt", () => {
    expect(downloadDateiname("Rechnung.docx", "a/b.pdf")).toBe("Rechnung.docx.pdf");
  });

  it("lässt den Titel stehen, wenn der Pfad keine Endung hat", () => {
    expect(downloadDateiname("Notiz – 01.10.2026", "a/ohne-endung")).toBe("Notiz – 01.10.2026");
  });

  it("nimmt ohne Titel den Dateinamen aus dem Pfad", () => {
    expect(downloadDateiname("", "a/b/Mietvertrag_2026.pdf")).toBe("Mietvertrag_2026.pdf");
    expect(downloadDateiname(null, "a/b/scan.png")).toBe("scan.png");
  });

  it("fällt ohne Titel und Pfad auf „dokument“ zurück", () => {
    expect(downloadDateiname(null, null)).toBe("dokument");
    expect(downloadDateiname("  ", "")).toBe("dokument");
  });

  it("schneidet Leerzeichen am Rand des Titels ab", () => {
    expect(downloadDateiname("  Kündigung  ", "a/b.pdf")).toBe("Kündigung.pdf");
  });
});
