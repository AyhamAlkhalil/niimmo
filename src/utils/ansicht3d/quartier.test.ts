import { describe, it, expect } from "vitest";
import { QUARTIER_MASSE, quartierAnordnen, reihenAufteilung } from "./quartier";

describe("reihenAufteilung", () => {
  it("verteilt gleichmäßig, die vorderen Reihen nehmen den Rest", () => {
    expect(reihenAufteilung(13)).toEqual([5, 4, 4]);
    expect(reihenAufteilung(1)).toEqual([1]);
    expect(reihenAufteilung(4)).toEqual([2, 2]);
    expect(reihenAufteilung(0)).toEqual([]);
    for (const n of [1, 2, 5, 13, 30]) {
      expect(reihenAufteilung(n).reduce((s, k) => s + k, 0)).toBe(n);
    }
  });
});

describe("quartierAnordnen", () => {
  const grundstuecke = Array.from({ length: 13 }, (_, i) => ({ id: `o${i}`, breite: 4 + (i % 4) * 2, tiefe: 4 + (i % 3) }));
  const quartier = quartierAnordnen(grundstuecke);

  it("behält die Reihenfolge: hinten links beginnt es", () => {
    expect(quartier.plaetze.map((p) => p.id)).toEqual(grundstuecke.map((g) => g.id));
    const erste = quartier.plaetze.filter((p) => p.reihe === 0);
    expect(erste.map((p) => p.x)).toEqual([...erste.map((p) => p.x)].sort((a, b) => a - b));
    expect(quartier.plaetze[0].z).toBeLessThan(quartier.plaetze[12].z);
  });

  it("lässt keine Grundstücke überlappen", () => {
    const p = quartier.plaetze;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const getrennt = Math.abs(p[i].x - p[j].x) >= (p[i].breite + p[j].breite) / 2 - 1e-9 || Math.abs(p[i].z - p[j].z) >= (p[i].tiefe + p[j].tiefe) / 2 - 1e-9;
        expect(getrennt, `${p[i].id}/${p[j].id}`).toBe(true);
      }
    }
  });

  it("legt vor jede Reihe eine Straße, an die alle Grundstücke vorn stoßen", () => {
    expect(quartier.strassen).toHaveLength(3);
    for (const platz of quartier.plaetze) {
      const strasse = quartier.strassen[platz.reihe];
      expect(platz.z + platz.tiefe / 2).toBeCloseTo(strasse.z - QUARTIER_MASSE.strasse / 2);
    }
  });

  it("zentriert das Quartier und schließt es im Radius ein", () => {
    const zs = [...quartier.plaetze.map((p) => p.z - p.tiefe / 2), ...quartier.strassen.map((s) => s.z + s.breite / 2)];
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0);
    for (const p of quartier.plaetze) {
      expect(Math.hypot(Math.abs(p.x) + p.breite / 2, Math.abs(p.z) + p.tiefe / 2)).toBeLessThanOrEqual(quartier.radius + 1e-9);
    }
  });

  it("kommt mit null Grundstücken aus", () => {
    expect(quartierAnordnen([])).toEqual({ plaetze: [], strassen: [], breite: 0, tiefe: 0, radius: 0 });
  });
});
