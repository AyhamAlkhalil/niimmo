import { ladePdfjs } from '@/utils/pdfjs';
import {
  MAX_BILDER_ZEICHEN,
  bildBudget,
  bildumfangFehler,
  massstab,
  rendereImBudget,
  seitenText,
  textebeneVorhanden,
  textMitSeiten,
  type BildStufe,
} from '@/utils/pdfAuslese';

/** Das PDF passt auch verkleinert nicht in eine Auslese; die Meldung geht so an den Nutzer. */
export class DokumentZuGrossFehler extends Error {}

/** Der Ausschnitt aus PDF.js, den das Rendern einer Seite braucht. */
interface PdfSeite {
  getViewport(optionen: { scale: number }): { width: number; height: number };
  render(optionen: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

export class OCRProcessingService {
  /**
   * Ein PDF für `process-contract-ocr`: die Textebene aller Seiten und jede Seite als JPEG.
   * Ohne nennenswerte Textebene (Scan) bleibt `textContent` leer. Warum alle Seiten und
   * beides zugleich: siehe utils/pdfAuslese.ts.
   */
  static async liesPdfFuerAuslese(datei: Blob): Promise<{ textContent: string; fileContents: string[] }> {
    const pdfjsLib = await ladePdfjs();
    const ladeauftrag = pdfjsLib.getDocument({ data: await datei.arrayBuffer() });
    try {
      const pdf = await ladeauftrag.promise;
      const texte: string[] = [];
      const bilder: string[] = [];
      let belegt = 0;
      let stufe = 0;
      for (let nr = 1; nr <= pdf.numPages; nr++) {
        const page = await pdf.getPage(nr);
        texte.push(seitenText((await page.getTextContent()).items));
        const budget = bildBudget(MAX_BILDER_ZEICHEN - belegt, pdf.numPages - nr + 1);
        // Eine Stufe schärfer als die vorige Seite beginnen: Nach einer Fotoseite
        // sollen die folgenden Seiten nicht dauerhaft auf der kleinsten Stufe bleiben
        const gerendert = await rendereImBudget(s => this.rendereSeite(page, s), budget, stufe - 1);
        // Eine fehlende Seite darf nicht still wegfallen
        if (!gerendert.bild) throw new Error(`Seite ${nr} ließ sich nicht als Bild darstellen`);
        bilder.push(gerendert.bild);
        belegt += gerendert.bild.length;
        stufe = gerendert.stufe;
        page.cleanup();
        // Steht fest, dass es nicht passt, nicht die restlichen Seiten rendern
        const fehler = bildumfangFehler(pdf.numPages, belegt);
        if (fehler) throw new DokumentZuGrossFehler(fehler);
      }
      return { textContent: textebeneVorhanden(texte) ? textMitSeiten(texte) : '', fileContents: bilder };
    } finally {
      // Jedes getDocument startet einen eigenen Worker; ohne destroy blieb er bis zum Neuladen,
      // auch wenn schon das Laden scheiterte
      ladeauftrag.destroy().catch(() => undefined);
    }
  }

  private static async rendereSeite(page: PdfSeite, stufe: BildStufe): Promise<string> {
    const basis = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: massstab(stufe, basis.width, basis.height) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', stufe.quality);
    canvas.width = 0;
    canvas.height = 0;
    const komma = dataUrl.indexOf(',');
    return komma >= 0 ? dataUrl.slice(komma + 1) : '';
  }

  /**
   * Liest eine Selbstauskunft oder einen Vorvertrag über `process-contract-ocr`.
   *
   * Word-Dateien gehen als Text, PDFs mit allen Seiten als Text und Seitenbild
   * (liesPdfFuerAuslese) — die Kostenaufstellung eines alten Vertrags steht
   * auf Seite 2 oder 3, die weiteren Personen der Selbstauskunft auf Seite 2.
   * Der Dateiname geht nicht mit: er enthält meist den Namen des Mieters.
   */
  static async liesDokument<T>(
    datei: Blob,
    dateiname: string,
    art: 'selbstauskunft' | 'vorvertrag'
  ): Promise<{ success: boolean; extractedData?: T; error?: string }> {
    const name = dateiname.toLowerCase();
    const typ = datei.type;
    let textContent = '';
    let fileContents: string[] = [];

    try {
      if (typ.includes('wordprocessingml') || name.endsWith('.docx')) {
        textContent = await this.extractTextFromDocx(datei);
      } else if (name.endsWith('.doc')) {
        return {
          success: false,
          error: 'Word-Dateien im alten .doc-Format lassen sich nicht lesen. Bitte als PDF oder .docx ablegen.',
        };
      } else if (typ === 'application/pdf' || name.endsWith('.pdf')) {
        ({ textContent, fileContents } = await this.liesPdfFuerAuslese(datei));
      } else if (typ.startsWith('image/') || /\.(jpe?g|png)$/.test(name)) {
        fileContents = [await this.fileToBase64(datei)];
      } else {
        return { success: false, error: 'Dieses Dateiformat wird nicht unterstützt. Bitte PDF, Word (.docx), JPG oder PNG.' };
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof DokumentZuGrossFehler
          ? e.message
          : `Das Dokument ließ sich nicht öffnen (${e instanceof Error ? e.message : String(e)}).`,
      };
    }

    if (!textContent.trim() && fileContents.length === 0) {
      return { success: false, error: 'Das Dokument enthält weder Text noch eine darstellbare Seite.' };
    }

    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase.functions.invoke('process-contract-ocr', {
      body: { art, textContent, fileContents },
    });
    if (error) return { success: false, error: error.message || 'Auslesen fehlgeschlagen.' };
    return (data as { success: boolean; extractedData?: T; error?: string }) ?? {
      success: false,
      error: 'Leere Antwort vom Server',
    };
  }

  /**
   * Text aus einer .docx: Absätze als Zeilen, Tabulatoren bleiben erhalten.
   * Ankreuzfelder stehen in den NiImmo-Vorlagen als „[x]" im Text.
   */
  static async extractTextFromDocx(datei: Blob): Promise<string> {
    const { unzipSync, strFromU8 } = await import('fflate');
    const dateien = unzipSync(new Uint8Array(await datei.arrayBuffer()), {
      filter: f => f.name === 'word/document.xml',
    });
    const xml = dateien['word/document.xml'];
    if (!xml) throw new Error('keine Word-Datei');
    return strFromU8(xml)
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .split('\n')
      .map(z => z.trim())
      .filter(Boolean)
      .join('\n');
  }

  private static fileToBase64(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove any data:*;base64, prefix if present
        const commaIdx = result.indexOf(',');
        const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  /**
   * Validate extracted contract data for reasonableness
   */
  static validateExtractedData(data: any): boolean {
    // Basic validation rules
    if (data.kaltmiete) {
      const rent = parseFloat(data.kaltmiete);
      if (rent < 100 || rent > 10000) return false; // Reasonable rent range
    }

    if (data.kaution_betrag) {
      const deposit = parseFloat(data.kaution_betrag);
      if (deposit < 0 || deposit > 50000) return false; // Reasonable deposit range
    }

    if (data.start_datum) {
      const startDate = new Date(data.start_datum);
      const now = new Date();
      const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      const twoYearsForward = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());

      if (startDate < fiveYearsAgo || startDate > twoYearsForward) return false;
    }

    return true;
  }

  /**
   * Format extracted data for form fields
   */
  static formatDataForForm(data: any) {
    const formatted: any = {};

    if (data.kaltmiete) formatted.kaltmiete = data.kaltmiete.toString();
    if (data.betriebskosten) formatted.betriebskosten = data.betriebskosten.toString();
    if (data.kaution_betrag) formatted.kaution_betrag = data.kaution_betrag.toString();
    if (data.start_datum) formatted.start_datum = data.start_datum;
    if (data.ende_datum) formatted.ende_datum = data.ende_datum;
    if (data.verwendungszweck) formatted.verwendungszweck = data.verwendungszweck;

    return formatted;
  }
}
