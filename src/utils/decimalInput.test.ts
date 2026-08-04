import { describe, it, expect } from 'vitest';
import { normalisiereDezimalEingabe } from './decimalInput';

describe('normalisiereDezimalEingabe', () => {
  it('macht aus dem Dezimalkomma einen Punkt', () => {
    expect(normalisiereDezimalEingabe('128,456')).toBe('128.456');
    expect(normalisiereDezimalEingabe('850,50')).toBe('850.50');
    expect(normalisiereDezimalEingabe('0,001')).toBe('0.001');
  });

  it('lässt Eingaben mit Punkt unverändert', () => {
    expect(normalisiereDezimalEingabe('128.456')).toBe('128.456');
    expect(normalisiereDezimalEingabe('3242')).toBe('3242');
  });

  it('lässt einen nachlaufenden Trenner stehen, damit das Tippen weitergeht', () => {
    expect(normalisiereDezimalEingabe('128,')).toBe('128.');
    expect(normalisiereDezimalEingabe('128.')).toBe('128.');
  });

  it('behandelt Punkte vor einem Komma als Tausendertrenner', () => {
    // Ohne diese Regel würde aus 1.234,56 € der Betrag 1,23456 — derselbe
    // stille Faktor-1000-Fehler, den diese Datei verhindern soll.
    expect(normalisiereDezimalEingabe('1.234,56')).toBe('1234.56');
    expect(normalisiereDezimalEingabe('12.345.678,90')).toBe('12345678.90');
    expect(normalisiereDezimalEingabe('1.234,5')).toBe('1234.5');
  });

  it('entfernt mehrere Punkte ohne Komma als Tausendertrenner', () => {
    // Zwei Punkte können kein Dezimaltrenner sein
    expect(normalisiereDezimalEingabe('12.345.678')).toBe('12345678');
  });

  it('behält einen einzelnen Punkt als Dezimaltrenner', () => {
    expect(normalisiereDezimalEingabe('128.456')).toBe('128.456');
  });

  it('reduziert mehrere Kommas auf das erste', () => {
    expect(normalisiereDezimalEingabe('1,2,3')).toBe('1.23');
  });

  it('behält ein führendes Minus', () => {
    // Rücklastschriften und Korrekturen sind negativ — rund 43 % der Bankbewegungen
    expect(normalisiereDezimalEingabe('-45')).toBe('-45');
    expect(normalisiereDezimalEingabe('-1.234,56')).toBe('-1234.56');
    expect(normalisiereDezimalEingabe('-0,01')).toBe('-0.01');
    expect(parseFloat(normalisiereDezimalEingabe('-26.477,50'))).toBe(-26477.5);
  });

  it('entfernt Buchstaben, Leerzeichen und Minus in der Mitte', () => {
    expect(normalisiereDezimalEingabe('12a3 kWh')).toBe('123');
    expect(normalisiereDezimalEingabe('850,50 €')).toBe('850.50');
    expect(normalisiereDezimalEingabe('12-34')).toBe('1234');
  });

  it('liefert für leere Eingaben eine leere Zeichenkette', () => {
    expect(normalisiereDezimalEingabe('')).toBe('');
    expect(normalisiereDezimalEingabe('abc')).toBe('');
  });

  it('erzeugt immer eine Zeichenkette, die parseFloat korrekt liest', () => {
    // Kernzusage: was der Nutzer tippt, kommt als gültige Zahl beim Aufrufer an
    const faelle: Array<[string, number]> = [
      ['128,456', 128.456],
      ['850,50', 850.5],
      ['0,001', 0.001],
      ['77,9', 77.9],
      ['3242', 3242],
      ['128,', 128],
      ['1.234,56', 1234.56],
      ['59.265,00', 59265],
      ['-26.477,50', -26477.5],
    ];
    for (const [eingabe, erwartet] of faelle) {
      expect(parseFloat(normalisiereDezimalEingabe(eingabe))).toBeCloseTo(erwartet, 6);
    }
  });

  it('ist idempotent — mehrfaches Anwenden ändert nichts mehr', () => {
    for (const eingabe of ['128,456', '1,2,3', '12a3', '850,50 €', '128,', '1.234,56', '-45,5', '12.345.678']) {
      const einmal = normalisiereDezimalEingabe(eingabe);
      expect(normalisiereDezimalEingabe(einmal)).toBe(einmal);
    }
  });
});
