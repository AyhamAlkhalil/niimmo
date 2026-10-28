import { describe, expect, it } from 'vitest';

import { ilikeInSpalten, suchwoerter } from './suchbegriff';

describe('suchwoerter', () => {
  it('zerlegt „Nachname, Vorname" in Wörter, statt den or-Ausdruck zu brechen', () => {
    expect(suchwoerter('Müller, Hans')).toEqual(['Müller', 'Hans']);
  });

  it('entfernt Klammern, Punkte, Prozent und andere Steuerzeichen von PostgREST', () => {
    expect(suchwoerter('Haus (Hinterhof)')).toEqual(['Haus', 'Hinterhof']);
    expect(suchwoerter('100%')).toEqual(['100']);
    expect(suchwoerter('a_b*c"d:e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(suchwoerter('max@beispiel.de')).toEqual(['max', 'beispiel', 'de']);
  });

  it('behält Umlaute, ß, Ziffern und Bindestriche im Wort', () => {
    expect(suchwoerter('Groß-Straße 12a')).toEqual(['Groß-Straße', '12a']);
    expect(suchwoerter('DE-1234')).toEqual(['DE-1234']);
  });

  it('liefert nichts, wenn kein Buchstabe und keine Ziffer übrig bleibt', () => {
    expect(suchwoerter('(),.%')).toEqual([]);
    expect(suchwoerter(' - ')).toEqual([]);
    expect(suchwoerter('')).toEqual([]);
    expect(suchwoerter(undefined)).toEqual([]);
  });

  it('begrenzt die Zahl der Wörter', () => {
    expect(suchwoerter('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('ilikeInSpalten', () => {
  it('baut einen or-Ausdruck ohne Komma im Wert', () => {
    const ausdruck = ilikeInSpalten(['vorname', 'nachname'], 'Müller');
    expect(ausdruck).toBe('vorname.ilike.%Müller%,nachname.ilike.%Müller%');
    // Jedes Komma trennt genau eine Bedingung
    expect(ausdruck.split(',')).toHaveLength(2);
  });

  it('bleibt auch für einen Begriff mit Komma wohlgeformt', () => {
    const ausdruecke = suchwoerter('Müller, Hans (Erdgeschoss)').map(w => ilikeInSpalten(['vorname', 'nachname'], w));
    for (const a of ausdruecke) {
      expect(a).not.toMatch(/[()]/);
      expect(a.split(',')).toHaveLength(2);
    }
  });
});
