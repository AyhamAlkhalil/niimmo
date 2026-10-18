/**
 * Vertragsentwurf: Vorbelegung aus Objekt, Einheit und Vorvertrag.
 *
 * Die Zahlen sind die der Wohnung, an der der Fehler vom 15.10.2026 auffiel:
 * Dachgeschoss rechts, 68 m², Vorvertrag 1.000 € kalt, in der Datenbank 100 €
 * Betriebskosten — laut Word-Vertrag 50 € Nebenkosten und 50 € Heizkosten.
 * Namen sind erfunden.
 */
import { describe, expect, it } from 'vitest';

import type { Tables } from '@/integrations/supabase/types';
import {
  aktivierungsDaten,
  baueEntwurf,
  findeVorhandeneMieter,
  monateNachzuholen,
  kautionFuer,
  leerePerson,
  mieterRolle,
  mieterZeile,
  mitPersonen,
  ohneHerkunft,
  personenAusSelbstauskunft,
  positionenSumme,
  pruefeBlacklist,
  standardMietbeginn,
  vertragsZeile,
  wendeVorvertragAuslese,
  type EntwurfGrundlagen,
  type VorvertragAuslese,
} from './entwurf';
import { pruefeVertragsdaten } from './pflichtpruefung';

const IMMOBILIE = {
  id: 'imm-5',
  name: 'Objekt 5',
  strasse: 'Musterstraße',
  hausnummer: '12',
  plz: '30851',
  ort: 'Langenhagen',
  ortsteil: null,
  ist_angespannt: true,
  heizungsart: null,
  warmwasser: null,
  schliessanlage_art: null,
  gemeinschaftseinrichtungen: null,
  gesamtwohnflaeche: null,
  heizkosten_schluessel: '70/30',
  'Kontonr.': 'DE89 2559 1413 3155 4105 01',
  energieausweis_typ: null,
  energie_kennwert: null,
  energietraeger: null,
  energieausweis_gueltig_bis: null,
  energieeffizienzklasse: null,
} as unknown as Tables<'immobilien'>;

const EINHEIT = {
  id: 'einh-509',
  immobilie_id: 'imm-5',
  bezeichnung: null,
  etage: 'Dachgeschoss rechts',
  qm: 68,
  anzahl_zimmer: null,
  raeume: {},
  nebenraeume: null,
  einbaukueche: false,
  einheitentyp: 'Wohnung',
} as unknown as Tables<'einheiten'>;

const VORVERTRAG = {
  id: 'vv-1',
  einheit_id: 'einh-509',
  status: 'beendet',
  start_datum: '2024-05-01',
  ende_datum: '2026-07-31',
  kuendigungsdatum: '2026-07-31',
  kaltmiete: 1000,
  betriebskosten: 100,
  heizkosten_vorauszahlung: null,
  kaution_betrag: 3000,
  raumaufstellung: null,
  schliessanlage_art: null,
  mitbenutzung_einrichtungen: null,
  betriebskosten_positionen: null,
} as unknown as Tables<'mietvertrag'>;

const VERMIETER = {
  firmenname: 'NiImmo Wohnungsbaugesellschaft mbH',
  rechtsform: 'GmbH',
  strasse: 'Egestorffstraße',
  hausnummer: '11',
  plz: '31319',
  ort: 'Sehnde',
  vertreten_durch: ['Geschäftsführung'],
  vertretung_art: 'einzel',
  miet_iban: null,
  stammdaten_geprueft: false,
} as unknown as Tables<'vermieter'>;

function grundlagen(ueber: Partial<EntwurfGrundlagen> = {}): EntwurfGrundlagen {
  return {
    immobilie: IMMOBILIE,
    einheit: EINHEIT,
    vermieter: VERMIETER,
    nebenkostenarten: [],
    vorvertrag: VORVERTRAG,
    heute: '2026-10-18',
    ...ueber,
  };
}

