import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fristloseKuendigungFelder } from './contractUtils';
import { freitextBloecke, generateMahnungPdf, mahnungBetreff, type MahnungPdfData } from './mahnungPdfGenerator';
import { jsPDF } from 'jspdf';
import { anredeZeilen, beginneBrief, geschuetzt, ladeBriefbilder } from './pdf/briefbogen';
import { COMPANY } from '@/config/company';

/**
 * Ab Stufe 3 enthält das Mahnschreiben eine echte Kündigungserklärung
 * („Hiermit kündige ich das Mietverhältnis außerordentlich fristlos").
 * Bis zum 06.09.2026 blieb der Vertrag danach auf `aktiv`: Die Sollstellung
 * lief weiter, das Dashboard zählte die Einheit als vermietet, und keine
 * Auswertung über `status` kannte den Vorgang. Der Mieter hielt ein
 * Kündigungsschreiben, das System wusste nichts davon.
 */
describe('Kündigungsmahnung setzt den Vertragsstatus', () => {
  const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
  const generator = readFileSync('src/utils/mahnungPdfGenerator.ts', 'utf-8');

  it('das Schreiben kündigt ab Stufe 3 tatsächlich', () => {
    expect(generator).toContain('data.mahnstufe >= 3');
    expect(generator).toContain('außerordentlich fristlos');
  });

  it('der Versand setzt den Vertrag auf gekündigt', () => {
    expect(modal).toMatch(/mahnstufe >= 3/);
    expect(modal).toContain('...fristloseKuendigungFelder(');
    expect(fristloseKuendigungFelder(14).status).toBe('gekuendigt');
  });

  it('schreibt ende_datum und kuendigungsdatum gleich, auf das Räumungsende', () => {
    // ende_datum ist die führende Quelle des Vertragsendes (contractUtils.ts).
    // Wer nur kuendigungsdatum setzt, erzeugt den am 03.09.2026 bereinigten
    // Zustand aus zwei widersprüchlichen Feldern neu. Stand kuendigungsdatum auf
    // dem Versandtag, beendete der Nachtlauf den Vertrag in der Folgenacht (27.10.2026).
    const felder = fristloseKuendigungFelder(14, new Date(2026, 9, 27));
    expect(felder.ende_datum).toBe('2026-11-10');
    expect(felder.kuendigungsdatum).toBe(felder.ende_datum);
  });

  it('meldet es sichtbar, wenn der Statuswechsel scheitert', () => {
    // Ein stiller Fehler wäre hier besonders gefährlich: Das Schreiben ist
    // dann raus, der Vertrag läuft im System weiter.
    expect(modal).toContain('Vertragsstatus nicht gesetzt');
    // Nur ein Toast zugleich (TOAST_LIMIT = 1): Die Erfolgsmeldung darf die Warnung nicht
    // verdrängen (27.10.2026) — sie kommt nur, wenn nichts zu melden ist
    expect(modal).toMatch(/if \(probleme\.length > 0\) \{[\s\S]*?\} else \{[\s\S]*?title: "E-Mail versendet"/);
  });

  it('warnt vor dem Versand, dass gekündigt wird', () => {
    expect(modal).toContain('Fristlose Kündigung versenden?');
    expect(modal).toContain('543 Abs. 2 Nr. 3');
  });
});

/**
 * Layout nach der Briefvorlage des Kunden (30.10.2026). Bis dahin fiel der Text auf Seite 2 in die 6-pt-Schrift der
 * Fußzeile (addFooter verstellte die Schrift, der Umbruch zeichnete damit weiter), und eine Mahnung der Stufe 2
 * brauchte zwei Seiten.
 */
describe('Mahnung im Layout der Briefvorlage', () => {
  const basis: MahnungPdfData = {
    anrede: '',
    mieterName: 'Erika Mustermann & Max Beispiel',
    mieterNachname: 'Mustermann',
    mieter: [{ vorname: 'Erika', nachname: 'Mustermann' }, { vorname: 'Max', nachname: 'Beispiel' }],
    mieterAdresse: 'Musterweg 12 B',
    mieterPlzOrt: '29221 Celle',
    einheitBezeichnung: 'WE',
    immobilieAdresse: 'Musterweg 12 B, 29221 Celle',
    vertragStart: '01.03.2024',
    mahnstufe: 2,
    datum: '30.10.2026',
    offeneForderungen: [{ monat: '09/2026', betrag: 924 }, { monat: '10/2026', betrag: 1638 }],
    gesamtRueckstand: 2562,
    anzahlMonatsmieten: 1.5,
    verzugszinsenDetails: [{ monat: '09/2026', betrag: 7.12 }, { monat: '10/2026', betrag: 0, laufend: true }],
    verzugszinsenGesamt: 7.12,
    mahnkostenProSchreiben: 5,
    anzahlMahnschreiben: 2,
    mahnkostenGesamt: 10,
    zahlungsfristDatum: '13.11.2026',
    zahlungsfristTage: 14,
    raeumungsfristDatum: '30.11.2026',
    unterzeichner: COMPANY.unterzeichner[0],
  };

  /** Seiteninhalte mit Schriftgröße je Textstück; in Node lädt kein Bild, die Streams sind nur Seiten */
  async function seiten(daten: MahnungPdfData): Promise<Array<Array<{ text: string; groesse: number }>>> {
    const roh = Buffer.from(await (await generateMahnungPdf(daten)).arrayBuffer()).toString('latin1');
    return [...roh.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(([, inhalt]) => {
      const stuecke: Array<{ text: string; groesse: number }> = [];
      let groesse = 0;
      for (const [, tf, text] of inhalt.matchAll(/\/F\d+ ([\d.]+) Tf|\(((?:\\.|[^\\()])*)\) Tj/g)) {
        if (tf) groesse = Number(tf);
        else {
          // Oktal-Escapes sind WinAnsi-Bytes (Umlaute, „–“ = 0x96), sonst nur maskierte Zeichen wie „\(“
          const bytes = text.replace(/\\(\d{3}|.)/g, (_, e: string) => (e.length === 3 ? String.fromCharCode(parseInt(e, 8)) : e));
          stuecke.push({ text: new TextDecoder('windows-1252').decode(Uint8Array.from(bytes, (z) => z.charCodeAt(0))), groesse });
        }
      }
      return stuecke;
    }).filter((s) => s.length > 0);
  }

  it('Betreff wie in der Vorlage: Art des Schreibens – Anschrift', () => {
    expect(mahnungBetreff({ mahnstufe: 1, immobilieAdresse: 'Musterweg 12 B, 29221 Celle' }))
      .toBe('Erste Mahnung wegen Mietrückstand – Musterweg 12 B, 29221 Celle');
    expect(mahnungBetreff({ mahnstufe: 2, immobilieAdresse: ' ' })).toBe('Zweite Mahnung wegen Mietrückstand');
    expect(mahnungBetreff({ mahnstufe: 3, immobilieAdresse: 'A' })).toContain('fristlose Kündigung');
  });

  it('mehrere Personen in der Anrede stehen je auf einer Zeile', () => {
    expect(anredeZeilen('Sehr geehrte Frau A, sehr geehrter Herr B, sehr geehrte Frau C,'))
      .toEqual(['Sehr geehrte Frau A,', 'sehr geehrter Herr B,', 'sehr geehrte Frau C,']);
    expect(anredeZeilen('Guten Tag A, B und C,')).toEqual(['Guten Tag A, B und C,']);
  });

  it('Betrag und Währung, Paragraph und Zahl bleiben zusammen', () => {
    expect(geschuetzt('insgesamt 2.562,00 € nach §§ 543 und § 288 BGB'))
      .toBe('insgesamt 2.562,00 € nach §§ 543 und § 288 BGB');
  });

  it('Freitext: eingerückte Zeilen werden zur Aufzählung, Leerzeilen fallen weg', () => {
    expect(freitextBloecke('Erster Satz.\n  09/2026: 1,00 €\n  10/2026: 2,00 €\n\nLetzter Satz.')).toEqual([
      { art: 'absatz', zeilen: ['Erster Satz.'] },
      { art: 'liste', zeilen: ['09/2026: 1,00 €', '10/2026: 2,00 €'] },
      { art: 'absatz', zeilen: ['Letzter Satz.'] },
    ]);
  });

  it('ein beschädigtes Bild verhindert das Schreiben nicht', () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const kaputt = 'data:image/png;base64,PGh0bWw+';
    const brief = beginneBrief(doc, { logo: kaputt, ihk: kaputt, creditreform: kaputt }, {
      name: 'Erika Mustermann', zeilen: ['Musterweg 1', '29221 Celle'], datum: '30.10.2026', betreff: 'Erste Mahnung',
      unterzeichner: COMPANY.unterzeichner[0],
    });
    brief.anrede('Guten Tag Erika Mustermann,');
    expect(brief.fertig().size).toBeGreaterThan(0);
  });

  it('liefert der Server index.html statt eines Bildes, bleibt die Stelle leer', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html><html></html>', { status: 200 }));
    try {
      expect(await ladeBriefbilder()).toEqual({ logo: null, ihk: null, creditreform: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ein Freitext nur aus Leerzeichen gilt als leer', async () => {
    const text = (await seiten({ ...basis, freitext: '  \n ' })).flat().map((s) => s.text).join(' ');
    expect(text).toContain('Zu zahlen sind insgesamt');
  });

  it('Rückfragenblock und Unterschrift nennen den gewählten Unterzeichner, nicht einen festen', async () => {
    const [eins, zwei] = COMPANY.unterzeichner;
    for (const [gewaehlt, anderer] of [[eins, zwei], [zwei, eins]]) {
      const texte = (await seiten({ ...basis, unterzeichner: gewaehlt })).flat().map((s) => s.text);
      for (const wert of [gewaehlt.kontaktname, gewaehlt.telefon, gewaehlt.email, gewaehlt.unterschrift, gewaehlt.funktion]) {
        expect(texte).toContain(wert);
      }
      for (const wert of [anderer.kontaktname, anderer.telefon, anderer.email, anderer.unterschrift]) {
        expect(texte).not.toContain(wert);
      }
    }
  });

  it('der Dialog belegt mit dem Angemeldeten vor und erzeugt ohne Wahl kein Schreiben', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).toContain('setUnterzeichnerEmail(unterzeichnerZurAnmeldung(user?.email)?.email ?? "")');
    expect(modal).toContain('if (!contractData || !unterzeichner) return null;');
    // Herunterladen nur, was zu den jetzigen Eingaben passt; beim Öffnen wird das alte Schreiben verworfen
    expect(modal).toContain('disabled={!pdfBlobUrl || !vorschauAktuell}');
    expect(modal).toMatch(/setGespeichert\(null\);[\s\S]{0,400}vorschauLauf\.current\+\+;[\s\S]{0,200}setPdfBlobUrl\(null\);/);
  });

  it('eine übliche zweite Mahnung passt auf eine Seite', async () => {
    expect(await seiten(basis)).toHaveLength(1);
  });

  it('der Text auf Folgeseiten bleibt in Briefschrift, der Gruß steht nie allein', async () => {
    const lang = await seiten({
      ...basis,
      mahnstufe: 3,
      offeneForderungen: Array.from({ length: 12 }, (_, i) => ({ monat: `${i + 1}/2026`, betrag: 812.5 })),
    });
    expect(lang.length).toBeGreaterThan(1);
    const letzte = lang[lang.length - 1];
    const gruss = letzte.find((s) => s.text === 'Mit freundlichem Gruß');
    expect(gruss?.groesse).toBe(11);
    expect(letzte.some((s) => s.text.startsWith('Für Rückfragen') || s.text === 'Für')).toBe(true);
    // Nichts kleiner als die Fußzeile selbst (6,5 pt)
    expect(lang.flat().filter((s) => s.groesse < 6.5)).toEqual([]);
  });
});
