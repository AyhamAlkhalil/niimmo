import { jsPDF } from 'jspdf';
import type { PdfImage } from './pdfImageUtils';
import { COMPANY } from '@/config/company';

export interface UebergabePdfData {
  isEinzug: boolean;
  uebergabeDatum: string;
  mieterName: string;
  
  immobilieName: string;
  immobilieAdresse: string;
  
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
    qm: number | null;
    zaehlerstaende: {
      strom: string;
      gas: string;
      wasser: string;
      warmwasser: string;
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

// Load logo as base64 - cached
let logoBase64Cache: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (logoBase64Cache) return logoBase64Cache;
  try {
    const response = await fetch('/nilimmo-logo.png');
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        logoBase64Cache = reader.result as string;
        resolve(logoBase64Cache);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateUebergabePdf(data: UebergabePdfData): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const marginLeft = 25;
  const marginRight = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const maxY = 252;
  
  const logo = await loadLogo();

  function checkPageBreak(currentY: number, neededSpace: number = 15): number {
    if (currentY + neededSpace > maxY) {
      addFooter(doc);
      doc.addPage();
      addContinuationHeader(doc, logo);
      return 50;
    }
    return currentY;
  }

  // ============ PAGE 1 HEADER ============
  addFirstPageHeader(doc, logo, marginLeft, pageWidth);

  // ============ SENDER LINE ============
  let y = 55;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  const senderLine = COMPANY.absenderzeile;
  doc.text(senderLine, marginLeft, y);
  const senderWidth = doc.getTextWidth(senderLine);
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.2);
  doc.line(marginLeft, y + 0.5, marginLeft + senderWidth, y + 0.5);

  // ============ TITLE ============
  y = 68;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  const title = data.isEinzug ? 'ÜBERGABEPROTOKOLL – EINZUG' : 'ÜBERGABEPROTOKOLL – AUSZUG';
  doc.text(title, marginLeft, y);
  y += 3;
  doc.setDrawColor(200, 30, 30);
  doc.setLineWidth(0.5);
  doc.line(marginLeft, y, marginLeft + 80, y);

  // ============ GENERAL INFO ============
  y += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);

  const infoRows = [
    ['Übergabedatum:', data.uebergabeDatum],
    ['Mieter:', data.mieterName],
    ['Objekt:', `${data.immobilieName}, ${data.immobilieAdresse}`],
  ];

  for (const [label, value] of infoRows) {
    doc.setFont('helvetica', 'bold');
    doc.text(label, marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, marginLeft + 35, y);
    y += 6;
  }

  // ============ SCHLÜSSELÜBERGABE ============
  y += 4;
  y = checkPageBreak(y, 25);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Übergebene Schlüssel', marginLeft, y);
  y += 7;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const schluesselItems = [
    ['Haustür:', data.schluessel.haustuer || '0'],
    ['Wohnung:', data.schluessel.wohnung || '0'],
    ['Briefkasten:', data.schluessel.briefkasten || '0'],
    ['Keller:', data.schluessel.keller || '0'],
  ];

