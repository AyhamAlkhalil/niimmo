import { describe, expect, it } from 'vitest';
import { gewerbeParagraphen, laufzeitEnde, type GewerbeDaten } from './gewerbeKlauseln';
import {
  kuechenParagraphen,
  nebenvertragHinweise,
  stellplatzParagraphen,
  type NebenvertragDaten,
} from './nebenvertraege';
import type { MietvertragDaten } from './typen';

const VERMIETER: MietvertragDaten['vermieter'] = {
  firmenname: 'NiImmo Wohnungsbaugesellschaft mbH',
  rechtsform: 'GmbH',
  strasse: 'Egestorffstraße',
  hausnummer: '11',
  plz: '31319',
  ort: 'Sehnde',
  vertretenDurch: ['Denis Mikyas'],
  vertretungArt: 'einzel',
  registergericht: 'Amtsgericht Hildesheim',
  handelsregister: 'HRB 208151',
  steuernummer: null,
  ustId: null,
  telefon: null,
  fax: null,
  email: null,
  mietIban: 'DE76255914133155410541',
  mietBic: 'GENODEF1BCK',
  kautionIban: 'DE89255914133155410501',
  kautionBic: 'GENODEF1BCK',
  stammdatenGeprueft: false,
};

const MIETER: MietvertragDaten['mieter'] = [
  {
    anrede: 'Herr',
    vorname: 'Max',
    nachname: 'Mustermann',
    istUnternehmen: false,
    firmenname: null,
    vertretenDurch: null,
    strasse: 'Alte Straße',
    hausnummer: '3',
    plz: '30159',
    ort: 'Hannover',
    geburtsdatum: null,
    telefon: null,
    email: null,
  },
];

function gewerbe(u: Partial<GewerbeDaten> = {}): GewerbeDaten {
  return {
    vermieter: VERMIETER,
    mieter: MIETER,
    objekt: {
      strasse: 'Uferstraße',
      hausnummer: '18b',
      plz: '30926',
      ort: 'Seelze',
      ortsteil: null,
      istAngespannt: true,
      heizungsart: 'zentral',
      heizkostenSchluessel: '70/30',
      energieausweisTyp: null,
      energieKennwert: null,
      energietraeger: null,
      energieausweisGueltigBis: null,
      energieeffizienzklasse: null,
    },
    flaechen: [
      { bezeichnung: 'Halle EG', qm: 150 },
      { bezeichnung: 'Büro OG', qm: 41 },
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
    vertragsdatum: '2026-08-20',
    unterschriftOrt: 'Sehnde',
    ...u,
  };
}

function nebenvertrag(u: Partial<NebenvertragDaten> = {}): NebenvertragDaten {
  return {
    vermieter: VERMIETER,
    mieter: MIETER,
    objekt: { strasse: 'Liebigstraße', hausnummer: '12', plz: '30851', ort: 'Langenhagen' },
    bezeichnung: 'einen Außenstellplatz Nr. 4',
    beginn: '2026-09-01',
    miete: 50,
    wohnungBezug: undefined,
    vertragsdatum: '2026-08-20',
    unterschriftOrt: 'Sehnde',
    ...u,
  };
}

const text = (ps: { absaetze: { text: string }[] }[]) =>
  ps.flatMap(p => p.absaetze.map(a => a.text)).join('\n');

describe('Gewerbemietvertrag', () => {
  it('rechnet Festmietzeit und Ende korrekt', () => {
    // 10 Jahre ab 10.02.2023 enden am 09.02.2033 — in der Bestandsvorlage
    // stand fälschlich der 28.02.2033.
    expect(laufzeitEnde('2023-02-10', 120)).toBe('2033-02-09');
    expect(laufzeitEnde('2026-09-01', 60)).toBe('2031-08-31');
  });

  it('weist Umsatzsteuer aus, wenn optiert wird', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).toMatch(/optiert nach § 9 UStG/);
    expect(t).toMatch(/15a UStG/);
    // 2400 netto + 19 % = 2856; 382 netto + 19 % = 454,58 → gesamt 3.310,58
    expect(t).toMatch(/3\.310,58 €/);
  });

  it('weist keine Umsatzsteuer aus, wenn nicht optiert wird', () => {
    const t = text(gewerbeParagraphen(gewerbe({ umsatzsteuerpflichtig: false })));
    expect(t).toMatch(/§ 4 Nr. 12 lit. a UStG steuerfrei/);
    expect(t).not.toMatch(/optiert nach § 9 UStG/);
  });

  it('nennt Verzugszinsen nach dem Basiszinssatz, nicht nach dem Diskontsatz', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).toMatch(/neun Prozentpunkten über dem Basiszinssatz/);
    expect(t).not.toMatch(/Diskontsatz/i);
  });

  it('enthält keine Schriftformheilungsklausel', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).not.toMatch(/heilen|Heilung/i);
    expect(t).toMatch(/bedürfen der Textform/);
  });

  it('beziffert die Instandhaltungsgrenzen', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).toMatch(/250,00 € je Einzelfall/);
    expect(t).toMatch(/2\.000,00 € im Kalenderjahr/);
    expect(t).toMatch(/Dach und Fach/);
  });

  it('kehrt die Beweislast nicht zulasten des Mieters um', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).toMatch(/Der Vermieter hat darzulegen und zu beweisen, dass die Schadensursache/);
  });

  it('verwendet einen einheitlichen Modernisierungszuschlag', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    const treffer = t.match(/(\d+) % der für die Mietsache aufgewendeten Kosten/);
    expect(treffer).not.toBeNull();
    expect(t).not.toMatch(/14 %/);
  });

  it('nennt Optionsrechte, wenn vereinbart', () => {
    const t = text(gewerbeParagraphen(gewerbe()));
    expect(t).toMatch(/2-mal um jeweils 36 Monate/);
  });

  it('kündigt unbefristete Verträge nach § 580a BGB', () => {
    const t = text(gewerbeParagraphen(gewerbe({ festmietzeitMonate: 0, optionen: null })));
    expect(t).toMatch(/§ 580a Abs. 2 BGB/);
  });

  it('summiert die Flächen', () => {
    const p2 = gewerbeParagraphen(gewerbe()).find(p => p.nummer === '§ 2');
    expect(p2!.absaetze.map(a => a.text).join(' ')).toMatch(/Gesamtfläche: 191 m²/);
  });
});

