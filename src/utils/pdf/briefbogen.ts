/**
 * Briefbogen nach der Word-Vorlage des Kunden („NiWoBau Brief“, vorgelegt am 30.10.2026 als Maßstab für die
 * Mahnung): Logo mittig über einer roten Linie, Absenderzeile, Anschrift links, rechts der Block „Rückfragen
 * richten Sie bitte an:“ mit roter Senkrechten, Datum rechtsbündig, fetter Betreff, Blocksatz mit Leerzeile
 * zwischen den Absätzen, Beträge als Aufzählung, Fußzeile in zwei Spalten mit roten Senkrechten und den Logos
 * von IHK und Creditreform. Die Maße (mm) sind an der gerenderten Vorlage abgenommen.
 *
 * Abweichungen mit Absicht: Die Vorlage setzt Calibri 12 pt, jsPDF hat nur die Standardschriften — Helvetica
 * 11 pt läuft etwa gleich breit. Die Folgeseiten der Vorlage tragen den Kopf einer anderen Gesellschaft
 * (Projektentwicklung, Hannover); hier stehen dort nur das kleine Logo und die Seitenzahl. Firmenangaben
 * kommen aus COMPANY, nicht aus der Vorlage (deren Steuernummer ist die falsche, siehe company.ts).
 */
import type jsPDF from 'jspdf';
import { COMPANY } from '@/config/company';
import type { Unterzeichner } from '../unterzeichner';
import type { RGB } from './briefLayout';
import { pdfText } from './pdfText';

const ROT: RGB = [255, 0, 0];
const GRAU: RGB = [128, 128, 128];
const DUNKEL: RGB = [51, 51, 51];
const SCHWARZ: RGB = [0, 0, 0];

const LINKS = 20;
const RECHTS = 190;
const BREITE = RECHTS - LINKS;
const SCHRIFT = 11;
const ZEILE = 4.6;
/** Letzte Grundlinie über der Fußzeile */
const MAX_Y = 252;
const FOLGESEITE_Y = 40;
const BETREFF_Y = 92;
/** Einzug der Aufzählung: Punkt und Text wie in der Vorlage */
const PUNKT_X = 26.5;
const LISTE_X = 32.5;

const LOGO_SEITENVERHAELTNIS = 547 / 480;

export interface Briefbilder {
  logo: string | null;
  ihk: string | null;
  creditreform: string | null;
}

const bildCache = new Map<string, string>();

async function ladeBild(pfad: string): Promise<string | null> {
  const vorhanden = bildCache.get(pfad);
  if (vorhanden) return vorhanden;
  try {
    const res = await fetch(pfad);
    if (!res.ok) return null;
    const blob = await res.blob();
    // Eine SPA-Weiterleitung liefert für fehlende Dateien index.html mit 200. Geprüft wird die Signatur (PNG, JPEG),
    // nicht der Content-Type — den setzt nicht jeder Server richtig.
    const sig = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (!((sig[0] === 0x89 && sig[1] === 0x50) || (sig[0] === 0xff && sig[1] === 0xd8))) return null;
    const daten = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (daten) bildCache.set(pfad, daten);
    return daten;
  } catch {
    return null;
  }
}

/** Fehlt ein Bild, bleibt die Stelle leer — das Schreiben entsteht trotzdem. */
export async function ladeBriefbilder(): Promise<Briefbilder> {
  const [logo, ihk, creditreform] = await Promise.all([
    ladeBild('/brief/niimmo-logo.png'),
    ladeBild('/brief/ihk-hannover.png'),
    ladeBild('/brief/creditreform.jpg'),
  ]);
  return { logo, ihk, creditreform };
}

export interface Briefkopf {
  /** „Frau“ / „Herrn“ über dem Namen, leer ohne Anrede */
  anschrift?: string;
  /** Fett; mehrere Personen mit eigener Anrede je eine Zeile */
  name: string | string[];
  /** Straße, PLZ und Ort */
  zeilen: string[];
  /** TT.MM.JJJJ */
  datum: string;
  betreff: string;
  /** Steht im Rückfragenblock und unterschreibt — eine Person für das ganze Schreiben */
  unterzeichner: Unterzeichner;
}

