/**
 * Erzeugt den Mietvertrag als PDF im Seitenbild der Word-Vorlage
 * „20250601 MV.docx“ (seit 04.11.2026, Kundenwunsch „genau so nachbilden,
 * Logo fehlt“): Logo rechts oben auf jeder Seite, Titel zentriert, Rubrum mit
 * Tabstopp und den Feldbeschriftungen unter den Werten, Paragraphen mit
 * hängenden Ziffern im Blocksatz, Unterschriftszeilen in zwei Spalten.
 * Maße und Schrift in `vertragsLayout`.
 *
 * Die Länge ist nicht vorhersagbar, deshalb paginiert jeder Absatz selbst und
 * die Seitenzahlen entstehen erst am Ende.
 */
import jsPDF from 'jspdf';
import { formatDatum } from '../pdf/briefLayout';
import { ladeBild } from '../pdf/briefbogen';
import { anlagenFuerVertrag, type Anlage } from './anlagen';
import { wohnraumParagraphen, type Absatz, type Paragraph } from './wohnraumKlauseln';
import type { MieterDaten, MietvertragDaten } from './typen';
import { vermieterVertretung, vertreterMitTitel, vertreterTeile } from './vertretung';
import {
  ABSTAND,
  GROESSE,
  RAND,
  RUBRUM_EINZUG,
  SEITE_BREITE,
  TEXTBREITE,
  UEBERSCHRIFT_HOEHE,
  ZEILE,
  ladeVertragsschrift,
  vertragsLayout,
  type Vertragsschrift,
  type VertragsLayout,
} from './vertragsLayout';

const RUBRUM_X = RAND + RUBRUM_EINZUG;
const RECHTS = RAND + TEXTBREITE;
/** Linie und Beschriftung der dreispaltigen Unterschrift einer Anlage */
const UNTERSCHRIFT_ANLAGE_ZEILE = ZEILE + 1.5;
const UNTERSCHRIFT_ANLAGE_HOEHE = 14 + UNTERSCHRIFT_ANLAGE_ZEILE;
/** Abschnittstitel einer Anlage */
const ABSCHNITT_KOPF_VOR = 1;
const ABSCHNITT_KOPF_NACH = ZEILE + 0.6;

export interface PdfMittel {
  /** Carlito als Base64; ohne Angabe wird sie geladen, null erzwingt Helvetica */
  schrift?: Vertragsschrift | null;
  /** Logo als Data-URL; ohne Angabe wird es geladen */
  logo?: string | null;
}

export async function generateMietvertragPdf(d: MietvertragDaten, mittel: PdfMittel = {}): Promise<Blob> {
  const [schrift, logo] = await Promise.all([
    mittel.schrift !== undefined ? mittel.schrift : ladeSchriftMitWiederholung(),
    mittel.logo !== undefined ? mittel.logo : ladeBild('/brief/niimmo-logo.png'),
  ]);
  // Im Browser kein PDF in Ersatzschrift: Es hätte andere Umbrüche und Seiten als die Vorschau zuvor und
  // würde unbemerkt gespeichert (Review 05.11.2026). In Node und den Tests gibt es kein fetch auf /fonts.
  if (mittel.schrift === undefined && !schrift && typeof window !== 'undefined') {
    throw new Error('Die Schrift des Vertrags konnte nicht geladen werden. Bitte die Seite neu laden und erneut versuchen.');
  }

  // Komprimiert nur mit eingebetteter Schrift — die Tests lesen den Helvetica-Text direkt aus dem PDF
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: !!schrift });
  const layout = vertragsLayout(doc, { schrift, logo });

  let y = titelseite(doc, layout, d);

  const paragraphen = wohnraumParagraphen(d);
  const blockHoehe = unterschriftsblockHoehe(d);
  paragraphen.forEach((p, i) => {
    y = paragraphRendern(layout, p, y, i === paragraphen.length - 1 ? blockHoehe : 0);
  });

  unterschriftsblock(doc, layout, d, y);

  for (const anlage of anlagenFuerVertrag(d)) {
    anlageRendern(doc, layout, anlage);
  }

  layout.seitenzahlen();
  return doc.output('blob');
}

async function ladeSchriftMitWiederholung(): Promise<Vertragsschrift | null> {
  return (await ladeVertragsschrift()) ?? (typeof window !== 'undefined' ? ladeVertragsschrift() : null);
}

// ─── Titelseite ──────────────────────────────────────────────────────────────

