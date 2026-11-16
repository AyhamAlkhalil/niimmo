import { describe, expect, it, vi } from 'vitest';
import { MAX_STAPEL, ohneLeereArgumente, PROTOKOLL_VERSIONEN, sichtbareWerkzeuge, verarbeite } from '../../../supabase/functions/mcp/protokoll.ts';
import { objekt } from '../../../supabase/functions/mcp/eingabe.ts';
import { Fachfehler, type Kontext, type Rolle, type Werkzeug } from '../../../supabase/functions/mcp/werkzeug.ts';

const SERVER = { name: 'niimmo', titel: 'NiImmo', version: '1.0.0', hinweise: 'Hinweise' };

function kontext(rollen: Rolle[], protokolliere?: Kontext['protokolliere']): Kontext {
  return { db: {}, benutzerId: 'u1', rollen: new Set(rollen), heute: '2026-11-16', stichtag: new Date(2026, 10, 16, 12), protokolliere };
}

const lesen: Werkzeug = {
  name: 'lesen',
  titel: 'Lesen',
  beschreibung: 'liest',
  eingabe: objekt({ id: { type: 'string', format: 'uuid', description: 'ID' } }, ['id']),
  rollen: ['admin', 'hausmeister'],
  schreibt: false,
  ausfuehren: async (e) => ({ gelesen: e.id }),
};
const schreiben: Werkzeug = {
  name: 'schreiben',
  titel: 'Schreiben',
  beschreibung: 'schreibt',
  eingabe: objekt({ wert: { type: 'number', description: 'Wert' } }),
  rollen: ['admin'],
  schreibt: true,
  zerstoerend: true,
  ausfuehren: async (e) => {
    if (e.wert === 1) throw new Fachfehler('Fachlich abgelehnt');
    if (e.wert === 2) throw new Error('geheime Interna: relation "x" does not exist');
    return { ok: true };
  },
};
const WERKZEUGE = [lesen, schreiben];
const ID = '11111111-2222-4333-8444-555555555555';

const anfrage = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params });

