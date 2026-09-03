import { describe, expect, it } from 'vitest';
import { betragInWorten, istIbanGueltig, formatIban } from '../pdf/briefLayout';
import { pruefeVertragsdaten, hatBlocker } from './pflichtpruefung';
import { wohnraumParagraphen } from './wohnraumKlauseln';
import { widerrufsrechtBesteht } from './anlagen';
import type { MietvertragDaten } from './typen';

function basisVertrag(ueberschreibungen: Partial<MietvertragDaten> = {}): MietvertragDaten {
  return {
    vertragsart: 'wohnraum',
    vermieter: {
      firmenname: 'NiImmo Wohnungsbaugesellschaft mbH',
      rechtsform: 'GmbH',
      strasse: 'Egestorffstraße',
      hausnummer: '11',
      plz: '31319',
      ort: 'Sehnde',
      vertretenDurch: ['Ayhan Yeyrek', 'Dennis Mikyas'],
      vertretungArt: 'gesamt',
      registergericht: 'Amtsgericht Hildesheim',
      handelsregister: 'HRB 208151',
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
    },
    mieter: [
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
        geburtsdatum: '1990-06-11',
        telefon: null,
        email: null,
      },
    ],
    objekt: {
      strasse: 'Levester Straße',
      hausnummer: '6',
      plz: '30989',
      ort: 'Gehrden',
      ortsteil: null,
      istAngespannt: false,
      heizungsart: 'zentral',
      heizkostenSchluessel: '70/30',
      energieausweisTyp: 'verbrauch',
      energieKennwert: 120,
      energietraeger: 'Erdgas',
      energieausweisGueltigBis: '2030-01-01',
      energieeffizienzklasse: 'D',
    },
    einheit: {
      bezeichnung: 'WE 12',
      lage: 'Haus rechts, Dachgeschoss rechts',
      wohnflaecheQm: 63,
      anzahlZimmer: 3.5,
      raumaufstellung: '3,5 Zimmer, 1 Küche, 1 Badezimmer, 1 Gäste-WC',
      nebenraeume: 'Kellerraum',
      einbaukueche: false,
    },
    nebenobjekte: [],
    mietbeginn: '2026-09-01',
    vertragsende: null,
    befristungsgrund: null,
    befristungsgrundText: null,
    kuendigungsverzichtBis: null,
    uebergabeDatum: '2026-08-30',
    kaltmiete: 429,
    betriebskostenModus: 'vorauszahlung',
    betriebskostenVorauszahlung: 90,
    heizkostenVorauszahlung: null,
    betriebskostenPositionen: [
      { nummer: '2.1', bezeichnung: 'Grundsteuer', umgelegt: true, schluessel: 'qm' },
      { nummer: '2.2', bezeichnung: 'Wasserversorgung', umgelegt: true, schluessel: 'verbrauch' },
    ],
    abrechnungszeitraum: 'das Kalenderjahr',
    kautionBetrag: 1287,
    kautionArt: 'barkaution',
    kautionRaten: 3,
    faelligkeitWerktag: 3,
    lastschrift: false,
    lastschriftKontoinhaber: null,
    lastschriftIban: null,
    lastschriftBic: null,
    sepaMandatsreferenz: null,
    mietanpassungArt: 'keine',
    staffelplan: null,
    indexBasisWert: null,
    indexBasisMonat: null,
    anzahlPersonen: 2,
    schluessel: [{ art: 'Wohnungsschlüssel', anzahl: 2 }],
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
    zusatzvereinbarungen: null,
    vertragsdatum: '2026-08-20',
    unterschriftOrt: 'Sehnde',
    anlagen: {
      hausordnung: true,
      betrkvKatalog: true,
      widerrufsbelehrung: true,
      datenschutzhinweis: true,
      mietspiegelEinwilligung: false,
    },
    ...ueberschreibungen,
  };
}

describe('IBAN-Prüfung', () => {
  it('erkennt die ungültige Miet-IBAN aus der Word-Vorlage', () => {
    // In der Bestandsvorlage steht DE89…410500 als Mietkonto. Die Prüfziffer
    // stammt von der Kautions-IBAN — Überweisungen dorthin schlagen fehl.
    expect(istIbanGueltig('DE89255914133155410500')).toBe(false);
  });

  it('akzeptiert die gültige Kautions-IBAN', () => {
    expect(istIbanGueltig('DE89255914133155410501')).toBe(true);
  });

  it('ignoriert Leerzeichen', () => {
    expect(istIbanGueltig('DE89 2559 1413 3155 4105 01')).toBe(true);
  });

  it('weist Unsinn ab', () => {
    expect(istIbanGueltig('')).toBe(false);
    expect(istIbanGueltig('DE00')).toBe(false);
    expect(istIbanGueltig(null)).toBe(false);
  });

  it('formatiert in Vierergruppen', () => {
    expect(formatIban('DE89255914133155410501')).toBe('DE89 2559 1413 3155 4105 01');
  });
});

