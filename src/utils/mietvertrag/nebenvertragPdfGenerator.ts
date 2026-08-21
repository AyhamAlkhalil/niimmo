/**
 * PDF für die Kurzverträge: Stellplatz und Einbauküche.
 *
 * Teilt sich Layout und Mechanik mit dem Wohnraumvertrag, hat aber einen
 * eigenen Kopf — die Parteien heißen bei der Küche Verleiher und Entleiher,
 * nicht Vermieter und Mieter.
 */
import jsPDF from 'jspdf';
import {
  ORANGE,
  DARK,
  GRAY,
  PAGE_WIDTH,
  createLayout,
  loadLogo,
  logoMasse,
  formatDatum,
} from '../pdf/briefLayout';
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
  const logo = await loadLogo();

  const layout = createLayout(doc, {
    marginLeft: ML,
    marginRight: MR,
    maxY: 262,
    folgeseiteStartY: 28,
    folgeseitenKopf: `${titel} · ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort}`,
    zeilenhoehe: 4.6,
  });

  let y = kopf(doc, art, titel, d, logo);

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
  d: NebenvertragDaten,
  logo: string | null
): number {
  const { geber, nehmer } = rollen(art);

  if (logo) {
    const { breite, hoehe } = logoMasse(16);
    doc.addImage(logo, 'PNG', PAGE_WIDTH / 2 - breite / 2, 10, breite, hoehe);
  }

  let y = logo ? 32 : 20;

  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('— Gruppe —', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 5;

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, y, PAGE_WIDTH - MR, y);
  y += 12;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(titel, PAGE_WIDTH / 2, y, { align: 'center' });
  y += 12;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text('zwischen', ML, y);
  y += 6;

  const v = d.vermieter;
  doc.setFont('helvetica', 'bold');
  doc.text(v.firmenname, ML + 10, y);
  y += 4.8;
  doc.setFont('helvetica', 'normal');
  if (v.vertretenDurch.length > 0) {
    doc.text(`vertreten durch ${v.vertretenDurch.join(' und ')}`, ML + 10, y);
    y += 4.8;
  }
  doc.text(`${v.strasse} ${v.hausnummer}`, ML + 10, y);
  y += 4.8;
  doc.text(`${v.plz} ${v.ort}`, ML + 10, y);
  y += 4.8;

  doc.setFont('helvetica', 'italic');
  doc.text(`— nachfolgend ${geber} —`, PAGE_WIDTH - MR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 9;

  doc.text('und', ML, y);
  y += 6;

  for (const m of d.mieter) {
    y = parteiZeilen(doc, m, y);
    y += 2;
  }

  doc.setFont('helvetica', 'italic');
  doc.text(`— nachfolgend ${nehmer} —`, PAGE_WIDTH - MR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 10;

  doc.text(
    art === 'kueche'
      ? 'wird folgende Vereinbarung geschlossen:'
      : 'wird folgender Mietvertrag geschlossen:',
    ML,
    y
  );

  return y + 8;
}

function parteiZeilen(doc: jsPDF, m: MieterDaten, y: number): number {
  doc.setFontSize(9.5);

  if (m.istUnternehmen) {
    doc.setFont('helvetica', 'bold');
    doc.text(m.firmenname ?? '', ML + 10, y);
    y += 4.8;
    doc.setFont('helvetica', 'normal');
    if (m.vertretenDurch) {
      doc.text(`vertreten durch ${m.vertretenDurch}`, ML + 10, y);
      y += 4.8;
    }
  } else {
    if (m.anrede && m.anrede !== 'Divers') {
      doc.setFont('helvetica', 'normal');
      doc.text(m.anrede, ML + 10, y);
      y += 4.8;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`${m.vorname} ${m.nachname}`.trim(), ML + 10, y);
    y += 4.8;
    doc.setFont('helvetica', 'normal');
  }

  if (m.strasse) {
    doc.text(`${m.strasse} ${m.hausnummer ?? ''}`.trim(), ML + 10, y);
    y += 4.8;
    doc.text(`${m.plz ?? ''} ${m.ort ?? ''}`.trim(), ML + 10, y);
    y += 4.8;
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text('zur Zeit wohnhaft', ML + 10, y);
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    y += 4.8;
  }

  return y;
}

function absatz(layout: ReturnType<typeof createLayout>, a: Absatz, y: number): number {
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
  const { geber, nehmer } = rollen(art);
  const zeilen = Math.max(1, d.mieter.length);
  y = layout.umbruchPruefen(y + 8, 24 + zeilen * 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);
  doc.text(
    d.unterschriftOrt && d.vertragsdatum
      ? `${d.unterschriftOrt}, den ${formatDatum(d.vertragsdatum)}`
      : '________________________, den ______________',
    ML,
    y
  );
  y += 14;

  const spalte2 = PAGE_WIDTH / 2 + 5;

  for (let i = 0; i < zeilen; i++) {
    y = layout.umbruchPruefen(y, 20);
    if (i === 0) {
      linie(doc, ML, y, geber, d.vermieter.vertretenDurch[0] ?? d.vermieter.firmenname);
    }
    const m = d.mieter[i];
    if (m) {
      const name = m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim();
      linie(doc, spalte2, y, i === 0 ? nehmer : '', name);
    }
    y += 20;
  }
}

function linie(doc: jsPDF, x: number, y: number, rolle: string, name: string): void {
  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + 62, y);
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'normal');
  doc.text(name, x, y + 4);
  if (rolle) {
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(rolle, x, y + 8);
    doc.setTextColor(...DARK);
  }
}

/** Bei der Küchenüberlassung heißen die Parteien Verleiher und Entleiher. */
function rollen(art: Nebenvertragsart | 'gewerbe'): { geber: string; nehmer: string } {
  if (art === 'gewerbe') return { geber: 'Vermieter', nehmer: 'Mieter' };
  return parteiBezeichnung(art);
}
