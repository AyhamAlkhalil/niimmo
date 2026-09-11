import { describe, it, expect } from 'vitest';
import {
  aufCent,
  pruefeAufteilung,
  summePositionen,
  teileKategorie,
} from './nebenkostenAufteilung';
import {
  berechneAnteil,
  berechneBezugsgroessen,
  ermittlePerioden,
  personenzahlErforderlich,
  type Nutzungsperiode,
} from './nebenkostenBerechnung';

/**
 * Randfälle zu teileKategorie() / pruefeAufteilung() (Nebenkosten-Aufteilung)
 * und zur Sonderregel im Personenschlüssel (personenzahlErforderlich /
 * berechneAnteil). Ergänzt die bestehenden Dateien um Fälle, die dort noch
 * nicht abgedeckt sind.
 *
 * Aus dieser Datei stammt der Befund vom 11.09.2026, dass teileKategorie() einen
 * NaN-Zielbetrag durchließ; er ist behoben und bleibt hier abgesichert.
 */

const pos = (id: string, betrag: number) => ({ id, gesamtbetrag: betrag });
const einheit = (id: string, qm: number) => ({ id, qm });

describe('teileKategorie — sehr kleine Beträge', () => {
  it('verteilt einen einzelnen Cent auf mehrere Ein-Cent-Positionen fair', () => {
    // 3 × 0,01 € = 0,03 €, davon sollen 0,02 € verschoben werden.
    const zeilen = teileKategorie([pos('a', 0.01), pos('b', 0.01), pos('c', 0.01)], 0.02);

    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBeCloseTo(0.02, 2);
    // Die dritte Position (kleinster Nachkommaanteil im Gleichstand) bleibt leer.
    expect(zeilen.map((z) => z.verschoben)).toEqual([0.01, 0.01, 0]);
    expect(zeilen.map((z) => z.rest)).toEqual([0, 0, 0.01]);
  });

  it('verschiebt einen einzelnen Cent vollständig', () => {
    const zeilen = teileKategorie([pos('a', 0.01)], 0.01);
    expect(zeilen).toEqual([{ positionId: 'a', vorher: 0.01, verschoben: 0.01, rest: 0 }]);
  });

  it('kommt mit Fließkomma-Rundungsfehlern in den Eingabebeträgen zurecht', () => {
    // 0.1 + 0.2 ist in IEEE754 kein exaktes 0.3.
    const summe = summePositionen([pos('a', 0.1), pos('b', 0.2)]);
    expect(summe).toBe(0.3);

    const zeilen = teileKategorie([pos('a', 0.1), pos('b', 0.2)], 0.3);
    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBeCloseTo(0.3, 2);
  });
});

describe('teileKategorie — viele Positionen mit ungleichen Beträgen', () => {
  it('trifft den Zielbetrag exakt und verletzt bei 50 ungleichen Positionen keine Position', () => {
    // Deterministisch ungleiche Beträge, keine zwei Positionen gleich groß.
    const positionen = Array.from({ length: 50 }, (_, i) =>
      pos(`p${i}`, aufCent(((i * 37 + 13) % 971) / 7 + 0.01))
    );
    const summe = summePositionen(positionen);
    const ziel = aufCent(summe * 0.6371);

    const zeilen = teileKategorie(positionen, ziel);

    expect(zeilen).toHaveLength(50);
    expect(Math.round(zeilen.reduce((s, z) => s + z.verschoben, 0) * 100)).toBe(
      Math.round(ziel * 100)
    );
    expect(Math.round(zeilen.reduce((s, z) => s + z.vorher, 0) * 100)).toBe(
      Math.round(summe * 100)
    );
    zeilen.forEach((z) => {
      expect(z.verschoben).toBeGreaterThanOrEqual(0);
      expect(z.rest).toBeGreaterThanOrEqual(0);
      expect(z.verschoben).toBeLessThanOrEqual(z.vorher + 1e-9);
      expect(aufCent(z.verschoben + z.rest)).toBe(aufCent(z.vorher));
    });
  });
});

describe('teileKategorie — Zielbetrag exakt gleich der Summe', () => {
  it('räumt bei krummen Centbeträgen jede Position exakt leer', () => {
    // 33,33 + 33,33 + 33,34 = 100,00 — klassischer Drittel-Rundungsfall.
    const positionen = [pos('a', 33.33), pos('b', 33.33), pos('c', 33.34)];
    const zeilen = teileKategorie(positionen, 100);

    expect(zeilen.map((z) => z.verschoben)).toEqual([33.33, 33.33, 33.34]);
    expect(zeilen.map((z) => z.rest)).toEqual([0, 0, 0]);
  });
});

