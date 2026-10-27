import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * process-payments ordnet Zahlungen zuerst über die IBAN zu. Bis zum 27.10.2026 verglich die Function
 * zeichengenau; ein Vertrag mit „DE00 1111 …“ am Bankkonto bekam deshalb nie eine Zahlung, und die
 * Stellplatzmiete landete Monat für Monat bei der Wohnung desselben Mieters.
 *
 * Deno-Code läuft hier nicht. Der Test schneidet die beteiligten Funktionen aus dem Quelltext,
 * übersetzt sie und führt sie mit einem nachgebauten Supabase-Client aus.
 */
const quelle = readFileSync('supabase/functions/process-payments/index.ts', 'utf-8');

function ausschnitt(kopf: string): string {
  const start = quelle.indexOf(kopf);
  expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
  const ende = quelle.indexOf('\n}\n', start);
  return quelle.slice(start, ende + 3);
}

function konstante(name: string): string {
  const zeile = quelle.split('\n').find(z => z.startsWith(`const ${name} =`));
  expect(zeile, `${name} nicht gefunden`).toBeDefined();
  return zeile as string;
}

const code = [
  konstante('BG_ZAHLUNG_IBAN'),
  konstante('BETRAG_TOLERANZ'),
  ausschnitt('function normalisiereIban('),
  ausschnitt('async function getContractContext('),
  ausschnitt('function categorizePaymentType('),
  ausschnitt('function checkSonderfallRegeln('),
  ausschnitt('function isPaymentInContractPeriod('),
  ausschnitt('function selectBestContractByDate('),
  ausschnitt('function isBetriebskostenabrechnung('),
  ausschnitt('function matchPaymentByRules('),
].join('\n');

const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn: any = new Function(
  'console',
  `${js}\nreturn { normalisiereIban, getContractContext, categorizePaymentType, matchPaymentByRules };`,
)({ log: () => {}, error: () => {} });

function vertrag(id: string, kaltmiete: number, bankkonto: string | null, weitere: string | null = null) {
  return {
    id, kaltmiete, betriebskosten: 0, kaution_betrag: null,
    bankkonto_mieter: bankkonto, weitere_bankkonten: weitere, verwendungszweck: null,
    status: 'aktiv', start_datum: '2025-01-01', ende_datum: null, einheit_id: id,
    einheiten: { id, etage: id, immobilie_id: 'o1', immobilien: { id: 'o1', name: 'Objekt', adresse: 'Weg 1' } },
    mietvertrag_mieter: [{ mieter: { id: 'm1', vorname: 'Anna', nachname: 'Beispiel' } }],
  };
}

function client(zeilen: unknown[]) {
  return { from: () => ({ select: () => ({ in: async () => ({ data: zeilen, error: null }) }) }) };
}

const KONTO = 'DE00111122223333444455';
const KONTO_MIT_LEERZEICHEN = 'DE00 1111 2222 3333 4444 55';

function zahlung(betrag: number, iban = KONTO) {
  return { buchungsdatum: '2026-10-01', betrag, iban, verwendungszweck: 'Miete', empfaengername: 'Anna Beispiel' };
}

describe('process-payments vergleicht IBANs ohne Leerzeichen', () => {
  it('normalisiert Leerzeichen und Kleinschreibung', () => {
    expect(fn.normalisiereIban(' de00 1111 2222\t3333 4444 55 ')).toBe(KONTO);
    expect(fn.normalisiereIban(null)).toBe('');
  });

  it('ordnet die Stellplatzmiete dem Stellplatz zu, auch wenn dessen IBAN Leerzeichen trägt', async () => {
    const vertraege = await fn.getContractContext(client([
      vertrag('wohnung', 1408, KONTO),
      vertrag('stellplatz', 50, KONTO_MIT_LEERZEICHEN),
    ]));
    expect(vertraege.find((v: { id: string }) => v.id === 'stellplatz').iban).toBe(KONTO);

    expect(fn.matchPaymentByRules(zahlung(50), vertraege, []).mietvertrag_id).toBe('stellplatz');
    expect(fn.matchPaymentByRules(zahlung(1408), vertraege, []).mietvertrag_id).toBe('wohnung');
  });

  it('findet auch weitere Bankkonten mit Leerzeichen und ignoriert leere Einträge', async () => {
    const vertraege = await fn.getContractContext(client([
      vertrag('stellplatz', 50, null, `DE99 0000 0000 0000 0000 00, ${KONTO_MIT_LEERZEICHEN},`),
    ]));
    expect(vertraege[0].weitere_iban).toBe(`DE99000000000000000000,${KONTO}`);
    expect(fn.matchPaymentByRules(zahlung(50), vertraege, []).mietvertrag_id).toBe('stellplatz');
    // Eine Zahlung ohne IBAN darf nicht über ein leeres Listenelement treffen
    expect(fn.matchPaymentByRules(zahlung(50, ''), vertraege, [])?.zuordnungsgrund ?? '').not.toMatch(/IBAN-Match/);
  });

  it('erkennt die Jobcenter-IBAN und IBAN-Regeln auch mit Leerzeichen', () => {
    expect(fn.categorizePaymentType(zahlung(400, 'DE94 7600 0000 0076 0016 01'), [])).toBe('bg_zahlung');
    const regel = { regel_typ: 'iban_equals', wert: 'DE99 0000 0000 0000 0000 00' };
    expect(fn.categorizePaymentType(zahlung(10, 'DE99000000000000000000'), [regel])).toBe('nichtmiete');
    expect(fn.categorizePaymentType(zahlung(10, ''), [{ regel_typ: 'iban_equals', wert: '' }])).toBe('standard');
  });

  it('vergleicht Zahlungs-IBANs nirgends mehr roh', () => {
    expect(quelle).not.toMatch(/payment\.iban\s*===/);
    expect(quelle).not.toMatch(/includes\(payment\.iban\)/);
  });
});
