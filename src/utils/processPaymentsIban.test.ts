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
  konstante('KI_KONFIDENZ_VORAUSWAHL'),
  ausschnitt('function normalisiereIban('),
  ausschnitt('function levenshteinDistance('),
  ausschnitt('function kiZuordnung('),
  ausschnitt('async function getContractContext('),
  ausschnitt('function ibanSchreibweisen('),
  ausschnitt('async function ladeZahlungsverlauf('),
  ausschnitt('function categorizePaymentType('),
  ausschnitt('function checkSonderfallRegeln('),
  ausschnitt('function namensVarianten('),
  ausschnitt('function istKautionsbuchung('),
  ausschnitt('function teileNachBestand<T>('),
  ausschnitt('function isPaymentInContractPeriod('),
  ausschnitt('function selectBestContractByDate('),
  ausschnitt('function waehleVertrag('),
  ausschnitt('function isBetriebskostenabrechnung('),
  ausschnitt('function kontenVon('),
  ausschnitt('function vertraegeVerbunden('),
  ausschnitt('function nichtIdentifizierendeIbans('),
  ausschnitt('function nenntAnderenMieter('),
  ausschnitt('function matchPaymentByRules('),
  ausschnitt('function matchBGPaymentByName('),
].join('\n');

const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn: any = new Function(
  'console',
  `${js}\nreturn { normalisiereIban, getContractContext, categorizePaymentType, matchPaymentByRules, checkSonderfallRegeln, teileNachBestand, kiZuordnung, ladeZahlungsverlauf, ibanSchreibweisen, nichtIdentifizierendeIbans, matchBGPaymentByName };`,
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

/** Nachgebauter Supabase-Client für getContractContext; merkt sich die Aufrufe der Kette. */
function client(zeilen: unknown[], fehler: { message: string } | null = null) {
  const aufrufe: string[] = [];
  const antwort = { data: fehler ? null : zeilen, error: fehler };
  const kette: Record<string, unknown> = {
    then: (ok: (w: unknown) => unknown, nein: (e: unknown) => unknown) => Promise.resolve(antwort).then(ok, nein),
  };
  for (const methode of ['select', 'in', 'order']) {
    kette[methode] = (spalte: unknown) => {
      aufrufe.push(`${methode}:${typeof spalte === 'string' ? spalte.trim().split(/\s/)[0] : ''}`);
      return kette;
    };
  }
  return { from: () => kette, aufrufe };
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

  // 28.10.2026: Bei vollem Namen auf Wohnung und Garage desselben Mieters entschied die Reihenfolge der
  // Datenbank mit 90 % vorausgewählt; live stand die Garage zuerst
  const BG = 'DE94760000000076001601';
  const bg = (betrag: number) => ({ buchungsdatum: '2026-10-01', betrag, iban: BG, verwendungszweck: 'KDU 10/2026 Anna Beispiel BG-Nr 123', empfaengername: 'Jobcenter' });
  const beideReihenfolgen = async (zeilen: unknown[]) => [
    await fn.getContractContext(client(zeilen)),
    await fn.getContractContext(client([...zeilen].reverse())),
  ];

  it('lässt bei Wohnung und Garage nicht die Datenbank entscheiden und wählt nicht vor', async () => {
    const zeilen = [vertrag('a-garage', 65, null), vertrag('b-wohnung', 490, null)];
    for (const vertraege of await beideReihenfolgen(zeilen)) {
      for (const betrag of [400, 490, 555]) {
        const e = fn.matchBGPaymentByName(bg(betrag), vertraege);
        expect(e).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: false, confidence: 70 });
        expect(e.zuordnungsgrund).toMatch(/1 von 2 Verträgen mit diesem Namen/);
      }
      // Passt der Betrag zur Garage, wird sie vorgeschlagen — aber auch sie nicht vorausgewählt
      expect(fn.matchBGPaymentByName(bg(65), vertraege)).toMatchObject({ mietvertrag_id: 'a-garage', selected: false });
    }
  });

  it('schlägt einen Stellplatz ohne Soll nie vor und zählt gekündigt wie aktiv', async () => {
    for (const vertraege of await beideReihenfolgen([vertrag('a-stellplatz', 0, null), vertrag('b-wohnung', 574, null)])) {
      expect(fn.matchBGPaymentByName(bg(20), vertraege)).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: false });
    }
    for (const vertraege of await beideReihenfolgen([vertrag('a-garage', 65, null), { ...vertrag('b-wohnung', 490, null), status: 'gekuendigt' }])) {
      expect(fn.matchBGPaymentByName(bg(450), vertraege)).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: false });
    }
  });

  it('wählt einen eindeutigen Treffer weiter vor', async () => {
    const vertraege = await fn.getContractContext(client([vertrag('b-wohnung', 490, null), mitMieter(vertrag('x', 500, null), 'm2', 'Max', 'Muster')]));
    expect(fn.matchBGPaymentByName(bg(400), vertraege)).toMatchObject({ mietvertrag_id: 'b-wohnung', selected: true, confidence: 90 });
    // Wohnung beendet und außerhalb der Laufzeit, Garage läuft: die Laufzeit entscheidet wie bisher
    const zeilen = [vertrag('a-garage', 65, null), { ...vertrag('b-wohnung', 490, null), status: 'beendet', ende_datum: '2025-06-30' }];
    for (const v of await beideReihenfolgen(zeilen)) {
      expect(fn.matchBGPaymentByName(bg(65), v)).toMatchObject({ mietvertrag_id: 'a-garage', selected: true });
    }
  });

  it('lädt die Verträge in fester Reihenfolge', async () => {
    const db = client([vertrag('a', 1, null)]);
    await fn.getContractContext(db);
    expect(db.aufrufe).toContain('order:id');
  });
});

