import { jsPDF } from 'jspdf';
import { COMPANY } from '@/config/company';

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

export async function generateKuendigungPdf(data: KuendigungPdfData): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const marginLeft = 25;
  const marginRight = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const maxY = 240;
  
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

  function drawJustifiedText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
    const lines = doc.splitTextToSize(text, maxWidth);
    for (let i = 0; i < lines.length; i++) {
      y = checkPageBreak(y, lineHeight);
      if (i < lines.length - 1) {
        const words = lines[i].split(' ');
        if (words.length > 1) {
          const totalWordsWidth = words.reduce((sum: number, w: string) => sum + doc.getTextWidth(w), 0);
          const totalSpaceNeeded = maxWidth - totalWordsWidth;
          const spacePerGap = totalSpaceNeeded / (words.length - 1);
          let cx = x;
          for (let j = 0; j < words.length; j++) {
            doc.text(words[j], cx, y);
            cx += doc.getTextWidth(words[j]) + spacePerGap;
          }
        } else {
          doc.text(lines[i], x, y);
        }
      } else {
        doc.text(lines[i], x, y);
      }
      y += lineHeight;
    }
    return y;
  }

  // ============ PAGE 1 HEADER ============
  addFirstPageHeader(doc, logo, marginLeft, marginRight, pageWidth);
  
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
  
  // ============ RECIPIENT ============
  y = 63;
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(data.anrede, marginLeft, y);
  y += 6;
  doc.text(data.mieterName, marginLeft, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(data.mieterAdresse, marginLeft, y);
  y += 6;
  doc.text(data.mieterPlzOrt, marginLeft, y);
  
  // ============ CONTACT BOX ============
  const boxX = 128;
  const boxY = 56;
  const boxW = 57;
  const boxH = 32;
  
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(boxX, boxY, boxW, boxH);
  
  const contactX = boxX + 3;
  let contactY = boxY + 5;
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.text('Kontakt:', contactX, contactY);
  contactY += 5;
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(7);
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
  y = 105;
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  const dateText = `Sehnde, ${data.datum}`;
  const dateWidth = doc.getTextWidth(dateText);
  doc.text(dateText, pageWidth - marginRight - dateWidth, y);
  
  // ============ SEPARATOR ============
  y = 113;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.15);
  doc.line(marginLeft, y, marginLeft + 8, y);
  
  // ============ SUBJECT ============
  y = 120;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  const subjectLine1 = `MV – ${data.immobilieAdresse}, ${data.einheitBezeichnung}`;
  doc.text(subjectLine1, marginLeft, y);
  y += 6;
  const typ = data.kuendigungstyp || 'ordentlich';
  const subjectLine2 = typ === 'ausserordentlich_fristlos'
    ? 'Außerordentliche fristlose Kündigung des Mietvertrages'
    : typ === 'ausserordentlich_mit_frist'
      ? 'Außerordentliche Kündigung des Mietvertrages'
      : 'Kündigung des Mietvertrages';
  doc.text(subjectLine2, marginLeft, y);
  
  // ============ BODY TEXT ============
  y += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const salutation = `Sehr geehrte/r ${data.anrede} ${data.mieterNachname},`;
  doc.text(salutation, marginLeft, y);
  y += 8;
  
  const lineHeight = 5;
  
  if (data.freitext) {
    y = drawJustifiedText(data.freitext, marginLeft, y, contentWidth, lineHeight);
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

    y = drawJustifiedText(introText, marginLeft, y, contentWidth, lineHeight);
    y += 4;

    if (data.kuendigungsgrund) {
      const grundText = `Grund der Kündigung: ${data.kuendigungsgrund}`;
      y = drawJustifiedText(grundText, marginLeft, y, contentWidth, lineHeight);
      y += 4;
    }

    if (typ === 'ausserordentlich_fristlos') {
      const fristlosText = `Wir fordern Sie auf, die Wohnung unverzüglich, spätestens jedoch bis zum ${data.auszugsdatum}, zu räumen und in ordnungsgemäßem Zustand zu übergeben.`;
      y = drawJustifiedText(fristlosText, marginLeft, y, contentWidth, lineHeight);
      y += 4;

      const widerspruchText = 'Der Kündigung kann gemäß § 574 BGB innerhalb von zwei Monaten vor Beendigung des Mietverhältnisses schriftlich widersprochen werden, sofern die Beendigung eine unzumutbare Härte darstellen würde.';
      y = drawJustifiedText(widerspruchText, marginLeft, y, contentWidth, lineHeight);
      y += 4;
    } else {
      const auszugText = `Wir bitten Sie, die Wohnung bis zum ${data.auszugsdatum} geräumt und in ordnungsgemäßem Zustand zu übergeben. Bitte vereinbaren Sie rechtzeitig einen Übergabetermin mit uns.`;
      y = drawJustifiedText(auszugText, marginLeft, y, contentWidth, lineHeight);
      y += 4;
    }

    const kautionText = 'Die Abrechnung der Mietkaution erfolgt nach Beendigung des Mietverhältnisses und Prüfung des Wohnungszustandes gemäß den gesetzlichen Bestimmungen.';
    y = drawJustifiedText(kautionText, marginLeft, y, contentWidth, lineHeight);
    y += 4;

    const zaehlerText = 'Wir bitten Sie, am Tag der Übergabe alle Zählerstände (Strom, Gas, Wasser) abzulesen und uns mitzuteilen. Bitte kündigen Sie eigenständig Ihre Versorgungsverträge (Strom, Gas, Internet, etc.) zum Auszugsdatum.';
    y = drawJustifiedText(zaehlerText, marginLeft, y, contentWidth, lineHeight);
    y += 4;
  }
  
  if (data.bemerkungen) {
    y = checkPageBreak(y, 15);
    const bemerkText = `Ergänzende Hinweise: ${data.bemerkungen}`;
    y = drawJustifiedText(bemerkText, marginLeft, y, contentWidth, lineHeight);
    y += 4;
  }

  // Contact closing
  y = checkPageBreak(y, lineHeight + 6);
  doc.text('Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.', marginLeft, y);
  y += 8;
  
  // ============ SIGNATURE ============
  y = checkPageBreak(y, 25);
  doc.text('Mit freundlichem Gruß', marginLeft, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.text('Dennis Mikyas', marginLeft, y);
  y += 5;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('Geschäftsführer', marginLeft, y);
  
  // ============ FOOTER ============
  addFooter(doc);
  
  return doc.output('blob');
}

function addFirstPageHeader(doc: jsPDF, logo: string | null, marginLeft: number, _marginRight: number, pageWidth: number) {
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
