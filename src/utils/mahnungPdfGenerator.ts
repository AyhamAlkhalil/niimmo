import { jsPDF } from 'jspdf';
import { COMPANY } from '@/config/company';

export interface MahnungPdfData {
  // Empfänger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  mieterAdresse: string;
  mieterPlzOrt: string;
  
  // Vertrag
  einheitBezeichnung: string;
  immobilieAdresse: string;
  vertragStart: string;
  
  // Mahnung
  mahnstufe: number;
  datum: string;
  
  // Forderungen
  offeneForderungen: Array<{
    monat: string;
    betrag: number;
  }>;
  gesamtRueckstand: number;
  anzahlMonatsmieten: number;
  
  // Kosten
  verzugszinsenDetails: Array<{
    monat: string;
    betrag: number;
    laufend?: boolean;
  }>;
  verzugszinsenGesamt: number;
  mahnkostenProSchreiben: number;
  anzahlMahnschreiben: number;
  mahnkostenGesamt: number;
  
  // Zahlungsfrist
  zahlungsfristDatum: string;
  raeumungsfristDatum?: string;
  uebergabeDatum?: string;

  // Freitext
  freitext?: string;
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

export async function generateMahnungPdf(data: MahnungPdfData): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const marginLeft = 25;
  const marginRight = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const maxY = 240; // page break threshold (leave generous room for footer at y=258)
  
  const logo = await loadLogo();

  // Helper: check if we need a page break and add one if so
  function checkPageBreak(currentY: number, neededSpace: number = 15): number {
    if (currentY + neededSpace > maxY) {
      addFooter(doc);
      doc.addPage();
      addContinuationHeader(doc, logo);
      return 50; // resume Y after small header on continuation pages
    }
    return currentY;
  }

