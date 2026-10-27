import { describe, expect, it } from 'vitest';
import { monatsSaldo } from './monatsSaldo';

const vertraege = [
  { id: 'a', kaltmiete: 400, betriebskosten: 100 },
  { id: 'b', kaltmiete: 400, betriebskosten: 100 },
];

describe('monatsSaldo', () => {
  it('verrechnet die Überzahlung eines Mieters nicht mit dem Rückstand eines anderen', () => {
    // 27.10.2026: Gesamt-Soll minus Gesamt-Eingang zeigte „Mehr eingegangen“ trotz Rückständen
    const r = monatsSaldo(vertraege, [], [
      { mietvertrag_id: 'a', betrag: 1000, kategorie: 'Miete' },
      { mietvertrag_id: 'b', betrag: 0, kategorie: 'Miete' },
    ]);
    expect(r).toEqual({ soll: 1000, eingang: 1000, offen: 500, mehr: 500, vertraegeMitRueckstand: 1 });
  });

  it('nimmt als Soll die Forderungen des Monats, sonst die Vertragsmiete', () => {
    // Anteiliger Einzugsmonat und Gebühr aus der Sollstellung; b noch ohne Sollstellung
    const r = monatsSaldo(
      vertraege,
      [
        { mietvertrag_id: 'a', sollbetrag: '258.06', typ: 'Miete' },
        { mietvertrag_id: 'a', sollbetrag: 7.5, typ: 'Miete' },
        { mietvertrag_id: 'a', sollbetrag: 300, typ: 'BKA' },
      ],
      []
    );
    expect(r.soll).toBe(765.56);
    expect(r.offen).toBe(765.56);
  });

  it('zählt Rücklastschriften mindernd, BKA-Zahlungen und fremde Verträge nicht', () => {
    const r = monatsSaldo(vertraege, [], [
      { mietvertrag_id: 'a', betrag: 500, kategorie: 'Miete' },
      { mietvertrag_id: 'a', betrag: -500, kategorie: 'Rücklastschrift' },
      { mietvertrag_id: 'b', betrag: 500, kategorie: 'Betriebskostenabrechnung' },
      { mietvertrag_id: 'x', betrag: 999, kategorie: 'Miete' },
      { mietvertrag_id: null, betrag: 50, kategorie: 'Miete' },
    ]);
    expect(r).toEqual({ soll: 1000, eingang: 0, offen: 1000, mehr: 0, vertraegeMitRueckstand: 2 });
  });

  it('rechnet Cent-genau ohne Fließkommareste', () => {
    const r = monatsSaldo([{ id: 'a', kaltmiete: 0.1, betriebskosten: 0.2 }], [], [{ mietvertrag_id: 'a', betrag: 0.3, kategorie: 'Miete' }]);
    expect(r.offen).toBe(0);
    expect(r.vertraegeMitRueckstand).toBe(0);
  });
});
