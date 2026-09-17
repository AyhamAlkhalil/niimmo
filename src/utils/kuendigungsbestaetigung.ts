/**
 * Fachlogik der Kündigungsbestätigung.
 *
 * Kündigt der Mieter, wird sein Schreiben im Kündigungsdialog hochgeladen.
 * Bis zum 16.09.2026 endete der Vorgang dort — die Bestätigung an den Mieter
 * entstand außerhalb der Anwendung. Dieses Modul liefert Anrede und Brieftext,
 * `kuendigungPdfGenerator.ts` setzt sie ins Hauslayout.
 *
 * Personenbezogene Angaben kommen nicht aus der Datenbank: `mieter.anrede` und
 * die Postanschrift sind am 16.09.2026 bei allen 140 Mietern leer. Die Anrede
 * wird deshalb im Dialog je Mieter gewählt.
 */
import { formatDatum } from './pdf/briefLayout';

export type Anrede = 'Herr' | 'Frau' | 'ohne';

export interface BestaetigungMieter {
  vorname: string;
  nachname: string;
  anrede: Anrede;
}

export interface BestaetigungsDaten {
  mieter: BestaetigungMieter[];
  strasse: string;
  plzOrt: string;
  einheitBezeichnung: string;
  immobilieAdresse: string;
  vertragsart: string | null;
  einheitentyp: string | null;
  /** ISO-Datum */
  vertragStart: string | null;
  /** ISO-Datum, Ergebnis von getVertragsende() */
  vertragsende: string;
  /** Datum auf dem Kündigungsschreiben des Mieters, ISO */
  schreibenVom: string | null;
  /** Zugang der Kündigung, ISO */
  eingangAm: string | null;
  /** Datum des Bestätigungsschreibens, ISO */
  datum: string;
  hatKaution: boolean;
  neueAnschriftBekannt: boolean;
  /** Ersetzt den Standardtext vollständig; Absätze durch Leerzeilen getrennt. */
  freitext?: string;
  bemerkungen?: string;
}

/** Aus `mieter.anrede` übernehmen, was eindeutig ist — alles andere wählt der Nutzer. */
export function anredeAusDatenbank(wert: string | null | undefined): Anrede {
  const w = (wert ?? '').trim().toLowerCase();
  if (w === 'herr') return 'Herr';
  if (w === 'frau') return 'Frau';
  return 'ohne';
}

function vollerName(m: BestaetigungMieter): string {
  return `${m.vorname} ${m.nachname}`.replace(/\s+/g, ' ').trim();
}

/** Anschriftenzeile nach DIN 5008: „Herrn" steht im Akkusativ. */
export function anschriftZeile(m: BestaetigungMieter): string {
  const name = vollerName(m);
  if (m.anrede === 'Herr') return `Herrn ${name}`;
  if (m.anrede === 'Frau') return `Frau ${name}`;
  return name;
}

/**
 * Briefanrede mit Komma. Die frühere Form „Sehr geehrte/r Herr Muster" steht
 * noch im Kündigungsschreiben; hier wird je Person korrekt gebeugt. Fehlt bei
 * einer Person die Anrede, wird für alle neutral gegrüßt, statt zu raten.
 */
