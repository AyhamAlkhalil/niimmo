import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { leseAnzahlSchreiben, leseMahnungBetraege, mahnkostenGesamtText, mahnungBetragsMeldung } from './mahnungEingaben';

/**
 * Prüfung 28.10.2026: Der Mahnungsdialog las „1.250“ als 1,25 € (parseFloat nach
 * normalisiereDezimalEingabe, die einen einzelnen Punkt stehen lässt).
 */
describe('Beträge im Mahnungsdialog', () => {
  it('liest „1.250“ nicht als 1,25 €, sondern meldet das Feld', () => {
    const { werte, ungueltig } = leseMahnungBetraege({ rueckstand: '1.250', mahnkostenProSchreiben: '11.00', verzugszinsen: '0.00' });
    expect(ungueltig).toEqual(['rueckstand']);
    expect(werte.rueckstand).toBe(0);
    expect(werte.mahnkostenProSchreiben).toBe(11);
  });

  it('liest normalisierte Eingaben und Dezimalkomma', () => {
    const { werte, ungueltig } = leseMahnungBetraege({ rueckstand: '1250.00', mahnkostenProSchreiben: '11,5', verzugszinsen: '3.27' });
    expect(ungueltig).toEqual([]);
    expect(werte).toEqual({ rueckstand: 1250, mahnkostenProSchreiben: 11.5, verzugszinsen: 3.27 });
  });

  it('zählt leere Felder als 0 und lehnt Negatives ab', () => {
    const { werte, ungueltig } = leseMahnungBetraege({ rueckstand: '', mahnkostenProSchreiben: '-5', verzugszinsen: '' });
    expect(werte.rueckstand).toBe(0);
    expect(ungueltig).toEqual(['mahnkostenProSchreiben']);
  });

  it('rechnet Mahnkosten nie aus einem Tausenderpunkt-Betrag', () => {
    expect(mahnkostenGesamtText('11.00', '3')).toBe('33.00');
    expect(mahnkostenGesamtText('1.100', '2')).toBe('0.00');
    expect(mahnkostenGesamtText('', '2')).toBe('0.00');
  });

  it('nennt die betroffenen Felder in der Meldung', () => {
    expect(mahnungBetragsMeldung([])).toBe('');
    expect(mahnungBetragsMeldung(['rueckstand', 'verzugszinsen'])).toContain('Gesamtrückstand, Zwischensumme Verzugszinsen');
  });
});

/**
 * Prüfung 28.10.2026: Hochgeladen wurde pdfBlob ohne Abgleich mit dem Eingabestand, Betrag und
 * Frist der Mail kamen aus dem aktuellen Formular. Die Komponente ist ungetestet; geprüft wird
 * am Quelltext, dass Speichern an den Vorschaustand und die Mail an das abgelegte Schreiben gebunden ist.
 */
describe('Mahnungsdialog: PDF und Mail aus demselben Stand', () => {
  const dialog = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');

  it('sperrt Speichern, solange die Vorschau nicht zum Eingabestand passt oder ein Betrag unlesbar ist', () => {
    expect(dialog).toContain('const vorschauAktuell = pdfBlob !== null && pdfStand === aktuellerStand;');
    expect(dialog).toContain("betraege.ungueltig.length > 0 || anzahlUngueltig || !vorschauAktuell");
    expect(dialog).toContain('if (!stand || stand !== aktuellerStand)');
  });

  it('versendet Betrag, Frist und Anhang aus dem abgelegten Schreiben', () => {
    expect(dialog).toContain('rueckstandBetrag: stand.daten.gesamtRueckstand,');
    expect(dialog).toContain('zahlungsfristTage: stand.daten.zahlungsfristTage,');
    expect(dialog).toContain('pdfPath: stand.pfad,');
    expect(dialog).not.toMatch(/parseFloat\((gesamtRueckstand|mahnkostenGesamt|verzugszinsenGesamt|mahnkostenProSchreiben)\)/);
  });
});

describe('Mahnung: Anzahl, Fristen am Speichertag, Vorschau-URL (Review/QA 28.10.2026)', () => {
  it('lässt keine negative oder unlesbare Anzahl zu und nie negative Mahnkosten', () => {
    expect(mahnkostenGesamtText('5', '-2')).toBe('0.00');
    expect(leseAnzahlSchreiben('-2')).toBeUndefined();
    expect(leseAnzahlSchreiben('2.5')).toBeUndefined();
    expect(leseAnzahlSchreiben('')).toBe(0);
    expect(leseAnzahlSchreiben(' 3 ')).toBe(3);
  });

  const dialog = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');

  it('hält Zahlungsfrist und Räumungsende beim Speichern fest und versendet genau diese', () => {
    expect(dialog).toContain("const fristIso = daten.zahlungsfristDatum.split('.').reverse().join('-');");
    expect(dialog).toContain('setGespeichert({ pfad: filePath, daten, fristIso, kuendigung });');
    expect(dialog).toContain('const kuendigung = stand.kuendigung ?? undefined;');
    expect(dialog).toContain('fristDatum: stand.fristIso,');
    expect(dialog).toMatch(/if \(stand\.fristIso < heuteIso \|\| \(stand\.kuendigung && stand\.kuendigung\.ende_datum < heuteIso\)\)/);
  });

  it('setzt ersatzweise nur einen laufenden Vertrag auf gekündigt', () => {
    expect(dialog).toMatch(/\.\.\.kuendigung,[\s\S]{0,160}\.in\('status', \['aktiv', 'gekuendigt'\]\)/);
  });

  it('gibt die Vorschau-URL über einen Ref frei, nicht über einen veralteten Closure-Wert', () => {
    expect(dialog).toContain('if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);');
    expect(dialog).not.toContain('if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);');
    expect(dialog).toContain('}, [buildPdfData]);');
  });
});
