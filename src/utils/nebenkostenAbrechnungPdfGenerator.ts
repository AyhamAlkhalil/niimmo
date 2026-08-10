import { jsPDF } from 'jspdf';
import { COMPANY } from '@/config/company';

export interface NebenkostenKostenDetail {
  betrkvNummer?: string;
  kategorieName: string;
  gesamtKosten: number;
  verteilerschluessel: string;
  anteilProzent: number;
  anteilBetrag: number;
  einheitenGesamt?: number;
  ihreEinheiten?: number;
  nutzungsdauerProzent?: number;
}

export interface NebenkostenImmobilieKostenRow {
  betrkvNummer: string;
  name: string;
  verteilerschluessel: string;
  betragGesamt: number;
  einheitenLabel: string;
}

export interface NebenkostenAbrechnungPdfData {
  immobilieAdresse: string;

  // Seite 1 – Anschreiben
  /** Alle Vertragspartner, zusammengefasst. */
  empfaengerName: string;
  /** Zustelladresse: Nachsendeadresse nach Auszug, sonst Objektadresse. */
  empfaengerAdresse: string[];

  // Seite 2 – Gesamtaufstellung Immobilie
  gesamtFlaeche: number;
  anzahlWohneinheiten: number;
  gesamtPersonentage: number;
  immobilieKosten: NebenkostenImmobilieKostenRow[];
  immobilieGesamtkosten: number;

