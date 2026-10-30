import { jsPDF } from 'jspdf';
import type { Unterzeichner } from '@/config/company';
import { anredeFuerSchreiben } from './kuendigungsbestaetigung';
import { beginneBrief, ladeBriefbilder, type Briefbilder } from './pdf/briefbogen';

export interface MahnungPdfData {
  // Empfänger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  /** Alle Mieter des Vertrags; ohne Angabe gilt nur mieterNachname. */
  mieter?: Array<{ vorname: string; nachname: string }>;
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
  /** Länge der Frist in Tagen, wie im Dialog eingetragen (Vorgabe 7). */
  zahlungsfristTage?: number;
  raeumungsfristDatum?: string;
  uebergabeDatum?: string;

  // Freitext
  freitext?: string;

  /** Rückfragenblock und Unterschrift; im Dialog vorbelegt mit dem Angemeldeten (30.10.2026) */
  unterzeichner: Unterzeichner;
}

export async function generateMahnungPdf(data: MahnungPdfData): Promise<Blob> {
  return mahnungSetzen(data, await ladeBriefbilder());
}

/** Betreff wie in der Briefvorlage: Art des Schreibens – Anschrift des Objekts */
export function mahnungBetreff(data: Pick<MahnungPdfData, 'mahnstufe' | 'immobilieAdresse'>): string {
  const art = data.mahnstufe >= 3
    ? 'Mahnung und fristlose Kündigung des Mietvertrages wegen Zahlungsverzuges'
    : data.mahnstufe === 2
      ? 'Zweite Mahnung wegen Mietrückstand'
      : 'Erste Mahnung wegen Mietrückstand';
  return data.immobilieAdresse.trim() ? `${art} – ${data.immobilieAdresse.trim()}` : art;
}

/**
 * Freitext aus dem Dialog: jede Zeile ein Absatz, eingerückte Zeilen (so übernimmt der Dialog die offenen
 * Posten) werden zur Aufzählung.
 */
export function freitextBloecke(text: string): Array<{ art: 'absatz' | 'liste'; zeilen: string[] }> {
  const bloecke: Array<{ art: 'absatz' | 'liste'; zeilen: string[] }> = [];
  for (const roh of text.split(/\r?\n/)) {
    if (!roh.trim()) continue;
    const art = /^\s/.test(roh) ? 'liste' : 'absatz';
    const letzter = bloecke[bloecke.length - 1];
    if (art === 'liste' && letzter?.art === 'liste') letzter.zeilen.push(roh.trim());
    else bloecke.push({ art, zeilen: [roh.trim()] });
  }
  return bloecke;
}

