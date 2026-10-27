import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from '@/constants/config';
import { geaenderteMietbetraege, mietfeldVorbelegung, uebersichtsBetrag } from './vertragMiete';

const vertrag = { kaltmiete: 800, betriebskosten: 200, ruecklastschrift_gebuehr: 7.5 };

describe('geaenderteMietbetraege', () => {
  it('meldet ein geleertes Betriebskostenfeld, statt 0 zu speichern', () => {
    // 27.10.2026: aus '' wurde 0, der Trigger senkte danach alle Forderungen
    const r = geaenderteMietbetraege(vertrag, { kaltmiete: 800, betriebskosten: '', ruecklastschrift_gebuehr: 7.5 });
    expect(r.fehlend).toEqual(['betriebskosten']);
    expect(r.aenderungen).toEqual({});
  });

  it('meldet eine geleerte Kaltmiete', () => {
    expect(geaenderteMietbetraege(vertrag, { kaltmiete: '  ' }).fehlend).toEqual(['kaltmiete']);
  });

  it('übernimmt eine bewusst eingetragene 0', () => {
    expect(geaenderteMietbetraege(vertrag, { betriebskosten: '0' }).aenderungen).toEqual({ betriebskosten: 0 });
  });

  it('schreibt nur geänderte Felder', () => {
    const r = geaenderteMietbetraege(vertrag, { kaltmiete: '850,50', betriebskosten: 200, ruecklastschrift_gebuehr: '7.5' });
    expect(r.aenderungen).toEqual({ kaltmiete: 850.5 });
  });

  it('meldet negative und unlesbare Beträge', () => {
    expect(geaenderteMietbetraege(vertrag, { kaltmiete: -5, betriebskosten: 'abc' }).ungueltig).toEqual(['kaltmiete', 'betriebskosten']);
  });

  it('lässt ein leer geladenes und leer gebliebenes Feld in Ruhe', () => {
    const r = geaenderteMietbetraege({ kaltmiete: null, betriebskosten: null }, { kaltmiete: '', betriebskosten: null });
    expect(r).toEqual({ aenderungen: {}, fehlend: [], ungueltig: [] });
  });

  it('macht aus einer Gebühr von 0 € beim Speichern nicht still 7,50 €', () => {
    // 27.10.2026: Die Vorbelegung `|| 7,50` schrieb bei jedem Speichern 7,50 zurück (3 Verträge)
    const geladen = { ...vertrag, ruecklastschrift_gebuehr: 0 };
    const vorbelegt = mietfeldVorbelegung('ruecklastschrift_gebuehr', geladen.ruecklastschrift_gebuehr);
    expect(vorbelegt).toBe(0);
    expect(geaenderteMietbetraege(geladen, { ruecklastschrift_gebuehr: vorbelegt }).aenderungen).toEqual({});
  });

  it('belegt eine fehlende Gebühr mit der Vorgabe vor und schreibt sie nicht ungefragt', () => {
    const vorbelegt = mietfeldVorbelegung('ruecklastschrift_gebuehr', null);
    expect(vorbelegt).toBe(RUECKLASTSCHRIFT_GEBUEHR_EUR);
    expect(geaenderteMietbetraege({ ruecklastschrift_gebuehr: null }, { ruecklastschrift_gebuehr: vorbelegt }).aenderungen).toEqual({});
  });
});

describe('uebersichtsBetrag (Mietübersicht)', () => {
  it('speichert geleerte Kaltmiete oder Betriebskosten nicht als 0', () => {
    // 27.10.2026: Die Zelle machte aus einem leeren Feld 0, „✓ Gespeichert“, der Trigger senkte die Forderungen
    expect(uebersichtsBetrag('kaltmiete', null)).toEqual({ fehler: expect.stringMatching(/Kaltmiete fehlt/) });
    expect(uebersichtsBetrag('betriebskosten', '')).toEqual({ fehler: expect.stringMatching(/Betriebskosten fehlt/) });
  });

  it('lässt Fläche und Soll-Miete der Einheit leer statt 0', () => {
    expect(uebersichtsBetrag('qm', null)).toEqual({ wert: null });
    expect(uebersichtsBetrag('soll_miete', null)).toEqual({ wert: null });
  });

  it('nimmt 0 und Beträge an, weist Negatives und Unlesbares ab', () => {
    expect(uebersichtsBetrag('betriebskosten', 0)).toEqual({ wert: 0 });
    expect(uebersichtsBetrag('kaltmiete', 812.5)).toEqual({ wert: 812.5 });
    expect(uebersichtsBetrag('kaltmiete', -5)).toHaveProperty('fehler');
    expect(uebersichtsBetrag('qm', Number.NaN)).toHaveProperty('fehler');
  });

  it('wird von der Zelle benutzt, die keinen leeren Wert mehr zu 0 macht', () => {
    const quelle = readFileSync('src/components/dashboard/EditableMietUebersichtModal.tsx', 'utf-8');
    expect(quelle).not.toMatch(/value: wert \?\? 0/);
    expect(quelle).toMatch(/uebersichtsBetrag\(field, value\)/);
  });
});