describe('Stellplatzvertrag', () => {
  it('verwendet das Mietkonto, nicht das Kautionskonto', () => {
    const t = text(stellplatzParagraphen(nebenvertrag()));
    // Die Word-Vorlage nannte hier DE89…410501 — das Kautionskonto.
    expect(t).toMatch(/DE76 2559 1413 3155 4105 41/);
    expect(t).not.toMatch(/4105 01/);
  });

  it('bindet die Mieterhöhung an einen Maßstab und eine Frist', () => {
    const t = text(stellplatzParagraphen(nebenvertrag()));
    expect(t).toMatch(/frühestens ein Jahr nach Vertragsbeginn/);
    expect(t).toMatch(/ortsübliche Entgelt für vergleichbare Stellplätze/);
    expect(t).not.toMatch(/muss nicht eingehalten werden/);
  });

  it('koppelt den Vertrag an die Wohnung, wenn ein Bezug besteht', () => {
    const t = text(stellplatzParagraphen(nebenvertrag({ wohnungBezug: 'WE 12, Liebigstraße 12' })));
    expect(t).toMatch(/endet zum selben Zeitpunkt/);
  });

  it('warnt, wenn Stellplatz und Wohnung zusammen vermietet werden', () => {
    const h = nebenvertragHinweise('stellplatz', nebenvertrag({ wohnungBezug: 'WE 12' }));
    expect(h.some(x => x.includes('einheitliches Wohnraummietverhältnis'))).toBe(true);
  });

  it('schließt die stillschweigende Verlängerung aus', () => {
    expect(text(stellplatzParagraphen(nebenvertrag()))).toMatch(/§ 545 BGB wird abbedungen/);
  });
});

describe('Küchen-Nutzungsvereinbarung', () => {
  it('bleibt bei den gewöhnlichen Erhaltungskosten des Entleihers', () => {
    const t = text(kuechenParagraphen(nebenvertrag({ bezeichnung: 'Einbauküche mit Herd und Kühlschrank' })));
    expect(t).toMatch(/gewöhnlichen Kosten der Erhaltung \(§ 601 Abs. 1 BGB\)/);
    expect(t).toMatch(/Eine Pflicht zur Ersatzbeschaffung besteht nicht/);
  });

  it('stellt klar, dass kein Entgelt erhoben wird', () => {
    const t = text(kuechenParagraphen(nebenvertrag()));
    expect(t).toMatch(/weder gesondert noch über die Miete erhoben/);
  });

  it('warnt vor der Umgehungsgefahr', () => {
    const h = nebenvertragHinweise('kueche', nebenvertrag());
    expect(h.some(x => x.includes('Teil der Mietsache'))).toBe(true);
  });
});