function mahnungSetzen(data: MahnungPdfData, bilder: Briefbilder): Blob {
  const doc = new jsPDF('p', 'mm', 'a4');
  const anrede = anredeFuerSchreiben(data.anrede, data.mieter ?? [{ vorname: '', nachname: data.mieterNachname }]);
  const brief = beginneBrief(doc, bilder, {
    anschrift: anrede.anschrift,
    name: data.mieterName,
    zeilen: [data.mieterAdresse, data.mieterPlzOrt],
    datum: data.datum,
    betreff: mahnungBetreff(data),
    unterzeichner: data.unterzeichner,
  });
  brief.anrede(anrede.gruss);

  // Ein Freitext aus Leerzeichen gilt als leer — sonst bliebe das Schreiben ohne Inhalt und ohne Gesamtbetrag
  const freitext = data.freitext?.trim() ? data.freitext : undefined;
  if (freitext) {
    for (const block of freitextBloecke(freitext)) {
      if (block.art === 'liste') brief.aufzaehlung(block.zeilen);
      else block.zeilen.forEach((z) => brief.absatz(z));
    }
  } else {
    // Aufeinanderfolgende Postenzeilen bilden eine Aufzählung
    let posten: string[] = [];
    for (const absatz of mahnungAbsaetze(data)) {
      if (absatz.startsWith(POSTEN_PRAEFIX)) {
        posten.push(absatz.slice(POSTEN_PRAEFIX.length));
        continue;
      }
      brief.aufzaehlung(posten);
      posten = [];
      brief.absatz(absatz);
    }
    brief.aufzaehlung(posten);
  }

  if (data.verzugszinsenDetails.length > 0) {
    brief.absatz('Zusätzlich schulden Sie für die nicht bzw. verspätet gezahlten Mieten Verzugszinsen nach § 288 BGB. Bis zum heutigen Tage belaufen sich diese auf:');
    brief.aufzaehlung(data.verzugszinsenDetails.map((detail) => detail.laufend
      ? `${detail.monat}: ab ${data.datum} weiter laufend`
      : `${detail.monat}: ${formatEuro(detail.betrag)} €`));
    brief.absatz(`Zwischensumme Verzugszinsen: ${formatEuro(data.verzugszinsenGesamt)} € (zuzüglich weiterer Zinsen bis zur vollständigen Zahlung).`);
  }

  if (data.mahnkostenGesamt > 0) {
    brief.absatz(`Weiterhin entstehen Mahnkosten i. H. v. ${formatEuro(data.mahnkostenProSchreiben)} € pro Mahnschreiben, somit ${formatEuro(data.mahnkostenGesamt)} €.`);
  }

  // Gesamtbetrag (Prüfung 29.10.2026): „Wir bitten Sie, den Gesamtbetrag … zu überweisen“ bezifferte ihn nirgends;
  // wer das Schreiben per Post bekommt, erfuhr den Zahlbetrag nicht
  if (!freitext) {
    brief.absatz(gesamtbetragText(data), { fett: true, blocksatz: false });
  }

  const uebergabeText = data.uebergabeDatum
    ? `Die Wohnungsübergabe findet am ${data.uebergabeDatum} statt. Bitte stellen Sie sicher, dass die Wohnung zu diesem Zeitpunkt vollständig geräumt und besenrein übergeben wird.`
    : null;

  if (data.mahnstufe >= 3) {
    brief.absatz(`Hiermit kündige ich daher das bestehende Mietverhältnis über die Wohnung in der ${data.immobilieAdresse}, ${data.einheitBezeichnung} außerordentlich fristlos. Wir fordern Sie auf die Wohnung unverzüglich, spätestens jedoch bis zum ${data.raeumungsfristDatum || data.zahlungsfristDatum} zu räumen.`);
    if (uebergabeText) brief.absatz(uebergabeText);
    brief.absatz(`Unabhängig hiervon setze ich Ihnen – ohne Anerkennung einer Rechtspflicht – eine Frist von ${data.zahlungsfristTage ?? 7} Kalendertagen, spätestens bis zum ${data.zahlungsfristDatum}, um sämtliche Mietrückstände nebst Zinsen vollständig auszugleichen. Sollten Sie die Rückstände nicht innerhalb dieser Frist begleichen, werde ich die fristlose Kündigung vollumfänglich durchsetzen und Räumungsklage erheben.`);
  } else {
    brief.absatz(`Wir bitten Sie, den Gesamtbetrag bis zum ${data.zahlungsfristDatum} auf unser Konto zu überweisen.`);
    if (uebergabeText) brief.absatz(uebergabeText);
    if (data.mahnstufe === 2) brief.absatz('Bei ausbleibender Zahlung behalten wir uns rechtliche Schritte vor.');
  }

  brief.schluss({
    satz: 'Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.',
  });
  return brief.fertig();
}

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * „1,5 Monatsmieten“ — die Zahl, mit der Stufe 3 den Verzug nach § 543 Abs. 2 Nr. 3 BGB begründet.
 * Bis zum 27.10.2026 rundete der Dialog auf (Math.ceil): 1,1 Monatsmieten Rückstand standen als
 * „2 Monatsmieten“ im Kündigungsschreiben, also genau an der Schwelle, die nicht erreicht war.
 */
export function monatsmietenText(anzahl: number): string {
  const wert = Number.isFinite(anzahl) ? Math.floor(anzahl * 10) / 10 : 0;
  return `${wert.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${wert === 1 ? 'Monatsmiete' : 'Monatsmieten'}`;
}

/**
 * „1,5 Monatsmieten in Höhe von insgesamt 1.200,00 €“ — ohne die Monatsmieten, wenn sie (abgerundet)
 * 0 sind: Ohne Miete am Vertrag oder bei sehr kleinem Rückstand stand „auf 0 Monatsmieten“ im
 * Kündigungsschreiben (27.10.2026).
 */
