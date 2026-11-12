import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MITTEL_ZEITLIMIT_MS, UnterschriftFehler, generateUebergabePdf, type UebergabePdfData } from './uebergabePdfGenerator';
import { COMPANY } from '@/config/company';
import { readFileSync } from 'node:fs';
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
  // Ohne Carlito und Logo: unkomprimiert in Helvetica, wie in Node ohnehin
  const blob = await generateUebergabePdf(data, { schrift: null, logo: null });
  // Unkomprimierte jsPDF-Ausgabe: Text und Bild-Operatoren stehen im Klartext
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

/** Die cm-Matrix im Content-Stream trägt die Zeichenmaße: "<breite> 0 0 <hoehe> x y cm" */
const BILD_MATRIX = /([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/;

const zaehleBildOperationen = (pdf: string): number =>
  (pdf.match(new RegExp(BILD_MATRIX, 'g')) ?? []).length;

/** Alle Textstücke des Content-Streams aneinander — eine umbrochene Angabe steht dann wieder am Stück */
const textAmStueck = (pdf: string): string =>
  [...pdf.matchAll(/\(((?:\\.|[^\\()])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join('');

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

  it('druckt den gespeicherten Wert, nicht die Roheingabe: „12.345“ ist 12,345', async () => {
    const pdf = await renderText({ ...baseData, einheiten: [{ ...baseData.einheiten[0], zaehlerstaende: { strom: '12.345', gas: '1.234,5', wasser: '', warmwasser: '' } }] });
    expect(pdf).toContain('12,345');
    expect(pdf).not.toContain('12.345');
    expect(pdf).toContain('1234,5');
  });

  it('gibt erfasste Schlüssel mit Stückzahl aus', () => {
    expect(ohneFotos).toContain('(2 Stück)');
    expect(ohneFotos).toContain('(1 Stück)');
  });

  it('behauptet bei leerem Schlüsselfeld nicht „0 Stück“, eine eingetragene 0 bleibt stehen', async () => {
    const pdf = await renderText({ ...baseData, schluessel: { haustuer: '2', wohnung: '', briefkasten: '0', keller: ' ' } });
    expect(pdf.match(/\(0 Stück\)/g)).toHaveLength(1);
    expect(pdf.match(/\(2 Stück\)/g)).toHaveLength(1);
    expect(pdf.match(/ Stück\)/g)).toHaveLength(2);
  });

  it('führt Zählernummern nur, wenn die Einheit welche kennt', async () => {
    expect(ohneFotos).not.toContain('Zählernummer');
    const mitNummern = await renderText({
      ...baseData,
      einheiten: [{ ...baseData.einheiten[0], zaehlernummern: { strom: '1ESY1160234567', wasser: ' ', gas: null } }],
    });
    expect(mitNummern).toContain('Zählernummer');
    expect(mitNummern).toContain('1ESY1160234567');
    expect(mitNummern).toContain('128,456');
  });

  it('rendert den Notizen-Abschnitt', () => {
    expect(ohneFotos).toContain('Zustand und Bemerkungen');
    expect(ohneFotos).toContain('Wohnung besenrein');
  });

  it('setzt Titel, Art und Datum der Übergabe und die Seitenzahl wie der Mietvertrag', async () => {
    expect(ohneFotos).toContain('(Übergabeprotokoll)');
    expect(ohneFotos).toContain('(Auszug am 03.08.2026)');
    expect(ohneFotos).toContain('(Seite 1 von 1)');
    expect(await renderText({ ...baseData, isEinzug: true })).toContain('(Einzug am 03.08.2026)');
  });

  it('nennt die Verwaltung als solche, nicht als Vermieter, und trägt keinen Firmenfuß mehr', () => {
    expect(ohneFotos).toContain('(Verwaltung)');
    expect(ohneFotos).toContain(`(${COMPANY.name})`);
    expect(ohneFotos).not.toContain('Registergericht');
    expect(ohneFotos).not.toContain('Creditreform');
  });

  it('bricht eine lange Zählernummer in ihrer Spalte um, statt sie abzuschneiden', async () => {
    const lang = 'KW-SEHR-LANGE-NUMMER-0123456789-ABCDEFGH';
    const pdf = await renderText({ ...baseData, einheiten: [{ ...baseData.einheiten[0], zaehlernummern: { wasser: lang } }] });
    expect(pdf).not.toContain(`(${lang})`);
    expect(textAmStueck(pdf)).toContain(lang);
  });

  it('bettet Zustandsfotos aus dem Notizen-Bereich ein', async () => {
    const mitFotos = await renderText({
      ...baseData,
      notizenFotos: [portraitImage, landscapeImage],
    });

    expect(mitFotos).toContain('Fotos zum Zustand');
    // Nummeriert, damit die Bemerkungen darauf verweisen können
    expect(mitFotos).toContain('(Foto 1)');
    expect(mitFotos).toContain('(Foto 2)');
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

    expect(nurFotos).toContain('Zustand und Bemerkungen');
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

describe('generateUebergabePdf: Mietsache und Sonderzeichen', () => {
  it('nennt die Mietsache im Kopf, bei einer Einheit nur dort', async () => {
    const pdf = await renderText({
      ...baseData,
      mietsache: 'Wohnung, 1. OG links, 3 Zimmer, 72,5 m²',
      einheiten: [{ ...baseData.einheiten[0], mietsache: 'Wohnung, 1. OG links, 3 Zimmer, 72,5 m²' }],
    });
    expect(pdf).toContain('(Mietsache)');
    expect(pdf.match(/3 Zimmer, 72,5 m²/g)?.length).toBe(1);
  });

  it('setzt bei mehreren Einheiten jede in den Kopf und über ihre eigene Zählertabelle', async () => {
    const pdf = await renderText({
      ...baseData,
      mietsache: '',
      einheiten: [
        { ...baseData.einheiten[0], mietsache: 'Wohnung, EG rechts, 2 Zimmer, 54 m²' },
        { ...baseData.einheiten[0], mietsache: 'Stellplatz Nr. 4', zaehlerstaende: { strom: '77', gas: '', wasser: '', warmwasser: '' } },
      ],
    });
    expect(pdf.match(/\(Wohnung, EG rechts, 2 Zimmer, 54 m²\)/g)?.length).toBe(2);
    expect(pdf.match(/\(Stellplatz Nr\. 4\)/g)?.length).toBe(2);
    expect(pdf.match(/\(Zählerstand\)/g)?.length).toBe(2);
  });

  it('druckt Minus, Pfeile und Emojis in den Bemerkungen lesbar', async () => {
    const pdf = await renderText({ ...baseData, protokollNotizen: 'Riss −2 cm → neu streichen 👍' });
    expect(pdf).toContain('Riss -2 cm -> neu streichen');
    expect(pdf).not.toContain('Ø=');
  });
});

describe('generateUebergabePdf: kaputte Unterschrift', () => {
  it('bricht mit UnterschriftFehler ab, statt sie still wegzulassen', async () => {
    await expect(generateUebergabePdf({ ...baseData, mieterSignature: 'data:image/png;base64,kaputt' })).rejects.toBeInstanceOf(UnterschriftFehler);
  });
});

describe('generateUebergabePdf: lange Mietsache', () => {
  it('bricht die Mietsache im Kopf um, statt über den Rand zu laufen', async () => {
    const lang = 'Haus (Doppelhaushälfte, Reihenhaus), Erdgeschoss und Obergeschoss rechts mit Anbau, 5,5 Zimmer, 142,75 m²';
    const pdf = await renderText({ ...baseData, einheiten: [{ ...baseData.einheiten[0], mietsache: lang }] });
    // Im Content-Stream steht jede Textzeile für sich: Der Schluss steht nicht mehr in der Zeile des Anfangs
    const schluss = pdf.split('\n').find((z) => z.includes('142,75 m'));
    expect(schluss).toBeDefined();
    expect(schluss).not.toContain('Doppelhaus');
  });
});

/** Content-Streams der Seiten in Reihenfolge — jsPDF schreibt sie unkomprimiert nacheinander */
const seitenText = (pdf: string): string[] => pdf.split('endstream').filter((teil) => teil.includes(' Tj'));

describe('generateUebergabePdf: Seitenumbruch', () => {
  it('lässt weder die Überschrift Zählerstände noch eine Einheit allein am Seitenende stehen', async () => {
    // 30 Einheiten: Der Kopf wird so lang, dass die Überschrift in die untere Seitenhälfte rutscht
    const einheiten = Array.from({ length: 30 }, (_, i) => ({
      ...baseData.einheiten[0],
      mietsache: `Stellplatz Nr. ${i + 1}`,
      zaehlernummern: i % 4 === 0 ? { strom: 'KW-SEHR-LANGE-NUMMER-0123456789-ABCDEFGH' } : undefined,
    }));
    const seiten = seitenText(await renderText({ ...baseData, mietsache: '', einheiten }));
    expect(seiten.length).toBeGreaterThan(2);
    const kopfSeite = seiten.findIndex((t) => t.includes('(Zählerstände) Tj'));
    expect(seiten[kopfSeite].indexOf('(Zählerstand) Tj')).toBeGreaterThan(seiten[kopfSeite].indexOf('(Zählerstände) Tj'));
    for (let i = 1; i <= 30; i++) {
      // Die zweite Nennung ist die Überschrift über der Tabelle; ihre Seite trägt danach den Tabellenkopf
      let seite = -1;
      seiten.forEach((t, n) => {
        if (t.includes(`(Stellplatz Nr. ${i}) Tj`)) seite = n;
      });
      const t = seiten[seite];
      expect(t.indexOf('(Zählerstand) Tj', t.lastIndexOf(`(Stellplatz Nr. ${i}) Tj`))).toBeGreaterThan(-1);
    }
  });

  it('nennt eine Einheit in einem anderen Haus mit Haus und Anschrift', async () => {
    const pdf = await renderText({
      ...baseData,
      mietsache: '',
      einheiten: [
        { ...baseData.einheiten[0], mietsache: 'Wohnung, EG' },
        { ...baseData.einheiten[0], name: 'Nachbarhaus', adresse: 'Musterweg 3, 31319 Sehnde', mietsache: 'Stellplatz 7' },
      ],
    });
    // Der Gedankenstrich steht in Helvetica als WinAnsi-Byte 0x96 im Content-Stream
    expect(textAmStueck(pdf)).toContain('Stellplatz 7 \u0096 Nachbarhaus, Musterweg 3, 31319 Sehnde');
  });
});

describe('generateUebergabePdf: Bemerkungen gegliedert', () => {
  it('behält Leerzeilen als Abstand und rückt Aufzählungen ein', async () => {
    const pdf = await renderText({ ...baseData, protokollNotizen: 'Küche:\n- Herd defekt\n\nBad:\n  Fliese lose' });
    const zeile = (text: string) => {
      const m = pdf.match(new RegExp(`([\\d.]+) ([\\d.]+) Td\\s*\\(${text.replace(/[()]/g, '\\$&')}\\) Tj`));
      expect(m, text).not.toBeNull();
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const kueche = zeile('Küche:');
    const herd = zeile('- Herd defekt');
    const bad = zeile('Bad:');
    const fliese = zeile('Fliese lose');
    expect(herd.x).toBeGreaterThan(kueche.x);
    expect(fliese.x).toBeGreaterThan(bad.x);
    // Die Leerzeile vor „Bad:“ ist größer als der Abstand zwischen den Zeilen eines Blocks
    expect(herd.y - bad.y).toBeGreaterThan(kueche.y - herd.y + 3);
  });
});

describe('generateUebergabePdf: mit Carlito und Logo', () => {
  const datei = (pfad: string) => readFileSync(new URL(`../../public/${pfad}`, import.meta.url)).toString('base64');
  const schrift = { regular: datei('fonts/Carlito-Regular.ttf'), bold: datei('fonts/Carlito-Bold.ttf') };
  const logo = `data:image/png;base64,${datei('brief/niimmo-logo.png')}`;

  it('bettet Carlito als Teilmenge und das Logo ein, ohne das Protokoll aufzublähen', async () => {
    const blob = await generateUebergabePdf({ ...baseData, notizenFotos: [portraitImage] }, { schrift, logo });
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(pdf).toContain('/Carlito');
    expect(pdf).toContain('/FontFile2');
    // Zwei Schnitte zu je ~650 KB: eingebettet wird nur, was gebraucht wird
    expect(blob.size).toBeLessThan(250_000);
  });

  it('setzt mit beschädigter Schrift Helvetica, statt die Übergabe abzubrechen', async () => {
    const blob = await generateUebergabePdf(baseData, { schrift: { regular: 'AAEAAAAA', bold: 'AAEAAAAA' }, logo });
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(pdf).toContain('/Helvetica');
    expect(pdf).toContain('(Übergabeprotokoll)');
  });

  it('lässt ein beschädigtes Logo weg, statt die Übergabe abzubrechen', async () => {
    const blob = await generateUebergabePdf(baseData, { schrift: null, logo: 'data:image/png;base64,iVBORw0KGgoAAAA' });
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).toContain('(Übergabeprotokoll)');
  });

  it('meldet eine kaputte Unterschrift auch mit Schrift und Logo als UnterschriftFehler', async () => {
    await expect(generateUebergabePdf({ ...baseData, vermieterSignature: 'data:image/png;base64,kaputt' }, { schrift, logo })).rejects.toBeInstanceOf(UnterschriftFehler);
  });
});

describe('generateUebergabePdf: Schrift und Logo laden', () => {
  it('entsteht in Node ohne Schrift und Logo (kein fetch auf relative Pfade)', async () => {
    const blob = await generateUebergabePdf(baseData);
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).toContain('/Helvetica');
  });

  // Vor Ort im Funkloch: Eine Schrift, die nicht ankommt, darf das Protokoll nicht aufhalten
  it('wartet höchstens MITTEL_ZEITLIMIT_MS auf Schrift und Logo und setzt dann Helvetica', async () => {
    const fetchVorher = globalThis.fetch;
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    vi.useFakeTimers();
    try {
      const laeuft = generateUebergabePdf(baseData);
      await vi.advanceTimersByTimeAsync(MITTEL_ZEITLIMIT_MS);
      const pdf = Buffer.from(await (await laeuft).arrayBuffer()).toString('latin1');
      expect(pdf).toContain('/Helvetica');
      expect(pdf).toContain('(Übergabeprotokoll)');
      // Ist die Frist einmal abgelaufen, wartet das nächste Protokoll nicht erneut (Review 12.11.2026)
      const zweites = generateUebergabePdf(baseData);
      await vi.advanceTimersByTimeAsync(0);
      expect(Buffer.from(await (await zweites).arrayBuffer()).toString('latin1')).toContain('(Übergabeprotokoll)');
    } finally {
      vi.useRealTimers();
      globalThis.fetch = fetchVorher;
    }
  });
});
