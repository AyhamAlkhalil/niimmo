/**
 * Seitenbild nach der Word-Vorlage (04.11.2026): Schrift, Umbrüche, Konten,
 * Titel der Vertreter und die Verteilerschlüssel je Kostenart am Objekt.
 * Der PDF-Test bettet Carlito aus public/fonts ein und liest den Text mit
 * pdf.js zurück — so wie ihn der Mieter kopieren würde.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { kreditinstitut } from '../pdf/briefLayout';
import { generateMietvertragPdf } from './mietvertragPdfGenerator';
import type { MietvertragDaten } from './typen';
import { schuetzeUmbrueche } from './vertragsLayout';
import { geaenderteSchluessel, schluesselJeKategorie } from './verteilerschluesselObjekt';
import { vertreterTeile } from './vertretung';

const NBSP = '\u00a0';

describe('Geschützte Leerzeichen', () => {
  it('hält Betrag und Einheit, Paragraph und Ziffer, IBAN-Gruppen zusammen', () => {
    expect(schuetzeUmbrueche('beträgt 70 %, also 1.200,00 €')).toBe(`beträgt 70${NBSP}%, also 1.200,00${NBSP}€`);
    expect(schuetzeUmbrueche('nach § 573 und §§ 574 bis 574b')).toBe(`nach §${NBSP}573 und §§${NBSP}574 bis 574b`);
    expect(schuetzeUmbrueche('§ 4 Ziff. 1, § 551 Abs. 3, Art. 6 Abs. 1 lit. b')).toBe(
      `§${NBSP}4 Ziff.${NBSP}1, §${NBSP}551 Abs.${NBSP}3, Art.${NBSP}6 Abs.${NBSP}1 lit.${NBSP}b`
    );
    expect(schuetzeUmbrueche('IBAN DE08 2559 1413 3155 4105 04, BIC GENODEF1BCK')).toBe(
      `IBAN${NBSP}DE08${NBSP}2559${NBSP}1413${NBSP}3155${NBSP}4105${NBSP}04, BIC${NBSP}GENODEF1BCK`
    );
    // Normale Wörter bleiben trennbar
    expect(schuetzeUmbrueche('Der Mieter zahlt')).toBe('Der Mieter zahlt');
  });
});

describe('Konten und Vertreter', () => {
  it('kennt das Kreditinstitut der NiImmo-Konten', () => {
    expect(kreditinstitut('DE08 2559 1413 3155 4105 04')).toBe('Volksbank in Schaumburg und Nienburg eG');
    expect(kreditinstitut('DE02120300000000202051')).toBeNull();
    expect(kreditinstitut(null)).toBeNull();
    expect(kreditinstitut('AT611904300234573201')).toBeNull();
  });

  it('trennt den Titel in Klammern vom Namen', () => {
    expect(vertreterTeile('Ayhan Yeyrek (M. Sc.)')).toEqual({ name: 'Ayhan Yeyrek', titel: 'M. Sc.' });
    expect(vertreterTeile(' Denis Mikyas ')).toEqual({ name: 'Denis Mikyas', titel: null });
    expect(vertreterTeile('Denis Mikyas ()')).toEqual({ name: 'Denis Mikyas', titel: null });
    expect(vertreterTeile('(M. Sc.)')).toEqual({ name: '(M. Sc.)', titel: null });
  });
});

describe('Verteilerschlüssel je Kostenart am Objekt', () => {
  const art = (id: string, name: string, schluessel: string | null) => ({
    id,
    name,
    verteilerschluessel_art: schluessel,
    ist_umlagefaehig: true,
  });

  it('zeigt gepflegte Schlüssel und sonst die Kundenvorgabe', () => {
    const zeilen = schluesselJeKategorie([art('a1', 'Wasserversorgung', 'qm'), art('a2', 'Wasser', 'qm')]);
    const wasser = zeilen.find(z => z.kategorie.id === 'wasserversorgung')!;
    expect(wasser).toMatchObject({ schluessel: 'qm', gepflegt: true, vertragsPositionen: ['2.2'] });
    expect(wasser.artIds).toContain('a1');
    const grundsteuer = zeilen.find(z => z.kategorie.id === 'grundsteuer')!;
    expect(grundsteuer).toMatchObject({ schluessel: 'gleich', gepflegt: false, artIds: [] });
    // Sonstige tragen im Vertrag Rauchwarnmelder (2.17) und 2.19
    expect(zeilen.find(z => z.kategorie.id === 'sonstige_betriebskosten')!.vertragsPositionen).toEqual(['2.17', '2.19']);
    expect(zeilen).toHaveLength(17);
  });

  it('schreibt nur, was sich geändert hat', () => {
    const zeilen = schluesselJeKategorie([art('a1', 'Wasserversorgung', 'personen')]);
    expect(geaenderteSchluessel(zeilen, {})).toEqual([]);
    expect(geaenderteSchluessel(zeilen, { wasserversorgung: 'personen', grundsteuer: 'gleich' })).toEqual([]);
    const geaendert = geaenderteSchluessel(zeilen, { wasserversorgung: 'qm', grundsteuer: 'qm' });
    expect(geaendert.map(g => [g.zeile.kategorie.id, g.schluessel])).toEqual([
      ['grundsteuer', 'qm'],
      ['wasserversorgung', 'qm'],
    ]);
  });
});

describe('PDF mit Carlito und Logo', () => {
  async function textMitPdfJs(blob: Blob): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const teile: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const inhalt = await (await doc.getPage(i)).getTextContent();
      teile.push(inhalt.items.map(x => ('str' in x ? x.str : '')).join(' '));
    }
    return teile.join(' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  }

  it('druckt den Vertrag in Carlito mit Titel unter der Unterschrift', async () => {
    const quelle = readFileSync('src/utils/mietvertrag/hausvorlage.test.ts', 'utf8');
    const anfang = quelle.indexOf('const REFERENZ: MietvertragDaten = {');
    const literal = quelle.slice(quelle.indexOf('{', anfang), quelle.indexOf('\n};', anfang) + 2);
    const referenz = new Function(`return (${literal});`)() as MietvertragDaten;
    const d: MietvertragDaten = {
      ...referenz,
      vermieter: {
        ...referenz.vermieter,
        vertretenDurch: ['Anna Erste (M. Sc.)', 'Bernd Zweiter (B. Sc.)'],
        vertretungArt: 'einzel',
        kautionIban: 'DE08255914133155410504',
        kautionBic: 'GENODEF1BCK',
      },
      unterzeichnerVermieter: 'Bernd Zweiter (B. Sc.)',
      mieter: [{ ...referenz.mieter[0], vorname: 'Erika', nachname: 'Musterfrau' }],
    };
    const b64 = (pfad: string) => readFileSync(pfad).toString('base64');
    const blob = await generateMietvertragPdf(d, {
      schrift: { regular: b64('public/fonts/Carlito-Regular.ttf'), bold: b64('public/fonts/Carlito-Bold.ttf') },
      logo: `data:image/png;base64,${b64('public/brief/niimmo-logo.png')}`,
    });
    const roh = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(roh).toContain('/BaseFont /Carlito');
    expect(roh).toMatch(/\/Subtype \/Image/);

    const text = await textMitPdfJs(blob);
    expect(text).toContain('vertreten durch Bernd Zweiter');
    expect(text).not.toContain('Anna Erste');
    expect(text).toMatch(/Vermieter Bernd Zweiter B\. Sc\./);
    expect(text).toContain('Kautionskonto: NiImmo Wohnungsbaugesellschaft mbH, IBAN DE08 2559 1413 3155 4105 04');
    expect(text).not.toContain('nach fünf Jahren seit Überlassung');
    expect(text).not.toContain('Vereinbarungen über besondere Einrichtungen');
  }, 20_000);
});
