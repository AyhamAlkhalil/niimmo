/**
 * Übergabeprotokoll als PDF im Seitenbild des Mietvertrags (seit 12.11.2026, Nutzer: „Format des Protokolls
 * verschönern – wirklich so schön wie den Mietvertrag“): Carlito, NiImmo-Logo rechts oben auf jeder Seite,
 * Titel zentriert, die Angaben auf dem Tabstopp wie das Rubrum, fette Abschnittsüberschriften, Tabellen ohne
 * Farbflächen, Seitenzahlen unten mittig. Maße und Schrift kommen aus `mietvertrag/vertragsLayout`. Bis dahin
 * Helvetica mit roten Linien, Absenderzeile und Firmenfuß — wie der Vertrag jetzt ohne Fuß.
 *
 * Anders als der Vertrag entsteht das Protokoll auch ohne Carlito (dann Helvetica): Es wird vor Ort erzeugt,
 * oft im Keller, und eine Schrift, die im Funkloch nicht ankommt, darf die Übergabe nicht aufhalten. Vorschau
 * und gespeichertes PDF sind dasselbe Blob und können nicht auseinanderlaufen.
 *
 * Die Verwaltung steht als „Verwaltung“ im Kopf, nicht als Vermieter: Vertragspartei kann eine andere
 * Gesellschaft sein (siehe config/company.ts).
 */
import { jsPDF } from 'jspdf';
import type { PdfImage } from './pdfImageUtils';
import { COMPANY } from '@/config/company';
import { zaehlerstandText } from './zaehlerstandUtils';
import { pdfText } from './pdf/pdfText';
import { ladeBild } from './pdf/briefbogen';
import {
  ABSTAND,
  GROESSE,
  RAND,
  RUBRUM_EINZUG,
  SEITE_BREITE,
  TEXTBREITE,
  UEBERSCHRIFT_HOEHE,
  ZEILE,
  ladeVertragsschrift,
  vertragsLayout,
  type VertragsLayout,
  type Vertragsschrift,
} from './mietvertrag/vertragsLayout';

export interface UebergabePdfData {
  isEinzug: boolean;
  uebergabeDatum: string;
  mieterName: string;

  immobilieName: string;
  immobilieAdresse: string;
  /** Art, Lage, Zimmer, Fläche — damit erkennbar ist, welche Einheit übergeben wurde */
  mietsache?: string;

  schluessel: {
    haustuer: string;
    wohnung: string;
    briefkasten: string;
    keller: string;
  };

  einheiten: Array<{
    name: string;
    adresse: string;
    etage: string;
    mietsache?: string;
    qm: number | null;
    zaehlerstaende: {
      strom: string;
      gas: string;
      wasser: string;
      warmwasser: string;
    };
    /**
     * Zählernummern — ohne sie ist ein Stand keinem Zähler sicher zuzuordnen. Seit 12.11.2026
     * die in der Übergabe eingetragene, sonst die aus den Stammdaten der Einheit.
     */
    zaehlernummern?: {
      strom?: string | null;
      gas?: string | null;
      wasser?: string | null;
      warmwasser?: string | null;
    };
    // Zählerfotos, gruppiert nach Zählertyp
    zaehlerfotos?: {
      strom?: PdfImage[];
      gas?: PdfImage[];
      wasser?: PdfImage[];
      warmwasser?: PdfImage[];
    };
  }>;

  protokollNotizen: string;
  /** Fotos zum Wohnungszustand aus dem Notizen-Bereich */
  notizenFotos?: PdfImage[];
  vermieterSignature: string | null;
  mieterSignature: string | null;
}

/** Eine Unterschrift ließ sich nicht ins PDF übernehmen — der Dialog bittet um eine neue */
export class UnterschriftFehler extends Error {
  constructor(public readonly wer: string) {
    super(`Die Unterschrift (${wer}) ließ sich nicht ins Protokoll übernehmen.`);
    this.name = 'UnterschriftFehler';
  }
}