export interface Brief {
  /** Briefanrede; mehrere Personen stehen wie in der Vorlage je auf einer Zeile. */
  anrede(gruss: string): void;
  /** Mit `titel` steht eine fette Überschrift unmittelbar darüber und bleibt mit dem Absatz zusammen. */
  absatz(text: string, opts?: { fett?: boolean; blocksatz?: boolean; titel?: string }): void;
  aufzaehlung(punkte: string[]): void;
  /** Text aus einem Eingabefeld: jede Zeile ein Absatz, eingerückte Zeilen eine Aufzählung */
  freitext(text: string): void;
  /** Betragstabelle: erste Spalte links, die übrigen rechtsbündig; bleibt mit ihrem Einleitungssatz auf einer Seite */
  tabelle(spalten: string[], zeilen: Array<{ zellen: string[]; fett?: boolean }>, opts?: { einleitung?: string }): void;
  /**
   * Schlusssatz, Grußformel, Unterschriftsraum, Name und Funktion des Unterzeichners — nie getrennt, damit keine
   * Seite nur den Gruß trägt
   */
  schluss(opts: { satz?: string }): void;
  /** Fußzeilen und Seitenzahlen setzen, PDF liefern. */
  fertig(): Blob;
}

/**
 * „Sehr geehrte Frau A, sehr geehrter Herr B,“ → je Person eine Zeile. Getrennt wird nur vor einer weiteren
 * Anrede, damit Kommas in Namen stehen bleiben.
 */
export function anredeZeilen(gruss: string): string[] {
  return gruss.split(/,\s+(?=sehr geehrte)/).map((teil, i, alle) => (i < alle.length - 1 ? `${teil},` : teil));
}

/**
 * Freitext aus einem Eingabefeld: jede Zeile ein Absatz, eingerückte Zeilen bilden eine Aufzählung (so belegt der
 * Mahnungsdialog die offenen Posten vor), Leerzeilen fallen weg.
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

/** Hält Betrag und Währung sowie Paragraphenzeichen und Zahl in einer Zeile („2.562,00 €“, „§ 288“). */
export function geschuetzt(text: string): string {
  return text.replace(/(\d) €/g, '$1\u00A0€').replace(/(§§?) (\d)/g, '$1\u00A0$2');
}

/**
 * Normbreiten (1/1000 em, in Helvetica und Helvetica fett gleich) der Zeichen, die jsPDF nicht kennt und mit einem
 * Ersatzwert von etwa 530 misst.
 */
const NORMBREITE: Record<string, number> = {
  '\u00A0': 278, '¹': 333, '²': 333, '³': 333, '¼': 834, '½': 834, '¾': 834, '×': 584,
};

/**
 * Breite wie gedruckt. jsPDF misst etwa das geschützte Leerzeichen fast doppelt so breit, wie es druckt (2,06 statt
 * 1,09 mm bei 11 pt): Im Blocksatz stand nach „§ 558“, nach jedem Betrag und nach „m²“ eine doppelte Lücke, und
 * Beträge endeten vor der Tabellenkante (31.10.2026).
 */
export function druckBreite(doc: jsPDF, text: string): number {
  const em = doc.getFontSize() / doc.internal.scaleFactor;
  let breite = doc.getTextWidth(text);
  for (const zeichen of text) {
    const norm = NORMBREITE[zeichen];
    if (norm !== undefined) breite += (norm / 1000) * em - doc.getTextWidth(zeichen);
  }
  return breite;
}

/** Namen und Freitext können Zeichen außerhalb von CP1252 enthalten, die jsPDF als Zeichensalat druckt. */
function druck(text: string): string {
  return geschuetzt(pdfText(text));
}

/** Ein beschädigtes Bild lässt seine Stelle leer, statt das ganze Schreiben zu verhindern. */
function bildSetzen(doc: jsPDF, daten: string | null, format: 'PNG' | 'JPEG', x: number, y: number, b: number, h: number, alias: string): void {
  if (!daten) return;
  try {
    doc.addImage(daten, format, x, y, b, h, alias);
  } catch {
    // Stelle bleibt leer; das fehlende Bild sieht man auf dem Schreiben selbst
  }
}

