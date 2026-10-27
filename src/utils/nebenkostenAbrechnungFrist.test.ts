import { describe, expect, it } from 'vitest';
import { zahlungsfristAus } from './nebenkostenAbrechnungPdfGenerator';

describe('zahlungsfristAus', () => {
  it('setzt die Frist auf Briefdatum plus 30 Tage statt fest auf den 30. März', () => {
    // 27.10.2026: Eine heute erstellte Abrechnung 2025 verlangte Zahlung bis 30. März 2026
    expect(zahlungsfristAus('27.10.2026')).toBe('26. November 2026');
    expect(zahlungsfristAus('15.12.2026')).toBe('14. Januar 2027');
  });
});

describe('Abrechnungs-PDF Seite 3', () => {
  it('druckt Zeitanteil, genaue Fläche und eine Frist ab Briefdatum', async () => {
    const { generateNebenkostenAbrechnungPdf } = await import('./nebenkostenAbrechnungPdfGenerator');
    const blob = await generateNebenkostenAbrechnungPdf({
      immobilieAdresse: 'Musterweg 1, 31319 Sehnde', empfaengerName: 'Anna Beispiel', empfaengerAdresse: ['Musterweg 1', '31319 Sehnde'],
      gesamtFlaeche: 300, anzahlWohneinheiten: 3, gesamtPersonentage: null, immobilieKosten: [], immobilieGesamtkosten: 1000,
      einheitBezeichnung: 'EG links', qm: 114.37, anzahlPersonen: 2, personentageEinheit: null, mieterName: 'Anna Beispiel',
      abrechnungsjahr: 2025, abrechnungszeitraumVon: '01.01.2025', abrechnungszeitraumBis: '31.12.2025', nutzungVon: '01.07.2025', nutzungBis: '31.12.2025',
      kostenDetails: [{ kategorieName: 'Grundsteuer', gesamtKosten: 600, verteilerschluessel: 'qm', anteilProzent: 19.06, anteilBetrag: 114.37, einheitenGesamt: 300, ihreEinheiten: 114.37, nutzungsdauerProzent: 50.41 }],
      monatlicheVorauszahlung: 10, anzahlMonate: 6, vorauszahlungenGesamt: 60, kostenAnteilGesamt: 114.37, saldo: 54.37, abrechnungsDatum: '27.10.2026',
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    // 27.10.2026: Zeitanteil fehlte, Fläche ganzzahlig, Frist „30. März 2026“ (verstrichen)
    expect(text).toContain('Zeitanteil am Abrechnungszeitraum: 50,41 %');
    expect(text).toContain('114,37');
    expect(text).toContain('26. November 2026');
    expect(text).not.toContain('30. M');
  });
});
