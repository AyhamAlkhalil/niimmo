/**
 * Ein PDF für die KI-Auslese (`process-contract-ocr`) aufbereiten: alle Seiten, Text und Bild.
 *
 * Bis zum 28.10.2026 las der Browser nur die ersten fünf Seiten als Text, bei Scans nur die erste
 * (Vertragserfassung) bzw. die ersten drei oder vier Seiten (Selbstauskunft, Vorvertrag) als Bild.
 * Kaution, IBAN und Zählerstände stehen in Mietverträgen meist weiter hinten. Außerdem ging bei
 * einem PDF mit Textebene kein Bild mit — handschriftlich eingetragene Beträge und Zählerstände in
 * einem getippten Formular sah die KI nie. Jetzt geht jede Seite als Bild mit, dazu die Textebene.
 *
 * Die Grenze liegt beim Umfang, nicht bei der Seitenzahl: Die Seitenbilder zusammen bleiben unter
 * MAX_BILDER_ZEICHEN. Supabase nennt für Edge Functions keine Obergrenze der Anfrage (Doku „Limits",
 * 28.10.2026), Drittquellen sprechen von 10 MB — 9 MB lassen Platz für die Textebene.
 */

export interface BildStufe {
  scale: number;
  quality: number;
}

/** Von scharf nach klein; eine Seite nimmt die erste Stufe, die in ihr Budget passt. */
export const BILD_STUFEN: readonly BildStufe[] = [
  { scale: 1.5, quality: 0.75 },
  { scale: 1.2, quality: 0.7 },
  { scale: 1.0, quality: 0.6 },
  { scale: 0.8, quality: 0.5 },
];

/** Alle Seitenbilder zusammen, als base64-Zeichen. */
export const MAX_BILDER_ZEICHEN = 9 * 1024 * 1024;

/** Mehr braucht auch eine handschriftliche Seite nicht. */
const MAX_BILD_ZEICHEN_JE_SEITE = 1.5 * 1024 * 1024;

/**
 * Längste Bildkante. Ein Planblatt in A0 ergäbe bei 1,5 rund 18 Mio. Pixel — über der Grenze, ab der
 * Safari keine Zeichenfläche mehr anlegt; dann liefert toDataURL nur „data:,".
 */
const MAX_KANTE_PX = 2000;

/** Darunter ist es ein Scan mit Kopfzeile, kein Textdokument (Wert aus dem früheren liesDokument). */
const MIN_TEXT_ZEICHEN = 200;

/** Budget einer Seite aus dem, was die vorigen Seiten übrig gelassen haben — leichte Seiten geben ab. */
export function bildBudget(restZeichen: number, verbleibendeSeiten: number): number {
  return Math.min(MAX_BILD_ZEICHEN_JE_SEITE, Math.floor(Math.max(0, restZeichen) / Math.max(1, verbleibendeSeiten)));
}

/** Maßstab der Stufe, gedeckelt auf MAX_KANTE_PX; `breite`/`hoehe` sind die Seitenmaße bei Maßstab 1. */
export function massstab(stufe: BildStufe, breite: number, hoehe: number): number {
  return Math.min(stufe.scale, MAX_KANTE_PX / Math.max(1, breite, hoehe));
}

/**
 * Rendert eine Seite in der schärfsten Stufe ab `abStufe`, die ins Budget passt. Ein Ergebnis ohne
 * JPEG-Kopf (Zeichenfläche zu groß) zählt wie „passt nicht". Passt keine Stufe, kommt das kleinste
 * gültige Bild zurück — ob das Ganze noch passt, entscheidet `bildumfangFehler`; ist keines gültig, ''.
 */
export async function rendereImBudget(
  rendere: (stufe: BildStufe) => Promise<string>,
  budget: number,
  abStufe = 0,
): Promise<{ bild: string; stufe: number }> {
  let kleinstesGueltiges = '';
  for (let stufe = Math.min(Math.max(0, abStufe), BILD_STUFEN.length - 1); stufe < BILD_STUFEN.length; stufe++) {
    const bild = await rendere(BILD_STUFEN[stufe]);
    if (!bild.startsWith('/9j/')) continue;
    if (bild.length <= budget) return { bild, stufe };
    kleinstesGueltiges = bild;
  }
  return { bild: kleinstesGueltiges, stufe: BILD_STUFEN.length - 1 };
}

/** Text einer Seite aus PDF.js-`getTextContent().items`; Zeilenumbrüche bleiben, damit Tabellen lesbar bleiben. */
export function seitenText(items: ReadonlyArray<{ str?: unknown; hasEOL?: unknown }>): string {
  let text = '';
  for (const item of items) {
    // Marked-Content-Einträge haben kein `str`
    if (typeof item.str !== 'string') continue;
    text += item.str + (item.hasEOL ? '\n' : ' ');
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function textebeneVorhanden(seitentexte: readonly string[]): boolean {
  return seitentexte.reduce((summe, t) => summe + t.trim().length, 0) >= MIN_TEXT_ZEICHEN;
}

/** Die Textebene aller Seiten mit Seitenangabe, wie sie die Auslese bekommt. */
export function textMitSeiten(seitentexte: readonly string[]): string {
  return seitentexte.map((t, i) => `Seite ${i + 1}:\n${t}`).join('\n\n');
}

export function bildumfangFehler(seitenzahl: number, bildZeichen: number): string | null {
  if (bildZeichen <= MAX_BILDER_ZEICHEN) return null;
  return `Das Dokument hat ${seitenzahl} Seiten und ist auch in niedriger Auflösung zu groß, um alle Seiten ` +
    'in einem Schritt auszulesen. Bitte den Vertrag ohne Anlagen hochladen oder die Angaben von Hand erfassen.';
}
