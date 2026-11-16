import { supabase } from '@/integrations/supabase/client';
import { leseAutorisierung, type AutorisierungsAntwort } from '@/utils/oauthZustimmung';

/**
 * Aufrufe des OAuth-Servers von Supabase Auth für die Zustimmungsseite (16.11.2026).
 *
 * supabase-js 2.58 kennt `auth.oauth.*` noch nicht (erst ab 2.7x). Die Seite ruft deshalb dieselben Endpunkte wie
 * auth-js 2.119 (`_getAuthorizationDetails`, `_approveAuthorization`): GET /oauth/authorizations/{id} und
 * POST …/consent mit dem Sitzungstoken. Adresse und apikey kommen aus dem Auth-Client von client.ts, damit keine
 * zweite Kopie entsteht; nach einem Update von supabase-js durch `supabase.auth.oauth` ersetzen.
 */

const API_VERSION = '2024-01-01';

interface AuthInterna {
  url?: unknown;
  headers?: unknown;
}

function authAdresse(): { url: string; apikey: string } {
  const intern = supabase.auth as unknown as AuthInterna;
  const kopf = (intern.headers ?? {}) as Record<string, unknown>;
  if (typeof intern.url !== 'string' || typeof kopf.apikey !== 'string') {
    throw new Error('Die Anmeldung für Claude ist in dieser Version der App nicht verfügbar.');
  }
  return { url: intern.url, apikey: kopf.apikey };
}

async function aufruf(pfad: string, init: RequestInit = {}): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Bitte zuerst anmelden.');
  const { url, apikey } = authAdresse();
  const antwort = await fetch(`${url}${pfad}`, {
    ...init,
    headers: {
      apikey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'X-Supabase-Api-Version': API_VERSION,
    },
  });
  if (!antwort.ok) {
    console.error('[oauth] Auth antwortet mit', antwort.status);
    throw new Error(
      antwort.status === 404
        ? 'Die Anfrage ist abgelaufen oder unbekannt. Bitte die Verbindung in Claude neu starten.'
        : 'Die Anfrage konnte nicht bearbeitet werden. Bitte die Verbindung in Claude neu starten.',
    );
  }
  return antwort.json();
}

export async function ladeAutorisierung(autorisierungsId: string): Promise<AutorisierungsAntwort> {
  const daten = leseAutorisierung(await aufruf(`/oauth/authorizations/${encodeURIComponent(autorisierungsId)}`));
  if (!daten) throw new Error('Die Antwort des Anmeldedienstes ist unvollständig.');
  return daten;
}

/** Zustimmen oder ablehnen; liefert die Adresse, an die der Browser zurück zum Client geht */
export async function entscheideAutorisierung(autorisierungsId: string, aktion: 'approve' | 'deny'): Promise<string> {
  const daten = await aufruf(`/oauth/authorizations/${encodeURIComponent(autorisierungsId)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ action: aktion }),
  });
  const antwort = leseAutorisierung(daten);
  if (antwort?.art !== 'weiter') throw new Error('Die Antwort des Anmeldedienstes ist unvollständig.');
  return antwort.redirect_url;
}
