import { describe, expect, it } from 'vitest';
import {
  BestehendeZahlung,
  abgleichSchluessel,
  bestehendeAusschliessen,
  bestehendeIndexieren,
  buchungstageVon,
  nimmBestehende,
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

describe('nimmBestehende', () => {
  const neuerIndex = () =>
    bestehendeIndexieren([
      zeile({ id: 'a' }),
      zeile({ id: 'b', iban: null }),
      zeile({ id: 'c', betrag: '850.00', verwendungszweck: null }),
      zeile({ id: 'd' }),
    ]);
  const september = { buchungsdatum: '2026-09-01', betrag: 850, iban: 'DE00', verwendungszweck: 'Miete September' };

  it('findet die erste passende Buchung', () => {
    expect(nimmBestehende(neuerIndex(), september)?.id).toBe('a');
  });

  it('trifft nur bei gleichen Null-Werten', () => {
    const index = neuerIndex();
    expect(nimmBestehende(index, { ...september, iban: null })?.id).toBe('b');
    expect(nimmBestehende(index, { ...september, verwendungszweck: null })?.id).toBe('c');
    expect(nimmBestehende(index, { ...september, iban: null, verwendungszweck: null })).toBeNull();
  });

  it('liefert null für andere Beträge oder Tage', () => {
    const index = neuerIndex();
    expect(nimmBestehende(index, { ...september, betrag: 851 })).toBeNull();
    expect(nimmBestehende(index, { ...september, buchungsdatum: '2026-08-01' })).toBeNull();
  });

  it('stellt jede Bestandsbuchung nur einer Importzeile gegenüber', () => {
    // 27.10.2026: Zwei gleiche Überweisungen am selben Tag wurden zu einer
    const index = neuerIndex();
    expect(nimmBestehende(index, september)?.id).toBe('a');
    expect(nimmBestehende(index, september)?.id).toBe('d');
    expect(nimmBestehende(index, september)).toBeNull();
  });

  it('lässt Buchungen aus, die process-payments schon als Duplikat gezählt hat', () => {
    const index = neuerIndex();
    bestehendeAusschliessen(index, new Set(['a', 'c']));
    expect(nimmBestehende(index, september)?.id).toBe('d');
    expect(nimmBestehende(index, september)).toBeNull();
    expect(nimmBestehende(index, { ...september, verwendungszweck: null })).toBeNull();
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
