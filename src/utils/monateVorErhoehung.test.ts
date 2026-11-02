import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { erhoehungsMonat, monateVorErhoehung } from './monateVorErhoehung';

// Dieselben Fälle wie die Prüfung des Triggers gegen die Live-Datenbank (30.10. und 02.11.2026)
const miete = (monat: string, betrag: number) => ({ sollmonat: `${monat}-01`, sollbetrag: betrag, faelligkeitsdatum: `${monat}-08`, typ: 'Miete' });
const reihe = (von: number, bis: number, betrag: number, jahr = 2026) =>
  Array.from({ length: bis - von + 1 }, (_, i) => miete(`${jahr}-${String(von + i).padStart(2, '0')}`, betrag));
const heute = new Date(2026, 10, 2, 12);

describe('erhoehungsMonat', () => {
  it('am 1. ab diesem Monat, sonst ab dem Folgemonat', () => {
    expect(erhoehungsMonat('2026-06-01')).toBe('2026-06');
    expect(erhoehungsMonat('2026-10-28')).toBe('2026-11');
    expect(erhoehungsMonat('2026-12-15')).toBe('2027-01');
    expect(erhoehungsMonat(null)).toBeNull();
  });
});

describe('monateVorErhoehung', () => {
  it('K: Auszug am 20.10. nach der Erhöhung vom 28.10. — Oktober 600 € → 387,10 €', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-03-01', letzte_mieterhoehung_am: '2026-10-28', kaltmiete: 520, betriebskosten: 100 };
    const monate = monateVorErhoehung(vertrag, { start_datum: '2026-03-01', ende_datum: '2026-10-20' }, reihe(3, 10, 600), heute);
    expect(monate).toEqual([{ monat: '2026-10', bisher: 600, neu: 387.1 }]);
  });

  it('L: Ende 15.05. nachgetragen, Erhöhung ab Juni — nur der Mai ist ein Monat vor der Erhöhung', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-01-01', letzte_mieterhoehung_am: '2026-06-01', kaltmiete: 1595, betriebskosten: 100 };
    const forderungen = [...reihe(1, 5, 1600), ...reihe(6, 11, 1695)];
    const monate = monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: '2026-05-15' }, forderungen, heute);
    expect(monate).toEqual([{ monat: '2026-05', bisher: 1600, neu: 774.19 }]);
  });

  it('L: Ende vor dem Mai — ganze Monate vor der Erhöhung entfallen', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-01-01', letzte_mieterhoehung_am: '2026-06-01' };
    const forderungen = [...reihe(1, 5, 1600), ...reihe(6, 11, 1695)];
    const monate = monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: '2026-03-31' }, forderungen, heute);
    expect(monate).toEqual([
      { monat: '2026-04', bisher: 1600, neu: null },
      { monat: '2026-05', bisher: 1600, neu: null },
    ]);
  });

  it('M: anteiliger Einzugsmonat — Basis ist der volle Nachbarmonat, nicht der hochgerechnete Anteil', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-03-15', letzte_mieterhoehung_am: '2026-06-01', kaltmiete: 520, betriebskosten: 100 };
    const forderungen = [miete('2026-03', 329.03), ...reihe(4, 5, 600), ...reihe(6, 11, 620)];
    const monate = monateVorErhoehung(vertrag, { start_datum: '2026-03-20', ende_datum: null }, forderungen, heute);
    expect(monate).toEqual([{ monat: '2026-03', bisher: 329.03, neu: 232.26 }]);
  });

  it('N: Beginn in einen Monat vor der Erhöhung vorverlegt — neuer Monat mit der alten Miete', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-03-01', letzte_mieterhoehung_am: '2026-06-01', kaltmiete: 520, betriebskosten: 100 };
    const forderungen = [...reihe(3, 5, 600), ...reihe(6, 11, 620)];
    const monate = monateVorErhoehung(vertrag, { start_datum: '2026-02-15', ende_datum: null }, forderungen, heute);
    expect(monate).toEqual([{ monat: '2026-02', bisher: null, neu: 300 }]);
  });

  it('fragt nicht, wenn nur Monate ab der Erhöhung betroffen sind oder es keine Erhöhung gibt', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-01-01', letzte_mieterhoehung_am: '2026-06-01' };
    const forderungen = [...reihe(1, 5, 1600), ...reihe(6, 11, 1695)];
    expect(monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: '2026-09-15' }, forderungen, heute)).toEqual([]);
    expect(monateVorErhoehung({ ...vertrag, letzte_mieterhoehung_am: null }, { start_datum: '2026-01-01', ende_datum: '2026-03-15' }, forderungen, heute)).toEqual([]);
    expect(monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: null }, forderungen, heute)).toEqual([]);
  });

  it('lässt Monate mit zwei Monatsmieten aus und zählt Rücklastschriftgebühren nicht mit', () => {
    const vertrag = { status: 'aktiv', start_datum: '2026-01-01', letzte_mieterhoehung_am: '2026-06-01' };
    const gebuehr = { sollmonat: '2026-05-01', sollbetrag: 7.5, faelligkeitsdatum: '2026-05-06', typ: 'Miete', ruecklastschrift_am: '2026-05-06' };
    const mitGebuehr = monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: '2026-05-15' }, [...reihe(1, 5, 1600), gebuehr], heute);
    expect(mitGebuehr).toEqual([{ monat: '2026-05', bisher: 1600, neu: 774.19 }]);
    const doppelt = monateVorErhoehung(vertrag, { start_datum: '2026-01-01', ende_datum: '2026-05-15' }, [...reihe(1, 5, 1600), miete('2026-05', 200)], heute);
    expect(doppelt).toEqual([]);
  });
});

describe('Einbindung in die Vertragsbearbeitung', () => {
  const hook = readFileSync('src/hooks/useMietvertragMutations.ts', 'utf-8');

  it('schreibt Laufzeitänderungen nur über speichereVertrag, das die Wahl beachtet', () => {
    // Mietende, Mietbeginn und Gesamtbearbeitung; andere Felder (Mahnstufe, Personen, Kaution) ändern keine Laufzeit
    expect(hook).not.toMatch(/from\('mietvertrag'\)\.update\(\{ (start_datum|\.\.\.felder)/);
    expect(hook).not.toContain(".from('mietvertrag').update(mietvertragUpdates)");
    expect(hook.match(/await speichereVertrag\(/g)).toHaveLength(3);
    expect(hook).toContain("supabase.rpc('mietvertrag_speichern'");
    expect(hook).toContain('p_vor_erhoehung_anpassen: false');
  });

  it('fragt bei Mietende, Mietbeginn und in der Gesamtbearbeitung', () => {
    expect(hook.match(/await mitVormonatenWeiter\(/g)).toHaveLength(3);
  });

  it('die Vertragsansicht gibt die Forderungen weiter und zeigt den Hinweis', () => {
    const modal = readFileSync('src/components/dashboard/MietvertragDetailsModal.tsx', 'utf-8');
    expect(modal).toContain('useMietvertragMutations({ vertragId, vertrag, einheitData, mieter, forderungen })');
    expect(modal).toContain('<VormonateErhoehungBestaetigung');
  });
});
