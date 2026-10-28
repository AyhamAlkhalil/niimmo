import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  berechneMietkontostand,
  calculateMietvertragRueckstand,
  calculateMieteZahlungen,
  calculateRuecklastschriftGebuehren,
  leseForderungsbetrag,
  nurFaelligeForderungen,
} from './rueckstandsberechnung';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const mockMietvertrag = { id: 'mv-1', kaltmiete: 800, betriebskosten: 200 };

function makeForderung(sollmonat: string, sollbetrag: number) {
  return { id: `f-${sollmonat}`, mietvertrag_id: 'mv-1', sollmonat, sollbetrag };
}

function makeZahlung(
  id: string,
  betrag: number,
  kategorie: string | null,
  zugeordneter_monat: string | null = null,
  buchungsdatum = '2025-01-10'
) {
  return { id, mietvertrag_id: 'mv-1', betrag, kategorie, zugeordneter_monat, buchungsdatum };
}

// ---------------------------------------------------------------------------
// calculateMieteZahlungen
// ---------------------------------------------------------------------------
describe('calculateMieteZahlungen', () => {
  it('returns 0 for empty array', () => {
    expect(calculateMieteZahlungen([])).toBe(0);
  });

  it('sums only payments with kategorie "Miete"', () => {
    const zahlungen = [
      makeZahlung('z1', 1000, 'Miete'),
      makeZahlung('z2', 500, 'Miete'),
      makeZahlung('z3', 200, 'Nebenkosten'),
      makeZahlung('z4', 300, 'Rücklastschrift'),
      makeZahlung('z5', 100, null),
    ];
    expect(calculateMieteZahlungen(zahlungen)).toBe(1500);
  });

  it('returns 0 when no Miete payments exist', () => {
    const zahlungen = [
      makeZahlung('z1', 500, 'Nebenkosten'),
      makeZahlung('z2', 100, null),
    ];
    expect(calculateMieteZahlungen(zahlungen)).toBe(0);
  });

  it('handles non-numeric betrag gracefully (treats as 0)', () => {
    const zahlungen = [
      { id: 'z1', betrag: undefined, kategorie: 'Miete' },
      makeZahlung('z2', 300, 'Miete'),
    ];
    expect(calculateMieteZahlungen(zahlungen)).toBe(300);
  });

  it('does NOT count kategorie null as Miete', () => {
    const zahlungen = [makeZahlung('z1', 1000, null)];
    expect(calculateMieteZahlungen(zahlungen)).toBe(0);
  });

  it('does NOT count "Rücklastschrift" as Miete', () => {
    const zahlungen = [makeZahlung('z1', 25, 'Rücklastschrift')];
    expect(calculateMieteZahlungen(zahlungen)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — guard clauses
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — null/undefined guards', () => {
  it('returns zeros when mietvertrag is null', () => {
    const result = calculateMietvertragRueckstand(null, [], []);
    expect(result).toEqual({ gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 });
  });

  it('returns zeros when forderungen is null', () => {
    const result = calculateMietvertragRueckstand(mockMietvertrag, null as any, []);
    expect(result).toEqual({ gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 });
  });

  it('returns zeros when zahlungen is null', () => {
    const result = calculateMietvertragRueckstand(mockMietvertrag, [], null as any);
    expect(result).toEqual({ gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 });
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — kein Rückstand (Zahlungen = Forderungen)
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — kein Rückstand', () => {
  it('rueckstand is 0 when Miete payments exactly match demands', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Miete', '2025-01')];

    const { gesamtForderungen, gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    expect(gesamtForderungen).toBe(1000);
    expect(gesamtZahlungen).toBe(1000);
    expect(rueckstand).toBe(0);
  });

  it('rueckstand is 0 with multiple matching months', () => {
    const forderungen = [
      makeForderung('2025-01', 1000),
      makeForderung('2025-02', 1000),
    ];
    const zahlungen = [
      makeZahlung('z1', 1000, 'Miete', '2025-01'),
      makeZahlung('z2', 1000, 'Miete', '2025-02'),
    ];

    const { rueckstand } = calculateMietvertragRueckstand(mockMietvertrag, forderungen, zahlungen);
    expect(rueckstand).toBe(0);
  });

  it('leere Forderungen und leere Zahlungen ergeben Null-Rückstand', () => {
    const result = calculateMietvertragRueckstand(mockMietvertrag, [], []);
    expect(result).toEqual({ gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0 });
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — Rückstand (Zahlungen < Forderungen)
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — Rückstand', () => {
  it('positive rueckstand when Miete payments are less than demands', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 600, 'Miete', '2025-01')];

    const { gesamtForderungen, gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    expect(gesamtForderungen).toBe(1000);
    expect(gesamtZahlungen).toBe(600);
    expect(rueckstand).toBe(400);
  });

  it('positive rueckstand when no payments at all', () => {
    const forderungen = [makeForderung('2025-01', 1000)];

    const { rueckstand } = calculateMietvertragRueckstand(mockMietvertrag, forderungen, []);
    expect(rueckstand).toBe(1000);
  });

  it('accumulates rueckstand across multiple months', () => {
    const forderungen = [
      makeForderung('2025-01', 1000),
      makeForderung('2025-02', 1000),
    ];
    const zahlungen = [makeZahlung('z1', 500, 'Miete', '2025-01')];

    const { rueckstand } = calculateMietvertragRueckstand(mockMietvertrag, forderungen, zahlungen);
    expect(rueckstand).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — Guthaben (Zahlungen > Forderungen)
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — Guthaben', () => {
  it('negative rueckstand (Guthaben) when payments exceed demands', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1200, 'Miete', '2025-01')];

    const { rueckstand } = calculateMietvertragRueckstand(mockMietvertrag, forderungen, zahlungen);
    expect(rueckstand).toBe(-200);
  });

  it('Guthaben works when forderungen are empty but Miete payments exist', () => {
    const zahlungen = [makeZahlung('z1', 500, 'Miete', '2025-01')];

    const { gesamtForderungen, gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, [], zahlungen
    );

    expect(gesamtForderungen).toBe(0);
    expect(gesamtZahlungen).toBe(500);
    expect(rueckstand).toBe(-500);
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — falsche Kategorie wird ignoriert
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — Kategoriefilter', () => {
  it('does NOT count Nebenkosten payments toward rueckstand calculation', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Nebenkosten', '2025-01')];

    const { gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    // Nebenkosten darf nicht gezählt werden
    expect(gesamtZahlungen).toBe(0);
    expect(rueckstand).toBe(1000);
  });

  it('does NOT count null-kategorie payments toward rueckstand calculation', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, null, '2025-01')];

    const { gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    expect(gesamtZahlungen).toBe(0);
    expect(rueckstand).toBe(1000);
  });

  it('DOES count Rücklastschrift payments (they reduce the debt balance)', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [
      makeZahlung('z1', 1000, 'Miete', '2025-01'),
      makeZahlung('z2', -25, 'Rücklastschrift', '2025-01'),
    ];

    const { gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    // Rücklastschrift (typically negative) is counted
    expect(gesamtZahlungen).toBe(975);
    expect(rueckstand).toBe(25);
  });

  it('ignores Mietkaution category', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Mietkaution', '2025-01')];

    const { gesamtZahlungen } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );
    expect(gesamtZahlungen).toBe(0);
  });

  it('ignores Ignorieren category', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Ignorieren', '2025-01')];

    const { gesamtZahlungen } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );
    expect(gesamtZahlungen).toBe(0);
  });

  it('ignores payments without buchungsdatum', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [
      { id: 'z1', betrag: 1000, kategorie: 'Miete', zugeordneter_monat: '2025-01', buchungsdatum: null },
    ];

    const { gesamtZahlungen } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );
    expect(gesamtZahlungen).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — Vorauszahlungs-Logik
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — Vorauszahlungs-Verschiebung', () => {
  it('shifts a payment from a month with no demand to the next month with a demand', () => {
    // Forderung nur im Februar; Zahlung kam mit zugeordneter_monat = Januar (kein Bedarf in Jan)
    const forderungen = [makeForderung('2025-02', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Miete', '2025-01')];

    const { gesamtZahlungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    // Payment should be shifted to 2025-02 and count toward that demand
    expect(gesamtZahlungen).toBe(1000);
    expect(rueckstand).toBe(0);
  });

  it('keeps payment in place when demand exists in same month', () => {
    const forderungen = [makeForderung('2025-01', 1000)];
    const zahlungen = [makeZahlung('z1', 1000, 'Miete', '2025-01')];

    const { rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );
    expect(rueckstand).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMietvertragRueckstand — Forderungen ohne sollmonat werden ignoriert
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — Forderungen ohne sollmonat', () => {
  it('excludes demands that have no sollmonat', () => {
    const forderungen = [
      { id: 'f-null', sollmonat: null, sollbetrag: 1000 },
      makeForderung('2025-01', 500),
    ];
    const zahlungen = [makeZahlung('z1', 500, 'Miete', '2025-01')];

    const { gesamtForderungen, rueckstand } = calculateMietvertragRueckstand(
      mockMietvertrag, forderungen, zahlungen
    );

    // Only the demand with a sollmonat is counted
    expect(gesamtForderungen).toBe(500);
    expect(rueckstand).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateRuecklastschriftGebuehren — bonus coverage
// ---------------------------------------------------------------------------
describe('calculateRuecklastschriftGebuehren', () => {
  it('returns 0 for empty array', () => {
    expect(calculateRuecklastschriftGebuehren([])).toBe(0);
  });

  it('sums ruecklastschrift_gebuehr only from Rücklastschrift entries', () => {
    const zahlungen = [
      { id: 'z1', kategorie: 'Rücklastschrift', ruecklastschrift_gebuehr: 25 },
      { id: 'z2', kategorie: 'Rücklastschrift', ruecklastschrift_gebuehr: 10 },
      { id: 'z3', kategorie: 'Miete', ruecklastschrift_gebuehr: 100 }, // should not count
    ];
    expect(calculateRuecklastschriftGebuehren(zahlungen)).toBe(35);
  });
});

describe('nurFaelligeForderungen', () => {
  const september = { id: 's', sollmonat: '2026-09-01', sollbetrag: 800, faelligkeitsdatum: '2026-09-08' };
  const oktober = { id: 'o', sollmonat: '2026-10-01', sollbetrag: 800, faelligkeitsdatum: '2026-10-08' };
  const ohneDatum = { id: 'x', sollmonat: '2026-08-01', sollbetrag: 50, faelligkeitsdatum: null };

  it('zählt die laufende Monatsmiete erst ab ihrer Fälligkeit', () => {
    // 27.10.2026: Die Mahnung zählte am 3.10. den Oktober schon mit — 1.600 statt 800 €
    expect(nurFaelligeForderungen([september, oktober], new Date(2026, 9, 3)).map((f) => f.id)).toEqual(['s']);
    expect(nurFaelligeForderungen([september, oktober], new Date(2026, 9, 7, 23, 59)).map((f) => f.id)).toEqual(['s']);
    expect(nurFaelligeForderungen([september, oktober], new Date(2026, 9, 8, 0, 1)).map((f) => f.id)).toEqual(['s', 'o']);
  });

  it('lässt Forderungen ohne Fälligkeitsdatum weg', () => {
    expect(nurFaelligeForderungen([ohneDatum], new Date(2026, 9, 27))).toEqual([]);
  });

  it('ergibt mit der Rückstandsberechnung den Mahnbetrag der Rückstandsliste', () => {
    const zahlungen = [{ id: 'z', betrag: 0, buchungsdatum: '2026-10-02', kategorie: 'Miete', zugeordneter_monat: '2026-10' }];
    const faellig = nurFaelligeForderungen([september, oktober], new Date(2026, 9, 3));
    expect(calculateMietvertragRueckstand(mockMietvertrag, faellig, zahlungen).rueckstand).toBe(800);
  });
});

describe('leseForderungsbetrag (Forderung bearbeiten)', () => {
  it('liest Beträge mit Punkt oder Komma, auch negativ und 0', () => {
    expect(leseForderungsbetrag('600')).toBe(600);
    expect(leseForderungsbetrag(' 612,5 ')).toBe(612.5);
    expect(leseForderungsbetrag('-148.26')).toBe(-148.26);
    expect(leseForderungsbetrag('0')).toBe(0);
  });

  it('macht aus einem leeren oder unlesbaren Feld keine Forderung über 0 €', () => {
    // 27.10.2026: parseFloat('') || 0 speicherte still 0
    expect(leseForderungsbetrag('')).toBeNull();
    expect(leseForderungsbetrag('  ')).toBeNull();
    expect(leseForderungsbetrag('abc')).toBeNull();
    expect(leseForderungsbetrag('1.000,00')).toBeNull();
  });

  it('liefert für -0 eine 0 und für übergroße Ziffernfolgen nichts', () => {
    // QA 27.10.2026
    expect(Object.is(leseForderungsbetrag('-0'), 0)).toBe(true);
    expect(leseForderungsbetrag('9'.repeat(400))).toBeNull();
  });

  it('wird von der Vertragsansicht benutzt', () => {
    const quelle = readFileSync('src/components/dashboard/mietvertrag-details/MietvertragTimelineView.tsx', 'utf-8');
    expect(quelle).not.toMatch(/sollbetrag = parseFloat\(newValue\) \|\| 0/);
    expect(quelle).toMatch(/leseForderungsbetrag\(newValue\)/);
  });
});

describe('Vertragsdetail und Rückstandsliste', () => {
  it('rechnen beide nur mit fälligen Forderungen und blenden Verträge mit Saldo nicht nach Miete aus', () => {
    // 27.10.2026: Das Detail zeigte vom 1. bis 7. die nicht fällige Miete als Rückstand
    const detail = readFileSync('src/components/dashboard/mietvertrag-details/MietvertragPaymentsSection.tsx', 'utf-8');
    expect(detail).toMatch(/berechneMietkontostand\(\s*vertrag,\s*forderungen \|\| \[\],/);
    expect(detail).not.toMatch(/calculateMietvertragRueckstand\(/);
    expect(detail).toMatch(/finanzFehler \?/);
    const liste = readFileSync('src/hooks/useRueckstaende.ts', 'utf-8');
    expect(liste).toMatch(/berechneMietkontostand\(\s*mietvertrag,\s*mietvertragForderungen,/);
    expect(liste).not.toMatch(/calculateMietvertragRueckstand\(/);
    expect(liste).not.toMatch(/=== 0 && \(mietvertrag\.betriebskosten \|\| 0\) === 0\) continue;/);
    expect(liste).not.toMatch(/from\('dokumente'\)/);
    // Review 28.10.2026: Beim Laden zeigte die Übersicht alle Zahlungen als Guthaben
    expect(detail).toMatch(/\) : finanzLaedt \? \(/);
    expect(readFileSync('src/components/dashboard/mietvertrag-details/MietvertragOverviewTab.tsx', 'utf-8')).toMatch(/finanzLaedt=\{finanzLaedt\}/);
    const mahnung = readFileSync('src/components/dashboard/MietvertragDetailsModal.tsx', 'utf-8');
    expect(mahnung).toMatch(/finanzLaedt=\{finanzLaedt\}/);
    expect(mahnung).toMatch(/rueckstand=\{Math\.max\(0, berechneMietkontostand\(vertrag, forderungen \|\| \[\], zahlungen \|\| \[\]\)\.rueckstand\)\}/);
  });

  it('zeigen im Kopf der Liste den Bestand, nicht die Auswahl nach Suche und Filter', () => {
    // 28.10.2026: Mit Filter „Guthaben“ verschwand die Rückstandssumme aus dem Kopf
    const ansicht = readFileSync('src/components/dashboard/FehlendeMietzahlungen.tsx', 'utf-8');
    expect(ansicht).toMatch(/const nichtBeendet = \(fehlendeMietzahlungen \?\? \[\]\)/);
    expect(ansicht).toMatch(/<p className="eyebrow">Rückstände<\/p>\s*<p[^>]*>\s*\{formatBetrag\(kopfRueckstand\)\}/);
    expect(ansicht).toMatch(/<p className="eyebrow">Guthaben<\/p>\s*<p[^>]*>\s*\{formatBetrag\(kopfGuthaben\)\}/);
    expect(ansicht).not.toMatch(/4\. Werktag/);
    expect(ansicht).not.toMatch(/Vertrag\{[a-zA-Z.]+ !== 1 \? 'e' : ''\}/);
  });
});

// ---------------------------------------------------------------------------
// Rundung und Gutschriften (28.10.2026)
// ---------------------------------------------------------------------------
describe('calculateMietvertragRueckstand — auf Cent gerundet', () => {
  it('lässt keinen Gleitkommarest stehen, der als „Rückstand 0,00 €“ erschiene', () => {
    // Live am 28.10.2026: zwei Verträge mit 3,6e-12 bzw. -1,8e-12
    const forderungen = [makeForderung('2025-01', 0.1), makeForderung('2025-02', 0.2)];
    const zahlungen = [makeZahlung('z1', 0.3, 'Miete', '2025-02')];
    const { rueckstand } = calculateMietvertragRueckstand(mockMietvertrag, forderungen, zahlungen);
    expect(Object.is(rueckstand, 0)).toBe(true);

    const r2 = calculateMietvertragRueckstand(mockMietvertrag, [makeForderung('2025-01', 0.3)], [
      makeZahlung('z1', 0.1, 'Miete', '2025-01'),
      makeZahlung('z2', 0.2, 'Miete', '2025-01'),
    ]);
    expect(Object.is(r2.rueckstand, 0)).toBe(true);
  });
});

describe('nurFaelligeForderungen — Gutschriften', () => {
  const bkaGuthaben = { id: 'g', sollmonat: '2025-12-01', sollbetrag: -150, faelligkeitsdatum: '2026-11-27', typ: 'BKA' };
  const minderungDezember = { id: 'm', sollmonat: '2026-12-01', sollbetrag: -100, faelligkeitsdatum: '2026-12-08', typ: 'Miete' };

  it('zählt ein BKA-Guthaben ab seinem Monat, nicht erst 30 Tage nach der Anlage', () => {
    expect(nurFaelligeForderungen([bkaGuthaben], new Date(2026, 9, 28)).map((f) => f.id)).toEqual(['g']);
  });

  it('lässt eine Minderung (typ Miete) der Fälligkeit ihrer Monatsmiete folgen', () => {
    // Review 28.10.2026: ab dem 1. gezählt, hätte sie den Mahnbetrag vom 1. bis 7. um die Minderung gesenkt
    expect(nurFaelligeForderungen([minderungDezember], new Date(2026, 9, 28))).toEqual([]);
    expect(nurFaelligeForderungen([minderungDezember], new Date(2026, 11, 7))).toEqual([]);
    expect(nurFaelligeForderungen([minderungDezember], new Date(2026, 11, 8)).map((f) => f.id)).toEqual(['m']);
  });

  it('zählt ein BKA-Guthaben für einen künftigen Monat noch nicht', () => {
    const kuenftig = { ...bkaGuthaben, id: 'k', sollmonat: '2026-12-01' };
    expect(nurFaelligeForderungen([kuenftig], new Date(2026, 9, 28))).toEqual([]);
  });

  it('macht aus einem ausgezahlten BKA-Guthaben keinen Rückstand', () => {
    // Auszahlung sofort im Konto, Gutschrift bis zum 28.10.2026 erst 30 Tage später
    const auszahlung = { id: 'a', betrag: -150, buchungsdatum: '2026-10-28', kategorie: 'Betriebskostenabrechnung', zugeordneter_monat: '2026-11' };
    const stand = berechneMietkontostand(mockMietvertrag, [bkaGuthaben], [auszahlung], new Date(2026, 9, 28));
    expect(stand.rueckstand).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// berechneMietkontostand — Vorauszahlung ist kein Guthaben (28.10.2026)
// ---------------------------------------------------------------------------
describe('berechneMietkontostand', () => {
  const sept = { id: 'f9', sollmonat: '2026-09-01', sollbetrag: 800, faelligkeitsdatum: '2026-09-08' };
  const okt = { id: 'f10', sollmonat: '2026-10-01', sollbetrag: 800, faelligkeitsdatum: '2026-10-08' };
  const zahlung = (id: string, betrag: number, buchungsdatum: string, zugeordneter_monat: string, kategorie = 'Miete') =>
    ({ id, betrag, buchungsdatum, kategorie, zugeordneter_monat });
  const septBezahlt = zahlung('z9', 800, '2026-09-01', '2026-09');

  it('zeigt die vor dem 8. gezahlte Monatsmiete nicht als Guthaben', () => {
    // Am 05.10.2026 standen so 48 Verträge mit einer Monatsmiete Guthaben in der Liste
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-10-01', '2026-10')];
    const am3 = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 3));
    expect(am3).toEqual({ gesamtForderungen: 800, gesamtZahlungen: 1600, rueckstand: 0, vorauszahlung: 800, nichtFaellig: 800 });
    const am8 = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 8));
    expect(am8).toEqual({ gesamtForderungen: 1600, gesamtZahlungen: 1600, rueckstand: 0, vorauszahlung: 0, nichtFaellig: 0 });
  });

  it('zeigt eine Zahlung ab dem 28. für den Folgemonat nicht als Guthaben, bevor dessen Forderung existiert', () => {
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-09-29', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 30));
    expect(stand.rueckstand).toBe(0);
    expect(stand.vorauszahlung).toBe(800);
  });

  it('weist nur den Teil über der Vorauszahlung als Guthaben aus', () => {
    const zahlungen = [septBezahlt, zahlung('z10', 900, '2026-10-01', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 3));
    expect(stand.rueckstand).toBe(-100);
    expect(stand.vorauszahlung).toBe(800);
  });

  it('lässt den Rückstand unverändert — Zahlungen tilgen zuerst die fällige Schuld', () => {
    const zahlungen = [zahlung('z10', 500, '2026-10-02', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 3));
    expect(stand.rueckstand).toBe(300);
    expect(stand.vorauszahlung).toBe(0);

    // Verspätete Septembermiete am 29.09., von der DB dem Oktober zugeordnet: ausgeglichen, keine Vorauszahlung
    const spaet = berechneMietkontostand(mockMietvertrag, [sept], [zahlung('z9', 800, '2026-09-29', '2026-10')], new Date(2026, 8, 30));
    expect(spaet).toMatchObject({ rueckstand: 0, vorauszahlung: 0 });
  });

  it('behält ein echtes Guthaben, etwa nach Vertragsende', () => {
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-10-02', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 9, 28));
    expect(stand.rueckstand).toBe(-800);
    expect(stand.vorauszahlung).toBe(0);
  });

  it('zählt Kaution und andere Kategorien auch nicht als Vorauszahlung', () => {
    const zahlungen = [septBezahlt, zahlung('k', 2400, '2026-09-29', '2026-10', 'Mietkaution')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 30));
    expect(stand).toMatchObject({ gesamtZahlungen: 800, rueckstand: 0, vorauszahlung: 0 });
  });

  it('senkt den Rückstand vom 1. bis 7. nicht um eine Minderung des laufenden Monats', () => {
    const minderungOkt = { id: 'm10', sollmonat: '2026-10-01', sollbetrag: -100, faelligkeitsdatum: '2026-10-08', typ: 'Miete' };
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, minderungOkt], [], new Date(2026, 9, 3));
    expect(stand).toMatchObject({ rueckstand: 800, vorauszahlung: 0, nichtFaellig: 700 });
  });

  it('rechnet eine noch nicht fällige Minderung gegen die Vorauszahlung', () => {
    // Review 28.10.2026: je Forderung auf 0 begrenzt, versteckte die Vorauszahlung 100 € echtes Guthaben
    const minderungOkt = { id: 'm10', sollmonat: '2026-10-01', sollbetrag: -100, faelligkeitsdatum: '2026-10-08', typ: 'Miete' };
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-10-01', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, minderungOkt], zahlungen, new Date(2026, 9, 3));
    expect(stand).toMatchObject({ rueckstand: -100, vorauszahlung: 700, nichtFaellig: 700 });
  });

  it('lässt eine Forderung ohne Fälligkeitsdatum kein Guthaben schlucken', () => {
    const ohneDatum = { id: 'x', sollmonat: '2026-03-01', sollbetrag: 400, faelligkeitsdatum: null };
    const zahlungen = [septBezahlt, zahlung('z', 400, '2026-10-10', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, ohneDatum], zahlungen, new Date(2026, 9, 15));
    expect(stand).toMatchObject({ rueckstand: -400, vorauszahlung: 0, nichtFaellig: 0 });
  });

  it('zeigt am 1. vor der Sollstellung (05:00 UTC) die Zahlung vom Monatsende nicht als Guthaben', () => {
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-09-30', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 9, 1, 2, 0));
    expect(stand).toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
  });

  it('wertet nach Vertragsende eine Zahlung auf den Folgemonat als Guthaben', () => {
    const beendet = { ...mockMietvertrag, ende_datum: '2026-09-30' };
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-09-29', '2026-10')];
    const stand = berechneMietkontostand(beendet, [sept], zahlungen, new Date(2026, 8, 30));
    expect(stand).toMatchObject({ rueckstand: -800, vorauszahlung: 0 });

    // Review 28.10.2026: beendet, aber ohne Enddatum — ebenfalls keine Vorauszahlung
    const ohneEnde = { ...mockMietvertrag, status: 'beendet' };
    expect(berechneMietkontostand(ohneEnde, [sept], zahlungen, new Date(2026, 8, 30))).toMatchObject({ rueckstand: -800, vorauszahlung: 0 });
  });

  it('zählt eine zurückgebuchte Vorauszahlung nicht', () => {
    const zahlungen = [
      septBezahlt,
      zahlung('z10', 800, '2026-09-29', '2026-10'),
      zahlung('r10', -800, '2026-09-30', '2026-10', 'Rücklastschrift'),
      zahlung('m', 50, '2026-09-15', '2026-09'),
    ];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 30));
    expect(stand).toMatchObject({ rueckstand: -50, vorauszahlung: 0 });
  });

  it('verrechnet eine BKA-Gutschrift vom 1. bis 7. mit der noch nicht fälligen Miete', () => {
    const gutschrift = { id: 'g', sollmonat: '2025-12-01', sollbetrag: -300, faelligkeitsdatum: '2026-10-20', typ: 'BKA' };
    const am20Sept = berechneMietkontostand(mockMietvertrag, [sept, gutschrift], [septBezahlt], new Date(2026, 8, 20));
    expect(am20Sept).toMatchObject({ rueckstand: -300, vorauszahlung: 0 });
    const am3 = berechneMietkontostand(mockMietvertrag, [sept, okt, gutschrift], [septBezahlt], new Date(2026, 9, 3));
    expect(am3).toMatchObject({ rueckstand: 0, vorauszahlung: 300 });
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt, gutschrift], [septBezahlt], new Date(2026, 9, 8)).rueckstand).toBe(500);
  });

  it('erzeugt nach einer verbrauchten Gutschrift kein Scheinguthaben', () => {
    // Review 28.10.2026: Eine Begrenzung auf „selbst überzahlt“ ließ nach Auszahlung eines BKA-Guthabens
    // jeden Monat vom 1. bis 7. 300 € Guthaben stehen
    const gutschrift = { id: 'g', sollmonat: '2025-12-01', sollbetrag: -300, faelligkeitsdatum: '2026-09-20', typ: 'BKA' };
    const auszahlung = zahlung('a', -300, '2026-09-22', '2026-09', 'Betriebskostenabrechnung');
    const zahlungen = [septBezahlt, auszahlung, zahlung('z10', 800, '2026-10-01', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, gutschrift], zahlungen, new Date(2026, 9, 3));
    expect(stand).toMatchObject({ rueckstand: 0, vorauszahlung: 800 });

    // Minderung schon mit niedrigerer Zahlung verbraucht
    const minderungSept = { id: 'm9', sollmonat: '2026-09-01', sollbetrag: -200, faelligkeitsdatum: '2026-09-08', typ: 'Miete' };
    const gemindert = [zahlung('z9', 600, '2026-09-01', '2026-09'), zahlung('z10', 800, '2026-10-01', '2026-10')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, minderungSept, okt], gemindert, new Date(2026, 9, 3)))
      .toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
  });

  it('zählt Forderung und Zahlung desselben künftigen Monats nicht doppelt', () => {
    // Review 28.10.2026: Novemberforderung (vorab angelegt) und Novemberzahlung deckten 2.000 statt 1.000 €
    const nov = { id: 'f11', sollmonat: '2026-11-01', sollbetrag: 1000, faelligkeitsdatum: '2026-11-08' };
    const zahlungen = [septBezahlt, zahlung('z11', 1000, '2026-10-20', '2026-11'), zahlung('x', 500, '2026-10-20', '2026-10')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, nov], zahlungen, new Date(2026, 9, 20));
    expect(stand).toMatchObject({ rueckstand: -500, vorauszahlung: 1000 });
  });

  it('wertet die erste Miete vor einem Mietbeginn nach dem 8. als Vorauszahlung', () => {
    const anteilig = { id: 'a', sollmonat: '2026-10-01', sollbetrag: 438.71, faelligkeitsdatum: '2026-10-15' };
    const stand = berechneMietkontostand(mockMietvertrag, [anteilig], [zahlung('z', 438.71, '2026-10-10', '2026-10')], new Date(2026, 9, 12));
    expect(stand).toMatchObject({ rueckstand: 0, vorauszahlung: 438.71 });
  });

  it('wertet eine vor ihrer Fälligkeit bezahlte BKA-Nachzahlung als Vorauszahlung', () => {
    const bka = { id: 'b', sollmonat: '2025-12-01', sollbetrag: 200, faelligkeitsdatum: '2026-11-20', typ: 'BKA' };
    const zahlungen = [septBezahlt, zahlung('b', 200, '2026-10-25', '2026-10', 'Betriebskostenabrechnung')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, bka], zahlungen, new Date(2026, 9, 25));
    expect(stand).toMatchObject({ rueckstand: 0, vorauszahlung: 200 });
  });

  it('erkennt die am 26. für den Folgemonat gezahlte Miete ab dem 1. als Vorauszahlung', () => {
    // Review 28.10.2026: Die DB ordnet Zahlungen erst ab dem 28. dem Folgemonat zu. Ein Modell je
    // zugeordnetem Monat zeigte diese Zahler bis zum 7. mit einer Monatsmiete Guthaben.
    const zahlungen = [zahlung('z8', 800, '2026-08-26', '2026-08'), zahlung('z9', 800, '2026-09-26', '2026-09')];
    const am3 = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 3));
    expect(am3).toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
    // Vom 26. bis zum Monatsende fehlt die Oktoberforderung noch: so lange ist es nicht von einer
    // Überzahlung zu unterscheiden und erscheint als Guthaben
    const am27 = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 27));
    expect(am27).toMatchObject({ rueckstand: -800, vorauszahlung: 0 });
  });

  it('liefert für fehlende Daten Nullen', () => {
    const nullen = { gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0, vorauszahlung: 0, nichtFaellig: 0 };
    expect(berechneMietkontostand(null, [], [])).toEqual(nullen);
    // QA 28.10.2026: nichtFaellig bzw. Zahlungen kamen trotz fehlender Daten durch
    expect(berechneMietkontostand(null, [sept, okt], [], new Date(2026, 9, 5))).toEqual(nullen);
    expect(berechneMietkontostand(mockMietvertrag, null as any, [septBezahlt])).toEqual(nullen);
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt], null as any, new Date(2026, 8, 20))).toEqual(nullen);
  });
});

describe('calculateMietvertragRueckstand — Zahlungen ohne id', () => {
  it('zählt jede Zahlung, auch ohne id und auf einen Monat ohne Forderung', () => {
    // QA 28.10.2026: die frühere Verschiebelogik ersetzte die erste Zahlung ohne id durch die zweite
    const forderungen = [makeForderung('2025-02', 1000)];
    const zahlungen = [
      { betrag: 700, kategorie: 'Miete', zugeordneter_monat: '2025-01', buchungsdatum: '2025-01-10' },
      { betrag: 300, kategorie: 'Miete', zugeordneter_monat: '2025-01', buchungsdatum: '2025-01-20' },
    ];
    expect(calculateMietvertragRueckstand(mockMietvertrag, forderungen, zahlungen)).toEqual({
      gesamtForderungen: 1000, gesamtZahlungen: 1000, rueckstand: 0,
    });
  });
});
