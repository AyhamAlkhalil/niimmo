import { jsPDF } from 'jspdf';
import { COMPANY } from '@/config/company';

export interface MieterhoehungPdfData {
  // Empfänger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  mieterAdresse: string;
  mieterPlzOrt: string;
  
  // Objekt
  immobilieName: string;
  immobilieAdresse: string;
  einheitBezeichnung: string;
  
  // Mietdaten
  aktuelleKaltmiete: number;
  aktuelleBetriebskosten: number;
  neueKaltmiete: number;
  neueBetriebskosten: number;
  
  // Datum
  datum: string;
  wirksamDatum: string;
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

export async function generateMieterhoehungPdf(data: MieterhoehungPdfData): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const marginLeft = 25;
  const marginRight = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  
  const logo = await loadLogo();

  // Helper: draw justified text
  function drawJustifiedText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
    const lines = doc.splitTextToSize(text, maxWidth);
    for (let i = 0; i < lines.length; i++) {
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
  if (logo) {
    const logoW = 30;
    const logoH = 36;
    const logoX = (pageWidth - logoW) / 2;
    doc.addImage(logo, 'PNG', logoX, 6, logoW, logoH);
  }
  // Red separator line
  doc.setDrawColor(200, 30, 30);
  doc.setLineWidth(0.8);
  doc.line(marginLeft, 48, pageWidth - marginRight, 48);
  
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
  doc.text('Mieterhöhung gemäß § 558 BGB', marginLeft, y);
  
  // ============ BODY TEXT ============
  y += 12;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const salutation = `Sehr geehrter ${data.anrede} ${data.mieterNachname},`;
  doc.text(salutation, marginLeft, y);
  y += 8;
  
  const lineHeight = 5;
  
  const introText = `hiermit erhöhen wir die Miete für die von Ihnen gemietete Wohnung in ${data.immobilieName}, ${data.immobilieAdresse}, ${data.einheitBezeichnung}, zum ${data.wirksamDatum}.`;
  y = drawJustifiedText(introText, marginLeft, y, contentWidth, lineHeight);
  y += 3;
  
  doc.text('Die Mieterhöhung stellt sich wie folgt dar:', marginLeft, y);
  y += 8;
  
  // ============ TABLE ============
  const aktuelleGesamtmiete = data.aktuelleKaltmiete + data.aktuelleBetriebskosten;
  const neueGesamtmiete = data.neueKaltmiete + data.neueBetriebskosten;
  const erhoehung = neueGesamtmiete - aktuelleGesamtmiete;
  const erhoehungProzent = aktuelleGesamtmiete > 0 ? ((erhoehung / aktuelleGesamtmiete) * 100) : 0;
  
  const colX = [marginLeft, marginLeft + 55, marginLeft + 90, marginLeft + 125];
  const tableWidth = contentWidth;
  
  // Header row
  doc.setFillColor(240, 240, 240);
  doc.rect(marginLeft, y - 4, tableWidth, 7, 'F');
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(marginLeft, y - 4, tableWidth, 7);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Position', colX[0] + 2, y);
  doc.text('Aktuell', colX[1] + 2, y);
  doc.text('Neu', colX[2] + 2, y);
  doc.text('Differenz', colX[3] + 2, y);
  y += 7;
  
  // Kaltmiete row
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(200, 200, 200);
  doc.rect(marginLeft, y - 4, tableWidth, 7);
  doc.text('Kaltmiete', colX[0] + 2, y);
  doc.text(`${formatEuro(data.aktuelleKaltmiete)} €`, colX[1] + 2, y);
  doc.text(`${formatEuro(data.neueKaltmiete)} €`, colX[2] + 2, y);
  doc.text(`${formatEuro(data.neueKaltmiete - data.aktuelleKaltmiete)} €`, colX[3] + 2, y);
  y += 7;
  
  // Betriebskosten row
  doc.rect(marginLeft, y - 4, tableWidth, 7);
  doc.text('Betriebskosten', colX[0] + 2, y);
  doc.text(`${formatEuro(data.aktuelleBetriebskosten)} €`, colX[1] + 2, y);
  doc.text(`${formatEuro(data.neueBetriebskosten)} €`, colX[2] + 2, y);
  doc.text(`${formatEuro(data.neueBetriebskosten - data.aktuelleBetriebskosten)} €`, colX[3] + 2, y);
  y += 7;
  
  // Gesamtmiete row
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(245, 245, 245);
  doc.rect(marginLeft, y - 4, tableWidth, 7, 'FD');
  doc.text('Gesamtmiete', colX[0] + 2, y);
  doc.text(`${formatEuro(aktuelleGesamtmiete)} €`, colX[1] + 2, y);
  doc.text(`${formatEuro(neueGesamtmiete)} €`, colX[2] + 2, y);
  doc.text(`${formatEuro(erhoehung)} €`, colX[3] + 2, y);
  y += 7;
  
  // Percentage row
  doc.setFillColor(255, 248, 220);
  doc.rect(marginLeft, y - 4, tableWidth, 7, 'FD');
  doc.text('Erhöhung in %', colX[0] + 2, y);
  doc.text(`${erhoehungProzent.toFixed(2)}%`, colX[3] + 2, y);
  y += 12;
  
  // ============ CONTINUATION TEXT ============
  const maxY = 240; // Leave space for footer (footer at 258)
  
  const checkPageBreak = (needed: number) => {
    if (y + needed > maxY) {
      addFooter(doc);
      doc.addPage();
      y = 30;
    }
  };
  
  doc.setFont('helvetica', 'normal');
  
  checkPageBreak(20);
  const continuationText = `Die erhöhte Miete wird zum ${data.wirksamDatum} fällig. Wir bitten Sie, Ihre Zahlungen entsprechend anzupassen.`;
  y = drawJustifiedText(continuationText, marginLeft, y, contentWidth, lineHeight);
  y += 4;
  
  checkPageBreak(25);
  const legalText = 'Gemäß § 558b BGB haben Sie das Recht, der Mieterhöhung bis zum Ende des zweiten Kalendermonats nach dem Zugang dieses Erhöhungsverlangens zu widersprechen. Sofern Sie nicht widersprechen, gilt Ihre Zustimmung als erteilt.';
  y = drawJustifiedText(legalText, marginLeft, y, contentWidth, lineHeight);
  y += 4;
  
  checkPageBreak(10);
  doc.text('Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.', marginLeft, y);
  y += 8;
  
  // ============ SIGNATURE ============
  checkPageBreak(25);
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

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