/** Die Kostenaufstellung aus § 4 des Word-Vorvertrags. */
const AUSLESE: VorvertragAuslese = {
  einheit_bezeichnung: 'WE9',
  lage: 'DG rechts',
  raumaufstellung: '1 Zimmer, 1 Wohnküche, 1 Badezimmer, 1 Abstellraum',
  wohnflaeche_qm: 68,
  schliessanlage: 'zentral',
  kaltmiete: 1000,
  betriebskosten_vorauszahlung: 50,
  heizkosten_vorauszahlung: 50,
  betriebskosten_positionen: [
    { nummer: '2.1', betrag: 5, umgelegt: true },
    { nummer: '2.2', betrag: 5, umgelegt: true },
    { nummer: '2.3', betrag: 1.5, umgelegt: true },
    { nummer: '2.4', betrag: 5, umgelegt: true },
    { nummer: '2.5', betrag: 2.5, umgelegt: true },
    { nummer: '2.6', betrag: 2.5, umgelegt: true },
    { nummer: '2.7', betrag: null, umgelegt: false },
    { nummer: '2.8', betrag: 5, umgelegt: true },
    { nummer: '2.9', betrag: 0, umgelegt: true },
    { nummer: '2.10', betrag: 0, umgelegt: true },
    { nummer: '2.11', betrag: 4, umgelegt: true },
    { nummer: '2.12', betrag: 1, umgelegt: true },
    { nummer: '2.13', betrag: 5, umgelegt: true },
    { nummer: '2.14', betrag: 5, umgelegt: true },
    { nummer: '2.15', betrag: 8.5, umgelegt: true },
    { nummer: '2.16', betrag: null, umgelegt: false },
    { nummer: '2.17', betrag: 0, umgelegt: true },
    { nummer: '2.18', betrag: 0, umgelegt: true },
    { nummer: '2.19', betrag: 0, umgelegt: true },
  ],
  kaution: 3000,
  mietbeginn: '2024-05-01',
};

describe('Vorbelegung aus Objekt, Einheit und Vorvertrag', () => {
  it('übernimmt Miete und Betriebskosten aus dem Vorvertrag und kennzeichnet sie', () => {
    const { daten, herkunft } = baueEntwurf(grundlagen());
    expect(daten.kaltmiete).toBe(1000);
    expect(daten.betriebskostenVorauszahlung).toBe(100);
    expect(daten.heizkostenVorauszahlung).toBeNull();
    expect(herkunft.kaltmiete).toBe('vorvertrag');
    expect(herkunft.betriebskostenVorauszahlung).toBe('vorvertrag');
  });

  it('rechnet die Kaution als drei Nettokaltmieten', () => {
    const { daten, herkunft } = baueEntwurf(grundlagen());
    expect(daten.kautionBetrag).toBe(3000);
    expect(herkunft.kautionBetrag).toBe('berechnet');
    expect(kautionFuer(933.33)).toBe(2799.99);
  });

  it('nimmt Lage und Wohnfläche aus der Einheit', () => {
    const { daten, herkunft } = baueEntwurf(grundlagen());
    expect(daten.einheit.lage).toBe('Dachgeschoss rechts');
    expect(daten.einheit.wohnflaecheQm).toBe(68);
    expect(herkunft['einheit.lage']).toBe('einheit');
  });

  it('setzt die Vormiete nur, wo die Mietpreisbremse gilt', () => {
    const angespannt = baueEntwurf(grundlagen()).daten;
    expect(angespannt.vormieteNetto).toBe(1000);
    expect(angespannt.vormieteBis).toBe('2026-07-31');

    const frei = baueEntwurf(
      grundlagen({ immobilie: { ...IMMOBILIE, ist_angespannt: false } as Tables<'immobilien'> })
    ).daten;
    expect(frei.vormieteNetto).toBeNull();
  });

  it('nimmt Heizungsart und Einrichtungen vom Objekt, sobald sie gepflegt sind', () => {
    const { daten, herkunft } = baueEntwurf(
      grundlagen({
        immobilie: {
          ...IMMOBILIE,
          heizungsart: 'zentral',
          warmwasser: 'zentral',
          schliessanlage_art: 'zentral',
          gemeinschaftseinrichtungen: ['Waschkeller', 'Fahrradkeller'],
          gesamtwohnflaeche: 640,
        } as unknown as Tables<'immobilien'>,
      })
    );
    expect(daten.objekt.heizungsart).toBe('zentral');
    expect(daten.objekt.gesamtwohnflaecheQm).toBe(640);
    expect(daten.schliessanlageArt).toBe('zentral');
    expect(daten.mitbenutzungEinrichtungen).toBe('Waschkeller, Fahrradkeller');
    expect(herkunft['objekt.heizungsart']).toBe('objekt');
    expect(herkunft.mitbenutzungEinrichtungen).toBe('objekt');
  });

  it('kommt ohne Vorvertrag mit leeren Beträgen aus', () => {
    const { daten, herkunft } = baueEntwurf(grundlagen({ vorvertrag: null }));
    expect(daten.kaltmiete).toBe(0);
    expect(daten.kautionBetrag).toBe(0);
    expect(herkunft.kaltmiete).toBeUndefined();
  });

  it('legt nur bei Wohnungen einen Wohnraumvertrag an', () => {
    const garage = baueEntwurf(
      grundlagen({ einheit: { ...EINHEIT, einheitentyp: 'Garage' } as Tables<'einheiten'> })
    ).daten;
    expect(garage.vertragsart).toBe('stellplatz');
  });
});

