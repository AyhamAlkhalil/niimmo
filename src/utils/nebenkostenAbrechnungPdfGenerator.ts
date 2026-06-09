import { jsPDF } from 'jspdf';

export interface NebenkostenKostenDetail {
  betrkvNummer?: string;
  kategorieName: string;
  gesamtKosten: number;
  verteilerschluessel: string;
  anteilProzent: number;
  anteilBetrag: number;
  // Neu: für Seite-3-Tabelle
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

  // Seite 2 – Gesamtaufstellung Immobilie
  gesamtFlaeche: number;
  gesamtPersonenzahl: number;
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

  // ── Seite 1: Anschreiben ──────────────────────────────────────────────────

  await seite1(doc, data, logo, PW, ML, MR, CW);

  // ── Seite 2: Gesamtaufstellung Immobilie ──────────────────────────────────

  doc.addPage();
  seite2(doc, data, logo, PW, ML, MR, CW);

  // ── Seite 3: Einzelmieter-Abrechnung ──────────────────────────────────────

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

  // Logo zentriert
  if (logo) {
    doc.addImage(logo, 'PNG', PW / 2 - 22, 8, 44, 14);
  }

  // "— Gruppe —" unter Logo
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('— Gruppe —', PW / 2, 25, { align: 'center' });

  // Orangene Trennlinie
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, 28, PW - MR, 28);

  let y = 36;

  // Absender-Zeile (klein, unterstrichen)
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text('NiImmo Wohnungsbaugesellschaft mbH, Egerstorffstraße 11, 33119 Sehnde', ML, y);
  doc.setDrawColor(...GRAY);
  doc.setLineWidth(0.2);
  doc.line(ML, y + 1, ML + 120, y + 1);

  y += 9;

  // Empfänger-Block (links) + Kontakt-Block (rechts)
  const adressParts = data.immobilieAdresse.split(', ');
  const strasse = adressParts[0] || data.immobilieAdresse;
  const plzOrt = adressParts.slice(1).join(', ') || '';

  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.text(data.mieterName, ML, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(strasse, ML, y);
  y += 5;
  doc.text(plzOrt, ML, y);

  // Kontakt-Box rechts
  const kontaktX = 130;
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Rückfragen richten Sie bitte an:', kontaktX, 37);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('Denis Baris Mikyas', kontaktX, 43);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('☎  05138 - 600 72 72', kontaktX, 49);
  doc.text('✆  05138 - 600 72 79', kontaktX, 54);
  doc.text('Egerstorffstraße 11, 33119 Sehnde', kontaktX, 59);
  doc.text('mikyas@niimmo.de', kontaktX, 64);

  y = 75;

  // Datum rechts
  doc.setFontSize(9.5);
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'normal');
  doc.text(`Sehnde, ${data.abrechnungsDatum}`, PW - MR, y, { align: 'right' });

  y += 12;

  // Betreff
  const immStrasse = adressParts[0] || data.immobilieAdresse;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`MV ${data.immobilieAdresse} – ${data.einheitBezeichnung}`, ML, y, { maxWidth: CW });
  y += 6;
  doc.text(`Betriebskostenabrechnung ${data.abrechnungsjahr}`, ML, y);

  y += 10;

  // Anrede
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Sehr geehrte Damen und Herren,', ML, y);

  y += 8;

  // Absatz 1
  const p1 = doc.splitTextToSize(
    `anliegend erhalten Sie die Betriebskostenabrechnung für das Kalenderjahr ${data.abrechnungsjahr}. ` +
    `Der Abrechnungszeitraum umfasst den Zeitraum vom 1. Januar bis 31. Dezember ${data.abrechnungsjahr}.`,
    CW
  );
  doc.text(p1, ML, y);
  y += p1.length * 5.5 + 5;

  // Absatz 2
  const deadline = `30. März ${data.abrechnungsjahr + 1}`;
  const p2 = doc.splitTextToSize(
    'Die Abrechnung wurde nach bestem Wissen und Gewissen sowie auf Grundlage der uns vorliegenden ' +
    'Unterlagen erstellt. Ein sich ergebendes Guthaben wird Ihnen umgehend überwiesen. Sollte sich ' +
    `eine Nachzahlung ergeben, bitten wir um Ausgleich des ausgewiesenen Betrags bis spätestens ` +
    `${deadline} auf das bekannte Mietkonto.`,
    CW
  );
  doc.text(p2, ML, y);
  y += p2.length * 5.5 + 5;

  // Absatz 3
  const p3 = doc.splitTextToSize(
    'Für Rückfragen zur Abrechnung oder zu den einzelnen Positionen stehen wir Ihnen ' +
    'selbstverständlich gerne zur Verfügung.',
    CW
  );
  doc.text(p3, ML, y);
  y += p3.length * 5.5 + 12;

  // Gruß
  doc.text('Mit freundlichem Gruß', ML, y);
  y += 18; // Platz für Unterschrift

  // Unterschrift-Bereich
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML + 55, y);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Denis Mikyas', ML, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  doc.text('Geschäftsführer', ML, y);

  // Orangene Linie über Footer
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.6);
  doc.line(ML, FOOTER_Y - 4, PW - MR, FOOTER_Y - 4);

  // Footer
  doc.setFontSize(6.5);
  doc.setTextColor(...GRAY);
  doc.setFont('helvetica', 'normal');
  const footerLinks = [
    'Vertretungsberechtigte Geschäftsführer: Ayhan Yeyrek, Denis Mikyas',
    'Registrierung: HRB 208151 | Amtsgericht Hildesheim',
    'Gewerberlaubnis nach § 34c GewO | IHK Hannover',
    `Steuer-Nr.: 16/204/50864`,
  ];
  footerLinks.forEach((line, i) => {
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
  logo: string | null,
  PW: number,
  ML: number,
  MR: number,
  CW: number
) {
  let y = 15;

  // Titel
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

  // Meta-Tabelle (2-spaltig)
  const metaRows: [string, string][] = [
    ['Abrechnungszeitraum', `01.01.${data.abrechnungsjahr}  –  31.12.${data.abrechnungsjahr}`],
    ['Nutzungszeitraum', `01.01.${data.abrechnungsjahr}  –  31.12.${data.abrechnungsjahr}`],
    ['Gesamt-Fläche', `${data.gesamtFlaeche.toFixed(0)} m²`],
    ['Gesamt-Personenzahl pro Jahr', `${data.gesamtPersonenzahl} Personen`],
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

  // Tabellen-Header (orange Hintergrund)
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

  // Kostenzeilen
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
    const nameText = `${row.betrkvNummer}  ${row.name}`;
    doc.text(nameText, colX[0] + 2, y, { maxWidth: 96 });

    doc.setTextColor(...GRAY);
    doc.text(SCHLUESSEL_LABEL[row.verteilerschluessel] || row.verteilerschluessel, colX[1] + 2, y);

    doc.setTextColor(...DARK);
    doc.setFont('helvetica', row.betragGesamt > 0 ? 'bold' : 'normal');
    doc.text(formatEur(row.betragGesamt), colX[2] + 27, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(row.einheitenLabel, colX[3] + 27, y, { align: 'right' });

    y += 6;
  });

  // Summenzeile
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text('Gesamtkosten', ML + 2, y);
  doc.text(formatEur(data.immobilieGesamtkosten), colX[2] + 27, y, { align: 'right' });
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

  // Titel links + Logo rechts
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

  // Meta-Block (links: Einheit/Mieter | rechts: Gesamt-Immobilie)
  const metaL: [string, string][] = [
    ['Wohneinheit', data.einheitBezeichnung],
    ['Nutz', data.mieterName],
    ['Nutzerzahl', `${data.anzahlPersonen} Person(en)`],
    ['Personentage', `${data.personentageEinheit}`],
    ['Wohnfläche', `${data.qm.toFixed(0)} m²`],
    ['Nutzungszeitraum', `${data.nutzungVon}  –  ${data.nutzungBis}`],
  ];
  const metaR: [string, string][] = [
    ['Abrechnungszeitraum', `01.01.${data.abrechnungsjahr}  –  31.12.${data.abrechnungsjahr}`],
    ['Gesamt-Fläche', `${data.gesamtFlaeche.toFixed(0)} m²`],
    ['Gesamt-Personenzahl', `${data.gesamtPersonenzahl} Personen`],
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
    doc.text(value, ML + 30, y);
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

  // ── Kostentabelle (7 Spalten) ──────────────────────────────────────────────
  // Spaltenbreiten: Kostenart | Verteil | Betrag | Einh.ges. | Preis/E | % Nutz | Kosten
  const cW = [58, 19, 22, 19, 17, 14, 21]; // Summe = 170 = CW (PW=210, ML=15, MR=25)
  // x-Positionen
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
  doc.text('% Nutz.', cx[5] + cW[5], y, { align: 'right' });
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
    const nutz = row.nutzungsdauerProzent ?? 100;
    const preisProE = einh > 0 ? row.gesamtKosten / einh : 0;

    const schluessel = row.verteilerschluessel;
    let einheitenLabel = '';
    if (schluessel === 'qm') einheitenLabel = `${einh.toFixed(0)} m²`;
    else if (schluessel === 'personen') einheitenLabel = `${einh.toFixed(0)}`;
    else einheitenLabel = `${einh.toFixed(0)}`;

    let ihreLabel = '';
    if (schluessel === 'qm') ihreLabel = `${ihreE.toFixed(0)} m²`;
    else if (schluessel === 'personen') ihreLabel = `${ihreE.toFixed(0)}`;
    else ihreLabel = `${ihreE.toFixed(0)}`;

    doc.setTextColor(...DARK);
    const nameText = row.betrkvNummer
      ? `${row.betrkvNummer}  ${row.kategorieName}`
      : row.kategorieName;
    doc.text(nameText, cx[0] + 1, y, { maxWidth: cW[0] - 2 });

    doc.setTextColor(...GRAY);
    doc.text(SCHLUESSEL_LABEL[schluessel] || schluessel, cx[1] + 1, y, { maxWidth: cW[1] - 1 });

    doc.setTextColor(...DARK);
    doc.text(row.gesamtKosten > 0 ? formatEur(row.gesamtKosten) : '–', cx[2] + cW[2], y, { align: 'right' });
    doc.text(einh > 0 ? einheitenLabel : '–', cx[3] + cW[3], y, { align: 'right' });
    doc.text(preisProE > 0 ? preisProE.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–', cx[4] + cW[4], y, { align: 'right' });
    doc.text(ihreE > 0 ? ihreLabel : '–', cx[5] + cW[5], y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(row.anteilBetrag > 0.01 ? formatEur(row.anteilBetrag) : '–', cx[6] + cW[6], y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += 5.5;
  });

  // Summenzeile
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 5;

  // Vorauszahlung
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text('VORAUSZAHLUNGSBETRAG', ML + 2, y);
  doc.text(
    `${data.anzahlMonate.toFixed(1)} Mon. × ${data.monatlicheVorauszahlung.toFixed(2)} €`,
    cx[5] + cW[5], y, { align: 'right' }
  );
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(formatEur(data.vorauszahlungenGesamt), cx[6] + cW[6], y, { align: 'right' });

  y += 6;

  // Doppellinie
  doc.setLineWidth(0.4);
  doc.setDrawColor(...DARK);
  doc.line(ML, y, PW - MR, y);
  doc.line(ML, y + 1.5, PW - MR, y + 1.5);
  y += 7;

  // Saldo
  const isNachzahlung = data.saldo > 0;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(isNachzahlung ? 180 : 20, isNachzahlung ? 30 : 130, isNachzahlung ? 30 : 60);
  doc.text(isNachzahlung ? 'Nachzahlung' : 'Guthaben', ML + 2, y);
  doc.text(
    `${isNachzahlung ? '+' : ''}${formatEur(Math.abs(data.saldo))}`,
    cx[6] + cW[6], y, { align: 'right' }
  );

  y += 10;

  // Fußnote
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  const fn = doc.splitTextToSize(
    'gemäß § 2 Nr. 4 Betriebskostenverordnung, Verteilung nach Personenzahl (§ 9 HeizkostenV). ' +
    'Gemäß § 556 BGB haben Sie das Recht, die Belege einzusehen. Einwendungen sind innerhalb von ' +
    '12 Monaten nach Zugang geltend zu machen (§ 556 Abs. 3 BGB).',
    CW
  );
  doc.text(fn, ML, y);
}
