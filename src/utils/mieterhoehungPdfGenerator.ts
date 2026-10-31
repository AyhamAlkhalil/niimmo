import { jsPDF } from 'jspdf';
import type { Unterzeichner } from '@/config/company';
import { anredeFuerSchreiben } from './kuendigungsbestaetigung';
import { beginneBrief, ladeBriefbilder, type Briefbilder } from './pdf/briefbogen';

export interface MieterhoehungPdfData {
  // Empfänger
  anrede: string;
  mieterName: string;
  mieterNachname: string;
  /** Alle Mieter des Vertrags; ohne Angabe gilt nur mieterName/mieterNachname. */
  mieter?: Array<{ vorname: string; nachname: string }>;
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

  /**
   * Begründung nach § 558a Abs. 2 BGB. Ohne sie ist das Erhöhungsverlangen
   * formunwirksam — der Generator verweigert dann das PDF.
   */
  begruendungsart: BegruendungsArt;
  /** Der Begründungstext, den der Mieter nachprüfen kann. */
  begruendungText: string;

  /** Rückfragenblock und Unterschrift; im Dialog vorbelegt mit dem Angemeldeten (31.10.2026) */
  unterzeichner: Unterzeichner;
}

/** Die vier zulässigen Begründungsmittel des § 558a Abs. 2 BGB. */
export type BegruendungsArt =
  | 'mietspiegel'
  | 'mietdatenbank'
  | 'gutachten'
  | 'vergleichswohnungen';

export const BEGRUENDUNGS_BEZEICHNUNG: Record<BegruendungsArt, string> = {
  mietspiegel: 'Mietspiegel (§ 558a Abs. 2 Nr. 1 BGB)',
  mietdatenbank: 'Auskunft aus einer Mietdatenbank (§ 558a Abs. 2 Nr. 2 BGB)',
  gutachten: 'Sachverständigengutachten (§ 558a Abs. 2 Nr. 3 BGB)',
  vergleichswohnungen: 'Entsprechende Entgelte für einzelne vergleichbare Wohnungen (§ 558a Abs. 2 Nr. 4 BGB)',
};

/**
 * Ein Erhöhungsverlangen ohne Begründung ist nach § 558a Abs. 1 BGB unwirksam.
 * Wie beim Mietvertrag gilt: Der Generator rät nichts — fehlt die Begründung,
 * entsteht kein PDF, statt ein formunwirksames Schreiben zu erzeugen.
 */
export function pruefeErhoehungsdaten(data: MieterhoehungPdfData): string[] {
  const fehlt: string[] = [];
  if (!data.begruendungsart) {
    fehlt.push('Es ist kein Begründungsmittel nach § 558a Abs. 2 BGB gewählt.');
  }
  if (!data.begruendungText?.trim()) {
    fehlt.push('Die Begründung ist leer. Der Mieter muss sie nachprüfen können.');
  }
  if (!(data.neueKaltmiete > data.aktuelleKaltmiete)) {
    fehlt.push('Die neue Kaltmiete liegt nicht über der bisherigen.');
  }
  if (!data.wirksamDatum) {
    fehlt.push('Es fehlt das Datum, ab dem die erhöhte Miete geschuldet wird.');
  }
  return fehlt;
}

/** Betreff wie in der Briefvorlage: Art des Schreibens – Anschrift des Objekts */
export function mieterhoehungBetreff(data: Pick<MieterhoehungPdfData, 'immobilieAdresse'>): string {
  const art = 'Zustimmung zur Mieterhöhung nach § 558 BGB';
  return data.immobilieAdresse?.trim() ? `${art} – ${data.immobilieAdresse.trim()}` : art;
}

/** Layout nach der Briefvorlage des Kunden wie die Mahnung (31.10.2026); die Unterschrift stand bis dahin fest im Code. */
export async function generateMieterhoehungPdf(data: MieterhoehungPdfData): Promise<Blob> {
  const fehlt = pruefeErhoehungsdaten(data);
  if (fehlt.length > 0) {
    throw new Error(
      'Das Erhöhungsverlangen kann nicht erzeugt werden:\n' + fehlt.map((f) => `• ${f}`).join('\n')
    );
  }
  return erhoehungSetzen(data, await ladeBriefbilder());
}