  // Helper: draw justified text
  function drawJustifiedText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
    const lines = doc.splitTextToSize(text, maxWidth);
    for (let i = 0; i < lines.length; i++) {
      y = checkPageBreak(y, lineHeight);
      // Justify all lines except the last one of each paragraph
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

  // ============ PAGE 1 HEADER (large logo, centered) ============
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
  
  // ============ CONTACT BOX (right side, with border) ============
  const boxX = 128;
  const boxY = 56;
  const boxW = 57;
  const boxH = 32;
  
  // Draw box border
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
  // Phone + number
  doc.text('Tel.', contactX, contactY);
  doc.text(COMPANY.ansprechpartner.telefon, contactX + 8, contactY);
  contactY += 4;
  // Fax + number
  doc.text('Fax', contactX, contactY);
  doc.text(COMPANY.ansprechpartner.fax, contactX + 8, contactY);
  contactY += 4;
  // Address
  doc.text(`${COMPANY.strasse}, ${COMPANY.plzOrt}`, contactX + 8, contactY);
  contactY += 4;
  // Email
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
  
  // ============ SHORT LINE SEPARATOR BEFORE SUBJECT ============
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
  
  let subjectLine2: string;
  if (data.mahnstufe >= 3) {
    subjectLine2 = 'Mahnung und fristlose Kündigung des Mietvertrages wegen Zahlungsverzuges';
  } else if (data.mahnstufe === 2) {
    subjectLine2 = '2. Mahnung wegen Zahlungsverzuges';
  } else {
    subjectLine2 = 'Zahlungserinnerung / 1. Mahnung';
  }
  doc.text(subjectLine2, marginLeft, y);
  
  // ============ BODY TEXT ============
  y += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const salutation = `Sehr geehrter ${data.anrede} ${data.mieterNachname},`;
  doc.text(salutation, marginLeft, y);
  y += 8;
  
  const lineHeight = 5;
  
  if (data.freitext) {
    y = drawJustifiedText(data.freitext, marginLeft, y, contentWidth, lineHeight);
    y += 4;
  } else {
    let bodyText: string;
    
    if (data.mahnstufe >= 3) {
      bodyText = `Sie haben seit Beginn des Mietverhältnisses am ${data.vertragStart} Ihre Mietzahlungen wiederholt verspätet und unregelmäßig erbracht. Trotz meiner Mahnung sind die Mietrückstände nicht ausgeglichen worden.\nDer Mietrückstand beläuft sich inzwischen auf ${data.anzahlMonatsmieten} Monatsmieten in Höhe von insgesamt ${formatEuro(data.gesamtRueckstand)} €. Damit befinden Sie sich im erheblichen Zahlungsverzug im Sinne der §§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB.`;
    } else if (data.mahnstufe === 2) {
      bodyText = `trotz unserer ersten Mahnung sind die folgenden Zahlungen weiterhin nicht bei uns eingegangen. Wir fordern Sie hiermit erneut zur Zahlung auf.\nDer Mietrückstand beläuft sich auf insgesamt ${formatEuro(data.gesamtRueckstand)} €.`;
    } else {
      bodyText = `wir möchten Sie darauf hinweisen, dass folgende Mietzahlungen noch nicht bei uns eingegangen sind:\nDer Mietrückstand beläuft sich auf insgesamt ${formatEuro(data.gesamtRueckstand)} €.`;
    }
    
    const paragraphs = bodyText.split('\n');
    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        y += 3;
        continue;
      }
      y = drawJustifiedText(paragraph, marginLeft, y, contentWidth, lineHeight);
      y += 2;
    }
    y += 2;
  }
  
  // ============ VERZUGSZINSEN ============
  if (data.verzugszinsenDetails.length > 0) {
    y = checkPageBreak(y, 20);
    y += 2;
    const zinsenIntro = 'Zusätzlich schulden Sie für die nicht bzw. verspätet gezahlten Mieten Verzugszinsen nach § 288 BGB. Bis zum heutigen Tage belaufen sich diese auf:';
    y = drawJustifiedText(zinsenIntro, marginLeft, y, contentWidth, lineHeight);
    y += 3;
    
    for (const detail of data.verzugszinsenDetails) {
      y = checkPageBreak(y, lineHeight);
      const line = detail.laufend
        ? `${detail.monat}: ab ${data.datum} weiter laufend`
        : `${detail.monat}: ${formatEuro(detail.betrag)} €`;
      doc.text(line, marginLeft, y);
      y += lineHeight;
    }
    
    // Zwischensumme on same line flow
    y = checkPageBreak(y, lineHeight);
    doc.text(`Zwischensumme Verzugszinsen: ${formatEuro(data.verzugszinsenGesamt)} € (zuzüglich weiterer Zinsen bis zur vollständigen Zahlung).`, marginLeft, y);
    y += lineHeight;
  }
  
  // Mahnkosten
  if (data.mahnkostenGesamt > 0) {
    y = checkPageBreak(y, lineHeight + 2);
    const mahnkostenText = `Weiterhin entstehen Mahnkosten i. H. v. ${formatEuro(data.mahnkostenProSchreiben)} € pro Mahnschreiben, somit ${formatEuro(data.mahnkostenGesamt)} €.`;
    y = drawJustifiedText(mahnkostenText, marginLeft, y, contentWidth, lineHeight);
    y += 4;
  }
  
  // ============ KÜNDIGUNG (Stufe 3) ============
  if (data.mahnstufe >= 3) {
    y = checkPageBreak(y, 20);
    const kuendigungText = `Hiermit kündige ich daher das bestehende Mietverhältnis über die Wohnung in der ${data.immobilieAdresse}, ${data.einheitBezeichnung} außerordentlich fristlos. Wir fordern Sie auf die Wohnung unverzüglich, spätestens jedoch bis zum ${data.raeumungsfristDatum || data.zahlungsfristDatum} zu räumen.`;
    y = drawJustifiedText(kuendigungText, marginLeft, y, contentWidth, lineHeight);
    y += 4;

    if (data.uebergabeDatum) {
      y = checkPageBreak(y, 15);
      const uebergabeText = `Die Wohnungsübergabe findet am ${data.uebergabeDatum} statt. Bitte stellen Sie sicher, dass die Wohnung zu diesem Zeitpunkt vollständig geräumt und besenrein übergeben wird.`;
      y = drawJustifiedText(uebergabeText, marginLeft, y, contentWidth, lineHeight);
      y += 4;
    }

    y = checkPageBreak(y, 20);
    const fristText = `Unabhängig hiervon setze ich Ihnen – ohne Anerkennung einer Rechtspflicht – eine Frist von 7 Kalendertagen, spätestens bis zum ${data.zahlungsfristDatum}, um sämtliche Mietrückstände nebst Zinsen vollständig auszugleichen. Sollten Sie die Rückstände nicht innerhalb dieser Frist begleichen, werde ich die fristlose Kündigung vollumfänglich durchsetzen und Räumungsklage erheben.`;
    y = drawJustifiedText(fristText, marginLeft, y, contentWidth, lineHeight);
    y += 4;
  } else {
    y = checkPageBreak(y, 15);
    const zahlungsText = `Wir bitten Sie, den Gesamtbetrag bis zum ${data.zahlungsfristDatum} auf unser Konto zu überweisen.`;
    y = drawJustifiedText(zahlungsText, marginLeft, y, contentWidth, lineHeight);
    y += 4;

    if (data.uebergabeDatum) {
      y = checkPageBreak(y, 15);
      const uebergabeText = `Die Wohnungsübergabe findet am ${data.uebergabeDatum} statt. Bitte stellen Sie sicher, dass die Wohnung zu diesem Zeitpunkt vollständig geräumt und besenrein übergeben wird.`;
      y = drawJustifiedText(uebergabeText, marginLeft, y, contentWidth, lineHeight);
      y += 4;
    }

    if (data.mahnstufe === 2) {
      y = checkPageBreak(y, lineHeight + 4);
      doc.text('Bei ausbleibender Zahlung behalten wir uns rechtliche Schritte vor.', marginLeft, y);
      y += lineHeight + 4;
    }
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
  
  // ============ FOOTER (last page) ============
  addFooter(doc);
  
  return doc.output('blob');
}

// First page header: large centered logo + red separator
function addFirstPageHeader(doc: jsPDF, logo: string | null, marginLeft: number, _marginRight: number, pageWidth: number) {
  if (logo) {
    // Logo is roughly square (horse + NiImmo Gruppe text)
    // Keep proportional: ~30mm wide, ~36mm tall, centered
    const logoW = 30;
    const logoH = 36;
    const logoX = (pageWidth - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
  // Red separator line
  doc.setDrawColor(200, 30, 30);
  doc.setLineWidth(0.8);
  doc.line(marginLeft, 48, pageWidth - 25, 48);
}

// Continuation page header: small centered logo, no red line
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
  
  // Separator line
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, footerY, pageWidth - marginRight, footerY);
  
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  
  let fy = footerY + 4;
  
  // Left column
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
  
  // Right column
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

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
