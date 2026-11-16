// Regeln für das Zuordnen von Zahlungen — eine Quelle für die App (über src/utils/zuordnungsvorschlaege.ts) und den
// MCP-Server (Edge Function mcp, seit 16.11.2026). Ohne Importe, damit Vite und Deno die Datei gleich laden.

const VERTRAGSKATEGORIEN = new Set(['Miete', 'Mietkaution', 'Rücklastschrift', 'Betriebskostenabrechnung']);

/**
 * Kategorie einer Zahlung, die von Hand einem Mietvertrag zugeordnet wird (AssignPaymentDialog).
 * Bis zum 27.10.2026 wurde nur „Nebenkosten“ auf „Miete“ umgestellt: Eine Mietzahlung, die als
 * „Nichtmiete“ oder ohne Kategorie stand, hing danach am Vertrag, zählte aber nicht im Rückstand —
 * bei der Meldung „erfolgreich zugeordnet“.
 */
export function kategorieBeiVertragszuordnung(kategorie: string | null | undefined): string {
  return kategorie && VERTRAGSKATEGORIEN.has(kategorie) ? kategorie : 'Miete';
}
