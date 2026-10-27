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
  ausschnitt('function waehleVertrag('),
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

  it('raet bei gemeinsamer IBAN ohne passenden Betrag nicht, sondern markiert die Zeile als unsicher', async () => {
    // 27.10.2026: Eine Teilzahlung ging je nach DB-Reihenfolge an Wohnung oder Stellplatz, mit 95 % vorausgewählt
    const vorwaerts = await fn.getContractContext(client([vertrag('wohnung', 1408, KONTO), vertrag('stellplatz', 50, KONTO)]));
    const rueckwaerts = await fn.getContractContext(client([vertrag('stellplatz', 50, KONTO), vertrag('wohnung', 1408, KONTO)]));
    for (const betrag of [1000, 1458]) {
      const a = fn.matchPaymentByRules(zahlung(betrag), vorwaerts, []);
      const b = fn.matchPaymentByRules(zahlung(betrag), rueckwaerts, []);
      expect(a.mietvertrag_id).toBe(b.mietvertrag_id);
      expect(a.selected).toBe(false);
      expect(a.confidence).toBeLessThan(80);
      expect(a.zuordnungsgrund).toMatch(/bitte prüfen/);
    }
    const passend = fn.matchPaymentByRules(zahlung(1408), rueckwaerts, []);
    expect(passend).toMatchObject({ mietvertrag_id: 'wohnung', selected: true, confidence: 95 });
  });

  it('zählt einen Vertrag mit derselben IBAN als Haupt- und weiteres Konto nur einmal', async () => {
    const vertraege = await fn.getContractContext(client([vertrag('wohnung', 1408, KONTO, KONTO_MIT_LEERZEICHEN)]));
    expect(fn.matchPaymentByRules(zahlung(1000), vertraege, [])).toMatchObject({ mietvertrag_id: 'wohnung', selected: true, confidence: 95 });
  });

  it('wertet aktiv gegen gekündigt bei gleichem Betrag als unsicher, aktiv gegen beendet nicht', async () => {
    const zeilen = (status2: string) => [vertrag('a', 500, KONTO), { ...vertrag('b', 500, KONTO), status: status2 }];
    const gekuendigt = fn.matchPaymentByRules(zahlung(500), await fn.getContractContext(client(zeilen('gekuendigt'))), []);
    expect(gekuendigt).toMatchObject({ selected: false });
    const beendet = fn.matchPaymentByRules(zahlung(500), await fn.getContractContext(client(zeilen('beendet'))), []);
    expect(beendet).toMatchObject({ mietvertrag_id: 'a', selected: true });
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

describe('process-payments Zugriff', () => {
  const handler = quelle.slice(quelle.indexOf('serve(async (req)'));

  it('prüft Login und Admin-Rolle vor dem ersten Datenzugriff', () => {
    // 27.10.2026: Jedes Login genügte, der Hausmeister bekam Verträge, Mieternamen und existingId
    const rolle = handler.indexOf("rpc('is_admin'");
    expect(handler.indexOf('auth.getUser()')).toBeGreaterThan(0);
    expect(rolle).toBeGreaterThan(handler.indexOf('auth.getUser()'));
    expect(rolle).toBeLessThan(handler.indexOf('getContractContext(supabase)'));
    expect(handler).toMatch(/istAdmin !== true[\s\S]{0,200}status: 403/);
  });

  it('bricht ab, wenn Verträge, Regeln oder der Bestand nicht geladen werden', async () => {
    // 27.10.2026: Ein Ladefehler ergab still [] und damit „alles nicht zugeordnet" bzw. „alles neu"
    const kaputt = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'timeout' } }) }) }) };
    await expect(fn.getContractContext(kaputt)).rejects.toThrow(/nicht geladen/);
    expect(quelle).not.toMatch(/console\.error\("Error fetching[^"]*", error\);\s*return \[\];/);
    expect(handler.match(/const \{ data, error \} = await supabase\s*\.from\("zahlungen"\)/g)).toHaveLength(2);
  });

  it('schreibt nie selbst in zahlungen', () => {
    // Der frühere Schreibpfad (dryRun: false) hängte jede Buchung mit gleichem Tag, Betrag und IBAN um
    expect(handler).toMatch(/if \(dryRun !== true\)[\s\S]{0,200}status: 400/);
    expect(quelle).not.toMatch(/from\("zahlungen"\)\s*\.update/);
  });
});
