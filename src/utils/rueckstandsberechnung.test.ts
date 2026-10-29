import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import {
  berechneMietkontostand,
  sollMonatsmiete,
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
    expect(mahnung).toMatch(/const mahnRueckstand = Math\.max\(0, berechneMietkontostand\(vertrag, forderungen \|\| \[\], zahlungen \|\| \[\]\)\.rueckstand\);/);
    expect(mahnung).toMatch(/rueckstand=\{mahnRueckstand\}/);
  });

  it('zeigen im Kopf der Liste den Bestand, nicht die Auswahl nach Suche und Filter', () => {
    // 28.10.2026: Mit Filter „Guthaben“ verschwand die Rückstandssumme aus dem Kopf
    const ansicht = readFileSync('src/components/dashboard/FehlendeMietzahlungen.tsx', 'utf-8');
    expect(ansicht).toMatch(/const nichtBeendet = \(fehlendeMietzahlungen \?\? \[\]\)/);
    expect(ansicht).toMatch(/Rückstände\s*<KennzahlInfo titel="Rückstände">[\s\S]*?\{formatBetrag\(kopfRueckstand\)\}/);
    expect(ansicht).toMatch(/Guthaben\s*<KennzahlInfo titel="Guthaben">[\s\S]*?\{formatBetrag\(kopfGuthaben\)\}/);
    expect(ansicht).toMatch(/const fehlendeMietzahlungen = data\?\.eintraege;/);
    expect(ansicht).not.toMatch(/4\. Werktag/);
    expect(ansicht).not.toMatch(/Vertrag\{[a-zA-Z.]+ !== 1 \? 'e' : ''\}/);
  });

  it('lassen die Startseite dieselben Daten und denselben Stichtag nutzen wie die Rückstandsliste', () => {
    // 29.10.2026: Die Kennzahlen oben rechneten mit zugeordnetem Monat, die Liste mit dem Mietkonto
    const start = readFileSync('src/components/dashboard/DashboardStats.tsx', 'utf-8');
    expect(start).toMatch(/useMietkonto\(\)/);
    expect(start).not.toMatch(/erfasste-miete/);
    expect(start).not.toMatch(/mehr eingegangen/);
    const hook = readFileSync('src/hooks/useRueckstaende.ts', 'utf-8');
    // Alle Verträge, die im Monat laufen, auch beendete mit Ende im Monat; offen/älter zählt monatsSaldo nur für
    // aktive und gekündigte wie die Liste (Review und Prüfung 29.10.2026)
    expect(hook).toMatch(/monatsSaldo\(\s*\(mietvertraege \|\| \[\]\)\.filter\(\(mv\) => \['aktiv', 'gekuendigt', 'beendet'\]\.includes\(mv\.status\) && laeuftImMonat\(mv, monatKey\)\),\s*alleForderungen,\s*alleZahlungen,\s*stichtag\s*\)/);
    expect(hook).toMatch(/typ, ruecklastschrift_am'\)/);
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
    expect(am3).toEqual({ gesamtForderungen: 800, gesamtZahlungen: 1600, rueckstand: 0, vorauszahlung: 800, nichtFaellig: 800, bkaOhneForderung: 0 });
    const am8 = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 8));
    expect(am8).toEqual({ gesamtForderungen: 1600, gesamtZahlungen: 1600, rueckstand: 0, vorauszahlung: 0, nichtFaellig: 0, bkaOhneForderung: 0 });
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
    // Vor dem Fälligkeitstag gezahlt: kann keine Vorauszahlung auf November sein
    const zahlungen = [septBezahlt, zahlung('z', 400, '2026-10-05', '2026-10')];
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
      zahlung('m', 50, '2026-09-05', '2026-09'),
    ];
    const stand = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 30));
    expect(stand).toMatchObject({ rueckstand: -50, vorauszahlung: 0 });
  });

  it('lässt eine BKA-Gutschrift Guthaben, bis die nächste Miete fällig ist', () => {
    const gutschrift = { id: 'g', sollmonat: '2025-12-01', sollbetrag: -300, faelligkeitsdatum: '2026-10-20', typ: 'BKA' };
    const am20Sept = berechneMietkontostand(mockMietvertrag, [sept, gutschrift], [septBezahlt], new Date(2026, 8, 20));
    expect(am20Sept).toMatchObject({ rueckstand: -300, vorauszahlung: 0 });
    const am3 = berechneMietkontostand(mockMietvertrag, [sept, okt, gutschrift], [septBezahlt], new Date(2026, 9, 3));
    expect(am3).toMatchObject({ rueckstand: -300, vorauszahlung: 0 });
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
    // Bis zum 28.10.2026 erschien sie vom 26. bis Monatsende als Guthaben, weil die Oktoberforderung
    // noch fehlte; jetzt deckt sie die kommende Miete laut Vertrag
    const am27 = berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 27));
    expect(am27).toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
  });

  it('erkennt eine Folgemiete ab dem 9. als Vorauszahlung, auch ohne angelegte Forderung', () => {
    // Live am 28.10.2026: 320 € am 25., 100 € (zwei Monatsmieten einer Garage) am 21.
    const zahlungen = [septBezahlt, zahlung('z', 800, '2026-09-21', '2026-09')];
    expect(berechneMietkontostand(mockMietvertrag, [sept], zahlungen, new Date(2026, 8, 22)))
      .toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
    // Mehr als die kommende Miete ist Guthaben. Erwartet wird, was die Sollstellung anlegen wird:
    // Kalt + Betriebskosten des Vertrags, hier 1.000 €. Eine Min-Regel mit der Vormonatsforderung
    // beruhte auf einem Rückblick mit heutiger Miete und wurde am 29.10.2026 verworfen.
    const zuViel = [septBezahlt, zahlung('z', 1300, '2026-09-21', '2026-09')];
    expect(berechneMietkontostand(mockMietvertrag, [sept], zuViel, new Date(2026, 8, 22)))
      .toMatchObject({ rueckstand: -300, vorauszahlung: 1000 });
    // Endet der Vertrag Mitte Oktober, ist nur die anteilige Oktobermiete zu erwarten
    const endetMitte = { ...mockMietvertrag, ende_datum: '2026-10-15' };
    expect(berechneMietkontostand(endetMitte, [sept], zuViel, new Date(2026, 8, 22)))
      .toMatchObject({ rueckstand: -816.13, vorauszahlung: 483.87 });
  });

  it('zeigt ein altes Guthaben den ganzen Monat gleich, auch um den Fälligkeitstag', () => {
    // Bis zum 28.10.2026 verschwand es vom 1. bis 7. in der noch nicht fälligen Miete
    const aug = { id: 'f8', sollmonat: '2026-08-01', sollbetrag: 800, faelligkeitsdatum: '2026-08-08' };
    const zahlungen = [
      zahlung('z8', 850, '2026-08-01', '2026-08'),
      zahlung('z9', 800, '2026-09-01', '2026-09'),
      zahlung('z10', 800, '2026-09-26', '2026-09'),
      zahlung('z11', 800, '2026-11-02', '2026-11'),
    ];
    const nov = { id: 'f11', sollmonat: '2026-11-01', sollbetrag: 800, faelligkeitsdatum: '2026-11-08' };
    const stichtage: Array<[Date, (typeof sept)[]]> = [
      [new Date(2026, 8, 3), [aug, sept]],
      [new Date(2026, 8, 20), [aug, sept]],
      [new Date(2026, 8, 27), [aug, sept]],
      [new Date(2026, 9, 3), [aug, sept, okt]],
      [new Date(2026, 9, 20), [aug, sept, okt]],
      [new Date(2026, 10, 3), [aug, sept, okt, nov]],
    ];
    for (const [tag, forderungen] of stichtage) {
      const z = zahlungen.filter((x) => x.buchungsdatum <= format(tag, 'yyyy-MM-dd'));
      expect(berechneMietkontostand(mockMietvertrag, forderungen, z, tag).rueckstand, format(tag, 'yyyy-MM-dd')).toBe(-50);
    }
  });

  it('zeigt eine doppelt gezahlte Monatsmiete nach dem Fälligkeitstag als Guthaben', () => {
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-10-01', '2026-10'), zahlung('z10b', 800, '2026-10-02', '2026-10')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 3)).rueckstand).toBe(-800);
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 20)).rueckstand).toBe(-800);
  });

  it('liefert für fehlende Daten Nullen', () => {
    const nullen = { gesamtForderungen: 0, gesamtZahlungen: 0, rueckstand: 0, vorauszahlung: 0, nichtFaellig: 0, bkaOhneForderung: 0 };
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

describe('sollMonatsmiete (Nachbildung der Sollstellung)', () => {
  const v = { status: 'aktiv', start_datum: '2024-03-01', ende_datum: null, kuendigungsdatum: null, kaltmiete: 800, betriebskosten: 200 };

  it('legt die volle Miete an, wenn der Vertrag den ganzen Monat läuft', () => {
    expect(sollMonatsmiete(v, '2026-11')).toBe(1000);
  });

  it('rechnet Beginn- und Endmonat taggenau anteilig wie generate_monthly_mietforderungen', () => {
    // (1000 / 30) * 16 = 533,33 — Beginn am 15.11.
    expect(sollMonatsmiete({ ...v, start_datum: '2026-11-15' }, '2026-11')).toBe(533.33);
    // Ende am 15.10.: (1000 / 31) * 15 = 483,87
    expect(sollMonatsmiete({ ...v, ende_datum: '2026-10-15' }, '2026-10')).toBe(483.87);
    // Ende über das Kündigungsdatum (getVertragsende)
    expect(sollMonatsmiete({ ...v, status: 'gekuendigt', kuendigungsdatum: '2026-10-15' }, '2026-10')).toBe(483.87);
  });

  it('legt außerhalb der Laufzeit und für beendete Verträge ohne Ende nichts an', () => {
    expect(sollMonatsmiete({ ...v, start_datum: '2026-12-01' }, '2026-11')).toBe(0);
    expect(sollMonatsmiete({ ...v, ende_datum: '2026-10-31' }, '2026-11')).toBe(0);
    expect(sollMonatsmiete({ ...v, status: 'beendet' }, '2026-11')).toBe(0);
    expect(sollMonatsmiete(null, '2026-11')).toBe(0);
  });
});

describe('Review 29.10.2026', () => {
  const sept = { id: 'f9', sollmonat: '2026-09-01', sollbetrag: 800, faelligkeitsdatum: '2026-09-08' };
  const okt = { id: 'f10', sollmonat: '2026-10-01', sollbetrag: 800, faelligkeitsdatum: '2026-10-08' };
  const zahlung = (id: string, betrag: number, buchungsdatum: string, zugeordneter_monat: string, kategorie = 'Miete') =>
    ({ id, betrag, buchungsdatum, kategorie, zugeordneter_monat });
  const septBezahlt = zahlung('z9', 800, '2026-09-01', '2026-09');

  it('lässt eine vorab bezahlte BKA-Nachzahlung keinen Mietrückstand tilgen', () => {
    // Oktober unbezahlt, BKA-Nachzahlung (fällig erst 20.11.) am 25.10. bezahlt: Rückstand bleibt 800
    const bka = { id: 'b', sollmonat: '2025-12-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-20', typ: 'BKA' };
    const zahlungen = [septBezahlt, zahlung('b', 300, '2026-10-25', '2026-10', 'Betriebskostenabrechnung')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, bka], zahlungen, new Date(2026, 9, 29));
    expect(stand).toMatchObject({ rueckstand: 800, vorauszahlung: 300 });
    // Was über die BKA-Forderung hinaus gezahlt ist, ist eine BKA-Zahlung ohne Forderung (Entscheidung 29.10.2026)
    const zuViel = [septBezahlt, zahlung('z10', 800, '2026-10-01', '2026-10'), zahlung('b', 350, '2026-10-25', '2026-10', 'Betriebskostenabrechnung')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt, bka], zuViel, new Date(2026, 9, 29)))
      .toMatchObject({ rueckstand: 0, vorauszahlung: 300, bkaOhneForderung: 50 });
  });

  it('hält eine Rücklastschrift-Gebühr im Folgemonat nicht für die angelegte Monatsmiete', () => {
    const gebuehr = { id: 'g', sollmonat: '2026-11-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-29', ruecklastschrift_am: '2026-10-29' };
    const zahlungen = [septBezahlt, zahlung('z10', 800, '2026-10-01', '2026-10'), zahlung('z11', 800, '2026-10-26', '2026-10'), zahlung('zg', 7.5, '2026-10-29', '2026-11')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, gebuehr], zahlungen, new Date(2026, 9, 30));
    expect(stand).toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
  });

  it('erkennt eine vor dem 8. gebuchte, ausdrücklich dem Folgemonat zugeordnete Zahlung', () => {
    // Zwei Monatsmieten am 03.10., aufgeteilt auf Oktober und November
    const zahlungen = [septBezahlt, zahlung('a', 800, '2026-10-03', '2026-10'), zahlung('b', 800, '2026-10-03', '2026-11')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 29)))
      .toMatchObject({ rueckstand: 0, vorauszahlung: 800 });
    // Ohne Zuordnung ist sie nicht von einer Doppelzahlung zu unterscheiden: Guthaben bis zur Novembermiete
    const ohne = [septBezahlt, zahlung('a', 1600, '2026-10-03', '2026-10')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt], ohne, new Date(2026, 9, 29)).rueckstand).toBe(-800);
  });

  it('rundet anteilige Monate wie Postgres numeric (Werte aus monatsanteil der Live-DB)', () => {
    const v = (betrag: number, start: string | null, ende: string | null) =>
      ({ status: 'aktiv', start_datum: start ?? '2000-01-01', ende_datum: ende, kaltmiete: betrag, betriebskosten: 0 });
    // QA 29.10.2026: Gleitkomma ergab 1.615,82 €
    expect(sollMonatsmiete(v(3231.65, '2026-11-16', null), '2026-11')).toBe(1615.83);
    expect(sollMonatsmiete(v(3231.65, null, '2026-11-16'), '2026-11')).toBe(1723.55);
    expect(sollMonatsmiete(v(0.15, '2026-11-16', null), '2026-11')).toBe(0.08);
    expect(sollMonatsmiete(v(15, '2026-11-16', null), '2026-11')).toBe(7.5);
    expect(sollMonatsmiete(v(15, null, '2026-11-16'), '2026-11')).toBe(8);
  });
});