describe('Betrag in Worten', () => {
  it('schreibt die Miete aus dem Referenzvertrag korrekt aus', () => {
    expect(betragInWorten(429)).toBe('vierhundertneunundzwanzig Euro');
  });

  it('behandelt Cent', () => {
    expect(betragInWorten(1287.5)).toBe(
      'eintausendzweihundertsiebenundachtzig Euro fünfzig Cent'
    );
  });

  it('behandelt runde Tausender', () => {
    expect(betragInWorten(1000)).toBe('eintausend Euro');
  });
});

describe('Pflichtprüfung', () => {
  it('lässt einen vollständigen Vertrag durch', () => {
    const befunde = pruefeVertragsdaten(basisVertrag());
    expect(hatBlocker(befunde)).toBe(false);
  });

  it('blockiert, wenn die Personenzahl bei Personenschlüssel fehlt', () => {
    const d = basisVertrag({
      anzahlPersonen: 0,
      betriebskostenPositionen: [
        { nummer: '2.8', bezeichnung: 'Müllbeseitigung', umgelegt: true, schluessel: 'personen' },
      ],
    });
    const befunde = pruefeVertragsdaten(d);
    expect(hatBlocker(befunde)).toBe(true);
    expect(befunde.some(f => f.feld === 'anzahlPersonen')).toBe(true);
  });

  it('blockiert eine Kaution über drei Nettokaltmieten', () => {
    const befunde = pruefeVertragsdaten(basisVertrag({ kautionBetrag: 1400 }));
    expect(befunde.some(f => f.feld === 'kautionBetrag' && f.schwere === 'blocker')).toBe(true);
  });

  it('erlaubt exakt drei Nettokaltmieten', () => {
    const befunde = pruefeVertragsdaten(basisVertrag({ kautionBetrag: 429 * 3 }));
    expect(befunde.some(f => f.feld === 'kautionBetrag')).toBe(false);
  });

  it('blockiert Schönheitsreparaturen bei unrenovierter Übergabe', () => {
    const d = basisVertrag({ uebergabezustand: 'unrenoviert', schoenheitsreparaturen: true });
    const befunde = pruefeVertragsdaten(d);
    expect(befunde.some(f => f.feld === 'schoenheitsreparaturen' && f.schwere === 'blocker')).toBe(true);
  });

  it('blockiert eine Befristung ohne Grund', () => {
    const befunde = pruefeVertragsdaten(basisVertrag({ vertragsende: '2027-08-31' }));
    expect(befunde.some(f => f.feld === 'befristungsgrund' && f.schwere === 'blocker')).toBe(true);
  });

  it('blockiert eine ungültige Vermieter-IBAN', () => {
    const d = basisVertrag();
    d.vermieter.mietIban = 'DE89255914133155410500';
    const befunde = pruefeVertragsdaten(d);
    expect(befunde.some(f => f.feld === 'vermieter.mietIban' && f.schwere === 'blocker')).toBe(true);
  });

  it('verlangt in angespannten Märkten die Auskunft nach § 556g BGB', () => {
    const d = basisVertrag();
    d.objekt.istAngespannt = true;
    d.objekt.ort = 'Seelze';
    const befunde = pruefeVertragsdaten(d);
    expect(befunde.some(f => f.feld === 'mietpreisbremseAuskunftAm' && f.schwere === 'blocker')).toBe(true);
  });

  it('blockiert Staffelstufen mit weniger als zwölf Monaten Abstand', () => {
    const d = basisVertrag({
      mietanpassungArt: 'staffel',
      staffelplan: [
        { gueltigAb: '2027-01-01', kaltmiete: 450 },
        { gueltigAb: '2027-06-01', kaltmiete: 470 },
      ],
    });
    const befunde = pruefeVertragsdaten(d);
    expect(befunde.some(f => f.feld === 'staffelplan' && f.schwere === 'blocker')).toBe(true);
  });

  it('akzeptiert Staffelstufen im Jahresabstand', () => {
    const d = basisVertrag({
      mietanpassungArt: 'staffel',
      staffelplan: [
        { gueltigAb: '2027-09-01', kaltmiete: 450 },
        { gueltigAb: '2028-09-01', kaltmiete: 470 },
      ],
    });
    expect(pruefeVertragsdaten(d).some(f => f.feld === 'staffelplan')).toBe(false);
  });

  it('warnt bei ungeprüften Vermieterstammdaten, blockiert aber nicht', () => {
    const d = basisVertrag();
    d.vermieter.stammdatenGeprueft = false;
    const befunde = pruefeVertragsdaten(d);
    const treffer = befunde.find(f => f.feld === 'vermieter.stammdatenGeprueft');
    expect(treffer?.schwere).toBe('warnung');
  });
});