  // Two columns
  for (let i = 0; i < schluesselItems.length; i += 2) {
    doc.setFont('helvetica', 'bold');
    doc.text(schluesselItems[i][0], marginLeft + 5, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${schluesselItems[i][1]} Stück`, marginLeft + 30, y);

    if (i + 1 < schluesselItems.length) {
      doc.setFont('helvetica', 'bold');
      doc.text(schluesselItems[i + 1][0], marginLeft + 80, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`${schluesselItems[i + 1][1]} Stück`, marginLeft + 105, y);
    }
    y += 6;
  }

  // ============ ZÄHLERSTÄNDE PER EINHEIT ============
  y += 6;
  for (const einheit of data.einheiten) {
    y = checkPageBreak(y, 40);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Zählerstände – ${einheit.name}${einheit.etage ? `, ${einheit.etage}` : ''}${einheit.qm ? ` (${einheit.qm} m²)` : ''}`, marginLeft, y);
    y += 3;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(einheit.adresse, marginLeft, y);
    doc.setTextColor(0, 0, 0);
    y += 7;

    // Table header
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(245, 245, 245);
    doc.rect(marginLeft, y - 4, contentWidth, 7, 'F');
    doc.text('Zählerart', marginLeft + 3, y);
    doc.text('Zählerstand', marginLeft + 70, y);
    doc.text('Einheit', marginLeft + 120, y);
    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(marginLeft, y, marginLeft + contentWidth, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    const readings = [
      ['Strom', einheit.zaehlerstaende.strom || '–', 'kWh'],
      ['Gas', einheit.zaehlerstaende.gas || '–', 'm³'],
      ['Kaltwasser', einheit.zaehlerstaende.wasser || '–', 'm³'],
      ['Warmwasser', einheit.zaehlerstaende.warmwasser || '–', 'm³'],
    ];

    for (const [type, value, unit] of readings) {
      doc.text(type, marginLeft + 3, y);
      doc.text(value, marginLeft + 70, y);
      doc.text(unit, marginLeft + 120, y);
      y += 5;
    }
    y += 5;

    // Zählerfotos einbetten falls vorhanden
    if (einheit.zaehlerfotos) {
      y = addZaehlerfotos(doc, einheit.zaehlerfotos, marginLeft, contentWidth, y, checkPageBreak);
    }
  }

  // ============ NOTIZEN ============
  const hatNotizText = Boolean(data.protokollNotizen && data.protokollNotizen.trim());
  const notizenFotos = data.notizenFotos ?? [];

  if (hatNotizText || notizenFotos.length > 0) {
    y = checkPageBreak(y, 25);
    y += 2;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Bemerkungen / Zustand', marginLeft, y);
    y += 7;

    if (hatNotizText) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(data.protokollNotizen, contentWidth);
      for (const line of lines) {
        y = checkPageBreak(y, 5);
        doc.text(line, marginLeft, y);
        y += 5;
      }
    }

    if (notizenFotos.length > 0) {
      y = addPhotoGrid(
        doc,
        notizenFotos.map((image) => ({ image })),
        'Fotos zum Zustand',
        marginLeft,
        contentWidth,
        y,
        checkPageBreak
      );
    }
  }

  // ============ UNTERSCHRIFTEN ============
  y += 10;
  y = checkPageBreak(y, 60);
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Unterschriften', marginLeft, y);
  y += 10;

  const sigWidth = 65;
  const sigHeight = 25;
  const leftSigX = marginLeft;
  const rightSigX = marginLeft + 85;

  // Vermieter signature
  if (data.vermieterSignature) {
    try {
      doc.addImage(data.vermieterSignature, 'PNG', leftSigX, y, sigWidth, sigHeight);
    } catch (e) {
      console.warn('Unterschrift des Vermieters konnte nicht ins PDF uebernommen werden:', e);
    }
  }

  // Mieter signature
  if (data.mieterSignature) {
    try {
      doc.addImage(data.mieterSignature, 'PNG', rightSigX, y, sigWidth, sigHeight);
    } catch (e) {
      console.warn('Unterschrift des Mieters konnte nicht ins PDF uebernommen werden:', e);
    }
  }

  y += sigHeight + 2;

