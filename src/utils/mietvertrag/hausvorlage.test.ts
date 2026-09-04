/**
 * Der Vertrag vom 01.06.2025 als Prüfstein.
 *
 * NiImmo hat diese Word-Datei als Maßstab benannt: Was der Generator ausgibt,
 * muss den Inhalt dieses Vertrags vollständig tragen. Die Daten unten sind die
 * echten Angaben aus der Vorlage — Objekt, Kostenaufstellung, Beträge, Konten.
 *
 * Prüft entlang von vier Fragen:
 *  1. Steht jeder Wert aus der Vorlage im erzeugten Vertrag?
 *  2. Geht die Kostenspalte auf?
 *  3. Ist die Paragraphenfolge lückenlos?
 *  4. Bleiben Sonderzeichen (€, Gedankenstrich, Anführung) erhalten?
 */
import { describe, expect, it } from 'vitest';

import { generateMietvertragPdf } from './mietvertragPdfGenerator';
import { pruefeVertragsdaten, hatBlocker } from './pflichtpruefung';
import { wohnraumParagraphen } from './wohnraumKlauseln';
import type { MietvertragDaten } from './typen';

const WINANSI_HOCH: Record<number, string> = {
  0x80: '\u20ac', 0x84: '\u201e', 0x93: '\u201c', 0x94: '\u201d',
  0x96: '\u2013', 0x97: '\u2014', 0x92: '\u2019', 0x91: '\u2018',
};

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
  return stuecke
    .join(' ')
    .replace(/[\u0080-\u009f]/g, z => WINANSI_HOCH[z.charCodeAt(0)] ?? z);
}

