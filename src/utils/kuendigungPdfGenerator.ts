import { jsPDF } from 'jspdf';
import { COMPANY } from '@/config/company';
import { loadLogo } from './pdf/briefLayout';
import {
  anschriftZeile,
  briefanrede,
  bestaetigungsAbsaetze,
  type BestaetigungsDaten,
} from './kuendigungsbestaetigung';

export type KuendigungsTyp = 'ordentlich' | 'ausserordentlich_fristlos' | 'ausserordentlich_mit_frist';

export interface KuendigungPdfData {
  // Empfaenger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  mieterAdresse: string;
  mieterPlzOrt: string;

  // Vertrag
  einheitBezeichnung: string;
  immobilieAdresse: string;
  vertragStart: string;

  // Kuendigung
  kuendigungsdatum: string;
  kuendigungsgrund: string;
  kuendigungstyp: KuendigungsTyp;
  datum: string;

  // Fristen
  auszugsdatum: string;

  // Freitext
  freitext?: string;

  // Bemerkungen
  bemerkungen?: string;
}

const PAGE_WIDTH = 210;
const MARGIN_LEFT = 25;
const MARGIN_RIGHT = 25;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const MAX_Y = 240;
const LINE_HEIGHT = 5;
/**
 * Rückfragenhinweis, Gruß und Unterschrift (27 mm) bleiben zusammen und dürfen
 * bis kurz über die Fußzeile (258 mm) reichen. Mit MAX_Y wanderte die
 * Unterschrift schon bei einer knapp vollen Seite allein auf eine Folgeseite.
 */
const SCHLUSSBLOCK = 27;
const SCHLUSS_MAX_Y = 252;

interface Briefkopf {
  empfaenger: { text: string; fett?: boolean }[];
  /** TT.MM.JJJJ */
  datum: string;
  betreff: string[];
}

interface Brief {
  doc: jsPDF;
  /** Y-Position der ersten Textzeile unter dem Betreff. */
  startY: number;
  umbruch(y: number, benoetigt?: number): number;
  blocksatz(text: string, y: number): number;
  /** Rückfragenhinweis, Gruß, Unterschrift und Fußzeile; liefert das PDF. */
  abschliessen(y: number): Blob;
}

/**
 * Briefrahmen für Kündigung und Kündigungsbestätigung. Bis zum 16.09.2026 stand
 * er nur im Kündigungsschreiben; die Bestätigung sollte keine zweite Kopie werden.
 */
async function briefBeginnen(kopf: Briefkopf): Promise<Brief> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const logo = await loadLogo();

  function textschrift(): void {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
  }

  function neueSeite(): number {
    addFooter(doc);
    doc.addPage();
    addContinuationHeader(doc, logo);
    // Die Fußzeile hinterlässt 6 pt in Grau — ohne Zurücksetzen lief der
    // Brieftext auf der Folgeseite in dieser Schrift weiter.
    textschrift();
    return 50;
  }

  function umbruch(y: number, benoetigt = 15): number {
    return y + benoetigt > MAX_Y ? neueSeite() : y;
  }

  function blocksatz(text: string, y: number): number {
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH);
    for (let i = 0; i < lines.length; i++) {
      y = umbruch(y, LINE_HEIGHT);
      if (i < lines.length - 1) {
        const words = lines[i].split(' ');
        if (words.length > 1) {
          const totalWordsWidth = words.reduce((sum: number, w: string) => sum + doc.getTextWidth(w), 0);
          const spacePerGap = (CONTENT_WIDTH - totalWordsWidth) / (words.length - 1);
          let cx = MARGIN_LEFT;
          for (let j = 0; j < words.length; j++) {
            doc.text(words[j], cx, y);
            cx += doc.getTextWidth(words[j]) + spacePerGap;
          }
        } else {
          doc.text(lines[i], MARGIN_LEFT, y);
        }
      } else {
        doc.text(lines[i], MARGIN_LEFT, y);
      }
      y += LINE_HEIGHT;
    }
    return y;
  }

  // ============ PAGE 1 HEADER ============
  addFirstPageHeader(doc, logo);

  // ============ SENDER LINE ============
  let y = 55;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  const senderLine = COMPANY.absenderzeile;
  doc.text(senderLine, MARGIN_LEFT, y);
  const senderWidth = doc.getTextWidth(senderLine);
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_LEFT, y + 0.5, MARGIN_LEFT + senderWidth, y + 0.5);

  // ============ RECIPIENT ============
  y = 63;
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  for (const zeile of kopf.empfaenger) {
    doc.setFont('helvetica', zeile.fett ? 'bold' : 'normal');
    doc.text(zeile.text, MARGIN_LEFT, y);
    y += 6;
  }

  // ============ CONTACT BOX ============
  const boxX = 128;
  const boxY = 56;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(boxX, boxY, 57, 32);

  const contactX = boxX + 3;
  let contactY = boxY + 5;
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.text('Kontakt:', contactX, contactY);
  contactY += 5;
  doc.setTextColor(80, 80, 80);
  doc.text('Tel.', contactX, contactY);
  doc.text(COMPANY.ansprechpartner.telefon, contactX + 8, contactY);
  contactY += 4;
  doc.text('Fax', contactX, contactY);
  doc.text(COMPANY.ansprechpartner.fax, contactX + 8, contactY);
  contactY += 4;
  doc.text(`${COMPANY.strasse}, ${COMPANY.plzOrt}`, contactX + 8, contactY);
  contactY += 4;
  doc.text('E-Mail', contactX, contactY);
  doc.text(COMPANY.email, contactX + 12, contactY);

  // ============ DATE ============
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  const dateText = `${COMPANY.ort}, ${kopf.datum}`;
  doc.text(dateText, PAGE_WIDTH - MARGIN_RIGHT - doc.getTextWidth(dateText), 105);

  // ============ SEPARATOR ============
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.15);
  doc.line(MARGIN_LEFT, 113, MARGIN_LEFT + 8, 113);

  // ============ SUBJECT ============
  y = 120;
  doc.setFont('helvetica', 'bold');
  kopf.betreff.forEach((zeile, i) => {
    if (i > 0) y += 6;
    doc.text(zeile, MARGIN_LEFT, y);
  });

  textschrift();

  function abschliessen(y: number): Blob {
    if (y + SCHLUSSBLOCK > SCHLUSS_MAX_Y) y = neueSeite();
    doc.text('Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.', MARGIN_LEFT, y);
    y += 8;

    // ============ SIGNATURE ============
    doc.text('Mit freundlichem Gruß', MARGIN_LEFT, y);
    y += 14;
    doc.setFont('helvetica', 'bold');
    doc.text(COMPANY.ansprechpartner.unterschrift, MARGIN_LEFT, y);
    y += 5;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(COMPANY.ansprechpartner.funktion, MARGIN_LEFT, y);

    addFooter(doc);
    return doc.output('blob');
  }

  return { doc, startY: y + 12, umbruch, blocksatz, abschliessen };
}

