import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pruefeErhoehungsdaten, erhoehungsAnrede, BEGRUENDUNGS_BEZEICHNUNG, type MieterhoehungPdfData } from './mieterhoehungPdfGenerator';

const BASIS: MieterhoehungPdfData = {
  anrede: 'Herr',
  mieterName: 'Max Muster',
  mieterNachname: 'Muster',
  mieterAdresse: 'Musterweg 1',
  mieterPlzOrt: '31319 Sehnde',
  immobilieName: 'Haus A',
  immobilieAdresse: 'Musterstraße 1, 31319 Sehnde',
  einheitBezeichnung: 'WE 3',
  aktuelleKaltmiete: 500,
  aktuelleBetriebskosten: 120,
  neueKaltmiete: 560,
  neueBetriebskosten: 120,
  datum: '06.09.2026',
  wirksamDatum: '01.12.2026',
  begruendungsart: 'mietspiegel',
  begruendungText: 'Mietspiegel Sehnde 2025, Feld C3: 8,10–9,40 €/m².',
};

describe('Pflichtangaben des Erhöhungsverlangens (§ 558a BGB)', () => {
  it('lässt vollständige Daten durch', () => {
    expect(pruefeErhoehungsdaten(BASIS)).toEqual([]);
  });

  it('verweigert das Schreiben ohne Begründungstext', () => {
    const fehlt = pruefeErhoehungsdaten({ ...BASIS, begruendungText: '   ' });
    expect(fehlt).toHaveLength(1);
    expect(fehlt[0]).toContain('Begründung');
  });

  it('verweigert das Schreiben ohne Begründungsmittel', () => {
    const fehlt = pruefeErhoehungsdaten({ ...BASIS, begruendungsart: undefined as never });
    expect(fehlt.join(' ')).toContain('§ 558a');
  });

  it('verweigert eine Erhöhung, die keine ist', () => {
    expect(pruefeErhoehungsdaten({ ...BASIS, neueKaltmiete: 500 }).join(' ')).toContain('nicht über der bisherigen');
    expect(pruefeErhoehungsdaten({ ...BASIS, neueKaltmiete: 450 })).not.toEqual([]);
  });

  it('verlangt das Datum, ab dem die erhöhte Miete geschuldet wird', () => {
    expect(pruefeErhoehungsdaten({ ...BASIS, wirksamDatum: '' }).join(' ')).toContain('Datum');
  });

  it('kennt die vier Begründungsmittel des Gesetzes', () => {
    expect(Object.keys(BEGRUENDUNGS_BEZEICHNUNG).sort()).toEqual(
      ['gutachten', 'mietdatenbank', 'mietspiegel', 'vergleichswohnungen']
    );
    for (const text of Object.values(BEGRUENDUNGS_BEZEICHNUNG)) {
      expect(text).toContain('§ 558a Abs. 2');
    }
  });
});

describe('Der Brieftext bildet die Rechtslage ab', () => {
  const quelle = readFileSync('src/utils/mieterhoehungPdfGenerator.ts', 'utf-8');

  it('behauptet keine einseitige Erhöhung', () => {
    // § 558 BGB gibt nur einen Anspruch auf Zustimmung, kein Gestaltungsrecht.
    expect(quelle).not.toContain('hiermit erhöhen wir die Miete');
    expect(quelle).toContain('verlangen wir hiermit Ihre Zustimmung');
  });

  it('behandelt Schweigen nicht als Zustimmung', () => {
    // Die frühere Formulierung belehrte den Mieter falsch.
    expect(quelle).not.toContain('gilt Ihre Zustimmung als erteilt');
    expect(quelle).not.toContain('zu widersprechen');
  });

  it('nennt die Folge fehlender Zustimmung', () => {
    expect(quelle).toContain('§ 558b Abs. 2 Satz 2 BGB');
    expect(quelle).toContain('bleibt es bei der bisherigen Miete');
  });

  it('druckt die Begründung in das Schreiben', () => {
    expect(quelle).toContain('BEGRUENDUNGS_BEZEICHNUNG[data.begruendungsart]');
    expect(quelle).toContain('data.begruendungText');
  });
});