const REFERENZ: MietvertragDaten = {
  vertragsart: 'wohnraum',
  vermieter: {
    firmenname: 'NiImmo Wohnungsbaugesellschaft mbH', rechtsform: 'GmbH',
    strasse: 'Egestorffstraße', hausnummer: '11', plz: '31319', ort: 'Sehnde',
    vertretenDurch: ['Dennis Baris Mikyas'], vertretungArt: 'einzel',
    registergericht: 'Amtsgericht Hildesheim', handelsregister: 'HRB 208151',
    steuernummer: null, ustId: null, telefon: null, fax: null, email: null,
    mietIban: 'DE89255914133155410501', mietBic: 'GENODEF1BCK',
    kautionIban: 'DE02255914133155410515', kautionBic: 'GENODEF1BCK',
    stammdatenGeprueft: true,
  },
  mieter: [
    { anrede: 'Frau', vorname: 'Alexa', nachname: 'Köhler', istUnternehmen: false,
      firmenname: null, vertretenDurch: null, strasse: 'Am Klagesmarkt', hausnummer: '42',
      plz: '30159', ort: 'Hannover', geburtsdatum: null, telefon: null, email: null },
    // Die Word-Vorlage nennt hier nur „Burgkstraße 37 Dresden" — ohne
    // Postleitzahl. Für den Vollständigkeitstest ist sie ergänzt; der Test
    // „weist unvollständige Mieteranschriften zurück" prüft den Originalstand.
    { anrede: 'Herr', vorname: 'Aron', nachname: 'Lenz', istUnternehmen: false,
      firmenname: null, vertretenDurch: null, strasse: 'Burgkstraße', hausnummer: '37',
      plz: '01159', ort: 'Dresden', geburtsdatum: null, telefon: null, email: null },
  ],
  objekt: {
    strasse: 'Liebigstraße', hausnummer: '12', plz: '30851', ort: 'Langenhagen',
    ortsteil: null, istAngespannt: true, heizungsart: 'zentral', heizkostenSchluessel: '70/30',
    energieausweisTyp: null, energieKennwert: null, energietraeger: null,
    energieausweisGueltigBis: null, energieeffizienzklasse: null,
  },
  einheit: {
    bezeichnung: 'WE7', lage: '2. OG rechts', wohnflaecheQm: 86, anzahlZimmer: 4,
    raumaufstellung: '4 Zimmer, 1 Küche, 1 Flur, 1 Badezimmer, 1 Abstellraum, 1 Keller',
    nebenraeume: null, einbaukueche: false,
  },
  nebenobjekte: [],
  mietbeginn: '2025-06-01', vertragsende: null, befristungsgrund: null,
  befristungsgrundText: null, kuendigungsverzichtBis: '2026-05-31', uebergabeDatum: null,
  kaltmiete: 1200, betriebskostenModus: 'vorauszahlung',
  betriebskostenVorauszahlung: 150, heizkostenVorauszahlung: 50,
  betriebskostenPositionen: [
    { nummer: '2.1', bezeichnung: 'laufende öffentliche Lasten des Grundstücks', umgelegt: true, schluessel: 'einheit', betrag: 17 },
    { nummer: '2.2', bezeichnung: 'Kosten der Wasserversorgung', umgelegt: true, schluessel: 'verbrauch', betrag: 19 },
    { nummer: '2.3', bezeichnung: 'Kosten der Entwässerung', umgelegt: true, schluessel: 'qm', betrag: 13 },
    { nummer: '2.4', bezeichnung: 'Kosten des Betriebs & Wartung der Heizungsanlage', umgelegt: true, schluessel: 'einheit', betrag: 3 },
    { nummer: '2.5', bezeichnung: 'Kosten des Betriebs & Wartung der Warmwasserversorgung', umgelegt: true, schluessel: 'einheit', betrag: 3 },
    { nummer: '2.6', bezeichnung: 'Kosten verbundener Heizungs- und Warmwasserversorgungsanlagen', umgelegt: true, schluessel: 'einheit', betrag: 0 },
    { nummer: '2.7', bezeichnung: 'Kosten des Betriebs des Personen- oder Lastenaufzugs', umgelegt: false, schluessel: 'qm', betrag: null },
    { nummer: '2.8', bezeichnung: 'Kosten der Straßenreinigung und Müllbeseitigung', umgelegt: true, schluessel: 'qm', betrag: 14 },
    { nummer: '2.9', bezeichnung: 'Kosten der Gebäudereinigung und Ungezieferbekämpfung', umgelegt: true, schluessel: 'qm', betrag: 22 },
    { nummer: '2.10', bezeichnung: 'Kosten der Gartenpflege', umgelegt: true, schluessel: 'qm', betrag: 14 },
    { nummer: '2.11', bezeichnung: 'Kosten der Beleuchtung', umgelegt: true, schluessel: 'qm', betrag: 3 },
    { nummer: '2.12', bezeichnung: 'Kosten der Schornsteinreinigung', umgelegt: true, schluessel: 'einheit', betrag: 2 },
    { nummer: '2.13', bezeichnung: 'Kosten der Sach- und Haftpflichtversicherung', umgelegt: true, schluessel: 'qm', betrag: 19 },
    { nummer: '2.14', bezeichnung: 'Kosten für den Hauswart', umgelegt: true, schluessel: 'qm', betrag: 16 },
    { nummer: '2.15', bezeichnung: 'Kosten für Antennen-/Kabelanschluss', umgelegt: false, schluessel: 'nutzer', betrag: null },
    { nummer: '2.16', bezeichnung: 'Kosten des Betriebs der Einrichtungen für die Wäschepflege', umgelegt: false, schluessel: 'qm', betrag: null },
    { nummer: '2.17', bezeichnung: 'Kosten des Betriebs der Rauchwarnmeldeeinrichtung', umgelegt: true, schluessel: 'qm', betrag: 0 },
    { nummer: '2.18', bezeichnung: 'Kosten der Abgasmessung', umgelegt: true, schluessel: 'einheit', betrag: 5 },
    { nummer: '2.19', bezeichnung: 'Sonstige Betriebskosten', umgelegt: true, schluessel: 'qm', betrag: 0 },
  ],
  abrechnungszeitraum: 'das laufende Wirtschaftsjahr vom 01.01. bis 31.12.',
  kautionBetrag: 3600, kautionArt: 'barkaution', kautionRaten: 3,
  faelligkeitWerktag: 3, lastschrift: false, lastschriftKontoinhaber: null,
  lastschriftIban: null, lastschriftBic: null, sepaMandatsreferenz: null,
  mietanpassungArt: 'keine', staffelplan: null, indexBasisWert: null, indexBasisMonat: null,
  anzahlPersonen: 2,
  schluessel: [{ art: 'Hauseingangsschlüssel', anzahl: 2 }, { art: 'Wohnungsschlüssel', anzahl: 2 }],
  schliessanlageArt: 'zentral',
  mitbenutzungEinrichtungen: 'Waschkeller, Trockenraum, Fahrradkeller',
  uebergabezustand: 'renoviert', schoenheitsreparaturen: true,
  kleinreparaturEinzelgrenze: 100, kleinreparaturJahresgrenzeProzent: 8,
  vormieteNetto: null, vormieteBis: null, mietpreisbremseAuskunftAm: '2025-05-20',
  besichtigtAm: '2025-05-10',
  zusatzvereinbarungen: 'Mahngebühren, welche bei Zahlungsverzug an den Mieter gerichtet sind, hat dieser auch selbst zu tragen. Zu den Betriebskosten anfallende Wartungen an den Rauchwarnmeldern können ebenfalls auf den Mieter umgelegt werden.',
  vertragsdatum: '2025-05-26', unterschriftOrt: 'Sehnde',
  anlagen: { hausordnung: true, betrkvKatalog: true, widerrufsbelehrung: false,
    datenschutzhinweis: true, mietspiegelEinwilligung: true },
};


