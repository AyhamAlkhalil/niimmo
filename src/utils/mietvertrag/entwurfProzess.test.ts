/**
 * Ablauf „Neue Vermietung": Schritte, Stufen und Lücken, dazu die Übernahme in den Vertrag. Namen sind erfunden.
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
  abschliessenMoeglich,
  alsSchritt,
  bereichFuerFeld,
  entwurfLuecken,
  mieteVorgemerkt,
  naechsteStufe,
  naechsterWeitester,
  SCHRITTE,
  spaetererSchritt,
  vermietungsStufen,
  weitesterAusAltbestand,
  schrittZustaende,
} from './entwurfProzess';
import { pruefeVertragsdaten } from './pflichtpruefung';
import { leseSchluessel } from './datenAusDb';
import { ausgehaendigteSchluessel } from './typen';
import { wohnraumParagraphen } from './wohnraumKlauseln';

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
    ).toEqual({ haustuer: 2, wohnung: 2, Dachboden: 1 });
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
  it('kennt nur die Vermietung: Mieter, Miete & Laufzeit, Abschließen (11.11.2026)', () => {
    // Der Mietvertrag als PDF ist kein Schritt mehr — er entsteht am laufenden Vertrag
    expect(SCHRITTE).toEqual(['mieter', 'miete', 'start']);
  });

  it('liest gespeicherte Vertragsschritte als „vor dem Abschließen“', () => {
    for (const alt of ['grundlagen', 'mietsache', 'betriebskosten', 'vereinbarungen', 'pruefen']) {
      expect(alsSchritt(alt)).toBe('start');
    }
    expect(alsSchritt('miete')).toBe('miete');
    expect(alsSchritt('kaputt')).toBeNull();
    expect(alsSchritt(null)).toBeNull();
    // Der offene Entwurf aus Sarstedt stand am 11.11.2026 auf „start“ — er bleibt vorgemerkt
    expect(mieteVorgemerkt('start')).toBe(true);
    expect(mieteVorgemerkt('pruefen')).toBe(true);
    expect(mieteVorgemerkt('miete')).toBe(false);
  });

  it('rückt über die Miete nur mit „Miete speichern“ hinaus (Review 11.11.2026)', () => {
    // Über die Schrittleiste vorgesprungen und zwischengespeichert: bleibt bei der Miete
    expect(naechsterWeitester('mieter', 'start', false)).toBe('miete');
    expect(naechsterWeitester(null, 'start', false)).toBe('miete');
    // „Miete speichern“
    expect(naechsterWeitester('miete', 'start', true)).toBe('start');
    // Schon vorgemerkt — auch nach dem alten Ablauf: zurückblättern ändert nichts
    expect(naechsterWeitester('betriebskosten', 'mieter', false)).toBe('start');
    expect(naechsterWeitester('start', 'miete', false)).toBe('start');
    // Bis zur Miete ohne Bestätigung
    expect(naechsterWeitester('mieter', 'miete', false)).toBe('miete');
  });

  it('liest alte Entwürfe ohne weitesten Schritt nach der alten Reihenfolge', () => {
    // Vor dem 11.11.2026 kam „Grundlagen“ vor „Miete“
    expect(weitesterAusAltbestand('grundlagen')).toBe('mieter');
    expect(weitesterAusAltbestand('miete')).toBe('miete');
    expect(weitesterAusAltbestand('vereinbarungen')).toBe('start');
    expect(weitesterAusAltbestand('start')).toBe('start');
    expect(weitesterAusAltbestand(null)).toBeNull();
  });

  it('schließt ohne PDF und ohne Unterschrift ab, aber nie mit offenen Punkten (11.11.2026)', () => {
    const grund = { mieteOffen: false, ungespeichert: false, luecken: 0, beginnOffen: false, ueberschneidungOffen: false };
    expect(abschliessenMoeglich(grund)).toBe(true);
    // Auch die bestätigte Miete gehört dazu — nicht nur vorbelegte Werte aus dem Vorvertrag (Review 11.11.2026)
    for (const offen of [{ mieteOffen: true }, { ungespeichert: true }, { luecken: 1 }, { beginnOffen: true }, { ueberschneidungOffen: true }]) {
      expect(abschliessenMoeglich({ ...grund, ...offen })).toBe(false);
    }
  });

  it('merkt sich den weitesten Schritt, auch wenn man zurückblättert', () => {
    expect(spaetererSchritt('mieter', 'start')).toBe('start');
    expect(spaetererSchritt('pruefen', 'mieter')).toBe('start');
    expect(spaetererSchritt(null, 'miete')).toBe('miete');
    expect(spaetererSchritt('kaputt', undefined)).toBeNull();
  });

  it('zeigt den Stand der Vermietung in drei Stufen und steigt in der ersten offenen ein (11.11.2026)', () => {
    const person = { ...leerePerson(), vorname: 'Erika', nachname: 'Neu' };
    const angelegt = { ...person, mieterId: 'm1' };
    const mitbewohner = { ...leerePerson(), rolle: 'mitbewohner' as const, vorname: 'Max', nachname: 'Neu' };
    const stand = (personen: typeof person[], schritt: string | null, weitesterSchritt: string | null) =>
      vermietungsStufen({ personen, schritt, weitesterSchritt });
    const erledigt = (s: ReturnType<typeof stand>) => s.map(x => x.erledigt);

    expect(stand([person], 'mieter', 'mieter').map(s => s.titel)).toEqual(['Mieter angelegt', 'Miete vorgemerkt', 'Abgeschlossen']);
    // Neu angefangen: nichts erledigt, Weiter führt zum Mieter
    expect(erledigt(stand([person], 'mieter', 'mieter'))).toEqual([false, false, false]);
    expect(naechsteStufe(stand([person], 'mieter', 'mieter')).schritt).toBe('mieter');
    // Mieter angelegt, im Schritt Miete gespeichert, aber noch nicht weiter: Miete ist nicht vorgemerkt
    expect(erledigt(stand([angelegt, mitbewohner], 'miete', 'miete'))).toEqual([true, false, false]);
    expect(naechsteStufe(stand([angelegt], 'miete', 'miete')).schritt).toBe('miete');
    // Miete gespeichert: als Nächstes das Abschließen — auch wenn man danach zurückblättert und speichert
    expect(erledigt(stand([angelegt], 'mieter', 'start'))).toEqual([true, true, false]);
    expect(naechsteStufe(stand([angelegt], 'mieter', 'start'))).toMatchObject({ schritt: 'start', kurz: 'Abschließen' });
    // Ein Entwurf aus dem alten Ablauf, der in den Vertragsschritten stand, steht vor dem Abschließen
    expect(naechsteStufe(stand([angelegt], 'betriebskosten', 'betriebskosten')).schritt).toBe('start');
    // Der aktuelle Schritt allein rückt nicht vor
    expect(erledigt(stand([angelegt], 'start', 'miete'))).toEqual([true, false, false]);
    // Alter Entwurf auf „Grundlagen“ ohne weitesten Schritt: Miete nie gesehen
    expect(erledigt(stand([angelegt], 'grundlagen', null))).toEqual([true, false, false]);
    // Ein noch nicht angelegter Mitmieter hält die erste Stufe offen; ohne Mitmieter gibt es nichts anzulegen
    expect(stand([angelegt, person], 'start', 'start')[0].erledigt).toBe(false);
    expect(stand([], 'start', 'start')[0].erledigt).toBe(false);
  });

  it('ordnet jede Lücke dem Schritt zu, in dem sie sich beheben lässt', () => {
    expect(bereichFuerFeld('mieter')).toBe('mieter');
    expect(bereichFuerFeld('mieter[1].geburtsdatum')).toBe('mieter');
    expect(bereichFuerFeld('anzahlPersonen')).toBe('mieter');
    expect(bereichFuerFeld('mietbeginn')).toBe('miete');
    expect(bereichFuerFeld('staffelplan')).toBe('miete');
    expect(bereichFuerFeld('mietpreisbremseAuskunftAm')).toBe('miete');
    expect(bereichFuerFeld('besichtigtAm')).toBe('vertrag');
    expect(bereichFuerFeld('vertragsdatum')).toBe('vertrag');
  });

  it('markiert Schritte mit offenen Punkten und lässt Vertragsangaben beim Abschließen außen vor', () => {
    const { daten } = entwurf();
    const zustand = schrittZustaende(entwurfLuecken(daten, []));
    expect(zustand).toEqual({ mieter: 'fehlt', miete: 'ok', start: 'ok' });
    // Ein halbes Besichtigungsdatum sperrt das Abschließen nicht — es gehört zum PDF und wird nicht übernommen
    const person = { ...leerePerson(), vorname: 'Testa', nachname: 'Probe' };
    daten.besichtigtAm = '0026-10-01';
    daten.vertragsdatum = '0026-10-02';
    expect(entwurfLuecken(daten, [person])).toEqual([]);
    const zeile = vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft: {}, vorvertragId: null, mitVorlage: false });
    expect(zeile.besichtigt_am).toBeNull();
    expect(zeile.vertrag_datum).toBeNull();
    daten.besichtigtAm = '2026-10-01';
    expect(vertragsZeile({ id: 'v', einheitId: 'e1', daten, herkunft: {}, vorvertragId: null, mitVorlage: false }).besichtigt_am).toBe(
      '2026-10-01'
    );
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

  it('druckt frei benannte Schlüssel und lässt halbe Zeilen weg (03.11.2026)', () => {
    const { daten } = entwurf();
    daten.schluessel = [
      { art: 'Haustürschlüssel', anzahl: 2 },
      { art: ' Müllplatzschlüssel ', anzahl: 1, frei: true },
      { art: '', anzahl: 3, frei: true },
      { art: 'Fahrradraum', anzahl: 0, frei: true },
    ];
    expect(ausgehaendigteSchluessel(daten.schluessel)).toEqual([
      { art: 'Haustürschlüssel', anzahl: 2 },
      { art: 'Müllplatzschlüssel', anzahl: 1 },
    ]);
    const text = wohnraumParagraphen(daten)
      .flatMap(p => p.absaetze.map(a => a.text))
      .find(t => t.includes('folgende Schlüssel'));
    expect(text).toContain('folgende Schlüssel ausgehändigt: 2 Haustürschlüssel, 1 Müllplatzschlüssel.');
    expect(schluesselFuerDb(daten.schluessel)).toEqual({ haustuer: 2, Müllplatzschlüssel: 1 });
    // Beim Nachdruck kommt der Name unverändert zurück und bleibt frei bearbeitbar; Altform lesbar
    expect(leseSchluessel({ haustuer: 2, 'Tor 2 (Hof)': 1, fahrrad_raum: 1 })).toEqual([
      { art: 'Haustürschlüssel', anzahl: 2 },
      { art: 'Tor 2 (Hof)', anzahl: 1, frei: true },
      { art: 'Fahrrad raum', anzahl: 1, frei: true },
    ]);
    // Gleiche Namen ergeben im Vertrag und in der Spalte dieselbe Summe
    const doppelt = [
      { art: 'Haustürschlüssel', anzahl: 2 },
      { art: 'Haustürschlüssel', anzahl: 1, frei: true },
    ];
    expect(ausgehaendigteSchluessel(doppelt)).toEqual([{ art: 'Haustürschlüssel', anzahl: 3 }]);
    expect(schluesselFuerDb(doppelt)).toEqual({ haustuer: 3 });
  });

  it('verweist ohne benannten Schlüssel auf das Übergabeprotokoll', () => {
    const { daten } = entwurf();
    daten.schluessel = [{ art: '', anzahl: 2, frei: true }];
    const text = wohnraumParagraphen(daten)
      .flatMap(p => p.absaetze.map(a => a.text))
      .find(t => t.includes('folgende Schlüssel'));
    expect(text).toContain('die im Übergabeprotokoll aufgeführten Schlüssel');
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
  });

  it('meldet negative Betriebskosten ohne Heizkosten als solche', () => {
    const { daten } = entwurf();
    daten.betriebskostenVorauszahlung = -50;
    daten.heizkostenVorauszahlung = null;
    const befunde = pruefeVertragsdaten(daten);
    expect(befunde.find(f => f.feld === 'betriebskostenVorauszahlung')?.text).toBe('Die Betriebskostenvorauszahlung ist negativ.');
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

  it('zählt eine Firma als Mieterin nicht als Person, ihren Mitarbeiter als Mitbewohner schon', () => {
    // 27.10.2026: Firma plus Mitarbeiter ergab 2 Personen im Vertrag und im Personenschlüssel
    const firma = { ...leerePerson(), istUnternehmen: true, firmenname: 'Probe GmbH' };
    const mitarbeiter = { ...leerePerson('mitbewohner'), vorname: 'Kai', nachname: 'Probe' };
    expect(personenzahl([firma])).toBe(0);
    expect(personenzahl([firma, mitarbeiter])).toBe(1);
  });

  it('zählt einen Mitbewohner mit Namen, auch wenn „Unternehmen" stehen geblieben ist', () => {
    const p = { ...leerePerson('mitbewohner'), istUnternehmen: true, vorname: 'Kind', nachname: 'Probe' };
    expect(hatNamen(p)).toBe(true);
    expect(personenzahl([p])).toBe(1);
  });

});
