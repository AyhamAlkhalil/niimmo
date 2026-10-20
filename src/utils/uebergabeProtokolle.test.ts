import { describe, it, expect } from "vitest";
import { letzteProtokolle, protokollArt } from "./uebergabeProtokolle";

describe("protokollArt", () => {
  it("liest die Art aus Titel oder Pfad", () => {
    expect(protokollArt("Übergabeprotokoll (Einzug) – 17.04.2026", null)).toBe("einzug");
    expect(protokollArt(null, "uebergabeprotokolle/v/Uebergabeprotokoll_Auszug_2026-10-16_162903.pdf")).toBe("auszug");
    expect(protokollArt("20250630 Übergabeprotokoll Auszug.pdf", "x/1754.pdf")).toBe("auszug");
  });

  it("lässt offen, was keine oder beide Arten nennt", () => {
    expect(protokollArt("Übergabeprotokoll.pdf", "x.pdf")).toBeNull();
    expect(protokollArt("Einzug und Auszug", null)).toBeNull();
  });
});

describe("letzteProtokolle", () => {
  it("nimmt je Vertrag und Art das jüngste PDF, Fotos nicht", () => {
    const m = letzteProtokolle([
      { mietvertrag_id: "v1", titel: "Übergabeprotokoll (Einzug) – 01.04.2026", pfad: "a.pdf", dateityp: "application/pdf", hochgeladen_am: "2026-04-01T10:00:00Z" },
      { mietvertrag_id: "v1", titel: "Übergabeprotokoll (Einzug) – 17.04.2026", pfad: "b.pdf", dateityp: "application/pdf", hochgeladen_am: "2026-04-17T10:00:00Z" },
      { mietvertrag_id: "v1", titel: "Zähler Strom (Auszug) – 30.09.2026", pfad: "zaehlerfotos/v1/strom.jpg", dateityp: null, hochgeladen_am: "2026-09-30T10:00:00Z" },
      { mietvertrag_id: "v2", titel: "20250630 Übergabeprotokoll Auszug.pdf", pfad: "v2/1754.pdf", dateityp: null, hochgeladen_am: "2025-08-04T09:00:00Z" },
      { mietvertrag_id: null, titel: "Übergabeprotokoll (Einzug)", pfad: "c.pdf", dateityp: "application/pdf", hochgeladen_am: "2026-01-01T00:00:00Z" },
    ]);
    expect(m.get("v1")).toEqual({ einzug: "2026-04-17T10:00:00Z" });
    expect(m.get("v2")).toEqual({ auszug: "2025-08-04T09:00:00Z" });
    expect(m.size).toBe(2);
  });
});