function titelseite(doc: jsPDF, layout: VertragsLayout, d: MietvertragDaten): number {
  let y = 44;
  layout.schrift(18, true);
  doc.text('Mietvertrag', SEITE_BREITE / 2, y, { align: 'center' });
  y += 14;

  // ── Vermieterseite, wie in der Vorlage „Firma“ und Firmenname fett
  layout.schrift();
  doc.text('zwischen', RAND, y);
  const v = d.vermieter;
  if (v.rechtsform) {
    layout.schrift(GROESSE, true);
    doc.text('Firma', RUBRUM_X, y);
    y += ZEILE;
  }
  layout.schrift(GROESSE, true);
  doc.text(v.firmenname, RUBRUM_X, y);
  layout.schrift();
  y += ZEILE;

  const vertretung = vermieterVertretung(d);
  if (vertretung.namen.length > 0) {
    const wort = vertretung.gemeinsam ? 'gemeinsam vertreten durch' : 'vertreten durch';
    const namen = vertretung.namen.map(vertreterMitTitel).join(' und ');
    y = mehrzeilig(doc, `${wort} ${namen}`, y);
  }
  doc.text(`${v.strasse} ${v.hausnummer}`.trim(), RUBRUM_X, y);
  y += ZEILE;
  doc.text(`${v.plz} ${v.ort}`.trim(), RUBRUM_X, y);
  y += ZEILE + 3;

  doc.text('als Vermieter', RECHTS, y, { align: 'right' });
  y += ZEILE + 6;

  // ── Mieterseite
  doc.text('und', RAND, y);
  d.mieter.forEach((m, i) => {
    if (i > 0) y += 4;
    y = layout.umbruch(y, 26);
    y = mieterZeilen(doc, layout, m, y);
  });

  y += 2;
  layout.schrift();
  doc.text('als Mieter', RECHTS, y, { align: 'right' });
  y += ZEILE + 6;

  doc.text('wird folgender Mietvertrag vereinbart:', RAND, y);
  return y + ZEILE + 2;
}

/** Rubrumszeile, die bei langen Namen auf der Tabstoppspalte weiterläuft. */
function mehrzeilig(doc: jsPDF, text: string, y: number): number {
  const zeilen = doc.splitTextToSize(text, RECHTS - RUBRUM_X) as string[];
  zeilen.forEach(z => {
    doc.text(z, RUBRUM_X, y);
    y += ZEILE;
  });
  return y;
}

/** Wert und darunter die kleine Beschriftung, wie in der Vorlage („Vor- und Zuname“). */
function wertMitBeschriftung(doc: jsPDF, layout: VertragsLayout, wert: string, beschriftung: string, y: number): number {
  layout.schrift();
  y = mehrzeilig(doc, wert, y);
  layout.schrift(8);
  doc.text(beschriftung, RUBRUM_X, y - 0.9);
  layout.schrift();
  return y + 3.6;
}

function mieterZeilen(doc: jsPDF, layout: VertragsLayout, m: MieterDaten, y: number): number {
  if (m.istUnternehmen) {
    layout.schrift(GROESSE, true);
    doc.text('Firma', RUBRUM_X, y);
    y += ZEILE;
    y = mehrzeilig(doc, m.firmenname ?? '', y);
    layout.schrift();
    if (m.vertretenDurch) y = mehrzeilig(doc, `vertreten durch ${m.vertretenDurch}`, y);
    y += 1.5;
  } else {
    y = wertMitBeschriftung(doc, layout, `${m.vorname} ${m.nachname}`.trim(), 'Vor- und Zuname', y);
    if (m.geburtsdatum) y = wertMitBeschriftung(doc, layout, formatDatum(m.geburtsdatum), 'Geburtsdatum', y);
  }

  if (m.strasse) {
    const anschrift = `${`${m.strasse} ${m.hausnummer ?? ''}`.trim()}, ${`${m.plz ?? ''} ${m.ort ?? ''}`.trim()}`;
    y = wertMitBeschriftung(doc, layout, anschrift, 'Zur Zeit wohnhaft in', y);
  }
  return y;
}

// ─── Paragraphen ─────────────────────────────────────────────────────────────

const hatText = (a: Absatz): boolean => !a.kosten && !a.tabelle && !!a.text.trim();