describe('teileKategorie — Positionen mit Betrag 0', () => {
  it('lässt eine Nullposition unangetastet, auch wenn Rundungscent verteilt werden', () => {
    // Summe 0,03 €, Ziel 0,02 € — die Nullposition darf nie einen Rundungscent bekommen.
    const zeilen = teileKategorie([pos('a', 0), pos('b', 0.01), pos('c', 0.02)], 0.02);

    const nullZeile = zeilen.find((z) => z.positionId === 'a')!;
    expect(nullZeile).toEqual({ positionId: 'a', vorher: 0, verschoben: 0, rest: 0 });
    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBeCloseTo(0.02, 2);
  });

  it('lehnt eine Kategorie ab, in der jede Position 0 beträgt', () => {
    expect(teileKategorie([pos('a', 0), pos('b', 0)], 10)).toEqual([]);
    expect(pruefeAufteilung([pos('a', 0), pos('b', 0)], 10)).toContain('0.00');
  });
});

describe('teileKategorie — negative Eingaben', () => {
  it('lehnt einen negativen Zielbetrag ab', () => {
    expect(teileKategorie([pos('a', 100)], -10)).toEqual([]);
  });

  it('lehnt eine Kategorie ab, deren Positionen sich zu einer negativen Summe addieren', () => {
    expect(teileKategorie([pos('a', -10), pos('b', -20)], 5)).toEqual([]);
  });

  it('bleibt bei einer einzelnen negativen Position (Gutschrift) trotzdem in sich konsistent', () => {
    // Charakterisierungstest: eine Gutschrift (-50 €) neben einer normalen Position
    // wird technisch nicht abgefangen (weder hier noch in pruefeAufteilung). Die
    // Funktion stürzt nicht ab und die Cent-Bilanz bleibt geschlossen — ob negative
    // Kostenpositionen fachlich überhaupt aufgeteilt werden dürfen, ist damit aber
    // nicht beantwortet und sollte fachlich geklärt werden.
    const zeilen = teileKategorie([pos('a', -50), pos('b', 200)], 100);

    expect(zeilen.reduce((s, z) => s + z.verschoben, 0)).toBe(100);
    zeilen.forEach((z) => expect(aufCent(z.verschoben + z.rest)).toBe(aufCent(z.vorher)));
  });
});

