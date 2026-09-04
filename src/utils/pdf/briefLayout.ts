/**
 * Gemeinsames Layout für alle NiImmo-PDFs.
 *
 * Bisher hatte jeder der fünf Generatoren seine eigene Kopie von Fußzeile,
 * Seitenumbruch und Blocksatz — mit abweichenden Rändern (25 mm bei Mahnung
 * und Kündigung, 15 mm bei der Betriebskostenabrechnung) und teils kaputter
 * Paginierung. Dieses Modul bündelt die Mechanik, damit ein mehrseitiger
 * Mietvertrag nicht die sechste Kopie wird.
 *
 * Maßgeblich für die Optik ist `nebenkostenAbrechnungPdfGenerator.ts` — der
 * einzige Generator, der der aktuellen NiImmo-Briefvorlage folgt.
 */
import type jsPDF from 'jspdf';

export type RGB = [number, number, number];

export const ORANGE: RGB = [213, 84, 38];
export const DARK: RGB = [30, 30, 30];
export const GRAY: RGB = [120, 120, 120];
export const LIGHT: RGB = [245, 245, 245];

export const PAGE_WIDTH = 210;
export const PAGE_HEIGHT = 297;

/**
 * Das Logo ist 129 × 141 px, also höher als breit. Die bestehenden Generatoren
 * zeichnen es mit 44 × 14 mm und stauchen es damit auf 29 % seiner Höhe.
 * Hier wird die Breite aus der gewünschten Höhe abgeleitet.
 */
const LOGO_RATIO = 141 / 129;

export function logoMasse(hoeheMm: number): { breite: number; hoehe: number } {
  return { breite: hoeheMm / LOGO_RATIO, hoehe: hoeheMm };
}

let logoCache: string | null = null;

