import { describe, expect, it, vi } from "vitest";

// standImEntwurf lebt in der Komponente (ZaehlerVerwaltung.tsx), die auch das Objektdetail nutzt.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { standImEntwurf } from "@/components/dashboard/ZaehlerVerwaltung";

// 28.10.2026: Ein neuer Zählerstand wurde mit dem Datum der vorigen Ablesung gespeichert.

const HEUTE = "2026-10-28";
const original = { stand: "1234.5", datum: "2025-12-31" };
const entwurf = { kaltwasser_zaehler: "KW-1", kaltwasser_stand: "1234.5", kaltwasser_datum: "2025-12-31" };

describe("standImEntwurf", () => {
  it("setzt das Datum auf heute, wenn sich der Stand ändert und noch das alte Datum im Feld steht", () => {
    const neu = standImEntwurf(entwurf, "kaltwasser", "1300", original, HEUTE);
    expect(neu.kaltwasser_stand).toBe("1300");
    expect(neu.kaltwasser_datum).toBe(HEUTE);
    expect(neu.kaltwasser_zaehler).toBe("KW-1");
  });

  it("lässt ein bewusst geändertes Datum stehen", () => {
    const mitDatum = { ...entwurf, kaltwasser_datum: "2026-10-01" };
    expect(standImEntwurf(mitDatum, "kaltwasser", "1300", original, HEUTE).kaltwasser_datum).toBe("2026-10-01");
  });

  it("setzt das Datum zurück, wenn der alte Stand wieder eingetragen wird", () => {
    const geaendert = standImEntwurf(entwurf, "kaltwasser", "1300", original, HEUTE);
    const zurueck = standImEntwurf(geaendert, "kaltwasser", "1234.5", original, HEUTE);
    expect(zurueck.kaltwasser_datum).toBe("2025-12-31");
  });

  it("füllt ein leeres Datum beim ersten Stand mit heute", () => {
    const leer = { gas_stand: "", gas_datum: "" };
    expect(standImEntwurf(leer, "gas", "17", { stand: "", datum: "" }, HEUTE).gas_datum).toBe(HEUTE);
  });

  it("ändert nichts am Datum, wenn die alte Ablesung von heute ist", () => {
    const vonHeute = { strom_stand: "50", strom_datum: HEUTE };
    expect(standImEntwurf(vonHeute, "strom", "55", { stand: "50", datum: HEUTE }, HEUTE).strom_datum).toBe(HEUTE);
    expect(standImEntwurf(vonHeute, "strom", "50", { stand: "50", datum: HEUTE }, HEUTE).strom_datum).toBe(HEUTE);
  });
});

describe("standImEntwurf vergleicht numerisch (Review 28.10.2026)", () => {
  it("hält „1234.50“ und „1234,5“ für denselben Stand und lässt das Datum stehen", () => {
    expect(standImEntwurf(entwurf, "kaltwasser", "1234.50", original, HEUTE).kaltwasser_datum).toBe("2025-12-31");
    expect(standImEntwurf(entwurf, "kaltwasser", "1234,5", original, HEUTE).kaltwasser_datum).toBe("2025-12-31");
  });

  it("setzt das automatisch gesetzte Datum auch bei anderer Schreibweise des alten Stands zurück", () => {
    const geaendert = standImEntwurf(entwurf, "kaltwasser", "1300", original, HEUTE);
    expect(standImEntwurf(geaendert, "kaltwasser", "1234.50", original, HEUTE).kaltwasser_datum).toBe("2025-12-31");
  });
});

describe("gleicherStand", () => {
  it("vergleicht Zahlen statt Text", async () => {
    const { gleicherStand } = await import("@/components/dashboard/ZaehlerVerwaltung");
    expect(gleicherStand("1234.50", "1234.5")).toBe(true);
    expect(gleicherStand("1.234,5", "1234.5")).toBe(true);
    expect(gleicherStand("1234.51", "1234.5")).toBe(false);
    expect(gleicherStand("", "")).toBe(true);
    expect(gleicherStand("", "0")).toBe(false);
    expect(gleicherStand("12.345.678", "12.345.678")).toBe(true);
  });
});
