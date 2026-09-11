import { describe, it, expect } from 'vitest';
import {
  aufCent,
  baueAufteilungsReihen,
  summePositionen,
  teileKategorie,
  type AufteilungsPosition,
  type Aufteilungszeile,
  type Zielkategorie,
} from './nebenkostenAufteilung';

/**
 * Randfälle zu baueAufteilungsReihen() (Abschnitt "Schreibzeilen" in
 * nebenkostenAufteilung.ts). Die bestehenden Tests am Ende von
 * nebenkostenAufteilung.test.ts decken den Regelfall ab; hier geht es um
 * kaputte/unerwartete Eingaben und um Invarianten über viele Positionen.
 */

const position = (
  overrides: Partial<AufteilungsPosition> & { id: string; gesamtbetrag: number }
): AufteilungsPosition => ({
  zahlung_id: `zahlung-${overrides.id}`,
  nebenkostenart_id: 'art-wasser',
  zeitraum_von: '2025-01-01',
  zeitraum_bis: '2025-12-31',
  bezeichnung: `Abschlag ${overrides.id}`,
  quelle: 'zahlung',
  ist_umlagefaehig: true,
  erstellt_von: null,
  ...overrides,
});

const ziel: Zielkategorie = {
  nebenkostenartId: 'art-entwaesserung',
  name: 'Entwässerung',
  umlagefaehig: true,
};

/** Deterministischer ID-Generator statt crypto.randomUUID für reproduzierbare Tests. */
function zaehlerId() {
  let n = 0;
  return () => `neu-${++n}`;
}

describe('baueAufteilungsReihen — Zeilen ohne passende Position', () => {
  it('ignoriert eine Zeile, deren positionId in den Positionen fehlt, und verarbeitet die übrigen normal', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100 })];
    const zeilen: Aufteilungszeile[] = [
      { positionId: 'geist', vorher: 50, verschoben: 20, rest: 30 },
      { positionId: 'a', vorher: 100, verschoben: 40, rest: 60 },
    ];
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen.map((r) => r.id)).toEqual(['a', 'neu-1']);
    expect(reihen.some((r) => r.id === 'geist')).toBe(false);
  });

  it('liefert eine leere Liste, wenn keine Zeile eine bekannte Position trifft', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100 })];
    const zeilen: Aufteilungszeile[] = [
      { positionId: 'x', vorher: 10, verschoben: 5, rest: 5 },
      { positionId: 'y', vorher: 10, verschoben: 5, rest: 5 },
    ];
    expect(baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() })).toEqual([]);
  });

  it('stürzt bei leeren Positionen und leeren Zeilen nicht ab', () => {
    expect(baueAufteilungsReihen([], [], ziel, 'im1', { neueId: zaehlerId() })).toEqual([]);
    expect(baueAufteilungsReihen([], [{ positionId: 'a', vorher: 10, verschoben: 5, rest: 5 }], ziel, 'im1', { neueId: zaehlerId() })).toEqual([]);
  });
});

describe('baueAufteilungsReihen — doppelte positionId', () => {
  it('verarbeitet je Position nur die erste Zeile', () => {
    // teileKategorie() liefert höchstens eine Zeile je Position. Kämen trotzdem
    // zwei an, stünde die Ausgangs-ID zweimal im Ergebnis und der Mehrfach-Upsert
    // würde abgelehnt. Die Funktion sichert diese Vorbedingung deshalb selbst ab.
    const positionen = [position({ id: 'a', gesamtbetrag: 100 })];
    const zeilen: Aufteilungszeile[] = [
      { positionId: 'a', vorher: 100, verschoben: 30, rest: 70 },
      { positionId: 'a', vorher: 100, verschoben: 10, rest: 90 },
    ];
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen).toHaveLength(2);
    expect(reihen.map((r) => r.gesamtbetrag)).toEqual([70, 30]);
    const ids = reihen.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('behält bei doppelter ID in den Positionen selbst den ersten Treffer (Array.find-Semantik)', () => {
    const positionen = [
      position({ id: 'a', gesamtbetrag: 100, bezeichnung: 'Erste' }),
      position({ id: 'a', gesamtbetrag: 999, bezeichnung: 'Zweite' }),
    ];
    const zeilen: Aufteilungszeile[] = [{ positionId: 'a', vorher: 100, verschoben: 40, rest: 60 }];
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen.find((r) => r.nebenkostenart_id === 'art-wasser')?.bezeichnung).toBe('Erste');
  });
});

