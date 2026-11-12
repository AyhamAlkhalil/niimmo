/**
 * Weitere Anlagen am Mietvertrag (Besprechung 12.11.2026): Seiten in der gewählten Reihenfolge hinter dem Vertrag,
 * der Vertrag selbst unverändert; unlesbare Dateien brechen mit ihrem Namen ab.
 */
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { generateMietvertragPdf } from './mietvertragPdfGenerator';
import type { MietvertragDaten } from './typen';

import { anlagenName, verschiebe } from './anlagenListe';
import { anlagenAnhaengen } from './pdfAnlagen';

/** PDF mit Seiten der angegebenen Breiten — die Breite erkennt die Seite wieder. */
async function pdfMit(breiten: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Probe');
  for (const b of breiten) doc.addPage([b, 842]);
  return doc.save();
}

async function breitenVon(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(s => Math.round(s.getWidth()));
}

describe('anlagenAnhaengen', () => {
  it('hängt alle Seiten jeder Anlage in der gewählten Reihenfolge hinter den Vertrag', async () => {
    const vertrag = await pdfMit([595, 595, 595]);
    const ergebnis = await anlagenAnhaengen(vertrag, [
      { titel: 'Grundriss', bytes: await pdfMit([300, 301]) },
      { titel: 'Hausordnung', bytes: await pdfMit([400]) },
    ]);
    expect(await breitenVon(ergebnis)).toEqual([595, 595, 595, 300, 301, 400]);
  });

  it('lässt den Vertrag ohne Anlagen unverändert in Seitenzahl und Titel', async () => {
    const vertrag = await pdfMit([595, 595]);
    const ergebnis = await anlagenAnhaengen(vertrag, []);
    expect(await breitenVon(ergebnis)).toEqual([595, 595]);
    expect((await PDFDocument.load(ergebnis)).getTitle()).toBe('Probe');
  });

  it('liest den Vertrag aus dem Generator samt eingebetteter Schrift', async () => {
    const quelle = readFileSync('src/utils/mietvertrag/hausvorlage.test.ts', 'utf8');
    const anfang = quelle.indexOf('const REFERENZ: MietvertragDaten = {');
    const literal = quelle.slice(quelle.indexOf('{', anfang), quelle.indexOf('\n};', anfang) + 2);
    const referenz = new Function(`return (${literal});`)() as MietvertragDaten;
    const b64 = (pfad: string) => readFileSync(pfad).toString('base64');
    const blob = await generateMietvertragPdf(referenz, {
      schrift: { regular: b64('public/fonts/Carlito-Regular.ttf'), bold: b64('public/fonts/Carlito-Bold.ttf') },
      logo: null,
    });
    const vertrag = new Uint8Array(await blob.arrayBuffer());
    const seitenVertrag = (await PDFDocument.load(vertrag)).getPageCount();
    const ergebnis = await anlagenAnhaengen(vertrag, [{ titel: 'Grundriss', bytes: await pdfMit([300]) }]);
    const breiten = await breitenVon(ergebnis);
    expect(breiten).toHaveLength(seitenVertrag + 1);
    expect(breiten[breiten.length - 1]).toBe(300);
  });

  it('nennt die Anlage, die keine PDF-Datei ist', async () => {
    const vertrag = await pdfMit([595]);
    await expect(
      anlagenAnhaengen(vertrag, [
        { titel: 'Grundriss', bytes: await pdfMit([300]) },
        { titel: 'Foto vom Zähler', bytes: new TextEncoder().encode('kein PDF') },
      ])
    ).rejects.toThrow('„Foto vom Zähler“ ist keine lesbare PDF-Datei');
  });
});

describe('Grenzen', () => {
  it('lehnt zu große Anlagen ab, bevor etwas zusammengefügt wird', async () => {
    const vertrag = await pdfMit([595]);
    const riesig = new Uint8Array(21 * 1024 * 1024);
    await expect(anlagenAnhaengen(vertrag, [{ titel: 'Scan', bytes: riesig }])).rejects.toThrow('„Scan“ ist größer als 20 MB');
  });
});

describe('Reihenfolge und Name', () => {
  it('verschiebt eine Anlage um eine Stelle und bleibt am Rand stehen', () => {
    expect(verschiebe(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(verschiebe(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(verschiebe(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(verschiebe(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(verschiebe(['a'], 5, 1)).toEqual(['a']);
  });

  it('nimmt den Dateinamen ohne Endung als Titel', () => {
    expect(anlagenName('Grundriss EG.PDF')).toBe('Grundriss EG');
    expect(anlagenName('.pdf')).toBe('Anlage');
  });
});
