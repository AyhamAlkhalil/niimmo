import { describe, it, expect } from 'vitest';
import {
  berechneAnteil,
  berechneBezugsgroessen,
  berechneVorauszahlungen,
  bezugsgroesseFuerSchluessel,
  ermittlePerioden,
  istAbrechnungsfristAbgelaufen,
  kostenAnteilImZeitraum,
  tageInZeitraum,
  ueberlappung,
  vertragsNutzungsende,
  objektAdresseZeilen,
  nachsendeAdresseZeilen,
  type Nutzungsperiode,
  type VerteilerSchluessel,
} from './nebenkostenBerechnung';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ABR_VON = new Date(2025, 0, 1);
const ABR_BIS = new Date(2025, 11, 31);
const GESAMT_TAGE = 365;

function einheit(id: string, qm: number) {
  return { id, qm };
}

function vertrag(
  id: string,
  start: string | null,
  ende: string | null,
  personen: number | null = null,
  kuendigung: string | null = null
) {
  return {
    id,
    start_datum: start,
    ende_datum: ende,
    kuendigungsdatum: kuendigung,
    anzahl_personen: personen,
  };
}

function kostenposition(von: string, bis: string, betrag: number) {
  return { zeitraum_von: von, zeitraum_bis: bis, gesamtbetrag: betrag };
}

// ---------------------------------------------------------------------------
// Zeitraum-Grundlagen
// ---------------------------------------------------------------------------
describe('tageInZeitraum', () => {
  it('zählt beide Endpunkte mit', () => {
    expect(tageInZeitraum(new Date(2025, 0, 1), new Date(2025, 0, 1))).toBe(1);
    expect(tageInZeitraum(ABR_VON, ABR_BIS)).toBe(365);
    expect(tageInZeitraum(new Date(2024, 0, 1), new Date(2024, 11, 31))).toBe(366);
  });
});

