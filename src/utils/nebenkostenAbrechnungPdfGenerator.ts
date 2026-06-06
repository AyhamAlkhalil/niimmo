import { jsPDF } from 'jspdf';

export interface NebenkostenKostenDetail {
  kategorieName: string;
  gesamtKosten: number;
  verteilerschluessel: string;
  anteilProzent: number;
  anteilBetrag: number;
}

export interface NebenkostenAbrechnungPdfData {
  immobilieAdresse: string;
  einheitBezeichnung: string;
  qm: number;
  anzahlPersonen: number;
  mieterName: string;
  abrechnungsjahr: number;
  nutzungVon: string;
  nutzungBis: string;
  kostenDetails: NebenkostenKostenDetail[];
  monatlicheVorauszahlung: number;
  anzahlMonate: number;
  vorauszahlungenGesamt: number;
  kostenAnteilGesamt: number;
  saldo: number;
  abrechnungsDatum: string;
}

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

const SCHLUESSEL_LABELS: Record<string, string> = {
  qm: 'nach m²',
  personen: 'nach Personen',
  gleich: 'gleichmäßig',
  verbrauch: 'nach Verbrauch',
  individuell: 'individuell',
};

export async function generateNebenkostenAbrechnungPdf(
  data: NebenkostenAbrechnungPdfData
): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const marginLeft = 25;
  const marginRight = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const maxY = 262;

  const logo = await loadLogo();

  function checkPageBreak(currentY: number, needed = 15): number {
    if (currentY + needed > maxY) {
      doc.addPage();
      addFooter();
      return 20;
    }
    return currentY;
  }

  function addFooter() {
    const fy = 275;
    doc.setDrawColor(200, 200, 200);
    doc.line(marginLeft, fy, pageWidth - marginRight, fy);
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.setFont('helvetica', 'normal');
    doc.text('NiImmo Verwaltung GmbH', marginLeft, fy + 5);
    doc.text(data.immobilieAdresse, marginLeft, fy + 9);
    doc.text(`Erstellt am: ${data.abrechnungsDatum}`, pageWidth - marginRight, fy + 5, { align: 'right' });
    doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, pageWidth - marginRight, fy + 9, { align: 'right' });
  }

  let y = 18;

  // Logo
  if (logo) {
    doc.addImage(logo, 'PNG', marginLeft, y, 38, 12);
  }

  // Datum oben rechts
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.text(`Datum: ${data.abrechnungsDatum}`, pageWidth - marginRight, y + 6, { align: 'right' });

  y += 20;

  // Absender (Schreibmaschinenzeile)
  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);
  doc.text(`NiImmo Verwaltung GmbH • ${data.immobilieAdresse}`, marginLeft, y);
  doc.setDrawColor(180, 180, 180);
  doc.line(marginLeft, y + 1.5, marginLeft + 95, y + 1.5);

  y += 8;

  // Empfänger
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(data.mieterName, marginLeft, y, { maxWidth: contentWidth });
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(data.einheitBezeichnung, marginLeft, y, { maxWidth: contentWidth });
  y += 5;
  doc.text(data.immobilieAdresse, marginLeft, y);

  y += 16;

  // Betreff
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, marginLeft, y);

  y += 8;

  // Meta-Tabelle
  doc.setFontSize(9);
  const metaRows: [string, string][] = [
    ['Abrechnungszeitraum:', `01.01.${data.abrechnungsjahr} – 31.12.${data.abrechnungsjahr}`],
    ['Ihr Nutzungszeitraum:', `${data.nutzungVon} – ${data.nutzungBis}`],
    ['Einheit / Wohnfläche:', `${data.einheitBezeichnung}, ${data.qm.toFixed(1)} m²`],
    ['Bewohnerzahl:', `${data.anzahlPersonen} Person(en)`],
  ];
  metaRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text(label, marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(value, marginLeft + 56, y);
    y += 5;
  });

  y += 6;

  // Trennlinie
  doc.setDrawColor(180, 180, 180);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 6;

  // Tabellenheader
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('Kostenart', marginLeft, y);
  doc.text('Schlüssel', marginLeft + 78, y);
  doc.text('Gesamtkosten', marginLeft + 110, y, { align: 'right' });
  doc.text('Ihr Anteil', marginLeft + 135, y, { align: 'right' });
  doc.text('Betrag', marginLeft + contentWidth, y, { align: 'right' });

  y += 3;
  doc.setDrawColor(120, 120, 120);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 5;

  // Kostenzeilen
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  const umlagefaehig = data.kostenDetails.filter(d => d.anteilBetrag > 0);

  umlagefaehig.forEach(detail => {
    y = checkPageBreak(y, 7);
    doc.text(detail.kategorieName, marginLeft, y, { maxWidth: 74 });
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(8);
    doc.text(SCHLUESSEL_LABELS[detail.verteilerschluessel] || detail.verteilerschluessel, marginLeft + 78, y);
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`${detail.gesamtKosten.toFixed(2)} €`, marginLeft + 110, y, { align: 'right' });
    doc.text(`${detail.anteilProzent.toFixed(2)} %`, marginLeft + 135, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`${detail.anteilBetrag.toFixed(2)} €`, marginLeft + contentWidth, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += 6.5;
  });

  y += 2;
  doc.setDrawColor(100, 100, 100);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 5;

  // Summe Betriebskosten
  y = checkPageBreak(y, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Summe Betriebskosten', marginLeft, y);
  doc.text(`${data.kostenAnteilGesamt.toFixed(2)} €`, marginLeft + contentWidth, y, { align: 'right' });

  y += 9;

  // Vorauszahlungen
  y = checkPageBreak(y, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text('Ihre geleisteten Vorauszahlungen:', marginLeft, y);
  y += 5;
  doc.text(
    `${data.anzahlMonate.toFixed(1)} Monate × ${data.monatlicheVorauszahlung.toFixed(2)} €/Monat`,
    marginLeft + 6, y
  );
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`– ${data.vorauszahlungenGesamt.toFixed(2)} €`, marginLeft + contentWidth, y, { align: 'right' });

  y += 8;

  // Doppellinie für Ergebnis
  y = checkPageBreak(y, 18);
  doc.setDrawColor(0, 0, 0);
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 1.5;
  doc.line(marginLeft, y, pageWidth - marginRight, y);
  y += 6;

  // Saldo
  const isNachzahlung = data.saldo > 0;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  if (isNachzahlung) {
    doc.setTextColor(180, 30, 30);
  } else {
    doc.setTextColor(20, 130, 60);
  }
  doc.text(isNachzahlung ? 'Nachzahlung' : 'Guthaben', marginLeft, y);
  doc.text(
    `${isNachzahlung ? '+' : ''}${data.saldo.toFixed(2)} €`,
    marginLeft + contentWidth, y, { align: 'right' }
  );

  y += 10;

  // Erläuterungstext
  y = checkPageBreak(y, 20);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);

  if (isNachzahlung) {
    const lines = doc.splitTextToSize(
      `Bitte überweisen Sie den Nachzahlungsbetrag von ${data.saldo.toFixed(2)} € innerhalb von 30 Tagen nach Erhalt dieser Abrechnung auf das bekannte Konto.`,
      contentWidth
    );
    doc.text(lines, marginLeft, y);
    y += lines.length * 5 + 4;
  } else {
    const guthabenBetrag = Math.abs(data.saldo).toFixed(2);
    const lines = doc.splitTextToSize(
      `Das Guthaben von ${guthabenBetrag} € wird mit Ihrer nächsten Mietzahlung verrechnet oder auf Anfrage zurückerstattet. Bitte nehmen Sie hierzu Kontakt mit uns auf.`,
      contentWidth
    );
    doc.text(lines, marginLeft, y);
    y += lines.length * 5 + 4;
  }

  y += 6;
  y = checkPageBreak(y, 14);

  // Rechtshinweis
  doc.setFontSize(7.5);
  doc.setTextColor(130, 130, 130);
  const hinweis = doc.splitTextToSize(
    'Gemäß § 556 BGB haben Sie das Recht, die Belege zur Betriebskostenabrechnung einzusehen. Einwendungen gegen diese Abrechnung sind gemäß § 556 Abs. 3 BGB innerhalb von 12 Monaten nach Zugang geltend zu machen.',
    contentWidth
  );
  doc.text(hinweis, marginLeft, y);

  addFooter();

  return doc.output('blob');
}
