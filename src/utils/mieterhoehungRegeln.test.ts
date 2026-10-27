import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KAPPUNGSGRENZE_ANGESPANNT_PROZENT,
  KAPPUNGSGRENZE_REGEL_PROZENT,
  kappungsgrenzeProzent,
  maximaleKaltmiete,
  neueMieteAusEingabe,
  wirksamAb,
  wirksamAbTag,
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

  it('speichert den Monatsersten als Kalendertag, nicht den Vortag', () => {
    // 27.10.2026: toISOString() ergab in deutscher Zeit '2026-12-31'
    expect(wirksamAbTag(new Date(2026, 9, 27, 10))).toBe('2027-01-01');
    expect(wirksamAbTag(new Date(2026, 2, 15, 0, 30))).toBe('2026-06-01');
    expect(wirksamAbTag(new Date(2026, 6, 1, 23, 59))).toBe('2026-10-01');
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

describe('neueMieteAusEingabe', () => {
  it('nimmt Beträge an, Betriebskosten auch mit 0', () => {
    expect(neueMieteAusEingabe('812.50', '0')).toEqual({ kaltmiete: 812.5, betriebskosten: 0 });
    expect(neueMieteAusEingabe('812,50', '120')).toEqual({ kaltmiete: 812.5, betriebskosten: 120 });
  });

  it('meldet leere Felder statt 0 € oder NaN ins Schreiben und an den Vertrag zu geben', () => {
    // 27.10.2026: parseFloat('') || 0 — geleerte BK wurden mit Haken „zugestimmt“ zu 0 € am Vertrag
    expect(neueMieteAusEingabe('812.50', '')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('', '120')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('0', '120')).toHaveProperty('fehler');
    expect(neueMieteAusEingabe('-5', '120')).toHaveProperty('fehler');
  });

  it('nennt bei einem Tausenderpunkt den Grund statt „bitte eintragen“', () => {
    // Review 27.10.2026: „1.000,50“ ist gefüllt, aber nicht lesbar
    expect(neueMieteAusEingabe('1.000,50', '120')).toEqual({ fehler: expect.stringMatching(/ohne Tausenderpunkt/) });
    expect(neueMieteAusEingabe('1000,50', '1.200,00')).toEqual({ fehler: expect.stringMatching(/Betriebskosten.*ohne Tausenderpunkt/) });
  });

  it('wird vor Download und Speichern geprüft, der Dokumenteintrag ist nicht mehr ungeprüft', () => {
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toMatch(/if \(!pdfBlob \|\| !pruefeNeueMiete\(\)\) return;/);
    expect(modal).toMatch(/const neueMiete = pruefeNeueMiete\(\);\s*if \(!neueMiete\) return;/);
    expect(modal).not.toMatch(/parseFloat\(neueBetriebskosten\) \|\| 0,\s*\n\s*(letzte_mieterhoehung_am|begruendungsart)/);
    expect(modal).toMatch(/if \(dokumentError\) throw dokumentError;/);
  });
});