  // Seite 3 – Einzelmieter
  einheitBezeichnung: string;
  qm: number;
  anzahlPersonen: number;
  personentageEinheit: number;
  mieterName: string;
  abrechnungsjahr: number;
  abrechnungszeitraumVon: string;
  abrechnungszeitraumBis: string;
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

// ─── Konstanten ────────────────────────────────────────────────────────────────

const ORANGE: [number, number, number] = [213, 84, 38];
const DARK: [number, number, number] = [30, 30, 30];
const GRAY: [number, number, number] = [120, 120, 120];
const LIGHT: [number, number, number] = [245, 245, 245];

const SCHLUESSEL_LABEL: Record<string, string> = {
  qm: 'Wohnfläche',
  personen: 'Personentage',
  gleich: 'Einheit',
  verbrauch: 'Verbrauch',
  individuell: 'Individuell',
};

let logoCache: string | null = null;

async function loadLogo(): Promise<string | null> {
  if (logoCache) return logoCache;
  try {
    const res = await fetch('/nilimmo-logo.png');
    const blob = await res.blob();
    return new Promise(resolve => {
      const r = new FileReader();
      r.onloadend = () => { logoCache = r.result as string; resolve(logoCache); };
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formatEur(v: number): string {
  if (v === 0) return '–';
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ─── PDF-Generator ──────────────────────────────────────────────────────────────

export async function generateNebenkostenAbrechnungPdf(
  data: NebenkostenAbrechnungPdfData
): Promise<Blob> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const logo = await loadLogo();
  const PW = 210;
  const ML = 15;
  const MR = 15;
  const CW = PW - ML - MR;

  await seite1(doc, data, logo, PW, ML, MR, CW);

  doc.addPage();
  seite2(doc, data, PW, ML, MR, CW);

  doc.addPage();
  seite3(doc, data, logo, PW, ML, MR, CW);

  return doc.output('blob');
}

// ─── Seite 1: Anschreiben ────────────────────────────────────────────────────

async function seite1(
  doc: jsPDF,
  data: NebenkostenAbrechnungPdfData,
  logo: string | null,
  PW: number,
  ML: number,
  MR: number,
  CW: number
) {
  const FOOTER_Y = 272;

  if (logo) {
    doc.addImage(logo, 'PNG', PW / 2 - 22, 8, 44, 14);
  }

  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('— Gruppe —', PW / 2, 25, { align: 'center' });

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, 28, PW - MR, 28);

  let y = 36;

  // Absender-Zeile (klein, unterstrichen)
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(COMPANY.anschriftEinzeilig, ML, y);
  doc.setDrawColor(...GRAY);
  doc.setLineWidth(0.2);
  doc.line(ML, y + 1, ML + 120, y + 1);

  y += 9;

  // Empfängerblock: Name aller Vertragspartner + Zustelladresse
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  const nameZeilen = doc.splitTextToSize(data.empfaengerName, 100);
  doc.text(nameZeilen, ML, y);
  y += nameZeilen.length * 5;

  doc.setFont('helvetica', 'normal');
  data.empfaengerAdresse.forEach(zeile => {
    doc.text(zeile, ML, y);
    y += 5;
  });

  // Kontakt-Box rechts
  const kontaktX = 130;
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Rückfragen richten Sie bitte an:', kontaktX, 37);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(COMPANY.ansprechpartner.name, kontaktX, 43);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`Tel.  ${COMPANY.ansprechpartner.telefon}`, kontaktX, 49);
  doc.text(`Fax  ${COMPANY.ansprechpartner.fax}`, kontaktX, 54);
  doc.text(`${COMPANY.strasse}, ${COMPANY.plzOrt}`, kontaktX, 59);
  doc.text(COMPANY.ansprechpartner.email, kontaktX, 64);

  y = Math.max(y, 72) + 3;

  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'normal');
  doc.text(`${COMPANY.ort}, ${data.abrechnungsDatum}`, PW - MR, y, { align: 'right' });

  y += 12;

  // Betreff
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`MV ${data.immobilieAdresse} – ${data.einheitBezeichnung}`, ML, y, { maxWidth: CW });
  y += 6;
  doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, ML, y);

  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Sehr geehrte Damen und Herren,', ML, y);

  y += 8;

  const p1 = doc.splitTextToSize(
    `anliegend erhalten Sie die Betriebskostenabrechnung für das Kalenderjahr ${data.abrechnungsjahr}. ` +
    `Der Abrechnungszeitraum umfasst den Zeitraum vom ${data.abrechnungszeitraumVon} bis ${data.abrechnungszeitraumBis}. ` +
    `Ihr persönlicher Nutzungszeitraum lag vom ${data.nutzungVon} bis ${data.nutzungBis}.`,
    CW
  );
  doc.text(p1, ML, y);
  y += p1.length * 5.5 + 5;

  const isNachzahlung = data.saldo > 0.01;
  const isGuthaben = data.saldo < -0.01;
  const deadline = `30. März ${data.abrechnungsjahr + 1}`;

  let p2Text =
    'Die Abrechnung wurde nach bestem Wissen und Gewissen sowie auf Grundlage der uns vorliegenden ' +
    'Unterlagen erstellt. ';
  if (isGuthaben) {
    p2Text += 'Das ausgewiesene Guthaben wird Ihnen umgehend überwiesen.';
  } else if (isNachzahlung) {
    p2Text +=
      `Wir bitten um Ausgleich des ausgewiesenen Nachzahlungsbetrags bis spätestens ${deadline} ` +
      'auf das bekannte Mietkonto.';
  } else {
    p2Text += 'Vorauszahlungen und Kosten gleichen sich aus, es ergibt sich kein Saldo.';
  }

  const p2 = doc.splitTextToSize(p2Text, CW);
  doc.text(p2, ML, y);
  y += p2.length * 5.5 + 5;

  const p3 = doc.splitTextToSize(
    'Für Rückfragen zur Abrechnung oder zu den einzelnen Positionen stehen wir Ihnen ' +
    'selbstverständlich gerne zur Verfügung. Die zugrunde liegenden Belege können Sie nach ' +
    'Terminvereinbarung in unseren Geschäftsräumen einsehen.',
    CW
  );
  doc.text(p3, ML, y);
  y += p3.length * 5.5 + 12;

  doc.text('Mit freundlichem Gruß', ML, y);
  y += 18;

  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML + 55, y);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(COMPANY.ansprechpartner.unterschrift, ML, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  doc.text(COMPANY.ansprechpartner.funktion, ML, y);

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, FOOTER_Y - 4, PW - MR, FOOTER_Y - 4);

  doc.setFontSize(6.5);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  COMPANY.rechtliches.forEach((line, i) => {
    doc.text(line, ML, FOOTER_Y + i * 4);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...ORANGE);
  doc.text('IHK', PW - MR - 28, FOOTER_Y + 4);
  doc.text('Creditreform', PW - MR, FOOTER_Y + 4, { align: 'right' });
}

// ─── Seite 2: Gesamtaufstellung ───────────────────────────────────────────────

function seite2(
  doc: jsPDF,
  data: NebenkostenAbrechnungPdfData,
  PW: number,
  ML: number,
  MR: number,
  CW: number
) {
  let y = 15;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, ML, y);

  y += 6;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text(`Liegenschaft    ${data.immobilieAdresse}`, ML, y);

  y += 10;