export async function loadLogo(): Promise<string | null> {
  if (logoCache) return logoCache;
  try {
    const res = await fetch('/nilimmo-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        logoCache = reader.result as string;
        resolve(logoCache);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Formatierung ─────────────────────────────────────────────────────────────

export function formatEur(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return (
    v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  );
}

/**
 * Datumsangaben werden mit Mittagszeit geparst. Ohne den Zusatz kippt ein
 * reines `YYYY-MM-DD` je nach Zeitzone auf den Vortag — bei einem Mietbeginn
 * wäre das ein inhaltlicher Fehler im Vertrag.
 */
export function formatDatum(datum: string | null | undefined): string {
  if (!datum) return '';
  const d = datum.length === 10 ? new Date(`${datum}T12:00:00`) : new Date(datum);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** IBAN in Vierergruppen, wie sie im Vertrag stehen soll. */
export function formatIban(iban: string | null | undefined): string {
  if (!iban) return '';
  return iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/**
 * IBAN-Prüfziffer nach ISO 7064 (MOD 97-10).
 *
 * Die Word-Vorlage nennt als Mietkonto `DE89 2559 1413 3155 4105 00` — diese
 * IBAN ist ungültig, die Prüfziffer stammt offenbar aus der Kautions-IBAN.
 * Überweisungen dorthin werden von der Bank abgelehnt. Deshalb prüft der
 * Generator jede IBAN, bevor sie in einen Vertrag gedruckt wird.
 */
export function istIbanGueltig(iban: string | null | undefined): boolean {
  if (!iban) return false;
  const clean = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(clean)) return false;
  const umgestellt = clean.slice(4) + clean.slice(0, 4);
  const numerisch = umgestellt.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  // stückweise Modulo, weil die Zahl für Number zu groß wird
  let rest = 0;
  for (const ziffer of numerisch) {
    rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}

/** Betrag in Worten, für die Mietzinsangabe „(in Worten: …)". */
export function betragInWorten(betrag: number): string {
  const ganze = Math.floor(Math.abs(betrag));
  const cent = Math.round((Math.abs(betrag) - ganze) * 100);
  const wort = zahlInWorten(ganze);
  const centTeil = cent > 0 ? ` ${zahlInWorten(cent)} Cent` : '';
  return `${wort} Euro${centTeil}`;
}

const EINER = [
  'null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn',
  'achtzehn', 'neunzehn',
];
const ZEHNER = [
  '', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig',
];

function zahlInWorten(n: number): string {
  if (n === 0) return 'null';
  if (n === 1) return 'ein';
  if (n < 20) return EINER[n];
  if (n < 100) {
    const z = Math.floor(n / 10);
    const e = n % 10;
    return e === 0 ? ZEHNER[z] : `${EINER[e]}und${ZEHNER[z]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return `${EINER[h]}hundert${rest ? zahlInWorten(rest) : ''}`;
  }
  if (n < 1_000_000) {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    const tausender = t === 1 ? 'ein' : zahlInWorten(t);
    return `${tausender}tausend${rest ? zahlInWorten(rest) : ''}`;
  }
  const m = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const millionen = m === 1 ? 'eine Million' : `${zahlInWorten(m)} Millionen`;
  return `${millionen}${rest ? ' ' + zahlInWorten(rest) : ''}`;
}

// ─── Seitenmechanik ───────────────────────────────────────────────────────────

/**
 * Zeile einer Betragstabelle. Die Hausvorlage führt die Betriebskosten als
 * Aufstellung mit rechtsbündiger Eurospalte, Zwischensumme und doppelt
 * unterstrichener Endsumme — nicht als Fließtext. Wer den Vertrag prüft,
 * liest genau diese Spalte.
 */
export interface TabellenZeile {
  links: string;
  rechts: string;
  bold?: boolean;
  /** Trennlinie über der Zeile, z. B. vor einer Summe. */
  linieOben?: boolean;
  /** Doppelstrich unter der Zeile — kennzeichnet die Endsumme. */
  doppelstrichUnten?: boolean;
}

export interface LayoutOptions {
  marginLeft?: number;
  marginRight?: number;
  /** Ab dieser Höhe wird umgebrochen. */
  maxY?: number;
  /** Y-Position, bei der eine Folgeseite beginnt. */
  folgeseiteStartY?: number;
  /** Kopfzeile auf Folgeseiten, z. B. der Vertragsbezug. */
  folgeseitenKopf?: string;
  zeilenhoehe?: number;
}

export interface Layout {
  readonly ml: number;
  readonly mr: number;
  readonly cw: number;
  /** Bricht um, wenn der benötigte Platz nicht mehr passt, und liefert die neue Y-Position. */
  umbruchPruefen(y: number, benoetigt?: number): number;
  /** Blocksatz mit automatischem Umbruch. Liefert die Y-Position darunter. */
  blocksatz(text: string, y: number, opts?: { fontSize?: number; bold?: boolean; indent?: number }): number;
  /** Linksbündiger Absatz. */
  absatz(text: string, y: number, opts?: { fontSize?: number; bold?: boolean; indent?: number }): number;
  /** Paragraphenüberschrift. */
  ueberschrift(text: string, y: number): number;
  /** Zweispaltige Betragstabelle: Bezeichnung links, Betrag rechtsbündig. */
  betragstabelle(zeilen: TabellenZeile[], y: number): number;
  /** Setzt „Seite X von Y" auf alle Seiten. Am Ende aufrufen. */
  seitenzahlenSetzen(): void;
}

export function createLayout(doc: jsPDF, opts: LayoutOptions = {}): Layout {
  const ml = opts.marginLeft ?? 20;
  const mr = opts.marginRight ?? 20;
  const cw = PAGE_WIDTH - ml - mr;
  const maxY = opts.maxY ?? 262;
  const folgeseiteStartY = opts.folgeseiteStartY ?? 28;
  const zeilenhoehe = opts.zeilenhoehe ?? 4.6;

  function folgeseitenkopf(): void {
    if (!opts.folgeseitenKopf) return;
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setFont('helvetica', 'normal');
    doc.text(opts.folgeseitenKopf, ml, 15);
    // Dezente Haarlinie statt Briefkopf-Akzent: Der Vertrag soll wie eine
    // Urkunde wirken, nicht wie ein Anschreiben. Der Bezug auf jeder Seite
    // stützt zugleich die Einheit der Urkunde (§ 550 BGB).
    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(0.2);
    doc.line(ml, 18, PAGE_WIDTH - mr, 18);
    doc.setTextColor(...DARK);
  }

  function umbruchPruefen(y: number, benoetigt = 8): number {
    if (y + benoetigt > maxY) {
      doc.addPage();
      folgeseitenkopf();
      return folgeseiteStartY;
    }
    return y;
  }

  function schriftSetzen(fontSize: number, bold: boolean): void {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...DARK);
  }

  function blocksatz(
    text: string,
    y: number,
    { fontSize = 9, bold = false, indent = 0 }: { fontSize?: number; bold?: boolean; indent?: number } = {}
  ): number {
    schriftSetzen(fontSize, bold);
    const x = ml + indent;
    const breite = cw - indent;
    const lines = doc.splitTextToSize(text, breite) as string[];

    for (let i = 0; i < lines.length; i++) {
      y = umbruchPruefen(y, zeilenhoehe);
      schriftSetzen(fontSize, bold);
      const letzte = i === lines.length - 1;
      const woerter = lines[i].split(' ').filter(Boolean);

      if (!letzte && woerter.length > 1) {
        const wortBreite = woerter.reduce((s, w) => s + doc.getTextWidth(w), 0);
        const luecke = (breite - wortBreite) / (woerter.length - 1);
        let cx = x;
        for (const wort of woerter) {
          doc.text(wort, cx, y);
          cx += doc.getTextWidth(wort) + luecke;
        }
      } else {
        doc.text(lines[i], x, y);
      }
      y += zeilenhoehe;
    }
    return y;
  }

  function absatz(
    text: string,
    y: number,
    { fontSize = 9, bold = false, indent = 0 }: { fontSize?: number; bold?: boolean; indent?: number } = {}
  ): number {
    schriftSetzen(fontSize, bold);
    const lines = doc.splitTextToSize(text, cw - indent) as string[];
    for (const line of lines) {
      y = umbruchPruefen(y, zeilenhoehe);
      schriftSetzen(fontSize, bold);
      doc.text(line, ml + indent, y);
      y += zeilenhoehe;
    }
    return y;
  }

  function ueberschrift(text: string, y: number): number {
    // Überschrift und mindestens zwei Textzeilen zusammenhalten
    y = umbruchPruefen(y + 3, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(text, ml, y);
    return y + 5.5;
  }

  /**
   * Beträge stehen rechtsbündig an derselben Kante, damit die Spalte beim
   * Überfliegen eine Linie bildet. Lange Bezeichnungen werden umgebrochen,
   * der Betrag steht dann auf der ersten Zeile.
   */
  function betragstabelle(zeilen: TabellenZeile[], y: number): number {
    const rechteKante = PAGE_WIDTH - mr;
    const textBreite = cw - 26;

    for (const z of zeilen) {
      const lines = doc.splitTextToSize(z.links, textBreite) as string[];
      y = umbruchPruefen(y, lines.length * zeilenhoehe + (z.linieOben ? 3 : 0));

      if (z.linieOben) {
        doc.setDrawColor(90, 90, 90);
        doc.setLineWidth(0.2);
        doc.line(ml, y - 3.2, rechteKante, y - 3.2);
      }

      schriftSetzen(8.5, z.bold ?? false);
      lines.forEach((line, i) => {
        doc.text(line, ml, y + i * zeilenhoehe);
      });
      if (z.rechts) doc.text(z.rechts, rechteKante, y, { align: 'right' });

      y += lines.length * zeilenhoehe;

      if (z.doppelstrichUnten) {
        doc.setDrawColor(60, 60, 60);
        doc.setLineWidth(0.25);
        doc.line(rechteKante - 32, y - 2.8, rechteKante, y - 2.8);
        doc.line(rechteKante - 32, y - 1.8, rechteKante, y - 1.8);
        y += 1.5;
      }
    }
    return y;
  }

  function seitenzahlenSetzen(): void {
    const gesamt = doc.getNumberOfPages();
    for (let i = 1; i <= gesamt; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY);
      doc.text(`Seite ${i} von ${gesamt}`, PAGE_WIDTH / 2, 288, { align: 'center' });
    }
  }

  return {
    ml, mr, cw, umbruchPruefen, blocksatz, absatz, ueberschrift, betragstabelle, seitenzahlenSetzen,
  };
}
