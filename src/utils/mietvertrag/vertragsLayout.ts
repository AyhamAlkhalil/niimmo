/**
 * Seitenbild des Mietvertrags nach der Word-Vorlage „20250601 MV.docx“.
 *
 * Kundenwunsch vom 04.11.2026: „Formatierung ist bisschen komisch … genau so
 * nachbilden. Logo fehlt.“ Die Maße stammen aus der Vorlage: Calibri 10 pt im
 * Blocksatz, die Ziffer am linken Rand und der Text auf dem Tabstopp 1,27 cm
 * (hängend), Titel 18 pt fett zentriert, das NiImmo-Logo rechts oben auf jeder
 * Seite, die Seitenzahl unten mittig. Die Vorlage ist US Letter mit 3 cm Rand;
 * auf A4 bleiben links und rechts 2,7 cm, damit die Zeile wie in Word 15,6 cm
 * lang ist und gleich umbricht.
 *
 * Calibri darf nicht mitgeliefert werden. Carlito (SIL OFL, Lizenz in
 * public/fonts) hat dieselben Zeichenbreiten. Fehlt die Schrift — in Node und
 * in den Tests gibt es kein `fetch` auf relative Pfade —, setzt das Layout
 * Helvetica; der Vertrag entsteht trotzdem.
 */
import type jsPDF from 'jspdf';

import { istIbanGueltig, type TabellenZeile } from '../pdf/briefLayout';

export const SEITE_BREITE = 210;
export const SEITE_HOEHE = 297;
export const RAND = 27;
export const TEXTBREITE = SEITE_BREITE - 2 * RAND;
/** Tabstopp der Ziffern (720 twips in der Vorlage). */
export const EINZUG = 12.7;
/** Tabstopp der Werte im Rubrum („zwischen … Firma“). */
export const RUBRUM_EINZUG = 25.4;
/** Erste Grundlinie einer Seite, unter dem Logo. */
export const OBEN = 38;
/** Letzte Grundlinie vor dem Fuß. */
const UNTEN = 266;

export const GROESSE = 10;
/** Einfacher Zeilenabstand bei Calibri 10 pt (12,2 pt). */
export const ZEILE = 4.3;
/** Abstand nach einem Absatz — die Vorlage trennt mit einer Leerzeile kleiner Schrift. */
export const ABSTAND = 2.6;

const SCHWARZ: [number, number, number] = [0, 0, 0];
const GRAU: [number, number, number] = [90, 90, 90];

const LOGO_BREITE = 21;
const LOGO_HOEHE = (LOGO_BREITE * 547) / 480;

// ─── Schrift ──────────────────────────────────────────────────────────────────

export interface Vertragsschrift {
  /** TTF als Base64 */
  regular: string;
  bold: string;
}

let schriftGeladen: Vertragsschrift | null = null;
let schriftLaedt: Promise<Vertragsschrift | null> | null = null;

async function ladeTtf(pfad: string): Promise<string | null> {
  const res = await fetch(pfad);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Eine SPA-Weiterleitung liefert für fehlende Dateien index.html mit 200 — nur echte TrueType-Dateien annehmen
  if (bytes.length < 4 || bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0) return null;
  let binaer = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binaer);
}

