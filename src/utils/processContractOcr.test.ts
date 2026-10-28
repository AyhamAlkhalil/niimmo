import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * process-contract-ocr bekommt seit 28.10.2026 jede Seite als Bild und bei Text-PDFs die Textebene dazu.
 * Bis dahin schnitt die Function still ab: Bilder über der sechsten, Text über 200.000 Zeichen — und
 * hatte ein PDF eine Textebene, gingen gar keine Bilder an die KI.
 *
 * Deno-Code läuft hier nicht. Der Test schneidet die beteiligten Funktionen aus dem Quelltext,
 * übersetzt sie und führt sie aus (wie processPaymentsIban.test.ts).
 */
const quelle = readFileSync('supabase/functions/process-contract-ocr/index.ts', 'utf-8');

function ausschnitt(kopf: string): string {
  const start = quelle.indexOf(kopf);
  expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
  const ende = quelle.indexOf('\n}\n', start);
  return quelle.slice(start, ende + 3);
}

function konstante(name: string): string {
  const zeile = quelle.split('\n').find(z => z.startsWith(`const ${name}`));
  expect(zeile, `${name} nicht gefunden`).toBeDefined();
  return zeile as string;
}

const code = [
  "type Art = 'mietvertrag' | 'selbstauskunft' | 'vorvertrag';",
  konstante('ARTEN'),
  konstante('MAX_BILDER_ZEICHEN'),
  konstante('MAX_TEXT_ZEICHEN'),
  ausschnitt('function pruefeEingabe('),
  ausschnitt('function baueNutzernachricht('),
].join('\n');

const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fn: any = new Function(`${js}\nreturn { pruefeEingabe, baueNutzernachricht };`)();

const jpeg = (nr: number) => `/9j/${String(nr).padStart(3, '0')}${'A'.repeat(200)}`;

describe('process-contract-ocr nimmt alle Seiten an', () => {
  it('lässt kein Seitenbild weg — früher endete es nach der sechsten Seite', () => {
    const bilder = Array.from({ length: 12 }, (_, i) => jpeg(i + 1));
    const eingabe = fn.pruefeEingabe({ art: 'mietvertrag', textContent: '', fileContents: bilder });
    expect(eingabe.bilder).toEqual(bilder);

    const nachricht = fn.baueNutzernachricht('Bitte lies:', eingabe.textContent, eingabe.bilder);
    const teile = nachricht.content;
    expect(teile).toHaveLength(1 + 2 * 12);
    expect(teile[0].text).toContain('Es folgen 12 Seitenbilder');
    expect(teile.at(-2)).toEqual({ type: 'text', text: 'Seitenbild 12 von 12:' });
    expect(teile.at(-1).image_url.url).toBe(`data:image/jpeg;base64,${jpeg(12)}`);
  });

  it('schickt Textebene und Seitenbilder zusammen', () => {
    const eingabe = fn.pruefeEingabe({
      art: 'vorvertrag',
      textContent: 'Seite 1:\nKaltmiete ______ EUR',
      fileContents: [jpeg(1)],
    });
    expect(eingabe.art).toBe('vorvertrag');

    const [kopf, beschriftung, bild] = fn.baueNutzernachricht('Bitte lies:', eingabe.textContent, eingabe.bilder).content;
    expect(kopf.text).toContain('Es folgen ein Seitenbild');
    expect(kopf.text).toContain('Handschriftliche Einträge');
    expect(kopf.text).toContain('Textebene:\nSeite 1:\nKaltmiete ______ EUR');
    expect(beschriftung.text).toBe('Seitenbild 1 von 1:');
    expect(bild.type).toBe('image_url');
  });

  it('lässt reinen Text (Word) eine einfache Nachricht bleiben', () => {
    const eingabe = fn.pruefeEingabe({ art: 'selbstauskunft', textContent: 'Name: Erika Muster, Einzug sofort' });
    expect(fn.baueNutzernachricht('Bitte lies:', eingabe.textContent, eingabe.bilder)).toEqual({
      role: 'user',
      content: 'Bitte lies:\n\nName: Erika Muster, Einzug sofort',
    });
  });

  it('versteht die ältere Oberfläche mit einzelnem fileContent', () => {
    expect(fn.pruefeEingabe({ fileContent: jpeg(1), textContent: '' })).toEqual({
      art: 'mietvertrag', textContent: '', bilder: [jpeg(1)],
    });
    expect(fn.pruefeEingabe({ fileContent: '', textContent: 'Seite 1:\nMietvertrag zwischen ...' }).bilder).toEqual([]);
  });
});

