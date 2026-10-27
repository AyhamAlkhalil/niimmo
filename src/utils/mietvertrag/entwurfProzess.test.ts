/**
 * Ablauf „Neuer Mietvertrag": Schritte, Zuordnung der Prüfbefunde und die
 * Platzhalter-Übersicht. Namen sind erfunden.
 */
import { describe, expect, it } from 'vitest';

import type { Tables } from '@/integrations/supabase/types';
import { formatMonat, istPlausiblesDatum } from '../pdf/briefLayout';
import {
  baueEntwurf,
  hatNamen,
  indexVorschlag,
  kuendigungsverzichtNachMonaten,
  leerePerson,
  mitBestandsmieter,
  gleichePersonGrad,
  mieterFuerVertrag,
  mitMietbeginn,
  mitPersonen,
  personenzahl,
  plusMonate,
  schluesselFuerDb,
  standardMietbeginn,
  verschiebeKuendigungsverzicht,
  vertragsZeile,
  wendeVorvertragAuslese,
  type VorvertragAuslese,
} from './entwurf';
import {
  entwurfLuecken,
  platzhalterUebersicht,
  quellenZaehlung,
  schritteFuer,
  schrittFuerFeld,
  schrittZustaende,
} from './entwurfProzess';
import { pruefeVertragsdaten } from './pflichtpruefung';

const IMMOBILIE = {
  id: 'imm', name: 'Haus', strasse: 'Musterstraße', hausnummer: '12', plz: '30851', ort: 'Langenhagen', ortsteil: null,
  ist_angespannt: false, heizungsart: 'zentral', warmwasser: 'zentral', schliessanlage_art: 'zentral',
  gemeinschaftseinrichtungen: ['Waschkeller'], gesamtwohnflaeche: 612, heizkosten_schluessel: '70/30',
  'Kontonr.': 'DE89 2559 1413 3155 4105 01', energieausweis_typ: 'verbrauch', energie_kennwert: 120,
  energietraeger: 'Gas', energieausweis_gueltig_bis: '2030-01-01', energieeffizienzklasse: 'D',
} as unknown as Tables<'immobilien'>;
const EINHEIT = {
  id: 'e1', immobilie_id: 'imm', bezeichnung: 'WE9', etage: 'Dachgeschoss rechts', qm: 68, anzahl_zimmer: null,
  raeume: {}, nebenraeume: null, einbaukueche: false, einheitentyp: 'Wohnung',
} as unknown as Tables<'einheiten'>;
const VORVERTRAG = {
  id: 'vv', einheit_id: 'e1', status: 'beendet', start_datum: '2024-05-01', ende_datum: '2026-07-31', kuendigungsdatum: null,
  kaltmiete: 1000, betriebskosten: 100, heizkosten_vorauszahlung: null, raumaufstellung: null, schliessanlage_art: null,
  mitbenutzung_einrichtungen: null, betriebskosten_positionen: null,
} as unknown as Tables<'mietvertrag'>;
const VERMIETER = {
  firmenname: 'NiImmo Wohnungsbaugesellschaft mbH', rechtsform: 'GmbH', strasse: 'Egestorffstraße', hausnummer: '11',
  plz: '31319', ort: 'Sehnde', vertreten_durch: ['Geschäftsführung'], vertretung_art: 'einzel', miet_iban: null,
  stammdaten_geprueft: true, kaution_iban: null,
} as unknown as Tables<'vermieter'>;

function entwurf() {
  return baueEntwurf({
    immobilie: IMMOBILIE, einheit: EINHEIT, vermieter: VERMIETER, nebenkostenarten: [], vorvertrag: VORVERTRAG, heute: '2026-10-20',
  });
}

