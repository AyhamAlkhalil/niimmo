import { describe, expect, it } from 'vitest';
import { sollFolgemonat } from './sollFolgemonat';

const am29Okt = new Date(2026, 9, 29, 12);
const vertrag = (id: string, kaltmiete: number, betriebskosten: number, mehr: Record<string, unknown> = {}) => ({
  id, status: 'aktiv', start_datum: '2015-07-01', kaltmiete, betriebskosten, ...mehr,
});

describe('sollFolgemonat', () => {
  it('rechnet den Folgemonat aus den Verträgen: Erhöhung vom 28.10. voll, Einzug voll, Auszug nicht mehr', () => {
    const r = sollFolgemonat([
      vertrag('erhoeht', 420, 187, { letzte_mieterhoehung_am: '2026-10-28' }),
      vertrag('einzug', 1400, 200, { start_datum: '2026-10-15' }),
      vertrag('aus', 500, 100, { status: 'gekuendigt', kuendigungsdatum: '2026-10-31' }),
      vertrag('neu', 700, 150, { start_datum: '2026-11-16' }),
      vertrag('beendet', 300, 50, { status: 'beendet', ende_datum: '2026-12-31' }),
    ], [], am29Okt);
    // 607 + 1.600 + 850 × 15/30 = 425
    expect(r).toEqual({ monat: '2026-11', gesamt: 2632, kaltmiete: 2170, betriebskosten: 462 });
  });

  it('nimmt einen zugestimmten Vorgang zum Ersten, Betriebskosten nur bei Änderung, spätere nicht', () => {
    const vertraege = [vertrag('a', 500, 100), vertrag('b', 400, 80), vertrag('c', 300, 50)];
    const r = sollFolgemonat(vertraege, [
      { mietvertrag_id: 'a', alte_kaltmiete: 500, status: 'zugestimmt', wirksam_ab: '2026-11-01', neue_kaltmiete: 560, alte_betriebskosten: 100, neue_betriebskosten: 100 },
      { mietvertrag_id: 'b', alte_kaltmiete: 400, status: 'zugestimmt', wirksam_ab: '2026-11-01', neue_kaltmiete: 440, alte_betriebskosten: 80, neue_betriebskosten: 95 },
      { mietvertrag_id: 'c', alte_kaltmiete: 300, status: 'zugestimmt', wirksam_ab: '2026-11-02', neue_kaltmiete: 330, alte_betriebskosten: 50, neue_betriebskosten: 50 },
      { mietvertrag_id: 'c', alte_kaltmiete: 300, status: 'verlangt', wirksam_ab: '2026-11-01', neue_kaltmiete: 330, alte_betriebskosten: 50, neue_betriebskosten: 50 },
    ], am29Okt);
    expect(r).toMatchObject({ kaltmiete: 560 + 440 + 300, betriebskosten: 100 + 95 + 50, gesamt: 1545 });
  });

  it('übernimmt einen Vorgang nicht, wenn sich die Miete seit dem Verlangen geändert hat (wie der Nachtlauf)', () => {
    // Verlangt bei 480 € Kaltmiete, inzwischen auf 500 € korrigiert: MIETE_GEAENDERT, nur „Trotzdem übernehmen“
    const r = sollFolgemonat([vertrag('a', 500, 100)], [
      { mietvertrag_id: 'a', alte_kaltmiete: 480, status: 'zugestimmt', wirksam_ab: '2026-11-01', neue_kaltmiete: 560, alte_betriebskosten: 100, neue_betriebskosten: 100 },
    ], am29Okt);
    expect(r).toMatchObject({ kaltmiete: 500, gesamt: 600 });
  });

  it('zählt keinen Vorgang, den der Nachtlauf ablehnt: überfällig, Staffel- oder Indexmiete (Review 29.10.2026)', () => {
    const vorgang = (id: string, wirksam: string) => ({
      mietvertrag_id: id, alte_kaltmiete: 500, status: 'zugestimmt', wirksam_ab: wirksam, neue_kaltmiete: 560, alte_betriebskosten: 100, neue_betriebskosten: 100,
    });
    const r = sollFolgemonat([
      vertrag('ueberfaellig', 500, 100),
      vertrag('index', 500, 100, { mietanpassung_art: 'index' }),
      vertrag('heute', 500, 100),
    ], [vorgang('ueberfaellig', '2026-09-01'), vorgang('index', '2026-11-01'), vorgang('heute', '2026-10-29')], am29Okt);
    // Nur der heute wirksame zählt: Der Nachtlauf übernimmt ihn, der laufende Monat bleibt, der November steigt
    expect(r).toMatchObject({ kaltmiete: 500 + 500 + 560, gesamt: 1860 });
  });

  it('nimmt die Staffelstufe zum Ersten, nicht eine schon übernommene oder spätere', () => {
    const plan = [
      { gueltig_ab: '2025-11-01', kaltmiete: 500 },
      { gueltig_ab: '2026-11-01', kaltmiete: '530.50' },
      { gueltig_ab: '2027-11-01', kaltmiete: 560 },
      { gueltig_ab: 'irgendwann', kaltmiete: 999 },
    ];
    const r = sollFolgemonat([
      vertrag('offen', 500, 100, { mietanpassung_art: 'staffel', staffelplan: plan, letzte_mieterhoehung_am: '2025-11-01' }),
      vertrag('uebernommen', 530.5, 100, { mietanpassung_art: 'staffel', staffelplan: plan, letzte_mieterhoehung_am: '2026-11-01' }),
    ], [], am29Okt);
    expect(r).toMatchObject({ kaltmiete: 1061, betriebskosten: 200 });
  });

  it('ergibt Kaltmiete + Betriebskosten = Soll-Miete, auch anteilig', () => {
    const r = sollFolgemonat([
      vertrag('a', 333.33, 77.77, { start_datum: '2026-11-09' }),
      vertrag('b', 677.43, 199.99, { status: 'gekuendigt', kuendigungsdatum: '2026-11-12' }),
    ], [], am29Okt);
    expect(Math.round((r.kaltmiete + r.betriebskosten) * 100) / 100).toBe(r.gesamt);
  });
});
