import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KAPPUNGSGRENZE_ANGESPANNT_PROZENT,
  KAPPUNGSGRENZE_REGEL_PROZENT,
  kappungsgrenzeProzent,
  maximaleKaltmiete,
  wirksamAb,
} from './mieterhoehungRegeln';

describe('Kappungsgrenze § 558 Abs. 3 BGB', () => {
  it('begrenzt im Regelfall auf 20 Prozent', () => {
    expect(kappungsgrenzeProzent(false)).toBe(20);
    expect(KAPPUNGSGRENZE_REGEL_PROZENT).toBe(20);
  });

  it('begrenzt bei angespanntem Wohnungsmarkt auf 15 Prozent', () => {
    expect(kappungsgrenzeProzent(true)).toBe(15);
    expect(KAPPUNGSGRENZE_ANGESPANNT_PROZENT).toBe(15);
  });

  it('ist im angespannten Markt strenger, nie großzügiger', () => {
    expect(kappungsgrenzeProzent(true)).toBeLessThan(kappungsgrenzeProzent(false));
  });

  it('rechnet die Höchstmiete aus der aktuellen Kaltmiete', () => {
    expect(maximaleKaltmiete(1000, false)).toBeCloseTo(1200, 2);
    expect(maximaleKaltmiete(1000, true)).toBeCloseTo(1150, 2);
    expect(maximaleKaltmiete(0, false)).toBe(0);
  });

  it('lässt die früher verwendeten 30 Prozent nicht mehr zu', () => {
    // Der Dialog rechnete bis 06.09.2026 mit 20/30 statt 15/20 Prozent.
    expect(maximaleKaltmiete(1000, false)).toBeLessThan(1300);
    expect(maximaleKaltmiete(1000, true)).toBeLessThan(1200);
  });
});

describe('Wirksamkeit § 558b BGB', () => {
  it('setzt die erhöhte Miete auf den dritten Monat nach Zugang', () => {
    // Zugang im März 2026 → erhöhte Miete ab 1. Juni 2026
    const ab = wirksamAb(new Date(2026, 2, 15));
    expect(ab.getFullYear()).toBe(2026);
    expect(ab.getMonth()).toBe(5);
    expect(ab.getDate()).toBe(1);
  });

  it('rechnet über den Jahreswechsel', () => {
    const ab = wirksamAb(new Date(2026, 10, 20)); // November 2026
    expect(ab.getFullYear()).toBe(2027);
    expect(ab.getMonth()).toBe(1); // Februar
  });

  it('liegt nie im Monat des Zugangs', () => {
    for (let m = 0; m < 12; m++) {
      const zugang = new Date(2026, m, 5);
      expect(wirksamAb(zugang).getTime()).toBeGreaterThan(zugang.getTime());
    }
  });
});

describe('Der Erhöhungsdialog nutzt die zentrale Regel', () => {
  it('rechnet nicht mehr mit eigenen Prozentwerten', () => {
    const quelle = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(quelle).toContain('kappungsgrenzeProzent');
    expect(quelle).not.toContain('istAngespannt ? 20 : 30');
    expect(quelle).not.toContain('Kappung 30%');
  });
});
