/**
 * Vermietung zurücknehmen (11.11.2026): Die DB-Funktion löscht den Vertrag samt Forderungen und Dokumentzeilen und
 * nennt die Pfade; die Anwendung räumt danach die Dateien weg — nur die, die keine andere Zeile mehr nennt. Der
 * Supabase-Client ist ersetzt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { zustand } = vi.hoisted(() => ({
  zustand: {
    rpc: { data: null as unknown, error: null as { message: string } | null },
    belegt: [] as string[],
    entfernt: [] as string[][],
    entfernenFehler: null as { message: string } | null,
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: () => Promise.resolve(zustand.rpc),
    from: () => ({
      select: () => ({
        in: (_spalte: string, pfade: string[]) =>
          Promise.resolve({ data: zustand.belegt.filter(p => pfade.includes(p)).map(pfad => ({ pfad })), error: null }),
      }),
    }),
    storage: {
      from: () => ({
        remove: (pfade: string[]) => {
          zustand.entfernt.push(pfade);
          return Promise.resolve({ data: null, error: zustand.entfernenFehler });
        },
      }),
    },
  },
}));

import { nimmVermietungZurueck } from './mietvertragEntwurfService';

beforeEach(() => {
  zustand.rpc = { data: null, error: null };
  zustand.belegt = [];
  zustand.entfernt = [];
  zustand.entfernenFehler = null;
});

describe('nimmVermietungZurueck', () => {
  it('meldet den Grund der Datenbank und rührt keine Datei an', async () => {
    zustand.rpc = { data: null, error: { message: 'Dem Vertrag sind schon Zahlungen zugeordnet. Zurücknehmen geht nicht mehr, nur kündigen.' } };
    await expect(nimmVermietungZurueck('v1')).rejects.toThrow('schon Zahlungen zugeordnet');
    expect(zustand.entfernt).toEqual([]);
  });

  it('entfernt die Dateien des gelöschten Vertrags und nennt die Forderungen', async () => {
    zustand.rpc = { data: { pfade: ['mietvertrag-entwuerfe/e1/Mietvertrag_Entwurf.pdf', 'mietvertrag-entwuerfe/e1/Selbstauskunft.pdf'], forderungen: 3 }, error: null };
    expect(await nimmVermietungZurueck('v1')).toEqual({ forderungen: 3, hinweise: [] });
    expect(zustand.entfernt).toEqual([['mietvertrag-entwuerfe/e1/Mietvertrag_Entwurf.pdf', 'mietvertrag-entwuerfe/e1/Selbstauskunft.pdf']]);
  });

  it('lässt eine Datei liegen, die noch eine andere Dokumentzeile nennt', async () => {
    zustand.rpc = { data: { pfade: ['a.pdf', 'b.pdf'], forderungen: 0 }, error: null };
    zustand.belegt = ['b.pdf'];
    await nimmVermietungZurueck('v1');
    expect(zustand.entfernt).toEqual([['a.pdf']]);
  });

  it('meldet nicht gelöschte Dateien als Hinweis — der Vertrag ist trotzdem weg', async () => {
    zustand.rpc = { data: { pfade: ['a.pdf'], forderungen: 1 }, error: null };
    zustand.entfernenFehler = { message: 'Netz weg' };
    const ergebnis = await nimmVermietungZurueck('v1');
    expect(ergebnis.forderungen).toBe(1);
    expect(ergebnis.hinweise[0]).toContain('Netz weg');
  });

  it('ruft den Storage ohne Dateien nicht auf und verträgt eine leere Antwort', async () => {
    zustand.rpc = { data: { pfade: [], forderungen: 0 }, error: null };
    expect(await nimmVermietungZurueck('v1')).toEqual({ forderungen: 0, hinweise: [] });
    zustand.rpc = { data: null, error: null };
    expect(await nimmVermietungZurueck('v1')).toEqual({ forderungen: 0, hinweise: [] });
    expect(zustand.entfernt).toEqual([]);
  });
});
