import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { MAX_BILDER_ZEICHEN } from '@/utils/pdfAuslese';
import { DokumentZuGrossFehler, OCRProcessingService } from './ocrProcessingService';

/** Nachgebautes PDF.js: Text je Seite; die Bildgröße wächst mit der Breite der Zeichenfläche. */
const attrappe = vi.hoisted(() => ({
  seitentexte: [] as string[],
  breite: 595,
  hoehe: 842,
  zeichenJePixel: 1,
  faktorJeSeite: {} as Record<number, number>,
  /** Breitere Zeichenflächen verweigert der „Browser": toDataURL liefert dann nur „data:,". */
  maxBreite: Infinity,
  ohneZeichenflaecheAbSeite: Infinity,
  ladefehler: null as Error | null,
  seite: 0,
  gerenderteSeiten: new Set<number>(),
  laengsteKante: 0,
  zerstoert: 0,
}));

vi.mock('@/utils/pdfjs', () => ({
  ladePdfjs: async () => ({
    getDocument: () => ({
      promise: attrappe.ladefehler
        ? Promise.reject(attrappe.ladefehler)
        : Promise.resolve({
            numPages: attrappe.seitentexte.length,
            getPage: async (nr: number) => ({
              getTextContent: async () => ({
                items: attrappe.seitentexte[nr - 1] ? [{ str: attrappe.seitentexte[nr - 1], hasEOL: false }] : [],
              }),
              getViewport: ({ scale }: { scale: number }) => {
                attrappe.seite = nr;
                return { width: attrappe.breite * scale, height: attrappe.hoehe * scale };
              },
              render: () => {
                attrappe.gerenderteSeiten.add(nr);
                return { promise: Promise.resolve() };
              },
              cleanup: () => {},
            }),
          }),
      destroy: async () => {
        attrappe.zerstoert++;
      },
    }),
  }),
}));

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

function pdf(): Blob {
  return new Blob(['%PDF-1.7'], { type: 'application/pdf' });
}

/** Länge eines Seitenbilds bei Maßstab `scale` für eine A4-Seite. */
function laenge(scale: number, faktor = attrappe.zeichenJePixel): number {
  return 4 + Math.floor(595 * scale * faktor);
}

