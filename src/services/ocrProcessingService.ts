import { ladePdfjs } from '@/utils/pdfjs';

interface OCRProcessingResult {
  success: boolean;
  extractedData?: {
    kaltmiete?: number;
    betriebskosten?: number;
    kaution_betrag?: number;
    start_datum?: string;
    ende_datum?: string;
    mieter_vorname?: string;
    mieter_nachname?: string;
    verwendungszweck?: string;
  };
  error?: string;
  confidence?: 'high' | 'medium' | 'low';
  fieldsExtracted?: number;
}

export class OCRProcessingService {
  static async processContractDocument(file: File): Promise<OCRProcessingResult> {
    try {
      let textContent = '';
      let base64 = '';
      let effectiveFileType = file.type;

      // Handle PDF files
      if (file.type === 'application/pdf') {
        // First try text extraction
        const extractedText = await this.extractTextFromPDF(file);

        if (extractedText && extractedText.trim().length >= 50) {
          // Good text extraction - use text mode, no image needed
          textContent = extractedText;
        } else {
          // Poor/no text extraction - render as JPEG for vision processing
          textContent = ''; // Clear any short garbage text
          base64 = await this.renderPdfFirstPageToBase64(file);
          effectiveFileType = 'image/jpeg';

          // Validate base64 is a valid JPEG (starts with /9j/ = FF D8 FF)
          if (!base64 || base64.length < 100 || !base64.startsWith('/9j/')) {
            return { success: false, error: 'PDF konnte nicht als Bild gerendert werden. Bitte lade ein klares Bild (JPG/PNG) oder ein textbasiertes PDF hoch.' };
          }
        }
      } else {
        // Convert non-PDF files to base64 for image processing
        base64 = await this.fileToBase64(file);
      }

      // Invoke Supabase Edge Function (für Bild-OCR oder wenn Text vorhanden ist)
      const { data, error } = await (await import('@/integrations/supabase/client'))
        .supabase.functions.invoke('process-contract-ocr', {
          body: {
            fileName: file.name,
            fileType: effectiveFileType,
            fileSize: file.size,
            fileContent: base64,
            textContent: textContent,
          },
        });

      if (error) {
        throw new Error(error.message || 'OCR processing failed');
      }

      return (data as OCRProcessingResult) ?? { success: false, error: 'Leere Antwort vom Server' };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'OCR processing failed',
      };
    }
  }

  /**
   * Liest eine Selbstauskunft oder einen Vorvertrag über `process-contract-ocr`.
   *
   * Word-Dateien und PDFs mit Textebene gehen als Text, gescannte PDFs als
   * mehrere Seitenbilder — die Kostenaufstellung eines alten Vertrags steht
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
        textContent = await this.extractTextFromPDF(datei);
        // Unter 200 Zeichen ist es ein Scan mit Kopfzeile, kein Textdokument
        if (textContent.replace(/Seite \d+:/g, '').trim().length < 200) {
          textContent = '';
          fileContents = await this.renderPdfSeitenZuBase64(datei, art === 'vorvertrag' ? 4 : 3);
        }
      } else if (typ.startsWith('image/') || /\.(jpe?g|png)$/.test(name)) {
        fileContents = [await this.fileToBase64(datei)];
      } else {
        return { success: false, error: 'Dieses Dateiformat wird nicht unterstützt. Bitte PDF, Word (.docx), JPG oder PNG.' };
      }
    } catch (e) {
      return {
        success: false,
        error: `Das Dokument ließ sich nicht öffnen (${e instanceof Error ? e.message : String(e)}).`,
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

  /** Die ersten Seiten eines PDFs als JPEG (base64), für gescannte Dokumente. */
  static async renderPdfSeitenZuBase64(datei: Blob, maxSeiten: number): Promise<string[]> {
    const pdfjsLib = await ladePdfjs();
    const pdf = await pdfjsLib.getDocument({ data: await datei.arrayBuffer() }).promise;
    const seiten: string[] = [];

    for (let nr = 1; nr <= Math.min(pdf.numPages, maxSeiten); nr++) {
      const page = await pdf.getPage(nr);
      const rendere = async (scale: number, quality: number): Promise<string> => {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) return '';
        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        canvas.width = 0;
        canvas.height = 0;
        const komma = dataUrl.indexOf(',');
        return komma >= 0 ? dataUrl.slice(komma + 1) : '';
      };
      // Mehrere Seiten in einer Anfrage: je Seite unter ~1,5 MB bleiben
      let bild = await rendere(1.2, 0.7);
      if (bild.length > 1.5 * 1024 * 1024) bild = await rendere(0.9, 0.55);
      if (bild.startsWith('/9j/')) seiten.push(bild);
    }
    return seiten;
  }

  static async extractTextFromPDF(file: Blob): Promise<string> {
    const pdfjsLib = await ladePdfjs();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    // Extract text from each page (limit to first 5 pages for performance)
    const numPages = Math.min(pdf.numPages, 5);

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += `\n\nSeite ${i}:\n${pageText}`;
    }

    return fullText.trim();
  }

  static async renderPdfFirstPageToBase64(file: File): Promise<string> {
    const pdfjsLib = await ladePdfjs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Erste Seite als JPEG rendern; Skalierung klein halten, damit die
    // base64-Nutzlast fuer die Edge Function handhabbar bleibt.
    const renderePdfSeite = async (scale: number, quality: number): Promise<string> => {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return '';
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.width = 0;
      canvas.height = 0;
      const commaIdx = dataUrl.indexOf(',');
      return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
    };

    const result = await renderePdfSeite(1.0, 0.7);

    // Zu gross (> 4MB base64 ~ 3MB Bild): noch einmal kleiner rendern.
    if (result.length > 4 * 1024 * 1024) {
      return renderePdfSeite(0.75, 0.5);
    }

    return result;
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