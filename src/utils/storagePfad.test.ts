import { describe, it, expect } from "vitest";
import { STORAGE_PFAD, schriftstueckPfad, dateiendung } from "./storagePfad";

const VERTRAG = "faa7c50f-dfe1-4900-b8cd-000000000001";

describe("STORAGE_PFAD", () => {
  it("erkennt Umlaute und Akzente als ungültig — daran scheiterten die Pfade mit Mieternamen", () => {
    expect(STORAGE_PFAD.test("uebergabeprotokolle/x/Uebergabeprotokoll_Einzug_Ä_Ö_ü.pdf")).toBe(false);
    expect(STORAGE_PFAD.test("mahnungen/x/Mahnung_Stufe1_é.pdf")).toBe(false);
    expect(STORAGE_PFAD.test("kuendigungen/x/Kuendigung_ß.pdf")).toBe(false);
  });
});

describe("schriftstueckPfad", () => {
  it("baut Ordner, Vertrag, Art, Datum und Uhrzeit zusammen", () => {
    expect(schriftstueckPfad("mahnungen", VERTRAG, "Mahnung_Stufe2", new Date(2026, 9, 17, 14, 22, 33))).toBe(
      `mahnungen/${VERTRAG}/Mahnung_Stufe2_2026-10-17_142233.pdf`
    );
  });

  it("ergibt für jede Uhrzeit einen gültigen Storage-Pfad", () => {
    for (const [stunde, minute] of [[0, 0], [9, 5], [23, 59]]) {
      expect(STORAGE_PFAD.test(schriftstueckPfad("kuendigungen", VERTRAG, "Kuendigung", new Date(2026, 0, 1, stunde, minute, 59)))).toBe(true);
    }
  });

  it("trennt zwei Schreiben desselben Tages", () => {
    const a = schriftstueckPfad("mieterhoehungen", VERTRAG, "Mieterhoehung", new Date(2026, 9, 17, 9, 0, 0));
    const b = schriftstueckPfad("mieterhoehungen", VERTRAG, "Mieterhoehung", new Date(2026, 9, 17, 9, 0, 1));
    expect(a).not.toBe(b);
  });
});

describe("dateiendung", () => {
  it("übernimmt eine normale Endung klein geschrieben", () => {
    expect(dateiendung("IMG_1234.HEIC", "image/heic")).toBe("heic");
    expect(dateiendung("image.jpg", "image/jpeg")).toBe("jpg");
  });

  it("nimmt ohne Punkt im Namen den MIME-Typ statt des ganzen Namens", () => {
    expect(dateiendung("Zählerfoto", "image/jpeg")).toBe("jpg");
    expect(dateiendung("foto", "image/png")).toBe("png");
    expect(dateiendung("foto", "image/png; charset=x")).toBe("png");
    expect(dateiendung("Kündigungsschreiben", "application/pdf", "pdf")).toBe("pdf");
  });

  it("fällt bei unbrauchbarer Endung und unbekanntem Typ auf den Ersatz zurück", () => {
    expect(dateiendung("bild.jpg ü", "")).toBe("jpg");
    expect(dateiendung("bild", "application/octet-stream")).toBe("jpg");
    expect(dateiendung("scan", "", "pdf")).toBe("pdf");
  });

  it("ergibt immer einen gültigen Storage-Pfad", () => {
    for (const [name, typ] of [["Küche.jpg", "image/jpeg"], ["ohne", ""], ["a.ÄÖÜ", "image/webp"]]) {
      expect(STORAGE_PFAD.test(`zaehlerfotos/${VERTRAG}/strom_einzug_1_0.${dateiendung(name, typ)}`)).toBe(true);
    }
  });
});
