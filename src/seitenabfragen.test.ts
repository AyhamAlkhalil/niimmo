import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Jede Abfrage, die mit variablen Grenzen blättert (.range(von, bis)), braucht eine
 * eindeutige Reihenfolge. Sonst verschiebt OFFSET Gleichstände zwischen den Seiten:
 * Am 27.10.2026 zeigte „Alle Zahlungen“ so 9 Buchungen doppelt und 9 gar nicht,
 * weil nur nach buchungsdatum sortiert war; useRueckstaende blätterte ganz ohne ORDER BY.
 */
const EINDEUTIG = [
  // id ist überall Primärschlüssel
  (orders: string[]) => orders.includes('id'),
  // mietvertrag_mieter: das Paar ist eindeutig
  (orders: string[]) => orders.includes('mietvertrag_id') && orders.includes('mieter_id'),
];

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [pfad] : [];
  });
}

describe('Seitenabfragen', () => {
  it('sortieren eindeutig', () => {
    const verstoesse: string[] = [];
    for (const datei of dateien('src')) {
      const text = readFileSync(datei, 'utf-8');
      for (const treffer of text.matchAll(/\.range\(\s*[a-zA-Z_]/g)) {
        const kette = text.slice(text.lastIndexOf('.from(', treffer.index), treffer.index);
        const orders = [...kette.matchAll(/\.order\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);
        if (!EINDEUTIG.some((ok) => ok(orders))) {
          verstoesse.push(`${datei}:${text.slice(0, treffer.index).split('\n').length}`);
        }
      }
    }
    expect(verstoesse).toEqual([]);
  });
});
