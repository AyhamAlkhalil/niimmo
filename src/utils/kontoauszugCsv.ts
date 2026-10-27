/**
 * Kontoauszug (CSV) einlesen — für die Zahlungsübernahme (PaymentManagement).
 *
 * Bis zum 27.10.2026 stand das Einlesen in der Komponente und trennte Zeilen an jedem
 * Zeilenumbruch und Spalten an jedem Semikolon, ohne Anführungszeichen zu beachten:
 * Ein Semikolon im Verwendungszweck verschob alle folgenden Spalten (falscher Betrag oder Tag),
 * ein Feld über mehrere Zeilen verschwand still, eine Zeile mit zu wenig Spalten fiel ohne Meldung
 * weg, ein unlesbarer Betrag wurde zu 0 €, und „1.250“ wurde 1,25 €. Jetzt nach RFC 4180,
 * und was nicht lesbar ist, wird gezählt und gemeldet statt still übernommen oder verworfen.
 */

/** Eine Zeile aus der CSV, so wie sie an process-payments geht. */
export interface CsvZahlung {
  buchungsdatum: string;
  wertstellungsdatum?: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername: string;
}

/** Text einer CSV-Datei: UTF-8, sonst Windows-1252 (ältere Bankexporte); ohne BOM. */
export function textAusCsvDatei(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

/** Zerlegt CSV-Text in Zeilen und Felder; Anführungszeichen schützen Trenner und Zeilenumbrüche. */
export function zerlegeCsv(text: string, trenner = ';'): string[][] {
  const zeilen: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let inAnfuehrung = false;
  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (inAnfuehrung) {
      if (z === '"') {
        if (text[i + 1] === '"') {
          feld += '"';
          i++;
        } else {
          inAnfuehrung = false;
        }
      } else {
        feld += z;
      }
    } else if (z === '"') {
      inAnfuehrung = true;
    } else if (z === trenner) {
      zeile.push(feld);
      feld = '';
    } else if (z === '\n' || z === '\r') {
      if (z === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else {
      feld += z;
    }
  }
  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen.filter((z) => z.some((f) => f.trim() !== ''));
}

/**
 * Betrag aus deutschem oder englischem Format, sonst null:
 * „1.250,00“, „1,250.00“, „1250,50“, „5000 00“, „-1.250,00“, „1.250,00-“, „1.250“ (Tausender).
 */
export function betragAusText(roh: string | number | null | undefined): number | null {
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null;
  if (!roh) return null;
  let s = roh.trim();
  let negativ = false;
  if (s.startsWith('-')) {
    negativ = true;
    s = s.slice(1).trim();
  } else if (s.endsWith('-')) {
    negativ = true;
    s = s.slice(0, -1).trim();
  }
  const leerzeichenDezimal = s.match(/^(\d+)\s(\d{2})$/);
  if (leerzeichenDezimal) {
    const wert = parseFloat(`${leerzeichenDezimal[1]}.${leerzeichenDezimal[2]}`);
    return negativ ? -wert : wert;
  }
  s = s.replace(/\s/g, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  const letztesKomma = s.lastIndexOf(',');
  const letzterPunkt = s.lastIndexOf('.');
  if (letztesKomma >= 0 && letzterPunkt >= 0) {
    s = letztesKomma > letzterPunkt ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    const trenner = letztesKomma >= 0 ? ',' : letzterPunkt >= 0 ? '.' : '';
    const teile = trenner ? s.split(trenner) : [s];
    // Genau drei Ziffern nach einem einzelnen Trenner sind Tausender („1.250“) — Banken
    // schreiben Beträge nie mit drei Nachkommastellen
    if (trenner && (teile.length > 2 || teile[teile.length - 1].length === 3)) s = teile.join('');
    else s = s.replace(',', '.');
  }
  const wert = parseFloat(s);
  if (!Number.isFinite(wert)) return null;
  return negativ ? -wert : wert;
}

/** Kalendertag aus „TT.MM.JJJJ“, „TT.MM.JJ“ oder „JJJJ-MM-TT“, sonst null. */
export function datumAusText(roh: string | null | undefined): string | null {
  const s = (roh ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  let j: number, m: number, t: number;
  if (iso) {
    [j, m, t] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (de) {
    t = Number(de[1]);
    m = Number(de[2]);
    j = de[3].length === 2 ? 2000 + Number(de[3]) : Number(de[3]);
  } else {
    return null;
  }
  const d = new Date(j, m - 1, t);
  if (d.getFullYear() !== j || d.getMonth() !== m - 1 || d.getDate() !== t) return null;
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

const SPALTEN_NAME = [
  'Empfaenger', 'Beguenstigter/Zahlungspflichtiger', 'Name', 'Empfänger', 'Begünstigter/Zahlungspflichtiger',
  'Auftraggeber/Begünstigter', 'Beguenstigter', 'Begünstigter', 'AbweichenderEmpfaenger', 'Absender', 'Auftraggeber',
  'Zahlungspflichtiger', 'Name des Absenders', 'Absender/Empfänger',
];

/** Liest die Buchungen eines Kontoauszugs; `uebersprungen` zählt nicht lesbare Zeilen. */
export function kontoauszugLesen(text: string): { zahlungen: CsvZahlung[]; uebersprungen: number } {
  const zeilen = zerlegeCsv(text);
  if (zeilen.length < 2) return { zahlungen: [], uebersprungen: 0 };
  const kopf = zeilen[0].map((h) => h.trim());
  const zahlungen: CsvZahlung[] = [];
  let uebersprungen = 0;

  for (const werte of zeilen.slice(1)) {
    // Weniger Spalten oder Daten in zusätzlichen Spalten (verschobene Zeile): nicht lesbar.
    // Leere zusätzliche Felder (Semikolon am Zeilenende) sind harmlos.
    if (werte.length < kopf.length || werte.slice(kopf.length).some((f) => f.trim() !== '')) {
      uebersprungen++;
      continue;
    }
    const zeile: Record<string, string> = {};
    kopf.forEach((spalte, i) => {
      zeile[spalte] = (werte[i] ?? '').trim();
    });
    const erste = (...namen: string[]) => namen.map((n) => zeile[n]).find((w) => !!w) ?? '';

    const buchungsdatum = datumAusText(erste('Buchungstag', 'Buchungsdatum', 'Datum'));
    const wertRoh = erste('Wertstellung', 'Wertstellungstag', 'Valuta', 'Valutadatum');
    const betrag = betragAusText(erste('Betrag', 'Umsatz'));
    if (!buchungsdatum || betrag === null) {
      uebersprungen++;
      continue;
    }
    zahlungen.push({
      buchungsdatum,
      wertstellungsdatum: wertRoh ? datumAusText(wertRoh) ?? undefined : undefined,
      betrag,
      iban: erste('Kontonummer/IBAN', 'IBAN des Absenders', 'IBAN', 'Auftraggeber-Konto', 'Auftragskonto'),
      verwendungszweck: erste('Verwendungszweck', 'Buchungstext'),
      empfaengername: erste(...SPALTEN_NAME),
    });
  }
  return { zahlungen, uebersprungen };
}