export function beginneBrief(doc: jsPDF, bilder: Briefbilder, kopf: Briefkopf): Brief {
  let y = 0;
  let blockAmSeitenanfang = true;
  let letzterBlockListe = false;

  function schrift(groesse: number, stil: 'normal' | 'bold' = 'normal', farbe: RGB = SCHWARZ): void {
    doc.setFont('helvetica', stil);
    doc.setFontSize(groesse);
    doc.setTextColor(...farbe);
  }

  function roteLinie(x1: number, y1: number, x2: number, y2: number): void {
    doc.setDrawColor(...ROT);
    doc.setLineWidth(0.3);
    doc.line(x1, y1, x2, y2);
  }

  function ersteSeite(): void {
    const logoBreite = 33.8;
    bildSetzen(doc, bilder.logo, 'PNG', (210 - logoBreite) / 2, 4.5, logoBreite, logoBreite * LOGO_SEITENVERHAELTNIS, 'brief-logo');
    roteLinie(LINKS, 44.1, RECHTS, 44.1);

    // Absenderzeile, unterstrichen
    schrift(7, 'normal', DUNKEL);
    const absender = COMPANY.anschriftEinzeilig;
    doc.text(absender, LINKS, 53.3);
    doc.setDrawColor(...DUNKEL);
    doc.setLineWidth(0.15);
    doc.line(LINKS, 53.9, LINKS + doc.getTextWidth(absender), 53.9);

    // Anschrift; Name und Zeilen dürfen bis vor den Rückfragenblock umbrechen
    let ay = 57.8;
    if (kopf.anschrift) {
      schrift(SCHRIFT);
      doc.text(druck(kopf.anschrift), LINKS, ay);
      ay += ZEILE;
    }
    schrift(SCHRIFT, 'bold');
    for (const zeile of [kopf.name].flat().flatMap((n) => doc.splitTextToSize(druck(n), 110) as string[])) {
      doc.text(zeile, LINKS, ay);
      ay += ZEILE;
    }
    schrift(SCHRIFT);
    for (const zeile of kopf.zeilen.filter((z) => z.trim()).flatMap((z) => doc.splitTextToSize(druck(z), 110) as string[])) {
      doc.text(zeile, LINKS, ay);
      ay += ZEILE;
    }

    // Rückfragenblock
    roteLinie(134.9, 55.4, 134.9, 77.6);
    const lx = 137.6;
    const wx = 147;
    schrift(8, 'bold', GRAU);
    doc.text('Rückfragen richten Sie bitte an:', lx, 57.9);
    const kontakt: Array<[string, string]> = [
      ['', kopf.unterzeichner.kontaktname],
      ['Tel.', kopf.unterzeichner.telefon],
      ['Fax', COMPANY.ansprechpartner.fax],
      ['', `${COMPANY.strasse}, ${COMPANY.plzOrt}`],
      ['E-Mail', kopf.unterzeichner.email],
    ];
    kontakt.forEach(([label, wert], i) => {
      const ky = 62.3 + i * 3.3;
      if (label) {
        schrift(7, 'normal', GRAU);
        doc.text(label, lx, ky);
      }
      schrift(8, 'normal', DUNKEL);
      doc.text(wert, wx, ky);
    });

    schrift(SCHRIFT);
    doc.text(`${COMPANY.ort}, ${kopf.datum}`, RECHTS, 82.3, { align: 'right' });

    // Betreff; zu lang für eine Zeile, steht die Anschrift des Objekts in der zweiten
    y = Math.max(BETREFF_Y, ay + ZEILE);
    schrift(SCHRIFT, 'bold');
    const betreff = druck(kopf.betreff);
    const betreffTeile = druckBreite(doc, betreff) > BREITE ? betreff.split(' – ') : [betreff];
    for (const zeile of betreffTeile.flatMap((teil) => doc.splitTextToSize(teil, BREITE) as string[])) {
      doc.text(zeile, LINKS, y);
      y += ZEILE;
    }
    blockAmSeitenanfang = false;
  }

  function folgeseite(): void {
    doc.addPage();
    const logoBreite = 14;
    bildSetzen(doc, bilder.logo, 'PNG', (210 - logoBreite) / 2, 7, logoBreite, logoBreite * LOGO_SEITENVERHAELTNIS, 'brief-logo');
    roteLinie(LINKS, 26, RECHTS, 26);
    y = FOLGESEITE_Y;
    blockAmSeitenanfang = true;
  }

  /**
   * Bricht um, wenn die nächsten `zeilen` nicht mehr über die Fußzeile passen. Wer danach zeichnet, steht
   * nicht mehr am Seitenanfang — sonst fehlte nach einer umbrochenen Liste die Leerzeile zum nächsten Absatz.
   */
  function platz(zeilen: number): void {
    if (y + (zeilen - 1) * ZEILE > MAX_Y) folgeseite();
    blockAmSeitenanfang = false;
  }

  /**
   * Leerzeile vor jedem Block, außer oben auf einer Folgeseite. Um Aufzählungen nur eine halbe: Die Mahnung
   * hat mehr Listen als die Vorlage und passte mit vollen Leerzeilen nicht mehr auf eine Seite.
   */
  function neuerBlock(mindestZeilen: number, liste = false): void {
    if (!blockAmSeitenanfang) y += liste || letzterBlockListe ? ZEILE / 2 : ZEILE;
    platz(mindestZeilen);
    letzterBlockListe = liste;
  }

  function zeileSetzen(text: string, x: number, breite: number, ausgleichen: boolean): void {
    const woerter = text.split(' ').filter(Boolean);
    if (!ausgleichen || woerter.length < 2) {
      doc.text(text, x, y);
      return;
    }
    const luecke = (breite - woerter.reduce((s, w) => s + druckBreite(doc, w), 0)) / (woerter.length - 1);
    let cx = x;
    for (const wort of woerter) {
      doc.text(wort, cx, y);
      cx += druckBreite(doc, wort) + luecke;
    }
  }

  function linie(ly: number): void {
    doc.setDrawColor(...DUNKEL);
    doc.setLineWidth(0.2);
    doc.line(LINKS, ly, RECHTS, ly);
  }

  ersteSeite();

  const brief: Brief = {
    anrede(gruss) {
      const zeilen = anredeZeilen(druck(gruss));
      neuerBlock(zeilen.length);
      schrift(SCHRIFT);
      for (const zeile of zeilen) {
        doc.text(zeile, LINKS, y);
        y += ZEILE;
      }
    },

    absatz(text, { fett = false, blocksatz = true, titel } = {}) {
      schrift(SCHRIFT, fett ? 'bold' : 'normal');
      const zeilen = doc.splitTextToSize(druck(text), BREITE) as string[];
      // Kein einzelner Absatzanfang unten auf der Seite, keine Überschrift ohne ihren Absatz
      neuerBlock(Math.min(zeilen.length, 2) + (titel ? 1 : 0));
      if (titel) {
        schrift(SCHRIFT, 'bold');
        doc.text(druck(titel), LINKS, y);
        y += ZEILE;
      }
      zeilen.forEach((zeile, i) => {
        platz(1);
        schrift(SCHRIFT, fett ? 'bold' : 'normal');
        zeileSetzen(zeile, LINKS, BREITE, blocksatz && i < zeilen.length - 1);
        y += ZEILE;
      });
    },

    aufzaehlung(punkte) {
      if (punkte.length === 0) return;
      neuerBlock(Math.min(punkte.length, 2), true);
      for (const punkt of punkte) {
        schrift(SCHRIFT);
        const zeilen = doc.splitTextToSize(druck(punkt), RECHTS - LISTE_X) as string[];
        platz(zeilen.length);
        schrift(SCHRIFT);
        doc.text('•', PUNKT_X, y);
        for (const zeile of zeilen) {
          doc.text(zeile, LISTE_X, y);
          y += ZEILE;
        }
      }
    },

    freitext(text) {
      for (const block of freitextBloecke(text)) {
        if (block.art === 'liste') brief.aufzaehlung(block.zeilen);
        else block.zeilen.forEach((z) => brief.absatz(z));
      }
    },

    tabelle(spalten, zeilen, { einleitung } = {}) {
      const abstand = ZEILE * 1.3;
      schrift(SCHRIFT);
      const einleitungZeilen = einleitung ? (doc.splitTextToSize(druck(einleitung), BREITE) as string[]) : [];
      if (!blockAmSeitenanfang) y += letzterBlockListe ? ZEILE / 2 : ZEILE;
      // Einleitung, Leerzeile und alle Zeilen bleiben zusammen — kein „wie folgt dar:“ allein unten auf der Seite
      const bisKopf = einleitungZeilen.length ? (einleitungZeilen.length + 1) * ZEILE : 0;
      if (y + bisKopf + zeilen.length * abstand > MAX_Y) folgeseite();
      blockAmSeitenanfang = false;
      letzterBlockListe = false;
      einleitungZeilen.forEach((zeile, i) => {
        schrift(SCHRIFT);
        zeileSetzen(zeile, LINKS, BREITE, i < einleitungZeilen.length - 1);
        y += ZEILE;
      });
      if (einleitungZeilen.length) y += ZEILE;
      // Betragsspalten je 36 mm, die letzte endet am rechten Rand
      const rechteKante = (i: number) => RECHTS - (spalten.length - 1 - i) * 36;
      const zeileSetzenTabelle = (zellen: string[], fett: boolean) => {
        schrift(SCHRIFT, fett ? 'bold' : 'normal');
        zellen.forEach((zelle, i) => {
          const text = druck(zelle);
          if (i === 0) doc.text(text, LINKS, y);
          else if (text) doc.text(text, rechteKante(i) - druckBreite(doc, text), y);
        });
      };
      zeileSetzenTabelle(spalten, true);
      linie(y + 1.8);
      zeilen.forEach((zeile, i) => {
        y += abstand;
        // Summenzeilen trennt eine Linie vom Rest
        if (zeile.fett && i > 0 && !zeilen[i - 1].fett) linie(y - abstand + 1.8);
        zeileSetzenTabelle(zeile.zellen, !!zeile.fett);
      });
      y += ZEILE;
    },

    schluss({ satz }) {
      const { unterschrift, funktion } = kopf.unterzeichner;
      schrift(SCHRIFT);
      const satzZeilen = satz ? (doc.splitTextToSize(druck(satz), BREITE) as string[]) : [];
      // Satz, Leerzeile, Gruß, drei Leerzeilen für die Unterschrift (DIN 5008), Name, Funktion
      const hoehe = (satzZeilen.length ? satzZeilen.length * ZEILE + ZEILE : 0) + 4 * ZEILE + 4;
      if (!blockAmSeitenanfang) y += letzterBlockListe ? ZEILE / 2 : ZEILE;
      // y + hoehe ist genau die Grundlinie der Funktionszeile
      if (y + hoehe > MAX_Y) folgeseite();
      schrift(SCHRIFT);
      satzZeilen.forEach((zeile, i) => {
        zeileSetzen(zeile, LINKS, BREITE, i < satzZeilen.length - 1);
        y += ZEILE;
      });
      if (satzZeilen.length) y += ZEILE;
      doc.text('Mit freundlichem Gruß', LINKS, y);
      y += 4 * ZEILE;
      doc.text(druck(unterschrift), LINKS, y);
      y += 4;
      schrift(8);
      doc.text(druck(funktion), LINKS, y);
      blockAmSeitenanfang = false;
      letzterBlockListe = false;
    },

    fertig() {
      const seiten = doc.getNumberOfPages();
      for (let seite = 1; seite <= seiten; seite++) {
        doc.setPage(seite);
        fusszeile(doc, bilder);
        if (seite > 1) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...GRAU);
          doc.text(`Seite ${seite} von ${seiten}`, RECHTS, 30, { align: 'right' });
        }
      }
      return doc.output('blob');
    },
  };
  return brief;
}