describe('Auslese des alten Vertragsdokuments', () => {
  it('teilt die Datenbanksumme in Nebenkosten und Heizkosten wie im Dokument', () => {
    const basis = baueEntwurf(grundlagen());
    const { daten, herkunft } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    expect(daten.heizkostenVorauszahlung).toBe(50);
    expect(daten.betriebskostenVorauszahlung).toBe(50);
    expect(positionenSumme(daten)).toBe(50);
    expect(herkunft.heizkostenVorauszahlung).toBe('vorvertrag');
    expect(herkunft.betriebskostenPositionen).toBe('vorvertrag');
  });

  it('übernimmt Striche als „nicht umgelegt" und 0,00 als umgelegt ohne Anteil', () => {
    const basis = baueEntwurf(grundlagen());
    const { daten } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    const p = (n: string) => daten.betriebskostenPositionen.find(x => x.nummer === n)!;
    expect(p('2.7')).toMatchObject({ umgelegt: false, betrag: null });
    expect(p('2.9')).toMatchObject({ umgelegt: true, betrag: 0 });
    expect(p('2.15')).toMatchObject({ umgelegt: true, betrag: 8.5 });
  });

  it('füllt nur leere Felder — die Lage der Einheit bleibt', () => {
    const basis = baueEntwurf(grundlagen());
    const { daten, herkunft } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    expect(daten.einheit.lage).toBe('Dachgeschoss rechts');
    expect(daten.einheit.bezeichnung).toBe('WE9');
    expect(daten.einheit.raumaufstellung).toBe('1 Zimmer, 1 Wohnküche, 1 Badezimmer, 1 Abstellraum');
    expect(daten.schliessanlageArt).toBe('zentral');
    expect(herkunft['einheit.bezeichnung']).toBe('vorvertrag');
    expect(herkunft['einheit.lage']).toBe('einheit');
  });

  it('ergibt einen Vertrag, dessen Kostenspalte aufgeht', () => {
    const basis = baueEntwurf(grundlagen());
    const { daten } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    const befunde = pruefeVertragsdaten(daten);
    expect(befunde.some(f => f.feld === 'betriebskostenPositionen' && f.schwere === 'blocker')).toBe(false);
  });

  it('überschreibt eine schon erfasste Kostenaufstellung nicht', () => {
    const basis = baueEntwurf(grundlagen());
    basis.daten.betriebskostenPositionen[0] = { ...basis.daten.betriebskostenPositionen[0], umgelegt: true, betrag: 99 };
    const { daten } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    expect(daten.betriebskostenPositionen[0].betrag).toBe(99);
  });

  it('ändert den Entwurf, den sie bekommt, nicht', () => {
    const basis = baueEntwurf(grundlagen());
    wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    expect(basis.daten.einheit.bezeichnung).toBe('');
    expect(basis.daten.heizkostenVorauszahlung).toBeNull();
  });
});

describe('Mietbeginn', () => {
  it('schlägt den Ersten des Folgemonats vor', () => {
    expect(standardMietbeginn('2026-10-18', '2026-07-31', null)).toBe('2026-11-01');
    expect(standardMietbeginn('2026-12-05', null, null)).toBe('2027-01-01');
  });

  it('folgt dem Einzugswunsch aus der Selbstauskunft', () => {
    expect(standardMietbeginn('2026-10-18', null, '2026-12-15')).toBe('2026-12-15');
  });

  it('beginnt nie vor dem Ende des Vorvertrags', () => {
    expect(standardMietbeginn('2026-10-18', '2026-11-30', null)).toBe('2026-12-01');
  });

  it('ignoriert einen Wunsch in der Vergangenheit', () => {
    expect(standardMietbeginn('2026-10-18', null, '2024-05-01')).toBe('2026-11-01');
  });
});

