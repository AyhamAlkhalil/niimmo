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

describe('Abrechnungs-PDF Rechenweg und Gutschriften (28.10.2026)', () => {
  const zeile = (verteilerschluessel: string, nutzungsdauerProzent = 50.41) => ({
    kategorieName: 'X', gesamtKosten: 100, verteilerschluessel, anteilProzent: 10, anteilBetrag: 10, nutzungsdauerProzent,
  });

  it('nennt den Zeitanteil nur dort als Faktor, wo er multipliziert wird', async () => {
    const { rechenwegHinweis } = await import('./nebenkostenAbrechnungPdfGenerator');
    // Nur Personentage: kein „× Zeitanteil“, der steckt schon in den Einheiten
    const nurPersonen = rechenwegHinweis([zeile('personen')]) ?? '';
    expect(nurPersonen).not.toContain('× Zeitanteil');
    expect(nurPersonen).toContain('schon in Ihren Einheiten enthalten');
    // Gemischt: Zeitanteil nur für Fläche/Einheit, Personentage gesondert
    const gemischt = rechenwegHinweis([zeile('qm'), zeile('personen', 100)]) ?? '';
    expect(gemischt).toContain('Zeitanteil am Abrechnungszeitraum: 50,41 %');
    expect(gemischt).toContain('bei Wohnfläche und Einheit');
    expect(gemischt).toContain('schon in Ihren Einheiten enthalten');
    // Reine Fläche wie bisher
    expect(rechenwegHinweis([zeile('qm')])).toContain('Ihre Kosten = Preis/E × Ihre Einheiten × Zeitanteil');
    expect(rechenwegHinweis([])).toBeNull();
  });

  it('druckt angebrochene Monate mit zwei Nachkommastellen', async () => {
    const { monateText } = await import('./nebenkostenAbrechnungPdfGenerator');
    expect(monateText(12)).toBe('12');
    expect(monateText(5.4838)).toBe('5,48');
    expect(monateText(6.5)).toBe('6,50');
  });

  it('weist verrechnete Gutschriften je Kostenart aus', async () => {
    const { generateNebenkostenAbrechnungPdf, gutschriftZeilen } = await import('./nebenkostenAbrechnungPdfGenerator');
    const kosten = [
      { betrkvNummer: '2.3', name: 'Entwässerung', verteilerschluessel: 'qm', betragGesamt: 480, einheitenLabel: '300 m²', gutschriften: -120 },
      { betrkvNummer: '2.1', name: 'Grundsteuer', verteilerschluessel: 'gleich', betragGesamt: 600, einheitenLabel: '3', gutschriften: 0 },
    ];
    expect(gutschriftZeilen(kosten)).toEqual(['2.3 Entwässerung: Kosten 600,00 €, Gutschrift -120,00 €, verbleiben 480,00 €']);

    const blob = await generateNebenkostenAbrechnungPdf({
      immobilieAdresse: 'Musterweg 1, 31319 Sehnde', empfaengerName: 'Anna Beispiel', empfaengerAdresse: ['Musterweg 1', '31319 Sehnde'],
      gesamtFlaeche: 300, anzahlWohneinheiten: 3, gesamtPersonentage: 1095, immobilieKosten: kosten, immobilieGesamtkosten: 1080,
      einheitBezeichnung: 'EG links', qm: 100, anzahlPersonen: 1, personentageEinheit: 365, mieterName: 'Anna Beispiel',
      abrechnungsjahr: 2025, abrechnungszeitraumVon: '01.01.2025', abrechnungszeitraumBis: '31.12.2025', nutzungVon: '01.01.2025', nutzungBis: '31.12.2025',
      kostenDetails: [{ betrkvNummer: '2.3', kategorieName: 'Entwässerung', gesamtKosten: 480, verteilerschluessel: 'personen', anteilProzent: 33.33, anteilBetrag: 160, einheitenGesamt: 1095, ihreEinheiten: 365, nutzungsdauerProzent: 100 }],
      monatlicheVorauszahlung: 10, anzahlMonate: 5.4838, vorauszahlungenGesamt: 54.84, kostenAnteilGesamt: 160, saldo: 105.16, abrechnungsDatum: '28.10.2026',
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('Verrechnete Gutschriften der Versorger:');
    expect(text).toContain('Gutschrift -120,00');
    expect(text).toContain('5,48 Mon.');
    expect(text).not.toContain('× Zeitanteil');
  });
});
