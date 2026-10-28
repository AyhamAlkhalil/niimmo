import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basiszinsPeriodenBeginn, leseMarktwert, marktdatenKorrektur, vorgeschlagenerVpiMonat } from './marktdatenKorrektur';
import { getBasiszinssatz } from './verzugszinsen';
import { normalisiereDezimalEingabe } from './decimalInput';

/**
 * Prüfung 28.10.2026: Die Korrektur auf der Startseite schrieb mit stichtag = heute, ungeprüft
 * („1,52“ → 152) und ohne Fehlerauswertung; die Hooks für Mahnung und Mieterhöhung luden nicht neu.
 */
describe('Marktdaten-Korrektur', () => {
  const heute = new Date(2026, 9, 28);

  it('liest nur plausible Werte, auch einen negativen Basiszins', () => {
    expect(leseMarktwert('basiszinssatz', '1.52')).toBe(1.52);
    expect(leseMarktwert('basiszinssatz', '-0.88')).toBe(-0.88);
    expect(leseMarktwert('basiszinssatz', '152')).toBeUndefined();
    expect(leseMarktwert('basiszinssatz', '')).toBeUndefined();
    expect(leseMarktwert('vpi', '125.6')).toBe(125.6);
    expect(leseMarktwert('vpi', '1.256')).toBeUndefined();
    expect(leseMarktwert('vpi', '1256')).toBeUndefined();
  });

  it('schreibt den Basiszins ab Beginn des Halbjahrs für jeden Monatsersten bis heute', () => {
    expect(basiszinsPeriodenBeginn(heute)).toBe('2026-07-01');
    expect(basiszinsPeriodenBeginn(new Date(2026, 5, 30))).toBe('2026-01-01');
    const ergebnis = marktdatenKorrektur('basiszinssatz', '1.27', heute);
    expect('zeilen' in ergebnis && ergebnis.zeilen.map((z) => z.stichtag)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
    const januar = marktdatenKorrektur('basiszinssatz', '1.27', new Date(2026, 0, 2));
    expect('zeilen' in januar && januar.zeilen.map((z) => z.stichtag)).toEqual(['2026-01-01']);
  });

  it('gilt damit für jeden Tag des Halbjahrs, auch zwischen den amtlichen Monatszeilen', () => {
    // Live am 28.10.2026: Basiszins-Zeilen je Monatserster (fetch-marktdaten)
    const amtlich = ['2026-10-01', '2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01'].map((ab) => ({ ab, satz: 1.52 }));
    const ergebnis = marktdatenKorrektur('basiszinssatz', '1.27', heute);
    if (!('zeilen' in ergebnis)) throw new Error(ergebnis.fehler);
    const korrigiert = amtlich.map((p) => ergebnis.zeilen.find((z) => z.stichtag === p.ab) ? { ab: p.ab, satz: 1.27 } : p);
    expect(getBasiszinssatz(new Date(2026, 6, 15), korrigiert)).toBe(1.27);
    expect(getBasiszinssatz(new Date(2026, 9, 28), korrigiert)).toBe(1.27);
    expect(getBasiszinssatz(new Date(2026, 5, 30), korrigiert)).toBe(1.52);
  });

  it('schreibt den VPI zum gewählten Bezugsmonat, nicht zum heutigen Tag', () => {
    expect(marktdatenKorrektur('vpi', '125.9', heute, '2026-08')).toEqual({ zeilen: [{ typ: 'vpi', wert: 125.9, stichtag: '2026-08-01' }] });
    expect(marktdatenKorrektur('vpi', '125.9', heute, '2026-11')).toHaveProperty('fehler');
    expect(marktdatenKorrektur('vpi', '125.9', heute, '')).toHaveProperty('fehler');
    expect(marktdatenKorrektur('vpi', '12590', heute, '2026-08')).toHaveProperty('fehler');
  });

  it('schlägt den Monat nach dem letzten Wert vor, höchstens den laufenden', () => {
    expect(vorgeschlagenerVpiMonat('2026-07-01', heute)).toBe('2026-08');
    expect(vorgeschlagenerVpiMonat('2025-12-01', new Date(2026, 0, 10))).toBe('2026-01');
    expect(vorgeschlagenerVpiMonat('2026-10-01', heute)).toBe('2026-10');
    expect(vorgeschlagenerVpiMonat(null, heute)).toBe('2026-10');
  });
});

describe('Startseite: Korrektur und Mietsummen', () => {
  const quelle = readFileSync('src/components/dashboard/DashboardStats.tsx', 'utf-8');

  it('nutzt ui/input, wertet den Fehler aus und lädt alle Marktdaten-Hooks neu', () => {
    expect(quelle).not.toMatch(/<input\s+type="number"/);
    expect(quelle).not.toMatch(/parseFloat\(editWert\)/);
    expect(quelle).toContain("const { error } = await (supabase as any).from('marktdaten').upsert(");
    expect(quelle).toContain('queryClient.invalidateQueries({ queryKey: BASISZINS_PERIODEN_KEY });');
    expect(quelle).toContain('queryClient.invalidateQueries({ queryKey: AKTUELLER_VPI_KEY });');
    const hook = readFileSync('src/hooks/useBasiszinsPerioden.ts', 'utf-8');
    expect(hook).toContain('queryKey: BASISZINS_PERIODEN_KEY,');
    expect(hook).toContain('queryKey: AKTUELLER_VPI_KEY,');
  });

  it('filtert nicht nach kuendigungsdatum und summiert je Einheit den laufenden Vertrag', () => {
    expect(quelle).not.toMatch(/kuendigungsdatum\.gte/);
    expect(quelle).toContain('summiereLaufendeMieten(mietvertraege)');
    expect(quelle).not.toMatch(/relevanteVertraege\.reduce\(\(sum, v\) => sum \+ \(v\.kaltmiete/);
  });
});

describe('Marktdaten-Korrektur: Eingabe wie im Feld (Review/QA 28.10.2026)', () => {
  it('liest einen negativen Basiszins mit Komma, so wie ui/input ihn normalisiert', () => {
    expect(normalisiereDezimalEingabe('-0,88')).toBe('-0.88');
    expect(leseMarktwert('basiszinssatz', normalisiereDezimalEingabe('-0,88'))).toBe(-0.88);
    expect(leseMarktwert('basiszinssatz', normalisiereDezimalEingabe('1,52'))).toBe(1.52);
  });

  it('lehnt den Chrome-Zwischenwert „0002-10“ als Bezugsmonat ab', () => {
    expect(marktdatenKorrektur('vpi', '125.9', new Date(2026, 9, 28), '0002-10')).toHaveProperty('fehler');
    expect(marktdatenKorrektur('vpi', '125.9', new Date(2026, 9, 28), '1999-12')).toHaveProperty('fehler');
    expect(marktdatenKorrektur('vpi', '125.9', new Date(2026, 9, 28), '2000-01')).not.toHaveProperty('fehler');
  });

  it('die Startseite lädt einheit_id mit — ohne sie zählte summiereLaufendeMieten je Vertrag', () => {
    const quelle = readFileSync('src/components/dashboard/DashboardStats.tsx', 'utf-8');
    const abfrage = quelle.slice(quelle.indexOf("queryKey: ['alle-mietvertrag']"), quelle.indexOf("queryKey: ['erfasste-miete']"));
    expect(abfrage).toMatch(/\.select\(`[\s\S]*?\beinheit_id,[\s\S]*?`\)/);
  });
});
