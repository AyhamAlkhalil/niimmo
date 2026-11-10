import { describe, expect, it } from 'vitest';

import { mieterOhneVertragTreffer, type EntwurfFuerSuche, type MieterOhneVertragRoh } from './mieterOhneVertrag';

const mieter = (id: string, vertraege: number, extra: Partial<MieterOhneVertragRoh> = {}): MieterOhneVertragRoh => ({
  id,
  vorname: 'Erika',
  nachname: 'Neu',
  firmenname: null,
  ist_unternehmen: false,
  mietvertrag_mieter: Array.from({ length: vertraege }, (_, i) => ({ mietvertrag_id: `v${i}` })),
  ...extra,
});

const entwurf: EntwurfFuerSuche = {
  einheit_id: 'e1',
  personen: [{ schluessel: 'a', mieterId: 'm1' }, { schluessel: 'b', mieterId: null }],
  einheiten: { etage: 'OG rechts', immobilie_id: 'i1', immobilien: { name: 'Mühlenweg 5' } },
};

describe('Mieter ohne Mietvertrag in der Suche (10.11.2026)', () => {
  it('zeigt nur Mieter ohne Vertrag und führt zur Einheit ihres Entwurfs', () => {
    expect(mieterOhneVertragTreffer([mieter('m1', 0), mieter('m2', 1)], [entwurf])).toEqual([
      { id: 'm1', name: 'Erika Neu', einheitId: 'e1', immobilieId: 'i1', ort: 'Mühlenweg 5 · OG rechts' },
    ]);
  });

  it('nennt einen Mieter ohne Entwurf ohne Einheit — etwa wenn der Entwurf verworfen wurde oder nur ein Admin ihn sieht', () => {
    expect(mieterOhneVertragTreffer([mieter('m9', 0)], [entwurf])).toEqual([
      { id: 'm9', name: 'Erika Neu', einheitId: null, immobilieId: null, ort: null },
    ]);
    expect(mieterOhneVertragTreffer([mieter('m1', 0)], [])[0].einheitId).toBeNull();
  });

  it('nimmt bei Firmen den Firmennamen und übersteht kaputte Personenlisten', () => {
    const firma = mieter('m1', 0, { ist_unternehmen: true, firmenname: 'Muster GmbH', vorname: '', nachname: '' });
    const kaputt: EntwurfFuerSuche = { ...entwurf, personen: [null, 'x', { mieterId: 'm1' }] };
    expect(mieterOhneVertragTreffer([firma], [kaputt])[0]).toMatchObject({ name: 'Muster GmbH', einheitId: 'e1' });
    expect(mieterOhneVertragTreffer([firma], [{ ...entwurf, personen: 'kein Array' }])[0].einheitId).toBeNull();
  });
});
