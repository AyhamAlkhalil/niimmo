/**
 * Zustimmungsseite für den MCP-Zugang (16.11.2026): Claude meldet sich per OAuth über Supabase Auth an, Supabase
 * schickt den Nutzer mit `authorization_id` nach /oauth/consent. Reine Regeln, ohne Supabase-Client.
 *
 * Die Dynamic Client Registration ist offen — jeder kann sich als OAuth-Client eintragen. Zugelassen wird deshalb
 * nur, wessen Rücksprungadresse bei Claude liegt; einer fremden Anwendung gibt die Seite keinen Zugang, auch wenn der
 * Nutzer zustimmen wollte. Die Prüfung gilt im Browser des Nutzers, ohne den kein Code ausgestellt wird.
 */

/** Rücksprungziele, an die ein Autorisierungscode gehen darf: der OAuth-Callback der Claude-Konnektoren */
export const ERLAUBTE_RUECKSPRUNG_HOSTS = ['claude.ai', 'claude.com'] as const;
export const RUECKSPRUNG_PFAD = '/api/mcp/auth_callback';

const AUTORISIERUNGS_ID = /^[A-Za-z0-9_-]{8,200}$/;

export function gueltigeAutorisierungsId(id: unknown): id is string {
  return typeof id === 'string' && AUTORISIERUNGS_ID.test(id);
}

/** Pfad der Zustimmungsseite für eine Anfrage — Ziel nach der Anmeldung (Auth.tsx) */
export function zustimmungsPfad(id: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
}

/**
 * Darf ein Code an diese Adresse gehen? Nur https, nur die Hosts oben (ohne Unterdomänen-Tricks wie claude.ai.evil.de),
 * Standardport und genau der Callback-Pfad — nicht irgendeine Seite auf claude.ai.
 */
export function ruecksprungErlaubt(adresse: string | null | undefined): boolean {
  if (!adresse) return false;
  let url: URL;
  try {
    url = new URL(adresse);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && url.port === '' &&
    url.pathname === RUECKSPRUNG_PFAD &&
    (ERLAUBTE_RUECKSPRUNG_HOSTS as readonly string[]).includes(url.hostname.toLowerCase());
}

export interface AutorisierungsDetails {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri?: string | null; logo_uri?: string | null };
  user: { id: string; email: string };
  scope: string;
}

export type AutorisierungsAntwort =
  | { art: 'zustimmung'; details: AutorisierungsDetails }
  | { art: 'weiter'; redirect_url: string };

/** Antwort von GET /oauth/authorizations/{id}: Zustimmung nötig oder schon erteilt (nur redirect_url) */
export function leseAutorisierung(daten: unknown): AutorisierungsAntwort | null {
  if (typeof daten !== 'object' || daten === null) return null;
  const d = daten as Record<string, unknown>;
  if (typeof d.authorization_id === 'string' && typeof d.redirect_uri === 'string' && typeof d.client === 'object' && d.client) {
    const client = d.client as Record<string, unknown>;
    const user = (d.user ?? {}) as Record<string, unknown>;
    return {
      art: 'zustimmung',
      details: {
        authorization_id: d.authorization_id,
        redirect_uri: d.redirect_uri,
        client: {
          id: String(client.id ?? ''),
          name: typeof client.name === 'string' && client.name.trim() ? client.name.trim() : 'Unbekannte Anwendung',
          uri: typeof client.uri === 'string' ? client.uri : null,
          logo_uri: typeof client.logo_uri === 'string' ? client.logo_uri : null,
        },
        user: { id: String(user.id ?? ''), email: String(user.email ?? '') },
        scope: typeof d.scope === 'string' ? d.scope : '',
      },
    };
  }
  if (typeof d.redirect_url === 'string') return { art: 'weiter', redirect_url: d.redirect_url };
  return null;
}
