// NiImmo-MCP-Server (Model Context Protocol) für Claude und andere MCP-Clients (16.11.2026).
//
// Anmeldung: OAuth 2.1 über Supabase Auth (OAuth-Server, Zustimmungsseite /oauth/consent in der App). Der Client
// findet den Autorisierungsserver über die Metadaten dieser Ressource (RFC 9728), die eine 401-Antwort im Header
// WWW-Authenticate nennt. Jeder Aufruf läuft mit dem Token des Nutzers: RLS gilt wie in der App, einen
// Service-Role-Client gibt es hier nicht — sonst griffen auch Sperren wie mahnstufe_nur_durch_versand nicht.
//
// Wie alle Functions mit verify_jwt = false (config.toml): Die Prüfung steht unten (getUser, OAuth-Client, Rolle).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { FEHLER, fehlerAntwort, verarbeite } from './protokoll.ts';
import { SERVER, WERKZEUGE } from './server.ts';
import { heuteInBerlin, type Kontext, type Rolle, stichtagAus } from './werkzeug.ts';

// Als string typisiert: In der Funktion bearbeite (gehoben) gälte die Prüfung darunter nicht als Einengung
const SUPABASE_URL: string = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY: string = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL oder SUPABASE_ANON_KEY fehlt');
}
/**
 * Optional: kommagetrennte client_id der zugelassenen OAuth-Clients. Leer heißt: jeder bei Supabase registrierte
 * Client (dynamische Registrierung), abgesichert durch die Zustimmungsseite. Mit einem vorab registrierten,
 * vertraulichen Client für claude.ai hier dessen client_id eintragen und die dynamische Registrierung abschalten.
 */
const ERLAUBTE_CLIENTS = new Set(
  (Deno.env.get('MCP_ERLAUBTE_CLIENTS') ?? '').split(',').map((c) => c.trim()).filter(Boolean),
);

const RESSOURCE = `${SUPABASE_URL}/functions/v1/mcp`;
const METADATEN_PFAD = '/.well-known/oauth-protected-resource';
const METADATEN_URL = `${RESSOURCE}${METADATEN_PFAD}`;
const AUTORISIERUNGSSERVER = `${SUPABASE_URL}/auth/v1`;
/**
 * Nur `email`: Ohne Angabe nimmt Supabase ebenfalls email; `openid` verlangte ein ID-Token, und das scheitert,
 * solange das Projekt mit HS256 signiert (Supabase-Doku OAuth 2.1 Flows). Refresh-Tokens gibt es ohne eigenen Scope.
 */
const SCOPE = 'email';

const MAX_KOERPER_ZEICHEN = 1_000_000;
/** Nachrichten je Konto und Minute, je Instanz der Function — bremst Schleifen eines Clients */
const NACHRICHTEN_JE_MINUTE = 120;
const nachrichten = new Map<string, number[]>();

// Bearer-Token statt Cookies: CORS für browserbasierte MCP-Clients ist unbedenklich
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
};

function antwort(body: unknown, status: number, kopf: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...kopf } });
}

function nichtAngemeldet(fehler?: 'invalid_token'): Response {
  const teile = [`resource_metadata="${METADATEN_URL}"`, `scope="${SCOPE}"`];
  if (fehler) teile.push(`error="${fehler}"`);
  return antwort(
    { error: fehler ?? 'unauthorized', error_description: 'Anmeldung über OAuth erforderlich' },
    401,
    { 'WWW-Authenticate': `Bearer ${teile.join(', ')}` },
  );
}

function zuVieleNachrichten(benutzerId: string, anzahl: number): boolean {
  const jetzt = Date.now();
  const fenster = (nachrichten.get(benutzerId) ?? []).filter((t) => jetzt - t < 60_000);
  for (let i = 0; i < anzahl; i++) fenster.push(jetzt);
  nachrichten.set(benutzerId, fenster);
  return fenster.length > NACHRICHTEN_JE_MINUTE;
}

