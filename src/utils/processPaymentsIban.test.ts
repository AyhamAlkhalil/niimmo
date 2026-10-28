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
  ausschnitt('function namensVarianten('),
  ausschnitt('function istKautionsbuchung('),
  ausschnitt('function teileNachBestand<T>('),
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
  `${js}\nreturn { normalisiereIban, getContractContext, categorizePaymentType, matchPaymentByRules, checkSonderfallRegeln, teileNachBestand };`,
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

  it('wählt nicht vor, wenn die Buchung in keiner Vertragslaufzeit liegt', async () => {
    // 27.10.2026: Der einzige aktive Vertrag galt dann als eindeutig und kam mit 95 % vorausgewählt
    const vertraege = await fn.getContractContext(client([
      { ...vertrag('alt', 500, KONTO), status: 'beendet', start_datum: '2023-01-01', ende_datum: '2024-12-31' },
      { ...vertrag('neu', 600, KONTO), start_datum: '2027-01-01' },
    ]));
    expect(fn.matchPaymentByRules(zahlung(1000), vertraege, [])).toMatchObject({ mietvertrag_id: 'neu', selected: false });
    // Passt der Betrag eindeutig, bleibt die Vorauswahl
    expect(fn.matchPaymentByRules(zahlung(600), vertraege, [])).toMatchObject({ mietvertrag_id: 'neu', selected: true });
  });

  it('wählt über eine Sonderfall-Regel nur vor, wenn der Zielvertrag eindeutig ist', async () => {
    const regel = {
      id: 'r1', name: 'Mutter zahlt', beschreibung: null, match_typ: 'verwendungszweck_contains',
      match_wert: 'miete', ziel_kategorie: 'Miete', ziel_mieter_name: 'Beispiel', confidence: 90, aktiv: true,
    };
    const zwei = await fn.getContractContext(client([vertrag('wohnung', 1408, null), vertrag('stellplatz', 50, null)]));
    expect(fn.checkSonderfallRegeln(zahlung(1000, ''), [regel], zwei)).toMatchObject({ selected: false, confidence: 60 });
    expect(fn.checkSonderfallRegeln(zahlung(50, ''), [regel], zwei)).toMatchObject({ mietvertrag_id: 'stellplatz', selected: true, confidence: 90 });
    const keiner = fn.checkSonderfallRegeln(zahlung(50, ''), [{ ...regel, ziel_mieter_name: 'Niemand' }], zwei);
    expect(keiner).toMatchObject({ mietvertrag_id: null, selected: false });
    const ohneZiel = fn.checkSonderfallRegeln(zahlung(50, ''), [{ ...regel, ziel_mieter_name: null, ziel_kategorie: 'Nichtmiete' }], zwei);
    expect(ohneZiel).toMatchObject({ mietvertrag_id: null, selected: true });
  });

  it('erkennt Kautionsraten und Kautionsrückzahlungen, nicht nur die volle Kaution', async () => {
    // 27.10.2026: −1.500 € „Rückzahlung Mietkaution“ wurde Miete und erhöhte den Rückstand um 1.500 €
    const vertraege = await fn.getContractContext(client([{ ...vertrag('wohnung', 1000, KONTO), kaution_betrag: 1500 }]));
    const rueck = fn.matchPaymentByRules({ ...zahlung(-1500), verwendungszweck: 'Rueckzahlung Mietkaution' }, vertraege, []);
    expect(rueck).toMatchObject({ mietvertrag_id: 'wohnung', kategorie: 'Mietkaution' });
    const rate = fn.matchPaymentByRules({ ...zahlung(500), verwendungszweck: 'Mietkaution 1. Rate' }, vertraege, []);
    expect(rate).toMatchObject({ kategorie: 'Mietkaution' });
    // Mehr als die Kaution ist keine Kaution
    expect(fn.matchPaymentByRules({ ...zahlung(2000), verwendungszweck: 'Kaution und Miete' }, vertraege, []).kategorie).toBe('Miete');
  });

  it('bucht eine Abbuchung mit dem Straßennamen eines Objekts nicht als Miete', async () => {
    // 27.10.2026: Handwerkerrechnung −2.000 € mit Straßennamen → Miete beim einzigen Mieter, 75 %
    const haus = { ...vertrag('haus', 800, null), einheiten: { id: 'haus', etage: 'EG', immobilie_id: 'o2', immobilien: { id: 'o2', name: 'Lindenallee', adresse: 'Lindenallee 5, Celle' } } };
    const vertraege = await fn.getContractContext(client([haus]));
    const abbuchung = fn.matchPaymentByRules({ ...zahlung(-2000, ''), verwendungszweck: 'Rechnung Dachrinne Lindenallee 5', empfaengername: 'Dachdecker' }, vertraege, []);
    expect(abbuchung?.kategorie === 'Miete' && abbuchung?.mietvertrag_id === 'haus').toBe(false);
    const eingang = fn.matchPaymentByRules({ ...zahlung(800, ''), verwendungszweck: 'Lindenallee 5', empfaengername: 'X' }, vertraege, []);
    expect(eingang).toMatchObject({ mietvertrag_id: 'haus', kategorie: 'Miete' });
  });

  it('findet Mieter mit Umlaut im Namen, auch wenn die Bank ue oder u schreibt', async () => {
    const mueller = { ...vertrag('m', 700, null), mietvertrag_mieter: [{ mieter: { id: 'm1', vorname: 'Jörg', nachname: 'Müller' } }] };
    const vertraege = await fn.getContractContext(client([mueller]));
    expect(vertraege[0].mieterNamen).toEqual(expect.arrayContaining(['jörg', 'joerg', 'jorg', 'müller', 'mueller', 'muller']));
    expect(fn.matchPaymentByRules({ ...zahlung(650, ''), verwendungszweck: 'MIETE JOERG MUELLER', empfaengername: 'JOERG MUELLER' }, vertraege, []).mietvertrag_id).toBe('m');
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

describe('process-payments Vertragswahl bei Wohnung und Nebenvertrag', () => {
  // 28.10.2026: Ohne passenden Betrag gewann der jüngere Vertrag, bei gleichem Beginn die kleinere id —
  // die Miete landete bei der Garage oder beim Stellplatz mit 0 € Soll, die Garage zeigte ein Guthaben
  const mit = (id: string, kaltmiete: number, aenderung: Record<string, unknown> = {}) => ({ ...vertrag(id, kaltmiete, KONTO), ...aenderung });
  const beideReihenfolgen = async (zeilen: unknown[]) => [
    await fn.getContractContext(client(zeilen)),
    await fn.getContractContext(client([...zeilen].reverse())),
  ];

  it('gibt einem Vertrag ohne Soll keine Zahlung, solange ein anderer eines hat', async () => {
    // Stellplatz mit kleinerer id und gleichem Beginn — früher sein Gewinn
    for (const vertraege of await beideReihenfolgen([mit('a-stellplatz', 0), mit('b-wohnung', 574)])) {
      for (const betrag of [1150, 300, 20, -574]) {
        expect(fn.matchPaymentByRules(zahlung(betrag), vertraege, []).mietvertrag_id).toBe('b-wohnung');
      }
      // 0 € kann auch „Miete noch nicht erfasst“ heißen: vorgeschlagen, aber nur bei passendem Betrag vorausgewählt
      expect(fn.matchPaymentByRules(zahlung(1150), vertraege, [])).toMatchObject({ selected: false });
      expect(fn.matchPaymentByRules(zahlung(576), vertraege, [])).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: true, confidence: 95 });
    }
  });

  it('wählt einen Vertrag ohne Soll auch dann nicht vor, wenn nur er noch läuft', async () => {
    // Review 28.10.2026: Wohnung beendet, Stellplatz aus ihrer Miete läuft weiter — er war der einzige in der Laufzeit
    const zeilen = [
      mit('a-stellplatz', 0),
      mit('b-wohnung', 574, { status: 'beendet', ende_datum: '2026-06-30' }),
    ];
    for (const vertraege of await beideReihenfolgen(zeilen)) {
      expect(fn.matchPaymentByRules(zahlung(300), vertraege, [])).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: false });
    }
  });

  it('wählt ohne passenden Betrag den nächstliegenden Sollbetrag statt des jüngeren Vertrags', async () => {
    const zeilen = [mit('wohnung', 490, { start_datum: '2023-06-01' }), mit('garage', 65, { start_datum: '2026-03-01' })];
    for (const vertraege of await beideReihenfolgen(zeilen)) {
      // Wohnung und Garage in einer Summe, Nachzahlung, Teilzahlung, Rücklastschrift der Wohnungsmiete
      for (const betrag of [555, 295.27, 300, -490]) {
        expect(fn.matchPaymentByRules(zahlung(betrag), vertraege, [])).toMatchObject({ mietvertrag_id: 'wohnung', selected: false });
      }
      expect(fn.matchPaymentByRules(zahlung(100), vertraege, [])).toMatchObject({ mietvertrag_id: 'garage', selected: false });
      // Passt der Betrag, entscheidet er wie bisher
      expect(fn.matchPaymentByRules(zahlung(65), vertraege, [])).toMatchObject({ mietvertrag_id: 'garage', selected: true });
    }
  });

  it('zieht einen gekündigten, noch laufenden Vertrag mit passenderem Soll der aktiven Garage vor', async () => {
    for (const vertraege of await beideReihenfolgen([mit('wohnung', 1095, { status: 'gekuendigt' }), mit('garage', 35)])) {
      expect(fn.matchPaymentByRules(zahlung(1000), vertraege, [])).toMatchObject({ mietvertrag_id: 'wohnung', selected: false });
    }
  });

  it('löst auch den Namensabgleich ohne IBAN nicht zugunsten des Vertrags ohne Soll auf', async () => {
    const ohneKonto = (id: string, kaltmiete: number) => vertrag(id, kaltmiete, null);
    for (const vertraege of await beideReihenfolgen([ohneKonto('a-stellplatz', 0), ohneKonto('b-wohnung', 574)])) {
      const z = { ...zahlung(1000, ''), verwendungszweck: 'Miete Anna Beispiel', empfaengername: 'Anna Beispiel' };
      expect(fn.matchPaymentByRules(z, vertraege, [])).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: false });
    }
  });
});