describe('process-payments prüft die Antwort der KI', () => {
  // 28.10.2026: Die KI antwortete mit dem Text "null" als Vertrags-ID. Er galt als Vertrag, die Zeile kam
  // vorausgewählt als „Zugeordnet“, das Speichern scheiterte an der UUID (live 37 Buchungen in 4 Importen)
  const ID = '0b6f1c9e-2a3d-4e5f-8a9b-0c1d2e3f4a5b';
  const vertraege = [{ id: ID }];

  it('übernimmt keinen Text "null" und keine unbekannte ID', () => {
    expect(fn.kiZuordnung({ mietvertrag_id: 'null', confidence: 95 }, vertraege)).toEqual({ mietvertrag_id: null, confidence: 95, selected: false, hinweis: '' });
    expect(fn.kiZuordnung({ mietvertrag_id: 'NULL ', confidence: 95 }, vertraege)).toMatchObject({ mietvertrag_id: null, selected: false });
    const erfunden = fn.kiZuordnung({ mietvertrag_id: '0b6f1c9e-2a3d-4e5f-8a9b-000000000000', confidence: 99 }, vertraege);
    expect(erfunden).toMatchObject({ mietvertrag_id: null, selected: false });
    expect(erfunden.hinweis).toMatch(/keinen bekannten Vertrag/);
    expect(fn.kiZuordnung({ mietvertrag_id: null, confidence: 90 }, vertraege)).toMatchObject({ mietvertrag_id: null, selected: false, hinweis: '' });
    expect(fn.kiZuordnung({ confidence: 90 }, vertraege)).toMatchObject({ mietvertrag_id: null, selected: false });
  });

  it('wählt nur einen bekannten Vertrag mit hoher Konfidenz vor', () => {
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 79 }, vertraege)).toMatchObject({ mietvertrag_id: ID, selected: false });
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 80 }, vertraege)).toMatchObject({ mietvertrag_id: ID, selected: true });
    // Groß geschrieben oder mit Leerraum: dieselbe ID, gespeichert wird die aus dem Bestand
    expect(fn.kiZuordnung({ mietvertrag_id: ` ${ID.toUpperCase()} `, confidence: 90 }, vertraege)).toMatchObject({ mietvertrag_id: ID, selected: true });
    // Konfidenz als Text, fehlend oder unsinnig
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: '85' }, vertraege)).toMatchObject({ confidence: 85, selected: true });
    expect(fn.kiZuordnung({ mietvertrag_id: ID }, vertraege)).toMatchObject({ confidence: 0, selected: false });
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 900 }, vertraege)).toMatchObject({ confidence: 100 });
  });

  it('deutet eine Konfidenz unter 1 als Anteil, genau 1 aber nicht als 100 %', () => {
    // Review 28.10.2026: Mit 0.85 statt 85 wäre nie etwas vorausgewählt worden
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 0.85 }, vertraege)).toMatchObject({ confidence: 85, selected: true });
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 0.5 }, vertraege)).toMatchObject({ confidence: 50, selected: false });
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 1 }, vertraege)).toMatchObject({ confidence: 1, selected: false });
    expect(fn.kiZuordnung({ mietvertrag_id: ID, confidence: 0 }, vertraege)).toMatchObject({ confidence: 0, selected: false });
    expect(quelle).toMatch(/description: "Konfidenz der Zuordnung in Prozent, eine Zahl von 0 bis 100/);
  });

  it('nutzt die Prüfung in allen drei KI-Pfaden und verbietet den Text "null" im Schema', () => {
    expect(quelle).not.toMatch(/mietvertrag_id: result\.mietvertrag_id \|\| null/);
    expect(quelle.match(/const ki = kiZuordnung\(result, contracts\);/g)).toHaveLength(3);
    expect(quelle).not.toMatch(/selected: result\.mietvertrag_id \?/);
    expect(quelle).toMatch(/mietvertrag_id: \{\s*type: "string",\s*description: "[^"]*nie den Text \\"null\\"/);
  });
});