export interface ProtokollMittel {
  /** Carlito als Base64; ohne Angabe wird sie geladen, null erzwingt Helvetica */
  schrift?: Vertragsschrift | null;
  /** Logo als Data-URL; ohne Angabe wird es geladen, null lässt es weg */
  logo?: string | null;
}

const LOGO_PFAD = '/brief/niimmo-logo.png';
/**
 * So lange wartet das erste Protokoll höchstens auf Schrift und Logo, danach Helvetica bzw. ohne Logo. Ist die
 * Frist einmal abgelaufen (Funkloch), wartet kein weiteres Protokoll der Sitzung mehr — sonst kostete jede Vorschau
 * und jedes Speichern erneut die volle Frist (Review 12.11.2026). Kommt die Schrift später doch an, nimmt sie das
 * nächste Protokoll aus dem Zwischenspeicher.
 */
export const MITTEL_ZEITLIMIT_MS = 6000;
let fristAbgelaufen = false;

const RECHTS = RAND + TEXTBREITE;
/** Werte im Kopf auf dem Tabstopp des Rubrums */
const WERT_X = RAND + RUBRUM_EINZUG;
/** Unterschriftsfeld wie das Zeichenfeld auf dem Bildschirm, 13:5 (SignatureCanvas.tsx) */
const UNTERSCHRIFT_BREITE = 65;
const UNTERSCHRIFT_HOEHE = 25;
/** Spalten der Unterschriften wie im Mietvertrag */
const UNTERSCHRIFT_LINKS = RAND + 6;
const UNTERSCHRIFT_RECHTS = RAND + 88;
const UNTERSCHRIFT_LINIE = 66;

/** Schrift und Logo schon beim Öffnen des Dialogs holen — vor Ort ist das Netz oft schlechter als an der Tür. */
export function protokollMittelVorladen(): void {
  void ladeVertragsschrift();
  void ladeBild(LOGO_PFAD);
}

/** Wartet höchstens `ms`; danach (oder bei Fehler) gilt der Ersatz. Das Laden selbst läuft weiter und füllt den Cache. */
async function hoechstens<T>(arbeit: Promise<T>, ms: number, ersatz: T): Promise<{ wert: T; abgelaufen: boolean }> {
  let zeitgeber: ReturnType<typeof setTimeout> | undefined;
  const spaet = new Promise<{ wert: T; abgelaufen: boolean }>((r) => {
    zeitgeber = setTimeout(() => r({ wert: ersatz, abgelaufen: true }), ms);
  });
  try {
    return await Promise.race([arbeit.then((wert) => ({ wert, abgelaufen: false }), () => ({ wert: ersatz, abgelaufen: false })), spaet]);
  } finally {
    clearTimeout(zeitgeber);
  }
}

type Einheit = UebergabePdfData['einheiten'][number];

/** Lage einer Einheit: die Mietsache, sonst wie bisher Etage und Fläche */
function lageText(e: Einheit): string {
  return e.mietsache || [e.etage, e.qm ? `${e.qm} m²` : ''].filter(Boolean).join(', ');
}

/** Haus und Anschrift einer Einheit, wenn sie nicht die des Protokollkopfs sind (Stellplatz im Nachbarhaus) */
function abweichendesObjekt(e: Einheit, data: UebergabePdfData): string {
  const anders = (!!e.name && e.name !== data.immobilieName) || (!!e.adresse && e.adresse !== data.immobilieAdresse);
  return anders ? [e.name, e.adresse].filter(Boolean).join(', ') : '';
}

/** Was im Kopf für eine Einheit steht: Lage und ein abweichendes Haus; leer, wenn beides fehlt */
function einheitImKopf(e: Einheit, data: UebergabePdfData): string {
  return [lageText(e), abweichendesObjekt(e, data)].filter(Boolean).join(' – ');
}

/** Über der Zählertabelle bei mehreren Einheiten: wie im Kopf, notfalls der Name des Hauses */
function einheitUeberschrift(e: Einheit, data: UebergabePdfData): string {
  return einheitImKopf(e, data) || e.name || 'Einheit';
}