describe('process-payments Jobcenter-Abgleich', () => {
  it('wählt einen nur ähnlichen Namen nicht vor und lässt die Laufzeit nicht über die Namensgüte entscheiden', () => {
    // 27.10.2026
    expect(quelle).toMatch(/const nurUnscharf = bestMatch\.exactMatchCount === 0;/);
    expect(quelle).toMatch(/selected: !nurUnscharf/);
    expect(quelle).toMatch(/m\.exactMatchCount === besteExakt && isPaymentInContractPeriod/);
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

  it('zählt gleiche Zeilen eines Uploads gegen den Bestand, statt die zweite zu streichen', () => {
    // 27.10.2026: Die zweite von zwei gleichen Überweisungen fiel als „Intra-Batch-Duplikat“ weg
    expect(fn.teileNachBestand(['z1', 'z2'], [])).toEqual([{ item: 'z1', existingId: null }, { item: 'z2', existingId: null }]);
    expect(fn.teileNachBestand(['z1', 'z2'], ['alt'])).toEqual([{ item: 'z1', existingId: 'alt' }, { item: 'z2', existingId: null }]);
    expect(fn.teileNachBestand(['z1'], ['alt1', 'alt2'])).toEqual([{ item: 'z1', existingId: 'alt1' }]);
    expect(quelle).not.toMatch(/zuordnungsgrund: "Intra-Batch-Duplikat"/);
    expect(handler).toMatch(/teileNachBestand\(gruppen\.get\(hash\)/);
  });

  it('vergibt jede Bestandsbuchung nur einmal, Treffer am selben Tag zuerst', () => {
    // Review 27.10.2026: Über die ±5-Tage-Suche deckte eine Bestandsbuchung zwei Gruppen
    expect(handler).toMatch(/\[\.\.\.bestandsTreffer\]\.sort\(\(a, b\) => a\.stufe - b\.stufe\)/);
    expect(handler).toMatch(/const frei = treffer\.filter\(\(id\) => !vergeben\.has\(id\)\);/);
    expect(handler).toMatch(/stufe = 3;/);
  });

  it('schreibt nie selbst in zahlungen', () => {
    // Der frühere Schreibpfad (dryRun: false) hängte jede Buchung mit gleichem Tag, Betrag und IBAN um
    expect(handler).toMatch(/if \(dryRun !== true\)[\s\S]{0,200}status: 400/);
    expect(quelle).not.toMatch(/from\("zahlungen"\)\s*\.update/);
  });
});
