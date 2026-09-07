/**
 * Die eine Quelle für Bezeichnung, Farbrolle und Bedeutung der
 * Zahlungskategorien.
 *
 * Bis zum 07.09.2026 führten vier Komponenten je eine eigene Liste
 * (PaymentKategorieEditor, PaymentAssignmentResultsModal, LastUploadReviewModal,
 * PaymentManagement) mit vier verschiedenen Farbzuordnungen — „Nebenkosten"
 * war blau, teal und amber zugleich. docs/architektur.md §5 verlangt
 * Statusfarben aus einer Quelle; hier ist sie. Nur LastUploadReviewModal
 * trägt noch seine eigene Liste.
 *
 * Die Werte entsprechen dem Enum in der Datenbank (Spalte `zahlungen.kategorie`).
 */

export type KategorieTon = 'success' | 'primary' | 'warning' | 'destructive' | 'muted' | 'neutral';

export interface ZahlungKategorieInfo {
  wert: string;
  /** Anzeigetext. „Betriebskostenabrechnung" heißt in der Oberfläche seit dem 24.08.2026 „BKA (Mieter)". */
  label: string;
  ton: KategorieTon;
  /** Braucht diese Kategorie einen Mietvertrag, damit der Rückstand stimmt? */
  vertragsbezug: boolean;
}

export const ZAHLUNG_KATEGORIEN: readonly ZahlungKategorieInfo[] = [
  { wert: 'Miete', label: 'Miete', ton: 'success', vertragsbezug: true },
  { wert: 'Mietkaution', label: 'Mietkaution', ton: 'neutral', vertragsbezug: true },
  { wert: 'Rücklastschrift', label: 'Rücklastschrift', ton: 'destructive', vertragsbezug: true },
  { wert: 'Betriebskostenabrechnung', label: 'BKA (Mieter)', ton: 'warning', vertragsbezug: true },
  { wert: 'Nebenkosten', label: 'Nebenkosten', ton: 'primary', vertragsbezug: false },
  { wert: 'Nichtmiete', label: 'Nichtmiete', ton: 'muted', vertragsbezug: false },
  { wert: 'Ignorieren', label: 'Ignorieren', ton: 'muted', vertragsbezug: false },
];

/**
 * Kategorien, bei denen eine fehlende Vertragszuordnung ein offener Vorgang
 * ist. Deckungsgleich mit dem Filter des Reiters „Nicht zugeordnet".
 */
export const MIETRELEVANTE_KATEGORIEN: ReadonlySet<string> = new Set(
  ZAHLUNG_KATEGORIEN.filter((k) => k.vertragsbezug).map((k) => k.wert)
);

export const OHNE_KATEGORIE_LABEL = 'Keine Kategorie';

export function kategorieInfo(wert: string | null | undefined): ZahlungKategorieInfo | undefined {
  if (!wert) return undefined;
  return ZAHLUNG_KATEGORIEN.find((k) => k.wert === wert);
}

export function kategorieLabel(wert: string | null | undefined): string {
  if (!wert) return OHNE_KATEGORIE_LABEL;
  return kategorieInfo(wert)?.label ?? wert;
}

export function kategorieTon(wert: string | null | undefined): KategorieTon {
  return kategorieInfo(wert)?.ton ?? 'neutral';
}

/** Tailwind-Klassen je Ton für Badges und Auswahlfelder — Rollen-Tokens, keine Palettenfarben. */
export const KATEGORIE_TON_KLASSEN: Record<KategorieTon, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  primary: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
  neutral: 'border-border bg-card text-foreground',
};

/** Farbpunkt je Ton (Auswahlliste des Kategorie-Editors). */
export const KATEGORIE_PUNKT_KLASSEN: Record<KategorieTon, string> = {
  success: 'bg-success',
  primary: 'bg-primary',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
  neutral: 'bg-foreground',
};
