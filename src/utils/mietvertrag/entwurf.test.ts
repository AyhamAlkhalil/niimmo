/**
 * Vertragsentwurf: Vorbelegung aus Objekt, Einheit und Vorvertrag.
 *
 * Die Zahlen sind die der Wohnung, an der der Fehler vom 15.10.2026 auffiel:
 * Dachgeschoss rechts, 68 m², Vorvertrag 1.000 € kalt, in der Datenbank 100 €
 * Betriebskosten — laut Word-Vertrag 50 € Nebenkosten und 50 € Heizkosten.
 * Namen sind erfunden.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { Tables } from '@/integrations/supabase/types';
import {
  aktivierungsDaten,
  doppeltAufKarten,
  unvollstaendigeNamen,
  anzulegendeMieter,
  anzulegendePersonen,
  baueEntwurf,
  mitAngelegtenMietern,
  moeglicheDublettenIn,
  personName,
  findeVorhandeneMieter,
  monateNachzuholen,
  kautionFuer,
  leerePerson,
  mieterBezug,
  mieterRolle,
  mieterZeile,
  bestandsStammdaten,
  mitBestandsmieter,
  mitPersonen,
  ohneHerkunft,
  personenAusSelbstauskunft,
  positionenSumme,
  pruefeBlacklist,
  standardMietbeginn,
  sucheMieter,
  vertragsZeile,
  wendeVorvertragAuslese,
  type BestandsMieter,
  type EntwurfGrundlagen,
  type MieterVertragsbezug,
  type VorvertragAuslese,
} from './entwurf';
import { pruefeVertragsdaten } from './pflichtpruefung';
import {
  BETRKV_STANDARD,
  betriebskostenPositionen,
  mitSchluesselnDesObjekts,
  nichtUmgelegteKategorien,
  schluesselDesObjekts,
} from './datenAusDb';
import { wohnraumParagraphen } from './wohnraumKlauseln';
import {
  istSonstigePosition,
  naechsteSonstigeNummer,
  positionsKennung,
  positionsText,
  SONSTIGE_NUMMER,
  vertragsNummer,
  type MietvertragDaten,
} from './typen';
import { BETRKV_KATEGORIEN } from '@/components/dashboard/nebenkosten/nebenkostenKategorien';

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

describe('Neue und bestehende Mieter im selben Vertrag (27.10.2026)', () => {
  const bestand = [
    { id: 'b1', vorname: 'Jürgen', nachname: 'Müller', firmenname: null, hauptmail: 'jm@example.de', telnr: '+49 511 4912345' },
    { id: 'b2', vorname: 'Erika', nachname: 'Beispiel', firmenname: null, hauptmail: null, telnr: null },
    { id: 'b3', vorname: 'Muster', nachname: 'GmbH', firmenname: 'Muster Bau GmbH', hauptmail: null, telnr: '0511 777888' },
    { id: 'b4', vorname: 'Anna', nachname: 'Müller', firmenname: null, hauptmail: null, telnr: null },
  ];

  it('sucht über Teile von Vor- und Nachname, mit Umlaut und Umschrift', () => {
    expect(sucheMieter(bestand, 'mül').map(m => m.id)).toEqual(['b4', 'b1']);
    expect(sucheMieter(bestand, 'Mueller').map(m => m.id)).toEqual(['b4', 'b1']);
    expect(sucheMieter(bestand, 'jürgen mül').map(m => m.id)).toEqual(['b1']);
    expect(sucheMieter(bestand, 'erika xyz')).toEqual([]);
  });

  it('sucht über Firma, Mail und Telefon', () => {
    expect(sucheMieter(bestand, 'bau').map(m => m.id)).toEqual(['b3']);
    expect(sucheMieter(bestand, 'jm@').map(m => m.id)).toEqual(['b1']);
    expect(sucheMieter(bestand, '0511 4912').map(m => m.id)).toEqual(['b1']);
    expect(sucheMieter(bestand, '4912').map(m => m.id)).toEqual(['b1']);
    expect(sucheMieter(bestand, '+49511777').map(m => m.id)).toEqual(['b3']);
  });

  it('findet Rufnummern auch mit Leerzeichen nach der Landesvorwahl (QA 27.10.2026)', () => {
    expect(sucheMieter(bestand, '+49 511 4912345').map(m => m.id)).toEqual(['b1']);
    expect(sucheMieter(bestand, '0049 511 777').map(m => m.id)).toEqual(['b3']);
    expect(sucheMieter(bestand, '+49 (0) 511 777 888').map(m => m.id)).toEqual(['b3']);
    // Name und Nummer lassen sich mischen
    expect(sucheMieter(bestand, 'Müller +49 511').map(m => m.id)).toEqual(['b1']);
  });

  it('übergeht Wörter ohne Buchstaben und Ziffern', () => {
    expect(sucheMieter(bestand, 'Jürgen - Müller').map(m => m.id)).toEqual(['b1']);
  });

  it('zeigt ohne Suchwort den ganzen Bestand nach Nachnamen, ohne die schon gewählten', () => {
    expect(sucheMieter(bestand, '  ').map(m => m.id)).toEqual(['b2', 'b3', 'b4', 'b1']);
    expect(sucheMieter(bestand, '', new Set(['b1', 'b3'])).map(m => m.id)).toEqual(['b2', 'b4']);
  });

  const bestandsMieter: BestandsMieter = {
    id: 'b1',
    vorname: 'Jürgen',
    nachname: 'Müller',
    geburtsdatum: null,
    hauptmail: 'jm@example.de',
    telnr: null,
    anrede: 'Herr',
    strasse: null,
    hausnummer: null,
    plz: null,
    ort: null,
    ist_unternehmen: false,
    firmenname: null,
    vertreten_durch: null,
  };

  it('übernimmt den Bestandsmieter in eine Karte, ohne Eingaben der Karte zu verlieren', () => {
    const karte = { ...leerePerson(), strasse: 'Alte Str.', hausnummer: '1', plz: '30159', ort: 'Hannover', telefon: '0511 1' };
    const p = mitBestandsmieter(karte, bestandsMieter);
    expect(p).toMatchObject({
      schluessel: karte.schluessel,
      mieterId: 'b1',
      quelle: 'bestand',
      rolle: 'mitmieter',
      vorname: 'Jürgen',
      nachname: 'Müller',
      anrede: 'Herr',
      email: 'jm@example.de',
      telefon: '0511 1',
      strasse: 'Alte Str.',
      ort: 'Hannover',
    });
  });

  it('nimmt leere Texte im Bestand nicht als Angabe', () => {
    const karte = { ...leerePerson(), vorname: 'Jürgen', email: 'karte@example.de' };
    const p = mitBestandsmieter(karte, { ...bestandsMieter, vorname: '', hauptmail: ' ' });
    expect(p.vorname).toBe('Jürgen');
    expect(p.email).toBe('karte@example.de');
  });

  it('macht aus einem Firmenmieter ohne Firmennamen keine leere Karte', () => {
    const firma = { ...bestandsMieter, ist_unternehmen: true, firmenname: null, vorname: 'Muster', nachname: '(Firma)' };
    const p = mitBestandsmieter(leerePerson(), firma);
    expect(p).toMatchObject({ istUnternehmen: true, firmenname: 'Muster' });
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [p],
    });
    expect(z.verknuepfungen.map(v => v.mieter_id)).toEqual(['b1']);
  });

  it('legt beim Aktivieren nur die neuen Personen an und verknüpft beide Arten in der Reihenfolge der Karten', () => {
    const bestehend = mitBestandsmieter(leerePerson(), bestandsMieter);
    const neu = { ...leerePerson(), vorname: 'Erika', nachname: 'Neu' };
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [bestehend, neu, leerePerson()],
    });
    expect(z.neueMieter.map(n => n.schluessel)).toEqual([neu.schluessel]);
    expect(z.verknuepfungen.map(v => [v.mieter_id, v.schluessel, v.rolle])).toEqual([
      ['b1', bestehend.schluessel, 'Hauptmieter'],
      [null, neu.schluessel, 'Zweitmieter'],
    ]);
  });

  it('gibt bei Bestandsmietern die Kartenangaben für die Stammdaten mit, bei neuen nicht', () => {
    const bestehend = {
      ...mitBestandsmieter(leerePerson(), bestandsMieter),
      email: ' neu@example.de ',
      telefon: '0511 2',
      geburtsdatum: '1980-05-06',
      strasse: 'Teststr.',
      hausnummer: '3',
      plz: '30159',
      ort: 'Hannover',
    };
    const neu = { ...leerePerson(), vorname: 'Erika', nachname: 'Neu', email: 'erika@example.de' };
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [bestehend, neu],
    });
    // Nur Ergänztes und Geändertes — Anrede und Vertretung stehen wie im Bestand
    expect(z.verknuepfungen[0].stammdaten).toEqual({
      hauptmail: 'neu@example.de',
      telnr: '0511 2',
      geburtsdatum: '1980-05-06',
      strasse: 'Teststr.',
      hausnummer: '3',
      plz: '30159',
      ort: 'Hannover',
    });
    // Name und Firma gehen nie mit — die bleiben im Bestand, wie sie sind
    expect(Object.keys(z.verknuepfungen[0].stammdaten ?? {})).not.toContain('vorname');
    expect(z.verknuepfungen[1]).not.toHaveProperty('stammdaten');
  });

  it('schreibt beim Aktivieren keinen alten Stand über neuere Stammdaten', () => {
    // 27.10.2026: Entwurf an Tag 1, neue Mail im Bestand an Tag 5, Aktivieren an Tag 10
    // schrieb die alte Mail zurück. Unveränderte Kartenfelder gehen jetzt nicht mit.
    const karte = mitBestandsmieter(leerePerson(), { ...bestandsMieter, telnr: '0511 111' });
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [karte],
    });
    expect(z.verknuepfungen[0].stammdaten).toEqual({});
  });

  it('hält eine unveränderte Firmenkarte für unverändert', () => {
    // QA 27.10.2026: Anrede „Firma“ und fehlendes Geburtsdatum galten sonst als Änderung
    const firma = { ...bestandsMieter, ist_unternehmen: true, firmenname: 'Muster GmbH', anrede: null, geburtsdatum: '1970-01-01', vertreten_durch: ' Max Muster ' };
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [mitBestandsmieter(leerePerson(), firma)],
    });
    expect(z.verknuepfungen[0].stammdaten).toEqual({});
  });

  it('gibt einer Karte ohne gemerkten Bestand weiter alle Felder mit', () => {
    const { bestandStand: _weg, ...alt } = mitBestandsmieter(leerePerson(), bestandsMieter);
    const z = aktivierungsDaten({
      id: 'v1',
      einheitId: 'e1',
      daten: baueEntwurf(grundlagen()).daten,
      herkunft: {},
      vorvertragId: null,
      mitVorlage: true,
      personen: [alt],
    });
    expect(z.verknuepfungen[0].stammdaten).toMatchObject({ hauptmail: 'jm@example.de', anrede: 'Herr' });
  });

  it('ergänzt nach dem Aktivieren nur auf der Karte geänderte Felder', () => {
    // 27.10.2026: Der Nachtrag nahm die ganze alte Karte — eine im Bestand gelöschte Rufnummer kam zurück
    const karte = mitBestandsmieter(leerePerson(), { ...bestandsMieter, telnr: '0511 111' });
    expect(bestandsStammdaten(karte)).toEqual({});
    expect(bestandsStammdaten({ ...karte, telefon: '0511 222' })).toEqual({ telnr: '0511 222' });
    const dienst = readFileSync('src/services/mietvertragEntwurfService.ts', 'utf-8');
    expect(dienst).toMatch(/const neu = bestandsStammdaten\(p\);/);
  });

  describe('wo der Mieter wohnt oder wohnte', () => {
    const stichtag = new Date('2026-10-27T12:00:00');
    type Vertrag = NonNullable<MieterVertragsbezug['mietvertrag']>;
    const vertrag = (
      v: Partial<Vertrag>,
      objekt = 'Liebigstr. 12',
      typ: Tables<'einheiten'>['einheitentyp'] = 'Wohnung'
    ): MieterVertragsbezug => ({
      mietvertrag: {
        status: 'aktiv',
        start_datum: '2020-01-01',
        ende_datum: null,
        kuendigungsdatum: null,
        einheiten: { einheitentyp: typ, immobilien: { name: objekt } },
        ...v,
      },
    });

    it('nennt laufende Verträge', () => {
      expect(
        mieterBezug([vertrag({}), vertrag({}, 'Liebigstr. 12', 'Stellplatz'), vertrag({ status: 'beendet', ende_datum: '2019-12-31' }, 'Altbau')], stichtag)
      ).toBe('aktuell: Liebigstr. 12, Wohnung; Liebigstr. 12, Stellplatz');
    });

    it('nennt einen künftigen Vertrag mit Beginn', () => {
      expect(mieterBezug([vertrag({ start_datum: '2026-12-01' })], stichtag)).toBe('ab 01.12.2026: Liebigstr. 12, Wohnung');
    });

    it('nennt sonst den zuletzt beendeten', () => {
      expect(
        mieterBezug(
          [
            vertrag({ status: 'beendet', ende_datum: '2021-03-31' }, 'Erstes Haus'),
            vertrag({ status: 'gekuendigt', ende_datum: null, kuendigungsdatum: '2025-06-30' }, 'Zweites Haus'),
          ],
          stichtag
        )
      ).toBe('bis 30.06.2025: Zweites Haus, Wohnung');
    });

    it('nennt zwei gleiche laufende Verträge einmal', () => {
      expect(mieterBezug([vertrag({}), vertrag({})], stichtag)).toBe('aktuell: Liebigstr. 12, Wohnung');
    });

    it('nennt einen beendeten Vertrag ohne Datum als früher', () => {
      expect(mieterBezug([vertrag({ status: 'beendet', start_datum: '2015-01-01' }, 'Altbau')], stichtag)).toBe('früher: Altbau, Wohnung');
    });

    it('bleibt leer ohne Vertrag', () => {
      expect(mieterBezug([], stichtag)).toBeNull();
      expect(mieterBezug([{ mietvertrag: null }], stichtag)).toBeNull();
      expect(mieterBezug(undefined, stichtag)).toBeNull();
    });
  });
});

// 28.10.2026: Die Auslese läuft im Hintergrund. Was der Nutzer währenddessen ändert, darf sie danach
// nicht zurücksetzen — bis dahin kam die Vorauszahlung als „Gesamt-BK − Heizkosten" zurück, ebenso
// ein abgewählter Kündigungsverzicht.
describe('Auslese des alten Vertragsdokuments lässt Handeingaben stehen', () => {
  it('überschreibt eine von Hand geänderte Vorauszahlung nicht', () => {
    const basis = baueEntwurf(grundlagen());
    const daten = { ...basis.daten, betriebskostenVorauszahlung: 120 };
    const herkunft = ohneHerkunft(basis.herkunft, 'betriebskostenVorauszahlung');
    const neu = wendeVorvertragAuslese(daten, herkunft, AUSLESE, 100);
    expect(neu.daten.betriebskostenVorauszahlung).toBe(120);
    expect(neu.herkunft.betriebskostenVorauszahlung).toBeUndefined();
  });

  it('übernimmt die Heizkosten nicht, wenn die Vorauszahlung von Hand gesetzt ist — die Summe stiege still', () => {
    const basis = baueEntwurf(grundlagen());
    const daten = { ...basis.daten, betriebskostenVorauszahlung: 120 };
    const herkunft = ohneHerkunft(basis.herkunft, 'betriebskostenVorauszahlung');
    const summe = (x: typeof daten) => x.betriebskostenVorauszahlung + (x.heizkostenVorauszahlung ?? 0);

    const ueberHerkunft = wendeVorvertragAuslese(daten, herkunft, AUSLESE, 100);
    expect(ueberHerkunft.daten.heizkostenVorauszahlung).toBeNull();
    expect(summe(ueberHerkunft.daten)).toBe(120);

    const ueberVonHand = wendeVorvertragAuslese(daten, basis.herkunft, AUSLESE, 100, f => f === 'betriebskostenVorauszahlung');
    expect(ueberVonHand.daten.heizkostenVorauszahlung).toBeNull();
    expect(ueberVonHand.daten.betriebskostenVorauszahlung).toBe(120);
    expect(ueberVonHand.herkunft.heizkostenVorauszahlung).toBeUndefined();
  });

  it('trennt die Heizkosten weiter heraus, wenn die Vorauszahlung mitgeht', () => {
    const basis = baueEntwurf(grundlagen());
    const vorher = basis.daten.betriebskostenVorauszahlung + (basis.daten.heizkostenVorauszahlung ?? 0);
    const neu = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100, () => false);
    expect(neu.daten.heizkostenVorauszahlung).toBe(50);
    expect(neu.daten.betriebskostenVorauszahlung + (neu.daten.heizkostenVorauszahlung ?? 0)).toBe(vorher);
  });

  it('lässt auch eine von Hand geleerte Vorauszahlung leer', () => {
    const basis = baueEntwurf(grundlagen());
    const daten = { ...basis.daten, betriebskostenVorauszahlung: 0 };
    const herkunft = ohneHerkunft(basis.herkunft, 'betriebskostenVorauszahlung');
    const neu = wendeVorvertragAuslese(daten, herkunft, AUSLESE, 100, f => f === 'betriebskostenVorauszahlung');
    expect(neu.daten.betriebskostenVorauszahlung).toBe(0);
  });

  it('ersetzt die Vorauszahlung, solange sie noch aus dem Vorvertrag stammt', () => {
    const basis = baueEntwurf(grundlagen());
    expect(basis.herkunft.betriebskostenVorauszahlung).toBe('vorvertrag');
    const neu = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100, () => false);
    expect(neu.daten.betriebskostenVorauszahlung).toBe(50);
  });

  it('bringt einen abgewählten Kündigungsverzicht nicht zurück', () => {
    const basis = baueEntwurf(grundlagen());
    const auslese = { ...AUSLESE, mindestlaufzeit_monate: 12 };
    const ohneHand = wendeVorvertragAuslese(basis.daten, basis.herkunft, auslese, 100);
    expect(ohneHand.daten.kuendigungsverzichtBis).toBeTruthy();

    const abgewaehlt = wendeVorvertragAuslese(
      { ...basis.daten, kuendigungsverzichtBis: null },
      ohneHerkunft(basis.herkunft, 'kuendigungsverzichtBis'),
      auslese,
      100,
      f => f === 'kuendigungsverzichtBis'
    );
    expect(abgewaehlt.daten.kuendigungsverzichtBis).toBeNull();
    expect(abgewaehlt.herkunft.kuendigungsverzichtBis).toBeUndefined();
  });

  it('füllt ein von Hand geleertes Feld nicht wieder', () => {
    const basis = baueEntwurf(grundlagen());
    const neu = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100, f => f === 'einheit.bezeichnung');
    expect(neu.daten.einheit.bezeichnung).toBe('');
    expect(neu.herkunft['einheit.bezeichnung']).toBeUndefined();
  });
});

describe('Auslese fragt vonHand mit den Schlüsseln der Formulare', () => {
  it('nutzt dieselben Feldnamen, die MieteSchritt und Abschnitte an geaendert() melden', () => {
    // Abschnitte: `einheit.${feld}`, 'schliessanlageArt', 'betriebskostenPositionen';
    // MieteSchritt: setze(feld) mit dem Feldnamen des Entwurfs (28.10.2026 geprüft)
    const formularSchluessel = new Set([
      'einheit.bezeichnung', 'einheit.lage', 'einheit.raumaufstellung', 'einheit.wohnflaecheQm',
      'schliessanlageArt', 'kaltmiete', 'kautionBetrag', 'betriebskostenVorauszahlung',
      'heizkostenVorauszahlung', 'kuendigungsverzichtBis', 'betriebskostenPositionen',
    ]);
    const gefragt = new Set<string>();
    const basis = baueEntwurf(grundlagen({ vorvertrag: null }));
    wendeVorvertragAuslese(basis.daten, basis.herkunft, { ...AUSLESE, mindestlaufzeit_monate: 12 }, null, f => {
      gefragt.add(f);
      return false;
    });
    expect([...gefragt].filter(f => !formularSchluessel.has(f))).toEqual([]);
    expect(gefragt.size).toBeGreaterThanOrEqual(8);
  });
});

describe('Verteilerschlüssel aus der Betriebskostenabrechnung des Objekts', () => {
  type Art = EntwurfGrundlagen['nebenkostenarten'][number];
  const art = (name: string, verteilerschluessel_art: string | null): Art => ({
    name,
    verteilerschluessel_art,
    ist_umlagefaehig: true,
  });
  const schluessel = (positionen: { nummer: string; schluessel: string }[], nummer: string) =>
    positionen.find(p => p.nummer === nummer)!.schluessel;

  it('jede Vertragsposition hängt an einer Kostenart der Abrechnung', () => {
    const ids = new Set(BETRKV_KATEGORIEN.map(k => k.id));
    expect(BETRKV_STANDARD.filter(p => !ids.has(p.kategorie))).toEqual([]);
  });

  it('nimmt ohne Pflege am Objekt die Kundenvorgabe statt Verbrauch und Nutzerzahl', () => {
    const { daten } = baueEntwurf(grundlagen());
    const p = daten.betriebskostenPositionen;
    expect(schluessel(p, '2.1')).toBe('gleich');
    expect(schluessel(p, '2.2')).toBe('personen');
    expect(schluessel(p, '2.3')).toBe('qm');
    expect(schluessel(p, '2.15')).toBe('gleich');
    expect(schluessel(p, '2.17')).toBe('qm');
    expect(schluessel(p, '2.18')).toBe('gleich');
    expect(p.every(x => ['qm', 'personen', 'gleich'].includes(x.schluessel))).toBe(true);
  });

  it('übernimmt den am Objekt gepflegten Schlüssel, zugeordnet wie in der Abrechnung', () => {
    const arten = [art('Wasserversorgung', 'qm'), art('Müllabfuhr', 'gleich'), art('Versicherungen', 'personen')];
    const { daten } = baueEntwurf(grundlagen({ nebenkostenarten: arten }));
    const p = daten.betriebskostenPositionen;
    expect(schluessel(p, '2.2')).toBe('qm');
    // „Müllabfuhr" und „Versicherungen" trifft der Namensvergleich des Vertrags nicht, die Abrechnung schon
    expect(schluessel(p, '2.8')).toBe('gleich');
    expect(schluessel(p, '2.13')).toBe('personen');
    expect(p.find(x => x.nummer === '2.2')!.schluesselObjekt).toBe('qm');
  });

  it('nimmt bei mehreren Arten einer Kostenart den gepflegten Schlüssel einer umlagefähigen Art', () => {
    expect(schluesselDesObjekts([art('Heizung', null), art('Heizkosten', 'qm')], 'heizkosten')).toBe('qm');
    const nichtUmlagefaehig = { ...art('Heizung', 'personen'), ist_umlagefaehig: false };
    expect(schluesselDesObjekts([nichtUmlagefaehig, art('Heizkosten', 'qm')], 'heizkosten')).toBe('qm');
    expect(schluesselDesObjekts([nichtUmlagefaehig], 'heizkosten')).toBe('gleich');
  });

  it('rechnet einen nicht berechenbaren Altwert wie die Abrechnung nach Wohnfläche', () => {
    expect(schluesselDesObjekts([art('Wasserversorgung', 'individuell')], 'wasserversorgung')).toBe('qm');
    expect(schluesselDesObjekts([art('Wasserversorgung', null)], 'wasserversorgung')).toBe('personen');
  });

  it('übernimmt „nach Verbrauch“ in den Vertrag, seit die Abrechnung ihn erfasst (10.11.2026)', () => {
    expect(schluesselDesObjekts([art('Wasserversorgung', 'verbrauch')], 'wasserversorgung')).toBe('verbrauch');
  });

  it('nimmt beim neuen Vertrag Umlage und Betrag vom Vorvertrag, den Schlüssel aber vom Objekt', () => {
    const vorvertrag = {
      ...VORVERTRAG,
      betriebskosten_positionen: [
        { nummer: '2.2', bezeichnung: 'Kosten der Wasserversorgung', schluessel: 'verbrauch', umgelegt: true, betrag: 30 },
      ],
    } as unknown as Tables<'mietvertrag'>;
    const { daten } = baueEntwurf(grundlagen({ vorvertrag }));
    expect(daten.betriebskostenPositionen.find(p => p.nummer === '2.2')).toMatchObject({
      umgelegt: true,
      betrag: 30,
      schluessel: 'personen',
    });
  });

  it('druckt einen unterschriebenen Vertrag mit seinem gespeicherten Schlüssel nach', () => {
    const gespeichert = [{ nummer: '2.2', schluessel: 'verbrauch', umgelegt: true, betrag: 30 }];
    const p = betriebskostenPositionen([], gespeichert).find(x => x.nummer === '2.2')!;
    expect(p.schluessel).toBe('verbrauch');
    expect(p.schluesselObjekt).toBe('personen');
  });

  it('frischt beim Nachdruck nur den Vergleichswert auf', () => {
    const { daten } = baueEntwurf(grundlagen());
    const positionen = daten.betriebskostenPositionen.map(p => (p.nummer === '2.2' ? { ...p, schluessel: 'qm' } : p));
    const frisch = mitSchluesselnDesObjekts(positionen, [art('Wasserversorgung', 'gleich')]);
    expect(frisch.find(p => p.nummer === '2.2')).toMatchObject({ schluessel: 'qm', schluesselObjekt: 'gleich' });
  });

  it('übernimmt im neuen Vertrag den Schlüssel des Objekts, auch einen früher abweichenden (03.11.2026)', () => {
    const { daten } = baueEntwurf(grundlagen());
    const positionen = daten.betriebskostenPositionen.map(p => (p.nummer === '2.2' ? { ...p, schluessel: 'qm' } : p));
    const frisch = mitSchluesselnDesObjekts(positionen, [art('Wasserversorgung', 'gleich')], { uebernehmen: true });
    expect(frisch.find(p => p.nummer === '2.2')).toMatchObject({ schluessel: 'gleich', schluesselObjekt: 'gleich' });
    expect(frisch.every(p => p.schluessel === p.schluesselObjekt)).toBe(true);
    const unbekannt = { nummer: '9.9', bezeichnung: 'x', umgelegt: true, schluessel: 'qm', betrag: null };
    expect(mitSchluesselnDesObjekts([unbekannt], [], { uebernehmen: true })[0]).toBe(unbekannt);
  });

  it('nennt die übernommenen Schlüssel in § 4', () => {
    const { daten } = baueEntwurf(grundlagen());
    daten.betriebskostenPositionen = daten.betriebskostenPositionen.map(p =>
      ['2.1', '2.2', '2.3', '2.15'].includes(p.nummer) ? { ...p, umgelegt: true } : p
    );
    const p4 = wohnraumParagraphen(daten).find(p => p.absaetze.some(a => a.kosten))!;
    // Seit 04.11.2026 je Zeile in der Tabelle statt als Sammelzeilen darunter (Kundenentscheidung)
    const zeilen = p4.absaetze.find(a => a.kosten)!.kosten!.zeilen;
    const verteilung = (nummer: string) => zeilen.find(z => z.nummer === nummer)?.verteilung;
    expect(verteilung('2.1')).toBe('je Einheit');
    expect(verteilung('2.15')).toBe('je Einheit');
    expect(verteilung('2.3')).toBe('Wohnfläche');
    expect(verteilung('2.2')).toBe('Personenzahl');
    // Nicht umgelegte Positionen bekommen keinen Schlüssel
    expect(verteilung('2.7')).toBe('');
    const text = p4.absaetze.map(a => a.text).join('\n');
    expect(text).not.toContain('— Verteilung nach');
    expect(text).not.toMatch(/Verbrauch|Nutzerzahl/);
  });

  it('warnt, wenn der Vertrag von der Abrechnung des Objekts abweicht', () => {
    const { daten } = baueEntwurf(grundlagen());
    const mit = (s: string, modus: MietvertragDaten['betriebskostenModus'] = 'vorauszahlung'): MietvertragDaten => ({
      ...daten,
      betriebskostenModus: modus,
      betriebskostenPositionen: daten.betriebskostenPositionen.map(p =>
        p.nummer === '2.2' ? { ...p, umgelegt: true, schluessel: s } : p
      ),
    });
    const warnung = (d: MietvertragDaten) =>
      pruefeVertragsdaten(d).find(f => f.text.startsWith('Verteilerschlüssel weicht'));

    expect(warnung(mit('qm'))).toMatchObject({ schwere: 'warnung', feld: 'betriebskostenPositionen' });
    expect(warnung(mit('qm'))!.text).toContain('2.2 im Vertrag nach Wohnfläche, in der Abrechnung nach Personenzahl');
    expect(warnung(mit('personen'))).toBeUndefined();
    // Pauschale: Es wird nicht abgerechnet, der Schlüssel spielt keine Rolle
    expect(warnung(mit('qm', 'pauschale'))).toBeUndefined();
    // „einheit" ist der Altname von „gleich"
    const gleich = { ...daten, betriebskostenPositionen: [{ ...daten.betriebskostenPositionen[0], umgelegt: true, schluessel: 'einheit' }] };
    expect(warnung(gleich)).toBeUndefined();
  });
});

describe('Sonstige Betriebskosten benennen (03.11.2026)', () => {
  const mitLueftung = (daten: MietvertragDaten): MietvertragDaten => ({
    ...daten,
    betriebskostenPositionen: [
      ...daten.betriebskostenPositionen.map(p =>
        p.nummer === SONSTIGE_NUMMER ? { ...p, umgelegt: true, benennung: ' Lüftungsanlage ', betrag: null } : p
      ),
      {
        nummer: naechsteSonstigeNummer(daten.betriebskostenPositionen),
        bezeichnung: 'Sonstige Betriebskosten',
        benennung: 'Dachrinnenreinigung',
        umgelegt: true,
        schluessel: 'qm',
        betrag: null,
      },
    ],
  });

  it('erkennt 2.19 und die angefügten Positionen und zählt weiter', () => {
    expect(istSonstigePosition('2.19')).toBe(true);
    expect(istSonstigePosition('2.20')).toBe(true);
    expect(istSonstigePosition('2.18')).toBe(false);
    expect(istSonstigePosition('2.1')).toBe(false);
    expect(naechsteSonstigeNummer(BETRKV_STANDARD)).toBe('2.20');
    expect(naechsteSonstigeNummer([...BETRKV_STANDARD, { nummer: '2.20' }, { nummer: '2.21' }])).toBe('2.22');
  });

  it('druckt die Benennung in § 4', () => {
    const daten = mitLueftung(baueEntwurf(grundlagen()).daten);
    const zeilen = daten.betriebskostenPositionen.map(positionsText);
    expect(zeilen).toContain('Sonstige Betriebskosten: Lüftungsanlage');
    expect(zeilen).toContain('Sonstige Betriebskosten: Dachrinnenreinigung');
    // Nur bei sonstigen: eine verirrte Benennung an 2.4 erscheint nicht
    expect(positionsText({ nummer: '2.4', bezeichnung: 'Heizung', benennung: 'x' })).toBe('Heizung');
    const tabelle = wohnraumParagraphen(daten).flatMap(p => p.absaetze).find(a => a.kosten)!.kosten!;
    expect(tabelle.zeilen).toContainEqual(expect.objectContaining({ nummer: '2.19', bezeichnung: 'Sonstige Betriebskosten: Lüftungsanlage' }));
    // Jede weitere sonstige Position steht ebenfalls unter 2.19, nie unter 2.20 (12.11.2026)
    expect(tabelle.zeilen).toContainEqual(expect.objectContaining({ nummer: '2.19', bezeichnung: 'Sonstige Betriebskosten: Dachrinnenreinigung' }));
    expect(tabelle.zeilen.map(z => z.nummer)).not.toContain('2.20');
    expect(tabelle.zeilen.filter(z => z.nummer === '2.19')).toHaveLength(2);
  });

  it('nummeriert alle sonstigen Betriebskosten als 2.19 (12.11.2026)', () => {
    expect(vertragsNummer('2.19')).toBe('2.19');
    expect(vertragsNummer('2.20')).toBe('2.19');
    expect(vertragsNummer('2.23')).toBe('2.19');
    expect(vertragsNummer('2.18')).toBe('2.18');
    expect(vertragsNummer(' 2.4 ')).toBe('2.4');
    expect(positionsKennung({ nummer: '2.21', benennung: ' Lüftungsanlage ' })).toBe('2.19 (Lüftungsanlage)');
    expect(positionsKennung({ nummer: '2.20', benennung: '' })).toBe('2.19');
    expect(positionsKennung({ nummer: '2.4', benennung: 'x' })).toBe('2.4');
  });

  it('nennt in den Hinweisen 2.19 statt der internen Kennung', () => {
    const daten = mitLueftung(baueEntwurf(grundlagen()).daten);
    const ohneBetrag = {
      ...daten,
      betriebskostenVorauszahlung: 50,
      betriebskostenPositionen: daten.betriebskostenPositionen.map(p =>
        p.nummer === '2.1' ? { ...p, umgelegt: true, betrag: 50 } : p
      ),
    };
    const befund = pruefeVertragsdaten(ohneBetrag).find(b => b.text.includes('haben keinen Betrag'));
    expect(befund?.text).toContain('2.19 (Lüftungsanlage), 2.19 (Dachrinnenreinigung)');
    expect(befund?.text).not.toContain('2.20');

    const zweiUnbenannt = {
      ...daten,
      betriebskostenPositionen: daten.betriebskostenPositionen.map(p => (istSonstigePosition(p.nummer) ? { ...p, benennung: '' } : p)),
    };
    const unbenannt = pruefeVertragsdaten(zweiUnbenannt).find(b => b.text.startsWith('Sonstige Betriebskosten werden umgelegt'));
    expect(unbenannt?.text).toContain('2 Positionen unter 2.19');
    expect(unbenannt?.text).not.toContain('2.20');
  });

  it('speichert die Benennung am Vertrag und liest weitere Positionen zurück', () => {
    const basis = baueEntwurf(grundlagen());
    const daten = mitLueftung(basis.daten);
    const zeile = vertragsZeile({ id: 'v', einheitId: 'e', daten, herkunft: basis.herkunft, vorvertragId: null, mitVorlage: true });
    const gespeichert = zeile.betriebskosten_positionen as { nummer: string; benennung?: string }[];
    expect(gespeichert.find(p => p.nummer === '2.19')?.benennung).toBe('Lüftungsanlage');
    expect(gespeichert.find(p => p.nummer === '2.20')?.benennung).toBe('Dachrinnenreinigung');
    expect(gespeichert.find(p => p.nummer === '2.1')).not.toHaveProperty('benennung');

    const gelesen = betriebskostenPositionen([], gespeichert);
    expect(gelesen.map(p => p.nummer).slice(-2)).toEqual(['2.19', '2.20']);
    expect(gelesen.find(p => p.nummer === '2.19')?.benennung).toBe('Lüftungsanlage');
    expect(gelesen.find(p => p.nummer === '2.20')).toMatchObject({
      benennung: 'Dachrinnenreinigung',
      umgelegt: true,
      schluesselObjekt: schluesselDesObjekts([], 'sonstige_betriebskosten'),
    });
    // Auch der Vergleichswert der Abrechnung kommt an die angefügte Position
    expect(mitSchluesselnDesObjekts(gelesen, []).find(p => p.nummer === '2.20')?.schluesselObjekt).toBeTruthy();
  });

  it('liest eine gespeicherte Nummer mit Leerzeichen als dieselbe Position (QA 03.11.2026)', () => {
    const gelesen = betriebskostenPositionen([], [{ nummer: ' 2.19 ', umgelegt: true, betrag: 1, benennung: 'Lüftung' }]);
    expect(gelesen.filter(p => p.nummer === '2.19')).toHaveLength(1);
    expect(gelesen.find(p => p.nummer === '2.19')).toMatchObject({ umgelegt: true, betrag: 1, benennung: 'Lüftung' });
  });

  it('warnt, wenn sonstige Betriebskosten unbenannt umgelegt werden', () => {
    const basis = baueEntwurf(grundlagen()).daten;
    const unbenannt = {
      ...basis,
      betriebskostenPositionen: basis.betriebskostenPositionen.map(p =>
        p.nummer === SONSTIGE_NUMMER ? { ...p, umgelegt: true, benennung: '  ' } : p
      ),
    };
    const befund = pruefeVertragsdaten(unbenannt).find(b => b.text.startsWith('Sonstige Betriebskosten werden umgelegt'));
    expect(befund?.schwere).toBe('warnung');
    expect(befund?.text).toContain('2.19');
    expect(pruefeVertragsdaten(mitLueftung(basis)).some(b => b.text.startsWith('Sonstige Betriebskosten werden'))).toBe(false);
  });
});

describe('Vorgaben neuer Entwürfe (04.11.2026)', () => {
  it('beginnt mit Indexmiete und dem letzten Verbraucherpreisindex', () => {
    const { daten, herkunft } = baueEntwurf(grundlagen({ vpi: { wert: '121.7', stichtag: '2026-09-30' } }));
    expect(daten.mietanpassungArt).toBe('index');
    expect(daten.indexBasisWert).toBe(121.7);
    expect(daten.indexBasisMonat).toBe('2026-09-01');
    expect(herkunft.indexBasisWert).toBe('marktdaten');
  });

  it('bleibt ohne veröffentlichten Index bei der ortsüblichen Vergleichsmiete', () => {
    const { daten } = baueEntwurf(grundlagen({ vpi: null }));
    expect(daten.mietanpassungArt).toBe('keine');
    expect(daten.indexBasisWert).toBeNull();
    // Ein Stichtag ohne Datum ergibt keinen Basismonat „abc-01“ (QA 05.11.2026)
    expect(baueEntwurf(grundlagen({ vpi: { wert: 100, stichtag: 'abc' } })).daten.mietanpassungArt).toBe('keine');
  });

  it('nimmt das Mietkonto aus den Stammdaten, auch wenn am Objekt eine Kontonummer steht', () => {
    // IMMOBILIE trägt eine Kontonummer; bis 04.11.2026 ging sie vor (Celle: …4105 46 statt des Mietkontos)
    expect(IMMOBILIE['Kontonr.']).toBeTruthy();
    const ohne = baueEntwurf(grundlagen());
    expect(ohne.daten.vermieter.mietIban).toBeNull();
    expect(ohne.herkunft['vermieter.mietIban']).toBeUndefined();
    const mit = baueEntwurf(grundlagen({ vermieter: { ...VERMIETER, miet_iban: 'DE62255914133155410502' } as Tables<'vermieter'> }));
    expect(mit.daten.vermieter.mietIban).toBe('DE62255914133155410502');
    expect(mit.herkunft['vermieter.mietIban']).toBe('stammdaten');
  });
});

describe('Nicht umgelegte Kostenarten für die Abrechnung (06.11.2026)', () => {
  it('ordnet Vertragspositionen über die Kostenart zu, nicht über die Nummer', () => {
    // Rauchwarnmelder (2.17) nicht umgelegt, sonstige (2.19) schon: „Sonstige“ bleibt umgelegt
    expect([
      ...nichtUmgelegteKategorien([
        { nummer: '2.17', umgelegt: false },
        { nummer: '2.19', umgelegt: true, benennung: 'Lüftungsanlage' },
      ]),
    ]).toEqual([]);
    // Abgasmessung (2.18) umgelegt hält die Schornsteinreinigung (2.12) in der Umlage
    expect(nichtUmgelegteKategorien([{ nummer: '2.12', umgelegt: false }, { nummer: '2.18', umgelegt: true }]).size).toBe(0);
  });

  it('lässt eine Kostenart beim Vermieter, wenn keine ihrer Positionen umgelegt ist', () => {
    const k = nichtUmgelegteKategorien([
      { nummer: '2.7', umgelegt: false },
      { nummer: '2.17', umgelegt: false },
      { nummer: '2.19', umgelegt: false },
      { nummer: '2.20', umgelegt: false },
      { nummer: '2.12', umgelegt: false },
      { nummer: '2.18', umgelegt: false },
      { nummer: '2.1', umgelegt: true },
      { nummer: '2.10' },
    ]);
    expect([...k].sort()).toEqual(['aufzug', 'schornsteinreinigung', 'sonstige_betriebskosten']);
    // Eine weitere sonstige Position ab 2.20 hält „Sonstige“ in der Umlage
    expect(nichtUmgelegteKategorien([{ nummer: '2.19', umgelegt: false }, { nummer: '2.21', umgelegt: true }]).size).toBe(0);
  });

  it('legt ohne Aufstellung alles um', () => {
    expect(nichtUmgelegteKategorien(null).size).toBe(0);
    expect(nichtUmgelegteKategorien('kaputt').size).toBe(0);
    expect(nichtUmgelegteKategorien([{ umgelegt: false }, null, { nummer: '9.9', umgelegt: false }]).size).toBe(0);
  });
});

describe('Mieter anlegen, ohne Vertrag (Kundenwunsch 10.11.2026)', () => {
  const daten = () => baueEntwurf(grundlagen()).daten;
  const neu = { ...leerePerson(), vorname: 'Erika', nachname: 'Neu', email: 'erika@example.de', geburtsdatum: '1990-05-01' };
  const mitbewohner = { ...leerePerson(), rolle: 'mitbewohner' as const, vorname: 'Max', nachname: 'Neu' };
  const firma = { ...leerePerson(), istUnternehmen: true, firmenname: 'Muster GmbH', vorname: '', nachname: '' };

  it('legt nur Mitmieter mit Namen und ohne Datensatz an', () => {
    const bestehend = { ...leerePerson(), vorname: 'Jürgen', nachname: 'Müller', mieterId: 'b1', quelle: 'bestand' as const };
    const personen = [bestehend, neu, mitbewohner, leerePerson(), firma];
    expect(anzulegendePersonen(personen).map(personName)).toEqual(['Erika Neu', 'Muster GmbH']);
    expect(anzulegendeMieter(personen).map(m => m.schluessel)).toEqual([neu.schluessel, firma.schluessel]);
    expect(anzulegendeMieter(personen)[0].zeile).toEqual(mieterZeile(neu));
  });

  it('nimmt dieselben Personen wie die Aktivierung — nach dem Anlegen legt sie niemanden mehr an', () => {
    const personen = [neu, mitbewohner, firma];
    const vorher = aktivierungsDaten({ id: 'v1', einheitId: 'e1', daten: daten(), herkunft: {}, vorvertragId: null, mitVorlage: true, personen });
    expect(vorher.neueMieter).toEqual(anzulegendeMieter(personen));

    // So schreibt lege_mieter_aus_entwurf_an die Person zurück: Datensatz, Quelle und Stand in Spaltenform
    const gespeichert = personen.map(p => {
      if (!anzulegendePersonen([p]).length) return p;
      const z = mieterZeile(p);
      const stand = { anrede: null, hauptmail: null, telnr: null, geburtsdatum: null, vertreten_durch: null, strasse: null, hausnummer: null, plz: null, ort: null, ...Object.fromEntries(['anrede', 'hauptmail', 'telnr', 'geburtsdatum', 'vertreten_durch', 'strasse', 'hausnummer', 'plz', 'ort'].map(f => [f, z[f as keyof typeof z] ?? null])) };
      return { ...p, mieterId: `m-${p.schluessel}`, quelle: 'bestand' as const, bestandStand: stand };
    });
    const nachher = aktivierungsDaten({ id: 'v1', einheitId: 'e1', daten: daten(), herkunft: {}, vorvertragId: null, mitVorlage: true, personen: gespeichert });
    expect(nachher.neueMieter).toEqual([]);
    expect(nachher.verknuepfungen.map(v => v.mieter_id)).toEqual([`m-${neu.schluessel}`, `m-${firma.schluessel}`]);
    // Unverändert seit dem Anlegen: Die Aktivierung schreibt keine Stammdaten zurück
    expect(nachher.verknuepfungen.map(v => v.stammdaten)).toEqual([{}, {}]);
  });

  it('übernimmt den Datensatz an die Karten im Dialog und lässt Getipptes stehen', () => {
    const karte = { ...neu, telefon: '0511 99' };
    const gespeichert = [{ ...neu, mieterId: 'm1', quelle: 'bestand' as const, bestandStand: { hauptmail: 'erika@example.de' } }];
    const [ergebnis] = mitAngelegtenMietern([karte], gespeichert);
    expect(ergebnis).toMatchObject({ mieterId: 'm1', quelle: 'bestand', bestandStand: { hauptmail: 'erika@example.de' }, telefon: '0511 99' });
    // Eine Karte mit eigenem Datensatz oder ohne Gegenstück bleibt, wie sie ist
    const schon = { ...neu, mieterId: 'alt' };
    expect(mitAngelegtenMietern([schon], gespeichert)[0].mieterId).toBe('alt');
    const andere = { ...leerePerson(), vorname: 'Ohne', nachname: 'Gegenstück' };
    expect(mitAngelegtenMietern([andere], gespeichert)[0]).toEqual(andere);
  });

  it('verlangt vor dem Anlegen Vor- und Nachnamen, bei Firmen den Firmennamen (11.11.2026)', () => {
    const nurVorname = { ...leerePerson(), vorname: 'Erika', nachname: ' ' };
    expect(unvollstaendigeNamen([nurVorname, neu, firma, mitbewohner])).toEqual(['Erika']);
    // Schon angelegt oder Mitbewohner: kein Fall
    expect(unvollstaendigeNamen([{ ...nurVorname, mieterId: 'm1' }, { ...mitbewohner, nachname: '' }])).toEqual([]);
  });

  it('sperrt eine Person, die schon auf einer anderen Karte steht', () => {
    const gewaehlt = { ...neu, mieterId: 'm1', quelle: 'bestand' as const };
    const ausSelbstauskunft = { ...leerePerson(), vorname: 'Erika', nachname: 'Neu', email: 'ERIKA@example.de' };
    expect(doppeltAufKarten([gewaehlt, ausSelbstauskunft])).toEqual(['Erika Neu']);
    // Gleicher Name allein ist nur „möglich“, keine Sperre — und ohne zweite Karte gibt es nichts zu sperren
    expect(doppeltAufKarten([gewaehlt, { ...leerePerson(), vorname: 'Erika', nachname: 'Neu' }])).toEqual([]);
    expect(doppeltAufKarten([neu, mitbewohner])).toEqual([]);
  });

  it('warnt vor möglichen Dubletten nur für anzulegende Personen', () => {
    const bestand = [
      { id: 'x1', vorname: 'Erika', nachname: 'Neu', geburtsdatum: null, hauptmail: null, firmenname: null, ist_unternehmen: false },
      { id: 'x2', vorname: 'Andere', nachname: 'Person', geburtsdatum: null, hauptmail: 'erika@example.de', firmenname: null, ist_unternehmen: false },
    ];
    expect(moeglicheDublettenIn([neu, mitbewohner], bestand)).toEqual([{ person: 'Erika Neu', vorhanden: ['Erika Neu', 'Andere Person'] }]);
    expect(moeglicheDublettenIn([{ ...neu, mieterId: 'x1' }], bestand)).toEqual([]);
  });

  it('übernimmt im Dialog den Datensatz an die Karten, bevor wieder gespeichert wird', () => {
    // Fehlt dieser Schritt, schreibt das nächste Speichern die Karten ohne Datensatz zurück — doppelte Mieter beim Aktivieren
    const dialog = readFileSync('src/components/dashboard/mietvertrag-entwurf/MietvertragEntwurfDialog.tsx', 'utf8');
    expect(dialog).toMatch(/setPersonen\(p => mitAngelegtenMietern\(p, ergebnis\.personen\)\)/);
    expect(dialog).toMatch(/setAktualisiertAm\(ergebnis\.aktualisiertAm\)/);
  });
});