const AUSLESE: VorvertragAuslese = {
  einheit_bezeichnung: 'WE9', lage: 'DG rechts', raumaufstellung: '1 Zimmer, 1 Wohnküche, 1 Badezimmer, 1 Abstellraum',
  wohnflaeche_qm: 68, schliessanlage: 'zentral', kaltmiete: 1000, betriebskosten_vorauszahlung: 50, heizkosten_vorauszahlung: 50,
  betriebskosten_positionen: [{ nummer: '2.1', betrag: 50, umgelegt: true }],
  kaution: 3000, mietbeginn: '2024-05-01', mindestlaufzeit_monate: 12,
};

describe('Datum und Kündigungsverzicht', () => {
  it('rechnet Monate über Monatsenden und Jahreswechsel', () => {
    expect(plusMonate('2026-11-01', 12)).toBe('2027-11-01');
    expect(plusMonate('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonate('2028-01-31', 1)).toBe('2028-02-29');
    expect(plusMonate('2026-12-15', 3)).toBe('2027-03-15');
  });

  it('endet einen Tag vor dem Jahrestag — wie im Referenzvertrag vom 01.06.2025', () => {
    expect(kuendigungsverzichtNachMonaten('2025-06-01', 12)).toBe('2026-05-31');
  });

  it('übernimmt die Mindestlaufzeit des Vorvertrags als Kündigungsverzicht', () => {
    const basis = entwurf();
    const { daten, herkunft } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    expect(daten.mietbeginn).toBe('2026-11-01');
    expect(daten.kuendigungsverzichtBis).toBe('2027-10-31');
    expect(herkunft.kuendigungsverzichtBis).toBe('vorvertrag');
  });

  it('verschiebt einen berechneten Verzicht mit dem Mietbeginn, ein freies Datum nicht', () => {
    expect(verschiebeKuendigungsverzicht('2026-11-01', '2026-12-01', '2027-10-31')).toBe('2027-11-30');
    expect(verschiebeKuendigungsverzicht('2026-11-01', '2026-12-01', '2027-06-15')).toBe('2027-06-15');
  });

  it('sperrt einen Verzicht über vier Jahre und einen vor Mietbeginn', () => {
    const d = entwurf().daten;
    d.vertragsdatum = '2026-11-01';
    d.kuendigungsverzichtBis = '2030-11-02';
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'kuendigungsverzichtBis' && f.schwere === 'blocker')).toBe(true);
    d.kuendigungsverzichtBis = '2030-11-01';
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'kuendigungsverzichtBis')).toBe(false);
    d.kuendigungsverzichtBis = '2026-10-01';
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'kuendigungsverzichtBis' && f.schwere === 'blocker')).toBe(true);
  });

  it('rechnet die vier Jahre ohne Vertragsdatum ab heute, nicht ab einem späteren Mietbeginn', () => {
    const heute = new Date().toISOString().slice(0, 10);
    const d = entwurf().daten;
    d.vertragsdatum = null;
    d.mietbeginn = plusMonate(heute, 2);
    d.kuendigungsverzichtBis = kuendigungsverzichtNachMonaten(d.mietbeginn, 48);
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'kuendigungsverzichtBis' && f.schwere === 'blocker')).toBe(true);
    d.kuendigungsverzichtBis = kuendigungsverzichtNachMonaten(d.mietbeginn, 12);
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'kuendigungsverzichtBis')).toBe(false);
  });

  it('rechnet beim Tippen eines Jahres nicht mit Zwischenständen und stürzt nicht ab', () => {
    // Das Datumsfeld liefert für „2027" nacheinander 0002-, 0020-, 0202- und 2027-11-01
    expect(() => kuendigungsverzichtNachMonaten('0002-11-01', 12)).not.toThrow();
    expect(plusMonate('0002-11-01', 12)).toBe('0003-11-01');
    expect(verschiebeKuendigungsverzicht('2026-11-01', '0002-11-01', '2027-10-31')).toBe('2027-10-31');
    expect(verschiebeKuendigungsverzicht('2026-11-01', '20271-11-01', '2027-10-31')).toBe('2027-10-31');

    const { daten } = entwurf();
    daten.mietbeginn = '2026-11-01';
    daten.kuendigungsverzichtBis = '2027-10-31';
    let d = daten;
    for (const zwischen of ['0002-11-01', '0020-11-01', '0202-11-01']) d = mitMietbeginn(d, zwischen, true, '2026-11-01');
    expect(d.kuendigungsverzichtBis).toBe('2027-10-31');
    d = mitMietbeginn(d, '2027-11-01', true, '2026-11-01');
    expect(d.kuendigungsverzichtBis).toBe('2028-10-31');
    // Von Hand gesetzter Verzicht (ohne Herkunft) bleibt stehen
    expect(mitMietbeginn(daten, '2026-12-01', false).kuendigungsverzichtBis).toBe('2027-10-31');
  });

  it('erkennt halbe Daten als Lücke und sperrt sie im Vertrag', () => {
    expect(istPlausiblesDatum('2026-11-01')).toBe(true);
    expect(istPlausiblesDatum('2026-02-30')).toBe(false);
    expect(istPlausiblesDatum('0202-11-01')).toBe(false);
    expect(istPlausiblesDatum('')).toBe(false);

    const { daten } = entwurf();
    daten.mietbeginn = '0202-11-01';
    expect(entwurfLuecken(daten, [{ ...leerePerson(), vorname: 'Testa', nachname: 'Probe' }]).map(l => l.feld)).toContain('mietbeginn');
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'mietbeginn' && f.schwere === 'blocker')).toBe(true);
  });

  it('sperrt das Aktivieren, wenn dieselbe Person als Bestandsmieter und als neue Karte im Vertrag steht', () => {
    // 27.10.2026: Bestandsmieter gewählt, dann seine Selbstauskunft geladen — doppelt angelegt und gezählt
    const { daten } = entwurf();
    const bestand = mitBestandsmieter(leerePerson(), {
      id: 'b1', vorname: 'Max', nachname: 'Muster', geburtsdatum: '1980-01-02', hauptmail: 'max@example.de',
      telnr: null, anrede: 'Herr', strasse: null, hausnummer: null, plz: null, ort: null,
      ist_unternehmen: false, firmenname: null, vertreten_durch: null,
    });
    const ausSelbstauskunft = { ...leerePerson(), vorname: 'Max', nachname: 'Muster', geburtsdatum: '1980-01-02', quelle: 'selbstauskunft' as const };
    const partnerin = { ...leerePerson(), vorname: 'Eva', nachname: 'Muster' };
    const luecken = entwurfLuecken(daten, [bestand, ausSelbstauskunft, partnerin]);
    expect(luecken.filter(l => /doppelt/.test(l.text)).map(l => l.feld)).toEqual(['mieter[1]']);
    // Gleicher Nachname allein ist keine Dublette, anderes Geburtsdatum auch nicht
    const namensvetter = { ...ausSelbstauskunft, geburtsdatum: '1990-05-05' };
    expect(entwurfLuecken(daten, [bestand, namensvetter, partnerin]).some(l => /doppelt/.test(l.text))).toBe(false);
  });

  it('sperrt kein Paar mit gemeinsamer Familienmail und keinen gleichen Namen ohne weiteren Beleg', () => {
    const { daten } = entwurf();
    const er = { ...leerePerson(), vorname: 'Max', nachname: 'Muster', email: 'familie@example.de' };
    const sie = { ...leerePerson(), vorname: 'Eva', nachname: 'Muster', email: 'familie@example.de' };
    expect(entwurfLuecken(daten, [er, sie]).some(l => /doppelt/.test(l.text))).toBe(false);
    // Vater und Sohn, beide ohne Geburtsdatum und Mail: nur ein Hinweis an der Karte, keine Sperre
    const sohn = { ...leerePerson(), vorname: 'Max', nachname: 'Muster' };
    expect(entwurfLuecken(daten, [{ ...er, email: null }, sohn]).some(l => /doppelt/.test(l.text))).toBe(false);
    expect(gleichePersonGrad({ ...er, email: null }, sohn)).toBe('moeglich');
    // gleicher Name und gleiche Mail sperrt
    expect(gleichePersonGrad(er, { ...sohn, email: ' Familie@example.de ' })).toBe('sicher');
  });

  it('sperrt eine Befristung ohne Enddatum und einen Vertrag ohne Personenzahl', () => {
    const { daten } = entwurf();
    daten.befristungsgrund = 'eigenbedarf';
    daten.vertragsende = null;
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'vertragsende' && f.schwere === 'blocker')).toBe(true);
    daten.befristungsgrund = null;
    daten.anzahlPersonen = 0;
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'anzahlPersonen' && f.schwere === 'blocker')).toBe(true);
  });

  it('schreibt Kontodaten und Anpassungswerte nur, wenn sie vereinbart sind', () => {
    const { daten, herkunft } = entwurf();
    daten.lastschrift = false;
    daten.lastschriftIban = 'DE89 3704 0044 0532 0130 00';
    daten.mietanpassungArt = 'index';
    daten.indexBasisWert = 125.6;
    daten.indexBasisMonat = '2026-07-01';
    daten.staffelplan = [{ gueltigAb: '2027-11-01', kaltmiete: 900 }];
    const zeile = vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft, vorvertragId: null, mitVorlage: true });
    expect(zeile.bankkonto_mieter).toBeNull();
    expect(zeile.staffelplan).toBeNull();
    expect(zeile.index_basis_wert).toBe(125.6);
  });
});