describe('Review 29.10.2026, zweite Runde', () => {
  const sept = { id: 'f9', sollmonat: '2026-09-01', sollbetrag: 800, faelligkeitsdatum: '2026-09-08' };
  const okt = { id: 'f10', sollmonat: '2026-10-01', sollbetrag: 800, faelligkeitsdatum: '2026-10-08' };
  const zahlung = (id: string, betrag: number, buchungsdatum: string, zugeordneter_monat: string, kategorie = 'Miete') =>
    ({ id, betrag, buchungsdatum, kategorie, zugeordneter_monat });

  it('macht aus einem fälligen BKA-Guthaben keine BKA-Vorauszahlung', () => {
    // Guthaben −300 (fällig) und eine noch nicht fällige Nachzahlung +500 eines anderen Jahres, keine BKA-Zahlung
    const guthaben = { id: 'g', sollmonat: '2024-12-01', sollbetrag: -300, faelligkeitsdatum: '2026-11-25', typ: 'BKA' };
    const nachzahlung = { id: 'n', sollmonat: '2025-12-01', sollbetrag: 500, faelligkeitsdatum: '2026-11-25', typ: 'BKA' };
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt, guthaben, nachzahlung], [zahlung('z9', 800, '2026-09-01', '2026-09')], new Date(2026, 9, 29));
    // Oktober offen 800, abzüglich BKA-Guthaben 300: Rückstand 500, nicht 800
    expect(stand).toMatchObject({ rueckstand: 500, vorauszahlung: 0 });
  });

  it('erkennt eine erlassene Monatsmiete (0 €) als angelegt', () => {
    const erlassen = { id: 'f11', sollmonat: '2026-11-01', sollbetrag: 0, faelligkeitsdatum: '2026-11-08' };
    const zahlungen = [zahlung('z9', 800, '2026-09-01', '2026-09'), zahlung('z10', 800, '2026-10-01', '2026-10'), zahlung('x', 800, '2026-11-02', '2026-11')];
    // November erlassen: die Zahlung am 02.11. deckt keine kommende Miete, sie ist Guthaben
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt, erlassen], zahlungen, new Date(2026, 10, 3)).rueckstand).toBe(-800);
  });
});

