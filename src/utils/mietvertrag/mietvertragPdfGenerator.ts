/**
 * Erzeugt den Mietvertrag als PDF.
 *
 * Die Optik folgt bewusst der Word-Hausvorlage und nicht der NiImmo-Briefvorlage:
 * schlichter Titel, Rubrum in Tabulatorform mit den Feldbeschriftungen unter den
 * Werten, „als Vermieter" bzw. „als Mieter" rechtsbündig. Kein Logo, keine
 * Farbflächen — ein Nachmieter soll dasselbe Dokument in der Hand halten wie
 * sein Vormieter.
 *
 * Seitenmechanik aus `briefLayout`. Die Länge ist nicht vorhersagbar, deshalb
 * paginiert jeder Absatz selbst und die Seitenzahlen entstehen erst am Ende.
 */
import jsPDF from 'jspdf';
import { DARK, GRAY, PAGE_WIDTH, createLayout, formatDatum } from '../pdf/briefLayout';
import { anlagenFuerVertrag, type Anlage } from './anlagen';
import { wohnraumParagraphen, type Absatz, type Paragraph } from './wohnraumKlauseln';
import type { MieterDaten, MietvertragDaten } from './typen';

const ML = 20;
const MR = 20;
/** Spalte, in der die Werte des Rubrums beginnen — entspricht dem Tabstopp in Word. */
const RUBRUM_X = ML + 28;

export async function generateMietvertragPdf(d: MietvertragDaten): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');

  const bezug = `Mietvertrag · ${d.objekt.strasse} ${d.objekt.hausnummer}, ${d.objekt.plz} ${d.objekt.ort} · ${d.einheit.bezeichnung}`;

  const layout = createLayout(doc, {
    marginLeft: ML,
    marginRight: MR,
    maxY: 262,
    folgeseiteStartY: 28,
    folgeseitenKopf: bezug,
    zeilenhoehe: 4.6,
  });

  let y = titelseite(doc, d);

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

function titelseite(doc: jsPDF, d: MietvertragDaten): number {
  // Der Titel steht in der Word-Vorlage eingerückt, nicht zentriert.
  let y = 28;
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('Mietvertrag', RUBRUM_X + 22, y);
  y += 14;

  // ── Vermieterseite
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
    const wort = v.vertretungArt === 'einzel' ? 'vertreten durch' : 'gemeinsam vertreten durch';
    doc.text(`${wort} ${v.vertretenDurch.join(' und ')}`, RUBRUM_X, y);
    y += 5;
  }
  doc.text(`${v.strasse} ${v.hausnummer}`, RUBRUM_X, y);
  y += 5;
  doc.text(`${v.plz} ${v.ort}`, RUBRUM_X, y);
  y += 8;

  doc.text('als Vermieter', PAGE_WIDTH - MR, y, { align: 'right' });
  y += 10;

  // ── Mieterseite
  doc.text('und', ML, y);
  d.mieter.forEach((m, i) => {
    if (i > 0) y += 4;
    y = mieterZeilen(doc, m, y);
  });

  y += 3;
  doc.text('als Mieter', PAGE_WIDTH - MR, y, { align: 'right' });
  y += 12;

  doc.text('wird folgender Mietvertrag vereinbart:', ML, y);

  return y + 10;
}

/** Beschriftung unter dem Wert, wie in der Word-Vorlage („Vor- und Zuname"). */
function feldbeschriftung(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(text, RUBRUM_X, y);
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  return y + 6;
}

function mieterZeilen(doc: jsPDF, m: MieterDaten, y: number): number {
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

    if (m.geburtsdatum) {
      doc.text(formatDatum(m.geburtsdatum), RUBRUM_X, y);
      y += 4;
      y = feldbeschriftung(doc, 'Geburtsdatum', y);
    }
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
  // Aufbau der Word-Vorlage: je Partei eine Ort/Datum-Linie, darunter die
  // Unterschriftslinie. Bei Gesamtvertretung braucht die Vermieterseite so
  // viele Linien, wie Geschaeftsfuehrer gemeinsam zeichnen muessen.
  const vermieterLinien =
    d.vermieter.vertretungArt === 'gesamt' ? d.vermieter.vertretenDurch.length || 1 : 1;
  const zeilen = Math.max(vermieterLinien, d.mieter.length);

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

  // Ort/Datum fuer beide Seiten
  for (const x of [ML, spalte2]) {
    if (ortDatum) doc.text(ortDatum, x, y - 1.5);
    linie(doc, x, y, breite);
    beschriftung(doc, '(Ort, Datum)', x, y + 4);
  }
  y += 20;

  for (let i = 0; i < zeilen; i++) {
    y = layout.umbruchPruefen(y, 22);

    if (i < vermieterLinien) {
      linie(doc, ML, y, breite);
      beschriftung(
        doc,
        i === 0 ? 'Vermieter' : '',
        ML,
        y + 4,
        d.vermieter.vertretenDurch[i] ?? d.vermieter.firmenname
      );
    }
    if (i < d.mieter.length) {
      const m = d.mieter[i];
      const name = m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim();
      linie(doc, spalte2, y, breite);
      beschriftung(doc, i === 0 ? 'Mieter' : '', spalte2, y + 4, name);
    }
    y += 22;
  }

  return y;
}

function linie(doc: jsPDF, x: number, y: number, breite: number): void {
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + breite, y);
}

/** Rollenbezeichnung unter der Linie, darunter optional der Name. */
function beschriftung(
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

// ─── Anlagen ─────────────────────────────────────────────────────────────────

function anlageRendern(
  doc: jsPDF,
  layout: ReturnType<typeof createLayout>,
  anlage: Anlage,
  d: MietvertragDaten
): number {
  let y = 28;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(anlage.titel, ML, y);
  y += 5;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text(`${anlage.kennung} zum Mietvertrag`, ML, y);
  doc.setTextColor(...DARK);
  y += 9;

  if (anlage.vorspann) {
    y = layout.blocksatz(anlage.vorspann, y, { fontSize: 9 });
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
    // Dreispaltig wie in der Word-Vorlage: Datum, Vermieter, Mieter
    y = layout.umbruchPruefen(y + 12, 26);
    const spalten = [ML, ML + 58, ML + 116];
    const breiten = [50, 50, 50];
    const rollen = ['(Datum)', '(Vermieter)', '(Mieter)'];

    spalten.forEach((x, i) => {
      linie(doc, x, y, breiten[i]);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...DARK);
      doc.text(rollen[i], x, y + 4);
    });
    y += 14;
  }

  return y;
}