describe('Schlüssel und Index', () => {
  it('schreibt die Schlüssel mit den Spaltenschlüsseln der Datenbank', () => {
    expect(
      schluesselFuerDb([
        { art: 'Haustürschlüssel', anzahl: 2 },
        { art: 'Wohnungsschlüssel', anzahl: 2 },
        { art: 'Briefkastenschlüssel', anzahl: 0 },
        { art: 'Dachboden', anzahl: 1 },
      ])
    ).toEqual({ haustuer: 2, wohnung: 2, dachboden: 1 });
  });

  it('landet am aktivierten Vertrag', () => {
    const { daten, herkunft } = entwurf();
    daten.schluessel = [{ art: 'Haustürschlüssel', anzahl: 2 }];
    const zeile = vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft, vorvertragId: null, mitVorlage: true });
    expect(zeile.schluessel).toEqual({ haustuer: 2 });
  });

  it('schlägt den letzten Verbraucherpreisindex als Ausgangswert vor', () => {
    expect(indexVorschlag({ wert: '125.6', stichtag: '2026-07-01' })).toEqual({ wert: 125.6, monat: '2026-07-01' });
    expect(indexVorschlag(null)).toBeNull();
    expect(indexVorschlag({ wert: null, stichtag: '2026-07-01' })).toBeNull();
  });

  it('nennt den Index-Basismonat als Monat, nicht als Stichtag', () => {
    expect(formatMonat('2026-07-01')).toBe('Juli 2026');
    expect(formatMonat('2027-03-01')).toBe('März 2027');
    expect(formatMonat(null)).toBe('');
    expect(formatMonat('2026-13-01')).toBe('');
  });
});

