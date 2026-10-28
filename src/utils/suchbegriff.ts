/**
 * Suchbegriffe für PostgREST-Filter (28.10.2026).
 *
 * Die Suche (SearchPanel) setzte den Begriff roh in `.or(`vorname.ilike.%${term}%,…`)`. Ein Komma
 * („Nachname, Vorname") oder eine Klammer zerlegt den or-Ausdruck: PostgREST antwortet mit 400
 * (PGRST100, am 28.10.2026 gegen die Live-API nachgestellt), und weil nur `data` gelesen wurde,
 * stand still „Keine Ergebnisse" da.
 *
 * Regel aus docs/architektur.md §7: Vor dem Filter auf Buchstaben, Ziffern, Leerzeichen und
 * Bindestrich beschränken. Alles andere trennt Wörter. Jedes Wort wird einzeln gesucht und die
 * Wörter gelten zusammen (UND) — so findet „Müller, Hans" den Vertrag, in dem „Hans" im Vornamen
 * und „Müller" im Nachnamen steht. Was als Ganzes passte, passt auch Wort für Wort.
 */

/** Höchstens so viele Wörter — jedes wird ein eigener Filter in der URL. */
const MAX_WOERTER = 8;

export function suchwoerter(begriff: string | null | undefined): string[] {
  return (begriff ?? '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(wort => /[\p{L}\p{N}]/u.test(wort))
    .slice(0, MAX_WOERTER);
}

/** Inhalt eines `.or()`: das Wort in irgendeiner der Spalten. `wort` stammt aus `suchwoerter`. */
export function ilikeInSpalten(spalten: readonly string[], wort: string): string {
  return spalten.map(spalte => `${spalte}.ilike.%${wort}%`).join(',');
}