describe('ueberlappung', () => {
  it('liefert die Schnittmenge', () => {
    const result = ueberlappung(
      new Date(2025, 5, 1), new Date(2025, 8, 30),
      ABR_VON, ABR_BIS
    );
    expect(result?.tage).toBe(122);
  });

  it('liefert null ohne Schnittmenge', () => {
    expect(
      ueberlappung(new Date(2024, 0, 1), new Date(2024, 5, 30), ABR_VON, ABR_BIS)
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Vertragsende: kuendigungsdatum beendet den Vertrag genauso wie ende_datum
// ---------------------------------------------------------------------------
describe('vertragsNutzungsende', () => {
  it('nimmt ende_datum wenn nur dieses gesetzt ist', () => {
    expect(vertragsNutzungsende('2025-06-30', null, ABR_BIS)).toEqual(new Date('2025-06-30'));
  });

  it('nimmt kuendigungsdatum wenn ende_datum fehlt', () => {
    expect(vertragsNutzungsende(null, '2025-06-30', ABR_BIS)).toEqual(new Date('2025-06-30'));
  });

  it('nimmt das frühere der beiden Daten', () => {
    expect(vertragsNutzungsende('2025-12-31', '2025-06-30', ABR_BIS)).toEqual(
      new Date('2025-06-30')
    );
    expect(vertragsNutzungsende('2025-06-30', '2025-12-31', ABR_BIS)).toEqual(
      new Date('2025-06-30')
    );
  });

  it('fällt auf den Abrechnungsrand zurück wenn kein Ende gesetzt ist', () => {
    expect(vertragsNutzungsende(null, null, ABR_BIS)).toEqual(ABR_BIS);
  });
});

// ---------------------------------------------------------------------------
// Jahresübergreifende Kostenpositionen
// ---------------------------------------------------------------------------
describe('kostenAnteilImZeitraum', () => {
  it('nimmt den vollen Betrag bei vollständig enthaltenem Zeitraum', () => {
    const kp = kostenposition('2025-01-01', '2025-12-31', 1200);
    expect(kostenAnteilImZeitraum(kp, ABR_VON, ABR_BIS)).toBe(1200);
  });

  it('teilt eine Heizperiode 07/2024–06/2025 zeitanteilig auf', () => {
    const kp = kostenposition('2024-07-01', '2025-06-30', 3650);
    const anteil2025 = kostenAnteilImZeitraum(kp, ABR_VON, ABR_BIS);
    // 181 von 365 Tagen liegen in 2025
    expect(anteil2025).toBeCloseTo((3650 * 181) / 365, 2);

    const anteil2024 = kostenAnteilImZeitraum(
      kp, new Date(2024, 0, 1), new Date(2024, 11, 31)
    );
    // Beide Anteile zusammen ergeben wieder den Gesamtbetrag — kein Kostenverlust.
    expect(anteil2025 + anteil2024).toBeCloseTo(3650, 2);
  });

  it('liefert 0 wenn der Zeitraum das Jahr nicht berührt', () => {
    const kp = kostenposition('2023-01-01', '2023-12-31', 500);
    expect(kostenAnteilImZeitraum(kp, ABR_VON, ABR_BIS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Perioden und Leerstand
// ---------------------------------------------------------------------------
describe('ermittlePerioden', () => {
  it('bildet ganzjährige Belegung ohne Leerstand ab', () => {
    const { vertragsPerioden, leerstandsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [vertrag('v1', '2024-01-01', null, 2)],
      ABR_VON,
      ABR_BIS
    );
    expect(vertragsPerioden).toHaveLength(1);
    expect(vertragsPerioden[0].tage).toBe(365);
    expect(vertragsPerioden[0].personen).toBe(2);
    expect(leerstandsPerioden).toHaveLength(0);
  });

  it('ergänzt Leerstand vor, zwischen und nach Verträgen', () => {
    const { vertragsPerioden, leerstandsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [
        vertrag('v1', '2025-02-01', '2025-04-30', 1),
        vertrag('v2', '2025-07-01', '2025-09-30', 1),
      ],
      ABR_VON,
      ABR_BIS
    );

    expect(vertragsPerioden).toHaveLength(2);
    expect(leerstandsPerioden).toHaveLength(3);

    const summeTage =
      [...vertragsPerioden, ...leerstandsPerioden].reduce((s, p) => s + p.tage, 0);
    // Lückenlose Abdeckung des Jahres.
    expect(summeTage).toBe(365);
  });

  it('berücksichtigt das Kündigungsdatum als Nutzungsende', () => {
    const { vertragsPerioden, leerstandsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [vertrag('v1', '2024-01-01', null, 1, '2025-06-30')],
      ABR_VON,
      ABR_BIS
    );
    expect(vertragsPerioden[0].tage).toBe(181);
    expect(leerstandsPerioden).toHaveLength(1);
    expect(leerstandsPerioden[0].tage).toBe(184);
  });

  it('nimmt die Personenzahl aus dem Mietvertrag', () => {
    const { vertragsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [vertrag('v1', '2024-01-01', null, 4)],
      ABR_VON,
      ABR_BIS
    );
    expect(vertragsPerioden[0].personen).toBe(4);
    expect(vertragsPerioden[0].personenGepflegt).toBe(true);
  });

  it('ersetzt eine fehlende Personenzahl nicht, sondern markiert sie', () => {
    // Die Personenzahl gehört zum Vertrag. Ein Rückgriff auf die Einheit würde
    // die Belegung der Wohnung einem Vertrag zuschreiben, zu dem sie nicht gehört.
    const { vertragsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [vertrag('v1', '2024-01-01', null, null)],
      ABR_VON,
      ABR_BIS
    );
    expect(vertragsPerioden[0].personen).toBe(0);
    expect(vertragsPerioden[0].personenGepflegt).toBe(false);
  });

  it('führt Leerstand mit 0 Personen als echten Wert', () => {
    const { leerstandsPerioden } = ermittlePerioden(
      einheit('e1', 50),
      [vertrag('v1', '2025-01-01', '2025-06-30', 3)],
      ABR_VON,
      ABR_BIS
    );
    expect(leerstandsPerioden[0].personen).toBe(0);
    // Kein fehlender Wert: in einer leeren Wohnung wohnt niemand.
    expect(leerstandsPerioden[0].personenGepflegt).toBe(true);
  });

  it('meldet überschneidende Verträge derselben Einheit', () => {
    const { ueberschneidungen } = ermittlePerioden(
      einheit('e1', 50),
      [
        vertrag('v1', '2025-01-01', '2025-06-30', 1),
        vertrag('v2', '2025-06-01', '2025-12-31', 1),
      ],
      ABR_VON,
      ABR_BIS
    );
    expect(ueberschneidungen).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Verteilung: alle Anteile müssen sich auf 100 % summieren
// ---------------------------------------------------------------------------
describe('berechneAnteil', () => {
  // Zwei Einheiten: e1 (60 m², ganzjährig 4 Personen),
  // e2 (40 m², erste Jahreshälfte 2 Personen, danach Leerstand).
  const einheiten = [einheit('e1', 60), einheit('e2', 40)];

  const p1 = ermittlePerioden(
    einheiten[0], [vertrag('v1', '2024-01-01', null, 4)], ABR_VON, ABR_BIS
  );
  const p2 = ermittlePerioden(
    einheiten[1], [vertrag('v2', '2024-01-01', '2025-06-30', 2)], ABR_VON, ABR_BIS
  );

  const perioden: Nutzungsperiode[] = [
    ...p1.vertragsPerioden,
    ...p1.leerstandsPerioden,
    ...p2.vertragsPerioden,
    ...p2.leerstandsPerioden,
  ];
  const bezug = berechneBezugsgroessen(einheiten, perioden, GESAMT_TAGE);

  it.each<VerteilerSchluessel>(['qm', 'personen', 'gleich'])(
    'summiert sich bei Schlüssel "%s" auf 100 %%',
    (schluessel) => {
      const summe = perioden.reduce(
        (s, p) => s + berechneAnteil(p, schluessel, bezug),
        0
      );
      expect(summe).toBeCloseTo(1, 6);
    }
  );

  it('gewichtet den Personen-Schlüssel über Personentage', () => {
    // e1: 4 Personen × 365 = 1460; e2: 2 × 181 = 362; Leerstand: 0
    expect(bezug.personentage).toBe(4 * 365 + 2 * 181);

    const mieterE1 = p1.vertragsPerioden[0];
    expect(berechneAnteil(mieterE1, 'personen', bezug)).toBeCloseTo(
      1460 / bezug.personentage, 6
    );
  });

  it('multipliziert den Zeitanteil bei personen NICHT doppelt', () => {
    const mieterE2 = p2.vertragsPerioden[0];
    const anteil = berechneAnteil(mieterE2, 'personen', bezug);
    // Der Zeitanteil steckt bereits in den Personentagen (2 × 181).
    expect(anteil).toBeCloseTo((2 * 181) / bezug.personentage, 6);
  });

  it('gewichtet qm mit dem Zeitanteil', () => {
    const mieterE2 = p2.vertragsPerioden[0];
    expect(berechneAnteil(mieterE2, 'qm', bezug)).toBeCloseTo(
      (40 / 100) * (181 / 365), 6
    );
  });

  it('lässt flächenbezogene Leerstandskosten beim Eigentümer', () => {
    const leerstand = p2.leerstandsPerioden[0];
    expect(berechneAnteil(leerstand, 'qm', bezug)).toBeGreaterThan(0);
    expect(berechneAnteil(leerstand, 'gleich', bezug)).toBeGreaterThan(0);
    // Nach Personentagen trägt Leerstand nichts: dort hat niemand verbraucht.
    expect(berechneAnteil(leerstand, 'personen', bezug)).toBe(0);
  });
});

describe('bezugsgroesseFuerSchluessel', () => {
  const periode: Nutzungsperiode = {
    einheitId: 'e1', qm: 60, personen: 3, personenGepflegt: true,
    von: ABR_VON, bis: ABR_BIS, tage: 365,
  };
  const bezug = berechneBezugsgroessen([einheit('e1', 60)], [periode], GESAMT_TAGE);

  it('weist bei personen die Personentage aus', () => {
    expect(bezugsgroesseFuerSchluessel('personen', periode, bezug)).toEqual({
      gesamt: 1095,
      anteilig: 1095,
    });
  });

  it('weist bei qm die Flächen aus', () => {
    expect(bezugsgroesseFuerSchluessel('qm', periode, bezug)).toEqual({
      gesamt: 60,
      anteilig: 60,
    });
  });
});

// ---------------------------------------------------------------------------
// Vorauszahlungen
// ---------------------------------------------------------------------------
describe('berechneVorauszahlungen', () => {
  it('rechnet volle Monate voll', () => {
    const result = berechneVorauszahlungen(150, ABR_VON, ABR_BIS);
    expect(result.monate).toBe(12);
    expect(result.betrag).toBe(1800);
  });

  it('zählt bei Einzug zum Monatsersten nur die vollen Restmonate', () => {
    const result = berechneVorauszahlungen(150, new Date(2025, 6, 1), ABR_BIS);
    expect(result.monate).toBe(6);
    expect(result.betrag).toBe(900);
  });

  it('gewichtet angebrochene Monate tagesanteilig', () => {
    // 16.–31. Januar = 16 von 31 Tagen, danach 11 volle Monate
    const result = berechneVorauszahlungen(310, new Date(2025, 0, 16), ABR_BIS);
    expect(result.monate).toBeCloseTo(11 + 16 / 31, 6);
  });

  it('liefert 0 ohne vereinbarte Vorauszahlung', () => {
    expect(berechneVorauszahlungen(0, ABR_VON, ABR_BIS)).toEqual({ betrag: 0, monate: 0 });
  });
});

// ---------------------------------------------------------------------------
// Abrechnungsfrist § 556 Abs. 3 BGB
// ---------------------------------------------------------------------------
describe('istAbrechnungsfristAbgelaufen', () => {
  it('ist innerhalb der 12 Monate nicht abgelaufen', () => {
    expect(istAbrechnungsfristAbgelaufen(2025, new Date(2026, 11, 31))).toBe(false);
  });

  it('ist nach dem 31.12. des Folgejahres abgelaufen', () => {
    expect(istAbrechnungsfristAbgelaufen(2025, new Date(2027, 0, 1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Briefanschrift
// ---------------------------------------------------------------------------
describe('objektAdresseZeilen', () => {
  it('setzt die Straße vor PLZ und Ort', () => {
    expect(
      objektAdresseZeilen({
        strasse: 'Burger Landstraße',
        hausnummer: '18 - 18 e',
        plz: '29227',
        ort: 'Celle',
        adresse: '29227 Celle, Burger Landstraße 18 - 18 e',
      })
    ).toEqual(['Burger Landstraße 18 - 18 e', '29227 Celle']);
  });

  it('ignoriert das Freitextfeld, solange atomisierte Felder existieren', () => {
    // Der Freitext führt PLZ und Ort voran — zerlegt ergäbe er eine
    // vertauschte Anschrift auf dem Brief.
    const zeilen = objektAdresseZeilen({
      strasse: 'Liebigstraße',
      hausnummer: '12',
      plz: '30851',
      ort: 'Langenhagen',
      adresse: '30851, Langenhagen, Liebigstraße 12',
    });
    expect(zeilen[0]).toBe('Liebigstraße 12');
    expect(zeilen[1]).toBe('30851 Langenhagen');
  });

  it('nimmt den Freitext unzerlegt, wenn nichts atomisiert vorliegt', () => {
    expect(objektAdresseZeilen({ adresse: '30161 Hannover, Celler Straße 79' })).toEqual([
      '30161 Hannover, Celler Straße 79',
    ]);
  });

  it('kommt mit Teilangaben und Leerwerten zurecht', () => {
    expect(objektAdresseZeilen({ strasse: 'Hauptstraße', hausnummer: '20' })).toEqual([
      'Hauptstraße 20',
    ]);
    expect(objektAdresseZeilen({ plz: '12345', ort: 'Musterstadt' })).toEqual(['12345 Musterstadt']);
    expect(objektAdresseZeilen({})).toEqual([]);
  });
});

describe('nachsendeAdresseZeilen', () => {
  it('trennt an Umbrüchen und Kommas', () => {
    expect(nachsendeAdresseZeilen('Neue Straße 5\n12345 Neustadt')).toEqual([
      'Neue Straße 5',
      '12345 Neustadt',
    ]);
    expect(nachsendeAdresseZeilen('Neue Straße 5, 12345 Neustadt')).toEqual([
      'Neue Straße 5',
      '12345 Neustadt',
    ]);
  });

  it('liefert für Leerwerte eine leere Liste', () => {
    expect(nachsendeAdresseZeilen(null)).toEqual([]);
    expect(nachsendeAdresseZeilen('   ')).toEqual([]);
  });
});
