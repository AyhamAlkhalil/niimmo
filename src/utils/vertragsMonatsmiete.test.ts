import { describe, expect, it } from 'vitest';
import { vertragsMonatsmiete } from './vertragsMonatsmiete';

const miete = (id: string, betrag: number, extra: Record<string, unknown> = {}) => ({
  mietvertrag_id: id, sollmonat: '2026-10-01', sollbetrag: betrag, faelligkeitsdatum: '2026-10-08', typ: 'Miete', ...extra,
});

describe('vertragsMonatsmiete', () => {
  it('nimmt im vollen Monat Kaltmiete und Betriebskosten aus dem Vertrag, nicht aus den Forderungen', () => {
    const v = { id: 'a', status: 'aktiv', start_datum: '2020-01-01', kaltmiete: 400, betriebskosten: 100 };
    // Gebühr, Minderung und eine abweichende Forderung ändern die Vertragsmiete nicht
    const forderungen = [miete('a', 450), miete('a', 7.5, { ruecklastschrift_am: '2026-10-05' }), miete('a', -50)];
    expect(vertragsMonatsmiete(v, '2026-10', forderungen)).toEqual({
      gesamt: 500, kaltmiete: 400, betriebskosten: 100, anteilig: false, vorErhoehung: false,
    });
  });

  it('teilt den Monat des Einzugs taggenau wie die Sollstellung', () => {
    // Live: Einzug 15.10., 1.400 € + 200 €, 17 von 31 Tagen = 877,42 €
    const v = { id: 'e', status: 'aktiv', start_datum: '2026-10-15', kaltmiete: 1400, betriebskosten: 200 };
    expect(vertragsMonatsmiete(v, '2026-10', [])).toEqual({
      gesamt: 877.42, kaltmiete: 767.74, betriebskosten: 109.68, anteilig: true, vorErhoehung: false,
    });
  });

  it('teilt den Monat des Auszugs anteilig und ist außerhalb der Laufzeit 0', () => {
    const v = { id: 'x', status: 'gekuendigt', start_datum: '2020-01-01', kuendigungsdatum: '2026-10-15', kaltmiete: 620, betriebskosten: 0 };
    expect(vertragsMonatsmiete(v, '2026-10', [])).toMatchObject({ gesamt: 300, kaltmiete: 300, anteilig: true });
    expect(vertragsMonatsmiete(v, '2026-11', [])).toMatchObject({ gesamt: 0, kaltmiete: 0, betriebskosten: 0 });
  });

  it('nimmt bei einer Erhöhung erst ab dem Folgemonat noch die bisherige Miete', () => {
    // Live 28.10.2026: Kaltmiete 350 → 420 im Vertrag, Oktober noch 537 (350 + 187)
    const v = { id: 'h', status: 'aktiv', start_datum: '2024-03-01', kaltmiete: 420, betriebskosten: 187, letzte_mieterhoehung_am: '2026-10-28' };
    const forderungen = [miete('h', 537), miete('h', 7.5, { ruecklastschrift_am: '2026-10-05' })];
    expect(vertragsMonatsmiete(v, '2026-10', forderungen)).toEqual({
      gesamt: 537, kaltmiete: 350, betriebskosten: 187, anteilig: false, vorErhoehung: true,
    });
    // Im Folgemonat gilt die neue Miete aus dem Vertrag
    expect(vertragsMonatsmiete(v, '2026-11', forderungen)).toMatchObject({ gesamt: 607, kaltmiete: 420, vorErhoehung: false });
  });

  it('nimmt eine Erhöhung zum Monatsersten schon in diesem Monat', () => {
    const v = { id: 'h', status: 'aktiv', start_datum: '2024-03-01', kaltmiete: 420, betriebskosten: 187, letzte_mieterhoehung_am: '2026-10-01' };
    expect(vertragsMonatsmiete(v, '2026-10', [miete('h', 607)])).toMatchObject({ gesamt: 607, kaltmiete: 420, vorErhoehung: false });
  });

  it('nimmt die bisherige Miete auch im Monat eines Auszugs oder Einzugs (Review 29.10.2026)', () => {
    // Gekündigt zum 15.11., am 03.11. offiziell von 600 € auf 660 € erhöht: Die Novembermiete bleibt 300 € (15/30)
    const aus = { id: 'a', status: 'gekuendigt', start_datum: '2020-01-01', kuendigungsdatum: '2026-11-15', kaltmiete: 560, betriebskosten: 100, letzte_mieterhoehung_am: '2026-11-03' };
    const nov = { mietvertrag_id: 'a', sollmonat: '2026-11-01', sollbetrag: 300, faelligkeitsdatum: '2026-11-08', typ: 'Miete' };
    expect(vertragsMonatsmiete(aus, '2026-11', [nov])).toEqual({ gesamt: 300, kaltmiete: 250, betriebskosten: 50, anteilig: true, vorErhoehung: true });
  });

  it('fällt ohne Monatsmiete-Forderung auf den Vertrag zurück', () => {
    const v = { id: 'h', status: 'aktiv', start_datum: '2024-03-01', kaltmiete: 420, betriebskosten: 187, letzte_mieterhoehung_am: '2026-10-28' };
    expect(vertragsMonatsmiete(v, '2026-10', [])).toMatchObject({ gesamt: 607, vorErhoehung: false });
  });

  it('nimmt bei zwei Monatsmieten die höhere und bei einer erlassenen den Vertrag', () => {
    const v = { id: 'h', status: 'aktiv', start_datum: '2024-03-01', kaltmiete: 420, betriebskosten: 187, letzte_mieterhoehung_am: '2026-10-28' };
    expect(vertragsMonatsmiete(v, '2026-10', [miete('h', 537), miete('h', 537)])).toMatchObject({ gesamt: 537, kaltmiete: 350, vorErhoehung: true });
    expect(vertragsMonatsmiete(v, '2026-10', [miete('h', 0)])).toMatchObject({ gesamt: 607, kaltmiete: 420, vorErhoehung: false });
    // Eine Minderung (negative Forderung) ändert die bisherige Miete nicht
    expect(vertragsMonatsmiete(v, '2026-10', [miete('h', 537), miete('h', -100)])).toMatchObject({ gesamt: 537, vorErhoehung: true });
  });
});
