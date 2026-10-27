import { describe, expect, it } from 'vitest';

import { vertragsReihenfolge } from './vertragsmieter';

const kurz = (r: ReturnType<typeof vertragsReihenfolge>) =>
  r.map(m => [m.quelle.art === 'neu' ? `neu${m.quelle.index}` : m.quelle.id, m.position, m.rolle]);

describe('vertragsReihenfolge', () => {
  it('stellt den gewählten neuen Mieter vor alle anderen', () => {
    expect(kurz(vertragsReihenfolge(2, ['b1'], { art: 'neu', index: 1 }))).toEqual([
      ['neu1', 1, 'Hauptmieter'],
      ['neu0', 2, 'Zweitmieter'],
      ['b1', 3, 'Drittmieter'],
    ]);
  });

  it('stellt den gewählten bestehenden Mieter vor alle anderen', () => {
    expect(kurz(vertragsReihenfolge(1, ['b1', 'b2'], { art: 'bestand', id: 'b2' }))).toEqual([
      ['b2', 1, 'Hauptmieter'],
      ['neu0', 2, 'Zweitmieter'],
      ['b1', 3, 'Drittmieter'],
    ]);
  });

  it('nimmt ohne Wahl den ersten neuen, ohne neue den ersten bestehenden', () => {
    expect(kurz(vertragsReihenfolge(2, ['b1'], null))[0]).toEqual(['neu0', 1, 'Hauptmieter']);
    expect(kurz(vertragsReihenfolge(0, ['b1', 'b2'], null))).toEqual([
      ['b1', 1, 'Hauptmieter'],
      ['b2', 2, 'Zweitmieter'],
    ]);
  });

  it('fällt zurück, wenn der Gewählte nicht mehr im Vertrag steht', () => {
    // abgewählter Bestandsmieter, entfernte oder geleerte Karte
    expect(kurz(vertragsReihenfolge(0, ['b1'], { art: 'bestand', id: 'weg' }))).toEqual([['b1', 1, 'Hauptmieter']]);
    expect(kurz(vertragsReihenfolge(1, ['b1'], { art: 'neu', index: 3 }))[0]).toEqual(['neu0', 1, 'Hauptmieter']);
    expect(kurz(vertragsReihenfolge(0, ['b1'], { art: 'neu', index: 0 }))[0]).toEqual(['b1', 1, 'Hauptmieter']);
  });

  it('hat immer genau einen Hauptmieter und lückenlose Positionen', () => {
    const r = vertragsReihenfolge(3, ['b1', 'b2'], { art: 'bestand', id: 'b2' });
    expect(r.filter(m => m.rolle === 'Hauptmieter')).toHaveLength(1);
    expect(r.map(m => m.position)).toEqual([1, 2, 3, 4, 5]);
    expect(vertragsReihenfolge(0, [], null)).toEqual([]);
  });
});