/** Vertragszeile mit eigenem Mieter (vertrag() gibt allen denselben). */
function mitMieter(zeile: ReturnType<typeof vertrag>, mieterId: string, vorname: string, nachname: string) {
  return { ...zeile, mietvertrag_mieter: [{ mieter: { id: mieterId, vorname, nachname } }] };
}

const BANKKONTO = 'DE00999988887777666655';

describe('process-payments erkennt Sammel- und Bankkonten', () => {
  // 28.10.2026: Ein Konto der Bank für Retouren und Kautionsüberträge stand als Hauptkonto an einem Vertrag.
  // Jede Buchung von dort ging mit 95 % vorausgewählt an diesen Vertrag, live ein Kautionsübertrag über
  // 3.780 € für einen anderen Mieter. Das Konto hatte vorher für 15 weitere Verträge gezahlt.
  const zeilen = () => [
    mitMieter(vertrag('a', 900, BANKKONTO), 'm1', 'Anna', 'Beispiel'),
    mitMieter(vertrag('b', 700, 'DE00222233334444555566'), 'm2', 'Max', 'Muster'),
    mitMieter(vertrag('c', 650, null), 'm3', 'Erika', 'Probe'),
    // Garage von Anna Beispiel: verbunden mit a
    mitMieter(vertrag('a-garage', 60, null), 'm1', 'Anna', 'Beispiel'),
    // Derselbe Mensch mit zweitem Mieterdatensatz: verbunden über den vollen Namen
    mitMieter(vertrag('a-zweit', 300, null), 'm9', 'Anna', 'Beispiel'),
  ];
  const verlauf = (eintraege: Record<string, string[]>) => new Map(Object.entries(eintraege).map(([iban, ids]) => [iban, new Set(ids)]));

  it('gilt als nicht identifizierend, wenn es für zwei fremde, nicht verbundene Verträge gezahlt hat', async () => {
    const vertraege = await fn.getContractContext(client(zeilen()));
    expect([...fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [BANKKONTO]: ['a', 'b', 'c'] }))]).toEqual([BANKKONTO]);
    expect([...fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [BANKKONTO]: ['b', 'c'] }))]).toEqual([BANKKONTO]);
  });

  it('sperrt ein hinterlegtes Mieterkonto nicht wegen einer einzigen fremden Buchung', async () => {
    // Review 28.10.2026: Eine alte Fehlzuordnung oder ein Angehöriger mit eigenem Datensatz sperrte das
    // richtige Konto für immer. Zwei fremde Verträge, die untereinander verbunden sind, zählen als einer.
    const vertraege = await fn.getContractContext(client(zeilen()));
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [BANKKONTO]: ['a', 'b'] })).size).toBe(0);
    const mitZweitvertrag = await fn.getContractContext(client([...zeilen(), mitMieter(vertrag('b-garage', 40, null), 'm2', 'Max', 'Muster')]));
    expect(fn.nichtIdentifizierendeIbans(mitZweitvertrag, verlauf({ [BANKKONTO]: ['a', 'b', 'b-garage'] })).size).toBe(0);
    // Der IBAN-Abgleich bleibt aktiv; nennt der Text den fremden Mieter, greift der Namenshinweis
    expect(fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete' }, vertraege, [], new Set())).toMatchObject({ mietvertrag_id: 'a', selected: true });
    expect(fn.matchPaymentByRules({ ...zahlung(700, BANKKONTO), verwendungszweck: 'Miete Max Muster' }, vertraege, [], new Set())).toMatchObject({ mietvertrag_id: 'a', selected: false });
  });

  it('lässt das gemeinsame Konto von Ehepartnern mit getrennten Verträgen als Mieterkonto gelten', async () => {
    const GEMEINSAM = 'DE00454545454545454545';
    const vertraege = await fn.getContractContext(client([
      mitMieter(vertrag('mann', 600, GEMEINSAM), 'm1', 'Paul', 'Beispiel'),
      mitMieter(vertrag('frau', 450, 'DE00676767676767676767', `DE99000000000000000000, ${GEMEINSAM}`), 'm2', 'Petra', 'Probe'),
    ]));
    // Konto an beiden Verträgen (bei ihr unter weitere Bankkonten): beide hinterlegt, keiner fremd
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [GEMEINSAM]: ['mann', 'frau'] })).size).toBe(0);
    expect(fn.matchPaymentByRules({ ...zahlung(450, GEMEINSAM), verwendungszweck: 'Miete' }, vertraege, [])).toMatchObject({ mietvertrag_id: 'frau', selected: true });
    // Steht es nur bei ihm und hat einmal für sie gezahlt: ein fremder Vertrag, nicht gesperrt
    const nurBeiIhm = await fn.getContractContext(client([
      mitMieter(vertrag('mann', 600, GEMEINSAM), 'm1', 'Paul', 'Beispiel'),
      mitMieter(vertrag('frau', 450, null), 'm2', 'Petra', 'Probe'),
    ]));
    expect(fn.nichtIdentifizierendeIbans(nurBeiIhm, verlauf({ [GEMEINSAM]: ['mann', 'frau'] })).size).toBe(0);
  });

  it('zählt Wohnung und Garage derselben Mieter nicht als fremd, auch bei zweitem Mieterdatensatz', async () => {
    const vertraege = await fn.getContractContext(client(zeilen()));
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [BANKKONTO]: ['a', 'a-garage', 'a-zweit'] })).size).toBe(0);
  });

  it('überlässt eine IBAN an zwei nicht verbundenen Verträgen der Vertragswahl, solange sie nur für diese zahlte', async () => {
    const vertraege = await fn.getContractContext(client([
      mitMieter(vertrag('a', 900, BANKKONTO), 'm1', 'Anna', 'Beispiel'),
      mitMieter(vertrag('b', 700, BANKKONTO), 'm2', 'Max', 'Muster'),
    ]));
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [BANKKONTO]: ['a', 'b'] })).size).toBe(0);
  });

  it('meldet eine nirgends hinterlegte IBAN, die für zwei nicht verbundene Verträge zahlte (für den Nachtrag)', async () => {
    const vertraege = await fn.getContractContext(client(zeilen()));
    const fremd = 'DE00121212121212121212';
    expect([...fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [fremd]: ['b', 'c'] }))]).toEqual([fremd]);
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [fremd]: ['c'], DE94760000000076001601: ['a', 'b'] })).size).toBe(0);
    // Unbekannte Verträge im Verlauf zählen nicht
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlauf({ [fremd]: ['c', 'geloescht'] })).size).toBe(0);
  });

  it('ordnet eine Buchung von dort nicht mehr über die IBAN zu, sondern über den Namen', async () => {
    const vertraege = await fn.getContractContext(client(zeilen()));
    const uebertrag = { ...zahlung(3780, BANKKONTO), verwendungszweck: 'Kautionsuebertrag Erika Probe', empfaengername: 'Bank' };
    // Ohne Kenntnis des Kontos: IBAN schlägt den Namen, vorausgewählt — der Fehler vom 26.10.2026 …
    expect(fn.matchPaymentByRules({ ...uebertrag, verwendungszweck: 'Kautionsuebertrag' }, vertraege, [])).toMatchObject({ mietvertrag_id: 'a', selected: true });
    // … mit Kenntnis: kein IBAN-Abgleich, der genannte Mieter gewinnt
    const sammel = new Set([BANKKONTO]);
    const ergebnis = fn.matchPaymentByRules(uebertrag, vertraege, [], sammel);
    expect(ergebnis.mietvertrag_id).toBe('c');
    expect(ergebnis.zuordnungsgrund).not.toMatch(/IBAN-Match/);
    expect(fn.matchPaymentByRules({ ...uebertrag, verwendungszweck: 'Kautionsuebertrag' }, vertraege, [], sammel)?.zuordnungsgrund ?? '').not.toMatch(/IBAN-Match/);
  });

  it('wählt einen IBAN-Treffer nicht vor, wenn der Text einen anderen Mieter mit vollem Namen nennt', async () => {
    const vertraege = await fn.getContractContext(client(zeilen()));
    const fuerAndere = fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete 10/2026 MAX MUSTER' }, vertraege, []);
    expect(fuerAndere).toMatchObject({ mietvertrag_id: 'a', selected: false, confidence: 60 });
    expect(fuerAndere.zuordnungsgrund).toMatch(/nennt Max Muster, bitte prüfen/);
    // Nennt er auch den Mieter des IBAN-Vertrags, oder nur einen Vornamen, bleibt es beim IBAN-Treffer
    expect(fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete Anna Beispiel und Max Muster' }, vertraege, [])).toMatchObject({ mietvertrag_id: 'a', selected: true });
    expect(fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete fuer Max' }, vertraege, [])).toMatchObject({ mietvertrag_id: 'a', selected: true });
    // Nachname als Teil eines anderen Wortes ist kein Name
    expect(fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Max Mustervertrag' }, vertraege, [])).toMatchObject({ selected: true });
    // Der Mieter der verbundenen Garage ist kein anderer Mieter
    expect(fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete Anna Beispiel' }, vertraege, [])).toMatchObject({ mietvertrag_id: 'a', selected: true });
  });

  /** Nachgebaute Kette für ladeZahlungsverlauf; liest die Werte aus dem gequoteten in-Filter. */
  function verlaufDb(zeilenDb: Array<{ id: string; iban: string; mietvertrag_id: string }>, fehlschlaege: (block: string[], von: number, versuch: number) => boolean = () => false) {
    const abrufe: Array<{ block: string[]; von: number }> = [];
    const versuche = new Map<string, number>();
    let laufend = 0;
    let hoechstens = 0;
    const db = {
      from: () => ({
        select: () => ({
          filter: (_s: string, op: string, wert: string) => {
            expect(op).toBe('in');
            const block = [...wert.matchAll(/"([^"]*)"/g)].map(m => m[1]);
            return {
              not: () => ({
                order: () => ({
                  range: async (von: number, bis: number) => {
                    laufend++;
                    hoechstens = Math.max(hoechstens, laufend);
                    await new Promise(r => setTimeout(r, 1));
                    laufend--;
                    const schluessel = `${block[0]}|${von}`;
                    const versuch = (versuche.get(schluessel) ?? 0) + 1;
                    versuche.set(schluessel, versuch);
                    if (fehlschlaege(block, von, versuch)) return { data: null, error: { message: 'timeout' } };
                    abrufe.push({ block, von });
                    return { data: zeilenDb.filter(z => block.includes(z.iban)).slice(von, bis + 1), error: null };
                  },
                }),
              }),
            };
          },
        }),
      }),
    };
    return { db, abrufe, hoechstens: () => hoechstens };
  }

  it('lädt den Zahlungsverlauf seitenweise, in IBAN-Blöcken und höchstens vier Blöcke gleichzeitig', async () => {
    const zeilenDb = Array.from({ length: 1500 }, (_, i) => ({ id: `z${String(i).padStart(5, '0')}`, iban: i < 1200 ? 'DE00 1111' : 'DE002222', mietvertrag_id: `v${i % 3}` }));
    const { db, abrufe } = verlaufDb(zeilenDb);
    const ibans = ['DE00 1111', 'DE002222', ...Array.from({ length: 45 }, (_, i) => `DE99${i}`)];
    const verlauf = await fn.ladeZahlungsverlauf(db, ibans, 0);
    expect([...verlauf.get('DE001111')].sort()).toEqual(['v0', 'v1', 'v2']);
    expect(verlauf.get('DE002222').size).toBe(3);
    // Erster Block (30 IBANs) braucht zwei Seiten, der zweite eine
    expect(abrufe.map(a => [a.block.length, a.von]).sort()).toEqual([[17, 0], [30, 0], [30, 1000]]);

    const viele = verlaufDb([]);
    await fn.ladeZahlungsverlauf(viele.db, Array.from({ length: 300 }, (_, i) => `DE${i}`), 0);
    expect(viele.abrufe).toHaveLength(10);
    expect(viele.hoechstens()).toBe(4);
  });

  it('wiederholt eine gescheiterte Seite einmal und wirft erst, wenn auch das scheitert', async () => {
    const zeilenDb = [{ id: 'z1', iban: 'DE001111', mietvertrag_id: 'v1' }];
    const einmal = verlaufDb(zeilenDb, (_b, _v, versuch) => versuch === 1);
    expect([...(await fn.ladeZahlungsverlauf(einmal.db, ['DE001111'], 0)).get('DE001111')]).toEqual(['v1']);
    const immer = verlaufDb(zeilenDb, () => true);
    await expect(fn.ladeZahlungsverlauf(immer.db, ['DE001111'], 0)).rejects.toThrow(/nicht geladen/);
  });

  it('fragt jede gespeicherte Schreibweise einer IBAN ab, nie die Jobcenter-IBAN', () => {
    // Live 28.10.2026: kompakt groß und eine Altzeile mit Zeilenumbruch; manche Banken liefern 4er-Gruppen
    expect(fn.ibanSchreibweisen(' de00 1111 2222 3333 4444 55 ')).toEqual([
      'DE00111122223333444455', 'DE00 1111 2222 3333 4444 55', 'DE00111122223333444455\r\n', 'de00 1111 2222 3333 4444 55',
    ]);
    expect(fn.ibanSchreibweisen('DE00111122223333444455')).toEqual(['DE00111122223333444455', 'DE00 1111 2222 3333 4444 55', 'DE00111122223333444455\r\n']);
    expect(fn.ibanSchreibweisen('DE94 7600 0000 0076 0016 01')).toEqual([]);
    expect(fn.ibanSchreibweisen('DE00"1111')).toEqual([]);
    expect(fn.ibanSchreibweisen(null)).toEqual([]);
  });

  it('arbeitet ohne Sammelkonto-Erkennung weiter, wenn der Verlauf nicht lädt, und sagt es der App', () => {
    const handler = quelle.slice(quelle.indexOf('serve(async (req)'));
    expect(handler).toMatch(/try \{\s*verlauf = await ladeZahlungsverlauf\(supabase, \[\.\.\.new Set\(newPayments\.flatMap\(\(p: Payment\) => ibanSchreibweisen\(p\.iban\)\)\)\]\);\s*\} catch/);
    expect(handler).toMatch(/sammelkontenGeprueft = false;\s*warnungen\.push\(/);
    expect(handler).toMatch(/nicht_identifizierende_ibans: sammelkontenGeprueft \? \[\.\.\.nichtIdentifizierend\] : null,\s*warnungen/);
  });

  it('meldet die Konten an die App und gibt der KI weder Mieter-IDs noch die Konten als Mieterkonto', () => {
    const handler = quelle.slice(quelle.indexOf('serve(async (req)'));
    expect(handler.match(/matchPaymentByRules\(payment, contracts, sonderfallRegeln, nichtIdentifizierend\)/g)).toHaveLength(2);
    expect(handler).toMatch(/k === "mieterPersonen" \? undefined : v/);
    expect(quelle).toMatch(/selected: ki\.selected && !ibanNichtIdentifizierend/);
  });

  it('vergleicht Namen nach Unicode-Normalform, auch zerlegte Umlaute', async () => {
    // Review 28.10.2026: „ü“ als u + Trema gespeichert verfehlte Varianten und Wortvergleich
    const zerlegt = 'Müller';
    const vertraege = await fn.getContractContext(client([
      mitMieter(vertrag('a', 900, BANKKONTO), 'm1', 'Anna', 'Beispiel'),
      mitMieter(vertrag('j', 700, null), 'm2', 'Jörg', zerlegt),
      mitMieter(vertrag('j-zweit', 50, null), 'm3', 'Jörg', 'Müller'),
    ]));
    expect(vertraege.find((v: { id: string }) => v.id === 'j').mieterNamen).toEqual(expect.arrayContaining(['müller', 'mueller']));
    const e = fn.matchPaymentByRules({ ...zahlung(900, BANKKONTO), verwendungszweck: 'Miete JÖRG MÜLLER' }, vertraege, []);
    expect(e).toMatchObject({ mietvertrag_id: 'a', selected: false });
    // Zerlegt und zusammengesetzt gespeichert: derselbe Mensch, also verbunden
    const verlaufJ = new Map([['DE00121212121212121212', new Set(['j', 'j-zweit'])]]);
    expect(fn.nichtIdentifizierendeIbans(vertraege, verlaufJ).size).toBe(0);
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
    await expect(fn.getContractContext(client([], { message: 'timeout' }))).rejects.toThrow(/nicht geladen/);
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