describe('PDF für die Auslese', () => {
  beforeEach(() => {
    Object.assign(attrappe, {
      seitentexte: [], breite: 595, hoehe: 842, zeichenJePixel: 1, faktorJeSeite: {}, maxBreite: Infinity,
      ohneZeichenflaecheAbSeite: Infinity, ladefehler: null, seite: 0, gerenderteSeiten: new Set<number>(),
      laengsteKante: 0, zerstoert: 0,
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const flaeche = {
          width: 0,
          height: 0,
          getContext: () => (attrappe.seite >= attrappe.ohneZeichenflaecheAbSeite ? null : {}),
          toDataURL: () => {
            attrappe.laengsteKante = Math.max(attrappe.laengsteKante, flaeche.width, flaeche.height);
            if (flaeche.width > attrappe.maxBreite) return 'data:,';
            const faktor = attrappe.faktorJeSeite[attrappe.seite] ?? attrappe.zeichenJePixel;
            return `data:image/jpeg;base64,/9j/${'A'.repeat(Math.floor(flaeche.width * faktor))}`;
          },
        };
        return flaeche;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('liest alle neun Seiten als Text und als Bild — früher fünf Seiten Text oder eine Seite Bild', async () => {
    attrappe.seitentexte = Array.from({ length: 9 }, (_, i) => `Paragraf ${i + 1} ${'Vertragstext '.repeat(5)}`);
    attrappe.seitentexte[8] = 'Kaution 2.550,00 EUR IBAN DE00 1111 2222 3333 4444 55';

    const { textContent, fileContents } = await OCRProcessingService.liesPdfFuerAuslese(pdf());

    expect(fileContents).toHaveLength(9);
    expect(fileContents.every(b => b.startsWith('/9j/'))).toBe(true);
    expect(textContent).toContain('Seite 9:\nKaution 2.550,00 EUR IBAN DE00 1111 2222 3333 4444 55');
    expect(attrappe.zerstoert).toBe(1);
  });

  it('schickt bei einem Scan keinen Text, aber jede Seite als Bild', async () => {
    attrappe.seitentexte = ['', 'Seite 2 von 7', '', '', '', '', ''];
    const { textContent, fileContents } = await OCRProcessingService.liesPdfFuerAuslese(pdf());
    expect(textContent).toBe('');
    expect(fileContents).toHaveLength(7);
  });

  it('verkleinert lange Dokumente, statt Seiten wegzulassen', async () => {
    attrappe.seitentexte = Array.from({ length: 40 }, () => '');
    // 9 MB / 40 Seiten ≈ 236.000 Zeichen: Stufe 1,5 (892 px) passt nicht, Stufe 1,2 (714 px) schon
    attrappe.zeichenJePixel = 300;
    const { fileContents } = await OCRProcessingService.liesPdfFuerAuslese(pdf());
    expect(fileContents).toHaveLength(40);
    expect(fileContents[0]).toHaveLength(laenge(1.2));
    expect(fileContents.reduce((summe, b) => summe + b.length, 0)).toBeLessThanOrEqual(MAX_BILDER_ZEICHEN);
    // Was die ersten Seiten nicht brauchen, bekommen spätere: dort reicht es wieder für Stufe 1,5
    expect(new Set(fileContents.map(b => b.length))).toEqual(new Set([laenge(1.2), laenge(1.5)]));
  });

  it('drückt nach einer Fotoseite nicht alle folgenden Seiten auf die kleinste Stufe', async () => {
    attrappe.seitentexte = Array.from({ length: 10 }, () => '');
    attrappe.zeichenJePixel = 300;
    attrappe.faktorJeSeite = { 2: 5000 };
    const { fileContents } = await OCRProcessingService.liesPdfFuerAuslese(pdf());
    expect(fileContents).toHaveLength(10);
    expect(fileContents[1]).toHaveLength(laenge(0.8, 5000));
    // Nach der Fotoseite geht es Stufe um Stufe zurück zur vollen Schärfe
    expect(fileContents.slice(2, 5).map(b => b.length)).toEqual([laenge(1.0), laenge(1.2), laenge(1.5)]);
    expect(fileContents[9]).toHaveLength(laenge(1.5));
  });

  it('nimmt eine kleinere Stufe, wenn der Browser die Zeichenfläche verweigert', async () => {
    attrappe.seitentexte = ['', '', ''];
    attrappe.maxBreite = 800;
    const { fileContents } = await OCRProcessingService.liesPdfFuerAuslese(pdf());
    expect(fileContents.map(b => b.length)).toEqual([laenge(1.2), laenge(1.2), laenge(1.2)]);
  });

  it('rendert ein Planblatt in A0 höchstens 2000 Pixel groß', async () => {
    attrappe.seitentexte = [''];
    attrappe.breite = 2384;
    attrappe.hoehe = 3370;
    await OCRProcessingService.liesPdfFuerAuslese(pdf());
    expect(attrappe.laengsteKante).toBeLessThanOrEqual(2000);
  });

  it('meldet ein Dokument, das auch verkleinert nicht passt, ohne die restlichen Seiten zu rendern', async () => {
    attrappe.seitentexte = Array.from({ length: 40 }, () => '');
    attrappe.zeichenJePixel = 1000;
    await expect(OCRProcessingService.liesPdfFuerAuslese(pdf())).rejects.toBeInstanceOf(DokumentZuGrossFehler);
    // je Seite mindestens 476.004 Zeichen: nach der 20. Seite sind 9 MB überschritten
    expect(attrappe.gerenderteSeiten.size).toBe(20);
    expect(attrappe.zerstoert).toBe(1);
  });

  it('bricht ab, wenn eine Seite nicht darstellbar ist', async () => {
    attrappe.seitentexte = ['', '', ''];
    attrappe.ohneZeichenflaecheAbSeite = 2;
    await expect(OCRProcessingService.liesPdfFuerAuslese(pdf())).rejects.toThrow('Seite 2 ließ sich nicht als Bild darstellen');
    expect(attrappe.zerstoert).toBe(1);
  });

  it('räumt auch auf, wenn schon das Laden scheitert', async () => {
    attrappe.ladefehler = new Error('Invalid PDF structure');
    await expect(OCRProcessingService.liesPdfFuerAuslese(pdf())).rejects.toThrow('Invalid PDF structure');
    expect(attrappe.zerstoert).toBe(1);
  });

  it('liesDokument schickt alle Seiten an die Auslese', async () => {
    attrappe.seitentexte = Array.from({ length: 6 }, (_, i) => `Seite ${i + 1} ${'Kostenaufstellung '.repeat(4)}`);
    invoke.mockResolvedValueOnce({ data: { success: true, extractedData: {} }, error: null });

    await OCRProcessingService.liesDokument(pdf(), 'vorvertrag.pdf', 'vorvertrag');

    const body = invoke.mock.calls.at(-1)?.[1]?.body;
    expect(body.art).toBe('vorvertrag');
    expect(body.fileContents).toHaveLength(6);
    expect(body.textContent).toContain('Seite 6:');
  });

  it('liesDokument gibt die Größenmeldung unverändert weiter', async () => {
    attrappe.seitentexte = Array.from({ length: 20 }, () => '');
    attrappe.zeichenJePixel = 1000;
    const ergebnis = await OCRProcessingService.liesDokument(pdf(), 'scan.pdf', 'selbstauskunft');
    expect(ergebnis.success).toBe(false);
    expect(ergebnis.error).toMatch(/^Das Dokument hat 20 Seiten/);
  });
});

function docx(dokumentXml: string): Blob {
  const zip = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(dokumentXml),
  });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

describe('Text aus Word-Dateien', () => {
  it('liest Absätze, Tabulatoren und Sonderzeichen wie im alten Vertrag', async () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>NiImmo Projektentwicklung &amp; Bau GmbH</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>2.1</w:t></w:r><w:r><w:tab/><w:t>laufende öffentliche Lasten</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>[x] Zentralschließanlage oder [ ] Einzelschließanlage</w:t></w:r></w:p>' +
      '<w:p></w:p>' +
      '</w:body></w:document>';

    const text = await OCRProcessingService.extractTextFromDocx(docx(xml));
    expect(text.split('\n')).toEqual([
      'NiImmo Projektentwicklung & Bau GmbH',
      '2.1\tlaufende öffentliche Lasten',
      '[x] Zentralschließanlage oder [ ] Einzelschließanlage',
    ]);
  });

  it('weist eine Datei ohne Word-Inhalt zurück', async () => {
    const zip = zipSync({ 'irgendwas.txt': strToU8('x') });
    await expect(OCRProcessingService.extractTextFromDocx(new Blob([zip]))).rejects.toThrow('keine Word-Datei');
  });
});