export function briefanrede(mieter: BestaetigungMieter[]): string {
  const personen = mieter.filter(m => vollerName(m));
  if (personen.length === 0) return 'Sehr geehrte Damen und Herren,';

  if (personen.every(m => m.anrede !== 'ohne')) {
    const teile = personen.map(m =>
      m.anrede === 'Frau'
        ? `sehr geehrte Frau ${m.nachname.trim() || vollerName(m)}`
        : `sehr geehrter Herr ${m.nachname.trim() || vollerName(m)}`
    );
    const text = teile.join(', ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)},`;
  }

  const namen = personen.map(vollerName);
  const liste = namen.length === 1
    ? namen[0]
    : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
  return `Guten Tag ${liste},`;
}

interface Mietobjekt {
  /** „über die Wohnung" */
  akkusativ: string;
  /** „Rückgabe der Wohnung" */
  genitiv: string;
  /** Zählerstände und Versorgerverträge gibt es nur bei Räumen. */
  mitVersorgung: boolean;
}

const WOHNUNG: Mietobjekt = { akkusativ: 'die Wohnung', genitiv: 'der Wohnung', mitVersorgung: true };
const GEWERBE: Mietobjekt = { akkusativ: 'die Gewerbeeinheit', genitiv: 'der Gewerbeeinheit', mitVersorgung: true };
const STELLPLATZ: Mietobjekt = { akkusativ: 'den Stellplatz', genitiv: 'des Stellplatzes', mitVersorgung: false };
const SONSTIGES: Mietobjekt = { akkusativ: 'das Mietobjekt', genitiv: 'des Mietobjekts', mitVersorgung: false };

const NACH_EINHEITENTYP: Record<string, Mietobjekt> = {
  'Wohnung': WOHNUNG,
  'Haus (Doppelhaushälfte, Reihenhaus)': { akkusativ: 'das Haus', genitiv: 'des Hauses', mitVersorgung: true },
  'Gewerbe': GEWERBE,
  'Büro': GEWERBE,
  'Lager': { akkusativ: 'die Lagerfläche', genitiv: 'der Lagerfläche', mitVersorgung: false },
  'Stellplatz': STELLPLATZ,
  'Garage': { akkusativ: 'die Garage', genitiv: 'der Garage', mitVersorgung: false },
  'Sonstiges': SONSTIGES,
};

/**
 * Der Kündigungsgenerator schreibt immer „Wohnung" — auch für Gewerbe und
 * Stellplätze (docs/offene-punkte.md D3). `mietvertrag.vertragsart` hilft
 * dabei kaum: Am 16.09.2026 steht sie bei allen 138 Verträgen auf `wohnraum`,
 * auch bei 18 Gewerbeeinheiten, 12 Garagen und 10 Stellplätzen — das ist der
 * Spaltenvorgabewert. Maßgeblich ist deshalb der Einheitentyp; die Vertragsart
 * zählt nur, wenn sie bewusst anders gesetzt wurde.
 */
export function mietobjekt(
  vertragsart: string | null | undefined,
  einheitentyp?: string | null
): Mietobjekt {
  if (vertragsart === 'gewerbe') return GEWERBE;
  if (vertragsart === 'stellplatz') return STELLPLATZ;
  if (vertragsart === 'sonstiges') return SONSTIGES;
  return (einheitentyp && NACH_EINHEITENTYP[einheitentyp]) || WOHNUNG;
}

/** Absätze des Brieftextes zwischen Anrede und Schlussformel. */
export function bestaetigungsAbsaetze(d: BestaetigungsDaten): string[] {
  const absaetze: string[] = [];

  if (d.freitext?.trim()) {
    absaetze.push(
      ...d.freitext
        .split(/\n\s*\n/)
        .map(a => a.replace(/\s*\n\s*/g, ' ').trim())
        .filter(Boolean)
    );
  } else {
    const objekt = mietobjekt(d.vertragsart, d.einheitentyp);
    const vom = d.schreibenVom ? ` vom ${formatDatum(d.schreibenVom)}` : '';
    const zugang = d.eingangAm ? `, die uns am ${formatDatum(d.eingangAm)} zugegangen ist` : '';
    absaetze.push(`wir bestätigen den Eingang Ihrer Kündigung${vom}${zugang}.`);

    const lage = [d.einheitBezeichnung.trim(), d.immobilieAdresse.trim()].filter(Boolean).join(', ');
    const begruendet = d.vertragStart
      ? `, begründet durch den Mietvertrag vom ${formatDatum(d.vertragStart)},`
      : '';
    // Der Widerspruch nach § 545 BGB steht bewusst hier: Ohne ihn verlängert
    // sich das Verhältnis, wenn der Mieter nach dem Ende weiter nutzt und
    // niemand binnen zwei Wochen widerspricht. Die Wohnraumvorlage schließt
    // § 545 BGB nicht aus (nur Gewerbe- und Nebenverträge tun das), die
    // Altverträge ebenso wenig.
    absaetze.push(
      `Das Mietverhältnis über ${objekt.akkusativ}${lage ? ` ${lage}` : ''}${begruendet} endet damit zum ${formatDatum(d.vertragsende)}. ` +
      'Einer stillschweigenden Verlängerung nach § 545 BGB widersprechen wir bereits jetzt.'
    );

    absaetze.push(
      `Bitte geben Sie ${objekt.akkusativ} spätestens zu diesem Termin geräumt, in ordnungsgemäßem Zustand und mit sämtlichen Schlüsseln zurück. ` +
      'Für die Übergabe vereinbaren wir rechtzeitig vorher einen Termin mit Ihnen' +
      (objekt.mitVersorgung
        ? '; dabei lesen wir gemeinsam die Zählerstände ab. Ihre eigenen Versorgungsverträge (etwa Strom, Gas, Internet) kündigen Sie bitte selbst zum Auszugstermin.'
        : '.')
    );

    // Kaution und neue Anschrift in einem Absatz — die Bestätigung soll auf
    // eine Seite passen.
    const abrechnung: string[] = [];
    if (d.hatKaution) {
      abrechnung.push(`Die Mietkaution rechnen wir nach Rückgabe ${objekt.genitiv} und Prüfung der Ansprüche aus dem Mietverhältnis ab.`);
    }
    if (!d.neueAnschriftBekannt) {
      abrechnung.push('Bitte teilen Sie uns rechtzeitig Ihre neue Anschrift mit, damit wir Ihnen die abschließenden Abrechnungen zusenden können.');
    }
    if (abrechnung.length > 0) absaetze.push(abrechnung.join(' '));
  }

  if (d.bemerkungen?.trim()) {
    absaetze.push(`Ergänzende Hinweise: ${d.bemerkungen.trim()}`);
  }

  return absaetze;
}

/**
 * Alle Mailadressen der Vertragsmieter, klein geschrieben und ohne Dubletten.
 * `send-kuendigungsbestaetigung` lässt nur diese Adressen zu — dieselbe
 * Zerlegung von `weitere_mails` wie in `send-mahnung`.
 */
export function mailadressenDerMieter(
  mieter: { hauptmail?: string | null; weitere_mails?: string | null }[]
): string[] {
  const adressen = new Set<string>();
  for (const m of mieter) {
    if (m.hauptmail?.includes('@')) adressen.add(m.hauptmail.trim().toLowerCase());
    for (const weitere of (m.weitere_mails ?? '').split(/[,;\s]+/)) {
      if (weitere.includes('@')) adressen.add(weitere.trim().toLowerCase());
    }
  }
  return [...adressen];
}
