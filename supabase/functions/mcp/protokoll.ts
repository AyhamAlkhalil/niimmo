// Model Context Protocol (MCP) über Streamable HTTP, zustandslos (16.11.2026).
// Jede POST-Anfrage trägt eine JSON-RPC-Nachricht und bekommt die Antwort als application/json — ohne Sitzung und
// ohne SSE-Strom. Das reicht für Werkzeuge vollständig aus (Spezifikation 2025-06-18, „Transports“).
// Ohne Bibliothek, damit Deno und Vitest dieselbe Datei laden.

import { pruefeEingabe } from './eingabe.ts';
import { Fachfehler, type Kontext, type Werkzeug } from './werkzeug.ts';

export const PROTOKOLL_VERSIONEN = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MAX_STAPEL = 10;

export interface ServerBeschreibung {
  name: string;
  titel: string;
  version: string;
  hinweise: string;
}

type Id = string | number | null;

export interface JsonRpcAntwort {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

export const FEHLER = {
  parse: -32700,
  anfrage: -32600,
  methode: -32601,
  parameter: -32602,
  intern: -32603,
} as const;

export function fehlerAntwort(id: Id, code: number, message: string): JsonRpcAntwort {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Werkzeuge, die der Nutzer mit seinen Rollen sehen und aufrufen darf */
export function sichtbareWerkzeuge(werkzeuge: readonly Werkzeug[], ctx: Pick<Kontext, 'rollen'>): Werkzeug[] {
  return werkzeuge.filter((w) => w.rollen.some((r) => ctx.rollen.has(r)));
}

function werkzeugBeschreibung(w: Werkzeug) {
  return {
    name: w.name,
    title: w.titel,
    description: w.beschreibung,
    inputSchema: w.eingabe,
    annotations: {
      title: w.titel,
      readOnlyHint: !w.schreibt,
      destructiveHint: w.schreibt ? Boolean(w.zerstoerend) : false,
      openWorldHint: false,
    },
  };
}

function textErgebnis(daten: unknown, istFehler = false) {
  const text = typeof daten === 'string' ? daten : JSON.stringify(daten);
  return { content: [{ type: 'text', text }], isError: istFehler };
}

/**
 * Argumente ohne null-Werte: Modelle füllen optionale Felder gern mit null. Die Prüfung nimmt null als „nicht
 * angegeben“ — die Werkzeuge sollen es dann auch nicht sehen, sonst landete null als Wert im UPDATE (Review 16.11.2026).
 */
export function ohneLeereArgumente(argumente: unknown): unknown {
  if (typeof argumente !== 'object' || argumente === null || Array.isArray(argumente)) return argumente;
  return Object.fromEntries(Object.entries(argumente).filter(([, wert]) => wert !== null && wert !== undefined));
}

async function protokolliere(ctx: Kontext, werkzeug: Werkzeug, eingabe: Record<string, unknown>, ausgang: { ok: boolean; daten?: unknown }) {
  if (!werkzeug.schreibt || !ctx.protokolliere) return;
  // Das Protokoll darf einen gelungenen Schreibvorgang nicht als gescheitert melden
  try {
    const vorher = (ausgang.daten as { vorher?: unknown; geloescht?: unknown } | null | undefined);
    await ctx.protokolliere(werkzeug.name, eingabe, { ok: ausgang.ok, vorher: vorher?.vorher ?? vorher?.geloescht });
  } catch (e) {
    console.error(`[mcp] Protokoll für ${werkzeug.name} nicht geschrieben:`, e instanceof Error ? e.message : String(e));
  }
}

async function rufeWerkzeug(params: unknown, werkzeuge: readonly Werkzeug[], ctx: Kontext, id: Id): Promise<JsonRpcAntwort> {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof p.name !== 'string') return fehlerAntwort(id, FEHLER.parameter, 'Werkzeugname fehlt');
  const werkzeug = sichtbareWerkzeuge(werkzeuge, ctx).find((w) => w.name === p.name);
  if (!werkzeug) return fehlerAntwort(id, FEHLER.parameter, `Unbekanntes Werkzeug: ${p.name}`);

  const argumente = ohneLeereArgumente(p.arguments ?? {});
  const fehler = pruefeEingabe(argumente, werkzeug.eingabe);
  // Eingabefehler als Werkzeugergebnis, damit das Modell sie lesen und korrigieren kann
  if (fehler.length > 0) return { jsonrpc: '2.0', id, result: textErgebnis(`Eingabe ungültig: ${fehler.join('; ')}`, true) };
  const eingabe = argumente as Record<string, unknown>;

  let daten: unknown;
  try {
    daten = await werkzeug.ausfuehren(eingabe, ctx);
  } catch (e) {
    // Auch gescheiterte Schreibversuche ins Protokoll: Ein Werkzeug kann vor dem Fehler schon etwas geschrieben haben
    await protokolliere(ctx, werkzeug, eingabe, { ok: false });
    if (e instanceof Fachfehler) return { jsonrpc: '2.0', id, result: textErgebnis(e.message, true) };
    // Keine Fehlermeldung, keinen Stack und keine Daten an den Aufrufer (docs/architektur.md §7)
    console.error(`[mcp] Werkzeug ${werkzeug.name} abgebrochen:`, e instanceof Error ? e.message : String(e));
    return { jsonrpc: '2.0', id, result: textErgebnis('Interner Fehler. Bitte in der App prüfen oder später erneut versuchen.', true) };
  }
  await protokolliere(ctx, werkzeug, eingabe, { ok: true, daten });
  return { jsonrpc: '2.0', id, result: textErgebnis(daten ?? { ok: true }) };
}

function istAnfrage(n: unknown): n is { jsonrpc: '2.0'; id?: Id; method: string; params?: unknown } {
  return typeof n === 'object' && n !== null && (n as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (n as { method?: unknown }).method === 'string';
}

/**
 * Eine JSON-RPC-Nachricht. Benachrichtigungen (ohne id) und Antworten des Clients ergeben null — der Server
 * quittiert sie mit 202 ohne Inhalt.
 */
export async function verarbeiteNachricht(
  nachricht: unknown,
  werkzeuge: readonly Werkzeug[],
  ctx: Kontext,
  server: ServerBeschreibung,
): Promise<JsonRpcAntwort | null> {
  if (!istAnfrage(nachricht)) {
    // Antworten des Clients auf Server-Anfragen gibt es hier nicht; alles andere ist ungültig
    const n = nachricht as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown } | null;
    if (n && n.jsonrpc === '2.0' && ('result' in n || 'error' in n)) return null;
    const id = n && (typeof n.id === 'string' || typeof n.id === 'number') ? n.id : null;
    return fehlerAntwort(id, FEHLER.anfrage, 'Ungültige JSON-RPC-Nachricht');
  }
  const { method, params } = nachricht;
  const hatId = 'id' in nachricht && nachricht.id !== undefined;
  if (!hatId) return null; // Benachrichtigung, z. B. notifications/initialized
  const roh: unknown = nachricht.id;
  // JSON-RPC 2.0: id ist Text, Zahl oder null — eine Objekt-id würde sonst gespiegelt (QA 16.11.2026)
  if (roh !== null && typeof roh !== 'string' && typeof roh !== 'number') {
    return fehlerAntwort(null, FEHLER.anfrage, 'Ungültige id');
  }
  const id = roh as Id;

  switch (method) {
    case 'initialize': {
      const gewuenscht = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const version = (PROTOKOLL_VERSIONEN as readonly string[]).includes(gewuenscht as string)
        ? (gewuenscht as string)
        : PROTOKOLL_VERSIONEN[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.titel, version: server.version },
          instructions: server.hinweise,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: sichtbareWerkzeuge(werkzeuge, ctx).map(werkzeugBeschreibung) } };
    case 'tools/call':
      return await rufeWerkzeug(params, werkzeuge, ctx, id);
    default:
      return fehlerAntwort(id, FEHLER.methode, `Methode nicht unterstützt: ${method}`);
  }
}

