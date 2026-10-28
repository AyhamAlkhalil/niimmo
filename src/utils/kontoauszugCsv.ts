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
  return text.replace(/^\uFEFF/, '');
}

/** Zerlegt CSV-Text in Zeilen und Felder; Anführungszeichen schützen Trenner und Zeilenumbrüche. */
export function zerlegeCsv(text: string, trenner = ';'): string[][] {
  const zeilen: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let inAnfuehrung = false;
  // Ein Anführungszeichen öffnet nur am Feldanfang (RFC 4180); mitten im Feld (Rohr 3" Anschluss)
  // ist es ein Zeichen, sonst verschmölze der Rest der Datei zu einem Feld
  let amFeldanfang = true;
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
    } else if (z === '"' && (amFeldanfang || feld.trim() === '')) {
      // Leerzeichen vor dem öffnenden Anführungszeichen („a; "x;y"“) gehören nicht zum Feld
      feld = '';
      inAnfuehrung = true;
      amFeldanfang = false;
    } else if (z === trenner) {
      zeile.push(feld);
      feld = '';
      amFeldanfang = true;
    } else if (z === '\n' || z === '\r') {
      if (z === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
      amFeldanfang = true;
    } else {
      feld += z;
      amFeldanfang = false;
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
 * „1.250,00“, „1,250.00“, „1250,50“, „5000 00“, „-1.250,00“, „1.250,00-“, „1.250“ (Tausender),
 * „+1.250,00“, „1.250,00 €“, „EUR 1.250,00“, „−5,00“ (typografisches Minus).
 */
export function betragAusText(roh: string | number | null | undefined): number | null {
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null;
  if (!roh) return null;
  // Währung und Vorzeichenvarianten, wie manche Banken sie ins Betragsfeld schreiben
  let s = roh.replace(/[\u2212\u2013]/g, '-').replace(/€|EUR/gi, '').trim();
  let negativ = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    negativ = s.startsWith('-');
    s = s.slice(1).trim();
  } else if (s.endsWith('-') || s.endsWith('+')) {
    negativ = s.endsWith('-');
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
    // schreiben Beträge nie mit drei Nachkommastellen. Nicht bei „0,500“: davor stehen
    // dann ein bis drei Ziffern ohne führende Null.
    const tausender = teile.length > 2 || (teile[1]?.length === 3 && /^[1-9]\d{0,2}$/.test(teile[0]));
    if (trenner && tausender) s = teile.join('');
    else s = s.replace(',', '.');
  }
  const wert = parseFloat(s);
  if (!Number.isFinite(wert)) return null;
  return negativ ? -wert : wert;
}

const BERLINER_TAG = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kalendertag (JJJJ-MM-TT) eines Zeitpunkts in Berlin, unabhängig von der Zeitzone des Rechners. */
function berlinerKalendertag(zeitpunkt: Date): string {
  const teile = Object.fromEntries(BERLINER_TAG.formatToParts(zeitpunkt).map((t) => [t.type, t.value]));
  return `${teile.year}-${teile.month}-${teile.day}`;
}

/**
 * Kalendertag aus „TT.MM.JJJJ“, „TT.MM.JJ“ oder „JJJJ-MM-TT“ (auch mit Uhrzeit dahinter), sonst null.
 *
 * Ein ISO-Zeitstempel mit Zeitzone (`Z` oder `+02:00`) wird seit 28.10.2026 in den Berliner Tag
 * umgerechnet. Bis dahin zählten nur die ersten zehn Zeichen: „2026-10-01T22:00:00Z“ — so legen
 * Exporte die Berliner Mitternacht des 02.10. in UTC ab — wurde zum 01.10., die Buchung fiel einen
 * Tag und am Monatsende in den falschen Monat. Ohne Zeitzone gilt die Angabe als Berliner Ortszeit
 * und der Tag bleibt, wie er dasteht.
 */
export function datumAusText(roh: string | null | undefined): string | null {
  const s = (roh ?? '').trim();
  // Die Uhrzeit wird wie vor dem 28.10.2026 großzügig angenommen („9:05“, „13:45:00.000“); streng
  // gelesen wird sie nur, wenn eine Zeitzone dabeisteht und umgerechnet werden muss (Review 28.10.2026)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]([\d:.,]+)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
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

  if (iso?.[5]) {
    const zeit = iso[4].match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?$/);
    if (!zeit) return null;
    const stunde = Number(zeit[1]);
    const minute = Number(zeit[2]);
    const sekunde = Number(zeit[3] ?? 0);
    if (stunde > 23 || minute > 59 || sekunde > 59) return null;
    const zone = iso[5].toUpperCase();
    let versatzMinuten = 0;
    if (zone !== 'Z') {
      const z = zone.match(/^([+-])(\d{2}):?(\d{2})$/)!;
      const vh = Number(z[2]);
      const vm = Number(z[3]);
      if (vh > 14 || vm > 59) return null;
      versatzMinuten = (z[1] === '-' ? -1 : 1) * (vh * 60 + vm);
    }
    const utc = Date.UTC(j, m - 1, t, stunde, minute, sekunde) - versatzMinuten * 60_000;
    return berlinerKalendertag(new Date(utc));
  }
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

// Spaltenköpfe der gängigen Bankexporte (Sparkasse, Volksbank, DKB, ING); bei der DKB steht die
// Gegenseite einer Gutschrift unter „Zahlungspflichtige*r“, deshalb vor „Zahlungsempfänger*in“
const SPALTEN_NAME = [
  'Empfaenger', 'Beguenstigter/Zahlungspflichtiger', 'Name', 'Empfänger', 'Begünstigter/Zahlungspflichtiger',
  'Auftraggeber/Begünstigter', 'Beguenstigter', 'Begünstigter', 'AbweichenderEmpfaenger', 'Absender', 'Auftraggeber',
  'Zahlungspflichtiger', 'Name des Absenders', 'Absender/Empfänger', 'Name Zahlungsbeteiligter',
  'Zahlungspflichtige*r', 'Auftraggeber/Empfänger', 'Zahlungsempfänger*in',
];
const SPALTEN_BUCHUNGSTAG = ['Buchungstag', 'Buchungsdatum', 'Datum', 'Buchung'];
const SPALTEN_WERTSTELLUNG = ['Wertstellung', 'Wertstellungstag', 'Wertstellungsdatum', 'Valuta', 'Valutadatum'];
const SPALTEN_BETRAG = ['Betrag', 'Umsatz', 'Betrag (€)', 'Betrag (EUR)', 'Betrag in EUR'];
const SPALTEN_IBAN = ['Kontonummer/IBAN', 'IBAN des Absenders', 'IBAN', 'IBAN Zahlungsbeteiligter', 'Auftraggeber-Konto', 'Auftragskonto'];

/** Liest die Buchungen eines Kontoauszugs; `uebersprungen` zählt nicht lesbare Zeilen. */
export function kontoauszugLesen(text: string): { zahlungen: CsvZahlung[]; uebersprungen: number } {
  const alleZeilen = zerlegeCsv(text);
  // DKB und ING stellen Kontodaten und Zeitraum vor die Kopfzeile: Kopf ist die erste Zeile mit einer
  // Datums- und einer Betragsspalte, sonst die erste Zeile
  const kopfIndex = Math.max(0, alleZeilen.findIndex((z) => {
    const namen = z.map((f) => f.trim());
    return SPALTEN_BUCHUNGSTAG.some((n) => namen.includes(n)) && SPALTEN_BETRAG.some((n) => namen.includes(n));
  }));
  const zeilen = alleZeilen.slice(kopfIndex);
  if (zeilen.length < 2) return { zahlungen: [], uebersprungen: 0 };
  const kopf = zeilen[0].map((h) => h.trim());
  // Ein Semikolon am Ende der Kopfzeile ergibt eine leere Spalte, die den Datenzeilen fehlt
  while (kopf.length > 0 && kopf[kopf.length - 1] === '') kopf.pop();
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

    const buchungsdatum = datumAusText(erste(...SPALTEN_BUCHUNGSTAG));
    const wertRoh = erste(...SPALTEN_WERTSTELLUNG);
    const betrag = betragAusText(erste(...SPALTEN_BETRAG));
    if (!buchungsdatum || betrag === null) {
      uebersprungen++;
      continue;
    }
    zahlungen.push({
      buchungsdatum,
      wertstellungsdatum: wertRoh ? datumAusText(wertRoh) ?? undefined : undefined,
      betrag,
      iban: erste(...SPALTEN_IBAN),
      verwendungszweck: erste('Verwendungszweck', 'Buchungstext'),
      empfaengername: erste(...SPALTEN_NAME),
    });
  }
  return { zahlungen, uebersprungen };
}