export async function generateUebergabePdf(roh: UebergabePdfData, mittel: ProtokollMittel = {}): Promise<Blob> {
  // Freitext und Stammdaten nur mit Zeichen, die auch die Ersatzschrift kennt (pdfText)
  const data: UebergabePdfData = {
    ...roh,
    mieterName: pdfText(roh.mieterName),
    immobilieName: pdfText(roh.immobilieName),
    immobilieAdresse: pdfText(roh.immobilieAdresse),
    mietsache: roh.mietsache ? pdfText(roh.mietsache) : roh.mietsache,
    protokollNotizen: pdfText(roh.protokollNotizen),
    einheiten: roh.einheiten.map((e) => ({
      ...e,
      name: pdfText(e.name),
      adresse: pdfText(e.adresse),
      etage: pdfText(e.etage),
      mietsache: e.mietsache ? pdfText(e.mietsache) : e.mietsache,
      zaehlernummern: e.zaehlernummern
        ? Object.fromEntries(Object.entries(e.zaehlernummern).map(([typ, nr]) => [typ, nr == null ? nr : pdfText(nr)]))
        : e.zaehlernummern,
    })),
  };

  const frist = fristAbgelaufen ? 0 : MITTEL_ZEITLIMIT_MS;
  const [schrift, logo] = await Promise.all([
    mittel.schrift !== undefined ? { wert: mittel.schrift, abgelaufen: false } : hoechstens(ladeVertragsschrift(), frist, null),
    mittel.logo !== undefined ? { wert: mittel.logo, abgelaufen: false } : hoechstens(ladeBild(LOGO_PFAD), frist, null),
  ]);
  if (schrift.abgelaufen || logo.abgelaufen) fristAbgelaufen = true;

  try {
    return zeichnen(data, schrift.wert, logo.wert);
  } catch (fehler) {
    // Eine beschädigt angekommene Schrift oder ein beschädigtes Logo (Signatur stimmt, Rest fehlt) darf die
    // Übergabe nicht aufhalten: noch einmal ohne beides. Eine kaputte Unterschrift meldet der Dialog selbst.
    if (fehler instanceof UnterschriftFehler || (!schrift.wert && !logo.wert)) throw fehler;
    return zeichnen(data, null, null);
  }
}

