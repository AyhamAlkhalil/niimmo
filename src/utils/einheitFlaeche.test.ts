import { describe, expect, it } from 'vitest';
import { flaecheFuerSumme, zaehltZurFlaeche } from './einheitFlaeche';

describe('einheitFlaeche', () => {
  it('zählt alle Einheiten außer Garagen und Stellplätzen zur Fläche (Kundenentscheidung 29.10.2026)', () => {
    expect(zaehltZurFlaeche('Garage')).toBe(false);
    expect(zaehltZurFlaeche('Stellplatz')).toBe(false);
    for (const typ of ['Wohnung', 'Gewerbe', 'Lager', 'Sonstiges', 'Haus (Doppelhaushälfte, Reihenhaus)', null]) {
      expect(zaehltZurFlaeche(typ)).toBe(true);
    }
    expect(flaecheFuerSumme({ qm: 21, einheitentyp: 'Garage' })).toBe(0);
    expect(flaecheFuerSumme({ qm: 45, einheitentyp: 'Lager' })).toBe(45);
    expect(flaecheFuerSumme({ qm: null, einheitentyp: 'Wohnung' })).toBe(0);
  });
});
