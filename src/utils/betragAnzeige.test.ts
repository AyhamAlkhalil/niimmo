import { describe, expect, it } from "vitest";
import { formatBetragKompakt, formatEuroKompakt } from "./betragAnzeige";

describe("formatBetragKompakt", () => {
  it("zeigt runde Beträge ohne Cent", () => {
    expect(formatBetragKompakt(34000)).toBe("34.000");
    expect(formatBetragKompakt(0)).toBe("0");
    expect(formatBetragKompakt(-1200)).toBe("-1.200");
  });

  it("zeigt Cent immer zweistellig", () => {
    expect(formatBetragKompakt(2666.4)).toBe("2.666,40");
    expect(formatBetragKompakt(0.4)).toBe("0,40");
    expect(formatBetragKompakt(725.5)).toBe("725,50");
    expect(formatBetragKompakt(12.345)).toBe("12,35");
  });

  it("rundet Gleitkomma-Reste nicht zu Cent auf", () => {
    expect(formatBetragKompakt(0.1 + 0.2)).toBe("0,30");
    expect(formatBetragKompakt(1999.999)).toBe("2.000");
  });

  it("meldet unlesbare Werte als Strich", () => {
    expect(formatBetragKompakt(Number.NaN)).toBe("–");
    expect(formatBetragKompakt(Number.POSITIVE_INFINITY)).toBe("–");
  });
});

describe("formatEuroKompakt", () => {
  it("hängt das Eurozeichen mit geschütztem Leerzeichen an", () => {
    expect(formatEuroKompakt(34000)).toBe("34.000\u00a0€");
    expect(formatEuroKompakt(2666.4)).toBe("2.666,40\u00a0€");
  });

  it("zeigt bei unlesbaren Werten nur den Strich", () => {
    expect(formatEuroKompakt(Number.NaN)).toBe("–");
  });
});
