import { describe, expect, it } from 'vitest';

import {
  angelegteMieterAusAnderen,
  entwurfsMieterIds,
  leseLoeschErgebnis,
  loeschErgebnisText,
  mieterOhneVertragTreffer,
  namensAufzaehlung,
  type EntwurfFuerSuche,
  type MieterOhneVertragRoh,
} from './mieterOhneVertrag';

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

describe('Mieter ohne Mietvertrag löschen (10.11.2026)', () => {
  it('sammelt die Mieterdatensätze eines Entwurfs je einmal und übersteht kaputte Listen', () => {
    expect(entwurfsMieterIds([{ mieterId: 'm1' }, { mieterId: null }, { mieterId: 'm1' }, { mieterId: ' ' }, { mieterId: 'm2' }])).toEqual(['m1', 'm2']);
    expect(entwurfsMieterIds([null, 'x', 7, { mieterId: 5 }])).toEqual([]);
    expect(entwurfsMieterIds('kein Array')).toEqual([]);
    expect(entwurfsMieterIds(undefined)).toEqual([]);
  });

  it('nennt beim Aktivieren die Mieter der mitverworfenen Entwürfe, die im aktivierten Vertrag nicht stehen', () => {
    const andere = [
      { personen: [{ mieterId: 'm1', vorname: 'Erika', nachname: 'Neu' }, { mieterId: null, vorname: 'Ohne', nachname: 'Datensatz' }] },
      { personen: [{ mieterId: 'm2', vorname: '', nachname: '', istUnternehmen: true, firmenname: 'Muster GmbH' }, { mieterId: 'm3', vorname: 'Max', nachname: 'Aktiv' }] },
      { personen: [{ mieterId: 'm1', vorname: 'Erika', nachname: 'Neu' }] },
    ];
    // m3 steht auch im aktivierten Entwurf: Er bekommt dort seinen Vertrag und gehört nicht in den Hinweis
    expect(angelegteMieterAusAnderen(andere, [{ mieterId: 'm3' }])).toEqual(['Erika Neu', 'Muster GmbH']);
    expect(angelegteMieterAusAnderen([], [])).toEqual([]);
  });

  it('übergeht leere oder fremde IDs und setzt Namen sauber zusammen (QA 10.11.2026)', () => {
    const andere = [
      { personen: [{ mieterId: '   ', vorname: 'Leer' }, { mieterId: 5 as unknown as string, vorname: 'Zahl' }, { mieterId: 'm1', vorname: ' Anna ', nachname: ' Alt ' }] },
    ];
    expect(angelegteMieterAusAnderen(andere, [{ mieterId: null }])).toEqual(['Anna Alt']);
  });

  it('liest die Antwort der Datenbankfunktion und übersteht eine unerwartete Form', () => {
    expect(
      leseLoeschErgebnis({
        geloescht: [{ id: 'm1', name: 'Erika Neu' }, { name: 'ohne ID' }],
        behalten: [{ id: 'm2', name: 'Max Aktiv', grund: 'hat einen Mietvertrag' }, { id: 'm3' }],
      })
    ).toEqual({
      geloescht: [{ id: 'm1', name: 'Erika Neu' }],
      behalten: [
        { id: 'm2', name: 'Max Aktiv', grund: 'hat einen Mietvertrag' },
        { id: 'm3', name: 'Ohne Namen', grund: 'unbekannter Grund' },
      ],
    });
    expect(leseLoeschErgebnis({ geloescht: [], behalten: [] })).toEqual({ geloescht: [], behalten: [] });
  });

  it('wirft bei unerwarteter Antwort, statt „schon gelöscht“ zu melden', () => {
    for (const kaputt of [null, undefined, 'x', [], {}, { geloescht: [] }, { geloescht: 'x', behalten: 3 }]) {
      expect(() => leseLoeschErgebnis(kaputt)).toThrow('Unerwartete Antwort');
    }
  });

  it('meldet Gelöschte und Behaltene je in einem Satz, ein schon gelöschter Mieter ist kein Fehler', () => {
    expect(loeschErgebnisText({ geloescht: [{ id: 'm1', name: 'Erika Neu' }], behalten: [] })).toBe(
      'Erika Neu ist aus dem Mieterbestand gelöscht.'
    );
    expect(
      loeschErgebnisText({
        geloescht: [{ id: 'm1', name: 'Erika Neu' }, { id: 'm4', name: 'Paul Neu' }],
        behalten: [{ id: 'm2', name: 'Max Aktiv', grund: 'steht in einem offenen Mietvertragsentwurf' }],
      })
    ).toBe('Erika Neu und Paul Neu sind aus dem Mieterbestand gelöscht. Max Aktiv bleibt im Bestand: steht in einem offenen Mietvertragsentwurf.');
    expect(loeschErgebnisText({ geloescht: [], behalten: [] })).toBe('Der Mieter war schon gelöscht.');
    expect(loeschErgebnisText({ geloescht: [], behalten: [{ id: 'm2', name: 'Max', grund: 'Grund. ' }] })).toBe('Max bleibt im Bestand: Grund.');
  });

  it('zählt Namen auf', () => {
    expect(namensAufzaehlung([])).toBe('');
    expect(namensAufzaehlung(['A'])).toBe('A');
    expect(namensAufzaehlung(['A', 'B', 'C'])).toBe('A, B und C');
  });
});
