import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Kautionserkennung im Zahlungsimport (process-payments). Deno-Code läuft hier nicht; der Test schneidet
 * die Funktion aus dem Quelltext und führt sie aus (Muster wie processPaymentsIban.test.ts).
 *
 * Sonderfall 29.10.2026: Ein Mieter überweist seine Monatsmiete mit „Kaution“ im Verwendungszweck,
 * obwohl die Kaution längst voll gezahlt ist. Die Regel vom 27.10. hätte jede dieser Zahlungen als
 * Kaution gebucht und die Miete als Rückstand stehen lassen.
 */
const quelle = readFileSync('supabase/functions/process-payments/index.ts', 'utf-8');
const start = quelle.indexOf('function istKautionsbuchung(');
const ende = quelle.indexOf('\n}\n', start);
const toleranz = quelle.split('\n').find((z) => z.startsWith('const BETRAG_TOLERANZ =')) as string;
const js = ts.transpileModule(`${toleranz}\n${quelle.slice(start, ende + 3)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const istKautionsbuchung = new Function(`${js}\nreturn istKautionsbuchung;`)() as (
  verwendungszweck: string,
  betrag: number,
  kaution: number | null,
  kautionIst?: number | null
) => boolean;

describe('istKautionsbuchung', () => {
  it('erkennt Kautionsraten, solange die Kaution nicht voll gezahlt ist', () => {
    expect(istKautionsbuchung('Kaution 1. Rate', 350, 1050, 0)).toBe(true);
    expect(istKautionsbuchung('Kaution 3. Rate', 350, 1050, 700)).toBe(true);
    expect(istKautionsbuchung('Mietkaution', 1050, 1050, null)).toBe(true);
  });

  it('bucht bei voll gezahlter Kaution einen weiteren Eingang nicht als Kaution', () => {
    // Live: Miete 450 €, Kaution 1.050 € voll gezahlt, monatlich 350 € mit „Kaution“ im Text
    expect(istKautionsbuchung('Miete Kaution', 350, 1050, 1050)).toBe(false);
    expect(istKautionsbuchung('Kaution', 1250, 3300, 3300)).toBe(false);
  });

  it('erkennt eine Rückzahlung auch bei voll gezahlter Kaution', () => {
    expect(istKautionsbuchung('Rueckzahlung Kaution', -1050, 1050, 1050)).toBe(true);
  });

  it('erkennt ohne Kautionswort oder ohne vereinbarte Kaution nichts', () => {
    expect(istKautionsbuchung('Miete Oktober', 350, 1050, 0)).toBe(false);
    expect(istKautionsbuchung('Kaution', 350, null, null)).toBe(false);
    expect(istKautionsbuchung('Kaution', 2000, 1050, 0)).toBe(false);
  });

  it('wird an allen Stellen mit der gezahlten Kaution aufgerufen', () => {
    const aufrufe = quelle.match(/istKautionsbuchung\(verwendungszweck, payment\.betrag, [^)]*\)/g) ?? [];
    expect(aufrufe.length).toBe(5);
    for (const a of aufrufe) expect(a).toMatch(/\.kautionIst\)$/);
    expect(quelle).toMatch(/kaution_ist,\n\s+bankkonto_mieter,/);
  });
});