/** Lädt Carlito einmal je Sitzung; scheitert das, liefert sie null und versucht es beim nächsten Vertrag erneut. */
export function ladeVertragsschrift(): Promise<Vertragsschrift | null> {
  if (schriftGeladen) return Promise.resolve(schriftGeladen);
  schriftLaedt ??= (async () => {
    try {
      const [regular, bold] = await Promise.all([ladeTtf('/fonts/Carlito-Regular.ttf'), ladeTtf('/fonts/Carlito-Bold.ttf')]);
      if (regular && bold) schriftGeladen = { regular, bold };
      return schriftGeladen;
    } catch {
      return null;
    } finally {
      schriftLaedt = null;
    }
  })();
  return schriftLaedt;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

const NBSP = '\u00a0';

/**
 * Bindet die Vierergruppen einer IBAN — aber nur so viele, wie zusammen eine
 * gültige IBAN ergeben. Ein kurzes Wort dahinter („BIC“, „UND“) oder eine
 * zweite IBAN sähe sonst wie eine weitere Gruppe aus (QA 05.11.2026). Wörter
 * werden einzeln durchlaufen, damit zwei IBANs hintereinander beide gebunden werden.
 */
function ibanGruppenBinden(text: string): string {
  const woerter = text.split(' ');
  const aus: string[] = [];
  for (let i = 0; i < woerter.length; i++) {
    if (/^[A-Z]{2}\d{2}$/.test(woerter[i])) {
      let laenge = 0;
      for (let n = Math.min(9, woerter.length - i); n >= 3; n--) {
        const gruppen = woerter.slice(i + 1, i + n);
        if (gruppen.every(g => /^[0-9A-Z]{1,4}[,.;:)]?$/.test(g))) {
          const kandidat = woerter.slice(i, i + n).join('').replace(/[,.;:)]$/, '');
          // Satzzeichen nur an der letzten Gruppe
          if (gruppen.slice(0, -1).every(g => /^[0-9A-Z]{1,4}$/.test(g)) && istIbanGueltig(kandidat)) {
            laenge = n;
            break;
          }
        }
      }
      if (laenge > 0) {
        aus.push(woerter.slice(i, i + laenge).join(NBSP));
        i += laenge - 1;
        continue;
      }
    }
    aus.push(woerter[i]);
  }
  return aus.join(' ');
}

/**
 * Geschützte Leerzeichen, wo ein Umbruch den Sinn zerreißt: „70 %“, „1.200,00 €“,
 * „§ 573“, „Abs. 3“, „Ziff. 1“ und die Vierergruppen einer IBAN. Nur mit
 * Carlito — Helvetica misst das geschützte Leerzeichen in jsPDF falsch.
 */
export function schuetzeUmbrueche(text: string): string {
  return ibanGruppenBinden(text)
    .replace(/\b(IBAN|BIC) (?=[A-Z0-9])/g, `$1${NBSP}`)
    .replace(/(\d) (€|%)/g, `$1${NBSP}$2`)
    .replace(/(§§?) (?=\d)/g, `$1${NBSP}`)
    .replace(/\b(Abs\.|Ziff\.|Nr\.|S\.|Art\.|lit\.) (?=[0-9a-z])/g, `$1${NBSP}`);
}

export interface Kostenzeile {
  nummer: string;
  bezeichnung: string;
  /** Verteilerschlüssel, leer bei nicht umgelegten Positionen */
  verteilung: string;
  betrag: string;
}

export interface Kostentabelle {
  kopf: { bezeichnung: string; verteilung: string; betrag: string };
  zeilen: Kostenzeile[];
  summe: { text: string; betrag: string };
}

export interface AbsatzOptionen {
  /** Gliederungsziffer am linken Rand, der Text steht hängend auf dem Tabstopp */
  nummer?: string;
  /** Ohne Ziffer auf dem Tabstopp — Fortsetzung eines nummerierten Punkts */
  einzug?: boolean;
  fett?: boolean;
  linksbuendig?: boolean;
  groesse?: number;
  zentriert?: boolean;
}

export interface VertragsLayout {
  readonly familie: string;
  schrift(groesse?: number, fett?: boolean, grau?: boolean): void;
  /** Neue Seite mit Logo; liefert die erste Grundlinie. */
  neueSeite(): number;
  /** Bricht um, wenn `benoetigt` mm nicht mehr passen. */
  umbruch(y: number, benoetigt: number): number;
  absatz(text: string, y: number, opts?: AbsatzOptionen): number;
  /** „§ 4 Mietzins …“ — fett, bleibt mit den zwei folgenden Zeilen zusammen. */
  ueberschrift(text: string, y: number): number;
  kostentabelle(t: Kostentabelle, y: number): number;
  /** Zweispaltig: Bezeichnung auf dem Tabstopp, Betrag rechtsbündig. */
  summentabelle(zeilen: TabellenZeile[], y: number): number;
  linie(x: number, y: number, breite: number): void;
  seitenzahlen(): void;
}

