import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { berechneAlleVerzugszinsen, berechneVerzugsbeginn, mitAelterenPerioden, verzugspostenAusRueckstand, verzugszinsAufschlag } from './verzugszinsen';
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

  it('hängt bei einem ungültigen Datum nicht', () => {
    // QA 27.10.2026: Endlosschleife, weil „NaN-NaN-NaN“ als Feiertag galt
    expect(Number.isNaN(berechneVerzugsbeginn(new Date(NaN)).getTime())).toBe(true);
    expect(() => verzugspostenAusRueckstand(100, 50, new Date(NaN))).not.toThrow();
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

describe('Verzugszinsen — Prüfung 29.10.2026', () => {
  it('beginnt den Verzug am Kalendertag nach dem 3. Werktag, auch wenn das ein Samstag ist', () => {
    // Juli 2026: Mi 1., Do 2., Fr 3. → Verzug ab Sa 4.07. (bis dahin Mo 6.07., der 4. Werktag)
    const beginn = berechneVerzugsbeginn(new Date(2026, 5, 1));
    expect([beginn.getFullYear(), beginn.getMonth() + 1, beginn.getDate()]).toEqual([2026, 7, 4]);
  });

  it('trennt nur, wo sich der Basiszins ändert, nicht an jeder Monatszeile', () => {
    const monatlich = [
      { ab: '2026-07-01', satz: 1.52 },
      { ab: '2026-06-01', satz: 1.27 },
      { ab: '2026-05-01', satz: 1.27 },
      { ab: '2026-04-01', satz: 1.27 },
    ];
    const r = berechneAlleVerzugszinsen([{ betrag: 1000, faelligAb: '2026-04-05' }], new Date(2026, 7, 1), monatlich);
    // Zwei Stücke: 05.04.–01.07. zu 6,27 %, 01.07.–01.08. zu 6,52 %
    expect(r.details.map((d) => [d.verzugVon, d.verzugBis, d.verzugszinssatz])).toEqual([
      ['2026-04-05', '2026-07-01', 6.27],
      ['2026-07-01', '2026-08-01', 6.52],
    ]);
  });

  it('nimmt die amtlichen Sätze vor dem Beginn der Tabelle marktdaten', () => {
    const r = berechneAlleVerzugszinsen([{ betrag: 365, faelligAb: '2025-08-01' }], new Date(2025, 7, 2));
    expect(r.details[0].basiszinssatz).toBe(1.27);
    const alt = berechneAlleVerzugszinsen([{ betrag: 365, faelligAb: '2022-08-01' }], new Date(2022, 7, 2));
    expect(alt.details[0].basiszinssatz).toBe(-0.88);
  });
});

describe('Verzugszinsen bei Gewerbe (Kundenentscheidung 29.10.2026)', () => {
  it('nimmt 9 Prozentpunkte für Gewerbeeinheiten, sonst 5', () => {
    expect(verzugszinsAufschlag('Gewerbe')).toBe(9);
    expect(verzugszinsAufschlag('Wohnung')).toBe(5);
    expect(verzugszinsAufschlag(null)).toBe(5);
    const posten = [{ betrag: 365, faelligAb: '2026-08-01' }];
    const wohnen = berechneAlleVerzugszinsen(posten, new Date(2026, 8, 1), [{ ab: '2026-07-01', satz: 1.52 }]);
    const gewerbe = berechneAlleVerzugszinsen(posten, new Date(2026, 8, 1), [{ ab: '2026-07-01', satz: 1.52 }], 9);
    expect(wohnen.details[0].verzugszinssatz).toBe(6.52);
    expect(gewerbe.details[0].verzugszinssatz).toBe(10.52);
    // 365 € × 31 Tage: 2,02 € gegen 3,26 €
    expect([wohnen.gesamt, gewerbe.gesamt]).toEqual([2.02, 3.26]);
  });
});
