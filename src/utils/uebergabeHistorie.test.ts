import { describe, it, expect } from "vitest";
import { artNachDatum, protokolleErgaenzen, uebergabeArt, uebergabenJeVertrag, type UebergabeAblesung } from "./uebergabeHistorie";

const ablesung = (teil: Partial<UebergabeAblesung>): UebergabeAblesung => ({
  id: Math.random().toString(36).slice(2),
  zaehler_typ: "strom",
  stand: 100,
  datum: "2026-10-01",
  quelle: "Übergabe (Einzug)",
  mietvertrag_id: null,
  protokoll_pfad: null,
  foto_pfad: null,
  erfassung: null,
  zaehler_nummer: null,
  ...teil,
});

const ALT = { id: "alt", start: "2023-02-01", ende: "2026-09-30" };
const NEU = { id: "neu", start: "2026-10-01", ende: null };

describe("uebergabeArt", () => {
  it("kennt nur die beiden Übergabe-Quellen", () => {
    expect(uebergabeArt("Übergabe (Einzug)")).toBe("einzug");
    expect(uebergabeArt("Übergabe (Auszug)")).toBe("auszug");
    expect(uebergabeArt("einzug")).toBeNull();
    expect(uebergabeArt("manuell")).toBeNull();
    expect(uebergabeArt(null)).toBeNull();
  });
});

describe("uebergabenJeVertrag", () => {
  it("ordnet nach dem eingetragenen Vertrag und gruppiert je Übergabe", () => {
    const m = uebergabenJeVertrag(
      [ALT, NEU],
      [
        ablesung({ mietvertrag_id: "neu", zaehler_typ: "strom", protokoll_pfad: null }),
        ablesung({ mietvertrag_id: "neu", zaehler_typ: "kaltwasser", protokoll_pfad: "p/einzug.pdf" }),
      ]
    );
    expect(m.get("neu")).toHaveLength(1);
    expect(m.get("neu")![0]).toMatchObject({ art: "einzug", datum: "2026-10-01", protokollPfad: "p/einzug.pdf" });
    expect(m.get("neu")![0].ablesungen).toHaveLength(2);
  });

  it("ordnet ältere Einträge ohne Vertrag über das Datum zu: Auszug zum endenden, Einzug zum beginnenden", () => {
    const m = uebergabenJeVertrag(
      [ALT, NEU],
      [ablesung({ quelle: "Übergabe (Auszug)" }), ablesung({ quelle: "Übergabe (Einzug)" })]
    );
    expect(m.get("alt")?.map((e) => e.art)).toEqual(["auszug"]);
    expect(m.get("neu")?.map((e) => e.art)).toEqual(["einzug"]);
  });

  it("lässt zu weit entfernte Einträge ohne Vertrag stehen statt zu raten", () => {
    const m = uebergabenJeVertrag([ALT, NEU], [ablesung({ quelle: "Übergabe (Einzug)", datum: "2025-01-01" })]);
    expect(m.get(null)).toHaveLength(1);
  });

  it("rät nicht, wenn zwei Verträge gleich nah liegen", () => {
    const m = uebergabenJeVertrag(
      [{ id: "a", start: "2026-10-01", ende: null }, { id: "b", start: "2026-10-01", ende: null }],
      [ablesung({ quelle: "Übergabe (Einzug)", datum: "2026-10-01" })]
    );
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBeUndefined();
    expect(m.get(null)).toHaveLength(1);
  });

  it("übergeht andere Quellen und sortiert Einzug vor Auszug am selben Tag", () => {
    const m = uebergabenJeVertrag(
      [ALT, NEU],
      [
        ablesung({ mietvertrag_id: "alt", quelle: "Übergabe (Auszug)", datum: "2026-10-01" }),
        ablesung({ mietvertrag_id: "alt", quelle: "Übergabe (Einzug)", datum: "2023-02-01" }),
        ablesung({ mietvertrag_id: "alt", quelle: "manuell", datum: "2024-01-01" }),
      ]
    );
    expect(m.get("alt")?.map((e) => `${e.art} ${e.datum}`)).toEqual(["einzug 2023-02-01", "auszug 2026-10-01"]);
  });
});

describe("protokolleErgaenzen", () => {
  it("zeigt ein Protokoll ohne Ablesung als eigene Übergabe", () => {
    const m = protokolleErgaenzen(new Map(), [{ mietvertrag_id: "alt", art: "auszug", datum: "2025-08-31", pfad: "p/a.pdf" }]);
    expect(m.get("alt")).toEqual([{ art: "auszug", datum: "2025-08-31", ablesungen: [], protokollPfad: "p/a.pdf" }]);
  });

  it("nimmt kein Protokoll doppelt, auf das eine Ablesung schon verweist", () => {
    const vorher = uebergabenJeVertrag([NEU], [ablesung({ mietvertrag_id: "neu", protokoll_pfad: "p/e.pdf" })]);
    const m = protokolleErgaenzen(vorher, [{ mietvertrag_id: "neu", art: "einzug", datum: "2026-10-01", pfad: "p/e.pdf" }]);
    expect(m.get("neu")).toHaveLength(1);
  });

  it("hängt das Protokoll an eine Übergabe desselben Tags ohne Protokoll", () => {
    const vorher = uebergabenJeVertrag([NEU], [ablesung({ mietvertrag_id: "neu" })]);
    const m = protokolleErgaenzen(vorher, [{ mietvertrag_id: "neu", art: "einzug", datum: "2026-10-01", pfad: "p/hand.pdf" }]);
    expect(m.get("neu")).toHaveLength(1);
    expect(m.get("neu")![0].protokollPfad).toBe("p/hand.pdf");
    expect(vorher.get("neu")![0].protokollPfad).toBeNull();
  });

  it("sortiert nach Datum, Einzug vor Auszug", () => {
    const m = protokolleErgaenzen(new Map(), [
      { mietvertrag_id: "v", art: "auszug", datum: "2026-10-01", pfad: "b" },
      { mietvertrag_id: "v", art: "einzug", datum: "2023-02-01", pfad: "a" },
    ]);
    expect(m.get("v")?.map((e) => e.protokollPfad)).toEqual(["a", "b"]);
  });
});

describe("artNachDatum", () => {
  it("ordnet ein Protokoll ohne Art dem nahen Beginn oder Ende zu", () => {
    expect(artNachDatum("2023-02-03", ALT)).toBe("einzug");
    expect(artNachDatum("2026-10-02", ALT)).toBe("auszug");
  });

  it("rät nicht bei großem Abstand, Gleichstand oder fehlendem Vertrag", () => {
    expect(artNachDatum("2024-06-01", ALT)).toBeNull();
    expect(artNachDatum("2026-10-02", { id: "x", start: "2026-10-01", ende: "2026-10-03" })).toBeNull();
    expect(artNachDatum("2026-10-02", undefined)).toBeNull();
  });
});

describe("protokolleErgaenzen: dieselbe Übergabe", () => {
  it("legt einen Scan wenige Tage neben dem erzeugten Protokoll nicht als zweite Übergabe an", () => {
    const m = protokolleErgaenzen(new Map(), [
      { mietvertrag_id: "alt", art: "auszug", datum: "2025-08-31", pfad: "p/erzeugt.pdf" },
      { mietvertrag_id: "alt", art: "auszug", datum: "2025-08-30", pfad: "p/scan.pdf" },
    ]);
    expect(m.get("alt")).toHaveLength(1);
  });
});
