/**
 * Erzeugt echte PDFs und prüft, was drinsteht.
 *
 * jsPDF läuft auch in Node. `loadLogo` scheitert dort am fehlenden fetch und
 * liefert null — der Generator kommt damit klar, das Layout rutscht nur um die
 * Logohöhe nach oben.
 *
 * Setze PDF_OUT auf ein Verzeichnis, um die erzeugten PDFs zum Ansehen
 * abzulegen: `PDF_OUT=/tmp/pdf npx vitest run pdfSmoke`
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateMietvertragPdf } from './mietvertragPdfGenerator';
import {
  generateGewerbeVertragPdf,
  generateNebenvertragPdf,
} from './nebenvertragPdfGenerator';
import type { GewerbeDaten } from './gewerbeKlauseln';
import type { NebenvertragDaten } from './nebenvertraege';
import type { MietvertragDaten } from './typen';

const AUSGABE = process.env.PDF_OUT;

function ablegen(name: string, bytes: Uint8Array): void {
  if (!AUSGABE) return;
  if (!existsSync(AUSGABE)) mkdirSync(AUSGABE, { recursive: true });
  writeFileSync(join(AUSGABE, name), bytes);
}

async function bytesVon(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * jsPDF komprimiert die Content-Streams nicht, wenn nichts anderes gesetzt ist.
 * Der Text lässt sich deshalb direkt aus dem PDF lesen — dasselbe Vorgehen wie
 * in uebergabePdfGenerator.test.ts.
 */
/**
 * jsPDF schreibt die Standardschriften in WinAnsiEncoding. Die Plätze 0x80
 * bis 0x9F weichen dort von latin1 ab — dort liegen unter anderem €, die
 * Gedankenstriche und die deutschen Anführungszeichen. Ohne diese Umsetzung
 * fielen genau die Zeichen aus der Prüfung heraus, bei denen ein Fehler am
 * ehesten unbemerkt bliebe.
 */
const WINANSI_HOCH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '\u2018', 0x92: '\u2019', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function ausWinAnsi(s: string): string {
  return s.replace(/[\u0080-\u009f]/g, z => WINANSI_HOCH[z.charCodeAt(0)] ?? z);
}

function textAusPdf(bytes: Uint8Array): string {
  const roh = Buffer.from(bytes).toString('latin1');
  const stuecke: string[] = [];
  const muster = /\((?:\\.|[^\\()])*\)/g;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(roh)) !== null) {
    stuecke.push(
      treffer[0]
        .slice(1, -1)
        .replace(/\\(\d{3})/g, (_, oktal) => String.fromCharCode(parseInt(oktal, 8)))
        .replace(/\\([()\\])/g, '$1')
    );
  }
  return ausWinAnsi(stuecke.join(' '));
}