export async function generateKuendigungPdf(data: KuendigungPdfData): Promise<Blob> {
  const typ = data.kuendigungstyp || 'ordentlich';
  const brief = await briefBeginnen({
    empfaenger: [
      { text: data.anrede, fett: true },
      { text: data.mieterName, fett: true },
      { text: data.mieterAdresse },
      { text: data.mieterPlzOrt },
    ],
    datum: data.datum,
    betreff: [
      `MV – ${data.immobilieAdresse}, ${data.einheitBezeichnung}`,
      typ === 'ausserordentlich_fristlos'
        ? 'Außerordentliche fristlose Kündigung des Mietvertrages'
        : typ === 'ausserordentlich_mit_frist'
          ? 'Außerordentliche Kündigung des Mietvertrages'
          : 'Kündigung des Mietvertrages',
    ],
  });
  const { doc, umbruch, blocksatz } = brief;

  // ============ BODY TEXT ============
  let y = brief.startY;
  doc.text(`Sehr geehrte/r ${data.anrede} ${data.mieterNachname},`, MARGIN_LEFT, y);
  y += 8;

  if (data.freitext) {
    y = blocksatz(data.freitext, y);
    y += 4;
  } else {
    // Standardtext je nach Kuendigungstyp
    let introText: string;

    if (typ === 'ausserordentlich_fristlos') {
      introText = `hiermit kündigen wir das bestehende Mietverhältnis über die Wohnung in der ${data.immobilieAdresse}, ${data.einheitBezeichnung}, begründet durch den Mietvertrag vom ${data.vertragStart}, außerordentlich fristlos.`;
    } else if (typ === 'ausserordentlich_mit_frist') {
      introText = `hiermit kündigen wir das bestehende Mietverhältnis über die Wohnung in der ${data.immobilieAdresse}, ${data.einheitBezeichnung}, begründet durch den Mietvertrag vom ${data.vertragStart}, außerordentlich zum ${data.kuendigungsdatum}.`;
    } else {
      introText = `hiermit kündigen wir das bestehende Mietverhältnis über die Wohnung in der ${data.immobilieAdresse}, ${data.einheitBezeichnung}, begründet durch den Mietvertrag vom ${data.vertragStart}, ordentlich zum ${data.kuendigungsdatum}.`;
    }

    y = blocksatz(introText, y);
    y += 4;

    if (data.kuendigungsgrund) {
      y = blocksatz(`Grund der Kündigung: ${data.kuendigungsgrund}`, y);
      y += 4;
    }

    if (typ === 'ausserordentlich_fristlos') {
      y = blocksatz(`Wir fordern Sie auf, die Wohnung unverzüglich, spätestens jedoch bis zum ${data.auszugsdatum}, zu räumen und in ordnungsgemäßem Zustand zu übergeben.`, y);
      y += 4;

      y = blocksatz('Der Kündigung kann gemäß § 574 BGB innerhalb von zwei Monaten vor Beendigung des Mietverhältnisses schriftlich widersprochen werden, sofern die Beendigung eine unzumutbare Härte darstellen würde.', y);
      y += 4;
    } else {
      y = blocksatz(`Wir bitten Sie, die Wohnung bis zum ${data.auszugsdatum} geräumt und in ordnungsgemäßem Zustand zu übergeben. Bitte vereinbaren Sie rechtzeitig einen Übergabetermin mit uns.`, y);
      y += 4;
    }

    y = blocksatz('Die Abrechnung der Mietkaution erfolgt nach Beendigung des Mietverhältnisses und Prüfung des Wohnungszustandes gemäß den gesetzlichen Bestimmungen.', y);
    y += 4;

    y = blocksatz('Wir bitten Sie, am Tag der Übergabe alle Zählerstände (Strom, Gas, Wasser) abzulesen und uns mitzuteilen. Bitte kündigen Sie eigenständig Ihre Versorgungsverträge (Strom, Gas, Internet, etc.) zum Auszugsdatum.', y);
    y += 4;
  }

  if (data.bemerkungen) {
    y = umbruch(y, 15);
    y = blocksatz(`Ergänzende Hinweise: ${data.bemerkungen}`, y);
    y += 4;
  }

  return brief.abschliessen(y);
}

