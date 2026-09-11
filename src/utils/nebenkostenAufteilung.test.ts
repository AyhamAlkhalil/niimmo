import { describe, it, expect, beforeEach } from 'vitest';
import {
  aufCent,
  baueAufteilungsReihen,
  betragAusProzent,
  pruefeAufteilung,
  summePositionen,
  teileKategorie,
} from './nebenkostenAufteilung';

const pos = (id: string, betrag: number) => ({ id, gesamtbetrag: betrag });

describe('teileKategorie', () => {
  it('verschiebt anteilig und trifft den Zielbetrag auf den Cent', () => {
    const positionen = [pos('a', 100), pos('b', 300)];
    const zeilen = teileKategorie(positionen, 100);

    expect(zeilen.map((z) => z.verschoben)).toEqual([25, 75]);
    expect(zeilen.map((z) => z.rest)).toEqual([75, 225]);
    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBe(100);
  });

  it('verteilt Rest-Cent an die größten Nachkommaanteile', () => {
    // 175 € auf drei gleiche Positionen: 58,33 + 58,33 + 58,34 = 175,00
    const zeilen = teileKategorie([pos('a', 100), pos('b', 100), pos('c', 100)], 175);
    const summe = zeilen.reduce((s, z) => s + z.verschoben, 0);

    expect(Math.round(summe * 100)).toBe(17500);
    zeilen.forEach((z) => expect(z.verschoben).toBeGreaterThan(58.32));
  });

  it('nimmt keiner Position mehr, als sie trägt', () => {
    const zeilen = teileKategorie([pos('a', 0.01), pos('b', 999.99)], 999.99);

    zeilen.forEach((z) => expect(z.verschoben).toBeLessThanOrEqual(z.vorher));
    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBeCloseTo(999.99, 2);
  });

  it('räumt bei voller Aufteilung die Ausgangskategorie leer', () => {
    const zeilen = teileKategorie([pos('a', 120.5), pos('b', 79.5)], 200);

    expect(zeilen.map((z) => z.rest)).toEqual([0, 0]);
    expect(zeilen.map((z) => z.verschoben)).toEqual([120.5, 79.5]);
  });

  it('lehnt mehr als die Summe, null und leere Listen ab', () => {
    expect(teileKategorie([pos('a', 100)], 100.01)).toEqual([]);
    expect(teileKategorie([pos('a', 100)], 0)).toEqual([]);
    expect(teileKategorie([], 50)).toEqual([]);
  });

  it('rechnet mit den echten Zahlen aus der Meldung', () => {
    // 2.2 Wasserversorgung: neun Abschläge über zusammen 2.629,31 €,
    // davon sind laut Endabrechnung 1.100 € Entwässerung.
    const positionen = [
      ...Array.from({ length: 8 }, (_, i) => pos(`p${i}`, 292.15)),
      pos('p8', 292.11),
    ];
    const zeilen = teileKategorie(positionen, 1100);

    expect(zeilen).toHaveLength(9);
    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBeCloseTo(1100, 2);
    expect(summePositionen(positionen)).toBe(2629.31);
    expect(zeilen.reduce((s, z) => s + z.rest, 0)).toBeCloseTo(1529.31, 2);
  });
});

describe('betragAusProzent', () => {
  it('rechnet Prozent in Euro auf Cent genau', () => {
    expect(betragAusProzent(2629.31, 42)).toBe(1104.31);
    expect(betragAusProzent(1000, 100)).toBe(1000);
  });
});

describe('pruefeAufteilung', () => {
  it('meldet leere Kategorie, unzulässige und zu große Beträge', () => {
    expect(pruefeAufteilung([], 10)).toContain('keine Position');
    expect(pruefeAufteilung([pos('a', 100)], 0)).toContain('größer null');
    expect(pruefeAufteilung([pos('a', 100)], 100.01)).toContain('100.00');
    expect(pruefeAufteilung([pos('a', 100)], 100)).toBeNull();
  });
});

