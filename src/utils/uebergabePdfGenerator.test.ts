import { describe, it, expect, beforeAll } from 'vitest';
import { generateUebergabePdf, type UebergabePdfData } from './uebergabePdfGenerator';
import type { PdfImage } from './pdfImageUtils';

/**
 * Diese Tests sichern das ab, was am 03.08.2026 im Live-Protokoll gefehlt hat:
 * die Zustandsfotos aus dem Notizen-Bereich und die unverzerrte Darstellung
 * von Hochkantaufnahmen.
 */

// 8x8-Pixel-JPEG, reicht für die Layout-Prüfung. Die logischen Kantenlängen
// kommen aus PdfImage.width/height und steuern das Einpassen.
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
  'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQID' +
  'AAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT' +
  'VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcI' +
  'CQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOU' +
  'lZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oA' +
  'DAMBAAIRAxEAPwD3+iiigD//2Q==';

const portraitImage: PdfImage = { dataUrl: TINY_JPEG, width: 900, height: 1600 };
const landscapeImage: PdfImage = { dataUrl: TINY_JPEG, width: 1600, height: 900 };

const baseData: UebergabePdfData = {
  isEinzug: false,
  uebergabeDatum: '03.08.2026',
  mieterName: 'Max Mustermann',
  immobilieName: 'Musterhaus',
  immobilieAdresse: 'Musterstraße 1, 31319 Sehnde',
  schluessel: { haustuer: '2', wohnung: '2', briefkasten: '1', keller: '1' },
  einheiten: [
    {
      name: 'Musterhaus',
      adresse: 'Musterstraße 1, 31319 Sehnde',
      etage: 'EG',
      qm: 60,
      zaehlerstaende: { strom: '3242', gas: '', wasser: '128,456', warmwasser: '77,9' },
    },
  ],
  protokollNotizen: 'Wohnung besenrein übergeben.',
  vermieterSignature: null,
  mieterSignature: null,
};

async function renderText(data: UebergabePdfData): Promise<string> {
  const blob = await generateUebergabePdf(data);
  // Unkomprimierte jsPDF-Ausgabe: Text und Bild-Operatoren stehen im Klartext
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

/** Die cm-Matrix im Content-Stream trägt die Zeichenmaße: "<breite> 0 0 <hoehe> x y cm" */
const BILD_MATRIX = /([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/;

const zaehleBildOperationen = (pdf: string): number =>
  (pdf.match(new RegExp(BILD_MATRIX, 'g')) ?? []).length;

describe('generateUebergabePdf', () => {
  let ohneFotos: string;

  beforeAll(async () => {
    ohneFotos = await renderText(baseData);
  });

  it('gibt Zählerstände mit Dezimalkomma unverändert aus', () => {
    expect(ohneFotos).toContain('128,456');
    expect(ohneFotos).toContain('77,9');
    expect(ohneFotos).toContain('3242');
  });

  it('rendert den Notizen-Abschnitt', () => {
    expect(ohneFotos).toContain('Bemerkungen / Zustand');
  });

  it('bettet Zustandsfotos aus dem Notizen-Bereich ein', async () => {
    const mitFotos = await renderText({
      ...baseData,
      notizenFotos: [portraitImage, landscapeImage],
    });

    expect(mitFotos).toContain('Fotos zum Zustand');
    // Zwei zusätzliche Bild-Zeichenoperationen gegenüber der Variante ohne Fotos.
    // Gezählt wird das Zeichnen, nicht das eingebettete Objekt: jsPDF legt
    // identische Bilddaten nur einmal ab und referenziert sie mehrfach.
    expect(zaehleBildOperationen(mitFotos)).toBe(zaehleBildOperationen(ohneFotos) + 2);
  });

  it('zeigt Zustandsfotos auch ohne Notiztext', async () => {
    const nurFotos = await renderText({
      ...baseData,
      protokollNotizen: '',
      notizenFotos: [portraitImage],
    });

    expect(nurFotos).toContain('Bemerkungen / Zustand');
    expect(nurFotos).toContain('Fotos zum Zustand');
  });

  it('bettet Zählerfotos ein', async () => {
    const mitZaehlerfotos = await renderText({
      ...baseData,
      einheiten: [{ ...baseData.einheiten[0], zaehlerfotos: { strom: [portraitImage] } }],
    });

    expect(mitZaehlerfotos).toContain('Zählerfotos');
  });

  it('stellt Hochkantfotos hochkant dar statt sie ins Querformat zu stauchen', async () => {
    const hochkant = await renderText({ ...baseData, notizenFotos: [portraitImage] });
    const quer = await renderText({ ...baseData, notizenFotos: [landscapeImage] });

    const hochkantMasse = hochkant.match(BILD_MATRIX);
    const querMasse = quer.match(BILD_MATRIX);

    expect(hochkantMasse).not.toBeNull();
    expect(querMasse).not.toBeNull();

    const [, hBreite, hHoehe] = hochkantMasse!.map(Number);
    const [, qBreite, qHoehe] = querMasse!.map(Number);

    expect(hHoehe).toBeGreaterThan(hBreite);
    expect(qBreite).toBeGreaterThan(qHoehe);

    // Seitenverhältnis bleibt erhalten (900:1600 bzw. 1600:900)
    expect(hBreite / hHoehe).toBeCloseTo(900 / 1600, 2);
    expect(qBreite / qHoehe).toBeCloseTo(1600 / 900, 2);
  });
});