describe('Schritte', () => {
  it('kennt ohne Wohnraum-Vorlage nur die Grundschritte', () => {
    expect(schritteFuer(true)).toHaveLength(8);
    expect(schritteFuer(false)).toEqual(['grundlagen', 'mieter', 'miete', 'pruefen', 'start']);
  });

  it('ordnet jeden Prüfbefund einem Schritt zu, in dem er sich beheben lässt', () => {
    expect(schrittFuerFeld('mieter[1].adresse')).toBe('mieter');
    expect(schrittFuerFeld('vermieter.mietIban')).toBe('grundlagen');
    expect(schrittFuerFeld('objekt.heizungsart')).toBe('mietsache');
    expect(schrittFuerFeld('einheit.raumaufstellung')).toBe('mietsache');
    expect(schrittFuerFeld('betriebskostenPositionen')).toBe('betriebskosten');
    expect(schrittFuerFeld('staffelplan')).toBe('miete');
    expect(schrittFuerFeld('mietpreisbremseAuskunftAm')).toBe('miete');
    expect(schrittFuerFeld('schoenheitsreparaturen')).toBe('vereinbarungen');
  });

  it('markiert Schritte mit offenen Pflichtangaben', () => {
    const d = mitPersonen(entwurf().daten, []);
    const zustand = schrittZustaende(pruefeVertragsdaten(d), entwurfLuecken(d, []));
    expect(zustand.mieter).toBe('fehlt');
    expect(zustand.mietsache).toBe('fehlt'); // Räume fehlen
    expect(zustand.start).toBe('ok');
  });
});

