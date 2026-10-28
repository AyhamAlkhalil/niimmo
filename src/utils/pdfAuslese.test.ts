import { describe, expect, it } from 'vitest';

import {
  BILD_STUFEN,
  MAX_BILDER_ZEICHEN,
  bildBudget,
  bildumfangFehler,
  massstab,
  rendereImBudget,
  seitenText,
  textebeneVorhanden,
  textMitSeiten,
} from './pdfAuslese';

describe('Budget je Seitenbild', () => {
  it('gibt kurzen Dokumenten volle Schärfe, langen einen gleichen Anteil', () => {
    expect(bildBudget(MAX_BILDER_ZEICHEN, 1)).toBe(1.5 * 1024 * 1024);
    expect(bildBudget(MAX_BILDER_ZEICHEN, 30)).toBe(Math.floor(MAX_BILDER_ZEICHEN / 30));
    expect(bildBudget(MAX_BILDER_ZEICHEN, 0)).toBe(1.5 * 1024 * 1024);
  });

  it('verteilt, was die vorigen Seiten übrig lassen, und wird bei aufgebrauchtem Rest null', () => {
    expect(bildBudget(3_000_000, 10)).toBe(300_000);
    expect(bildBudget(-5, 3)).toBe(0);
  });
});

describe('Maßstab', () => {
  it('lässt A4 unverändert und deckelt ein Planblatt auf 2000 Pixel', () => {
    expect(massstab(BILD_STUFEN[0], 595, 842)).toBe(1.5);
    // A0 bei Maßstab 1: 2384 × 3370 Punkt
    expect(massstab(BILD_STUFEN[0], 2384, 3370) * 3370).toBeCloseTo(2000);
  });
});

describe('Rendern im Budget', () => {
  // Bildlänge je Stufe, von scharf nach klein; '' steht für eine Zeichenfläche, die der Browser verweigert
  function renderer(laengen: number[]) {
    const aufrufe: number[] = [];
    const rendere = async (stufe: (typeof BILD_STUFEN)[number]) => {
      const i = BILD_STUFEN.indexOf(stufe);
      aufrufe.push(i);
      return laengen[i] === 0 ? '' : `/9j/${'x'.repeat(laengen[i] - 4)}`;
    };
    return { rendere, aufrufe };
  }

  it('nimmt die schärfste Stufe, die passt', async () => {
    const { rendere, aufrufe } = renderer([800, 500, 300, 100]);
    const ergebnis = await rendereImBudget(rendere, 400);
    expect(ergebnis.stufe).toBe(2);
    expect(ergebnis.bild).toHaveLength(300);
    expect(aufrufe).toEqual([0, 1, 2]);
  });

  it('beginnt bei der vorgegebenen Stufe und begrenzt sie auf den gültigen Bereich', async () => {
    const { rendere, aufrufe } = renderer([800, 500, 300, 100]);
    expect((await rendereImBudget(rendere, 400, 2)).stufe).toBe(2);
    expect((await rendereImBudget(rendere, 900, -1)).stufe).toBe(0);
    expect(aufrufe).toEqual([2, 0]);
  });

  it('versucht nach einer verweigerten Zeichenfläche die nächste Stufe, statt die Seite leer zu lassen', async () => {
    const { rendere } = renderer([0, 500, 300, 100]);
    const ergebnis = await rendereImBudget(rendere, 1_000_000);
    expect(ergebnis.stufe).toBe(1);
    expect(ergebnis.bild).toHaveLength(500);
  });

  it('liefert das kleinste gültige Bild, wenn keine Stufe passt — die Seite fällt nicht weg', async () => {
    const { rendere } = renderer([800, 500, 300, 0]);
    const ergebnis = await rendereImBudget(rendere, 50);
    expect(ergebnis.bild).toHaveLength(300);
  });

  it('liefert nichts, wenn keine Stufe ein Bild ergibt', async () => {
    const { rendere } = renderer([0, 0, 0, 0]);
    expect((await rendereImBudget(rendere, 1_000_000)).bild).toBe('');
  });
});

describe('Text einer PDF-Seite', () => {
  it('behält Zeilenumbrüche und überspringt Marked-Content', () => {
    const items = [
      { str: 'Kaltmiete', hasEOL: false },
      { str: '850,00 €', hasEOL: true },
      { type: 'beginMarkedContent' },
      { str: 'Kaution', hasEOL: false },
      { str: '', hasEOL: true },
      { str: '2.550,00   €', hasEOL: false },
    ];
    expect(seitenText(items)).toBe('Kaltmiete 850,00 €\nKaution\n2.550,00 €');
  });

  it('erkennt einen Scan an zu wenig Text über alle Seiten', () => {
    expect(textebeneVorhanden(['x'.repeat(150), 'y'.repeat(49)])).toBe(false);
    expect(textebeneVorhanden(['x'.repeat(150), 'y'.repeat(50)])).toBe(true);
  });

  it('nummeriert jede Seite', () => {
    expect(textMitSeiten(['a', '', 'c'])).toBe('Seite 1:\na\n\nSeite 2:\n\n\nSeite 3:\nc');
  });
});

describe('Gesamtumfang', () => {
  it('lässt passende Dokumente durch und meldet zu große mit Seitenzahl', () => {
    expect(bildumfangFehler(1, MAX_BILDER_ZEICHEN)).toBeNull();
    expect(bildumfangFehler(2, MAX_BILDER_ZEICHEN + 1)).toContain('Das Dokument hat 2 Seiten');
  });
});