function zeichnen(data: UebergabePdfData, schrift: Vertragsschrift | null, logo: string | null): Blob {
  // Komprimiert nur mit eingebetteter Schrift — die Tests lesen den Helvetica-Text direkt aus dem PDF
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: !!schrift });
  const layout = vertragsLayout(doc, { schrift, logo });

  let y = kopf(doc, layout, data);
  y = schluessel(doc, layout, data, y + 2 * ABSTAND);

  const mehrere = data.einheiten.length > 1;
  // Gemessen in der Schrift, in der der Titel steht (fett) — Review 12.11.2026
  layout.schrift(GROESSE, true);
  const bloecke = data.einheiten.map((einheit) => ({
    einheit,
    titel: mehrere ? (doc.splitTextToSize(einheitUeberschrift(einheit, data), TEXTBREITE) as string[]) : [],
    masse: tabellenMasse(doc, layout, einheit),
  }));
  const titelHoehe = (titel: string[]) => (titel.length > 0 ? titel.length * ZEILE + 0.8 : 0);
  // Die Überschrift bleibt mit der ersten Tabelle zusammen, jede Einheit mit ihrer Tabelle (Review 12.11.2026)
  const erste = bloecke[0];
  y = layout.umbruch(y + 2 * ABSTAND, UEBERSCHRIFT_HOEHE + (erste ? titelHoehe(erste.titel) + erste.masse.hoehe : 0));
  y = layout.ueberschrift('Zählerstände', y);
  bloecke.forEach(({ titel, masse }, i) => {
    y = layout.umbruch(y + (i > 0 ? ABSTAND : 0), titelHoehe(titel) + masse.hoehe);
    if (titel.length > 0) {
      layout.schrift(GROESSE, true);
      titel.forEach((z) => {
        doc.text(z, RAND, y);
        y += ZEILE;
      });
      y += 0.8;
    }
    y = zaehlerTabelle(doc, layout, masse, y);
  });

  // Zählerfotos aller Einheiten in einem Gitter, beschriftet mit dem Zähler
  const zaehlerfotos = data.einheiten.flatMap((e) => fotosMitZaehler(e, mehrere ? einheitUeberschrift(e, data) : ''));
  if (zaehlerfotos.length > 0) y = fotoGitter(doc, layout, zaehlerfotos, 'Zählerfotos', y + ABSTAND);

  const notizenFotos = data.notizenFotos ?? [];
  const zeilen = (data.protokollNotizen ?? '').split(/\r?\n/);
  if (zeilen.some((z) => z.trim()) || notizenFotos.length > 0) {
    y = layout.ueberschrift('Zustand und Bemerkungen', y + 2 * ABSTAND);
    y = bemerkungen(layout, zeilen, y);
    if (notizenFotos.length > 0) {
      // Nummeriert, damit die Bemerkungen auf ein Foto verweisen können („siehe Foto 2“)
      const nummeriert = notizenFotos.map((image, i) => ({ image, label: `Foto ${i + 1}` }));
      y = fotoGitter(doc, layout, nummeriert, 'Fotos zum Zustand', y + (zeilen.some((z) => z.trim()) ? ABSTAND : 0));
    }
  }

  unterschriften(doc, layout, data, y + 2 * ABSTAND);
  layout.seitenzahlen();
  return doc.output('blob');
}

/**
 * Freitext wie eingegeben gegliedert: jede Zeile ein Absatz, eine Leerzeile als größerer Abstand, eingerückte
 * Zeilen und Aufzählungen („- “, „• “) auf dem Tabstopp. Bis zum Review am 12.11.2026 entfielen beide.
 */
function bemerkungen(layout: VertragsLayout, zeilen: string[], y: number): number {
  let leerzeile = false;
  let erste = true;
  for (const roh of zeilen) {
    const text = roh.trim();
    if (!text) {
      leerzeile = true;
      continue;
    }
    if (leerzeile && !erste) y += ABSTAND;
    leerzeile = false;
    erste = false;
    const eingerueckt = /^\s+\S/.test(roh) || /^[-–•*]\s/.test(text);
    y = layout.absatz(text, y, { einzug: eingerueckt }) + 1;
  }
  return y;
}

// ─── Kopf ────────────────────────────────────────────────────────────────────

function kopf(doc: jsPDF, layout: VertragsLayout, data: UebergabePdfData): number {
  let y = 44;
  layout.schrift(18, true);
  doc.text('Übergabeprotokoll', SEITE_BREITE / 2, y, { align: 'center' });
  y += 7.5;
  layout.schrift(11);
  doc.text(`${data.isEinzug ? 'Einzug' : 'Auszug'} am ${data.uebergabeDatum}`, SEITE_BREITE / 2, y, { align: 'center' });
  y += 13;

  const objekt = [data.immobilieName, data.immobilieAdresse].filter(Boolean).join(', ');
  // Mehrere Einheiten in einer Übergabe: jede Lage einmal (mit abweichendem Haus), das Haus darunter
  const lagen = data.mietsache ? [data.mietsache] : [...new Set(data.einheiten.map((e) => einheitImKopf(e, data)).filter(Boolean))];
  const angaben: Array<[string, string[]]> = [
    ['Mieter', [data.mieterName || '–']],
    ['Mietsache', [...lagen, objekt].filter(Boolean)],
    ['Verwaltung', [COMPANY.name, `${COMPANY.strasse}, ${COMPANY.plzOrt}`]],
  ];
  for (const [beschriftung, werte] of angaben) {
    if (werte.length === 0) continue;
    for (const [i, wert] of werte.entries()) {
      for (const [n, zeile] of (doc.splitTextToSize(wert, RECHTS - WERT_X) as string[]).entries()) {
        y = layout.umbruch(y, ZEILE);
        layout.schrift();
        // Die Beschriftung steht vor der ersten Zeile — auch, wenn diese auf eine neue Seite rutscht
        if (i === 0 && n === 0) doc.text(beschriftung, RAND, y);
        doc.text(zeile, WERT_X, y);
        y += ZEILE;
      }
    }
    y += 1.8;
  }
  return y;
}

