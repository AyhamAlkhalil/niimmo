/**
 * Erzeugt den Mietvertrag als PDF.
 *
 * Optik nach der NiImmo-Briefvorlage (wie `nebenkostenAbrechnungPdfGenerator`),
 * Seitenmechanik aus `briefLayout`. Anders als bei den Briefdokumenten ist die
 * Länge nicht vorhersagbar — deshalb paginiert jeder Absatz selbst und die
 * Seitenzahlen werden erst am Ende gesetzt.
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
import { anlagenFuerVertrag, type Anlage } from './anlagen';
import { wohnraumParagraphen, type Absatz, type Paragraph } from './wohnraumKlauseln';
import type { MieterDaten, MietvertragDaten } from './typen';

const ML = 20;
const MR = 20;

export async function generateMietvertragPdf(d: MietvertragDaten): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const logo = await loadLogo();

  const bezug = `Mietvertrag · ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort} · ${d.einheit.bezeichnung}`;

  const layout = createLayout(doc, {
    marginLeft: ML,
    marginRight: MR,
    maxY: 262,
    folgeseiteStartY: 28,
    folgeseitenKopf: bezug,
    zeilenhoehe: 4.6,
  });

  let y = titelseite(doc, d, logo);

  for (const p of wohnraumParagraphen(d)) {
    y = paragraphRendern(layout, p, y);
  }

  y = unterschriftsblock(doc, layout, d, y);

  for (const anlage of anlagenFuerVertrag(d)) {
    doc.addPage();
    y = anlageRendern(doc, layout, anlage, d);
  }

  layout.seitenzahlenSetzen();
  return doc.output('blob');
}

// ─── Titelseite ──────────────────────────────────────────────────────────────

function titelseite(doc: jsPDF, d: MietvertragDaten, logo: string | null): number {
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

  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('Mietvertrag über Wohnraum', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 12;

  // ── Vermieterblock
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
    const wort = v.vertretungArt === 'einzel' ? 'vertreten durch' : 'gemeinsam vertreten durch';
    doc.text(`${wort} ${v.vertretenDurch.join(' und ')}`, ML + 10, y);
    y += 4.8;
  }
  doc.text(`${v.strasse} ${v.hausnummer}`, ML + 10, y);
  y += 4.8;
  doc.text(`${v.plz} ${v.ort}`, ML + 10, y);
  y += 4.8;
  if (v.handelsregister && v.registergericht) {
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(`${v.registergericht}, ${v.handelsregister}`, ML + 10, y);
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    y += 4.8;
  }

  doc.setFont('helvetica', 'italic');
  doc.text('— nachfolgend Vermieter —', PAGE_WIDTH - MR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 9;

  // ── Mieterblock
  doc.text('und', ML, y);
  y += 6;

  d.mieter.forEach((m, i) => {
    if (i > 0) y += 3;
    y = mieterZeilen(doc, m, y);
  });

  doc.setFont('helvetica', 'italic');
  doc.text('— nachfolgend Mieter —', PAGE_WIDTH - MR, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 10;

  doc.setFontSize(9.5);
  doc.text('wird folgender Mietvertrag geschlossen:', ML, y);

  return y + 8;
}

function mieterZeilen(doc: jsPDF, m: MieterDaten, y: number): number {
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
    doc.setFont('helvetica', 'normal');
    if (m.anrede && m.anrede !== 'Divers') {
      doc.text(m.anrede, ML + 10, y);
      y += 4.8;
    }
    doc.setFont('helvetica', 'bold');
    doc.text(`${m.vorname} ${m.nachname}`.trim(), ML + 10, y);
    y += 4.8;
    doc.setFont('helvetica', 'normal');
    if (m.geburtsdatum) {
      doc.setFontSize(8.5);
      doc.setTextColor(...GRAY);
      doc.text(`geboren am ${formatDatum(m.geburtsdatum)}`, ML + 10, y);
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK);
      y += 4.8;
    }
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

// ─── Paragraphen ─────────────────────────────────────────────────────────────

function paragraphRendern(
  layout: ReturnType<typeof createLayout>,
  p: Paragraph,
  y: number
): number {
  y = layout.ueberschrift(`${p.nummer} ${p.titel}`, y);
  for (const a of p.absaetze) {
    y = absatzRendern(layout, a, y);
  }
  return y + 2;
}

function absatzRendern(
  layout: ReturnType<typeof createLayout>,
  a: Absatz,
  y: number
): number {
  if (!a.text.trim()) return y + 3;

  const text = a.nummer ? `${a.nummer}  ${a.text}` : a.text;

  y = a.linksbuendig ? layout.absatz(text, y) : layout.blocksatz(text, y);

  return y + 2;
}

// ─── Unterschriften ──────────────────────────────────────────────────────────

function unterschriftsblock(
  doc: jsPDF,
  layout: ReturnType<typeof createLayout>,
  d: MietvertragDaten,
  y: number
): number {
  const vermieterLinien = d.vermieter.vertretungArt === 'gesamt' ? d.vermieter.vertretenDurch.length || 1 : 1;
  const linien = vermieterLinien + d.mieter.length;
  // Ort/Datum-Zeile plus je Unterschrift 18 mm
  y = layout.umbruchPruefen(y + 8, 20 + linien * 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DARK);

  const ortDatum =
    d.unterschriftOrt && d.vertragsdatum
      ? `${d.unterschriftOrt}, den ${formatDatum(d.vertragsdatum)}`
      : '________________________, den ______________';
  doc.text(ortDatum, ML, y);
  y += 14;

  const spalte2 = PAGE_WIDTH / 2 + 5;
  const linienBreite = 62;

  // Vermieterseite links, Mieterseite rechts
  const maxZeilen = Math.max(vermieterLinien, d.mieter.length);
  for (let i = 0; i < maxZeilen; i++) {
    y = layout.umbruchPruefen(y, 20);

    if (i < vermieterLinien) {
      unterschriftslinie(
        doc,
        ML,
        y,
        linienBreite,
        i === 0 ? 'Vermieter' : '',
        d.vermieter.vertretenDurch[i] ?? d.vermieter.firmenname
      );
    }
    if (i < d.mieter.length) {
      const m = d.mieter[i];
      const name = m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim();
      unterschriftslinie(doc, spalte2, y, linienBreite, i === 0 ? 'Mieter' : '', name);
    }
    y += 20;
  }

  return y;
}

function unterschriftslinie(
  doc: jsPDF,
  x: number,
  y: number,
  breite: number,
  rolle: string,
  name: string
): void {
  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + breite, y);

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

// ─── Anlagen ─────────────────────────────────────────────────────────────────

function anlageRendern(
  doc: jsPDF,
  layout: ReturnType<typeof createLayout>,
  anlage: Anlage,
  d: MietvertragDaten
): number {
  let y = 28;

  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text(anlage.kennung.toUpperCase(), ML, y);
  y += 6;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(anlage.titel, ML, y);
  y += 4;

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PAGE_WIDTH - MR, y);
  y += 7;

  if (anlage.vorspann) {
    y = layout.blocksatz(anlage.vorspann, y, { fontSize: 8.5 });
    y += 3;
  }

  for (const abschnitt of anlage.abschnitte) {
    if (abschnitt.titel) {
      y = layout.ueberschrift(
        abschnitt.nummer ? `${abschnitt.nummer} ${abschnitt.titel}` : abschnitt.titel,
        y
      );
    }
    for (const a of abschnitt.absaetze) {
      y = absatzRendern(layout, a, y);
    }
    y += 1;
  }

  if (anlage.unterschrift) {
    y = layout.umbruchPruefen(y + 10, 26);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text('________________________, den ______________', ML, y);
    y += 16;
    const name = d.mieter
      .map(m => (m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim()))
      .join(', ');
    unterschriftslinie(doc, ML, y, 62, 'Mieter', name);
    y += 18;
  }

  return y;
}
