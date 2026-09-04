/**
 * PDF für Stellplatz, Einbauküche und Gewerbe.
 *
 * Gleicher Aufbau wie der Wohnraumvertrag und damit wie die Word-Hausvorlage:
 * schlichter Titel, Rubrum in Tabulatorform, „als Vermieter" rechtsbündig.
 * Bei der Küchenüberlassung heißen die Parteien Verleiher und Entleiher.
 */
import jsPDF from 'jspdf';
import { DARK, GRAY, PAGE_WIDTH, createLayout, formatDatum } from '../pdf/briefLayout';
import { gewerbeParagraphen, type GewerbeDaten } from './gewerbeKlauseln';
import {
  kuechenParagraphen,
  nebenvertragTitel,
  parteiBezeichnung,
  stellplatzParagraphen,
  type NebenvertragDaten,
} from './nebenvertraege';
import type { Absatz, Paragraph } from './wohnraumKlauseln';
import type { MieterDaten } from './typen';

const ML = 20;
const MR = 20;
/** Tabstopp des Rubrums, wie im Wohnraumvertrag. */
const RUBRUM_X = ML + 28;

export type Nebenvertragsart = 'stellplatz' | 'kueche';

export async function generateNebenvertragPdf(
  art: Nebenvertragsart,
  d: NebenvertragDaten
): Promise<Blob> {
  const paragraphen: Paragraph[] =
    art === 'stellplatz' ? stellplatzParagraphen(d) : kuechenParagraphen(d);
  return rendern(art, nebenvertragTitel(art), d, paragraphen);
}

/**
 * Gewerbemietvertrag. Nutzt denselben Rahmen — Kopf, Parteien, Paragraphen,
 * Unterschriften —, nur mit anderem Titel und anderer Paragraphenquelle.
 */
export async function generateGewerbeVertragPdf(g: GewerbeDaten): Promise<Blob> {
  const d: NebenvertragDaten = {
    vermieter: g.vermieter,
    mieter: g.mieter,
    objekt: {
      strasse: g.objekt.strasse,
      hausnummer: g.objekt.hausnummer,
      plz: g.objekt.plz,
      ort: g.objekt.ort,
    },
    bezeichnung: g.mietzweck,
    beginn: g.mietbeginn,
    vertragsdatum: g.vertragsdatum,
    unterschriftOrt: g.unterschriftOrt,
  };
  return rendern('gewerbe', 'Gewerbemietvertrag', d, gewerbeParagraphen(g));
}

async function rendern(
  art: Nebenvertragsart | 'gewerbe',
  titel: string,
  d: NebenvertragDaten,
  paragraphen: Paragraph[]
): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');

  const layout = createLayout(doc, {
    marginLeft: ML,
    marginRight: MR,
    maxY: 262,
    folgeseiteStartY: 28,
    folgeseitenKopf: `${titel} · ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort}`,
    zeilenhoehe: 4.6,
  });

  let y = kopf(doc, art, titel, d);

  for (const p of paragraphen) {
    y = layout.ueberschrift(`${p.nummer} ${p.titel}`, y);
    for (const a of p.absaetze) {
      y = absatz(layout, a, y);
    }
    y += 2;
  }

  unterschriften(doc, layout, art, d, y);
  layout.seitenzahlenSetzen();

  return doc.output('blob');
}

function kopf(
  doc: jsPDF,
  art: Nebenvertragsart | 'gewerbe',
  titel: string,
  d: NebenvertragDaten
): number {
  const { geber, nehmer } = rollen(art);

  let y = 28;
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(titel, RUBRUM_X + 10, y);
  y += 14;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('zwischen', ML, y);

  const v = d.vermieter;
  if (v.rechtsform) {
    doc.text('Firma', RUBRUM_X, y);
    y += 5;
  }
  doc.setFont('helvetica', 'bold');
  doc.text(v.firmenname, RUBRUM_X, y);
  doc.setFont('helvetica', 'normal');
  y += 5;
  if (v.vertretenDurch.length > 0) {
    doc.text(`vertreten durch ${v.vertretenDurch.join(' und ')}`, RUBRUM_X, y);
    y += 5;
  }
  doc.text(`${v.strasse} ${v.hausnummer}`, RUBRUM_X, y);
  y += 5;
  doc.text(`${v.plz} ${v.ort}`, RUBRUM_X, y);
  y += 8;

  doc.text(`als ${geber}`, PAGE_WIDTH - MR, y, { align: 'right' });
  y += 10;

  doc.text('und', ML, y);
  d.mieter.forEach((m, i) => {
    if (i > 0) y += 4;
    y = parteiZeilen(doc, m, y);
  });

  y += 3;
  doc.text(`als ${nehmer}`, PAGE_WIDTH - MR, y, { align: 'right' });
  y += 12;

  doc.text(
    art === 'kueche'
      ? 'wird folgende Vereinbarung geschlossen:'
      : 'wird folgender Mietvertrag vereinbart:',
    ML,
    y
  );

  return y + 10;
}