async function textDesVertrags(d: MietvertragDaten): Promise<string> {
  const blob = await generateMietvertragPdf(d);
  return textAusPdf(new Uint8Array(await blob.arrayBuffer()));
}

describe('Hausvorlage 01.06.2025', () => {
  it('erzeugt den Vertrag ohne Blocker', () => {
    const befunde = pruefeVertragsdaten(REFERENZ);
    expect(befunde.filter(f => f.schwere === 'blocker')).toEqual([]);
    expect(hatBlocker(befunde)).toBe(false);
  });

  it('weist unvollständige Mieteranschriften zurück', () => {
    // Genau der Stand der Word-Vorlage: zweiter Mieter ohne Postleitzahl.
    const wieVorlage: MietvertragDaten = {
      ...REFERENZ,
      mieter: [REFERENZ.mieter[0], { ...REFERENZ.mieter[1], plz: '' }],
    };
    const befunde = pruefeVertragsdaten(wieVorlage);
    expect(hatBlocker(befunde)).toBe(true);
    expect(befunde.some(f => f.feld === 'mieter[1].adresse')).toBe(true);
  });

  it('trägt alle Angaben der Vorlage', async () => {
    const t = await textDesVertrags(REFERENZ);

    // Rubrum
    expect(t).toContain('NiImmo Wohnungsbaugesellschaft mbH');
    expect(t).toContain('Dennis Baris Mikyas');
    expect(t).toContain('Alexa K\u00f6hler');
    expect(t).toContain('Aron Lenz');
    expect(t).toContain('Am Klagesmarkt 42, 30159 Hannover');

    // Mietgegenstand
    expect(t).toContain('Liebigstra\u00dfe 12, 30851 Langenhagen');
    expect(t).toContain('4 Zimmer, 1 K\u00fcche, 1 Flur, 1 Badezimmer, 1 Abstellraum, 1 Keller');
    expect(t).toContain('86 m');
    expect(t).toContain('01.06.2025');

    // Geldbetr\u00e4ge mit W\u00e4hrungszeichen
    expect(t).toContain('1.200,00 \u20ac');
    expect(t).toContain('eintausendzweihundert Euro');
    expect(t).toContain('1.400,00 \u20ac');
    expect(t).toContain('3.600,00 \u20ac');

    // Konten
    expect(t).toContain('DE89 2559 1413 3155 4105 01');
    expect(t).toContain('DE02 2559 1413 3155 4105 15');
    expect(t).toContain('GENODEF1BCK');
  });

  it('druckt die Kostenaufstellung mit Einzelbetr\u00e4gen und Summe', async () => {
    const t = await textDesVertrags(REFERENZ);

    expect(t).toContain('EUR monatlich');
    // Stichproben aus der Vorlage
    expect(t).toContain('2.1  laufende \u00f6ffentliche Lasten des Grundst\u00fccks');
    expect(t).toContain('2.9  Kosten der Geb\u00e4udereinigung und Ungezieferbek\u00e4mpfung');
    expect(t).toContain('2.18  Kosten der Abgasmessung');
    expect(t).toContain('Summe der monatlichen Vorauszahlung');
    expect(t).toContain('Summe der monatlichen Zahlungen');

    // Alle 19 Positionen der Hausnummerierung stehen im Vertrag
    for (let n = 1; n <= 19; n++) {
      expect(t).toContain(`2.${n}  `);
    }
  });

  it('blockiert, wenn die Kostenspalte nicht aufgeht', () => {
    const verdreht: MietvertragDaten = {
      ...REFERENZ,
      betriebskostenPositionen: REFERENZ.betriebskostenPositionen.map(p =>
        p.nummer === '2.1' ? { ...p, betrag: 99 } : p
      ),
    };
    const befunde = pruefeVertragsdaten(verdreht);
    expect(hatBlocker(befunde)).toBe(true);
    expect(befunde.some(f => f.feld === 'betriebskostenPositionen')).toBe(true);
  });

  it('h\u00e4lt die Paragraphenfolge l\u00fcckenlos \u2014 auch bei einem einzelnen Mieter', () => {
    const varianten: MietvertragDaten[] = [
      REFERENZ,
      { ...REFERENZ, mieter: [REFERENZ.mieter[0]] },
      { ...REFERENZ, objekt: { ...REFERENZ.objekt, heizungsart: 'etage' }, heizkostenVorauszahlung: null },
      { ...REFERENZ, betriebskostenModus: 'inklusiv', betriebskostenVorauszahlung: 0 },
    ];

    for (const v of varianten) {
      const nummern = wohnraumParagraphen(v).map(p => Number(p.nummer.replace('\u00a7 ', '')));
      expect(nummern).toEqual(nummern.map((_, i) => i + 1));
    }
  });

  it('h\u00e4lt Sonderzeichen im PDF', async () => {
    const t = await textDesVertrags(REFERENZ);
    expect(t).toContain('\u20ac');
    expect(t).toContain('\u00a7');
    // Gedankenstrich der Verteilerschl\u00fcssel-Zeilen
    expect(t).toContain('\u2014 Verteilung nach');
    // Deutsche Anf\u00fchrung unten in der Anlagenbezeichnung
    expect(t).toContain('\u201eBetriebskostenverordnung\u201c');
  });
});

// Ablegen zum Ansehen: PDF_OUT=/tmp/pdf npx vitest run hausvorlage
describe('Referenz-PDF ablegen', () => {
  it('schreibt die Datei, wenn PDF_OUT gesetzt ist', async () => {
    const ziel = process.env.PDF_OUT;
    if (!ziel) return;
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true });
    const blob = await generateMietvertragPdf(REFERENZ);
    writeFileSync(`${ziel}/mietvertrag-referenz-20250601.pdf`, new Uint8Array(await blob.arrayBuffer()));
    expect(true).toBe(true);
  });
});
