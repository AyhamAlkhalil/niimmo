import { describe, expect, it } from 'vitest';

import {
  aufCentVerteilen,
  berechneAnteil,
  berechneBezugsgroessen,
  bezugsgroesseFuerSchluessel,
  ermittlePerioden,
} from './nebenkostenBerechnung';
import {
  verbrauchAusEingabe,
  verbrauchDerPeriode,
  verbrauchFuer,
  verbrauchsBezug,
  verbrauchSperrgrund,
  verbrauchsZahl,
  heizkostenHinweis,
  zaehlerAusstattung,
  type VerbrauchsErfassung,
} from './nebenkostenVerbrauch';

const VON = new Date(2025, 0, 1);
const BIS = new Date(2025, 11, 31);

/** Haus mit zwei Wohnungen: A ganzjährig vermietet, B mit Auszug am 30.06. und Leerstand danach */
function haus() {
  const a = ermittlePerioden({ id: 'A', qm: 50 }, [{ id: 'mv-a', start_datum: '2020-01-01', ende_datum: null, anzahl_personen: 1 }], VON, BIS);
  const b = ermittlePerioden({ id: 'B', qm: 100 }, [{ id: 'mv-b', start_datum: '2019-05-01', ende_datum: '2025-06-30', anzahl_personen: 2 }], VON, BIS);
  const perioden = [...a.vertragsPerioden, ...a.leerstandsPerioden, ...b.vertragsPerioden, ...b.leerstandsPerioden];
  const bezug = berechneBezugsgroessen([{ qm: 50 }, { qm: 100 }], perioden, 365);
  return { perioden, bezug };
}

function zeile(einheit: string, vertrag: string | null, von: string, bis: string, verbrauch: number | string | null): VerbrauchsErfassung {
  return { kategorie: 'wasserversorgung', einheit_id: einheit, mietvertrag_id: vertrag, zeitraum_von: von, zeitraum_bis: bis, verbrauch };
}

const ALLE_ERFASST = [
  zeile('A', 'mv-a', '2025-01-01', '2025-12-31', 40),
  zeile('B', 'mv-b', '2025-01-01', '2025-06-30', 50),
  zeile('B', null, '2025-07-01', '2025-12-31', 10),
];

describe('Verteilung nach Verbrauch', () => {
  it('verteilt nach eigenem Verbrauch durch Gesamtverbrauch, ohne Zeitanteil, Leerstand beim Eigentümer', () => {
    const { perioden, bezug } = haus();
    const vb = verbrauchsBezug(ALLE_ERFASST, 'wasserversorgung', perioden);
    expect(vb).toMatchObject({ gesamt: 100, fehlend: 0 });

    const anteile = perioden.map((p, i) => berechneAnteil(p, 'verbrauch', bezug, verbrauchFuer(vb, i)));
    // A 40 %, Mieter B 50 % (halbes Jahr, Zeitanteil steckt im Verbrauch), Leerstand B 10 %
    expect(anteile).toEqual([0.4, 0.5, 0.1]);
    expect(anteile.reduce((s, a) => s + a, 0)).toBeCloseTo(1, 10);

    // Auf Cent: 333,33 € ergeben zusammen genau die Kosten
    const cent = aufCentVerteilen(anteile.map(a => 33333 * a));
    expect(cent.reduce((s, c) => s + c, 0)).toBe(33333);
  });

  it('weist im Schriftstück Gesamt- und eigenen Verbrauch als Bezugsgröße aus', () => {
    const { perioden, bezug } = haus();
    const vb = verbrauchsBezug(ALLE_ERFASST, 'wasserversorgung', perioden);
    expect(bezugsgroesseFuerSchluessel('verbrauch', perioden[1], bezug, verbrauchFuer(vb, 1))).toEqual({ gesamt: 100, anteilig: 50 });
  });

  it('rechnet ohne erfassten Verbrauch nichts und weicht nie auf die Wohnfläche aus', () => {
    const { perioden, bezug } = haus();
    expect(berechneAnteil(perioden[0], 'verbrauch', bezug)).toBe(0);
    expect(berechneAnteil(perioden[0], 'verbrauch', bezug, { eigen: null, gesamt: 60 })).toBe(0);
    expect(berechneAnteil(perioden[0], 'verbrauch', bezug, { eigen: 0, gesamt: 0 })).toBe(0);
  });

  it('nimmt einen Wert nur für genau den Zeitraum, für den er eingetragen ist', () => {
    const { perioden } = haus();
    // Auszug später korrigiert auf den 31.07.: Der alte Wert (bis 30.06.) passt nicht mehr
    const alt = [zeile('B', 'mv-b', '2025-01-01', '2025-06-30', 50)];
    const neuePeriode = { einheitId: 'B', mietvertragId: 'mv-b', von: new Date(2025, 0, 1), bis: new Date(2025, 6, 31) };
    expect(verbrauchDerPeriode(alt, 'wasserversorgung', neuePeriode)).toBeNull();
    // Andere Kostenart, anderer Vertrag oder Leerstand statt Vertrag: kein Treffer
    expect(verbrauchDerPeriode(alt, 'entwaesserung', perioden[1])).toBeNull();
    expect(verbrauchDerPeriode([zeile('B', null, '2025-01-01', '2025-06-30', 50)], 'wasserversorgung', perioden[1])).toBeNull();
    expect(verbrauchDerPeriode(alt, 'wasserversorgung', perioden[1])).toBe(50);
  });

  it('zählt fehlende Perioden, auch den Leerstand', () => {
    const { perioden } = haus();
    const vb = verbrauchsBezug(ALLE_ERFASST.slice(0, 2), 'wasserversorgung', perioden);
    expect(vb).toMatchObject({ werte: [40, 50, null], gesamt: 90, fehlend: 1 });
  });
});

