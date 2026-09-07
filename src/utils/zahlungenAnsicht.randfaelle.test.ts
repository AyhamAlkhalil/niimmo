/**
 * Zusätzliche QA-Tests für src/utils/zahlungenAnsicht.ts — Randfälle, die
 * src/utils/zahlungenAnsicht.test.ts noch nicht abdeckt. Nur lesend, keine
 * Änderung am geprüften Modul.
 */
import { describe, expect, it } from 'vitest';
import {
  LEERER_FILTER,
  OHNE_KATEGORIE,
  ZahlungZeile,
  ZeitraumVorgabe,
  alsIsoTag,
  filtereZahlungen,
  formatEuro,
  formatIsoDatum,
  gruppiereNachMonat,
  hatAktivenFilter,
  monatsLabel,
  sortiereZahlungen,
  summeBetraege,
  zeitraumVoreinstellung,
} from './zahlungenAnsicht';

let laufendeId = 0;
function zahlung(teil: Partial<ZahlungZeile>): ZahlungZeile {
  const buchungsdatum = teil.buchungsdatum ?? '2026-09-01';
  return {
    id: teil.id ?? `qa-z${++laufendeId}`,
    betrag: 850,
    buchungsdatum,
    buchungsdatum_formatted: formatIsoDatum(buchungsdatum),
    verwendungszweck: null,
    empfaengername: null,
    iban: null,
    zugeordneter_monat: null,
    kategorie: 'Miete',
    mietvertrag_id: 'mv1',
    immobilie_id: null,
    immobilie_name: null,
    immobilie_adresse: null,
    einheit_id: null,
    einheit_typ: null,
    einheit_etage: null,
    mieter_name: null,
    ...teil,
  };
}

describe('leere Listen', () => {
  it('filtert, sortiert und gruppiert eine leere Liste ohne Fehler', () => {
    expect(filtereZahlungen([], LEERER_FILTER)).toEqual([]);
    expect(filtereZahlungen([], { ...LEERER_FILTER, suche: 'irgendwas', kategorie: 'Miete', zuordnung: 'zugeordnet', von: new Date(), bis: new Date() })).toEqual([]);
    expect(sortiereZahlungen([], { feld: 'betrag', richtung: 'asc' })).toEqual([]);
    expect(gruppiereNachMonat([], 'desc')).toEqual([]);
    expect(summeBetraege([])).toBe(0);
  });
});

describe('Beträge 0 und negativ', () => {
  const daten = [
    zahlung({ id: 'null', betrag: 0, verwendungszweck: 'Nullbuchung' }),
    zahlung({ id: 'negativ', betrag: -120.5, verwendungszweck: 'Rückbuchung' }),
    zahlung({ id: 'positiv', betrag: 120.5, verwendungszweck: 'Gegenbuchung' }),
  ];

  it('findet einen Betrag von exakt 0', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '0,00' }).map((z) => z.id)).toEqual(['null']);
    // Eine Suche nach "0" ist ein Teilstring vieler Betraege/Daten (z. B. 120.50, 01.09.2026) und trifft hier alle drei.
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '0' }).map((z) => z.id).sort()).toEqual(['negativ', 'null', 'positiv']);
  });

  it('ignoriert das Vorzeichen bei der Suche — negativ und positiv treffen beide auf denselben Betrag', () => {
    // Dokumentiertes Verhalten (betragPasst strippt führendes „-" aus der Suche),
    // nicht auf ein bestimmtes Vorzeichen der Zahlung bezogen.
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '120,50' }).map((z) => z.id).sort()).toEqual(['negativ', 'positiv']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '-120,50' }).map((z) => z.id).sort()).toEqual(['negativ', 'positiv']);
  });

  it('sortiert 0 und negative Beträge korrekt ein', () => {
    expect(sortiereZahlungen(daten, { feld: 'betrag', richtung: 'asc' }).map((z) => z.id)).toEqual(['negativ', 'null', 'positiv']);
  });

  it('formatiert 0 im Buchhaltungsformat', () => {
    expect(formatEuro(0).replace(/\u00a0/g, ' ')).toBe('0,00 €');
  });

  it('summiert 0 und negative Beträge korrekt', () => {
    expect(summeBetraege(daten)).toBe(0);
  });
});

describe('Suche: Sonderzeichen und Leerraum', () => {
  const daten = [
    zahlung({ id: 'sonder', verwendungszweck: 'Miete (September) – Whg. 2/OG & Co.', buchungsdatum: '2026-09-03' }),
    zahlung({ id: 'sonst', verwendungszweck: 'Normale Buchung', buchungsdatum: '2026-09-04' }),
  ];

  it('findet Verwendungszweck mit Klammern, Slash und Kaufmanns-Und ohne Regex-Fehler', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '(September)' }).map((z) => z.id)).toEqual(['sonder']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '2/og' }).map((z) => z.id)).toEqual(['sonder']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '& co.' }).map((z) => z.id)).toEqual(['sonder']);
  });

  it('behandelt eine Suche aus nur Leerzeichen wie „kein Filter"', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '   ' }).map((z) => z.id).sort()).toEqual(['sonder', 'sonst']);
  });

  it('liefert kein Ergebnis für eine Suche aus nur einem nicht vorkommenden Sonderzeichen', () => {
    // „€" wird von betragPasst herausgefiltert (leerer Rest) und kommt in keinem Textfeld vor.
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '€' }).map((z) => z.id)).toEqual([]);
  });
});

