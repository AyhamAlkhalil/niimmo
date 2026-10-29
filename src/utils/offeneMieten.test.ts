import { describe, expect, it } from 'vitest';
import { anzahlMieter, mieterNamenText, nachMieter } from './offeneMieten';
import type { OffeneMiete } from '@/hooks/useRueckstaende';

const vertrag = (id: string, offen: number, mieter: string[], name = mieterNamenText(mieter)): OffeneMiete => ({
  mietvertrag_id: id, mieter_name: name, immobilie_name: 'Objekt', einheit: 'Wohnung', offen, teilweise_bezahlt: false,
  mieter_ids: mieter, mieter_namen: mieter,
});

describe('nachMieter', () => {
  it('fasst die Verträge eines Mieters zusammen und sortiert nach der Summe', () => {
    const ergebnis = nachMieter([vertrag('w2', 100, ['ben']), vertrag('w1', 50, ['anna']), vertrag('g1', 60, ['anna'])]);
    expect(ergebnis.map((m) => [m.schluessel, m.offen, m.vertraege.map((v) => v.mietvertrag_id)])).toEqual([
      ['w1', 110, ['w1', 'g1']],
      ['w2', 100, ['w2']],
    ]);
    expect(nachMieter([])).toEqual([]);
  });

  it('verbindet Verträge mit einem gemeinsamen Mieter, auch wenn die Mieter nicht dieselben sind (Review)', () => {
    // Wohnung „Anna und Ben“, Garage nur Anna, Stellplatz nur Ben: ein Haushalt, eine Zeile, alle Namen
    const ergebnis = nachMieter([vertrag('g', 60, ['anna']), vertrag('s', 40, ['ben']), vertrag('w', 900, ['anna', 'ben'])]);
    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0]).toMatchObject({ mieter_name: 'anna und ben', offen: 1000 });
    expect(ergebnis[0].vertraege.map((v) => v.mietvertrag_id)).toEqual(['g', 's', 'w']);
    expect(anzahlMieter([vertrag('g', 60, ['anna']), vertrag('w', 900, ['anna', 'ben']), vertrag('x', 5, ['carl'])])).toBe(2);
    // Über einen gemeinsamen Mieter verkettet: alle Namen zählen, ab drei „u. a.“
    expect(nachMieter([vertrag('v4', 700, ['ben', 'carla']), vertrag('v5', 650, ['carla', 'dora'])])[0].mieter_name).toBe('ben u. a.');
  });

  it('schreibt die Namen wie bisher', () => {
    expect(mieterNamenText([])).toBe('Unbekannt');
    expect(mieterNamenText(['Anna Berg'])).toBe('Anna Berg');
    expect(mieterNamenText(['Anna Berg', 'Ben Berg'])).toBe('Anna Berg und Ben Berg');
    expect(mieterNamenText(['Anna Berg', 'Ben Berg', 'Carl Berg'])).toBe('Anna Berg u. a.');
  });

  it('lässt Verträge ohne Mieter für sich stehen', () => {
    expect(anzahlMieter([vertrag('a', 10, [], 'Unbekannt'), vertrag('b', 20, [], 'Unbekannt')])).toBe(2);
  });

  it('rechnet die Summe auf den Cent', () => {
    expect(nachMieter([vertrag('a', 0.1, ['x']), vertrag('b', 0.2, ['x'])])[0].offen).toBe(0.3);
  });
});