  const metaRows: [string, string][] = [
    ['Abrechnungszeitraum', `${data.abrechnungszeitraumVon}  –  ${data.abrechnungszeitraumBis}`],
    ['Gesamt-Fläche', `${data.gesamtFlaeche.toFixed(0)} m²`],
    ['Gesamtanzahl d. Wohneinheiten', `${data.anzahlWohneinheiten}`],
    ['Gesamt-Personentage', `${data.gesamtPersonentage}`],
  ];
  doc.setFontSize(8.5);
  metaRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(label, ML, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(value, ML + 75, y);
    y += 5;
  });

  y += 8;

  const colX = [ML, ML + 100, ML + 134, ML + 158];
  const headerH = 7;
  doc.setFillColor(...ORANGE);
  doc.rect(ML, y - 5, CW, headerH, 'F');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('KOSTENART', colX[0] + 2, y);
  doc.text('Verteilerschlüssel', colX[1] + 2, y);
  doc.text('Betrag gesamt', colX[2] + 27, y, { align: 'right' });
  doc.text('Einheiten gesamt', colX[3] + 27, y, { align: 'right' });

  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  let shade = false;
  data.immobilieKosten.forEach(row => {
    if (shade) {
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y - 4, CW, 6, 'F');
    }
    shade = !shade;

    doc.setTextColor(...DARK);
    doc.text(`${row.betrkvNummer}  ${row.name}`, colX[0] + 2, y, { maxWidth: 96 });

    doc.setTextColor(...GRAY);
    doc.text(SCHLUESSEL_LABEL[row.verteilerschluessel] || row.verteilerschluessel, colX[1] + 2, y);

    doc.setTextColor(...DARK);
    doc.setFont('helvetica', row.betragGesamt > 0 ? 'bold' : 'normal');
    doc.text(formatEur(row.betragGesamt), colX[2] + 27, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(row.einheitenLabel, colX[3] + 27, y, { align: 'right' });

    y += 6;
  });

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text('Gesamtkosten', ML + 2, y);
  doc.text(formatEur(data.immobilieGesamtkosten), colX[2] + 27, y, { align: 'right' });

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  const hinweis = doc.splitTextToSize(
    'Jahresübergreifende Rechnungen (z. B. Heizperioden) sind zeitanteilig mit dem auf diesen ' +
    'Abrechnungszeitraum entfallenden Anteil berücksichtigt.',
    CW
  );
  doc.text(hinweis, ML, y);
}

// ─── Seite 3: Einzelmieter ───────────────────────────────────────────────────

