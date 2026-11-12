/**
 * Seitenbild nach der Word-Vorlage (04.11.2026): Schrift, Umbrüche, Konten,
 * Titel der Vertreter und die Verteilerschlüssel je Kostenart am Objekt.
 * Der PDF-Test bettet Carlito aus public/fonts ein und liest den Text mit
 * pdf.js zurück — so wie ihn der Mieter kopieren würde.
 */
import { readFileSync } from 'node:fs';
import jsPDF from 'jspdf';
import { describe, expect, it } from 'vitest';

import { kreditinstitut } from '../pdf/briefLayout';
import type { Anlage } from './anlagen';
import { anlageRendern, generateMietvertragPdf, paragraphRendern } from './mietvertragPdfGenerator';
import type { MietvertragDaten } from './typen';
import { ausgezeichneteWoerter, fett, ohneAuszeichnung, OBEN, UNTEN, schuetzeUmbrueche, vertragsLayout } from './vertragsLayout';
import type { Absatz } from './wohnraumKlauseln';
import { geaenderteSchluessel, schluesselJeKategorie } from './verteilerschluesselObjekt';
import { vertreterMitTitel, vertreterTeile } from './vertretung';

const NBSP = '\u00a0';

describe('Fett im Absatz (IBAN, Besprechung 12.11.2026)', () => {
  it('bindet eine fette IBAN wie eine normale und behält die Auszeichnung', () => {
    const text = schuetzeUmbrueche(`Konto: ${fett('IBAN DE08 2559 1413 3155 4105 04')}, BIC GENODEF1BCK`);
    expect(ohneAuszeichnung(text)).toBe(`Konto: IBAN${NBSP}DE08${NBSP}2559${NBSP}1413${NBSP}3155${NBSP}4105${NBSP}04, BIC${NBSP}GENODEF1BCK`);
    const woerter = ausgezeichneteWoerter(text, false);
    // Die gebundene IBAN ist ein Wort: fett bis zur letzten Gruppe, das Komma wieder normal
    const iban = woerter.find(w => w.some(s => s.text.includes('DE08')))!;
    expect(iban).toEqual([
      { text: `IBAN${NBSP}DE08${NBSP}2559${NBSP}1413${NBSP}3155${NBSP}4105${NBSP}04`, fett: true },
      { text: ',', fett: false },
    ]);
    expect(woerter[0]).toEqual([{ text: 'Konto:', fett: false }]);
  });

  it('trägt die Auszeichnung über Wortgrenzen und kehrt zur Grundschrift zurück', () => {
    expect(ausgezeichneteWoerter(`a ${fett('b c')} d`, false).map(w => w.map(s => `${s.text}${s.fett ? '*' : ''}`).join(''))).toEqual([
      'a',
      'b*',
      'c*',
      'd',
    ]);
    // In einem fetten Absatz bleibt nach der Auszeichnung fett
    expect(ausgezeichneteWoerter(`a ${fett('b')} c`, true).every(w => w.every(s => s.fett))).toBe(true);
  });

  it('setzt die IBAN im PDF fett und bricht den Absatz nicht über den Rand', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const layout = vertragsLayout(doc, { schrift: null, logo: null });
    const lang = `Die Zahlung erfolgt an: NiImmo Wohnungsbaugesellschaft mbH, ${fett('IBAN DE76 2559 1413 3155 4105 41')}, BIC GENODEF1BCK, Volksbank in Schaumburg und Nienburg eG. Als Verwendungszweck sind die Wohnung und der Name des Mieters anzugeben.`;
    const ohne = ohneAuszeichnung(lang);
    // Fett ist breiter — höchstens eine Zeile mehr als ohne Auszeichnung
    const hoeheMit = layout.absatzHoehe(lang, { nummer: '3.' });
    const hoeheOhne = layout.absatzHoehe(ohne, { nummer: '3.' });
    expect(hoeheMit).toBeGreaterThanOrEqual(hoeheOhne);
    expect(hoeheMit - hoeheOhne).toBeLessThan(5);
    const y = layout.absatz(lang, OBEN, { nummer: '3.' });
    expect(y).toBeCloseTo(OBEN + hoeheMit, 5);
    const roh = doc.output();
    expect(roh).toContain('Helvetica-Bold');
    expect(roh).not.toMatch(/\ue000|\ue001/);
  });
});

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
    // Ein kurzes Wort hinter einer IBAN mit voller letzter Gruppe gehört nicht dazu (QA 05.11.2026)
    expect(schuetzeUmbrueche('AT61 1904 3002 3457 3201 UND Co')).toBe(`AT61${NBSP}1904${NBSP}3002${NBSP}3457${NBSP}3201 UND Co`);
    // Zwei IBANs hintereinander werden beide gebunden, aber nicht aneinander
    expect(schuetzeUmbrueche('DE08 2559 1413 3155 4105 04 DE89 2559 1413 3155 4105 01')).toBe(
      `DE08${NBSP}2559${NBSP}1413${NBSP}3155${NBSP}4105${NBSP}04 DE89${NBSP}2559${NBSP}1413${NBSP}3155${NBSP}4105${NBSP}01`
    );
    // Eine IBAN mit falscher Prüfziffer bleibt trennbar, statt ein Wort zu verschlucken
    expect(schuetzeUmbrueche('DE89 2559 1413 3155 4105 02 BIC')).toBe('DE89 2559 1413 3155 4105 02 BIC');
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
    expect(vertreterMitTitel('Ayhan Yeyrek (M. Sc.)')).toBe('Ayhan Yeyrek, M. Sc.');
    expect(vertreterMitTitel('Denis Mikyas')).toBe('Denis Mikyas');
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

  it('sperrt Kostenarten, die am Objekt nicht umlagefähig sind, und kündigt das Anlegen an (Review 05.11.2026)', () => {
    const zeilen = schluesselJeKategorie([{ ...art('a1', 'Hauswart', 'gleich'), ist_umlagefaehig: false }]);
    const hauswart = zeilen.find(z => z.kategorie.id === 'hauswart')!;
    expect(hauswart).toMatchObject({ umlagefaehig: false, artIds: [], wirdAngelegt: false });
    // Eine Wahl dort würde nirgends wirken — sie wird nicht geschrieben
    expect(geaenderteSchluessel(zeilen, { hauswart: 'personen' })).toEqual([]);
    expect(zeilen.find(z => z.kategorie.id === 'aufzug')).toMatchObject({ umlagefaehig: true, wirdAngelegt: true });
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
    expect(text).toContain('vertreten durch Bernd Zweiter, B. Sc.');
    expect(text).not.toContain('Anna Erste');
    expect(text).toMatch(/Vermieter Bernd Zweiter B\. Sc\./);
    expect(text).toContain('Kautionskonto: NiImmo Wohnungsbaugesellschaft mbH, IBAN DE08 2559 1413 3155 4105 04');
    // Anlage 2 ist die Verordnung aus der Kundenvorlage, vollständig bis zur Nummer 17
    expect(text).toContain('Verordnung über die Aufstellung von Betriebskosten');
    expect(text).toContain('17. sonstige Betriebskosten,');
    expect(text).not.toContain('Betriebskostenkatalog');
    expect(text).not.toContain('nach fünf Jahren seit Überlassung');
    expect(text).not.toContain('Vereinbarungen über besondere Einrichtungen');
    // Mit eingebetteter Schrift komprimiert
    expect(roh).toContain('/FlateDecode');
  }, 20_000);

  it('lässt keine Unterschrift allein auf einer Seite und hält das Widerrufsformular zusammen (QA 08.11.2026)', async () => {
    const quelle = readFileSync('src/utils/mietvertrag/hausvorlage.test.ts', 'utf8');
    const anfang = quelle.indexOf('const REFERENZ: MietvertragDaten = {');
    const literal = quelle.slice(quelle.indexOf('{', anfang), quelle.indexOf('\n};', anfang) + 2);
    const referenz = new Function(`return (${literal});`)() as MietvertragDaten;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const b64 = (pfad: string) => readFileSync(pfad).toString('base64');
    const schrift = { regular: b64('public/fonts/Carlito-Regular.ttf'), bold: b64('public/fonts/Carlito-Bold.ttf') };

    // Ohne Besichtigung kommt die Widerrufsbelehrung dazu. Die lange Anschrift schiebt das Formular über die Seitengrenze.
    for (const zusatz of [{}, { telefon: '05138 123456789', email: 'vermietung-und-verwaltung@beispiel-gruppe.example' }]) {
      const d: MietvertragDaten = {
        ...referenz,
        vermieter: { ...referenz.vermieter, ...zusatz },
        besichtigtAm: null,
        anlagen: { ...referenz.anlagen, widerrufsbelehrung: true },
      };
      const blob = await generateMietvertragPdf(d, { schrift, logo: null });
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      const seiten: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const inhalt = await (await doc.getPage(i)).getTextContent();
        seiten.push(inhalt.items.map(x => ('str' in x ? x.str : '')).join(' '));
      }
      seiten.forEach((text, i) => {
        const rest = text.replace(/\(Datum\)|\(Vermieter\)|\(Mieter\)|Seite \d+ von \d+/g, '').trim();
        expect(rest.length, `Seite ${i + 1} enthält nur die Unterschriftszeile`).toBeGreaterThan(40);
      });
      const formular = seiten.find(text => text.includes('3. Muster-Widerrufsformular'));
      expect(formular, 'Anlage 4 fehlt').toBeDefined();
      expect(formular).toContain('Anschrift des/der Verbraucher(s)');
      expect(formular).toMatch(/Datum\s+Unterschrift/);
      expect(formular).toContain('(Vermieter)');
    }
  }, 40_000);

  it('hält den letzten Absatz des Vertrags bei der Unterschrift, wo auch immer die Seitengrenze liegt (Review 08.11.2026)', async () => {
    const quelle = readFileSync('src/utils/mietvertrag/hausvorlage.test.ts', 'utf8');
    const anfang = quelle.indexOf('const REFERENZ: MietvertragDaten = {');
    const literal = quelle.slice(quelle.indexOf('{', anfang), quelle.indexOf('\n};', anfang) + 2);
    const referenz = new Function(`return (${literal});`)() as MietvertragDaten;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Je Schritt rund vier Zeilen mehr: Das Vertragsende wandert so einmal über eine ganze Seite.
    for (let schritt = 0; schritt < 15; schritt++) {
      const d: MietvertragDaten = { ...referenz, zusatzvereinbarungen: 'Zusatz '.repeat(1 + 55 * schritt) };
      const blob = await generateMietvertragPdf(d);
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      const seiten: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const inhalt = await (await doc.getPage(i)).getTextContent();
        seiten.push(inhalt.items.map(x => ('str' in x ? x.str : '')).join(' ').replace(/\s+/g, ' '));
      }
      const unterschrift = seiten.find(text => text.includes('(Ort, Datum)'));
      expect(unterschrift, `Schritt ${schritt}: Unterschrift ohne letzten Absatz`).toContain('An die Stelle der unwirksamen');
    }
  }, 40_000);

  it('wiederholt den Kopf der Kostentabelle auf der Folgeseite (Review 05.11.2026)', async () => {
    const quelle = readFileSync('src/utils/mietvertrag/hausvorlage.test.ts', 'utf8');
    const anfang = quelle.indexOf('const REFERENZ: MietvertragDaten = {');
    const literal = quelle.slice(quelle.indexOf('{', anfang), quelle.indexOf('\n};', anfang) + 2);
    const referenz = new Function(`return (${literal});`)() as MietvertragDaten;
    const weitere = Array.from({ length: 40 }, (_, i) => ({
      nummer: `2.${20 + i}`,
      bezeichnung: 'Sonstige Betriebskosten',
      benennung: `Posten ${i + 1}`,
      umgelegt: true,
      schluessel: 'qm',
      betrag: 0,
    }));
    const d: MietvertragDaten = { ...referenz, betriebskostenPositionen: [...referenz.betriebskostenPositionen, ...weitere] };
    const b64 = (pfad: string) => readFileSync(pfad).toString('base64');
    const text = await textMitPdfJs(
      await generateMietvertragPdf(d, {
        schrift: { regular: b64('public/fonts/Carlito-Regular.ttf'), bold: b64('public/fonts/Carlito-Bold.ttf') },
        logo: null,
      })
    );
    expect(text.match(/Vorauszahlung Verteilung EUR monatlich/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Summe der monatlichen Vorauszahlung');
  }, 20_000);
});

