/**
 * Unterschriebene Fassung ablegen (12.11.2026): bei ausstehender Unterschrift über `unterschrift_nachreichen` (Merker
 * und Dokument in einer Transaktion), sonst als weitere Fassung — Datei plus Dokumentzeile, bei einem Fehler ohne
 * liegengebliebene Datei. Der Supabase-Client ist ersetzt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { z } = vi.hoisted(() => ({
  z: {
    rpcAufrufe: [] as { name: string; args: Record<string, unknown> }[],
    rpcFehler: null as { message: string } | null,
    hochgeladen: [] as string[],
    entfernt: [] as string[][],
    eingefuegt: [] as Record<string, unknown>[],
    einfuegenFehler: null as { message: string } | null,
    vorhanden: [] as { id: string }[],
    merker: false as boolean | null,
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'nutzer-1' } } }) },
    rpc: (name: string, args: Record<string, unknown>) => {
      z.rpcAufrufe.push({ name, args });
      return Promise.resolve({ data: null, error: z.rpcFehler });
    },
    from: () => ({
      insert: (zeile: Record<string, unknown>) => {
        z.eingefuegt.push(zeile);
        return Promise.resolve({ error: z.einfuegenFehler });
      },
      select: () => {
        const kette = {
          eq: () => kette,
          limit: () => Promise.resolve({ data: z.vorhanden, error: null }),
          maybeSingle: () =>
            Promise.resolve({ data: z.merker === null ? null : { unterschrift_ausstehend: z.merker }, error: null }),
        };
        return kette;
      },
    }),
    storage: {
      from: () => ({
        upload: (pfad: string) => {
          z.hochgeladen.push(pfad);
          return Promise.resolve({ error: null });
        },
        remove: (pfade: string[]) => {
          z.entfernt.push(pfade);
          return Promise.resolve({ error: null });
        },
      }),
    },
  },
}));

import { legeUnterschriebeneFassungAb } from './mietvertragEntwurfService';

const datei = new File(['%PDF'], 'Scan vom Vertrag.pdf', { type: 'application/pdf' });

beforeEach(() => {
  z.rpcAufrufe = [];
  z.rpcFehler = null;
  z.hochgeladen = [];
  z.entfernt = [];
  z.eingefuegt = [];
  z.einfuegenFehler = null;
  z.vorhanden = [];
  z.merker = false;
});

describe('legeUnterschriebeneFassungAb', () => {
  it('reicht bei ausstehender Unterschrift über die Datenbankfunktion nach', async () => {
    await legeUnterschriebeneFassungAb('v1', datei, true);
    expect(z.rpcAufrufe.map(a => a.name)).toEqual(['unterschrift_nachreichen']);
    expect(z.eingefuegt).toEqual([]);
    expect(z.hochgeladen[0]).toMatch(/^mietvertraege\/v1\/Mietvertrag_unterschrieben_\d{4}-\d{2}-\d{2}_\d{6}\.pdf$/);
  });

  it('legt bei einem schon unterschriebenen Vertrag eine weitere Fassung ab, ohne den Merker anzufassen', async () => {
    await legeUnterschriebeneFassungAb('v1', datei, false);
    expect(z.rpcAufrufe).toEqual([]);
    expect(z.eingefuegt).toHaveLength(1);
    expect(z.eingefuegt[0]).toMatchObject({
      mietvertrag_id: 'v1',
      kategorie: 'Mietvertrag',
      titel: expect.stringMatching(/^Mietvertrag \(unterschrieben\) – hochgeladen \d{2}\.\d{2}\.\d{4} \d{2}\.\d{2} Uhr$/),
      erstellt_von: 'nutzer-1',
      geloescht: false,
    });
    // Am Pfad erkennt der Stand die unterschriebene Fassung (fassungArt)
    expect(String(z.eingefuegt[0].pfad)).toContain('/Mietvertrag_unterschrieben_');
  });

  it('nimmt den Merker aus der Datenbank, wenn die Anzeige veraltet ist (Review 12.11.2026)', async () => {
    z.merker = true;
    await legeUnterschriebeneFassungAb('v1', datei, false);
    expect(z.rpcAufrufe.map(a => a.name)).toEqual(['unterschrift_nachreichen']);
    expect(z.eingefuegt).toEqual([]);
  });

  it('legt nichts ab, wenn es den Vertrag nicht mehr gibt', async () => {
    z.merker = null;
    await expect(legeUnterschriebeneFassungAb('v1', datei, false)).rejects.toThrow('gibt es nicht mehr');
    expect(z.hochgeladen).toEqual([]);
  });

  it('räumt die Datei weg, wenn der Eintrag scheitert', async () => {
    z.einfuegenFehler = { message: 'keine Berechtigung' };
    await expect(legeUnterschriebeneFassungAb('v1', datei, false)).rejects.toThrow('keine Berechtigung');
    expect(z.entfernt).toEqual([[z.hochgeladen[0]]]);
  });

  it('lässt die Datei liegen, wenn der Eintrag trotz Fehlermeldung schon steht', async () => {
    z.einfuegenFehler = { message: 'Zeitüberschreitung' };
    z.vorhanden = [{ id: 'd1' }];
    await legeUnterschriebeneFassungAb('v1', datei, false);
    expect(z.entfernt).toEqual([]);
  });
});