describe('verbrauchSperrgrund', () => {
  const bezug = (werte: (number | null)[]) => ({
    werte,
    gesamt: werte.reduce<number>((s, w) => s + (w ?? 0), 0),
    fehlend: werte.filter(w => w === null).length,
  });

  it('sperrt, solange ein Wert fehlt', () => {
    expect(verbrauchSperrgrund('2.2 Wasserversorgung', bezug([40, null, 10]))).toBe(
      '2.2 Wasserversorgung: Verbrauch fehlt bei 1 von 3 Nutzungsperioden (auch Leerstand) — bitte in Schritt 2 eintragen.'
    );
  });

  it('sperrt bei Gesamtverbrauch 0, sonst würden die Kosten verschwinden', () => {
    expect(verbrauchSperrgrund('Wasser', bezug([0, 0]))).toContain('ergibt zusammen 0');
  });

  it('lässt vollständige Werte und Häuser ohne Nutzungsperiode durch', () => {
    expect(verbrauchSperrgrund('Wasser', bezug([40, 0, 10]))).toBeNull();
    expect(verbrauchSperrgrund('Wasser', bezug([]))).toBeNull();
  });
});

describe('Eingabe und Zahlen', () => {
  it('liest Komma, Punkt und Tausenderpunkt', () => {
    expect(verbrauchAusEingabe('12,5')).toBe(12.5);
    expect(verbrauchAusEingabe('12.5')).toBe(12.5);
    expect(verbrauchAusEingabe('1.234,5')).toBe(1234.5);
    expect(verbrauchAusEingabe(' 0 ')).toBe(0);
  });

  it('lehnt Leeres, Negatives und Text ab', () => {
    expect(verbrauchAusEingabe('')).toBeNull();
    expect(verbrauchAusEingabe('-3')).toBeNull();
    expect(verbrauchAusEingabe('zwölf')).toBeNull();
    expect(verbrauchAusEingabe('1,2,3')).toBeNull();
  });

  it('liest numeric aus der Datenbank als Zeichenkette', () => {
    expect(verbrauchsZahl('42.125')).toBe(42.125);
    expect(verbrauchsZahl(null)).toBeNull();
    expect(verbrauchsZahl(-1)).toBeNull();
    expect(verbrauchsZahl(' ')).toBeNull();
  });
});

describe('zaehlerAusstattung', () => {
  const einheiten = [
    { kaltwasser_zaehler: 'KW-1', warmwasser_zaehler: null },
    { kaltwasser_zaehler: ' ', warmwasser_zaehler: 'WW-2' },
    { kaltwasser_zaehler: null, warmwasser_zaehler: null },
  ];

  it('zählt Kaltwasserzähler für Wasser und Entwässerung, Warmwasserzähler für Warmwasser', () => {
    expect(zaehlerAusstattung('wasserversorgung', einheiten)).toEqual({ name: 'Kaltwasserzähler', mit: 1, gesamt: 3 });
    expect(zaehlerAusstattung('entwaesserung', einheiten)).toEqual({ name: 'Kaltwasserzähler', mit: 1, gesamt: 3 });
    expect(zaehlerAusstattung('warmwasserkosten', einheiten)).toEqual({ name: 'Warmwasserzähler', mit: 1, gesamt: 3 });
  });

  it('sagt nichts, wo das Datenmodell keine Zähler kennt', () => {
    expect(zaehlerAusstattung('heizkosten', einheiten)).toBeNull();
    expect(zaehlerAusstattung('wasserversorgung', [])).toBeNull();
  });
});

describe('heizkostenHinweis', () => {
  it('warnt bei Heizung, Warmwasser und verbundenen Anlagen, sonst nicht', () => {
    for (const k of ['heizkosten', 'warmwasserkosten', 'verbundene_anlagen']) {
      expect(heizkostenHinweis(k)).toContain('§ 10 HeizkostenV');
    }
    expect(heizkostenHinweis('wasserversorgung')).toBeNull();
  });
});