/** Einzelne Nachricht oder Stapel (Protokoll 2025-03-26). Null heißt: nichts zu antworten (202). */
export async function verarbeite(
  koerper: unknown,
  werkzeuge: readonly Werkzeug[],
  ctx: Kontext,
  server: ServerBeschreibung,
): Promise<JsonRpcAntwort | JsonRpcAntwort[] | null> {
  if (Array.isArray(koerper)) {
    if (koerper.length === 0) return fehlerAntwort(null, FEHLER.anfrage, 'Leerer Stapel');
    // Stapel kennt erst das Protokoll 2025-03-26 (seit 2025-06-18 entfallen); begrenzt, damit ein Aufruf nicht
    // hunderte Schreibvorgänge an der Ratenbremse vorbei trägt
    if (koerper.length > MAX_STAPEL) return fehlerAntwort(null, FEHLER.anfrage, `Höchstens ${MAX_STAPEL} Nachrichten je Stapel`);
    const antworten: JsonRpcAntwort[] = [];
    for (const n of koerper) {
      const a = await verarbeiteNachricht(n, werkzeuge, ctx, server);
      if (a) antworten.push(a);
    }
    return antworten.length > 0 ? antworten : null;
  }
  return await verarbeiteNachricht(koerper, werkzeuge, ctx, server);
}
