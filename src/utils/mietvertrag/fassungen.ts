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

// ─── Titel und Dateiname ────────────────────────────────────────────────────

export interface VertragsKennung {
  /** Nachnamen bzw. Firmen der Mieter, in Vertragsreihenfolge. */
  mieter: string[];
  /** „Mühlenweg 5“ */
  adresse: string;
  /** „EG links“ — Lage oder Bezeichnung der Einheit, sonst leer. */
  lage: string;
}

/** Zeichen, die in Dateinamen unter Windows oder macOS nicht gehen. */
function dateinamenSicher(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function zeitpunktText(z: Date): string {
  const zwei = (n: number) => String(n).padStart(2, '0');
  return `${zwei(z.getDate())}.${zwei(z.getMonth() + 1)}.${z.getFullYear()} ${zwei(z.getHours())}.${zwei(z.getMinutes())} Uhr`;
}

/**
 * Titel eines Vertragsdokuments — er ist zugleich der Dateiname beim Herunterladen (`downloadDateiname`). Bis zum
 * 12.11.2026 hieß jede erstellte Fassung „Mietvertrag “ plus Einheitenbezeichnung (live fast immer leer) und jede
 * unterschriebene „Mietvertrag (unterschrieben)“ — mehrere Fassungen ließen sich nach dem Herunterladen nicht
 * unterscheiden (Nutzer: „Dateiname muss passen — man kann den Mietvertrag ja beliebig oft erstellen“). Deshalb mit
 * Mieter, Mietsache und Zeitpunkt auf die Minute.
 */
export function vertragsTitel(
  k: VertragsKennung,
  a: { art: 'erstellt' | 'unterschrieben'; zeitpunkt: Date; mitAnlagen?: boolean }
): string {
  const namen = k.mieter.map(n => n.trim()).filter(Boolean);
  const mieter = namen.length > 2 ? `${namen.slice(0, 2).join(', ')} u. a.` : namen.join(', ');
  const mietsache = [k.adresse.trim(), k.lage.trim()].filter(Boolean).join(', ');
  const kopf =
    a.art === 'unterschrieben' ? 'Mietvertrag (unterschrieben)' : a.mitAnlagen ? 'Mietvertrag einschließlich Anlagen' : 'Mietvertrag';
  const wann = `${a.art === 'unterschrieben' ? 'hochgeladen' : 'erstellt'} ${zeitpunktText(a.zeitpunkt)}`;
  // Dateinamen dürfen höchstens 255 Zeichen haben; gekürzt wird in der Mitte, Kopf und Zeitpunkt bleiben
  const mitte = dateinamenSicher([mieter, mietsache].filter(Boolean).join(' – '));
  const gekuerzt = mitte.length > 150 ? `${mitte.slice(0, 149).trim()}…` : mitte;
  return dateinamenSicher([kopf, gekuerzt, wann].filter(Boolean).join(' – '));
}