/** Nutzlast eines JWT, das getUser schon geprüft hat — nur zum Lesen der client_id */
function nutzlast(token: string): Record<string, unknown> | null {
  try {
    const teil = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(teil.padEnd(teil.length + ((4 - (teil.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

/**
 * Bezug eines Schreibvorgangs fürs Protokoll: das Feld, das zum Werkzeugnamen passt (zahlung_… → zahlung_id),
 * sonst das erste *_id-Feld — nicht die Reihenfolge, in der der Client die Felder schickt.
 */
function bezug(werkzeug: string, eingabe: Record<string, unknown>): { entity_type: string | null; entity_id: string | null } {
  const passend = `${werkzeug.split('_')[0]}_id`;
  const schluessel = typeof eingabe[passend] === 'string'
    ? passend
    : Object.keys(eingabe).sort().find((k) => k.endsWith('_id') && typeof eingabe[k] === 'string');
  return schluessel ? { entity_type: schluessel.slice(0, -3), entity_id: eingabe[schluessel] as string } : { entity_type: null, entity_id: null };
}

async function bearbeite(req: Request): Promise<Response> {
  const pfad = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Metadaten der geschützten Ressource (RFC 9728) — öffentlich, ohne Anmeldung
  if (pfad.endsWith(METADATEN_PFAD)) {
    if (req.method !== 'GET') return antwort({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    return antwort(
      {
        resource: RESSOURCE,
        authorization_servers: [AUTORISIERUNGSSERVER],
        bearer_methods_supported: ['header'],
        scopes_supported: [SCOPE],
        resource_name: SERVER.titel,
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    );
  }
  if (!pfad.endsWith('/mcp')) return antwort({ error: 'not_found' }, 404);

  // Zustandslos: kein SSE-Strom (GET) und keine Sitzung zum Beenden (DELETE)
  if (req.method !== 'POST') return antwort({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

  const token = /^bearer\s+(\S+)\s*$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!token) return nichtAngemeldet();

  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData?.user?.id) return nichtAngemeldet('invalid_token');
  const benutzer = userData.user;

  // Nur Tokens aus dem OAuth-Ablauf (mit client_id), keine Sitzung der App: Ein abgeflossenes App-Token öffnet den
  // MCP-Zugang nicht, und mit MCP_ERLAUBTE_CLIENTS nur die eingetragenen Clients (Review 16.11.2026)
  const clientId = nutzlast(token)?.client_id;
  if (typeof clientId !== 'string' || !clientId || (ERLAUBTE_CLIENTS.size > 0 && !ERLAUBTE_CLIENTS.has(clientId))) {
    return nichtAngemeldet('invalid_token');
  }

  // Erst nach bestandener Prüfung: der Client mit dem Token des Nutzers (RLS)
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rollenZeilen, error: rollenFehler } = await db.from('user_roles').select('role').eq('user_id', benutzer.id);
  if (rollenFehler) {
    console.error('[mcp] Rollen nicht lesbar:', rollenFehler.message);
    return antwort(fehlerAntwort(null, FEHLER.intern, 'Rollen nicht lesbar'), 500);
  }
  const rollen = new Set<Rolle>(
    (rollenZeilen ?? []).map((r: { role: string }) => r.role).filter((r: string): r is Rolle => r === 'admin' || r === 'hausmeister'),
  );
  if (rollen.size === 0) {
    return antwort({ error: 'forbidden', error_description: 'Dieses Konto hat keine Rolle in NiImmo.' }, 403);
  }

  const text = await req.text();
  if (text.length > MAX_KOERPER_ZEICHEN) return antwort(fehlerAntwort(null, FEHLER.anfrage, 'Anfrage zu groß'), 413);
  let koerper: unknown;
  try {
    koerper = JSON.parse(text);
  } catch {
    return antwort(fehlerAntwort(null, FEHLER.parse, 'Kein gültiges JSON'), 400);
  }
  if (zuVieleNachrichten(benutzer.id, Array.isArray(koerper) ? koerper.length : 1)) {
    return antwort(fehlerAntwort(null, FEHLER.anfrage, 'Zu viele Anfragen, bitte kurz warten'), 429, { 'Retry-After': '30' });
  }

  const heute = heuteInBerlin();
  const ctx: Kontext = {
    db,
    benutzerId: benutzer.id,
    rollen,
    heute,
    stichtag: stichtagAus(heute),
    // Wie useActivityLog der App; die Eingabe nur als Feldnamen, damit keine Kontaktdaten ins Protokoll gehen
    protokolliere: async (werkzeug, eingabe, ausgang) => {
      const { error } = await db.from('activity_logs').insert({
        user_id: benutzer.id,
        user_email: benutzer.email ?? null,
        action: `mcp_${werkzeug}`,
        ...bezug(werkzeug, eingabe),
        details: { quelle: 'mcp', client_id: clientId, ok: ausgang.ok, felder: Object.keys(eingabe), vorher: ausgang.vorher ?? null },
      });
      if (error) throw new Error(error.message);
    },
  };

  const ergebnis = await verarbeite(koerper, WERKZEUGE, ctx, SERVER);
  if (!ergebnis) return new Response(null, { status: 202, headers: CORS });
  return antwort(ergebnis, 200);
}

Deno.serve(async (req: Request) => {
  try {
    return await bearbeite(req);
  } catch (e) {
    console.error('[mcp] Unerwarteter Fehler:', e instanceof Error ? e.message : String(e));
    return antwort(fehlerAntwort(null, FEHLER.intern, 'Interner Fehler'), 500);
  }
});