describe('Personen aus der Selbstauskunft', () => {
  const auslese = {
    personen: [
      {
        vorname: 'Erika', nachname: 'Muster Beispiel', geburtsdatum: '2001-02-03',
        strasse: 'Hauptstraße', hausnummer: '2C', plz: '30455', ort: 'Hannover',
        telefon: '0151 1234567', email: 'erika@example.de', ist_interessent: true, verhaeltnis: null,
      },
      {
        vorname: 'Max', nachname: 'Beispiel', geburtsdatum: '2000-01-01',
        strasse: null, hausnummer: null, plz: null, ort: null,
        telefon: null, email: null, ist_interessent: false, verhaeltnis: 'Partner',
      },
    ],
    einzug_ab: 'sofort',
    objekt_adresse: null,
  };

  it('macht alle zu Mitmietern und gibt Personen ohne Anschrift die des Interessenten', () => {
    const personen = personenAusSelbstauskunft(auslese);
    expect(personen.map(p => p.rolle)).toEqual(['mitmieter', 'mitmieter']);
    expect(personen[1]).toMatchObject({ strasse: 'Hauptstraße', plz: '30455', ort: 'Hannover' });
  });

  it('führt nur Mitmieter als Vertragsparteien', () => {
    const personen = personenAusSelbstauskunft(auslese);
    personen[1].rolle = 'mitbewohner';
    const d = mitPersonen(baueEntwurf(grundlagen()).daten, personen);
    expect(d.mieter).toHaveLength(1);
    expect(d.mieter[0].nachname).toBe('Muster Beispiel');
  });
});

describe('Dubletten und Blacklist', () => {
  const bestand = [
    { id: 'm1', vorname: 'Erika', nachname: 'Muster Beispiel', geburtsdatum: '2001-02-03', hauptmail: null },
    { id: 'm2', vorname: 'Erika', nachname: 'Muster Beispiel', geburtsdatum: '1970-01-01', hauptmail: null },
    { id: 'm3', vorname: 'Jan', nachname: 'Andere', geburtsdatum: null, hauptmail: 'erika@example.de' },
  ];

  it('findet vorhandene Mieter über den Namen, auch mit Akzent', () => {
    const p = { ...leerePerson(), vorname: 'Érika', nachname: 'Muster-Beispiel', geburtsdatum: '2001-02-03' };
    expect(findeVorhandeneMieter(p, bestand).map(m => m.id)).toEqual(['m1']);
  });

  it('erkennt Umlaut und Umschrift als denselben Namen', () => {
    const p = { ...leerePerson(), vorname: 'Jürgen', nachname: 'Müller' };
    const treffer = findeVorhandeneMieter(p, [
      { id: 'u1', vorname: 'Juergen', nachname: 'Mueller', geburtsdatum: null, hauptmail: null },
      { id: 'u2', vorname: 'Jurgen', nachname: 'Muller', geburtsdatum: null, hauptmail: null },
      { id: 'u3', vorname: 'Juergen', nachname: 'Muller', geburtsdatum: null, hauptmail: null },
    ]);
    expect(treffer.map(m => m.id)).toEqual(['u1', 'u2', 'u3']);

    // Ohne Umlaut in der Eingabe sind „Mueller" und „Muller" verschiedene Namen
    const ohneUmlaut = { ...leerePerson(), vorname: 'Jan', nachname: 'Mueller' };
    expect(findeVorhandeneMieter(ohneUmlaut, [
      { id: 'x', vorname: 'Jan', nachname: 'Muller', geburtsdatum: null, hauptmail: null },
    ])).toEqual([]);
  });

  it('findet sie über die Mailadresse', () => {
    const p = { ...leerePerson(), vorname: 'X', nachname: 'Y', email: 'Erika@Example.de' };
    expect(findeVorhandeneMieter(p, bestand).map(m => m.id)).toEqual(['m3']);
  });

  it('meldet Blacklist-Treffer über Name in beliebiger Reihenfolge und Telefon', () => {
    const p = { ...leerePerson(), vorname: 'Erika', nachname: 'Muster', telefon: '+49 151 1234567' };
    const treffer = pruefeBlacklist([p], [
      { name: 'Muster, Erika', email: null, telefon: null, grund: 'Mietrückstand' },
      { name: 'Jemand anders', email: null, telefon: '0151/1234567', grund: null },
    ]);
    expect(treffer.map(t => t.merkmal)).toEqual(['Name', 'Telefon']);

    const mitNull = pruefeBlacklist([{ ...leerePerson(), telefon: '+49 (0) 511 123456' }], [
      { name: 'Jemand', email: null, telefon: '0511 123456', grund: null },
    ]);
    expect(mitNull).toHaveLength(1);
    expect(treffer[0].grund).toBe('Mietrückstand');
  });
});