// ─── Schlüssel ───────────────────────────────────────────────────────────────

function schluessel(doc: jsPDF, layout: VertragsLayout, data: UebergabePdfData, y: number): number {
  y = layout.ueberschrift('Übergebene Schlüssel', y);
  // Ein leeres Feld heißt „nicht erfasst“, nicht „null Stück“: Sonst behauptet ein
  // unterschriebenes Protokoll, es seien keine Schlüssel übergeben worden — genau
  // die Angabe, gegen die beim Auszug die Rückgabe geprüft wird. Wie bei den
  // Zählerständen steht dann ein Strich.
  const anzahl = (wert: string) => (wert?.trim() ? `${pdfText(wert.trim())} Stück` : '–');
  const spalten: Array<[string, string]> = [
    ['Haustür', anzahl(data.schluessel.haustuer)],
    ['Wohnung', anzahl(data.schluessel.wohnung)],
    ['Briefkasten', anzahl(data.schluessel.briefkasten)],
    ['Keller', anzahl(data.schluessel.keller)],
  ];
  const breite = TEXTBREITE / spalten.length;
  layout.schrift(GROESSE, true);
  spalten.forEach(([art], i) => doc.text(art, RAND + i * breite, y));
  y += ZEILE + 0.6;
  layout.schrift();
  spalten.forEach(([, wert], i) => doc.text(wert, RAND + i * breite, y));
  return y + ZEILE;
}

// ─── Zählerstände ────────────────────────────────────────────────────────────

const ZAEHLER: Array<{ typ: 'strom' | 'gas' | 'wasser' | 'warmwasser'; art: string; einheit: string }> = [
  { typ: 'strom', art: 'Strom', einheit: 'kWh' },
  { typ: 'gas', art: 'Gas', einheit: 'm³' },
  { typ: 'wasser', art: 'Kaltwasser', einheit: 'm³' },
  { typ: 'warmwasser', art: 'Warmwasser', einheit: 'm³' },
];

const X_NUMMER = RAND + 30;
const X_STAND = RAND + 124;
const X_EINHEIT = RAND + 127;

interface TabellenMasse {
  mitNummer: boolean;
  zeilen: Array<{ art: string; stand: string; masseinheit: string; nummer: string[] }>;
  zeilenHoehe: number[];
  /** Kopf und alle Zeilen — die Tabelle bleibt beisammen */
  hoehe: number;
}

/** Spalte Zählernummer nur, wenn die Einheit welche kennt (20.10.2026: bei 82 von 113 Einheiten hinterlegt) */
function tabellenMasse(doc: jsPDF, layout: VertragsLayout, einheit: Einheit): TabellenMasse {
  const nummern = einheit.zaehlernummern ?? {};
  const mitNummer = Object.values(nummern).some((n) => !!n?.trim());
  const roh = ZAEHLER.map(({ typ, art, einheit: masseinheit }) => ({
    art,
    // Der gelesene Wert, wie er gespeichert wird — nicht die Roheingabe (zaehlerstandText)
    stand: zaehlerstandText(einheit.zaehlerstaende[typ]) || '–',
    masseinheit,
    nummer: nummern[typ]?.trim() || '–',
  }));
  layout.schrift();
  const standBreite = Math.max(doc.getTextWidth('Zählerstand'), ...roh.map((z) => doc.getTextWidth(z.stand)));
  const nummerBreite = X_STAND - standBreite - 4 - X_NUMMER;
  // Eine lange Nummer bricht in ihrer Spalte um — bis zum 12.11.2026 wurde sie nach der ersten Zeile abgeschnitten
  const zeilen = roh.map((z) => ({ ...z, nummer: mitNummer ? (doc.splitTextToSize(z.nummer, nummerBreite) as string[]) : [z.nummer] }));
  const zeilenHoehe = zeilen.map((z) => Math.max(1, z.nummer.length) * ZEILE + 0.6);
  return { mitNummer, zeilen, zeilenHoehe, hoehe: ZEILE + 1.8 + zeilenHoehe.reduce((a, b) => a + b, 0) };
}

