/**
 * Seitenweises Lesen wachsender Tabellen. PostgREST liefert still höchstens
 * 1000 Zeilen; ohne Schleife rechnet eine Ansicht mit einem Bruchteil der
 * Daten (docs/architektur.md §4).
 *
 * Die erste Seite bringt die Gesamtzahl mit (`count: 'exact'`), alle weiteren
 * Seiten laufen gleichzeitig. Bis zum 07.09.2026 liefen die vier Seiten der
 * Zahlungsübersicht nacheinander — jede wartete auf die vorige.
 */

export interface Seite<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

export const SEITENGROESSE = 1000;

export async function alleSeiten<T>(seite: (von: number, bis: number, mitZaehlung: boolean) => PromiseLike<Seite<T>>): Promise<T[]> {
  const groesse = SEITENGROESSE;
  const erste = await seite(0, groesse - 1, true);
  if (erste.error) throw erste.error;
  const alle: T[] = [...(erste.data ?? [])];
  if (alle.length < groesse) return alle;

  const gesamt = typeof erste.count === 'number' ? erste.count : null;
  if (gesamt === null) {
    // Ohne Gesamtzahl bleibt nur der Reihe nach.
    for (let von = groesse; ; von += groesse) {
      const { data, error } = await seite(von, von + groesse - 1, false);
      if (error) throw error;
      if (!data || data.length === 0) break;
      alle.push(...data);
      if (data.length < groesse) break;
    }
    return alle;
  }

  const weitere: Promise<Seite<T>>[] = [];
  for (let von = groesse; von < gesamt; von += groesse) {
    weitere.push(Promise.resolve(seite(von, von + groesse - 1, false)));
  }
  for (const antwort of await Promise.all(weitere)) {
    if (antwort.error) throw antwort.error;
    alle.push(...(antwort.data ?? []));
  }
  return alle;
}