describe('Zeitraum: nur von, nur bis, von > bis', () => {
  const daten = [
    zahlung({ id: 'juli', buchungsdatum: '2026-07-10' }),
    zahlung({ id: 'august', buchungsdatum: '2026-08-10' }),
    zahlung({ id: 'september', buchungsdatum: '2026-09-10' }),
  ];

  it('grenzt nur nach unten ein, wenn nur „von" gesetzt ist', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von: new Date(2026, 7, 1), bis: undefined }).map((z) => z.id)).toEqual(['august', 'september']);
  });

  it('grenzt nur nach oben ein, wenn nur „bis" gesetzt ist', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von: undefined, bis: new Date(2026, 7, 31) }).map((z) => z.id)).toEqual(['juli', 'august']);
  });

  it('liefert ein leeres Ergebnis, wenn „von" nach „bis" liegt', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von: new Date(2026, 8, 15), bis: new Date(2026, 8, 1) })).toEqual([]);
  });
});

describe('Kategoriefilter mit kategorie: null', () => {
  const daten = [
    zahlung({ id: 'ohne-kat', kategorie: null }),
    zahlung({ id: 'mit-kat', kategorie: 'Nichtmiete' }),
  ];

  it('kategorie: null im Filter bedeutet „alle Kategorien", nicht „ohne Kategorie"', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, kategorie: null }).map((z) => z.id).sort()).toEqual(['mit-kat', 'ohne-kat']);
  });

  it('eine nicht existierende Kategorie liefert kein Ergebnis', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, kategorie: 'Erfindung' })).toEqual([]);
  });

  it('hatAktivenFilter erkennt OHNE_KATEGORIE als aktiven Filter', () => {
    expect(hatAktivenFilter({ ...LEERER_FILTER, kategorie: OHNE_KATEGORIE })).toBe(true);
  });
});

describe('Formatierung: Randfälle', () => {
  it('formatIsoDatum liefert die Rohangabe zurück, wenn der Tag fehlt', () => {
    expect(formatIsoDatum('2026-03')).toBe('2026-03');
    expect(formatIsoDatum('')).toBe('');
  });

  it('monatsLabel liefert den Rohschlüssel zurück, wenn er nicht parsbar ist', () => {
    expect(monatsLabel('')).toBe('');
    expect(monatsLabel('abc')).toBe('abc');
    expect(monatsLabel('2026')).toBe('2026');
  });

  it('bildet einen Schalttag korrekt in Ortszeit ab', () => {
    expect(alsIsoTag(new Date(2028, 1, 29))).toBe('2028-02-29');
  });
});

describe('sortiereZahlungen: drei Zuordnungs-Ränge', () => {
  const daten = [
    zahlung({ id: 'braucht', kategorie: 'Miete', mietvertrag_id: null, immobilie_id: null, buchungsdatum: '2026-09-01' }),
    zahlung({ id: 'nicht-zugeordnet-egal', kategorie: 'Ignorieren', mietvertrag_id: null, immobilie_id: null, buchungsdatum: '2026-09-02' }),
    zahlung({ id: 'zugeordnet', kategorie: 'Miete', mietvertrag_id: 'mv1', buchungsdatum: '2026-09-03' }),
  ];

  it('ordnet offene mietrelevante Vorgänge vor nicht-mietrelevanten unzugeordneten vor zugeordneten', () => {
    expect(sortiereZahlungen(daten, { feld: 'zuordnung', richtung: 'asc' }).map((z) => z.id)).toEqual([
      'braucht',
      'nicht-zugeordnet-egal',
      'zugeordnet',
    ]);
    expect(sortiereZahlungen(daten, { feld: 'zuordnung', richtung: 'desc' }).map((z) => z.id)).toEqual([
      'zugeordnet',
      'nicht-zugeordnet-egal',
      'braucht',
    ]);
  });
});

describe('zeitraumVoreinstellung: unbekannter Wert', () => {
  it('fällt für einen unbekannten Wert auf „letztes Jahr" zurück (default-Zweig)', () => {
    const heute = new Date(2026, 8, 7);
    const unbekannt = 'ueberuebermorgen' as ZeitraumVorgabe;
    expect(zeitraumVoreinstellung(unbekannt, heute)).toEqual(zeitraumVoreinstellung('letztes-jahr', heute));
  });
});