/**
 * Absätze eines Paragraphen. `reserve` ist die Höhe, die danach auf derselben Seite frei bleiben muss: Eine Unterschrift
 * steht nie allein auf einer Seite, der letzte Textabsatz wandert mit (Review und QA 08.11.2026). Tabellen lassen sich
 * vorab nicht messen; hinter dem letzten Textabsatz steht vor einer Unterschrift keine.
 */
function absaetzeRendern(layout: VertragsLayout, absaetze: Absatz[], y: number, reserve: number): number {
  const anker = reserve > 0 ? absaetze.map(hatText).lastIndexOf(true) : -1;
  // Was nach einer Ziffer ohne eigene Ziffer folgt, gehört zu ihr und steht auf dem Tabstopp
  let nachZiffer = false;
  absaetze.forEach((a, i) => {
    if (i === anker) y = layout.umbruch(y, absaetzeHoehe(layout, absaetze.slice(i), nachZiffer) + reserve);
    y = absatzRendern(layout, a, y, nachZiffer);
    if (a.nummer) nachZiffer = true;
  });
  return y;
}

/** Höhe, die `absaetzeRendern` für diese Absätze belegt. Tabellen zählen nur mit ihrem Abstand. */
function absaetzeHoehe(layout: VertragsLayout, absaetze: Absatz[], nachZifferAmAnfang = false): number {
  let nachZiffer = nachZifferAmAnfang;
  let hoehe = 0;
  for (const a of absaetze) {
    if (a.text.trim()) {
      hoehe += layout.absatzHoehe(a.text, { nummer: a.nummer, einzug: !a.nummer && nachZiffer, fett: a.bold }) + (a.eng ? 0.7 : ABSTAND);
    } else {
      hoehe += ABSTAND;
    }
    if (a.nummer) nachZiffer = true;
  }
  return hoehe;
}

/** Steht unter einer Überschrift nur der Absatz vor der Unterschrift, wandert die Überschrift mit ihm. */
function einzigerAbsatzVorUnterschrift(absaetze: Absatz[], reserve: number): boolean {
  return reserve > 0 && absaetze.filter(hatText).length === 1;
}

export function paragraphRendern(layout: VertragsLayout, p: Paragraph, y: number, reserve: number): number {
  if (einzigerAbsatzVorUnterschrift(p.absaetze, reserve)) {
    y = layout.umbruch(y, UEBERSCHRIFT_HOEHE + absaetzeHoehe(layout, p.absaetze) + reserve);
  }
  y = layout.ueberschrift(`${p.nummer} ${p.titel}`, y);
  return absaetzeRendern(layout, p.absaetze, y, reserve);
}

function absatzRendern(layout: VertragsLayout, a: Absatz, y: number, nachZiffer: boolean): number {
  if (a.kosten) return layout.kostentabelle(a.kosten, y + 1) + ABSTAND;
  if (a.tabelle) return layout.summentabelle(a.tabelle, y + 1) + ABSTAND;
  if (!a.text.trim()) return y + ABSTAND;
  return (
    layout.absatz(a.text, y, {
      nummer: a.nummer,
      einzug: !a.nummer && nachZiffer,
      fett: a.bold,
      linksbuendig: a.linksbuendig,
    }) + (a.eng ? 0.7 : ABSTAND)
  );
}

// ─── Unterschriften ──────────────────────────────────────────────────────────

function unterschriftsblockHoehe(d: MietvertragDaten): number {
  return 14 + 26 + Math.max(vermieterVertretung(d).linien, d.mieter.length) * 24;
}

/**
 * Zwei Spalten wie in der Vorlage: Ort/Datum-Linie, darunter die
 * Unterschriftslinie mit „Vermieter“ bzw. „Mieter“. Unter „Vermieter“ stehen
 * Name und Titel des Unterzeichners (Kundenwunsch 04.11.2026), bei
 * Gesamtvertretung jeder auf seiner eigenen Linie.
 */
