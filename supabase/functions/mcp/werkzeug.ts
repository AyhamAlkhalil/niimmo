// Gemeinsame Typen und Helfer der MCP-Werkzeuge (16.11.2026).
// Ohne Bibliotheksimporte, damit Deno und Vitest dieselbe Datei laden.

import type { Schema } from './eingabe.ts';
import { mieterName } from '../_shared/namen.ts';

export type Rolle = 'admin' | 'hausmeister';

/**
 * Was ein Werkzeug beim Aufruf bekommt. `db` ist ein supabase-js-Client mit dem Token des angemeldeten Nutzers:
 * Jede Abfrage läuft unter dessen RLS, genau wie in der App. Einen Service-Role-Client gibt es im MCP-Server nicht.
 */
export interface Kontext {
  // deno-lint-ignore no-explicit-any
  db: any;
  benutzerId: string;
  rollen: ReadonlySet<Rolle>;
  /** Kalendertag in Europe/Berlin (JJJJ-MM-TT) */
  heute: string;
  /** Mittag dieses Kalendertags — der Rechenkern liest die lokalen Datumsteile, Deno läuft in UTC */
  stichtag: Date;
  /**
   * Protokolliert einen Schreibvorgang in activity_logs (wie useActivityLog der App), gelungen oder nicht; `vorher`
   * sind die Werte vor der Änderung, soweit das Werkzeug sie zurückgibt (keine Kontaktdaten)
   */
  protokolliere?: (werkzeug: string, eingabe: Record<string, unknown>, ausgang: { ok: boolean; vorher?: unknown }) => Promise<void>;
}

export interface Werkzeug {
  name: string;
  titel: string;
  beschreibung: string;
  eingabe: Schema;
  /** Wer das Werkzeug sieht und nutzen darf — RLS prüft zusätzlich jede Abfrage */
  rollen: readonly Rolle[];
  /** Ändert Daten. Lesende Werkzeuge melden readOnlyHint an den Client. */
  schreibt: boolean;
  /** Löscht oder nimmt etwas unumkehrbar zurück */
  zerstoerend?: boolean;
  ausfuehren(eingabe: Record<string, unknown>, ctx: Kontext): Promise<unknown>;
}

/**
 * Fachlicher Fehler mit fester, für den Nutzer bestimmter Meldung. Alles andere meldet der Server nur als
 * „interner Fehler“ (docs/architektur.md §7: Fehlermeldungen an den Aufrufer sind fachlich und fest).
 */
export class Fachfehler extends Error {
  constructor(meldung: string) {
    super(meldung);
    this.name = 'Fachfehler';
  }
}

export const NUR_ADMIN: readonly Rolle[] = ['admin'];
export const ALLE: readonly Rolle[] = ['admin', 'hausmeister'];

/** Kalendertag in Europe/Berlin (JJJJ-MM-TT). Server und Edge Functions laufen in UTC. */
export function heuteInBerlin(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(jetzt);
}

/** Mittag des Kalendertags in der Zeitzone des Prozesses — wie send-mahnung den Stichtag für den Rechenkern bildet */
export function stichtagAus(tag: string): Date {
  const [jahr, monat, t] = tag.split('-').map(Number);
  return new Date(jahr, monat - 1, t, 12);
}

const SEITE = 1000;

/**
 * Alle Zeilen einer Abfrage, seitenweise: PostgREST liefert still höchstens 1000 (CLAUDE.md Regel 7).
 * Die Abfrage muss eine feste Ordnung haben, sonst überlappen die Seiten.
 */
export async function alleZeilen<T>(
  abfrage: (von: number, bis: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  bezeichnung: string,
): Promise<T[]> {
  const zeilen: T[] = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await abfrage(von, von + SEITE - 1);
    if (error) {
      console.error(`[mcp] ${bezeichnung} nicht lesbar:`, error.message);
      throw new Fachfehler(`${bezeichnung} konnten nicht gelesen werden.`);
    }
    zeilen.push(...(data ?? []));
    if (!data || data.length < SEITE) return zeilen;
  }
}