function fusszeile(doc: jsPDF, bilder: Briefbilder): void {
  doc.setDrawColor(...ROT);
  doc.setLineWidth(0.3);
  doc.line(19.5, 260.5, 19.5, 291.5);
  doc.line(101.2, 260.5, 101.2, 291.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...GRAU);
  const links = [
    'Vertretungsberechtigte Geschäftsführer:',
    COMPANY.geschaeftsfuehrer,
    'Registergericht:',
    `${COMPANY.register.gericht} ${COMPANY.register.abteilung}`,
    'Registernummer:',
    COMPANY.register.nummer,
    `${COMPANY.gewerbeerlaubnis.grundlage}; Aufsichtsbehörde:`,
    COMPANY.gewerbeerlaubnis.aufsicht,
    'Steuer-Nummer:',
    COMPANY.steuernummer,
  ];
  links.forEach((zeile, i) => doc.text(zeile, 22.3, 263.5 + i * 2.75));

  doc.text('Mitglied in:', 103, 263.5);
  bildSetzen(doc, bilder.ihk, 'PNG', 103, 265.5, 33, 33 * (95 / 344), 'brief-ihk');
  bildSetzen(doc, bilder.creditreform, 'JPEG', 103.5, 275.5, 29.4, 29.4 * (200 / 576), 'brief-creditreform');
}
