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
  /** Kosten der Art nach Abzug der Gutschriften. */
  betragGesamt: number;
  einheitenLabel: string;
  /**
   * Darin verrechnete Gutschriften der Versorger (<= 0). Seit 28.10.2026: Eine
   * Erstattung mindert die Kosten ihrer Art; damit der Mieter das nachrechnen
   * kann, weist Seite 2 sie je Kostenart aus.
   */
  gutschriften?: number;
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
  /** null, wenn keine Personenzahl gepflegt ist — dann steht im Druck ein Strich. */
  gesamtPersonentage: number | null;
  immobilieKosten: NebenkostenImmobilieKostenRow[];
  immobilieGesamtkosten: number;

  // Seite 3 – Einzelmieter
  einheitBezeichnung: string;
  qm: number;
  /** null, wenn am Mietvertrag keine Personenzahl hinterlegt ist. */
  anzahlPersonen: number | null;
  personentageEinheit: number | null;
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
  // Kein eigener Schlüssel, nur eine Beschriftung: Gibt es im Zeitraum nur einen
  // Nutzer, trägt er die nach Personentagen verteilten Kosten vollständig. Ohne
  // gepflegte Personenzahl gäbe es sonst eine Zeile ganz ohne Bezugsgröße.
  alleinnutzung: 'Alleinnutzung',
  gleich: 'Einheit',
  verbrauch: 'Verbrauch',
  individuell: 'Individuell',
};

/** Zahl oder Gedankenstrich — nie eine erfundene Null im Schriftstück. */
function zahlOderStrich(wert: number | null | undefined): string {
  return wert === null || wert === undefined ? '—' : `${wert}`;
}

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

/**
 * Zeilen, die auf Seite 2 die verrechneten Gutschriften je Kostenart belegen:
 * Kosten, Gutschrift, verbleibender Betrag. Leer, wenn es keine gibt.
 */
export function gutschriftZeilen(zeilen: readonly NebenkostenImmobilieKostenRow[]): string[] {
  return zeilen
    .filter(z => (z.gutschriften ?? 0) < -0.005)
    .map(z => {
      const gutschrift = z.gutschriften as number;
      const kosten = z.betragGesamt - gutschrift;
      const nummer = z.betrkvNummer && z.betrkvNummer !== '—' ? `${z.betrkvNummer} ` : '';
      return `${nummer}${z.name}: Kosten ${formatEur(kosten)}, Gutschrift ${formatEur(gutschrift)}, verbleiben ${formatEur(z.betragGesamt)}`;
    });
}

/**
 * Hinweis zum Rechenweg unter der Kostentabelle von Seite 3.
 *
 * Bis zum 28.10.2026 stand dort für jede Zeile „Preis/E × Ihre Einheiten ×
 * Zeitanteil“. Beim Schlüssel Personentage steckt der Zeitanteil aber schon in
 * den Einheiten (Personen × Tage), bei Alleinnutzung gibt es keine Einheiten —
 * dort ging die gedruckte Rechnung nicht auf. Multipliziert wird der Zeitanteil
 * nur bei Wohnfläche, Einheit und den ersatzweise nach Fläche gerechneten
 * Altschlüsseln (berechneAnteil in nebenkostenBerechnung.ts).
 */
export function rechenwegHinweis(details: readonly NebenkostenKostenDetail[]): string | null {
  const ohneZeitfaktor = new Set(['personen', 'alleinnutzung']);
  const mitZeitanteil = details.filter(r => !ohneZeitfaktor.has(r.verteilerschluessel));
  const personentage = details.some(r => r.verteilerschluessel === 'personen');
  const alleinnutzung = details.some(r => r.verteilerschluessel === 'alleinnutzung');

  const zeitanteile = [...new Set(mitZeitanteil
    .map(r => r.nutzungsdauerProzent)
    .filter((w): w is number => typeof w === 'number' && Number.isFinite(w))
    .map(w => Math.round(w * 100) / 100))];

  const saetze: string[] = [];
  if (zeitanteile.length > 0) {
    const anteilText = zeitanteile.length === 1
      ? `${zeitanteile[0].toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`
      : 'je Kostenart verschieden';
    const fuer = personentage || alleinnutzung ? ' bei Wohnfläche und Einheit' : '';
    saetze.push(`Ihr Zeitanteil am Abrechnungszeitraum: ${anteilText}. Ihre Kosten${fuer} = Preis/E × Ihre Einheiten × Zeitanteil.`);
  }
  if (personentage) {
    saetze.push('Bei Personentagen ist der Zeitanteil schon in Ihren Einheiten enthalten: Ihre Kosten = Preis/E × Ihre Einheiten.');
  }
  if (alleinnutzung) {
    saetze.push('Bei Alleinnutzung tragen Sie die Kosten der Art vollständig.');
  }
  if (saetze.length === 0) return null;
  return `${saetze.join(' ')} Auf ganze Cent verteilt.`;
}

/**
 * Monatszahl der Vorauszahlungen: volle Monate ohne Nachkommastelle, angebrochene
 * mit zwei. Bis zum 28.10.2026 nur eine Stelle — „5,5 Mon. × 240,00 €“ bei
 * berechneten 5,48 Monaten passte nicht zum gedruckten Betrag.
 */