/** Ergebnis einer einzelnen Abfrage oder ein fester Fachfehler */
export function ergebnis<T>(antwort: { data: T; error: { message: string } | null }, bezeichnung: string): T {
  if (antwort.error) {
    console.error(`[mcp] ${bezeichnung}:`, antwort.error.message);
    throw new Fachfehler(`${bezeichnung} ist fehlgeschlagen.`);
  }
  return antwort.data;
}

export interface DbFehler {
  message: string;
  code?: string;
  hint?: string | null;
}

/**
 * Fachliche Meldung zu einem Schreibfehler. Geschäftsregeln der Datenbank (Trigger mit P0001 ohne Hinweiscode, z. B.
 * Umbuchungssperre oder Mahnstufe) haben feste deutsche Texte und gehen im Wortlaut durch; alles andere fest.
 */
export function schreibfehler(fehler: DbFehler, was: string): Fachfehler {
  console.error(`[mcp] ${was}:`, fehler.code ?? '', fehler.message);
  if (fehler.code === 'P0001' && !fehler.hint) return new Fachfehler(fehler.message);
  if (fehler.code === '23505') return new Fachfehler(`${was}: Ein solcher Eintrag besteht schon.`);
  if (fehler.code === '23514' || fehler.code === '23502') return new Fachfehler(`${was}: Die Werte verletzen eine Regel der Datenbank.`);
  if (fehler.code === '23503') return new Fachfehler(`${was}: Ein verknüpfter Datensatz fehlt oder hängt noch an anderen Daten.`);
  if (fehler.code === '42501') return new Fachfehler(`${was}: Keine Berechtigung.`);
  return new Fachfehler(`${was} ist fehlgeschlagen.`);
}

/**
 * Ändert genau eine Zeile. Ein UPDATE, das RLS verweigert, trifft still null Zeilen und meldet keinen Fehler —
 * deshalb mit Rückgabe der id und Prüfung der Anzahl.
 */
export async function aendereZeile(
  ctx: Kontext,
  tabelle: string,
  id: string,
  felder: Record<string, unknown>,
  was: string,
): Promise<void> {
  const { data, error } = await ctx.db.from(tabelle).update(felder).eq('id', id).select('id');
  if (error) throw schreibfehler(error, was);
  if (!data || data.length === 0) throw new Fachfehler(`${was}: Datensatz nicht gefunden oder keine Berechtigung.`);
}

/** Löscht genau eine Zeile, mit derselben Prüfung wie aendereZeile */
export async function loescheZeile(ctx: Kontext, tabelle: string, id: string, was: string): Promise<void> {
  const { data, error } = await ctx.db.from(tabelle).delete().eq('id', id).select('id');
  if (error) throw schreibfehler(error, was);
  if (!data || data.length === 0) throw new Fachfehler(`${was}: Datensatz nicht gefunden oder keine Berechtigung.`);
}

/** Genau eine Zeile oder Fachfehler „nicht gefunden“ (auch, wenn RLS sie verbirgt) */
export function genauEine<T>(antwort: { data: T | null; error: { message: string } | null }, was: string): T {
  const zeile = ergebnis(antwort, `Lesen: ${was}`);
  if (!zeile) throw new Fachfehler(`${was} nicht gefunden oder kein Zugriff.`);
  return zeile;
}

/**
 * IBANs in Freitext unkenntlich machen (Verwendungszweck, Auftraggeber): Bankdaten gehen nicht an den KI-Anbieter
 * (docs/architektur.md §7). Erkannt wird Ländercode, Prüfziffer und 11–30 Zeichen, auch in Vierergruppen.
 */
export function ohneIban(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, '[IBAN]');
}

/** Auf Cent gerundet, ohne „-0“ */
export function cent(betrag: number): number {
  const gerundet = Math.round(betrag * 100) / 100;
  return gerundet === 0 ? 0 : gerundet;
}

/** Name eines Mieters für Listen: der kanonische „Vorname Nachname“, ersatzweise der Firmenname */
export function mieterBezeichnung(
  m: { vorname?: string | null; nachname?: string | null; firmenname?: string | null } | null | undefined,
): string {
  if (!m) return 'Unbekannt';
  return mieterName(m) || m.firmenname?.trim() || 'Unbekannt';
}
