import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMPANY } from './company';

/**
 * Die Firmenstammdaten standen bis zum 06.09.2026 in sieben Generatoren verstreut
 * und widersprachen sich in Strasse, Postleitzahl, Handelsregister und Steuernummer.
 * Auf Mieterpost stand deshalb je nach Schreiben eine andere Absenderadresse.
 *
 * Diese Tests halten den belegten Stand fest (Handelsregisterauszug, Kundenauskunft
 * vom 06.09.2026) und verhindern, dass wieder Literale in die Generatoren wandern.
 */
describe('Firmenstammdaten', () => {
  it('führt die im Handelsregister eingetragenen Angaben', () => {
    expect(COMPANY.name).toBe('NiImmo Wohnungsbaugesellschaft mbH');
    expect(COMPANY.strasse).toBe('Egestorffstraße 11');
    expect(COMPANY.plzOrt).toBe('31319 Sehnde');
    expect(COMPANY.register.nummer).toBe('HRB 208111');
    expect(COMPANY.register.gericht).toBe('Amtsgericht Hildesheim');
    expect(COMPANY.register.euid).toBe('DEP2408.HRB208111');
  });

  it('nennt keine der früher kursierenden Falschangaben', () => {
    const alles = JSON.stringify({ ...COMPANY, rechtliches: COMPANY.rechtliches });
    for (const falsch of ['Egerstorff', '33119', '208151', 'Nilmmo', 'Egonstraße']) {
      expect(alles).not.toContain(falsch);
    }
  });

  it('baut Absender- und Anschriftenzeile aus denselben Feldern', () => {
    expect(COMPANY.anschriftEinzeilig).toBe('NiImmo Wohnungsbaugesellschaft mbH, Egestorffstraße 11, 31319 Sehnde');
    expect(COMPANY.absenderzeile).toBe('NiImmo Wohnungsbaugesellschaft, Egestorffstraße 11, 31319 Sehnde');
  });

  it('führt die Fußzeilenangaben vollständig', () => {
    const zeilen = COMPANY.rechtliches.join(' ');
    expect(zeilen).toContain('Ayhan Yeyrek, Dennis Mikyas');
    expect(zeilen).toContain('HRB 208111');
    expect(zeilen).toContain('§ 34c GewO');
    expect(zeilen).toContain(COMPANY.steuernummer);
  });
});

/**
 * Ein Generator, der die Angaben selbst hinschreibt, läuft beim nächsten Umzug
 * oder Registereintrag wieder auseinander. Deshalb prüfen wir den Quelltext.
 */
describe('Generatoren enthalten keine Firmendaten als Literal', () => {
  const GENERATOREN = [
    'src/utils/mahnungPdfGenerator.ts',
    'src/utils/kuendigungPdfGenerator.ts',
    'src/utils/mieterhoehungPdfGenerator.ts',
    'src/utils/uebergabePdfGenerator.ts',
    'src/utils/nebenkostenAbrechnungPdfGenerator.ts',
    'src/components/dashboard/handover/VersorgerBenachrichtigungDialog.tsx',
  ];
  // Werte, die ausschliesslich aus COMPANY kommen dürfen.
  const VERBOTEN = [
    'Egestorffstraße 11',
    '31319 Sehnde',
    'HRB 208111',
    '16/204/50884',
    'Ayhan Yeyrek',
    'IHK Hannover',
    'info@niimmo.de',
  ];

  for (const datei of GENERATOREN) {
    it(`${datei.split('/').pop()} liest die Firmendaten aus COMPANY`, () => {
      const quelle = readFileSync(datei, 'utf-8');
      expect(quelle).toContain('COMPANY');
      for (const wert of VERBOTEN) {
        expect(quelle, `${datei} schreibt "${wert}" selbst statt COMPANY zu nutzen`).not.toContain(wert);
      }
    });
  }
});