describe('process-contract-ocr meldet, statt still zu kürzen', () => {
  it('meldet ein ungültiges Bild, statt es wegzulassen', () => {
    expect(fn.pruefeEingabe({ fileContents: [jpeg(1), 'kaputt'] }).fehler).toMatch(/Ungültiges Bildformat/);
    expect(fn.pruefeEingabe({ fileContents: [jpeg(1), `GIF89a${'A'.repeat(200)}`] }).fehler).toMatch(/Ungültiges Bildformat/);
  });

  it('meldet zu große Dokumente mit Seitenzahl', () => {
    const gross = `/9j/${'A'.repeat(7 * 1024 * 1024)}`;
    expect(fn.pruefeEingabe({ fileContents: [gross, gross] }).fehler).toMatch(/Das Dokument \(2 Seiten\) ist zu groß/);
  });

  it('meldet zu viel Text, statt ihn abzuschneiden', () => {
    expect(fn.pruefeEingabe({ textContent: 'x'.repeat(1_000_001) }).fehler).toMatch(/zu viel Text/);
  });

  it('meldet ein Dokument ohne Inhalt', () => {
    expect(fn.pruefeEingabe({ textContent: 'Seite 1:' }).fehler).toMatch(/Kein verwertbarer Inhalt/);
  });
});

describe('process-contract-ocr ruft die KI mit festen Grenzen auf', () => {
  it('nennt das Modell ausdrücklich, lässt Platz fürs Denken und bricht vor dem 504 ab', () => {
    expect(quelle).toContain('model: MODELL,');
    expect(quelle).toContain('max_tokens: MAX_AUSGABE_TOKEN,');
    expect(quelle).toContain('signal: AbortSignal.timeout(KI_ZEITLIMIT_MS)');
    expect(quelle).toContain("finish_reason === 'length'");
    expect(quelle).not.toMatch(/\.slice\(0, MAX_BILDER\)/);
  });
});

// Normalisierung der Art „mietvertrag" (28.10.2026): Bis dahin Number() statt zahl() — „1.250" wurde
// 1,25 € und ein leerer Wert 0, ein nicht erkannter Einzugsstand stand also als 0 im Formular.
const normalisierung = [
  'type Roh = any;',
  ausschnitt('function zahl('),
  ausschnitt('function zaehlerstand('),
  ausschnitt('function datum('),
  ausschnitt('function normalisiereMietvertrag('),
].join('\n');
const normJs = ts.transpileModule(normalisierung, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const norm: any = new Function(`${normJs}\nreturn { normalisiereMietvertrag };`)();

describe('process-contract-ocr liest Beträge des Mietvertrags wie die übrigen Arten', () => {
  it('liest den Tausenderpunkt als Tausenderpunkt', () => {
    const { daten } = norm.normalisiereMietvertrag({ kaltmiete: '1.250', betriebskosten: '180,50', kaution_betrag: '3.750,00' });
    expect(daten.kaltmiete).toBe(1250);
    expect(daten.betriebskosten).toBe(180.5);
    expect(daten.kaution_betrag).toBe(3750);
  });

  it('übernimmt Zahlen unverändert und lässt Leeres leer statt 0', () => {
    const { daten, felder } = norm.normalisiereMietvertrag({ kaltmiete: 820, strom_einzug: '', gas_einzug: null, warmwasser_einzug: 'unleserlich' });
    expect(daten.kaltmiete).toBe(820);
    expect('strom_einzug' in daten).toBe(false);
    expect('gas_einzug' in daten).toBe(false);
    expect('warmwasser_einzug' in daten).toBe(false);
    expect(felder).toBe(1);
  });

  it('liest Zählerstände mit Dezimalpunkt, nicht mit Tausenderpunkt', () => {
    const { daten } = norm.normalisiereMietvertrag({
      warmwasser_einzug: '123.456',
      kaltwasser_einzug: '1.234,5',
      strom_einzug: '',
      gas_einzug: 4711.25,
    });
    expect(daten.warmwasser_einzug).toBe(123.456);
    expect(daten.kaltwasser_einzug).toBe(1234.5);
    expect('strom_einzug' in daten).toBe(false);
    expect(daten.gas_einzug).toBe(4711.25);
  });

  it('übernimmt beim Mieter nur ein echtes ISO-Geburtsdatum', () => {
    const { daten } = norm.normalisiereMietvertrag({
      mieter: [
        { vorname: 'A', nachname: 'B', geburtsdatum: '1980-04-12' },
        { vorname: 'C', nachname: 'D', geburtsdatum: '12.04.1980' },
      ],
    });
    expect(daten.mieter[0].geburtsdatum).toBe('1980-04-12');
    expect(daten.mieter[1].geburtsdatum).toBe('');
  });
});