  // Signature lines
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(leftSigX, y, leftSigX + sigWidth, y);
  doc.line(rightSigX, y, rightSigX + sigWidth, y);
  y += 5;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Vermieter / Bevollmächtigter', leftSigX, y);
  doc.text('Mieter', rightSigX, y);
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Datum: ${data.uebergabeDatum}`, leftSigX, y);
  doc.text(`Datum: ${data.uebergabeDatum}`, rightSigX, y);

  // ============ FOOTER ============
  addFooter(doc);

  return doc.output('blob');
}

function addZaehlerfotos(
  doc: jsPDF,
  zaehlerfotos: { strom?: PdfImage[]; gas?: PdfImage[]; wasser?: PdfImage[]; warmwasser?: PdfImage[] },
  marginLeft: number,
  contentWidth: number,
  y: number,
  checkPageBreak: (y: number, space?: number) => number
): number {
  const meterTypen: Array<{ key: keyof typeof zaehlerfotos; label: string }> = [
    { key: 'strom',      label: 'Strom'      },
    { key: 'gas',        label: 'Gas'        },
    { key: 'wasser',     label: 'Kaltwasser' },
    { key: 'warmwasser', label: 'Warmwasser' },
  ];

  // Alle vorhandenen Fotos mit Label sammeln
  const allPhotos: Array<{ label: string; image: PdfImage }> = [];
  for (const { key, label } of meterTypen) {
    for (const image of zaehlerfotos[key] ?? []) {
      if (image?.dataUrl) allPhotos.push({ label, image });
    }
  }

  return addPhotoGrid(doc, allPhotos, 'Zählerfotos', marginLeft, contentWidth, y, checkPageBreak);
}

/**
 * Bildgitter mit zwei Spalten. Die Fotos werden seitenverhältnistreu in ihre
 * Zelle eingepasst (contain) statt auf ein festes Querformat gestreckt —
 * sonst erscheinen Hochkantaufnahmen im PDF verzerrt bzw. gekippt.
 */
function addPhotoGrid(
  doc: jsPDF,
  photos: Array<{ label?: string; image: PdfImage }>,
  title: string,
  marginLeft: number,
  contentWidth: number,
  y: number,
  checkPageBreak: (y: number, space?: number) => number
): number {
  if (photos.length === 0) return y;

  const cols = 2;
  const gap = 4;
  const cellW = (contentWidth - gap * (cols - 1)) / cols; // ~78 mm
  const cellH = 62;                                       // hoch genug, dass Zählerstände lesbar bleiben
  const labelH = 5;
  const rowH = cellH + labelH + gap;

  // Abschnittstitel zusammen mit der ersten Bildzeile umbrechen, damit die
  // Überschrift nicht allein am Seitenende stehen bleibt
  y = checkPageBreak(y, rowH + 15);
  y += 3;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(title, marginLeft, y);
  y += 7;

  for (let i = 0; i < photos.length; i++) {
    const col = i % cols;

    // Neue Zeile → Seitenumbruch prüfen
    if (col === 0) {
      y = checkPageBreak(y, rowH + 5);
    }

    const x = marginLeft + col * (cellW + gap);
    const { label, image } = photos[i];

    // Seitenverhältnistreu in die Zelle einpassen und zentrieren
    const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 4 / 3;
    let drawW = cellW;
    let drawH = cellW / ratio;
    if (drawH > cellH) {
      drawH = cellH;
      drawW = cellH * ratio;
    }
    const drawX = x + (cellW - drawW) / 2;
    const drawY = y + (cellH - drawH) / 2;

    try {
      doc.addImage(image.dataUrl, 'JPEG', drawX, drawY, drawW, drawH);
    } catch {
      // Platzhalter-Box wenn Bild nicht eingebettet werden kann
      doc.setDrawColor(200, 200, 200);
      doc.setFillColor(245, 245, 245);
      doc.rect(x, y, cellW, cellH, 'FD');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text('Foto konnte nicht eingebettet werden', x + cellW / 2, y + cellH / 2, { align: 'center' });
    }

    if (label) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(label, x + cellW / 2, y + cellH + 3.5, { align: 'center' });
    }

    // Nach letztem Bild einer Zeile: Y weiterrücken
    if (col === cols - 1 || i === photos.length - 1) {
      y += rowH;
    }
  }

  doc.setTextColor(0, 0, 0);
  return y + 3;
}

function addFirstPageHeader(doc: jsPDF, logo: string | null, marginLeft: number, pageWidth: number) {
  if (logo) {
    const logoW = 30;
    const logoH = 36;
    const logoX = (pageWidth - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
  doc.setDrawColor(200, 30, 30);
  doc.setLineWidth(0.8);
  doc.line(marginLeft, 48, pageWidth - 25, 48);
}

function addContinuationHeader(doc: jsPDF, logo: string | null) {
  if (logo) {
    const logoW = 16;
    const logoH = 19;
    const logoX = (210 - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
}

function addFooter(doc: jsPDF) {
  const marginLeft = 25;
  const pageWidth = 210;
  const marginRight = 25;
  const footerY = 258;

  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, footerY, pageWidth - marginRight, footerY);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);

  let fy = footerY + 4;
  doc.setFont('helvetica', 'bold');
  doc.text('Vertretungsberechtigte Geschäftsführer:', marginLeft, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(COMPANY.geschaeftsfuehrer, marginLeft, fy);
  fy += 3;
  doc.setFont('helvetica', 'bold');
  doc.text('Registergericht:', marginLeft, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(`${COMPANY.register.gericht} ${COMPANY.register.abteilung}`, marginLeft, fy);
  fy += 3;
  doc.text(`Registernummer: ${COMPANY.register.nummer}`, marginLeft, fy);
  fy += 3;
  doc.setFont('helvetica', 'bold');
  doc.text('Gewerbeerlaubnis nach § 34 C GewO; Aufsichtsbehörde:', marginLeft, fy);
  doc.setFont('helvetica', 'normal');
  fy += 3;
  doc.text(COMPANY.gewerbeerlaubnis.aufsicht, marginLeft, fy);
  fy += 3;
  doc.text(`Steuer-Nummer: ${COMPANY.steuernummer}`, marginLeft, fy);

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
