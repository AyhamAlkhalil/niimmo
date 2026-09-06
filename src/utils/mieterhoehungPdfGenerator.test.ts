import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pruefeErhoehungsdaten, BEGRUENDUNGS_BEZEICHNUNG, type MieterhoehungPdfData } from './mieterhoehungPdfGenerator';

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

  it('ändert die Vertragsmiete ausschließlich innerhalb dieses Hakens', () => {
    // Bis zum 06.09.2026 wurde die Miete bedingungslos gesetzt — drei Monate
    // lang stand damit ein zu hohes Soll, und der Mahnlauf traf Mieter, die
    // korrekt zahlten. Der Schreibzugriff darf nur im Zweig der Zustimmung
    // stehen.
    const schreibstelle = quelle.search(/from\(['"]mietvertrag['"]\)[\s\S]{0,40}\.update\(/);
    expect(schreibstelle, 'kein Schreibzugriff auf mietvertrag gefunden').toBeGreaterThan(-1);

    const bedingung = quelle.lastIndexOf('if (mieterHatZugestimmt)', schreibstelle);
    expect(bedingung, 'der Schreibzugriff steht außerhalb der Zustimmungsprüfung').toBeGreaterThan(-1);
    // Die Bedingung muss unmittelbar davor stehen, nicht irgendwo weiter oben.
    expect(schreibstelle - bedingung).toBeLessThan(400);
  });

  it('warnt, wenn die Erhöhung erst später geschuldet ist', () => {
    expect(quelle).toContain('erhoehungGiltSpaeter');
    expect(quelle).toContain('558b Abs. 1 BGB');
  });
});