/**
 * Bestätigung einer Kündigung durch den Mieter. Text aus
 * `kuendigungsbestaetigung.ts`, Layout wie das Kündigungsschreiben.
 */
export async function generateKuendigungsbestaetigungPdf(data: BestaetigungsDaten): Promise<Blob> {
  const [jahr, monat, tag] = data.datum.slice(0, 10).split('-');
  const brief = await briefBeginnen({
    empfaenger: [
      ...data.mieter.map(m => ({ text: anschriftZeile(m), fett: true })),
      { text: data.strasse },
      { text: data.plzOrt },
    ],
    datum: `${tag}.${monat}.${jahr}`,
    betreff: [
      `MV – ${[data.immobilieAdresse, data.einheitBezeichnung].map(t => t.trim()).filter(Boolean).join(', ')}`,
      'Bestätigung Ihrer Kündigung',
    ],
  });

  let y = brief.startY;
  brief.doc.text(briefanrede(data.mieter), MARGIN_LEFT, y);
  y += 8;

  // 3 statt 4 mm Absatzabstand: Mit einem ergänzenden Hinweis rutschte der
  // Schlussblock sonst allein auf eine zweite Seite.
  for (const absatz of bestaetigungsAbsaetze(data)) {
    y = brief.blocksatz(absatz, y);
    y += 3;
  }

  return brief.abschliessen(y);
}

function addFirstPageHeader(doc: jsPDF, logo: string | null) {
  if (logo) {
    const logoW = 30;
    const logoH = 36;
    const logoX = (PAGE_WIDTH - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
  doc.setDrawColor(200, 30, 30);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_LEFT, 48, PAGE_WIDTH - MARGIN_RIGHT, 48);
}

function addContinuationHeader(doc: jsPDF, logo: string | null) {
  if (logo) {
    const logoW = 16;
    const logoH = 19;
    const logoX = (PAGE_WIDTH - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
}

function addFooter(doc: jsPDF) {
  const footerY = 258;

  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT, footerY, PAGE_WIDTH - MARGIN_RIGHT, footerY);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);

  let fy = footerY + 4;

  doc.setFont('helvetica', 'bold');
  doc.text('Vertretungsberechtigte Geschäftsführer:', MARGIN_LEFT, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(COMPANY.geschaeftsfuehrer, MARGIN_LEFT, fy);
  fy += 3;
  doc.setFont('helvetica', 'bold');
  doc.text('Registergericht:', MARGIN_LEFT, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(`${COMPANY.register.gericht} ${COMPANY.register.abteilung}`, MARGIN_LEFT, fy);
  fy += 3;
  doc.text(`Registernummer: ${COMPANY.register.nummer}`, MARGIN_LEFT, fy);
  fy += 3;
  doc.setFont('helvetica', 'bold');
  doc.text('Gewerbeerlaubnis nach § 34 C GewO; Aufsichtsbehörde:', MARGIN_LEFT, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(COMPANY.gewerbeerlaubnis.aufsicht, MARGIN_LEFT, fy);
  fy += 3;
  doc.text(`Steuer-Nummer: ${COMPANY.steuernummer}`, MARGIN_LEFT, fy);

  const rightCol = 130;
  let rfy = footerY + 4;
  doc.setFont('helvetica', 'bold');
  doc.text('Mitglied in:', rightCol, rfy);
  doc.setFont('helvetica', 'normal');
  rfy += 3;
  doc.text('IHK Industrie- und Handelskammer', rightCol, rfy);
  rfy += 5;
  doc.text('Creditreform', rightCol, rfy);
}