describe('Klauseltexte', () => {
  it('enthält keinen Ausschluss der Minderung', () => {
    const text = alleAbsaetze(basisVertrag());
    expect(text).toMatch(/Recht zur Mietminderung nach § 536 BGB, bleiben unberührt/);
    expect(text).not.toMatch(/keine Minderungsrechte/i);
  });

  it('enthält keine Quotenabgeltungsklausel', () => {
    const text = alleAbsaetze(basisVertrag());
    expect(text).toMatch(/Verpflichtung zur Zahlung anteiliger Kosten für noch nicht fällige Schönheitsreparaturen besteht nicht/);
    expect(text).not.toMatch(/Kostenbeteiligungsquote/i);
    expect(text).not.toMatch(/Malerfachgeschäft/i);
  });

  it('lässt § 14 bei unrenovierter Übergabe zum Vermieter zurückfallen', () => {
    const d = basisVertrag({ uebergabezustand: 'unrenoviert', schoenheitsreparaturen: false });
    const p14 = wohnraumParagraphen(d).find(p => p.nummer === '§ 14');
    const text = p14!.absaetze.map(a => a.text).join(' ');
    expect(text).toMatch(/verbleiben deshalb beim Vermieter/);
    expect(text).not.toMatch(/Der Mieter führt die Schönheitsreparaturen/);
  });

  it('nennt keine Mahnkostenpauschale in Euro', () => {
    const text = alleAbsaetze(basisVertrag());
    expect(text).toMatch(/tatsächlich angefallenen Porto- und Materialkosten/);
    expect(text).not.toMatch(/11,00 €/);
    expect(text).not.toMatch(/Buchungspauschale/i);
  });

  it('nennt bei angespanntem Markt die Kappungsgrenze von 15 Prozent', () => {
    const d = basisVertrag();
    d.objekt.istAngespannt = true;
    d.objekt.ort = 'Seelze';
    const p5 = wohnraumParagraphen(d).find(p => p.nummer === '§ 5');
    expect(p5!.absaetze.map(a => a.text).join(' ')).toMatch(/höchstens 15 %/);
  });

  it('nennt sonst 20 Prozent', () => {
    const p5 = wohnraumParagraphen(basisVertrag()).find(p => p.nummer === '§ 5');
    expect(p5!.absaetze.map(a => a.text).join(' ')).toMatch(/höchstens 20 %/);
  });

  it('erwähnt die Wohnungsgeberbestätigung', () => {
    expect(alleAbsaetze(basisVertrag())).toMatch(/Wohnungsgeberbestätigung nach § 19 Abs. 3/);
  });

  it('fügt § 23 nur bei mehreren Mietern ein', () => {
    expect(wohnraumParagraphen(basisVertrag()).some(p => p.nummer === '§ 23')).toBe(false);

    const d = basisVertrag();
    d.mieter = [d.mieter[0], { ...d.mieter[0], vorname: 'Erika' }];
    expect(wohnraumParagraphen(d).some(p => p.nummer === '§ 23')).toBe(true);
  });

  it('gibt bei Indexmiete den Basisindex 2020 aus, nicht 2000', () => {
    const d = basisVertrag({
      mietanpassungArt: 'index',
      indexBasisWert: 119.4,
      indexBasisMonat: '2026-08-01',
    });
    const p5 = wohnraumParagraphen(d).find(p => p.nummer === '§ 5');
    const text = p5!.absaetze.map(a => a.text).join(' ');
    expect(text).toMatch(/Basis 2020 = 100/);
    expect(text).not.toMatch(/2000\s*=\s*100/);
    expect(text).not.toMatch(/Industrie und Handelskammer|Sachverständiger/i);
  });

  it('bietet bei Etagenheizung keine Heizkostenumlage an', () => {
    const d = basisVertrag();
    d.objekt.heizungsart = 'etage';

    // § 4 schließt die Umlage aus …
    const p4 = wohnraumParagraphen(d).find(p => p.nummer === '§ 4');
    expect(p4!.absaetze.map(a => a.text).join(' ')).toMatch(
      /Eine Umlage von Heiz- und Warmwasserkosten findet nicht statt/
    );

    // … und § 24 beschreibt die Anlage als vom Mieter betrieben,
    // ohne einen Verteilerschlüssel nach HeizkostenV zu nennen.
    const p24 = wohnraumParagraphen(d).find(p => p.nummer === '§ 24');
    const text24 = p24!.absaetze.map(a => a.text).join(' ');
    expect(text24).toMatch(/eigenverantwortlich auf eigene Kosten betreibt/);
    expect(text24).not.toMatch(/Heizkostenverordnung abgerechnet/);
  });
});

describe('Widerrufsrecht', () => {
  it('entfällt nach einer Besichtigung', () => {
    expect(widerrufsrechtBesteht(basisVertrag())).toBe(false);
  });

  it('besteht ohne Besichtigung', () => {
    expect(widerrufsrechtBesteht(basisVertrag({ besichtigtAm: null }))).toBe(true);
  });
});

function alleAbsaetze(d: MietvertragDaten): string {
  return wohnraumParagraphen(d)
    .flatMap(p => p.absaetze.map(a => a.text))
    .join('\n');
}