function seitenzahl(bytes: Uint8Array): number {
  const roh = Buffer.from(bytes).toString('latin1');
  return (roh.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

const VERMIETER: MietvertragDaten['vermieter'] = {
  firmenname: 'NiImmo Wohnungsbaugesellschaft mbH',
  rechtsform: 'GmbH',
  strasse: 'Egestorffstrasse',
  hausnummer: '11',
  plz: '31319',
  ort: 'Sehnde',
  vertretenDurch: ['Ayhan Yeyrek', 'Dennis Mikyas'],
  vertretungArt: 'gesamt',
  registergericht: 'Amtsgericht Hildesheim',
  handelsregister: 'HRB 208111',
  steuernummer: '16/204/50864',
  ustId: null,
  telefon: '05138 - 600 72 72',
  fax: null,
  email: 'mikyas@niimmo.de',
  mietIban: 'DE76255914133155410541',
  mietBic: 'GENODEF1BCK',
  kautionIban: 'DE89255914133155410501',
  kautionBic: 'GENODEF1BCK',
  stammdatenGeprueft: true,
};

const MIETER: MietvertragDaten['mieter'] = [
  {
    anrede: 'Herr',
    vorname: 'Michael',
    nachname: 'Mustermann',
    istUnternehmen: false,
    firmenname: null,
    vertretenDurch: null,
    strasse: 'Levester Strasse',
    hausnummer: '6',
    plz: '30989',
    ort: 'Gehrden',
    geburtsdatum: '1985-04-12',
    telefon: '0151 23456789',
    email: 'michael@example.de',
  },
  {
    anrede: 'Frau',
    vorname: 'Erika',
    nachname: 'Mustermann',
    istUnternehmen: false,
    firmenname: null,
    vertretenDurch: null,
    strasse: 'Levester Strasse',
    hausnummer: '6',
    plz: '30989',
    ort: 'Gehrden',
    geburtsdatum: '1987-09-30',
    telefon: null,
    email: null,
  },
];

const WOHNRAUM: MietvertragDaten = {
  vertragsart: 'wohnraum',
  vermieter: VERMIETER,
  mieter: MIETER,
  objekt: {
    strasse: 'Levester Strasse',
    hausnummer: '6',
    plz: '30989',
    ort: 'Gehrden',
    ortsteil: null,
    istAngespannt: false,
    heizungsart: 'zentral',
    heizkostenSchluessel: '70/30',
    energieausweisTyp: 'verbrauch',
    energieKennwert: 118.5,
    energietraeger: 'Erdgas',
    energieausweisGueltigBis: '2031-05-01',
    energieeffizienzklasse: 'D',
  },
  einheit: {
    bezeichnung: 'WE 12',
    lage: 'Haus rechts, Dachgeschoss rechts',
    wohnflaecheQm: 63,
    anzahlZimmer: 3.5,
    raumaufstellung: '3,5 Zimmer, 1 Kueche, 1 Badezimmer, 1 Gaeste-WC',
    nebenraeume: 'Kellerraum Nr. 12, Bodenraum',
    einbaukueche: true,
  },
  nebenobjekte: [{ bezeichnung: 'Stellplatz Nr. 4', lage: 'Aussenstellplatz', teilmiete: 25 }],
  mietbeginn: '2026-09-01',
  vertragsende: null,
  befristungsgrund: null,
  befristungsgrundText: null,
  kuendigungsverzichtBis: null,
  uebergabeDatum: '2026-08-30',
  kaltmiete: 429,
  betriebskostenModus: 'vorauszahlung',
  betriebskostenVorauszahlung: 90,
  heizkostenVorauszahlung: 60,
  betriebskostenPositionen: [
    { nummer: '2.1', bezeichnung: 'Grundsteuer', umgelegt: true, schluessel: 'qm', betrag: null },
    { nummer: '2.2', bezeichnung: 'Kosten der Wasserversorgung', umgelegt: true, schluessel: 'verbrauch', betrag: null },
    { nummer: '2.8', bezeichnung: 'Strassenreinigung und Muellbeseitigung', umgelegt: true, schluessel: 'qm', betrag: null },
    { nummer: '2.10', bezeichnung: 'Gartenpflege', umgelegt: true, schluessel: 'qm', betrag: null },
    { nummer: '2.13', bezeichnung: 'Sach- und Haftpflichtversicherung', umgelegt: true, schluessel: 'qm', betrag: null },
    { nummer: '2.7', bezeichnung: 'Aufzug', umgelegt: false, schluessel: 'qm', betrag: null },
  ],
  abrechnungszeitraum: 'das Kalenderjahr',
  kautionBetrag: 1287,
  kautionArt: 'barkaution',
  kautionRaten: 3,
  faelligkeitWerktag: 3,
  lastschrift: true,
  lastschriftKontoinhaber: 'Michael Mustermann',
  lastschriftIban: 'DE02120300000000202051',
  lastschriftBic: 'BYLADEM1001',
  sepaMandatsreferenz: 'NI-WE12-2026',
  mietanpassungArt: 'keine',
  staffelplan: null,
  indexBasisWert: null,
  indexBasisMonat: null,
  anzahlPersonen: 2,
  schluessel: [
    { art: 'Haustuerschluessel', anzahl: 2 },
    { art: 'Wohnungsschluessel', anzahl: 2 },
    { art: 'Briefkastenschluessel', anzahl: 1 },
  ],
  schliessanlageArt: 'einzel',
  mitbenutzungEinrichtungen: 'Waschkeller, Trockenraum, Fahrradkeller',
  uebergabezustand: 'renoviert',
  schoenheitsreparaturen: true,
  kleinreparaturEinzelgrenze: 100,
  kleinreparaturJahresgrenzeProzent: 8,
  vormieteNetto: null,
  vormieteBis: null,
  mietpreisbremseAuskunftAm: null,
  besichtigtAm: '2026-07-15',
  zusatzvereinbarungen: 'Der Mieter darf den Gartenanteil hinter dem Haus mitbenutzen.',
  vertragsdatum: '2026-08-21',
  unterschriftOrt: 'Sehnde',
  anlagen: {
    hausordnung: true,
    betrkvKatalog: true,
    widerrufsbelehrung: true,
    datenschutzhinweis: true,
    mietspiegelEinwilligung: true,
  },
};

describe('PDF-Erzeugung', () => {
  it('erzeugt einen vollständigen Wohnraumvertrag', async () => {
    const bytes = await bytesVon(await generateMietvertragPdf(WOHNRAUM));
    ablegen('mietvertrag-wohnraum.pdf', bytes);

    expect(bytes.length).toBeGreaterThan(10_000);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');

    const t = textAusPdf(bytes);
    expect(t).toContain('Mietvertrag');
    expect(t).toContain('NiImmo Wohnungsbaugesellschaft mbH');
    expect(t).toContain('Michael Mustermann');
    expect(t).toContain('Erika Mustermann');
    expect(t).toContain('WE 12');
    // Beide Mieter -> § 23 muss vorhanden sein
    expect(t).toContain('Mehrere Mieter');
    // Anlagen
    expect(t).toContain('Hausordnung');
    expect(t).toContain('Datenschutzinformation');
    expect(t).toContain('Betriebskostenkatalog');
    // Besichtigt -> keine Widerrufsbelehrung
    expect(t).not.toContain('Widerrufsbelehrung');

    // Ein Wohnraumvertrag mit allen Anlagen hat mehrere Seiten
    expect(seitenzahl(bytes)).toBeGreaterThanOrEqual(6);
  });

  it('folgt dem Aufbau der Word-Hausvorlage', async () => {
    const t = textAusPdf(await bytesVon(await generateMietvertragPdf(WOHNRAUM)));

    // Schlichter Titel, kein Briefkopf
    expect(t).toMatch(/^\s*Mietvertrag\b/);
    expect(t).not.toContain('Mietvertrag über Wohnraum');
    expect(t).not.toContain('Gruppe');

    // Rubrum wie im Original
    expect(t).toContain('Firma');
    expect(t).toContain('als Vermieter');
    expect(t).toContain('als Mieter');
    expect(t).not.toContain('nachfolgend Vermieter');
    expect(t).toContain('Vor- und Zuname');
    expect(t).toContain('Zur Zeit wohnhaft in');
    expect(t).toContain('wird folgender Mietvertrag vereinbart');

    // Unterschriftsblock mit Ort/Datum je Partei
    expect(t).toContain('(Ort, Datum)');
  });

  it('paginiert und nummeriert die Seiten', async () => {
    const bytes = await bytesVon(await generateMietvertragPdf(WOHNRAUM));
    const t = textAusPdf(bytes);
    const gesamt = seitenzahl(bytes);
    expect(t).toContain(`Seite 1 von ${gesamt}`);
    expect(t).toContain(`Seite ${gesamt} von ${gesamt}`);
  });

  it('druckt bei unrenovierter Übergabe keine Schönheitsreparaturpflicht', async () => {
    const daten: MietvertragDaten = {
      ...WOHNRAUM,
      uebergabezustand: 'unrenoviert',
      schoenheitsreparaturen: false,
    };
    const t = textAusPdf(await bytesVon(await generateMietvertragPdf(daten)));
    expect(t).toContain('verbleiben deshalb beim Vermieter');
    expect(t).not.toContain('Der Mieter fuehrt die Schoenheitsreparaturen');
  });

  it('erzeugt einen Gewerbevertrag', async () => {
    const gewerbe: GewerbeDaten = {
      vermieter: VERMIETER,
      mieter: [
        {
          anrede: 'Firma',
          vorname: '',
          nachname: '',
          istUnternehmen: true,
          firmenname: 'Muster Sports GmbH',
          vertretenDurch: 'Max Muster',
          strasse: 'Industriestrasse',
          hausnummer: '4',
          plz: '30926',
          ort: 'Seelze',
          geburtsdatum: null,
          telefon: null,
          email: null,
        },
      ],
      objekt: WOHNRAUM.objekt,
      flaechen: [
        { bezeichnung: 'Halle EG', qm: 150 },
        { bezeichnung: 'Buero OG', qm: 41 },
      ],
      mietzweck: 'Betrieb eines Fitnessstudios',
      betriebspflicht: true,
      konkurrenzschutz: false,
      mietbeginn: '2026-09-01',
      festmietzeitMonate: 60,
      optionen: { anzahl: 2, dauerMonate: 36 },
      nettokaltmiete: 2400,
      umsatzsteuerpflichtig: true,
      umsatzsteuersatz: 19,
      nebenkostenVorauszahlungNetto: 382,
      kaution: 8568,
      kautionArt: 'buergschaft',
      indexklausel: true,
      indexSchwelleProzent: 5,
      indexBasisWert: 119.4,
      indexBasisMonat: '2026-08-01',
      instandhaltungEinzelgrenze: 250,
      instandhaltungJahresgrenze: 2000,
      schoenheitsreparaturen: true,
      gerichtsstand: 'Hannover',
      zusatzvereinbarungen: null,
      vertragsdatum: '2026-08-21',
      unterschriftOrt: 'Sehnde',
    };

    const bytes = await bytesVon(await generateGewerbeVertragPdf(gewerbe));
    ablegen('mietvertrag-gewerbe.pdf', bytes);

    const t = textAusPdf(bytes);
    expect(t).toContain('Gewerbemietvertrag');
    expect(t).toContain('Muster Sports GmbH');
    expect(t).toContain('Fitnessstudios');
    expect(seitenzahl(bytes)).toBeGreaterThanOrEqual(3);
  });

  it('erzeugt Stellplatz- und Küchenvertrag', async () => {
    const basis: NebenvertragDaten = {
      vermieter: VERMIETER,
      mieter: [MIETER[0]],
      objekt: { strasse: 'Liebigstrasse', hausnummer: '12', plz: '30851', ort: 'Langenhagen' },
      bezeichnung: 'einen Aussenstellplatz Nr. 4',
      beginn: '2026-09-01',
      miete: 50,
      vertragsdatum: '2026-08-21',
      unterschriftOrt: 'Sehnde',
    };

    const stellplatz = await bytesVon(await generateNebenvertragPdf('stellplatz', basis));
    ablegen('vertrag-stellplatz.pdf', stellplatz);
    const ts = textAusPdf(stellplatz);
    expect(ts).toContain('Stellplatz-Mietvertrag');
    expect(ts).toContain('Aussenstellplatz Nr. 4');

    const kueche = await bytesVon(
      await generateNebenvertragPdf('kueche', {
        ...basis,
        bezeichnung: 'Einbaukueche mit Herd, Backofen und Kuehlschrank',
        wohnungBezug: 'WE 12, Liebigstrasse 12, 30851 Langenhagen',
      })
    );
    ablegen('vertrag-kueche.pdf', kueche);
    const tk = textAusPdf(kueche);
    expect(tk).toContain('Nutzungsvereinbarung');
    expect(tk).toContain('Verleiher');
    expect(tk).toContain('Entleiher');
  });
});