function unterschriftsblock(doc: jsPDF, layout: VertragsLayout, d: MietvertragDaten, y: number): number {
  const vertretung = vermieterVertretung(d);
  const vermieter = vertretung.namen.length > 0 ? vertretung.namen.map(vertreterTeile) : [{ name: d.vermieter.firmenname, titel: null }];
  const linien = Math.max(vertretung.linien, d.mieter.length);

  const links = RAND + 6;
  const spalte2 = RAND + 88;
  const breite = 66;

  y = layout.umbruch(y + 14, 26 + linien * 24);

  const ortDatum = d.unterschriftOrt && d.vertragsdatum ? `${d.unterschriftOrt}, den ${formatDatum(d.vertragsdatum)}` : '';
  for (const x of [links, spalte2]) {
    layout.schrift();
    if (ortDatum) doc.text(ortDatum, x, y - 1.5);
    layout.linie(x, y, breite);
    doc.text('(Ort, Datum)', x, y + ZEILE);
  }
  y += 22;

  for (let i = 0; i < linien; i++) {
    y = layout.umbruch(y, 24);
    if (i < vertretung.linien) {
      const person = vermieter[i] ?? vermieter[0];
      layout.linie(links, y, breite);
      beschriftung(doc, layout, i === 0 ? 'Vermieter' : '', links, y, person.name, person.titel);
    }
    if (i < d.mieter.length) {
      const m = d.mieter[i];
      const name = m.istUnternehmen ? (m.firmenname ?? '') : `${m.vorname} ${m.nachname}`.trim();
      layout.linie(spalte2, y, breite);
      beschriftung(doc, layout, i === 0 ? 'Mieter' : '', spalte2, y, name, null);
    }
    y += 24;
  }
  return y;
}

/** Rolle unter der Linie, darunter Name und — falls hinterlegt — der Titel. */
function beschriftung(
  doc: jsPDF,
  layout: VertragsLayout,
  rolle: string,
  x: number,
  y: number,
  name: string,
  titel: string | null
): void {
  let zeile = y + ZEILE;
  if (rolle) {
    layout.schrift();
    doc.text(rolle, x, zeile);
    zeile += ZEILE;
  }
  if (name) {
    layout.schrift(9);
    doc.text(name, x, zeile);
    zeile += 3.8;
  }
  if (titel) {
    layout.schrift(9);
    doc.text(titel, x, zeile);
  }
}

// ─── Anlagen ─────────────────────────────────────────────────────────────────

/** Wie „Allgemeine Hausordnung“ in der Vorlage: Titel fett und zentriert, Zwischenüberschriften fett. */
export function anlageRendern(doc: jsPDF, layout: VertragsLayout, anlage: Anlage): void {
  let y = layout.neueSeite() + 4;

  y = layout.absatz(anlage.titel, y, { fett: true, groesse: 11, zentriert: true });
  layout.schrift(8.5, false, true);
  doc.text(`${anlage.kennung} zum Mietvertrag`, SEITE_BREITE / 2, y, { align: 'center' });
  y += 8;

  if (anlage.vorspann) y = layout.absatz(anlage.vorspann, y) + ABSTAND;

  anlage.abschnitte.forEach((abschnitt, i) => {
    const letzter = anlage.unterschrift && i === anlage.abschnitte.length - 1;
    const reserve = letzter ? UNTERSCHRIFT_ANLAGE_HOEHE : 0;
    // Ein Formular samt Unterschrift bleibt ganz auf einer Seite: Es wird ausgefüllt zurückgeschickt.
    if (abschnitt.zusammenhalten || einzigerAbsatzVorUnterschrift(abschnitt.absaetze, reserve)) {
      const kopf = abschnitt.titel ? ABSCHNITT_KOPF_VOR + ABSCHNITT_KOPF_NACH : 0;
      y = layout.umbruch(y, kopf + absaetzeHoehe(layout, abschnitt.absaetze) + reserve);
    }
    if (abschnitt.titel) {
      y = layout.umbruch(y + ABSCHNITT_KOPF_VOR, 3 * ZEILE);
      layout.schrift(GROESSE, true);
      doc.text(abschnitt.nummer ? `${abschnitt.nummer} ${abschnitt.titel}` : abschnitt.titel, RAND, y);
      y += ABSCHNITT_KOPF_NACH;
    }
    y = absaetzeRendern(layout, abschnitt.absaetze, y, reserve);
  });

  if (anlage.unterschrift) {
    // Dreispaltig wie in der Vorlage: Datum, Vermieter, Mieter
    y = layout.umbruch(y + 14, UNTERSCHRIFT_ANLAGE_ZEILE);
    const spalten = [RAND, RAND + 46, RAND + 104];
    const breiten = [40, 52, 52];
    const rollen = ['(Datum)', '(Vermieter)', '(Mieter)'];
    spalten.forEach((x, i) => {
      layout.linie(x, y, breiten[i]);
      layout.schrift();
      doc.text(rollen[i], x, y + ZEILE);
    });
  }
}
