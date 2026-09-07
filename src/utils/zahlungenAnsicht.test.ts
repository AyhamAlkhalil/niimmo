import { describe, expect, it } from 'vitest';
import {
  LEERER_FILTER,
  OHNE_KATEGORIE,
  ZahlungZeile,
  alsIsoTag,
  brauchtZuordnung,
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
    id: teil.id ?? `z${++laufendeId}`,
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

describe('Formatierung', () => {
  it('formatiert Beträge im Buchhaltungsformat', () => {
    // Intl setzt ein geschütztes Leerzeichen (U+00A0) vor das Eurozeichen.
    expect(formatEuro(1250.5).replace(/\u00a0/g, ' ')).toBe('1.250,50 €');
    expect(formatEuro(-3).replace(/\u00a0/g, ' ')).toBe('-3,00 €');
  });

  it('formatiert ISO-Daten ohne Zeitzonenverschiebung', () => {
    expect(formatIsoDatum('2026-03-01')).toBe('01.03.2026');
    expect(formatIsoDatum('2026-03-01T00:00:00')).toBe('01.03.2026');
    expect(formatIsoDatum(null)).toBe('');
  });

  it('benennt den Monat deutsch', () => {
    expect(monatsLabel('2026-09')).toBe('September 2026');
    expect(monatsLabel('2025-03')).toBe('März 2025');
  });
});

describe('filtereZahlungen', () => {
  const daten = [
    zahlung({ id: 'a', betrag: 1250.5, empfaengername: 'Erika Beispiel', verwendungszweck: 'Miete September', buchungsdatum: '2026-09-02' }),
    zahlung({ id: 'b', betrag: -45, empfaengername: 'Stadtwerke', verwendungszweck: 'Abschlag Strom', kategorie: 'Nebenkosten', mietvertrag_id: null, immobilie_id: 'im1', buchungsdatum: '2026-08-31' }),
    zahlung({ id: 'c', betrag: 600, mieter_name: 'Max Muster', kategorie: 'Miete', mietvertrag_id: null, buchungsdatum: '2026-08-01' }),
    zahlung({ id: 'd', betrag: 12, kategorie: null, mietvertrag_id: null, buchungsdatum: '2026-07-15', iban: 'DE02120300000000202051' }),
  ];

  it('findet Text in Verwendungszweck, Name, Mieter und IBAN', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: 'september' }).map((z) => z.id)).toEqual(['a']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: 'muster' }).map((z) => z.id)).toEqual(['c']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: 'DE0212' }).map((z) => z.id)).toEqual(['d']);
  });

  it('findet Beträge in jeder gängigen Schreibweise', () => {
    for (const suche of ['1250,50', '1.250,50', '1250.5', '1250,50 €', '-1250,50']) {
      expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche }).map((z) => z.id), suche).toEqual(['a']);
    }
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '45' }).map((z) => z.id)).toEqual(['b']);
  });

  it('findet das formatierte Datum', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, suche: '31.08.' }).map((z) => z.id)).toEqual(['b']);
  });

  it('filtert nach Kategorie, auch nach „ohne Kategorie"', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, kategorie: 'Nebenkosten' }).map((z) => z.id)).toEqual(['b']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, kategorie: OHNE_KATEGORIE }).map((z) => z.id)).toEqual(['d']);
  });

  it('unterscheidet zugeordnet (Vertrag oder Objekt) und nicht zugeordnet', () => {
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, zuordnung: 'zugeordnet' }).map((z) => z.id)).toEqual(['a', 'b']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, zuordnung: 'nicht-zugeordnet' }).map((z) => z.id)).toEqual(['c', 'd']);
  });

  it('grenzt den Zeitraum tagesgenau und einschließlich ein', () => {
    const von = new Date(2026, 7, 1);
    const bis = new Date(2026, 7, 31);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von, bis }).map((z) => z.id)).toEqual(['b', 'c']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von: new Date(2026, 8, 1), bis: undefined }).map((z) => z.id)).toEqual(['a']);
    expect(filtereZahlungen(daten, { ...LEERER_FILTER, von: undefined, bis: new Date(2026, 6, 15) }).map((z) => z.id)).toEqual(['d']);
  });

  it('meldet, ob ein Filter aktiv ist', () => {
    expect(hatAktivenFilter(LEERER_FILTER)).toBe(false);
    expect(hatAktivenFilter({ ...LEERER_FILTER, suche: '  ' })).toBe(false);
    expect(hatAktivenFilter({ ...LEERER_FILTER, zuordnung: 'zugeordnet' })).toBe(true);
    expect(hatAktivenFilter({ ...LEERER_FILTER, von: new Date() })).toBe(true);
  });
});

describe('brauchtZuordnung', () => {
  it('gilt nur für mietrelevante Kategorien ohne Bezug', () => {
    expect(brauchtZuordnung(zahlung({ kategorie: 'Miete', mietvertrag_id: null }))).toBe(true);
    expect(brauchtZuordnung(zahlung({ kategorie: 'Mietkaution', mietvertrag_id: null }))).toBe(true);
    expect(brauchtZuordnung(zahlung({ kategorie: 'Nichtmiete', mietvertrag_id: null }))).toBe(false);
    expect(brauchtZuordnung(zahlung({ kategorie: 'Ignorieren', mietvertrag_id: null }))).toBe(false);
    expect(brauchtZuordnung(zahlung({ kategorie: 'Miete', mietvertrag_id: 'mv' }))).toBe(false);
    expect(brauchtZuordnung(zahlung({ kategorie: null, mietvertrag_id: null }))).toBe(false);
  });
});