describe('Platzhalter-Übersicht', () => {
  it('nennt für jeden Platzhalter Wert und Quelle', () => {
    const basis = entwurf();
    const { daten, herkunft } = wendeVorvertragAuslese(basis.daten, basis.herkunft, AUSLESE, 100);
    const person = { ...leerePerson(), vorname: 'Erika', nachname: 'Muster', quelle: 'selbstauskunft' as const };
    const d = mitPersonen(daten, [person]);
    const gruppen = platzhalterUebersicht(d, herkunft, [person], pruefeVertragsdaten(d), true);
    const z = (feld: string) => gruppen.flatMap(g => g.zeilen).find(x => x.feld === feld)!;

    expect(z('vermieter')).toMatchObject({ wert: 'NiImmo Wohnungsbaugesellschaft mbH', quelle: 'stammdaten' });
    expect(z('mieter[0]')).toMatchObject({ quelle: 'selbstauskunft', fehlt: true }); // Anschrift fehlt
    expect(z('kaltmiete')).toMatchObject({ wert: '1.000,00 €', quelle: 'vorvertrag' });
    expect(z('einheit.lage')).toMatchObject({ wert: 'Dachgeschoss rechts', quelle: 'einheit' });
    expect(z('einheit.raumaufstellung')).toMatchObject({ quelle: 'vorvertrag', fehlt: false });
    expect(z('kuendigungsverzichtBis')).toMatchObject({ wert: 'bis 31.10.2027', quelle: 'vorvertrag' });
    expect(z('faelligkeitWerktag')).toMatchObject({ wert: 'am 3. Werktag', quelle: 'vorgabe' });
    expect(z('summe')).toMatchObject({ wert: '1.100,00 €', quelle: 'berechnet' });
    expect(z('objekt.heizungsart')).toMatchObject({ wert: 'Zentralheizung', quelle: 'objekt' });
  });

  it('zeigt eine Änderung von Hand als Eingabe', () => {
    const { daten, herkunft } = entwurf();
    daten.kaltmiete = 950;
    delete herkunft.kaltmiete;
    const gruppen = platzhalterUebersicht(daten, herkunft, [], [], true);
    expect(gruppen.flatMap(g => g.zeilen).find(x => x.feld === 'kaltmiete')?.quelle).toBe('eingabe');
  });

  it('zählt die Quellen für die Kopfzeile', () => {
    const { daten, herkunft } = entwurf();
    const zaehlung = quellenZaehlung(platzhalterUebersicht(daten, herkunft, [], [], true));
    expect(zaehlung.find(q => q.quelle === 'vorgabe')?.anzahl).toBeGreaterThan(3);
    expect(zaehlung.find(q => q.quelle === 'objekt')?.anzahl).toBeGreaterThan(2);
  });

  it('beschränkt sich ohne Wohnraum-Vorlage auf Parteien, Mietsache, Laufzeit, Miete und Kaution', () => {
    const { daten, herkunft } = entwurf();
    const titel = platzhalterUebersicht(daten, herkunft, [], [], false).map(g => g.titel);
    expect(titel).toEqual(['Vertragsparteien', 'Mietsache', 'Laufzeit', 'Miete und Nebenkosten', 'Kaution']);
  });
});