/** Beschriftung unter dem Wert, wie in der Word-Vorlage. */
function feldbeschriftung(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(text, RUBRUM_X, y);
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  return y + 6;
}

function parteiZeilen(doc: jsPDF, m: MieterDaten, y: number): number {
  doc.setFontSize(10);
  doc.setTextColor(...DARK);

  if (m.istUnternehmen) {
    doc.setFont('helvetica', 'normal');
    doc.text('Firma', RUBRUM_X, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text(m.firmenname ?? '', RUBRUM_X, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
    if (m.vertretenDurch) {
      doc.text(`vertreten durch ${m.vertretenDurch}`, RUBRUM_X, y);
      y += 5;
    }
  } else {
    doc.setFont('helvetica', 'normal');
    if (m.anrede && m.anrede !== 'Divers') {
      doc.text(m.anrede, RUBRUM_X, y);
      y += 5;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`${m.vorname} ${m.nachname}`.trim(), RUBRUM_X, y);
    doc.setFont('helvetica', 'normal');
    y += 4;
    y = feldbeschriftung(doc, 'Vor- und Zuname', y);
  }

  if (m.strasse) {
    const anschrift = `${m.strasse} ${m.hausnummer ?? ''}`.trim() +
      `, ${`${m.plz ?? ''} ${m.ort ?? ''}`.trim()}`;
    doc.text(anschrift, RUBRUM_X, y);
    y += 4;
    y = feldbeschriftung(doc, 'Zur Zeit wohnhaft in', y);
  }

  return y;
}

function absatz(layout: ReturnType<typeof createLayout>, a: Absatz, y: number): number {
  if (a.tabelle) {
    // Beträge stehen in einer eigenen Spalte, nicht im Fließtext.
    return layout.betragstabelle(a.tabelle, y + 1) + 3;
  }

  if (!a.text.trim()) return y + 3;
  const text = a.nummer ? `${a.nummer}  ${a.text}` : a.text;
  y = a.linksbuendig ? layout.absatz(text, y) : layout.blocksatz(text, y);
  return y + 2;
}

function unterschriften(
  doc: jsPDF,
  layout: ReturnType<typeof createLayout>,
  art: Nebenvertragsart | 'gewerbe',
  d: NebenvertragDaten,
  y: number
): void {
  // Aufbau wie im Wohnraumvertrag: je Partei Ort/Datum, darunter die Unterschrift.
  const { geber, nehmer } = rollen(art);
  const zeilen = Math.max(1, d.mieter.length);
  y = layout.umbruchPruefen(y + 10, 26 + zeilen * 22);

  const spalte2 = PAGE_WIDTH / 2 + 5;
  const breite = 68;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);

  const ortDatum =
    d.unterschriftOrt && d.vertragsdatum
      ? `${d.unterschriftOrt}, den ${formatDatum(d.vertragsdatum)}`
      : '';

  for (const x of [ML, spalte2]) {
    if (ortDatum) doc.text(ortDatum, x, y - 1.5);
    strich(doc, x, y, breite);
    rolleUndName(doc, '(Ort, Datum)', x, y + 4);
  }
  y += 20;

  for (let i = 0; i < zeilen; i++) {
    y = layout.umbruchPruefen(y, 22);

    if (i === 0) {
      strich(doc, ML, y, breite);
      rolleUndName(doc, geber, ML, y + 4, d.vermieter.vertretenDurch[0] ?? d.vermieter.firmenname);
    }
    const m = d.mieter[i];
    if (m) {
      const name = m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim();
      strich(doc, spalte2, y, breite);
      rolleUndName(doc, i === 0 ? nehmer : '', spalte2, y + 4, name);
    }
    y += 22;
  }
}

function strich(doc: jsPDF, x: number, y: number, breite: number): void {
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + breite, y);
}

function rolleUndName(
  doc: jsPDF,
  rolle: string,
  x: number,
  y: number,
  name?: string
): void {
  if (rolle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text(rolle, x, y);
  }
  if (name) {
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(name, x, y + (rolle ? 4 : 0));
    doc.setTextColor(...DARK);
  }
}

/** Bei der Küchenüberlassung heißen die Parteien Verleiher und Entleiher. */
function rollen(art: Nebenvertragsart | 'gewerbe'): { geber: string; nehmer: string } {
  if (art === 'gewerbe') return { geber: 'Vermieter', nehmer: 'Mieter' };
  return parteiBezeichnung(art);
}
