import { describe, it, expect } from 'vitest';
import {
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
