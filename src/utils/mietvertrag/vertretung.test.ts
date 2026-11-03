import { describe, expect, it } from 'vitest';

import type { VermieterDaten } from './typen';
import {
  brauchtUnterzeichnerWahl,
  gewaehlterUnterzeichner,
  unterzeichnerVorschlag,
  vermieterVertretung,
  vertreterListe,
} from './vertretung';

function vermieter(teil: Partial<VermieterDaten> = {}): VermieterDaten {
  return {
    firmenname: 'Probe GmbH',
    rechtsform: 'GmbH',
    strasse: 'Weg',
    hausnummer: '1',
    plz: '12345',
    ort: 'Ort',
    vertretenDurch: ['Anna Erste', 'Bernd Zweiter'],
    vertretungArt: 'einzel',
    registergericht: null,
    handelsregister: null,
    steuernummer: null,
    ustId: null,
    telefon: null,
    fax: null,
    email: null,
    mietIban: null,
    mietBic: null,
    kautionIban: null,
    kautionBic: null,
    stammdatenGeprueft: true,
    ...teil,
  };
}

const BRIEF = [
  { email: 'erste@probe.de', unterschrift: 'Anna Erste (M. Sc.)', kontaktname: 'Frau Anna Erste, M. Sc.' },
  { email: 'zweiter@probe.de', unterschrift: 'Bernhard Zweiter', kontaktname: 'Herr Bernhard Zweiter' },
  { email: 'buchhaltung@probe.de', unterschrift: 'Clara Dritte', kontaktname: 'Frau Clara Dritte' },
];

describe('Unterzeichner des Vermieters', () => {
  it('verlangt eine Wahl nur bei Einzelvertretung mit mehreren Vertretern', () => {
    expect(brauchtUnterzeichnerWahl(vermieter())).toBe(true);
    expect(brauchtUnterzeichnerWahl(vermieter({ vertretungArt: 'gesamt' }))).toBe(false);
    expect(brauchtUnterzeichnerWahl(vermieter({ vertretenDurch: ['Anna Erste'] }))).toBe(false);
    // Ein Komma zu viel im Stammdatendialog ist kein zweiter Vertreter
    expect(brauchtUnterzeichnerWahl(vermieter({ vertretenDurch: ['Anna Erste', ' '] }))).toBe(false);
    expect(vertreterListe(vermieter({ vertretenDurch: [' Anna Erste ', ''] }))).toEqual(['Anna Erste']);
  });

  it('gilt nur, solange die gewählte Person in den Stammdaten steht', () => {
    const v = vermieter();
    expect(gewaehlterUnterzeichner({ vermieter: v, unterzeichnerVermieter: 'Bernd Zweiter' })).toBe('Bernd Zweiter');
    expect(gewaehlterUnterzeichner({ vermieter: v, unterzeichnerVermieter: 'Ausgeschieden' })).toBeNull();
    expect(gewaehlterUnterzeichner({ vermieter: v, unterzeichnerVermieter: undefined })).toBeNull();
  });

  it('nennt bei Einzelvertretung nur den Gewählten und braucht eine Linie', () => {
    expect(vermieterVertretung({ vermieter: vermieter(), unterzeichnerVermieter: 'Bernd Zweiter' })).toEqual({
      namen: ['Bernd Zweiter'],
      gemeinsam: false,
      linien: 1,
    });
    // Ohne Wahl wie bisher alle — die Pflichtprüfung sperrt das PDF
    expect(vermieterVertretung({ vermieter: vermieter(), unterzeichnerVermieter: null }).namen).toEqual([
      'Anna Erste',
      'Bernd Zweiter',
    ]);
  });

  it('lässt bei Gesamtvertretung alle gemeinsam zeichnen, auch wenn jemand gewählt ist', () => {
    expect(
      vermieterVertretung({ vermieter: vermieter({ vertretungArt: 'gesamt' }), unterzeichnerVermieter: 'Anna Erste' })
    ).toEqual({ namen: ['Anna Erste', 'Bernd Zweiter'], gemeinsam: true, linien: 2 });
  });

  it('schlägt den Angemeldeten über den Nachnamen vor', () => {
    const alle = ['Anna Erste', 'Bernd Zweiter'];
    expect(unterzeichnerVorschlag(alle, BRIEF, 'erste@probe.de')).toBe('Anna Erste');
    // Vorname unterschiedlich geschrieben (live: Denis/Dennis), Groß-/Kleinschreibung der E-Mail egal
    expect(unterzeichnerVorschlag(alle, BRIEF, ' Zweiter@Probe.de ')).toBe('Bernd Zweiter');
    // Auch eine gespeicherte E-Mail mit Großbuchstaben oder Leerzeichen passt (QA 03.11.2026)
    expect(unterzeichnerVorschlag(alle, [{ ...BRIEF[0], email: ' Erste@Probe.de ' }], 'erste@probe.de')).toBe('Anna Erste');
  });

  it('schlägt niemanden vor, der nicht vertreten darf, und rät nicht bei gleichem Nachnamen', () => {
    expect(unterzeichnerVorschlag(['Anna Erste', 'Bernd Zweiter'], BRIEF, 'buchhaltung@probe.de')).toBeNull();
    expect(unterzeichnerVorschlag(['Anna Erste', 'Bernd Zweiter'], BRIEF, 'unbekannt@probe.de')).toBeNull();
    expect(unterzeichnerVorschlag(['Anna Erste', 'Bernd Zweiter'], BRIEF, null)).toBeNull();
    expect(unterzeichnerVorschlag(['Anna Erste', 'Paul Erste'], BRIEF, 'erste@probe.de')).toBeNull();
  });
});