/** Kennzeichnet in mahnungAbsaetze eine Zeile der Postenliste */
export const POSTEN_PRAEFIX = '\u0000posten:';

/**
 * Die Absätze des Mahnschreibens ohne Freitext, für PDF und Textvorlage im Dialog (Prüfung 29.10.2026: das Schreiben
 * kündigte „folgende Mietzahlungen“ an und zählte keine auf). Zeilen der Postenliste beginnen mit POSTEN_PRAEFIX.
 */
export function mahnungAbsaetze(
  data: Pick<MahnungPdfData, 'mahnstufe' | 'vertragStart' | 'offeneForderungen' | 'gesamtRueckstand' | 'anzahlMonatsmieten'>
): string[] {
  const posten = data.offeneForderungen.map((p) => `${POSTEN_PRAEFIX}${p.monat}: ${formatEuro(p.betrag)} €`);
  const mitListe = posten.length > 0;
  if (data.mahnstufe >= 3) {
    return [
      `Sie haben seit Beginn des Mietverhältnisses am ${data.vertragStart} Ihre Mietzahlungen wiederholt verspätet und unregelmäßig erbracht. Trotz meiner Mahnung sind die Mietrückstände nicht ausgeglichen worden.${mitListe ? ' Offen sind:' : ''}`,
      ...posten,
      `Der Mietrückstand beläuft sich inzwischen auf ${rueckstandsUmfang(data.anzahlMonatsmieten, formatEuro(data.gesamtRueckstand))}. Damit befinden Sie sich im erheblichen Zahlungsverzug im Sinne der §§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB.`,
    ];
  }
  if (data.mahnstufe === 2) {
    return [
      `trotz unserer ersten Mahnung sind ${mitListe ? 'die folgenden Zahlungen' : 'die offenen Zahlungen'} weiterhin nicht bei uns eingegangen. Wir fordern Sie hiermit erneut zur Zahlung auf.`,
      ...posten,
      `Der Mietrückstand beläuft sich auf insgesamt ${formatEuro(data.gesamtRueckstand)} €.`,
    ];
  }
  return [
    mitListe
      ? 'wir möchten Sie darauf hinweisen, dass folgende Mietzahlungen noch nicht bei uns eingegangen sind:'
      : 'wir möchten Sie darauf hinweisen, dass Mietzahlungen noch nicht vollständig bei uns eingegangen sind.',
    ...posten,
    `Der Mietrückstand beläuft sich auf insgesamt ${formatEuro(data.gesamtRueckstand)} €.`,
  ];
}

/** „Zu zahlen sind insgesamt …“: Rückstand, Zinsen und Mahnkosten mit Summe */
export function gesamtbetragText(
  data: Pick<MahnungPdfData, 'gesamtRueckstand' | 'verzugszinsenGesamt' | 'mahnkostenGesamt'>
): string {
  const teile = [`Mietrückstand ${formatEuro(data.gesamtRueckstand)} €`];
  if (data.verzugszinsenGesamt > 0) teile.push(`Verzugszinsen ${formatEuro(data.verzugszinsenGesamt)} €`);
  if (data.mahnkostenGesamt > 0) teile.push(`Mahnkosten ${formatEuro(data.mahnkostenGesamt)} €`);
  const summe = Math.round((data.gesamtRueckstand + data.verzugszinsenGesamt + data.mahnkostenGesamt) * 100) / 100;
  return teile.length === 1
    ? `Zu zahlen sind insgesamt ${formatEuro(summe)} €.`
    : `Zu zahlen sind insgesamt ${formatEuro(summe)} € (${teile.join(', ')}).`;
}

export function rueckstandsUmfang(anzahlMonatsmieten: number, betragText: string): string {
  const wert = Number.isFinite(anzahlMonatsmieten) ? Math.floor(anzahlMonatsmieten * 10) / 10 : 0;
  return wert > 0 ? `${monatsmietenText(wert)} in Höhe von insgesamt ${betragText} €` : `insgesamt ${betragText} €`;
}
