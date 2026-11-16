// Regeln zur Mieterhöhung, die App (über src/utils/mieterhoehungRegeln.ts) und MCP-Server (Edge Function mcp, seit
// 16.11.2026) teilen. Ohne Importe, damit Vite und Deno die Datei gleich laden.

/**
 * verlangt_am für den Vorgang einer vereinbarten Erhöhung: Die Datenbank verlangt verlangt_am < wirksam_ab.
 * Rückwirkend (gilt ab heute oder früher) wurde die Erhöhung vorher vereinbart, also der Vortag des
 * Wirksamkeitstags, sonst heute. Beide Tage als JJJJ-MM-TT.
 */
export function vereinbarungVerlangtAmTag(giltAbIso: string, heuteIso: string): string {
  const giltAb = giltAbIso.slice(0, 10);
  if (giltAb > heuteIso.slice(0, 10)) return heuteIso.slice(0, 10);
  const [j, m, t] = giltAb.split('-').map(Number);
  // In UTC gerechnet und gelesen: Ein Monatswechsel (1. → Vortag) kann so nicht in eine Zeitzone rutschen
  const vortag = new Date(Date.UTC(j, m - 1, t - 1));
  const zwei = (n: number) => String(n).padStart(2, '0');
  return `${vortag.getUTCFullYear()}-${zwei(vortag.getUTCMonth() + 1)}-${zwei(vortag.getUTCDate())}`;
}

/** Fachliche Meldung zu den Hinweisen der Datenbankfunktionen mieterhoehung_zustimmen/_anwenden. */
export function uebernahmeMeldung(hinweis: string | null | undefined, ersatz?: string): string {
  switch (hinweis) {
    case 'MIETE_GEAENDERT':
      return 'Die Miete am Vertrag hat sich seit dem Verlangen geändert. Bitte prüfen und gegebenenfalls „Trotzdem übernehmen“ wählen.';
    case 'STAFFEL_ODER_INDEX':
      return 'Der Vertrag hat eine Staffel- oder Indexmiete; eine Erhöhung nach § 558 BGB ist ausgeschlossen.';
    case 'VERTRAG_ENDET_VORHER':
      return 'Der Vertrag endet vor dem Wirksamwerden der Erhöhung.';
    case 'NICHT_OFFEN':
      return 'Das Verlangen ist nicht mehr offen. Bitte den Dialog neu öffnen.';
    case 'NOCH_NICHT_WIRKSAM':
      // Meist am Monatsersten kurz nach Mitternacht: Die Datenbank rechnet in UTC noch mit dem Vortag
      return 'Die Erhöhung wird heute früh automatisch übernommen.';
    case 'NICHT_ZUGESTIMMT':
      return 'Der Vorgang ist nicht mehr als zugestimmt erfasst. Bitte den Dialog neu öffnen.';
    case 'SCHON_VEREINBART':
      return 'Für diesen Vertrag ist schon eine Erhöhung vereinbart. Eine weitere ist erst nach deren Wirksamwerden möglich.';
    case 'NUR_UEBER_ZURUECKNEHMEN':
      return 'Eine Zustimmung lässt sich nur über „Zustimmung zurücknehmen“ aufheben.';
    case 'NICHT_GEFUNDEN':
      return 'Vorgang oder Vertrag wurde nicht gefunden. Bitte den Dialog neu öffnen.';
    case 'NUR_ADMIN':
      return 'Nur Administratoren dürfen Mieterhöhungen erfassen.';
    default:
      return ersatz || 'Die Mieterhöhung konnte nicht gespeichert werden.';
  }
}