describe('Datensätze beim Aktivieren', () => {
  it('speichert die gesamte Vorauszahlung, damit die Sollstellung stimmt', () => {
    const basis = baueEntwurf(grundlagen());
    const { daten, herkunft } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    const zeile = vertragsZeile({
      id: 'neu-1', einheitId: 'einh-509', daten, herkunft, vorvertragId: 'vv-1', mitVorlage: true,
    });
    expect(zeile.kaltmiete).toBe(1000);
    expect(zeile.betriebskosten).toBe(100);
    expect(zeile.heizkosten_vorauszahlung).toBe(50);
    expect(zeile.status).toBe('aktiv');
    expect(zeile.vorvertrag_id).toBe('vv-1');
    expect(zeile.vorlage_version).toBeTruthy();
    expect((zeile.werte_herkunft as Record<string, string>).kaltmiete).toBe('vorvertrag');
    expect(zeile.anzahl_personen).toBeNull();
  });

  it('übergibt keine leeren Karten und einen Bestandsmieter nur einmal', () => {
    const basis = baueEntwurf(grundlagen());
    const personen = [
      { ...leerePerson(), vorname: 'Erika', nachname: 'Muster', mieterId: 'm-alt' },
      { ...leerePerson() },
      { ...leerePerson(), vorname: 'Erika', nachname: 'Muster', mieterId: 'm-alt' },
      { ...leerePerson(), vorname: 'Max', nachname: 'Neu' },
      { ...leerePerson('mitbewohner'), vorname: 'Kind', nachname: 'Muster' },
    ];
    const z = aktivierungsDaten({
      id: 'neu-1', einheitId: 'einh-509', daten: basis.daten, herkunft: basis.herkunft,
      vorvertragId: 'vv-1', mitVorlage: false, personen,
    });
    expect(z.neueMieter.map(m => m.zeile.nachname)).toEqual(['Neu']);
    expect(z.verknuepfungen.map(v => [v.mieter_id, v.rolle, v.position])).toEqual([
      ['m-alt', 'Hauptmieter', 1],
      [null, 'Zweitmieter', 2],
    ]);
    expect(z.verknuepfungen[1].schluessel).toBe(z.neueMieter[0].schluessel);
    expect(z.vertrag.vorlage_version).toBeNull();
  });

  it('zählt die nachzuholenden Monate bis einschließlich des laufenden', () => {
    expect(monateNachzuholen('2026-07-15', '2026-10-18')).toBe(4);
    expect(monateNachzuholen('2026-10-01', '2026-10-18')).toBe(1);
    expect(monateNachzuholen('2026-11-01', '2026-10-18')).toBe(0);
    expect(monateNachzuholen('2016-11-01', '2026-10-18')).toBe(120);
    expect(monateNachzuholen(null, '2026-10-18')).toBe(0);
  });

  it('vergibt Rollen nach Position statt überall „Hauptmieter"', () => {
    expect([1, 2, 3, 4].map(mieterRolle)).toEqual(['Hauptmieter', 'Zweitmieter', 'Drittmieter', 'Drittmieter']);
  });

  it('legt Firmenmieter mit Firmenname und Anrede „Firma" an', () => {
    const zeile = mieterZeile({ ...leerePerson(), istUnternehmen: true, firmenname: 'Beispiel Bau GmbH' });
    expect(zeile).toMatchObject({ ist_unternehmen: true, firmenname: 'Beispiel Bau GmbH', anrede: 'Firma', nachname: 'GmbH' });
  });

  it('entfernt die Kennzeichnung eines von Hand geänderten Feldes', () => {
    const h = ohneHerkunft({ kaltmiete: 'vorvertrag', mietbeginn: 'berechnet' }, 'kaltmiete');
    expect(h).toEqual({ mietbeginn: 'berechnet' });
  });
});
