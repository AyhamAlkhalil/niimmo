/**
 * Stand des Mietvertrags als Schriftstück — getrennt vom Mietverhältnis im System (seit 11.11.2026: „den Mietvertrag
 * als PDF zu erzeugen ist ein anderer Prozess als einen Mietvertrag im System zu haben“). Grundlage sind die
 * Dokumente der Kategorie „Mietvertrag“ am Vertrag und der Merker `unterschrift_ausstehend`.
 *
 * Woran sich eine Fassung erkennen lässt, steht im Pfad — die Titel kann man im Reiter Dokumente ändern:
 *  - unterschrieben: `mietvertraege/<vertrag>/Mietvertrag_unterschrieben_<stempel>.<endung>` (Nachreichen, Hochladen)
 *  - erstellt:       `mietvertraege/<vertrag>/Mietvertrag_<jjjj-mm-tt>_<hhmmss>.pdf` (Generator am Vertrag) oder
 *                    `mietvertrag-entwuerfe/<entwurf>/Mietvertrag_Entwurf_<stempel>.pdf` (Vermietungsablauf bis 11.11.2026)
 *  - hochgeladen:    alles andere — live am 12.11.2026 643 Dateien an 121 Verträgen aus dem Reiter Dokumente, fast
 *                    immer der eingescannte unterschriebene Vertrag.
 */

export type FassungArt = 'unterschrieben' | 'erstellt' | 'hochgeladen';

export interface VertragsDokument {
  id: string;
  titel: string | null;
  pfad: string | null;
  hochgeladen_am: string | null;
  kategorie?: string | null;
  geloescht?: boolean | null;
}

const UNTERSCHRIEBEN = /\/Mietvertrag_unterschrieben_/;
const AUS_GENERATOR = /^mietvertraege\/[^/]+\/Mietvertrag_\d{4}-\d{2}-\d{2}_\d{6}\.pdf$/;
const AUS_VERMIETUNG = /^mietvertrag-entwuerfe\/[^/]+\/Mietvertrag_Entwurf_/;

export function fassungArt(pfad: string): FassungArt {
  if (UNTERSCHRIEBEN.test(pfad)) return 'unterschrieben';
  if (AUS_GENERATOR.test(pfad) || AUS_VERMIETUNG.test(pfad)) return 'erstellt';
  return 'hochgeladen';
}

export interface FassungenStand {
  /** Die maßgebliche unterschriebene Fassung (die neueste); `null`, wenn keine hinterlegt ist. */
  unterschrieben: VertragsDokument | null;
  /** Das neueste aus der Vorlage erstellte PDF. */
  erstellt: VertragsDokument | null;
  /** Ein erstelltes PDF, das neuer ist als die unterschriebene Fassung — es wartet auf die Unterschrift. */
  offenesPdf: VertragsDokument | null;
  /** Alle Vertragsdokumente (ohne gelöschte). */
  anzahl: number;
}

function zeit(d: VertragsDokument): number {
  const t = d.hochgeladen_am ? Date.parse(d.hochgeladen_am) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * `ausstehend` ist der Merker am Vertrag: Solange er steht, gilt nichts als unterschrieben — auch keine Datei, die
 * jemand im Reiter Dokumente hochgeladen hat. Ohne Merker (Altbestand, nachgereicht) gilt die neueste unterschriebene
 * oder, wenn es keine gibt, die neueste hochgeladene Datei als hinterlegter Vertrag.
 */
export function fassungenStand(dokumente: readonly VertragsDokument[], ausstehend: boolean): FassungenStand {
  const vertrag = dokumente
    .filter(d => !d.geloescht && !!d.pfad && (d.kategorie === undefined || d.kategorie === 'Mietvertrag'))
    .sort((a, b) => zeit(b) - zeit(a));
  const neueste = (art: FassungArt) => vertrag.find(d => fassungArt(d.pfad!) === art) ?? null;

  const unterschrieben = ausstehend ? null : neueste('unterschrieben') ?? neueste('hochgeladen');
  const erstellt = neueste('erstellt');
  const offenesPdf = erstellt && (!unterschrieben || zeit(erstellt) > zeit(unterschrieben)) ? erstellt : null;
  return { unterschrieben, erstellt, offenesPdf, anzahl: vertrag.length };
}

/** „12.11.2026“ aus einem Zeitstempel; leer, wenn er fehlt. */
export function fassungDatum(d: VertragsDokument | null): string {
  if (!d?.hochgeladen_am) return '';
  const t = new Date(d.hochgeladen_am);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('de-DE');
}