describe('Das Erhöhungsmodal ändert die Miete nur mit Zustimmung', () => {
  const quelle = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');

  it('schreibt das Verlangen als Vorgang', () => {
    expect(quelle).toContain("from('mieterhoehungen')");
  });

  it('kennt einen Haken für die Zustimmung des Mieters', () => {
    expect(quelle).toContain('mieterHatZugestimmt');
    expect(quelle).toContain('Der Mieter hat der Erhöhung zugestimmt');
  });

  it('schreibt die Vertragsmiete nie selbst — sie stellt die Datenbank zum wirksam_ab um', () => {
    // Bis zum 06.09.2026 wurde die Miete bedingungslos gesetzt, bis zum 28.10.2026 mit Zustimmung
    // sofort statt ab wirksam_ab (§ 558b Abs. 1 BGB) — beide Male stand monatelang ein zu hohes Soll,
    // und der Mahnlauf traf Mieter, die korrekt zahlten. Seit 28.10.2026 übernimmt nur die Datenbank
    // (mieterhoehung_anwenden_intern, Migration 20261028142000); der Dialog fasst mietvertrag nicht an.
    expect(quelle, 'Schreibzugriff auf mietvertrag im Erhöhungsdialog').not.toMatch(/from\(['"]mietvertrag['"]\)/);
    // 'wirksam' setzt nur die Datenbank (Wächter-Trigger mieterhoehung_status_waechter)
    expect(quelle).not.toMatch(/status:\s*['"]wirksam['"]/);
    // Der Haken macht den neuen Vorgang 'zugestimmt', sonst bleibt er 'verlangt'
    expect(quelle).toContain("status: mieterHatZugestimmt ? 'zugestimmt' : 'verlangt',");
  });

  it('übernimmt nur über die Datenbankfunktionen, jede an genau einer Stelle', () => {
    const zustimmen = [...quelle.matchAll(/erhoehungsRpc\('mieterhoehung_zustimmen'/g)];
    const anwenden = [...quelle.matchAll(/erhoehungsRpc\('mieterhoehung_anwenden'/g)];
    const zuruecknehmen = [...quelle.matchAll(/erhoehungsRpc\('mieterhoehung_zustimmung_zuruecknehmen'/g)];
    expect(zustimmen).toHaveLength(1);
    expect(anwenden).toHaveLength(1);
    expect(zuruecknehmen).toHaveLength(1);
    const zweig = (kopf: string) => {
      const start = quelle.indexOf(kopf);
      return [start, quelle.indexOf('\n  };\n', start)];
    };
    const [zStart, zEnde] = zweig('const handleZustimmungErfassen = async');
    expect(zustimmen[0].index).toBeGreaterThan(zStart);
    expect(zustimmen[0].index).toBeLessThan(zEnde);
    const [aStart, aEnde] = zweig('const handleTrotzdemUebernehmen = async');
    expect(anwenden[0].index).toBeGreaterThan(aStart);
    expect(anwenden[0].index).toBeLessThan(aEnde);
    // „Trotzdem übernehmen“ ist immer ausdrücklich
    expect(quelle.slice(aStart, aEnde)).toContain('p_trotz_abweichung: true');
    const [rStart, rEnde] = zweig('const handleZustimmungZuruecknehmen = async');
    expect(zuruecknehmen[0].index).toBeGreaterThan(rStart);
    expect(zuruecknehmen[0].index).toBeLessThan(rEnde);
  });

  it('nennt beim Haken, ab wann die erhöhte Miete gilt', () => {
    expect(quelle).toContain('erhoehungGiltSpaeter');
    expect(quelle).toContain('558b Abs. 1 BGB');
    expect(quelle).toContain('Bis dahin bleiben Vertragsmiete und Forderungen unverändert');
  });
});

describe('erhoehungsAnrede', () => {
  const anna = { vorname: 'Anna', nachname: 'Beispiel' };
  const ben = { vorname: 'Ben', nachname: 'Muster' };

  it('beugt Herr und Frau bei genau einem Mieter', () => {
    // 27.10.2026: fest „Sehr geehrter ${anrede}“ ergab „Sehr geehrter Frau Beispiel“
    expect(erhoehungsAnrede('Frau', [anna])).toEqual({ anschrift: 'Frau', gruss: 'Sehr geehrte Frau Beispiel,' });
    expect(erhoehungsAnrede(' herr ', [ben])).toEqual({ anschrift: 'Herrn', gruss: 'Sehr geehrter Herr Muster,' });
  });

  it('spricht mehrere Mieter alle an und rät ohne Anrede nicht', () => {
    expect(erhoehungsAnrede('Herr', [anna, ben])).toEqual({ anschrift: '', gruss: 'Guten Tag Anna Beispiel und Ben Muster,' });
    expect(erhoehungsAnrede('', [anna])).toEqual({ anschrift: '', gruss: 'Guten Tag Anna Beispiel,' });
    expect(erhoehungsAnrede('Familie', [anna, ben]).anschrift).toBe('Familie');
    expect(erhoehungsAnrede('', []).gruss).toBe('Sehr geehrte Damen und Herren,');
  });

  it('speichert nur ein Schreiben zum aktuellen Stand, Begründung eingeschlossen', () => {
    // 27.10.2026: Begründung fehlte in den Abhängigkeiten, ein altes PDF blieb speicherbar
    const modal = readFileSync('src/components/dashboard/rent-increase/RentIncreaseModal.tsx', 'utf-8');
    expect(modal).toMatch(/neueKaltmiete, neueBetriebskosten, begruendungsart, begruendungText\]\);/);
    expect(modal).toMatch(/if \(!pdfBlob \|\| pdfStand !== JSON\.stringify\(buildPdfData\(\)\)\)/);
    expect(modal).toMatch(/\}, \[isOpen, contractData\?\.mietvertrag_id\]\);/);
  });
});