describe('MCP-Protokoll', () => {
  it('handelt die Protokollversion aus und beschreibt den Server', async () => {
    const a = await verarbeite(anfrage('initialize', { protocolVersion: '2025-06-18' }), WERKZEUGE, kontext(['admin']), SERVER);
    expect(a).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'niimmo' }, instructions: 'Hinweise' },
    });
    const unbekannt = await verarbeite(anfrage('initialize', { protocolVersion: '1999-01-01' }), WERKZEUGE, kontext(['admin']), SERVER);
    expect((unbekannt as { result: { protocolVersion: string } }).result.protocolVersion).toBe(PROTOKOLL_VERSIONEN[0]);
  });

  it('quittiert Benachrichtigungen und Antworten ohne Inhalt', async () => {
    expect(await verarbeite({ jsonrpc: '2.0', method: 'notifications/initialized' }, WERKZEUGE, kontext(['admin']), SERVER)).toBeNull();
    expect(await verarbeite({ jsonrpc: '2.0', id: 5, result: {} }, WERKZEUGE, kontext(['admin']), SERVER)).toBeNull();
  });

  it('zeigt jedem nur die Werkzeuge seiner Rolle, mit Hinweisen für den Client', async () => {
    const admin = await verarbeite(anfrage('tools/list'), WERKZEUGE, kontext(['admin']), SERVER);
    const tools = (admin as { result: { tools: { name: string; annotations: Record<string, unknown> }[] } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(['lesen', 'schreiben']);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[1].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(sichtbareWerkzeuge(WERKZEUGE, kontext(['hausmeister'])).map((w) => w.name)).toEqual(['lesen']);
  });

  it('lässt ein Werkzeug außerhalb der Rolle nicht aufrufen', async () => {
    const a = await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: {} }), WERKZEUGE, kontext(['hausmeister']), SERVER);
    expect(a).toMatchObject({ error: { code: -32602 } });
  });

  it('meldet ungültige Eingaben als Werkzeugfehler, damit das Modell korrigieren kann', async () => {
    const a = await verarbeite(anfrage('tools/call', { name: 'lesen', arguments: { id: 'abc', extra: 1 } }), WERKZEUGE, kontext(['admin']), SERVER);
    const r = (a as { result: { isError: boolean; content: { text: string }[] } }).result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/id: keine gültige ID/);
    expect(r.content[0].text).toMatch(/extra: unbekanntes Feld/);
  });

  it('liefert Daten als Text und meldet Fachfehler im Wortlaut, interne Fehler nie', async () => {
    const ok = await verarbeite(anfrage('tools/call', { name: 'lesen', arguments: { id: ID } }), WERKZEUGE, kontext(['admin']), SERVER);
    expect(JSON.parse((ok as { result: { content: { text: string }[] } }).result.content[0].text)).toEqual({ gelesen: ID });

    const fach = await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: { wert: 1 } }), WERKZEUGE, kontext(['admin']), SERVER);
    expect((fach as { result: { content: { text: string }[] } }).result.content[0].text).toBe('Fachlich abgelehnt');

    const fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const intern = await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: { wert: 2 } }), WERKZEUGE, kontext(['admin']), SERVER);
    const text = (intern as { result: { content: { text: string }[]; isError: boolean } }).result;
    expect(text.isError).toBe(true);
    expect(text.content[0].text).not.toMatch(/relation|geheim/);
    fehlerLog.mockRestore();
  });

  it('protokolliert jeden Schreibversuch mit Ausgang, Lesen nie, und ein Protokollfehler kippt nichts', async () => {
    const protokoll = vi.fn().mockResolvedValue(undefined);
    await verarbeite(anfrage('tools/call', { name: 'lesen', arguments: { id: ID } }), WERKZEUGE, kontext(['admin'], protokoll), SERVER);
    expect(protokoll).not.toHaveBeenCalled();
    await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: { wert: 1 } }), WERKZEUGE, kontext(['admin'], protokoll), SERVER);
    expect(protokoll).toHaveBeenLastCalledWith('schreiben', { wert: 1 }, { ok: false, vorher: undefined });
    await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: { wert: 3 } }), WERKZEUGE, kontext(['admin'], protokoll), SERVER);
    expect(protokoll).toHaveBeenLastCalledWith('schreiben', { wert: 3 }, { ok: true, vorher: undefined });

    const fehlerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kaputt = vi.fn().mockRejectedValue(new Error('RLS'));
    const a = await verarbeite(anfrage('tools/call', { name: 'schreiben', arguments: { wert: 3 } }), WERKZEUGE, kontext(['admin'], kaputt), SERVER);
    expect((a as { result: { isError: boolean } }).result.isError).toBe(false);
    fehlerLog.mockRestore();
  });

  it('nimmt null-Argumente als nicht angegeben', async () => {
    expect(ohneLeereArgumente({ a: 1, b: null, c: undefined, d: 0, e: '' })).toEqual({ a: 1, d: 0, e: '' });
    const a = await verarbeite(anfrage('tools/call', { name: 'lesen', arguments: { id: null } }), WERKZEUGE, kontext(['admin']), SERVER);
    expect((a as { result: { content: { text: string }[] } }).result.content[0].text).toMatch(/id: fehlt/);
  });

  it('begrenzt Stapel', async () => {
    const stapel = Array.from({ length: MAX_STAPEL + 1 }, (_, i) => anfrage('ping', undefined, i));
    expect(await verarbeite(stapel, WERKZEUGE, kontext(['admin']), SERVER)).toMatchObject({ error: { code: -32600 } });
  });

  it('beantwortet Stapel, unbekannte Methoden und ungültige Nachrichten', async () => {
    const stapel = await verarbeite([anfrage('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/x' }, anfrage('gibtsnicht', undefined, 2)], WERKZEUGE, kontext(['admin']), SERVER);
    expect(stapel).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Methode nicht unterstützt: gibtsnicht' } },
    ]);
    expect(await verarbeite([], WERKZEUGE, kontext(['admin']), SERVER)).toMatchObject({ error: { code: -32600 } });
    expect(await verarbeite({ foo: 1 }, WERKZEUGE, kontext(['admin']), SERVER)).toMatchObject({ error: { code: -32600 } });
    expect(await verarbeite({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }, WERKZEUGE, kontext(['admin']), SERVER))
      .toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Ungültige id' } });
  });
});