export function monateText(monate: number): string {
  return Number.isInteger(monate)
    ? `${monate}`
    : monate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const deadline = zahlungsfristAus(data.abrechnungsDatum);

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
    ['Gesamt-Personentage', zahlOderStrich(data.gesamtPersonentage)],
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
  y += hinweis.length * 3.5 + 2;

  // Gutschriften der Versorger je Kostenart (28.10.2026): „Betrag gesamt“ steht
  // netto, hier lässt sich nachrechnen, was abgezogen wurde.
  const gutschriften = gutschriftZeilen(data.immobilieKosten);
  if (gutschriften.length > 0) {
    const zeilen = doc.splitTextToSize(
      ['Verrechnete Gutschriften der Versorger:', ...gutschriften].join('\n'),
      CW
    );
    if (y + zeilen.length * 3.5 > 285) {
      doc.addPage();
      y = 20;
    }
    doc.text(zeilen, ML, y);
  }
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
    ['Nutzerzahl', data.anzahlPersonen === null ? '—' : `${data.anzahlPersonen} Person(en)`],
    ['Personentage', zahlOderStrich(data.personentageEinheit)],
    ['Wohnfläche', `${data.qm.toFixed(0)} m²`],
    ['Nutzungszeitraum', `${data.nutzungVon}  –  ${data.nutzungBis}`],
  ];
  const metaR: [string, string][] = [
    ['Abrechnungszeitraum', `${data.abrechnungszeitraumVon}  –  ${data.abrechnungszeitraumBis}`],
    ['Gesamt-Fläche', `${data.gesamtFlaeche.toFixed(0)} m²`],
    ['Gesamtanzahl WE', `${data.anzahlWohneinheiten}`],
    ['Gesamt-Personentage', zahlOderStrich(data.gesamtPersonentage)],
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
    // Genauer als bisher (m² ganzzahlig, Preis/E auf 2 Stellen): Aus den gedruckten Faktoren
    // ließ sich der Betrag nicht nachrechnen (27.10.2026; 1,99 × 114 m² gedruckt, 191,26 € berechnet)
    const zahl = (w: number, max: number) => w.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: max });
    doc.text(einh > 0 ? `${zahl(einh, 2)}${einheitSuffix}` : '–', cx[3] + cW[3], y, { align: 'right' });
    doc.text(
      preisProE > 0
        ? preisProE.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : '–',
      cx[4] + cW[4], y, { align: 'right' }
    );
    doc.text(ihreE > 0 ? `${zahl(ihreE, 2)}${einheitSuffix}` : '–', cx[5] + cW[5], y, { align: 'right' });
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

  // Zeitanteil drucken. Bis zum 27.10.2026 wurde er berechnet, aber nie ausgewiesen; bei
  // unterjähriger Nutzung passten die Zeilen scheinbar nicht. Seit 28.10.2026 nur dort, wo er
  // wirklich multipliziert wird (siehe rechenwegHinweis).
  const rechenweg = rechenwegHinweis(data.kostenDetails);
  if (rechenweg) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    const zeilen = doc.splitTextToSize(rechenweg, CW - 4);
    doc.text(zeilen, ML + 2, y);
    y += Math.max(6, zeilen.length * 3.5 + 2.5);
  }

  // Vorauszahlung
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRAY);
  doc.text('VORAUSZAHLUNGEN LAUT MIETVERTRAG', ML + 2, y);
  // Deutsche Schreibweise: Komma als Dezimaltrennzeichen, und volle Monate ohne
  // Nachkommastelle. Vorher stand dort "12.0 Mon. x 240.00 EUR".
  const monate = monateText(data.anzahlMonate);
  doc.text(
    `${monate} Mon. × ${formatEur(data.monatlicheVorauszahlung)}`,
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
  const mitGutschrift = gutschriftZeilen(data.immobilieKosten).length > 0;
  const fn = doc.splitTextToSize(
    'Umlage nach § 2 Betriebskostenverordnung. Der Verteilerschlüssel ist je Kostenart in der ' +
    'Spalte „Verteil." ausgewiesen; bei unterjährigem Nutzungswechsel erfolgt die Umlage ' +
    'zeitanteilig. ' +
    (mitGutschrift
      ? 'Gutschriften der Versorger sind in „Betrag ges." bereits abgezogen; die Gesamtaufstellung ' +
        'weist sie je Kostenart aus. '
      : '') +
    'Gemäß § 556 BGB haben Sie das Recht, die Belege einzusehen. Einwendungen sind ' +
    'innerhalb von 12 Monaten nach Zugang dieser Abrechnung geltend zu machen (§ 556 Abs. 3 BGB).',
    CW
  );
  doc.text(fn, ML, y);
}

/**
 * Zahlungsfrist der Nachzahlung: Briefdatum (TT.MM.JJJJ) plus 30 Tage, wie Mail und BKA-Forderung.
 * Bis zum 27.10.2026 stand fest „30. März des Folgejahres“ — eine heute erstellte Abrechnung 2025
 * verlangte Zahlung bis zu einem schon verstrichenen Tag, die Mail nannte 30 Tage.
 */
export function zahlungsfristAus(briefdatum: string): string {
  const [t, m, j] = (briefdatum || '').split('.').map(Number);
  const basis = t && m && j ? new Date(j, m - 1, t) : new Date();
  const frist = new Date(basis.getFullYear(), basis.getMonth(), basis.getDate() + 30);
  return frist.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}