describe('sortiereZahlungen', () => {
  const daten = [
    zahlung({ id: 'alt-klein', betrag: 100, buchungsdatum: '2026-01-05', kategorie: 'Nichtmiete', mietvertrag_id: null }),
    zahlung({ id: 'neu-gross', betrag: 900, buchungsdatum: '2026-09-05', kategorie: 'Miete' }),
    zahlung({ id: 'mitte-offen', betrag: 900, buchungsdatum: '2026-05-05', kategorie: 'Miete', mietvertrag_id: null }),
  ];

  it('sortiert nach Datum in beide Richtungen', () => {
    expect(sortiereZahlungen(daten, { feld: 'datum', richtung: 'desc' }).map((z) => z.id)).toEqual(['neu-gross', 'mitte-offen', 'alt-klein']);
    expect(sortiereZahlungen(daten, { feld: 'datum', richtung: 'asc' }).map((z) => z.id)).toEqual(['alt-klein', 'mitte-offen', 'neu-gross']);
  });

  it('sortiert nach Betrag und bricht Gleichstände nach Datum absteigend', () => {
    expect(sortiereZahlungen(daten, { feld: 'betrag', richtung: 'desc' }).map((z) => z.id)).toEqual(['neu-gross', 'mitte-offen', 'alt-klein']);
    expect(sortiereZahlungen(daten, { feld: 'betrag', richtung: 'asc' }).map((z) => z.id)).toEqual(['alt-klein', 'neu-gross', 'mitte-offen']);
  });

  it('stellt bei Zuordnung aufsteigend die offenen Vorgänge nach vorn', () => {
    expect(sortiereZahlungen(daten, { feld: 'zuordnung', richtung: 'asc' }).map((z) => z.id)).toEqual(['mitte-offen', 'alt-klein', 'neu-gross']);
  });

  it('sortiert nach Kategorie-Anzeigetext', () => {
    expect(sortiereZahlungen(daten, { feld: 'kategorie', richtung: 'asc' }).map((z) => z.kategorie)).toEqual(['Miete', 'Miete', 'Nichtmiete']);
  });

  it('verändert die Eingabe nicht', () => {
    const kopie = [...daten];
    sortiereZahlungen(daten, { feld: 'betrag', richtung: 'asc' });
    expect(daten).toEqual(kopie);
  });
});

describe('gruppiereNachMonat', () => {
  const daten = sortiereZahlungen(
    [
      zahlung({ id: 'a', betrag: 100.1, buchungsdatum: '2026-09-02' }),
      zahlung({ id: 'b', betrag: 200.2, buchungsdatum: '2026-09-15' }),
      zahlung({ id: 'c', betrag: -50, buchungsdatum: '2026-08-31' }),
      zahlung({ id: 'd', betrag: 10, buchungsdatum: '2025-12-01' }),
    ],
    { feld: 'datum', richtung: 'desc' }
  );

  it('bildet je Monat eine Gruppe mit Summe und Label', () => {
    const gruppen = gruppiereNachMonat(daten, 'desc');
    expect(gruppen.map((g) => g.monatKey)).toEqual(['2026-09', '2026-08', '2025-12']);
    expect(gruppen[0].label).toBe('September 2026');
    expect(gruppen[0].zahlungen.map((z) => z.id)).toEqual(['b', 'a']);
    expect(gruppen[0].summe).toBe(300.3);
    expect(gruppen[1].summe).toBe(-50);
  });

  it('dreht die Gruppenreihenfolge mit der Datumsrichtung', () => {
    expect(gruppiereNachMonat(daten, 'asc').map((g) => g.monatKey)).toEqual(['2025-12', '2026-08', '2026-09']);
  });

  it('summiert ohne Gleitkommarauschen', () => {
    expect(summeBetraege([{ betrag: 0.1 }, { betrag: 0.2 }])).toBe(0.3);
  });
});

describe('zeitraumVoreinstellung', () => {
  const heute = new Date(2026, 8, 7); // 07.09.2026

  it('kennt die Monats- und Jahresgrenzen', () => {
    expect(zeitraumVoreinstellung('dieser-monat', heute)).toEqual({ von: new Date(2026, 8, 1), bis: new Date(2026, 8, 30) });
    expect(zeitraumVoreinstellung('letzter-monat', heute)).toEqual({ von: new Date(2026, 7, 1), bis: new Date(2026, 7, 31) });
    expect(zeitraumVoreinstellung('letzte-3-monate', heute)).toEqual({ von: new Date(2026, 6, 1), bis: new Date(2026, 8, 30) });
    expect(zeitraumVoreinstellung('dieses-jahr', heute)).toEqual({ von: new Date(2026, 0, 1), bis: new Date(2026, 11, 31) });
    expect(zeitraumVoreinstellung('letztes-jahr', heute)).toEqual({ von: new Date(2025, 0, 1), bis: new Date(2025, 11, 31) });
  });

  it('läuft über den Jahreswechsel', () => {
    expect(zeitraumVoreinstellung('letzter-monat', new Date(2026, 0, 10))).toEqual({ von: new Date(2025, 11, 1), bis: new Date(2025, 11, 31) });
  });

  it('bildet ISO-Tage in Ortszeit', () => {
    expect(alsIsoTag(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
