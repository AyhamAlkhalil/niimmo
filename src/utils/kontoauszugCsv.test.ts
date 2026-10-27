import { describe, expect, it } from 'vitest';
import { betragAusText, datumAusText, kontoauszugLesen, textAusCsvDatei, zerlegeCsv } from './kontoauszugCsv';

const KOPF = 'Buchungstag;Wertstellung;Verwendungszweck;IBAN;Betrag;Name';

describe('zerlegeCsv', () => {
  it('beachtet Anführungszeichen, verdoppelte Anführungszeichen und Zeilenumbrüche im Feld', () => {
    // 27.10.2026: Ein Semikolon im Verwendungszweck verschob alle folgenden Spalten
    expect(zerlegeCsv('a;"b;c";"d ""e"""\r\n1;"zwei\nZeilen";3\n')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['1', 'zwei\nZeilen', '3'],
    ]);
  });

  it('behandelt ein Anführungszeichen mitten im Feld als Zeichen', () => {
    // Sonst verschmölze alles bis zum nächsten Anführungszeichen der Datei zu einem Feld
    expect(zerlegeCsv('a;Rohr 3" Anschluss;c\nd;e;f\n')).toEqual([
      ['a', 'Rohr 3" Anschluss', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('öffnet ein Anführungszeichen auch nach Leerzeichen am Feldanfang', () => {
    expect(zerlegeCsv('a; "x;y";c\n')).toEqual([['a', 'x;y', 'c']]);
  });
});

describe('kontoauszugLesen', () => {
  it('liest Betrag und Tag richtig, auch mit Semikolon im Verwendungszweck', () => {
    const text = `${KOPF}\n01.10.2026;01.10.2026;"Miete; Oktober";DE00111122223333444455;"1.250,00";Anna Beispiel\n`;
    expect(kontoauszugLesen(text)).toEqual({
      zahlungen: [{ buchungsdatum: '2026-10-01', wertstellungsdatum: '2026-10-01', betrag: 1250, iban: 'DE00111122223333444455', verwendungszweck: 'Miete; Oktober', empfaengername: 'Anna Beispiel' }],
      uebersprungen: 0,
    });
  });

  it('zählt unlesbare und verschobene Zeilen, statt 0 € oder falsche Spalten zu übernehmen', () => {
    const text = [
      KOPF,
      '01.10.2026;;Miete;DE00;abc;X',         // Betrag unlesbar
      '32.10.2026;;Miete;DE00;10,00;X',       // Tag unmöglich
      '01.10.2026;;Miete;DE00;10,00',         // Spalte fehlt
      '01.10.2026;;Miete;Teil;DE00;10,00;X',  // eine Spalte zu viel (ungeschütztes Semikolon)
      '02.10.2026;;Miete;DE00;10,00;X;',      // Semikolon am Zeilenende ist harmlos
    ].join('\n');
    const r = kontoauszugLesen(text);
    expect(r.uebersprungen).toBe(4);
    expect(r.zahlungen).toHaveLength(1);
    expect(r.zahlungen[0]).toMatchObject({ buchungsdatum: '2026-10-02', betrag: 10 });
  });

  it('kennt die Spaltenköpfe von Volksbank, DKB und ING', () => {
    const volksbank = kontoauszugLesen('Buchungstag;Valutadatum;Name Zahlungsbeteiligter;IBAN Zahlungsbeteiligter;Verwendungszweck;Betrag\n01.10.2026;01.10.2026;Anna Beispiel;DE00111122223333444455;Miete;500,00\n');
    expect(volksbank.zahlungen[0]).toMatchObject({ iban: 'DE00111122223333444455', empfaengername: 'Anna Beispiel', betrag: 500 });
    const dkb = kontoauszugLesen('Buchungsdatum;Wertstellung;Status;Zahlungspflichtige*r;Zahlungsempfänger*in;Verwendungszweck;Umsatztyp;IBAN;Betrag (€)\n01.10.26;01.10.26;Gebucht;Anna Beispiel;NiImmo;Miete;Eingang;DE00111122223333444455;500,00\n');
    expect(dkb.zahlungen[0]).toMatchObject({ buchungsdatum: '2026-10-01', empfaengername: 'Anna Beispiel', betrag: 500 });
    const ing = kontoauszugLesen('Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Betrag\n01.10.2026;01.10.2026;Anna Beispiel;Gutschrift;Miete;500,00\n');
    expect(ing.zahlungen[0]).toMatchObject({ buchungsdatum: '2026-10-01', empfaengername: 'Anna Beispiel', betrag: 500 });
  });

  it('überspringt Vorspannzeilen vor der Kopfzeile', () => {
    const text = 'Kontonummer:;DE00111122223333444455\nZeitraum:;01.10.2026 - 31.10.2026\n\n' + KOPF + '\n02.10.2026;;Miete;DE00;10,00;X\n';
    expect(kontoauszugLesen(text)).toMatchObject({ uebersprungen: 0, zahlungen: [{ buchungsdatum: '2026-10-02', betrag: 10 }] });
  });

  it('liest Datenzeilen, wenn nur die Kopfzeile ein Semikolon am Ende hat', () => {
    const r = kontoauszugLesen(`${KOPF};\n02.10.2026;;Miete;DE00;10,00;X\n`);
    expect(r).toMatchObject({ uebersprungen: 0, zahlungen: [{ buchungsdatum: '2026-10-02', betrag: 10 }] });
  });
});

describe('betragAusText und datumAusText', () => {
  it('liest deutsche und englische Beträge, „1.250“ als Tausender', () => {
    expect(betragAusText('1.250,00')).toBe(1250);
    expect(betragAusText('1,250.00')).toBe(1250);
    expect(betragAusText('-1.250,00')).toBe(-1250);
    expect(betragAusText('1.250,00-')).toBe(-1250);
    expect(betragAusText('1250,5')).toBe(1250.5);
    expect(betragAusText('5000 00')).toBe(5000);
    expect(betragAusText('1.250')).toBe(1250);
    expect(betragAusText('1.234.567')).toBe(1234567);
    expect(betragAusText('12,5')).toBe(12.5);
    expect(betragAusText('')).toBeNull();
    expect(betragAusText('EUR')).toBeNull();
  });

  it('liest Vorzeichen, Währung und typografisches Minus im Betragsfeld', () => {
    expect(betragAusText('+1.234,56')).toBe(1234.56);
    expect(betragAusText('1.234,56 €')).toBe(1234.56);
    expect(betragAusText('1.234,56 EUR')).toBe(1234.56);
    expect(betragAusText('EUR -50,00')).toBe(-50);
    expect(betragAusText('\u22125,00')).toBe(-5);
    expect(betragAusText('5,00+')).toBe(5);
  });

  it('liest „0,500“ als Dezimalzahl, nicht als Tausender', () => {
    expect(betragAusText('0,500')).toBe(0.5);
    expect(betragAusText('12.345')).toBe(12345);
  });

  it('versteht zweistellige Jahre und lehnt unmögliche Tage ab', () => {
    expect(datumAusText('1.10.26')).toBe('2026-10-01');
    expect(datumAusText('2026-10-01')).toBe('2026-10-01');
    expect(datumAusText('30.02.2026')).toBeNull();
    expect(datumAusText('10/01/2026')).toBeNull();
  });

  it('nimmt den Kalendertag auch mit Uhrzeit dahinter', () => {
    expect(datumAusText('27.10.2026 00:00:00')).toBe('2026-10-27');
    expect(datumAusText('2026-10-27T00:00:00')).toBe('2026-10-27');
    expect(datumAusText('2026-10-27 13:45:00.000+02:00')).toBe('2026-10-27');
  });
});

describe('textAusCsvDatei', () => {
  it('liest UTF-8 und fällt bei ungültigem UTF-8 auf Windows-1252 zurück', () => {
    expect(textAusCsvDatei(new TextEncoder().encode('\uFEFFMüller').buffer)).toBe('Müller');
    expect(textAusCsvDatei(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]).buffer)).toBe('Müller');
  });
});
