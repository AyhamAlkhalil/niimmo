import { describe, expect, it } from 'vitest';
import {
  BestehendeZahlung,
  abgleichSchluessel,
  bestehendeIndexieren,
  bestehendeVormerken,
  buchungstageVon,
  findeBestehende,
  normalisiereWert,
  vertragsIdsMitIban,
} from './zahlungenUebernahme';

function zeile(teil: Partial<BestehendeZahlung>): BestehendeZahlung {
  return {
    id: 'z1',
    kategorie: 'Miete',
    mietvertrag_id: 'mv1',
    buchungsdatum: '2026-09-01',
    betrag: 850,
    iban: 'DE00',
    verwendungszweck: 'Miete September',
    ...teil,
  };
}

describe('normalisiereWert', () => {
  it('macht aus leer und Leerraum null, wie die Übernahme vor dem Vergleich', () => {
    expect(normalisiereWert(undefined)).toBeNull();
    expect(normalisiereWert(null)).toBeNull();
    expect(normalisiereWert('')).toBeNull();
    expect(normalisiereWert('   ')).toBeNull();
    expect(normalisiereWert('  DE00 ')).toBe('DE00');
  });
});

describe('abgleichSchluessel', () => {
  it('vergleicht Beträge numerisch, wie die Datenbank', () => {
    expect(abgleichSchluessel(zeile({ betrag: '850.00' }))).toBe(abgleichSchluessel(zeile({ betrag: 850 })));
    expect(abgleichSchluessel(zeile({ betrag: 850.5 }))).not.toBe(abgleichSchluessel(zeile({ betrag: 850 })));
  });

  it('hält null und Leerstring auseinander — .is(null) trifft keinen Leerstring', () => {
    expect(abgleichSchluessel(zeile({ iban: null }))).not.toBe(abgleichSchluessel(zeile({ iban: '' })));
    expect(abgleichSchluessel(zeile({ verwendungszweck: null }))).not.toBe(abgleichSchluessel(zeile({ verwendungszweck: '' })));
  });

  it('unterscheidet Tag, IBAN und Verwendungszweck', () => {
    const basis = abgleichSchluessel(zeile({}));
    expect(abgleichSchluessel(zeile({ buchungsdatum: '2026-09-02' }))).not.toBe(basis);
    expect(abgleichSchluessel(zeile({ iban: 'DE01' }))).not.toBe(basis);
    expect(abgleichSchluessel(zeile({ verwendungszweck: 'Miete Oktober' }))).not.toBe(basis);
  });
});

describe('findeBestehende', () => {
  const index = bestehendeIndexieren([
    zeile({ id: 'a' }),
    zeile({ id: 'b', iban: null }),
    zeile({ id: 'c', betrag: '850.00', verwendungszweck: null }),
    zeile({ id: 'd' }),
  ]);

  it('findet die erste passende Buchung wie das frühere limit(1)', () => {
    expect(findeBestehende(index, { buchungsdatum: '2026-09-01', betrag: 850, iban: 'DE00', verwendungszweck: 'Miete September' })?.id).toBe('a');
  });

  it('trifft nur bei gleichen Null-Werten', () => {
    expect(findeBestehende(index, { buchungsdatum: '2026-09-01', betrag: 850, iban: null, verwendungszweck: 'Miete September' })?.id).toBe('b');
    expect(findeBestehende(index, { buchungsdatum: '2026-09-01', betrag: 850, iban: 'DE00', verwendungszweck: null })?.id).toBe('c');
    expect(findeBestehende(index, { buchungsdatum: '2026-09-01', betrag: 850, iban: null, verwendungszweck: null })).toBeNull();
  });

  it('liefert null für andere Beträge oder Tage', () => {
    expect(findeBestehende(index, { buchungsdatum: '2026-09-01', betrag: 851, iban: 'DE00', verwendungszweck: 'Miete September' })).toBeNull();
    expect(findeBestehende(index, { buchungsdatum: '2026-08-01', betrag: 850, iban: 'DE00', verwendungszweck: 'Miete September' })).toBeNull();
  });

  it('erkennt eine im selben Import eben gespeicherte Buchung als bestehend', () => {
    const leer = bestehendeIndexieren([]);
    const merkmale = { buchungsdatum: '2026-09-03', betrag: 120, iban: null, verwendungszweck: 'Gebuehr' };
    expect(findeBestehende(leer, merkmale)).toBeNull();
    bestehendeVormerken(leer, { id: 'neu', kategorie: 'Nichtmiete', mietvertrag_id: null, ...merkmale });
    expect(findeBestehende(leer, merkmale)?.id).toBe('neu');
    // Spätere Entscheidungen sehen den Stand der gespeicherten Zeile
    expect(findeBestehende(leer, merkmale)?.kategorie).toBe('Nichtmiete');
  });
});

describe('Vorabfrage-Filter', () => {
  it('sammelt eindeutige Buchungstage sortiert und ohne Leerwerte', () => {
    expect(buchungstageVon([{ buchungsdatum: '2026-09-03' }, { buchungsdatum: '2026-09-01' }, { buchungsdatum: '2026-09-03' }, { buchungsdatum: null }, {}])).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });

  it('sammelt nur Verträge, bei denen eine IBAN nachgetragen werden könnte', () => {
    expect(
      vertragsIdsMitIban([
        { mietvertrag_id: 'mv1', iban: 'DE00' },
        { mietvertrag_id: 'mv1', iban: 'DE01' },
        { mietvertrag_id: 'mv2', iban: '' },
        { mietvertrag_id: null, iban: 'DE02' },
        { mietvertrag_id: 'mv3', iban: 'DE03' },
      ])
    ).toEqual(['mv1', 'mv3']);
  });
});