describe('Befunde der QA vom 20.10.2026', () => {
  it('zählt nur Personen mit einem Namen der gewählten Art', () => {
    // Privatperson mit stehengebliebenem Firmennamen, Firma mit stehengebliebenen Namen
    const privat = { ...leerePerson(), firmenname: 'Alt GmbH' };
    const firma = { ...leerePerson(), istUnternehmen: true, vorname: 'Testa', nachname: 'Probe' };
    for (const p of [privat, firma]) {
      expect(hatNamen(p)).toBe(false);
      expect(personenzahl([p])).toBe(0);
      expect(mieterFuerVertrag([p])).toHaveLength(0);
      expect(entwurfLuecken(entwurf().daten, [p]).map(l => l.feld)).toContain('mieter');
    }
    const mitVertreter = { ...firma, firmenname: 'Probe GmbH', vertretenDurch: ' Testa Probe ' };
    expect(mieterFuerVertrag([mitVertreter])[0]).toMatchObject({ firmenname: 'Probe GmbH', vertretenDurch: 'Testa Probe' });
  });

  it('endet bei fehlendem Monatstag am Monatsletzten (§ 188 Abs. 3 BGB)', () => {
    expect(kuendigungsverzichtNachMonaten('2026-01-31', 1)).toBe('2026-02-28');
    expect(kuendigungsverzichtNachMonaten('2026-01-30', 1)).toBe('2026-02-28');
    expect(kuendigungsverzichtNachMonaten('2026-01-28', 1)).toBe('2026-02-27');
    expect(kuendigungsverzichtNachMonaten('2027-08-31', 6)).toBe('2028-02-29');
    // Die Umkehrung findet die Monate auch dann
    expect(verschiebeKuendigungsverzicht('2026-01-31', '2026-03-01', '2026-02-28')).toBe('2026-03-31');
    expect(verschiebeKuendigungsverzicht('2026-03-31', '2026-05-01', '2026-04-30')).toBe('2026-05-31');
  });

  it('nimmt nur ganze Schlüssel und keine geerbten Eigenschaften', () => {
    expect(schluesselFuerDb([{ art: 'Haustürschlüssel', anzahl: 0.4 }])).toEqual({});
    expect(schluesselFuerDb([{ art: 'constructor', anzahl: 1 }])).toEqual({ constructor: 1 });
    expect(schluesselFuerDb([{ art: '---', anzahl: 2 }])).toEqual({});
  });

  it('hält eine gewählte Befristung ohne Datum fest, statt still unbefristet zu drucken', () => {
    const { daten, herkunft } = entwurf();
    daten.vertragsende = '';
    expect(entwurfLuecken(daten, []).map(l => l.feld)).toContain('vertragsende');
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'vertragsende' && f.schwere === 'blocker')).toBe(true);
    const zeile = vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft, vorvertragId: null, mitVorlage: false });
    expect(zeile.ende_datum).toBeNull();
    const befristung = platzhalterUebersicht(daten, herkunft, [], pruefeVertragsdaten(daten), true)
      .flatMap(g => g.zeilen)
      .find(z => z.feld === 'vertragsende');
    expect(befristung).toMatchObject({ wert: 'befristet, Enddatum fehlt', fehlt: true });
  });

  it('meldet negative Betriebskosten ohne Heizkosten als solche und markiert die Zeile', () => {
    const { daten, herkunft } = entwurf();
    daten.betriebskostenVorauszahlung = -50;
    daten.heizkostenVorauszahlung = null;
    const befunde = pruefeVertragsdaten(daten);
    expect(befunde.find(f => f.feld === 'betriebskostenVorauszahlung')?.text).toBe('Die Betriebskostenvorauszahlung ist negativ.');
    const zeile = platzhalterUebersicht(daten, herkunft, [], befunde, true)
      .flatMap(g => g.zeilen)
      .find(z => z.feld === 'betriebskostenVorauszahlung');
    expect(zeile?.fehlt).toBe(true);
  });

  it('zeigt Werte der Übersicht so, wie der Vertrag sie druckt', () => {
    const { daten, herkunft } = entwurf();
    daten.mietanpassungArt = 'index';
    daten.indexBasisWert = 125.6;
    daten.indexBasisMonat = null;
    daten.zusatzvereinbarungen = 'A\n \nB';
    const zeilen = platzhalterUebersicht(daten, herkunft, [], [], true).flatMap(g => g.zeilen);
    const z = (feld: string) => zeilen.find(x => x.feld === feld)!;
    expect(z('mietanpassungArt').wert).toBe('Indexmiete, Basis 125,6');
    expect(z('zusatzvereinbarungen').wert).toBe('2 Vereinbarung(en)');
    // Mietkonto steht am Objekt
    expect(z('lastschrift').quelle).toBe('objekt');
  });

  it('führt die Prüfangaben der Mietpreisbremse getrennt von den Platzhaltern', () => {
    const basis = baueEntwurf({
      immobilie: { ...IMMOBILIE, ist_angespannt: true } as Tables<'immobilien'>,
      einheit: EINHEIT, vermieter: VERMIETER, nebenkostenarten: [], vorvertrag: VORVERTRAG, heute: '2026-10-20',
    });
    const gruppen = platzhalterUebersicht(basis.daten, basis.herkunft, [], [], true);
    const bremse = gruppen.find(g => g.titel.startsWith('Mietpreisbremse'));
    expect(bremse?.zeilen.map(z => z.feld)).toEqual(['vormieteNetto', 'mietpreisbremseAuskunftAm']);
    expect(gruppen.find(g => g.titel === 'Vereinbarungen')?.zeilen.some(z => z.feld === 'vormieteNetto')).toBe(false);
  });

  it('übernimmt aus dem Dokument nur, was es wirklich enthält', () => {
    const basis = entwurf();
    // Ohne Betriebskosten aus der Datenbank (Summe 0) und ohne Betrag im Dokument
    basis.daten.betriebskostenVorauszahlung = 0;
    delete basis.herkunft.betriebskostenVorauszahlung;
    const { herkunft } = wendeVorvertragAuslese(
      basis.daten,
      basis.herkunft,
      { ...AUSLESE, betriebskosten_vorauszahlung: null, heizkosten_vorauszahlung: 40 },
      0
    );
    expect(herkunft.heizkostenVorauszahlung).toBe('vorvertrag');
    expect(herkunft.betriebskostenVorauszahlung).toBeUndefined();
  });

  it('nimmt einen Einzugswunsch nur als echtes Datum und markiert keinen fehlenden Vermieter', () => {
    expect(standardMietbeginn('2026-10-20', null, '2027-02-30')).toBe('2026-11-01');
    expect(standardMietbeginn('2026-10-20', null, '2027-02-15')).toBe('2027-02-15');
    const ohne = baueEntwurf({
      immobilie: IMMOBILIE, einheit: EINHEIT, vermieter: null, nebenkostenarten: [], vorvertrag: VORVERTRAG, heute: '2026-10-20',
    });
    expect(ohne.herkunft.vermieter).toBeUndefined();
  });

  it('prüft Daten und ihre Reihenfolge für jeden Vertrag, auch ohne Vorlage', () => {
    const person = { ...leerePerson(), vorname: 'Testa', nachname: 'Probe' };
    const { daten } = entwurf();
    daten.mietbeginn = '2026-11-01';
    // „31.12.27" getippt: Das Feld liefert 0027-12-31 — als Vertragsende wäre der Vertrag sofort beendet
    daten.vertragsende = '0027-12-31';
    expect(entwurfLuecken(daten, [person]).map(l => l.feld)).toContain('vertragsende');
    daten.vertragsende = '2026-10-31';
    expect(entwurfLuecken(daten, [person]).find(l => l.feld === 'vertragsende')?.text).toBe(
      'Das Vertragsende liegt nicht nach dem Mietbeginn.'
    );
    daten.vertragsende = null;
    daten.kuendigungsverzichtBis = '2026-10-01';
    expect(entwurfLuecken(daten, [person]).map(l => l.feld)).toContain('kuendigungsverzichtBis');
    daten.kuendigungsverzichtBis = null;
    expect(entwurfLuecken(daten, [person])).toEqual([]);
  });

  it('prüft das Geburtsdatum der Vertragsparteien', () => {
    const { daten } = entwurf();
    const halb = { ...leerePerson(), vorname: 'Testa', nachname: 'Probe', geburtsdatum: '0090-05-11' };
    expect(entwurfLuecken(daten, [halb]).find(l => l.feld === 'mieter[0].geburtsdatum')?.text).toBe(
      'Das Geburtsdatum von Testa Probe ist kein gültiges Datum.'
    );
    // Auch das PDF ist gesperrt, nicht nur das Aktivieren
    expect(
      pruefeVertragsdaten(mitPersonen(daten, [halb])).some(f => f.feld === 'mieter[0].geburtsdatum' && f.schwere === 'blocker')
    ).toBe(true);
    const zukunft = { ...halb, geburtsdatum: '2999-01-01' };
    expect(entwurfLuecken(daten, [zukunft]).map(l => l.feld)).toContain('mieter[0].geburtsdatum');
    expect(entwurfLuecken(daten, [{ ...halb, geburtsdatum: '1990-05-11' }])).toEqual([]);
  });

  it('prüft den Index-Basismonat nur bei Indexmiete', () => {
    const { daten } = entwurf();
    daten.indexBasisMonat = '0002-07-01';
    daten.mietanpassungArt = 'keine';
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'indexBasisMonat')).toBe(false);
    daten.mietanpassungArt = 'index';
    daten.indexBasisWert = 125.6;
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'indexBasisMonat' && f.schwere === 'blocker')).toBe(true);
  });

  it('behält einen angehakten Kündigungsverzicht, während sein Datum bearbeitet wird', () => {
    const { daten, herkunft } = entwurf();
    daten.kuendigungsverzichtBis = '';
    expect(entwurfLuecken(daten, []).map(l => l.feld)).toContain('kuendigungsverzichtBis');
    expect(pruefeVertragsdaten(daten).some(f => f.feld === 'kuendigungsverzichtBis' && f.schwere === 'blocker')).toBe(true);
    expect(vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft, vorvertragId: null, mitVorlage: false }).kuendigungsverzicht_bis).toBeNull();
    expect(mitMietbeginn(daten, '2026-12-01', true).kuendigungsverzichtBis).toBe('');
  });

  it('zählt einen Mitbewohner mit Namen, auch wenn „Unternehmen" stehen geblieben ist', () => {
    const p = { ...leerePerson('mitbewohner'), istUnternehmen: true, vorname: 'Kind', nachname: 'Probe' };
    expect(hatNamen(p)).toBe(true);
    expect(personenzahl([p])).toBe(1);
  });

  it('führt ohne Wohnraum-Vorlage nur in vorhandene Schritte', () => {
    const vorhanden = schritteFuer(false);
    expect(vorhanden).not.toContain('mietsache');
    // Energieausweis wird im Schritt „Mietsache & Haus" gepflegt
    expect(schrittFuerFeld('objekt.energieausweis')).toBe('mietsache');
  });
});