describe('baueAufteilungsReihen', () => {
  const position = (id: string, betrag: number) => ({
    id,
    zahlung_id: `zahlung-${id}`,
    nebenkostenart_id: 'art-wasser',
    gesamtbetrag: betrag,
    zeitraum_von: '2025-01-01',
    zeitraum_bis: '2025-12-31',
    bezeichnung: `Abschlag ${id}`,
    quelle: 'zahlung',
    ist_umlagefaehig: true,
    erstellt_von: null,
  });

  const ziel = { nebenkostenartId: 'art-entwaesserung', name: 'Entwässerung', umlagefaehig: true };
  let zaehler = 0;
  const neueId = () => `neu-${++zaehler}`;

  beforeEach(() => {
    zaehler = 0;
  });

  it('legt je geteilter Position eine gekuerzte und eine neue Zeile an', () => {
    const positionen = [position('a', 100), position('b', 300)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 100),
      ziel,
      'im1',
      { neueId }
    );

    expect(reihen).toHaveLength(4);
    expect(reihen.map((r) => r.id)).toEqual(['a', 'neu-1', 'b', 'neu-2']);
    expect(reihen.map((r) => r.gesamtbetrag)).toEqual([75, 25, 225, 75]);
    expect(reihen.map((r) => r.nebenkostenart_id)).toEqual([
      'art-wasser',
      'art-entwaesserung',
      'art-wasser',
      'art-entwaesserung',
    ]);
  });

  it('haelt die Summe je Position und insgesamt', () => {
    const positionen = [position('a', 292.15), position('b', 292.11), position('c', 1829.31)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 777.77),
      ziel,
      'im1',
      { neueId }
    );

    const summe = reihen.reduce((s, r) => s + r.gesamtbetrag, 0);
    expect(aufCent(summe)).toBe(summePositionen(positionen));
    const inZiel = reihen
      .filter((r) => r.nebenkostenart_id === 'art-entwaesserung')
      .reduce((s, r) => s + r.gesamtbetrag, 0);
    expect(aufCent(inZiel)).toBe(777.77);
  });

  it('haengt eine vollstaendig wandernde Position nur um, ohne neue ID', () => {
    const positionen = [position('a', 120.5), position('b', 79.5)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 200),
      ziel,
      'im1',
      { neueId }
    );

    expect(reihen).toHaveLength(2);
    expect(reihen.map((r) => r.id)).toEqual(['a', 'b']);
    expect(reihen.every((r) => r.nebenkostenart_id === 'art-entwaesserung')).toBe(true);
    expect(reihen.map((r) => r.gesamtbetrag)).toEqual([120.5, 79.5]);
  });

  it('gibt allen Zeilen dieselben Felder — PostgREST lehnt uneinheitliche sonst ab', () => {
    const positionen = [position('a', 100), position('b', 100)];
    // Eine Position wandert ganz, die andere nur zur Haelfte.
    const zeilen = [
      { positionId: 'a', vorher: 100, verschoben: 100, rest: 0 },
      { positionId: 'b', vorher: 100, verschoben: 50, rest: 50 },
    ];
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId });

    const felder = reihen.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(felder).size).toBe(1);
    expect(felder[0].split(',')).toEqual([
      'bezeichnung',
      'erstellt_von',
      'gesamtbetrag',
      'id',
      'immobilie_id',
      'ist_umlagefaehig',
      'nebenkostenart_id',
      'quelle',
      'zahlung_id',
      'zeitraum_bis',
      'zeitraum_von',
    ]);
  });

  it('uebernimmt Zahlung, Zeitraum und Quelle und setzt das Objekt', () => {
    const positionen = [position('a', 100)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 40),
      ziel,
      'im-neu',
      { neueId }
    );

    reihen.forEach((reihe) => {
      expect(reihe.zahlung_id).toBe('zahlung-a');
      expect(reihe.zeitraum_von).toBe('2025-01-01');
      expect(reihe.zeitraum_bis).toBe('2025-12-31');
      expect(reihe.quelle).toBe('zahlung');
      expect(reihe.immobilie_id).toBe('im-neu');
    });
  });

  it('uebergeht Positionen ohne verschobenen Anteil', () => {
    const positionen = [position('a', 100), position('b', 0)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 10),
      ziel,
      'im1',
      { neueId }
    );

    expect(reihen.map((r) => r.id)).toEqual(['a', 'neu-1']);
  });

  it('uebernimmt die Umlagefaehigkeit der Zielkategorie fuer die neue Zeile', () => {
    const positionen = [position('a', 100)];
    const reihen = baueAufteilungsReihen(
      positionen,
      teileKategorie(positionen, 40),
      { nebenkostenartId: 'art-reparatur', name: 'Reparaturen', umlagefaehig: false },
      'im1',
      { neueId }
    );

    expect(reihen.find((r) => r.id === 'a')?.ist_umlagefaehig).toBe(true);
    expect(reihen.find((r) => r.id === 'neu-1')?.ist_umlagefaehig).toBe(false);
  });
});
