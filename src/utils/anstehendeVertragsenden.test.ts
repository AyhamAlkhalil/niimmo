import { describe, expect, it } from 'vitest';
import { anstehendeVertragsenden, restzeitText, vertragsendeArt } from './anstehendeVertragsenden';

const v = (id: string, felder: Record<string, string | null>) => ({
  id,
  status: 'aktiv',
  start_datum: '2024-01-01',
  ende_datum: null,
  kuendigungsdatum: null,
  ...felder,
});

describe('anstehendeVertragsenden', () => {
  const stichtag = new Date(2026, 9, 30, 23, 30); // 30.10.2026, spät abends deutscher Zeit

  it('listet nur Mietenden ab heute, das früheste zuerst', () => {
    const liste = anstehendeVertragsenden(
      [
        v('a', { ende_datum: '2027-03-31' }),
        v('b', { ende_datum: '2026-10-29' }),
        v('c', { status: 'gekuendigt', ende_datum: '2026-11-30', kuendigungsdatum: '2026-11-30' }),
        v('d', {}),
        v('e', { ende_datum: '2026-10-30' }),
      ],
      stichtag
    );
    expect(liste.map((e) => e.vertrag.id)).toEqual(['e', 'c', 'a']);
    expect(liste.map((e) => e.tage)).toEqual([0, 31, 152]);
    expect(liste.map((e) => e.restzeit)).toEqual(['heute', 'in 31 Tagen', 'in 5 Monaten']);
  });

  it('nimmt das Mietende aus getVertragsende(): ende_datum führt, kuendigungsdatum nur als Ersatz', () => {
    const liste = anstehendeVertragsenden(
      [
        v('ende-fuehrt', { status: 'gekuendigt', ende_datum: '2026-10-31', kuendigungsdatum: '2026-11-30' }),
        v('nur-kuendigung', { kuendigungsdatum: '2026-12-31' }),
        v('kuendigung-vorbei', { kuendigungsdatum: '2026-10-01' }),
      ],
      stichtag
    );
    expect(liste.map((e) => [e.vertrag.id, e.ende])).toEqual([
      ['ende-fuehrt', '2026-10-31'],
      ['nur-kuendigung', '2026-12-31'],
    ]);
  });

  it('lässt beendete und noch nicht begonnene Verträge weg', () => {
    const liste = anstehendeVertragsenden(
      [
        v('beendet', { status: 'beendet', ende_datum: '2026-12-31' }),
        v('beginnt-spaeter', { start_datum: '2026-11-01', ende_datum: '2027-10-31' }),
        v('ohne-beginn', { start_datum: null, ende_datum: '2027-01-31' }),
      ],
      stichtag
    );
    expect(liste.map((e) => e.vertrag.id)).toEqual(['ohne-beginn']);
  });

  it('zählt Kalendertage auch über die Zeitumstellung genau', () => {
    // 25.10.2026 endete die Sommerzeit; 24.10. bis 26.10. sind zwei Tage
    const [eintrag] = anstehendeVertragsenden([v('x', { ende_datum: '2026-10-26' })], new Date(2026, 9, 24, 0, 30));
    expect(eintrag.tage).toBe(2);
  });

  it('behält bei gleichem Datum die Reihenfolge', () => {
    const liste = anstehendeVertragsenden(
      [v('wohnung', { ende_datum: '2026-12-31' }), v('garage', { ende_datum: '2026-12-31' })],
      stichtag
    );
    expect(liste.map((e) => e.vertrag.id)).toEqual(['wohnung', 'garage']);
  });
});

describe('vertragsendeArt', () => {
  it('Kündigung bei Kündigungsdatum oder Status gekündigt, sonst Befristung', () => {
    expect(vertragsendeArt({ status: 'aktiv', ende_datum: '2027-01-31', kuendigungsdatum: '2027-01-31' })).toBe('Kündigung');
    expect(vertragsendeArt({ status: 'gekuendigt', ende_datum: '2027-01-31' })).toBe('Kündigung');
    expect(vertragsendeArt({ status: 'aktiv', ende_datum: '2027-01-31' })).toBe('Befristung');
  });
});

describe('restzeitText', () => {
  it('bis 90 Tage taggenau, danach volle Monate, ab zwei Jahren volle Jahre', () => {
    expect(restzeitText('2026-10-30', '2026-10-30')).toBe('heute');
    expect(restzeitText('2026-10-30', '2026-10-31')).toBe('morgen');
    expect(restzeitText('2026-10-30', '2026-11-30')).toBe('in 31 Tagen');
    expect(restzeitText('2026-10-30', '2027-01-28')).toBe('in 90 Tagen');
    expect(restzeitText('2026-10-30', '2027-01-31')).toBe('in 3 Monaten');
    // Volle Monate: Am 29.01. ist der dritte Monat noch nicht voll
    expect(restzeitText('2026-10-30', '2027-01-29')).toBe('in 2 Monaten');
    expect(restzeitText('2026-10-30', '2028-10-29')).toBe('in 23 Monaten');
    expect(restzeitText('2026-10-30', '2029-12-31')).toBe('in 3 Jahren');
  });
});
