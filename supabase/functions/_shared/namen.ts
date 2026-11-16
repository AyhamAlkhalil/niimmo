// Namensdarstellung von Mietern und Mietsachen — eine Quelle für die App (über src/utils/benutzerName.ts und
// uebergabeAblauf.ts) und den MCP-Server (Edge Function mcp, seit 16.11.2026). Ohne Importe, damit Vite und Deno die Datei gleich laden.

/**
 * „Vorname Nachname“ eines Mieters ohne „null“ oder doppelte Leerzeichen; die Spalten dürfen leer
 * sein. Bis zum 27.10.2026 stand bei fehlendem Nachnamen „null“ in Übergabeprotokoll und Mails.
 */
export function mieterName(m: { vorname?: string | null; nachname?: string | null }): string {
  return [m.vorname, m.nachname].map((t) => (t ?? '').trim()).filter(Boolean).join(' ');
}

export interface MietsacheAngaben {
  einheitentyp?: string | null;
  etage?: string | null;
  anzahlZimmer?: number | null;
  qm?: number | null;
  bezeichnung?: string | null;
}

/**
 * Die Mietsache so genau, wie die Stammdaten es hergeben: „Wohnung, 1. OG links,
 * 3 Zimmer, 72,5 m²“. Bis zum 23.10.2026 nannte das Protokoll nur Objekt und
 * Etage — bei 11 von 113 Einheiten war daraus nicht erkennbar, welche übergeben
 * wurde. Eine Wohnungsnummer gibt es in den Stammdaten nicht (bezeichnung ist leer).
 */
export function mietsacheText(e: MietsacheAngaben): string {
  const zimmer = e.anzahlZimmer && e.anzahlZimmer > 0 ? `${String(e.anzahlZimmer).replace('.', ',')} Zimmer` : null;
  const flaeche = e.qm && e.qm > 0 ? `${e.qm.toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²` : null;
  return [e.bezeichnung?.trim(), e.einheitentyp?.trim(), e.etage?.trim(), zimmer, flaeche].filter(Boolean).join(', ');
}