function erhoehungSetzen(data: MieterhoehungPdfData, bilder: Briefbilder): Blob {
  const anrede = erhoehungsAnrede(data.anrede, data.mieter ?? [{ vorname: '', nachname: data.mieterNachname }]);
  const brief = beginneBrief(new jsPDF('p', 'mm', 'a4'), bilder, {
    anschrift: anrede.anschrift,
    name: data.mieterName,
    zeilen: [data.mieterAdresse, data.mieterPlzOrt],
    datum: data.datum,
    betreff: mieterhoehungBetreff(data),
    unterzeichner: data.unterzeichner,
  });
  brief.anrede(anrede.gruss);

  brief.absatz(`für die von Ihnen gemietete Wohnung in ${data.immobilieName}, ${data.immobilieAdresse}, ${data.einheitBezeichnung}, verlangen wir hiermit Ihre Zustimmung zu einer Erhöhung der Nettokaltmiete bis zur ortsüblichen Vergleichsmiete (§ 558 BGB). Bei Ihrer Zustimmung schulden Sie die erhöhte Miete ab dem ${data.wirksamDatum}.`);

  const aktuelleGesamtmiete = data.aktuelleKaltmiete + data.aktuelleBetriebskosten;
  const neueGesamtmiete = data.neueKaltmiete + data.neueBetriebskosten;
  // Das Verlangen nach § 558 BGB betrifft die Nettokaltmiete; der Prozentwert bezieht sich darauf wie im Dialog.
  // Bis zum 29.10.2026 stand hier die Erhöhung der Gesamtmiete (500 → 575 € kalt bei 150 € BK: 11,54 % statt 15 %).
  const erhoehungProzent = data.aktuelleKaltmiete > 0
    ? ((data.neueKaltmiete - data.aktuelleKaltmiete) / data.aktuelleKaltmiete) * 100
    : 0;
  const euro = (betrag: number) => `${formatEuro(betrag)} €`;
  brief.tabelle(['', 'Aktuell', 'Neu', 'Differenz'], [
    { zellen: ['Kaltmiete', euro(data.aktuelleKaltmiete), euro(data.neueKaltmiete), euro(data.neueKaltmiete - data.aktuelleKaltmiete)] },
    { zellen: ['Betriebskosten', euro(data.aktuelleBetriebskosten), euro(data.neueBetriebskosten), euro(data.neueBetriebskosten - data.aktuelleBetriebskosten)] },
    { zellen: ['Gesamtmiete', euro(aktuelleGesamtmiete), euro(neueGesamtmiete), euro(neueGesamtmiete - aktuelleGesamtmiete)], fett: true },
    { zellen: ['Erhöhung der Kaltmiete', '', '', `${formatEuro(erhoehungProzent)} %`], fett: true },
  ], { einleitung: 'Die verlangte Erhöhung stellt sich wie folgt dar:' });

  // Begründung (§ 558a Abs. 2 BGB)
  brief.absatz(
    `Wir stützen unser Verlangen auf folgendes Begründungsmittel: ${BEGRUENDUNGS_BEZEICHNUNG[data.begruendungsart]}.`,
    { titel: 'Begründung' },
  );
  brief.freitext(data.begruendungText);

  brief.absatz(`Sie haben Zeit, dieses Verlangen bis zum Ablauf des zweiten Kalendermonats nach seinem Zugang zu prüfen (§ 558b Abs. 2 BGB). Stimmen Sie zu, schulden Sie die erhöhte Miete ab dem ${data.wirksamDatum}; wir bitten Sie, Ihre Zahlungen dann entsprechend anzupassen. Ihre Zustimmung können Sie uns schriftlich oder in Textform erklären. Erteilen Sie sie nicht, bleibt es bei der bisherigen Miete — wir können die Zustimmung dann innerhalb von drei weiteren Monaten gerichtlich geltend machen (§ 558b Abs. 2 Satz 2 BGB).`);

  brief.schluss({ satz: 'Für Rückfragen stehen wir Ihnen gerne unter den oben genannten Kontaktdaten zur Verfügung.' });
  return brief.fertig();
}

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Anschriftzeile und Briefanrede (gemeinsam mit dem Kündigungsschreiben). */
export const erhoehungsAnrede = anredeFuerSchreiben;