/** Tabelle wie die Kostentabelle des Vertrags: fetter Kopf mit feiner Linie darunter, Stand rechtsbündig */
function zaehlerTabelle(doc: jsPDF, layout: VertragsLayout, masse: TabellenMasse, y: number): number {
  y = layout.umbruch(y, masse.hoehe);
  layout.schrift(GROESSE, true);
  doc.text('Zähler', RAND, y);
  if (masse.mitNummer) doc.text('Zählernummer', X_NUMMER, y);
  doc.text('Zählerstand', X_STAND, y, { align: 'right' });
  doc.text('Einheit', X_EINHEIT, y);
  layout.linie(RAND, y + 1.5, TEXTBREITE);
  y += ZEILE + 1.8;

  layout.schrift();
  masse.zeilen.forEach((z, i) => {
    doc.text(z.art, RAND, y);
    if (masse.mitNummer) z.nummer.forEach((teil, n) => doc.text(teil, X_NUMMER, y + n * ZEILE));
    doc.text(z.stand, X_STAND, y, { align: 'right' });
    doc.text(z.masseinheit, X_EINHEIT, y);
    y += masse.zeilenHoehe[i];
  });
  return y;
}

/** `wo`: bei mehreren Einheiten dieselbe Bezeichnung wie über der Tabelle, sonst leer */
function fotosMitZaehler(e: Einheit, wo: string): Array<{ label: string; image: PdfImage }> {
  const fotos = e.zaehlerfotos ?? {};
  return ZAEHLER.flatMap(({ typ, art }) =>
    (fotos[typ] ?? []).filter((image) => !!image?.dataUrl).map((image) => ({ label: wo ? `${art} · ${wo}` : art, image }))
  );
}

// ─── Fotos ───────────────────────────────────────────────────────────────────

/**
 * Bildgitter mit zwei Spalten. Die Fotos werden seitenverhältnistreu in ihre
 * Zelle eingepasst (contain) statt auf ein festes Querformat gestreckt —
 * sonst erscheinen Hochkantaufnahmen im PDF verzerrt bzw. gekippt.
 */
