import { describe, it, expect } from 'vitest';
import { sanitizeZaehlerstand, parseZaehlerstand, istGueltigeZaehlerstandEingabe } from './zaehlerstandUtils';

describe('sanitizeZaehlerstand', () => {
  it('behält die Komma-Eingabe der deutschen Tastatur', () => {
    expect(sanitizeZaehlerstand('128,456')).toBe('128,456');
  });

  it('behält Punkt-Eingaben', () => {
    expect(sanitizeZaehlerstand('128.456')).toBe('128.456');
  });

  it('entfernt Buchstaben, Leerzeichen und Vorzeichen', () => {
    expect(sanitizeZaehlerstand('12a3 kWh')).toBe('123');
    expect(sanitizeZaehlerstand('-45')).toBe('45');
  });

  it('lässt eine teilweise Eingabe stehen, damit das Tippen nicht abbricht', () => {
    expect(sanitizeZaehlerstand('128,')).toBe('128,');
  });
});

describe('parseZaehlerstand', () => {
  it('liest Komma als Dezimaltrenner', () => {
    expect(parseZaehlerstand('128,456')).toBe(128.456);
    expect(parseZaehlerstand('77,9')).toBe(77.9);
  });

  it('liest Punkt als Dezimaltrenner, wenn kein Komma vorhanden ist', () => {
    expect(parseZaehlerstand('128.456')).toBe(128.456);
  });

  it('behandelt Punkte als Tausendertrenner, wenn ein Komma folgt', () => {
    expect(parseZaehlerstand('1.234,5')).toBe(1234.5);
    expect(parseZaehlerstand('12.345.678,9')).toBe(12345678.9);
  });

  it('liest ganze Zahlen', () => {
    expect(parseZaehlerstand('3242')).toBe(3242);
  });

  it('gibt null für leere und unbrauchbare Eingaben zurück', () => {
    expect(parseZaehlerstand('')).toBeNull();
    expect(parseZaehlerstand('   ')).toBeNull();
    expect(parseZaehlerstand(null)).toBeNull();
    expect(parseZaehlerstand(undefined)).toBeNull();
    expect(parseZaehlerstand(',')).toBeNull();
  });

  it('erkennt den Zählerstand 0 als gültigen Wert', () => {
    expect(parseZaehlerstand('0')).toBe(0);
    expect(parseZaehlerstand('0,0')).toBe(0);
  });

  it('akzeptiert ein nachlaufendes Trennzeichen als unfertige Eingabe', () => {
    expect(parseZaehlerstand('128,')).toBe(128);
    expect(parseZaehlerstand('128.')).toBe(128);
  });

  it('lehnt mehrdeutige Eingaben ab, statt sie stillschweigend abzuschneiden', () => {
    // parseFloat allein würde hier 12.34 bzw. 12.345 liefern — plausibel
    // aussehende, aber falsche Werte. Genau dieser stille Verlust soll nicht
    // wieder vorkommen.
    expect(parseZaehlerstand('12,34,5')).toBeNull();
    expect(parseZaehlerstand('12.345.678')).toBeNull();
    expect(parseZaehlerstand('1,2.3')).toBeNull();
    expect(parseZaehlerstand(',,')).toBeNull();
    expect(parseZaehlerstand('.')).toBeNull();
  });

  it('verliert keinen Wert, der die Sanitisierung passiert hat', () => {
    // Regressionsschutz: was im Feld steht, muss auch in der DB landen
    for (const eingabe of ['128,456', '0,001', '99999,99', '7', '1.234,5']) {
      expect(parseZaehlerstand(sanitizeZaehlerstand(eingabe))).not.toBeNull();
    }
  });
});

describe('istGueltigeZaehlerstandEingabe', () => {
  it('wertet ein leeres Feld als zulässig — es ist schlicht nicht erfasst', () => {
    expect(istGueltigeZaehlerstandEingabe('')).toBe(true);
    expect(istGueltigeZaehlerstandEingabe('   ')).toBe(true);
    expect(istGueltigeZaehlerstandEingabe(null)).toBe(true);
  });

  it('akzeptiert gültige Zahlen', () => {
    expect(istGueltigeZaehlerstandEingabe('128,456')).toBe(true);
    expect(istGueltigeZaehlerstandEingabe('3242')).toBe(true);
    expect(istGueltigeZaehlerstandEingabe('128,')).toBe(true);
  });

  it('markiert mehrdeutige Eingaben als ungültig', () => {
    expect(istGueltigeZaehlerstandEingabe('12,34,5')).toBe(false);
    expect(istGueltigeZaehlerstandEingabe('12.345.678')).toBe(false);
  });
});