describe('Sonderfälle 29.10.2026 — BKA-Zahlung ohne BKA-Forderung', () => {
  const sept = { id: 'f9', sollmonat: '2026-09-01', sollbetrag: 800, faelligkeitsdatum: '2026-09-08' };
  const okt = { id: 'f10', sollmonat: '2026-10-01', sollbetrag: 800, faelligkeitsdatum: '2026-10-08' };
  const zahlung = (id: string, betrag: number, buchungsdatum: string, kategorie = 'Miete') =>
    ({ id, betrag, buchungsdatum, kategorie, zugeordneter_monat: buchungsdatum.slice(0, 7) });

  it('tilgt keine Miete, wenn die Abrechnung nicht als Forderung angelegt ist', () => {
    // Live: Rückstand 97,73 € statt 482,00 €, weil 384,27 € BKA-Zahlung die Miete ausglich
    const zahlungen = [zahlung('z9', 800, '2026-09-01'), zahlung('b', 384.27, '2026-03-23', 'Betriebskostenabrechnung')];
    const stand = berechneMietkontostand(mockMietvertrag, [sept, okt], zahlungen, new Date(2026, 9, 29));
    expect(stand).toMatchObject({ rueckstand: 800, gesamtZahlungen: 800, bkaOhneForderung: 384.27 });
  });

  it('rechnet sie an, sobald die BKA-Forderung angelegt ist', () => {
    const bka = { id: 'b', sollmonat: '2025-12-01', sollbetrag: 384.27, faelligkeitsdatum: '2026-03-01', typ: 'BKA' };
    const zahlungen = [zahlung('z9', 800, '2026-09-01'), zahlung('z10', 800, '2026-10-01'), zahlung('b', 384.27, '2026-03-23', 'Betriebskostenabrechnung')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt, bka], zahlungen, new Date(2026, 9, 29)))
      .toMatchObject({ rueckstand: 0, bkaOhneForderung: 0 });
  });

  it('lässt eine Auszahlung über das BKA-Guthaben hinaus ebenfalls außen vor', () => {
    const gutschrift = { id: 'g', sollmonat: '2025-12-01', sollbetrag: -150, faelligkeitsdatum: '2026-09-20', typ: 'BKA' };
    const zahlungen = [zahlung('z9', 800, '2026-09-01'), zahlung('z10', 800, '2026-10-01'), zahlung('a', -200, '2026-09-22', 'Betriebskostenabrechnung')];
    expect(berechneMietkontostand(mockMietvertrag, [sept, okt, gutschrift], zahlungen, new Date(2026, 9, 29)))
      // Die Gutschrift (150) ist mit der Auszahlung verbraucht; die 50 € zu viel ausgezahlt stehen als Hinweis
      .toMatchObject({ rueckstand: 0, bkaOhneForderung: -50 });
  });
});