describe('Was vor einer Unterschrift steht, bleibt bei ihr (Review 08.11.2026)', () => {
  const RESERVE = 30;
  const TEXT = 'Wort '.repeat(60).trim();
  const neu = () => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    return { doc, layout: vertragsLayout(doc, { schrift: null, logo: null }) };
  };

  it.each<[string, Absatz[], boolean]>([
    ['einziger Absatz', [{ text: TEXT }], true],
    ['einziger Absatz mit Leerzeile dahinter', [{ text: TEXT }, { text: '' }], true],
    ['mehrere Absätze mit Leerzeile dahinter', [{ text: TEXT }, { text: TEXT }, { text: '' }], false],
  ])('Paragraph: %s, an jeder Stelle der Seite', (_name, absaetze, kopfBleibtDabei) => {
    for (let start = OBEN; start < UNTEN; start += 2) {
      const { doc, layout } = neu();
      let kopfSeite = 0;
      const original = layout.ueberschrift;
      layout.ueberschrift = (text, y) => {
        const ergebnis = original(text, y);
        kopfSeite = doc.getNumberOfPages();
        return ergebnis;
      };
      const ende = paragraphRendern(layout, { nummer: '§ 1', titel: 'Titel', absaetze }, start, RESERVE);
      expect(ende + RESERVE, `Start ${start}: Unterschrift passt nicht mehr auf die Seite`).toBeLessThanOrEqual(UNTEN + 0.001);
      if (kopfBleibtDabei) expect(doc.getNumberOfPages(), `Start ${start}: Überschrift abgetrennt`).toBe(kopfSeite);
    }
  });

  it('Anlage: Der Abschnittstitel bleibt beim einzigen Absatz vor der Unterschrift', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (let fuellung = 18; fuellung < 52; fuellung++) {
      const { doc, layout } = neu();
      const anlage: Anlage = {
        kennung: 'Anlage 9',
        titel: 'Prüfanlage',
        unterschrift: true,
        abschnitte: [
          { nummer: '1.', titel: 'Füllung', absaetze: Array.from({ length: fuellung }, () => ({ text: 'Füllzeile' })) },
          { nummer: '2.', titel: 'Schlussabschnitt', absaetze: [{ text: TEXT }] },
        ],
      };
      anlageRendern(doc, layout, anlage);
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise;
      const inhalt = await (await pdf.getPage(pdf.numPages)).getTextContent();
      const text = inhalt.items.map(x => ('str' in x ? x.str : '')).join(' ');
      expect(text, `Füllung ${fuellung}`).toContain('(Vermieter)');
      expect(text, `Füllung ${fuellung}: Titel abgetrennt`).toContain('2. Schlussabschnitt');
    }
  }, 20_000);
});
