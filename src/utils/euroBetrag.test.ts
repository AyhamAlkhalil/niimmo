import { describe, expect, it } from 'vitest';

import { normalisiereDezimalEingabe } from './decimalInput';
import { istUngueltigerEuroBetrag, leseEuroBetrag } from './euroBetrag';
import { leseKautionsbetrag } from './vertragKaution';

describe('leseEuroBetrag', () => {
  it('lehnt den mehrdeutigen Tausenderpunkt ab, statt 1,20 € zu speichern', () => {
    expect(leseEuroBetrag('1.200')).toBeUndefined();
    expect(leseEuroBetrag('12.500')).toBeUndefined();
    expect(leseEuroBetrag('1,200')).toBeUndefined();
    // Drei Nachkommastellen gibt es beim Euro nicht — auch mit führender Null oder langem Vorkommateil
    expect(leseEuroBetrag('01.200')).toBeUndefined();
    expect(leseEuroBetrag('1000.000')).toBeUndefined();
    expect(leseEuroBetrag('1234.567')).toBeUndefined();
  });

  it('liest die eindeutige deutsche Schreibweise mit Tausenderpunkt und Komma', () => {
    expect(leseEuroBetrag('1.200,50')).toBe(1200.5);
    expect(leseEuroBetrag('1.200,')).toBe(1200);
    expect(leseEuroBetrag('12.345,6')).toBe(12345.6);
    expect(leseEuroBetrag('1.234.567')).toBe(1234567);
    expect(leseEuroBetrag('1.234.567,89')).toBe(1234567.89);
  });

  it('liest Beträge ohne Tausendertrenner mit Komma oder Punkt', () => {
    expect(leseEuroBetrag('1200')).toBe(1200);
    expect(leseEuroBetrag('1200,50')).toBe(1200.5);
    expect(leseEuroBetrag('1200.50')).toBe(1200.5);
    expect(leseEuroBetrag(' 85,5 ')).toBe(85.5);
    expect(leseEuroBetrag('0')).toBe(0);
    expect(leseEuroBetrag('1.2')).toBe(1.2);
  });

  it('lässt Leeres leer und lehnt Negatives oder Unlesbares ab', () => {
    expect(leseEuroBetrag('')).toBeNull();
    expect(leseEuroBetrag('   ')).toBeNull();
    expect(leseEuroBetrag(null)).toBeNull();
    expect(leseEuroBetrag(undefined)).toBeNull();
    expect(leseEuroBetrag('-5')).toBeUndefined();
    expect(leseEuroBetrag('1.20.0')).toBeUndefined();
    expect(leseEuroBetrag('1,200.50')).toBeUndefined();
    expect(leseEuroBetrag('abc')).toBeUndefined();
  });

  it('übernimmt Zahlen aus der Datenbank', () => {
    expect(leseEuroBetrag(1200.5)).toBe(1200.5);
    expect(leseEuroBetrag(0)).toBe(0);
    expect(leseEuroBetrag(-1)).toBeUndefined();
    expect(leseEuroBetrag(Number.NaN)).toBeUndefined();
  });

  it('liest alles, was leseKautionsbetrag liest, genauso', () => {
    for (const w of ['1200', '1200,5', '1200.5', '1200.', '.5', '1.2', '0.500', '1.200', '', '-3', 'x']) {
      expect(leseEuroBetrag(w), w).toBe(leseKautionsbetrag(w));
    }
  });

  it('passt zu den Werten, die ui/input nach der Normalisierung liefert', () => {
    // Was im Feld getippt wird, kommt über normalisiereDezimalEingabe an
    expect(leseEuroBetrag(normalisiereDezimalEingabe('1.200,50'))).toBe(1200.5);
    expect(leseEuroBetrag(normalisiereDezimalEingabe('1200,50'))).toBe(1200.5);
    expect(leseEuroBetrag(normalisiereDezimalEingabe('1.234.567'))).toBe(1234567);
    // Der einzelne Punkt bleibt nach der Normalisierung stehen und wird hier abgelehnt
    expect(leseEuroBetrag(normalisiereDezimalEingabe('1.200'))).toBeUndefined();
  });
});

describe('istUngueltigerEuroBetrag', () => {
  it('meldet nur einen nicht lesbaren Text, nicht ein leeres Feld', () => {
    expect(istUngueltigerEuroBetrag('1.200')).toBe(true);
    expect(istUngueltigerEuroBetrag('')).toBe(false);
    expect(istUngueltigerEuroBetrag('1200')).toBe(false);
  });
});
