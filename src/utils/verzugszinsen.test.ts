import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { berechneAlleVerzugszinsen, mitAelterenPerioden, verzugspostenAusRueckstand } from './verzugszinsen';
import { monatsmietenText, rueckstandsUmfang } from './mahnungPdfGenerator';

const PERIODEN = [
  { ab: '2026-07-01', satz: 1.52 },
  { ab: '2026-01-01', satz: 1.27 },
];

describe('verzugspostenAusRueckstand', () => {
  it('setzt vom 1. bis 7. den Vormonat als jüngsten offenen Monat an', () => {
    // 27.10.2026: Am 04.11. lag der Oktober-Posten auf Verzug ab 05.11. und fiel weg (0,00 € Zinsen)
    const posten = verzugspostenAusRueckstand(500, 500, new Date(2026, 10, 4));
    expect(posten).toEqual([{ betrag: 500, faelligAb: '2026-10-06' }]);
  });

  it('nimmt ab dem 8. den laufenden Monat und legt den Rest auf den ältesten', () => {
    const posten = verzugspostenAusRueckstand(1250, 500, new Date(2026, 9, 27));
    expect(posten).toEqual([
      { betrag: 250, faelligAb: '2026-08-06' },
      { betrag: 500, faelligAb: '2026-09-04' },
      { betrag: 500, faelligAb: '2026-10-06' },
    ]);
  });

  it('liefert ohne Rückstand nichts und ohne Monatsmiete einen Posten', () => {
    expect(verzugspostenAusRueckstand(0, 500)).toEqual([]);
    expect(verzugspostenAusRueckstand(80, 0, new Date(2026, 9, 27))).toEqual([{ betrag: 80, faelligAb: '2026-10-06' }]);
  });
});

describe('berechneAlleVerzugszinsen', () => {
  it('teilt den Zeitraum an jeder Änderung des Basiszinses', () => {
    // 27.10.2026: Ein Verzug ab 04.06. lief durchgehend mit dem Juni-Satz
    const r = berechneAlleVerzugszinsen([{ betrag: 1000, faelligAb: '2026-06-04' }], new Date(2026, 6, 31), PERIODEN);
    expect(r.details.map((d) => [d.tage, d.verzugszinssatz])).toEqual([[27, 6.27], [30, 6.52]]);
    expect(r.gesamt).toBe(Math.round(((1000 * 6.27 * 27) / 36500 + (1000 * 6.52 * 30) / 36500) * 100) / 100);
  });

  it('rechnet unabhängig von der Uhrzeit des Stichtags', () => {
    const morgens = berechneAlleVerzugszinsen([{ betrag: 1000, faelligAb: '2026-10-06' }], new Date(2026, 9, 27, 8, 0), PERIODEN);
    const abends = berechneAlleVerzugszinsen([{ betrag: 1000, faelligAb: '2026-10-06' }], new Date(2026, 9, 27, 18, 0), PERIODEN);
    expect(abends.details[0].tage).toBe(morgens.details[0].tage);
  });
});

describe('Basiszins-Perioden', () => {
  it('ergänzt ältere Zeiträume aus der eingebauten Liste', () => {
    const p = mitAelterenPerioden([{ ab: '2026-03-01', satz: 1.27 }]);
    expect(p[0]).toEqual({ ab: '2026-03-01', satz: 1.27 });
    expect(p.some((x) => x.ab === '2025-07-01')).toBe(true);
    expect(p.every((x, i) => i === 0 || x.ab <= p[i - 1].ab)).toBe(true);
  });
});

describe('Mahnung Stufe 3', () => {
  it('nennt die Monatsmieten abgerundet statt aufgerundet', () => {
    // 27.10.2026: 1,1 Monatsmieten standen als „2 Monatsmieten“ im Kündigungsschreiben
    expect(monatsmietenText(1.17)).toBe('1,1 Monatsmieten');
    expect(monatsmietenText(1)).toBe('1 Monatsmiete');
    expect(monatsmietenText(2)).toBe('2 Monatsmieten');
  });

  it('nennt keine „0 Monatsmieten“ im Kündigungsschreiben', () => {
    expect(rueckstandsUmfang(1.5, '1.200,00')).toBe('1,5 Monatsmieten in Höhe von insgesamt 1.200,00 €');
    expect(rueckstandsUmfang(0, '1.200,00')).toBe('insgesamt 1.200,00 €');
    expect(rueckstandsUmfang(0.05, '20,00')).toBe('insgesamt 20,00 €');
    expect(rueckstandsUmfang(NaN, '20,00')).toBe('insgesamt 20,00 €');
  });

  it('nennt im Schreiben dasselbe Räumungsende, das der Vertrag beim Versand bekommt', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    const aufrufe = modal.match(/fristloseKuendigungFelder\(parseInt.*$/gm) ?? [];
    expect(aufrufe).toHaveLength(2);
    for (const a of aufrufe) expect(a).toContain('contractData.vertragsende');
  });

  it('setzt den Dialog nur beim Öffnen zurück und verteilt die Zinsen über verzugspostenAusRueckstand', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).toMatch(/\}, \[isOpen, contractData\?\.mietvertrag_id\]\);/);
    expect(modal).toMatch(/verzugspostenAusRueckstand\(parsedBetrag, monatsmieteDesVertrags, heute\)/);
    expect(modal).not.toMatch(/Math\.ceil\(rueckstand \/ monatsmiete\)/);
    expect(modal).toMatch(/fristloseKuendigungFelder\(parseInt\(raeumungsfristTage\), new Date\(\), contractData\.vertragsende\)/);
  });
});