export function vertragsLayout(
  doc: jsPDF,
  { schrift, logo }: { schrift: Vertragsschrift | null; logo: string | null }
): VertragsLayout {
  let familie = 'helvetica';
  if (schrift) {
    doc.addFileToVFS('Carlito-Regular.ttf', schrift.regular);
    doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
    doc.addFileToVFS('Carlito-Bold.ttf', schrift.bold);
    doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
    familie = 'Carlito';
  }

  function setzeSchrift(groesse = GROESSE, fett = false, grau = false): void {
    doc.setFont(familie, fett ? 'bold' : 'normal');
    doc.setFontSize(groesse);
    doc.setTextColor(...(grau ? GRAU : SCHWARZ));
  }

  function logoZeichnen(): void {
    if (!logo) return;
    // Wie in der Kopfzeile der Vorlage: rechts oben im Seitenrand, auf jeder Seite
    doc.addImage(logo, 'PNG', SEITE_BREITE - 8 - LOGO_BREITE, 7, LOGO_BREITE, LOGO_HOEHE, 'niimmo-logo', 'FAST');
  }

  function neueSeite(): number {
    doc.addPage();
    logoZeichnen();
    return OBEN;
  }

  function umbruch(y: number, benoetigt: number): number {
    return y + benoetigt > UNTEN ? neueSeite() : y;
  }

  /** Eine Zeile im Blocksatz: Wortabstände auf die volle Breite verteilen. */
  function blockzeile(zeile: string, x: number, y: number, breite: number): void {
    const woerter = zeile.split(' ').filter(Boolean);
    if (woerter.length < 2) {
      doc.text(zeile, x, y);
      return;
    }
    const wortbreite = woerter.reduce((s, w) => s + doc.getTextWidth(w), 0);
    const luecke = (breite - wortbreite) / (woerter.length - 1);
    // Ein unnatürlich weiter Abstand (kurze Zeile vor langem Wort) sieht schlechter aus als Flattersatz
    if (luecke > doc.getTextWidth(' ') * 4) {
      doc.text(zeile, x, y);
      return;
    }
    let cx = x;
    for (const wort of woerter) {
      doc.text(wort, cx, y);
      cx += doc.getTextWidth(wort) + luecke;
    }
  }

  function absatz(text: string, y: number, opts: AbsatzOptionen = {}): number {
    const groesse = opts.groesse ?? GROESSE;
    const zeilenhoehe = (ZEILE * groesse) / GROESSE;
    const eingerueckt = !!opts.nummer || !!opts.einzug;
    const x = RAND + (eingerueckt ? EINZUG : 0);
    const breite = TEXTBREITE - (eingerueckt ? EINZUG : 0);
    setzeSchrift(groesse, opts.fett);
    const zeilen = doc.splitTextToSize(familie === 'Carlito' ? schuetzeUmbrueche(text) : text, breite) as string[];
    // Eine Ziffer nie allein am Seitenende: mindestens zwei Zeilen zusammenhalten
    y = umbruch(y, Math.min(zeilen.length, 2) * zeilenhoehe);

    zeilen.forEach((zeile, i) => {
      if (i > 0) y = umbruch(y, zeilenhoehe);
      setzeSchrift(groesse, opts.fett);
      if (i === 0 && opts.nummer) doc.text(opts.nummer, RAND, y);
      if (opts.zentriert) {
        doc.text(zeile, SEITE_BREITE / 2, y, { align: 'center' });
      } else if (opts.linksbuendig || i === zeilen.length - 1) {
        doc.text(zeile, x, y);
      } else {
        blockzeile(zeile, x, y, breite);
      }
      y += zeilenhoehe;
    });
    return y;
  }

  function ueberschrift(text: string, y: number): number {
    y = umbruch(y + 2.5, 3 * ZEILE + 3);
    setzeSchrift(GROESSE, true);
    doc.text(text, RAND, y);
    return y + ZEILE + 2.2;
  }

  function linie(x: number, y: number, breite: number): void {
    doc.setDrawColor(...SCHWARZ);
    doc.setLineWidth(0.25);
    doc.line(x, y, x + breite, y);
  }

  /**
   * Betriebskosten wie die Tabelle der Vorlage: Nummer, Kostenart, rechts der
   * Betrag. Seit 04.11.2026 mit dem Verteilerschlüssel je Zeile statt der
   * Sammelzeilen darunter (Kundenentscheidung).
   */
  function kostentabelle(t: Kostentabelle, y: number): number {
    const xNummer = RAND + 1.5;
    const xText = RAND + 13;
    const rechts = RAND + TEXTBREITE;
    const xVerteilung = rechts - 22 - 30;
    const textbreite = xVerteilung - xText - 3;

    const kopf = (yKopf: number): number => {
      setzeSchrift(GROESSE, true);
      doc.text(t.kopf.bezeichnung, xNummer, yKopf);
      doc.text(t.kopf.verteilung, xVerteilung, yKopf);
      doc.text(t.kopf.betrag, rechts, yKopf, { align: 'right' });
      return yKopf + ZEILE + 0.8;
    };
    y = kopf(umbruch(y, 3 * ZEILE));

    t.zeilen.forEach((z, i) => {
      setzeSchrift(GROESSE, false);
      const zeilen = doc.splitTextToSize(z.bezeichnung, textbreite) as string[];
      // Die letzte Position bleibt mit der Summe zusammen
      const benoetigt = zeilen.length * ZEILE + (i === t.zeilen.length - 1 ? ZEILE + 2.4 : 0);
      const vorher = doc.getNumberOfPages();
      y = umbruch(y, benoetigt);
      // Auf der Folgeseite steht der Spaltenkopf erneut
      if (doc.getNumberOfPages() !== vorher) y = kopf(y);
      setzeSchrift(GROESSE, false);
      doc.text(z.nummer, xNummer, y);
      zeilen.forEach((zeile, i) => doc.text(zeile, xText, y + i * ZEILE));
      if (z.verteilung) doc.text(z.verteilung, xVerteilung, y);
      doc.text(z.betrag, rechts, y, { align: 'right' });
      y += zeilen.length * ZEILE;
    });

    y = umbruch(y + 1.2, ZEILE + 2);
    linie(xNummer, y - 3.4, rechts - xNummer);
    setzeSchrift(GROESSE, true);
    doc.text(t.summe.text, xText, y);
    doc.text(t.summe.betrag, rechts, y, { align: 'right' });
    // Die Vorlage unterstreicht die Summe
    const breite = doc.getTextWidth(t.summe.betrag);
    linie(rechts - breite, y + 0.9, breite);
    return y + ZEILE;
  }

  function summentabelle(zeilen: TabellenZeile[], y: number): number {
    const rechts = RAND + TEXTBREITE;
    y = umbruch(y, zeilen.length * ZEILE + 3);
    for (const z of zeilen) {
      if (z.linieOben) {
        linie(RAND + EINZUG, y - 3.4, TEXTBREITE - EINZUG);
        y += 0.6;
      }
      setzeSchrift(GROESSE, z.bold ?? false);
      doc.text(z.links, RAND + EINZUG, y);
      if (z.rechts) doc.text(z.rechts, rechts, y, { align: 'right' });
      y += ZEILE;
      if (z.doppelstrichUnten) {
        const breite = Math.max(doc.getTextWidth(z.rechts), 22);
        linie(rechts - breite, y - 2.9, breite);
        linie(rechts - breite, y - 2.3, breite);
        y += 1;
      }
    }
    return y;
  }

  function seitenzahlen(): void {
    const gesamt = doc.getNumberOfPages();
    for (let i = 1; i <= gesamt; i++) {
      doc.setPage(i);
      setzeSchrift(9, false, true);
      doc.text(`Seite ${i} von ${gesamt}`, SEITE_BREITE / 2, SEITE_HOEHE - 14, { align: 'center' });
    }
  }

  // Die erste Seite legt jsPDF selbst an — sie bekommt ihr Logo hier
  logoZeichnen();

  return {
    familie,
    schrift: setzeSchrift,
    neueSeite,
    umbruch,
    absatz,
    ueberschrift,
    kostentabelle,
    summentabelle,
    linie,
    seitenzahlen,
  };
}
