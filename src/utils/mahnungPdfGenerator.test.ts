import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Ab Stufe 3 enthält das Mahnschreiben eine echte Kündigungserklärung
 * („Hiermit kündige ich das Mietverhältnis außerordentlich fristlos").
 * Bis zum 06.09.2026 blieb der Vertrag danach auf `aktiv`: Die Sollstellung
 * lief weiter, das Dashboard zählte die Einheit als vermietet, und keine
 * Auswertung über `status` kannte den Vorgang. Der Mieter hielt ein
 * Kündigungsschreiben, das System wusste nichts davon.
 */
describe('Kündigungsmahnung setzt den Vertragsstatus', () => {
  const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
  const generator = readFileSync('src/utils/mahnungPdfGenerator.ts', 'utf-8');

  it('das Schreiben kündigt ab Stufe 3 tatsächlich', () => {
    expect(generator).toContain('data.mahnstufe >= 3');
    expect(generator).toContain('außerordentlich fristlos');
  });

  it('der Versand setzt den Vertrag auf gekündigt', () => {
    expect(modal).toMatch(/mahnstufe >= 3/);
    expect(modal).toContain("status: 'gekuendigt'");
  });

  it('schreibt ende_datum mit, nicht nur kuendigungsdatum', () => {
    // ende_datum ist die führende Quelle des Vertragsendes (contractUtils.ts).
    // Wer nur kuendigungsdatum setzt, erzeugt den am 03.09.2026 bereinigten
    // Zustand aus zwei widersprüchlichen Feldern neu.
    const block = modal.slice(modal.indexOf("status: 'gekuendigt'"));
    expect(block.slice(0, 400)).toContain('ende_datum');
    expect(block.slice(0, 400)).toContain('kuendigungsdatum');
  });

  it('meldet es sichtbar, wenn der Statuswechsel scheitert', () => {
    // Ein stiller Fehler wäre hier besonders gefährlich: Das Schreiben ist
    // dann raus, der Vertrag läuft im System weiter.
    expect(modal).toContain('Vertragsstatus nicht gesetzt');
  });

  it('warnt vor dem Versand, dass gekündigt wird', () => {
    expect(modal).toContain('Fristlose Kündigung versenden?');
    expect(modal).toContain('543 Abs. 2 Nr. 3');
  });
});