describe('Rückstandsliste — Hinweis BKA-Zahlung ohne Forderung auch bei Saldo 0', () => {
  it('sammelt die Hinweise unabhängig vom Saldo und zeigt sie als eigenen Block', () => {
    // Review 29.10.2026: Ein Vertrag mit bezahlter Miete und BKA-Zahlung ohne Forderung hat Saldo 0
    // und stand deshalb gar nicht in der Liste
    const hook = readFileSync('src/hooks/useRueckstaende.ts', 'utf-8');
    const block = hook.slice(hook.indexOf('if (bkaOhneForderung !== 0) {'), hook.indexOf('if (Math.abs(rueckstand) >= 0.01) {'));
    expect(block).toMatch(/bkaHinweise\.push\(/);
    expect(hook).toMatch(/bkaOhneForderung: bkaHinweise[,\s}]/);
    const ansicht = readFileSync('src/components/dashboard/FehlendeMietzahlungen.tsx', 'utf-8');
    expect(ansicht).toMatch(/Zu prüfen: BKA-Zahlungen ohne BKA-Forderung/);
    expect(ansicht).toMatch(/bkaHinweise\.map\(/);
  });
});

describe('berechneMietkontostand — Prüfung des Rechenmodells 29.10.2026', () => {
  const v = { id: 'V', status: 'aktiv', start_datum: '2024-01-01', kaltmiete: 500, betriebskosten: 0 };
  const z = (betrag: number, buchungsdatum: string, kategorie = 'Miete', monat = buchungsdatum.slice(0, 7)) =>
    ({ mietvertrag_id: 'V', betrag, buchungsdatum, kategorie, zugeordneter_monat: monat });

  it('macht aus einem ausgezahlten BKA-Guthaben und einer vorab bezahlten Nachzahlung kein Scheinguthaben', () => {
    const forderungen = [
      { mietvertrag_id: 'V', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'V', sollmonat: '2026-06-01', sollbetrag: -100, faelligkeitsdatum: '2026-07-01', typ: 'BKA' },
      { mietvertrag_id: 'V', sollmonat: '2026-10-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-20', typ: 'BKA' },
    ];
    const zahlungen = [z(500, '2026-10-01'), z(-100, '2026-07-10', 'Betriebskostenabrechnung'), z(300, '2026-10-25', 'Betriebskostenabrechnung')];
    expect(berechneMietkontostand(v, forderungen, zahlungen, new Date(2026, 9, 29, 12))).toMatchObject({ rueckstand: 0, vorauszahlung: 300 });
  });

  it('lässt eine Rücklastschrift nach dem 8. keine spätere Vorauszahlung aufheben', () => {
    // Guthaben 600 aus September, Oktobermiete am 02.10. per Lastschrift, geplatzt am 10.10. (503 € mit Bankgebühr),
    // Novembermiete am 25.10. bezahlt: Guthaben 89,50 €, Vorauszahlung 500 €
    const forderungen = [
      { mietvertrag_id: 'V', sollmonat: '2026-09-01', sollbetrag: 500, faelligkeitsdatum: '2026-09-08', typ: 'Miete' },
      { mietvertrag_id: 'V', sollmonat: '2026-10-01', sollbetrag: 500, faelligkeitsdatum: '2026-10-08', typ: 'Miete' },
      { mietvertrag_id: 'V', sollmonat: '2026-10-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-10-10', typ: 'Miete', ruecklastschrift_am: '2026-10-10' },
    ];
    const zahlungen = [z(1100, '2026-09-01'), z(500, '2026-10-02'), z(-503, '2026-10-10', 'Rücklastschrift'), z(500, '2026-10-25')];
    expect(berechneMietkontostand(v, forderungen, zahlungen, new Date(2026, 9, 29, 12))).toMatchObject({ rueckstand: -89.5, vorauszahlung: 500 });
  });
});