describe('baueAufteilungsReihen — Felder aus der Quellposition', () => {
  it('ersetzt eine fehlende Bezeichnung nur in der neuen Zeile durch den Namen der Zielkategorie', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100, bezeichnung: null })];
    const reihen = baueAufteilungsReihen(positionen, teileKategorie(positionen, 40), ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen.find((r) => r.id === 'a')?.bezeichnung).toBeNull();
    expect(reihen.find((r) => r.id === 'neu-1')?.bezeichnung).toBe('Entwässerung');
  });

  it('übernimmt ist_umlagefaehig=false aus der Quelle nur für die verbleibende Rest-Zeile', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100, ist_umlagefaehig: false })];
    const reihen = baueAufteilungsReihen(positionen, teileKategorie(positionen, 40), ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen.find((r) => r.id === 'a')?.ist_umlagefaehig).toBe(false);
    expect(reihen.find((r) => r.id === 'neu-1')?.ist_umlagefaehig).toBe(true);
  });

  it('reicht zahlung_id=null einer manuell angelegten Position an beide Zeilen weiter', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100, zahlung_id: null, quelle: 'manuell' })];
    const reihen = baueAufteilungsReihen(positionen, teileKategorie(positionen, 40), ziel, 'im1', { neueId: zaehlerId() });

    expect(reihen).toHaveLength(2);
    expect(reihen.every((r) => r.zahlung_id === null)).toBe(true);
    expect(reihen.every((r) => r.quelle === 'manuell')).toBe(true);
  });

  it('funktioniert mit der echten crypto.randomUUID als Default für neueId', () => {
    const positionen = [position({ id: 'a', gesamtbetrag: 100 })];
    const reihen = baueAufteilungsReihen(positionen, teileKategorie(positionen, 40), ziel, 'im1');

    const neueZeile = reihen.find((r) => r.nebenkostenart_id === 'art-entwaesserung');
    expect(neueZeile?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(neueZeile?.id).not.toBe('a');
  });
});

describe('baueAufteilungsReihen — Invarianten über viele Positionen', () => {
  it('hält Summe(erzeugte Zeilen) = Summe(betroffene Ausgangspositionen) und erzeugt keine doppelte ID (3000 Positionen)', () => {
    const positionen = Array.from({ length: 3000 }, (_, i) =>
      position({
        id: `p${i}`,
        gesamtbetrag: aufCent(10 + (i % 37) * 1.37),
        bezeichnung: i % 5 === 0 ? null : `Pos ${i}`,
        ist_umlagefaehig: i % 3 !== 0,
        zahlung_id: i % 11 === 0 ? null : `zahlung-p${i}`,
      })
    );
    const summe = summePositionen(positionen);
    const zielBetrag = aufCent(summe * 0.42);
    const zeilen = teileKategorie(positionen, zielBetrag);
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() });

    // Keine doppelte ID, solange jede Position höchstens eine Zeile hat.
    const ids = reihen.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Summeninvariante: nur die tatsächlich verschobenen Positionen fließen ein.
    const betroffeneIds = new Set(zeilen.filter((z) => z.verschoben > 0).map((z) => z.positionId));
    const summeAusgangspositionen = summePositionen(positionen.filter((p) => betroffeneIds.has(p.id)));
    const summeErzeugteZeilen = aufCent(reihen.reduce((s, r) => s + r.gesamtbetrag, 0));
    expect(summeErzeugteZeilen).toBe(summeAusgangspositionen);

    // Der Anteil, der in die Zielkategorie wandert, trifft den Zielbetrag exakt.
    const summeZiel = aufCent(
      reihen
        .filter((r) => r.nebenkostenart_id === 'art-entwaesserung')
        .reduce((s, r) => s + r.gesamtbetrag, 0)
    );
    expect(summeZiel).toBe(zielBetrag);
  }, 20000);

  it('hält dieselbe Summeninvariante bei krummen Beträgen und einer 0-€-Position, die übersprungen wird', () => {
    const positionen = [
      position({ id: 'a', gesamtbetrag: 292.15 }),
      position({ id: 'b', gesamtbetrag: 292.11 }),
      position({ id: 'c', gesamtbetrag: 1829.31 }),
      position({ id: 'd', gesamtbetrag: 0 }),
    ];
    const zeilen = teileKategorie(positionen, 777.77);
    const reihen = baueAufteilungsReihen(positionen, zeilen, ziel, 'im1', { neueId: zaehlerId() });

    const betroffeneIds = new Set(zeilen.filter((z) => z.verschoben > 0).map((z) => z.positionId));
    expect(betroffeneIds.has('d')).toBe(false);
    expect(reihen.some((r) => r.id === 'd')).toBe(false);

    const summeAusgangspositionen = summePositionen(positionen.filter((p) => betroffeneIds.has(p.id)));
    const summeErzeugteZeilen = aufCent(reihen.reduce((s, r) => s + r.gesamtbetrag, 0));
    expect(summeErzeugteZeilen).toBe(summeAusgangspositionen);

    const ids = reihen.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('erzeugt für 50 unterschiedlich große Positionen ausschließlich eindeutige IDs', () => {
    const positionen = Array.from({ length: 50 }, (_, i) =>
      position({ id: `p${i}`, gesamtbetrag: aufCent(100 + i * 3.14) })
    );
    const reihen = baueAufteilungsReihen(positionen, teileKategorie(positionen, 500), ziel, 'im1', { neueId: zaehlerId() });

    const ids = reihen.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});
