import { describe, expect, it } from 'vitest';
import {
  KiVorschlag,
  NebenkostenZahlungRoh,
  alsZahlungZeile,
  anzahlJeObjekt,
  filtereNachSicht,
  sichtVon,
  vorschlagHinweise,
  zaehleSichten,
} from './nebenkostenZuordnung';

function roh(teil: Partial<NebenkostenZahlungRoh>): NebenkostenZahlungRoh {
  return {
    id: 'z1',
    betrag: -120,
    buchungsdatum: '2026-09-03',
    verwendungszweck: 'Abschlag Strom',
    empfaengername: 'Stadtwerke',
    iban: null,
    kategorie: 'Nebenkosten',
    immobilie_id: null,
    immobilie: null,
    ...teil,
  };
}

describe('alsZahlungZeile', () => {
  it('übernimmt das eingebettete Objekt und formatiert das Datum', () => {
    const z = alsZahlungZeile(roh({ immobilie_id: 'im1', immobilie: { id: 'im1', name: 'Haus A', adresse: 'Weg 1' } }));
    expect(z.immobilie_name).toBe('Haus A');
    expect(z.immobilie_adresse).toBe('Weg 1');
    expect(z.buchungsdatum_formatted).toBe('03.09.2026');
    expect(z.mietvertrag_id).toBeNull();
  });

  it('kommt ohne Objekt aus', () => {
    const z = alsZahlungZeile(roh({}));
    expect(z.immobilie_id).toBeNull();
    expect(z.immobilie_name).toBeNull();
  });
});

describe('Sichten', () => {
  const zeilen = [
    alsZahlungZeile(roh({ id: 'a' })),
    alsZahlungZeile(roh({ id: 'b', kategorie: 'Nichtmiete' })),
    alsZahlungZeile(roh({ id: 'c', immobilie_id: 'im1' })),
    alsZahlungZeile(roh({ id: 'd', kategorie: 'Nichtmiete' })),
  ];
  const ausgeblendet = new Set(['d']);

  it('ordnet jede Buchung genau einer Sicht zu', () => {
    expect(sichtVon(zeilen[0], ausgeblendet)).toBe('offen');
    expect(sichtVon(zeilen[2], ausgeblendet)).toBe('zugeordnet');
    expect(sichtVon(zeilen[3], ausgeblendet)).toBe('ausgeblendet');
    // Ein Objektbezug schlägt das Ausblenden
    expect(sichtVon({ id: 'd', immobilie_id: 'im1' }, ausgeblendet)).toBe('zugeordnet');
  });

  it('filtert nach Sicht und Kategorie', () => {
    expect(filtereNachSicht(zeilen, 'offen', 'alle', ausgeblendet).map((z) => z.id)).toEqual(['a', 'b']);
    expect(filtereNachSicht(zeilen, 'offen', 'Nichtmiete', ausgeblendet).map((z) => z.id)).toEqual(['b']);
    expect(filtereNachSicht(zeilen, 'zugeordnet', 'alle', ausgeblendet).map((z) => z.id)).toEqual(['c']);
    expect(filtereNachSicht(zeilen, 'ausgeblendet', 'alle', ausgeblendet).map((z) => z.id)).toEqual(['d']);
  });

  it('zählt je Sicht', () => {
    expect(zaehleSichten(zeilen, ausgeblendet)).toEqual({ offen: 2, zugeordnet: 1, ausgeblendet: 1 });
  });
});

describe('vorschlagHinweise', () => {
  const vorschlaege: KiVorschlag[] = [
    { zahlung_id: 'a', confidence: 'high', category: 'strom', suggested_immobilie_id: 'im1', suggested_immobilie_name: 'Haus A', reasoning: '' },
    { zahlung_id: 'b', confidence: 'low', category: 'versicherung', suggested_immobilie_id: null, suggested_immobilie_name: null, reasoning: '' },
    { zahlung_id: 'c', confidence: 'high', category: 'strom', suggested_immobilie_id: 'im1', suggested_immobilie_name: 'Haus A', reasoning: '' },
  ];
  const zeilen = [alsZahlungZeile(roh({ id: 'a' })), alsZahlungZeile(roh({ id: 'b' })), alsZahlungZeile(roh({ id: 'c', immobilie_id: 'im1' }))];

  it('nennt das vorgeschlagene Objekt, sonst die Kostenart — nur für offene Buchungen', () => {
    const h = vorschlagHinweise(vorschlaege, zeilen);
    expect(h.get('a')).toBe('Haus A');
    expect(h.get('b')).toBe('versicherung');
    expect(h.has('c')).toBe(false);
  });
});

describe('anzahlJeObjekt', () => {
  it('zählt zugeordnete Buchungen je Objekt', () => {
    const anzahl = anzahlJeObjekt([{ immobilie_id: 'im1' }, { immobilie_id: 'im1' }, { immobilie_id: 'im2' }, { immobilie_id: null }]);
    expect(anzahl.get('im1')).toBe(2);
    expect(anzahl.get('im2')).toBe(1);
    expect(anzahl.has('im3')).toBe(false);
  });
});