describe('teileKategorie — NaN', () => {
  it('lehnt einen NaN-Zielbetrag ab, genau wie pruefeAufteilung', () => {
    // Jeder Vergleich mit NaN ist false: Die Größenprüfung `zielCent <= 0 ||
    // zielCent > summeCent` allein ließ NaN durch, und die Funktion schrieb
    // NaN-Beträge in die Zeilen. Deshalb prüft sie den Betrag eigenständig.
    const positionen = [pos('a', 100), pos('b', 300)];
    expect(pruefeAufteilung(positionen, NaN)).not.toBeNull();
    expect(teileKategorie(positionen, NaN)).toEqual([]);
  });

  it('behandelt eine NaN-Position wie eine Position mit Betrag 0 (durch `|| 0` abgefangen)', () => {
    const zeilen = teileKategorie([pos('a', NaN), pos('b', 100)], 50);

    const naZeile = zeilen.find((z) => z.positionId === 'a')!;
    expect(naZeile).toEqual({ positionId: 'a', vorher: 0, verschoben: 0, rest: 0 });
    expect(zeilen.find((z) => z.positionId === 'b')?.verschoben).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Personenschlüssel: mehrere Einheiten mit Leerstand
// ---------------------------------------------------------------------------
describe('Personenschlüssel — mehrere Einheiten mit Leerstand', () => {
  const ABR_VON = new Date(2025, 0, 1);
  const ABR_BIS = new Date(2025, 11, 31);
  const GESAMT_TAGE = 365;

  it('eine belegte Einheit ohne Personenzahl trägt 100 %, auch wenn daneben zwei ganze Einheiten leer stehen', () => {
    // e1: ganzjährig vermietet, Personenzahl nicht gepflegt.
    // e2, e3: das ganze Jahr über komplett leerstehend (kein Vertrag).
    const p1 = ermittlePerioden(einheit('e1', 60), [{ id: 'v1', start_datum: '2024-01-01', ende_datum: null, kuendigungsdatum: null, anzahl_personen: null }], ABR_VON, ABR_BIS);
    const p2 = ermittlePerioden(einheit('e2', 40), [], ABR_VON, ABR_BIS);
    const p3 = ermittlePerioden(einheit('e3', 50), [], ABR_VON, ABR_BIS);

    expect(p2.vertragsPerioden).toHaveLength(0);
    expect(p2.leerstandsPerioden).toHaveLength(1);
    expect(p3.leerstandsPerioden).toHaveLength(1);

    const perioden: Nutzungsperiode[] = [
      ...p1.vertragsPerioden,
      ...p1.leerstandsPerioden,
      ...p2.leerstandsPerioden,
      ...p3.leerstandsPerioden,
    ];
    const bezug = berechneBezugsgroessen(
      [einheit('e1', 60), einheit('e2', 40), einheit('e3', 50)],
      perioden,
      GESAMT_TAGE
    );

    expect(bezug.belegtePerioden).toBe(1);
    expect(personenzahlErforderlich(bezug)).toBe(false);

    const summe = perioden.reduce((s, p) => s + berechneAnteil(p, 'personen', bezug), 0);
    expect(summe).toBeCloseTo(1, 6);

    expect(berechneAnteil(p1.vertragsPerioden[0], 'personen', bezug)).toBe(1);
    expect(berechneAnteil(p2.leerstandsPerioden[0], 'personen', bezug)).toBe(0);
    expect(berechneAnteil(p3.leerstandsPerioden[0], 'personen', bezug)).toBe(0);
  });

  it('zwei belegte Einheiten ohne Personenzahl bleiben gesperrt, auch mit einer zusätzlichen leerstehenden Einheit', () => {
    const p1 = ermittlePerioden(einheit('e1', 60), [{ id: 'v1', start_datum: '2024-01-01', ende_datum: null, kuendigungsdatum: null, anzahl_personen: null }], ABR_VON, ABR_BIS);
    const p2 = ermittlePerioden(einheit('e2', 40), [{ id: 'v2', start_datum: '2024-01-01', ende_datum: null, kuendigungsdatum: null, anzahl_personen: null }], ABR_VON, ABR_BIS);
    const p3 = ermittlePerioden(einheit('e3', 50), [], ABR_VON, ABR_BIS);

    const perioden: Nutzungsperiode[] = [
      ...p1.vertragsPerioden,
      ...p2.vertragsPerioden,
      ...p3.leerstandsPerioden,
    ];
    const bezug = berechneBezugsgroessen(
      [einheit('e1', 60), einheit('e2', 40), einheit('e3', 50)],
      perioden,
      GESAMT_TAGE
    );

    // Die dritte, komplett leerstehende Einheit darf nicht in den Zähler der
    // belegten Perioden einfließen.
    expect(bezug.belegtePerioden).toBe(2);
    expect(personenzahlErforderlich(bezug)).toBe(true);
    expect(berechneAnteil(p1.vertragsPerioden[0], 'personen', bezug)).toBe(0);
    expect(berechneAnteil(p2.vertragsPerioden[0], 'personen', bezug)).toBe(0);
  });

  it('lässt bei komplettem Leerstand die Personen-Anteile auf 0 stehen', () => {
    // Kein einziger Mietvertrag im Abrechnungszeitraum. Für qm/gleich bekäme der
    // Leerstand explizit einen Anteil (der beim Eigentümer verbleibt); beim
    // Personen-Schlüssel bleibt der Anteil dagegen bei jeder Leerstandsperiode
    // 0 — die Docstring-Zusage "summiert sich auf 1" gilt für diesen Schlüssel
    // in diesem Randfall nicht wörtlich. Fachlich vermutlich unschädlich (es gibt
    // niemanden zu belasten), aber abweichend von der übrigen Kontrakt-Aussage —
    // daher hier nur dokumentiert, nicht als Fehler gewertet.
    const p1 = ermittlePerioden(einheit('e1', 60), [], ABR_VON, ABR_BIS);
    const p2 = ermittlePerioden(einheit('e2', 40), [], ABR_VON, ABR_BIS);

    const perioden: Nutzungsperiode[] = [...p1.leerstandsPerioden, ...p2.leerstandsPerioden];
    const bezug = berechneBezugsgroessen(
      [einheit('e1', 60), einheit('e2', 40)],
      perioden,
      GESAMT_TAGE
    );

    expect(bezug.belegtePerioden).toBe(0);
    expect(personenzahlErforderlich(bezug)).toBe(false);

    const summePersonen = perioden.reduce((s, p) => s + berechneAnteil(p, 'personen', bezug), 0);
    expect(summePersonen).toBe(0);

    const summeQm = perioden.reduce((s, p) => s + berechneAnteil(p, 'qm', bezug), 0);
    expect(summeQm).toBeCloseTo(1, 6);
  });
});