function fotoGitter(
  doc: jsPDF,
  layout: VertragsLayout,
  fotos: Array<{ label?: string; image: PdfImage }>,
  titel: string,
  y: number
): number {
  if (fotos.length === 0) return y;

  const spalten = 2;
  const abstand = 4;
  const zelleB = (TEXTBREITE - abstand * (spalten - 1)) / spalten; // 76 mm
  const zelleH = 62; // hoch genug, dass Zählerstände lesbar bleiben
  const beschriftungH = 5;
  const reiheH = zelleH + beschriftungH + abstand;

  // Titel zusammen mit der ersten Bildreihe umbrechen, damit er nicht allein am Seitenende steht
  y = layout.umbruch(y, UEBERSCHRIFT_HOEHE + reiheH);
  y = layout.ueberschrift(titel, y);
  // Bildoberkante unter der Grundlinie der Überschrift
  y -= 2;

  for (let i = 0; i < fotos.length; i++) {
    const spalte = i % spalten;
    if (spalte === 0) y = layout.umbruch(y, reiheH);

    const x = RAND + spalte * (zelleB + abstand);
    const { label, image } = fotos[i];

    const verhaeltnis = image.width > 0 && image.height > 0 ? image.width / image.height : 4 / 3;
    let b = zelleB;
    let h = zelleB / verhaeltnis;
    if (h > zelleH) {
      h = zelleH;
      b = zelleH * verhaeltnis;
    }
    const bx = x + (zelleB - b) / 2;
    const by = y + (zelleH - h) / 2;

    try {
      doc.addImage(image.dataUrl, 'JPEG', bx, by, b, h);
    } catch {
      // Platzhalter, wenn das Bild nicht eingebettet werden kann
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.25);
      doc.rect(x, y, zelleB, zelleH, 'S');
      layout.schrift(8, false, true);
      doc.text('Foto konnte nicht eingebettet werden', x + zelleB / 2, y + zelleH / 2, { align: 'center' });
    }

    if (label) {
      layout.schrift(8, false, true);
      // Eine Zeile je Foto; was nicht passt, fällt weg statt in die Nachbarzelle zu laufen
      const zeile = (doc.splitTextToSize(label, zelleB) as string[])[0] ?? '';
      doc.text(zeile, x + zelleB / 2, y + zelleH + 3.5, { align: 'center' });
    }

    if (spalte === spalten - 1 || i === fotos.length - 1) y += reiheH;
  }

  layout.schrift();
  return y;
}

// ─── Unterschriften ──────────────────────────────────────────────────────────

/**
 * Zwei Spalten wie im Mietvertrag: das Unterschriftsbild über der Linie, darunter die Rolle,
 * beim Mieter der Name, und das Datum der Übergabe.
 */
function unterschriften(doc: jsPDF, layout: VertragsLayout, data: UebergabePdfData, y: number): number {
  const mieterNamen = data.mieterName && data.mieterName !== '–'
    ? (doc.splitTextToSize(data.mieterName, UNTERSCHRIFT_LINIE) as string[])
    : [];
  const hoehe = UEBERSCHRIFT_HOEHE + UNTERSCHRIFT_HOEHE + 3 + ZEILE + (mieterNamen.length + 1) * 3.8 + 2;
  y = layout.umbruch(y, hoehe);
  y = layout.ueberschrift('Unterschriften', y);
  y += 2;

  // Eine Unterschrift, die sich nicht einbetten lässt, bricht ab: Bis zum
  // 23.10.2026 fehlte sie still im PDF, während „Prüfen" beide als geleistet zeigte
  const unterschreiben = (bild: string | null, x: number, wer: string) => {
    if (!bild) return;
    try {
      doc.addImage(bild, 'PNG', x, y, UNTERSCHRIFT_BREITE, UNTERSCHRIFT_HOEHE);
    } catch {
      throw new UnterschriftFehler(wer);
    }
  };
  unterschreiben(data.vermieterSignature, UNTERSCHRIFT_LINKS, 'Vermieter');
  unterschreiben(data.mieterSignature, UNTERSCHRIFT_RECHTS, 'Mieter');
  y += UNTERSCHRIFT_HOEHE + 2;

  layout.linie(UNTERSCHRIFT_LINKS, y, UNTERSCHRIFT_LINIE);
  layout.linie(UNTERSCHRIFT_RECHTS, y, UNTERSCHRIFT_LINIE);

  const spalte = (x: number, rolle: string, namen: string[]) => {
    let zeile = y + ZEILE;
    layout.schrift();
    doc.text(rolle, x, zeile);
    zeile += ZEILE;
    layout.schrift(9);
    for (const name of namen) {
      doc.text(name, x, zeile);
      zeile += 3.8;
    }
    layout.schrift(9, false, true);
    doc.text(`Datum: ${data.uebergabeDatum}`, x, zeile);
    return zeile;
  };
  const links = spalte(UNTERSCHRIFT_LINKS, 'Vermieter / Bevollmächtigter', []);
  const rechts = spalte(UNTERSCHRIFT_RECHTS, 'Mieter', mieterNamen);
  layout.schrift();
  return Math.max(links, rechts) + ZEILE;
}