function seite3(
  doc: jsPDF,
  data: NebenkostenAbrechnungPdfData,
  logo: string | null,
  PW: number,
  ML: number,
  MR: number,
  CW: number
) {
  let y = 15;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, ML, y);

  if (logo) {
    doc.addImage(logo, 'PNG', PW - MR - 34, y - 10, 34, 11);
  }

  y += 6;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text(`Liegenschaft    ${data.immobilieAdresse}`, ML, y);

  y += 8;

  const metaL: [string, string][] = [
    ['Wohneinheit', data.einheitBezeichnung],
    ['Nutzer', data.mieterName],
    ['Nutzerzahl', `${data.anzahlPersonen} Person(en)`],
    ['Personentage', `${data.personentageEinheit}`],
    ['Wohnfläche', `${data.qm.toFixed(0)} m²`],
    ['Nutzungszeitraum', `${data.nutzungVon}  –  ${data.nutzungBis}`],
  ];
  const metaR: [string, string][] = [
    ['Abrechnungszeitraum', `${data.abrechnungszeitraumVon}  –  ${data.abrechnungszeitraumBis}`],
    ['Gesamt-Fläche', `${data.gesamtFlaeche.toFixed(0)} m²`],
    ['Gesamtanzahl WE', `${data.anzahlWohneinheiten}`],
    ['Gesamt-Personentage', `${data.gesamtPersonentage}`],
  ];

  const metaStartY = y;
  const halfCW = CW / 2;

  doc.setFontSize(8);
  metaL.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(label, ML, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(value, ML + 30, y, { maxWidth: halfCW - 32 });
    y += 4.5;
  });

  let yr = metaStartY;
  metaR.forEach(([label, value]) => {
    const x = ML + halfCW + 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(label, x, yr);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text(value, x + 37, yr);
    yr += 4.5;
  });

  y = Math.max(y, yr) + 6;

  // Kostentabelle: Kostenart | Verteil. | Betrag | Einh.ges. | Preis/E | Ihre Einh. | Kosten
  const cW = [58, 19, 22, 19, 17, 14, 21];
  const cx: number[] = [];
  let acc = ML;
  cW.forEach(w => { cx.push(acc); acc += w; });

  const headerH = 7;
  doc.setFillColor(...ORANGE);
  doc.rect(ML, y - 5, CW, headerH, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('KOSTENART', cx[0] + 1, y);
  doc.text('Verteil.', cx[1] + 1, y);
  doc.text('Betrag ges.', cx[2] + cW[2], y, { align: 'right' });
  doc.text('Einh. ges.', cx[3] + cW[3], y, { align: 'right' });
  doc.text('Preis/E.', cx[4] + cW[4], y, { align: 'right' });
  doc.text('Ihre Einh.', cx[5] + cW[5], y, { align: 'right' });
  doc.text('Ihre Kosten', cx[6] + cW[6], y, { align: 'right' });

  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  let shade = false;
  data.kostenDetails.forEach(row => {
    if (shade) {
      doc.setFillColor(...LIGHT);
      doc.rect(ML, y - 4, CW, 5.5, 'F');
    }
    shade = !shade;

    const einh = row.einheitenGesamt ?? 0;
    const ihreE = row.ihreEinheiten ?? 0;
    const preisProE = einh > 0 ? row.gesamtKosten / einh : 0;
    const einheitSuffix = row.verteilerschluessel === 'qm' ? ' m²' : '';

    doc.setTextColor(...DARK);
    const nameText = row.betrkvNummer
      ? `${row.betrkvNummer}  ${row.kategorieName}`
      : row.kategorieName;
    doc.text(nameText, cx[0] + 1, y, { maxWidth: cW[0] - 2 });

    doc.setTextColor(...GRAY);
    doc.text(
      SCHLUESSEL_LABEL[row.verteilerschluessel] || row.verteilerschluessel,
      cx[1] + 1, y, { maxWidth: cW[1] - 1 }
    );

    doc.setTextColor(...DARK);
    doc.text(row.gesamtKosten > 0 ? formatEur(row.gesamtKosten) : '–', cx[2] + cW[2], y, { align: 'right' });
    doc.text(einh > 0 ? `${einh.toFixed(0)}${einheitSuffix}` : '–', cx[3] + cW[3], y, { align: 'right' });
    doc.text(
      preisProE > 0
        ? preisProE.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '–',
      cx[4] + cW[4], y, { align: 'right' }
    );
    doc.text(ihreE > 0 ? `${ihreE.toFixed(0)}${einheitSuffix}` : '–', cx[5] + cW[5], y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(row.anteilBetrag > 0.01 ? formatEur(row.anteilBetrag) : '–', cx[6] + cW[6], y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += 5.5;
  });

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 5;

  // Summe der Kosten
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text('IHRE KOSTEN GESAMT', ML + 2, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(formatEur(data.kostenAnteilGesamt), cx[6] + cW[6], y, { align: 'right' });

  y += 6;

  // Vorauszahlung
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text('VORAUSZAHLUNGEN LAUT MIETVERTRAG', ML + 2, y);
  doc.text(
    `${data.anzahlMonate.toFixed(1)} Mon. × ${data.monatlicheVorauszahlung.toFixed(2)} €`,
    cx[5] + cW[5], y, { align: 'right' }
  );
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`– ${formatEur(data.vorauszahlungenGesamt)}`, cx[6] + cW[6], y, { align: 'right' });

  y += 6;

  doc.setLineWidth(0.4);
  doc.setDrawColor(...DARK);
  doc.line(ML, y, PW - MR, y);
  doc.line(ML, y + 1.5, PW - MR, y + 1.5);
  y += 7;

  // Saldo
  const isNachzahlung = data.saldo > 0.01;
  const isGuthaben = data.saldo < -0.01;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  if (isNachzahlung) doc.setTextColor(180, 30, 30);
  else if (isGuthaben) doc.setTextColor(20, 130, 60);
  else doc.setTextColor(...DARK);

  const saldoLabel = isNachzahlung ? 'Nachzahlung' : isGuthaben ? 'Guthaben' : 'Ausgeglichen';
  doc.text(saldoLabel, ML + 2, y);
  doc.text(
    Math.abs(data.saldo) < 0.01
      ? '0,00 €'
      : `${isNachzahlung ? '+' : ''}${formatEur(Math.abs(data.saldo))}`,
    cx[6] + cW[6], y, { align: 'right' }
  );

  y += 10;

  // Fußnote
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  const fn = doc.splitTextToSize(
    'Umlage nach § 2 Betriebskostenverordnung. Der Verteilerschlüssel ist je Kostenart in der ' +
    'Spalte „Verteil." ausgewiesen; bei unterjährigem Nutzungswechsel erfolgt die Umlage ' +
    'zeitanteilig. Gemäß § 556 BGB haben Sie das Recht, die Belege einzusehen. Einwendungen sind ' +
    'innerhalb von 12 Monaten nach Zugang dieser Abrechnung geltend zu machen (§ 556 Abs. 3 BGB).',
    CW
  );
  doc.text(fn, ML, y);
}
