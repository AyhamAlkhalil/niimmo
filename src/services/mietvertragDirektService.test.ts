/**
 * Zurücknehmen einer halb angelegten Direkterfassung. Der Supabase-Client ist
 * ersetzt: Jede Tabelle antwortet mit dem, was der Test vorgibt, und jeder
 * Löschaufruf wird mitgeschrieben.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Antwort = { data: { id: string }[] | null; error: { message: string } | null };

const { antworten, geloescht, wirft } = vi.hoisted(() => ({
  antworten: {} as Record<string, Antwort>,
  geloescht: [] as string[],
  wirft: new Set<string>(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (tabelle: string) => ({
      delete: () => {
        const kette = {
          eq: (_spalte: string, wert: string) => {
            geloescht.push(`${tabelle}:${wert}`);
            return kette;
          },
          in: (_spalte: string, werte: string[]) => {
            geloescht.push(`${tabelle}:${werte.join(',')}`);
            return kette;
          },
          select: () => (wirft.has(tabelle) ? Promise.reject(new Error('Netz weg')) : Promise.resolve(antworten[tabelle])),
        };
        return kette;
      },
    }),
  },
}));

import { nimmAnlageZurueck } from './mietvertragDirektService';

const ok = (...ids: string[]): Antwort => ({ data: ids.map(id => ({ id })), error: null });

beforeEach(() => {
  geloescht.length = 0;
  wirft.clear();
  for (const k of Object.keys(antworten)) delete antworten[k];
});

describe('nimmAnlageZurueck', () => {
  it('löscht Vertrag und neue Mieter, auch wenn erst das Verknüpfen scheiterte', async () => {
    antworten.mietvertrag = ok('v1');
    antworten.mieter = ok('n1', 'n2');
    expect(await nimmAnlageZurueck('v1', ['n1', 'n2'])).toBeNull();
    expect(geloescht).toEqual(['mietvertrag:v1', 'mieter:n1,n2']);
  });

  it('löscht ohne Vertrag nur die neuen Mieter und ohne neue Mieter nichts weiter', async () => {
    antworten.mieter = ok('n1');
    expect(await nimmAnlageZurueck(null, ['n1'])).toBeNull();
    expect(geloescht).toEqual(['mieter:n1']);

    geloescht.length = 0;
    expect(await nimmAnlageZurueck(null, [])).toBeNull();
    expect(geloescht).toEqual([]);
  });

  it('meldet ein von RLS verweigertes Löschen, obwohl kein Fehler kommt', async () => {
    antworten.mieter = ok('n1');
    expect(await nimmAnlageZurueck(null, ['n1', 'n2'])).toBe(
      'Nicht zurückgenommen: 1 neu angelegter Mieter — bitte in der Übersicht prüfen und von Hand löschen.'
    );
  });

  it('lässt die neuen Mieter stehen, solange der Vertrag nicht entfernt ist', async () => {
    // 0 Zeilen ohne Fehler: RLS hat das Löschen des Vertrags verweigert
    antworten.mietvertrag = ok();
    antworten.mieter = ok('n1', 'n2');
    expect(await nimmAnlageZurueck('v1', ['n1', 'n2'])).toBe(
      'Nicht zurückgenommen: der angelegte Vertrag und 2 neu angelegte Mieter — bitte in der Übersicht prüfen und von Hand löschen.'
    );
    expect(geloescht).toEqual(['mietvertrag:v1']);
  });

  it('meldet einen Fehler beim Löschen mit allen betroffenen Mietern', async () => {
    antworten.mietvertrag = ok('v1');
    antworten.mieter = { data: null, error: { message: 'violates foreign key constraint' } };
    expect(await nimmAnlageZurueck('v1', ['n1', 'n2'])).toBe(
      'Nicht zurückgenommen: 2 neu angelegte Mieter — bitte in der Übersicht prüfen und von Hand löschen.'
    );
  });

  it('wirft nicht, wenn das Löschen des Vertrags eine Ausnahme wirft, und lässt die Mieter stehen', async () => {
    wirft.add('mietvertrag');
    antworten.mieter = ok('n1');
    expect(await nimmAnlageZurueck('v1', ['n1'])).toBe(
      'Nicht zurückgenommen: der angelegte Vertrag und 1 neu angelegter Mieter — bitte in der Übersicht prüfen und von Hand löschen.'
    );
    expect(geloescht).toEqual(['mietvertrag:v1']);
  });

  it('meldet alle Mieter als Rest, wenn deren Löschen eine Ausnahme wirft', async () => {
    wirft.add('mieter');
    expect(await nimmAnlageZurueck(null, ['n1', 'n2'])).toBe(
      'Nicht zurückgenommen: 2 neu angelegte Mieter — bitte in der Übersicht prüfen und von Hand löschen.'
    );
  });
});
