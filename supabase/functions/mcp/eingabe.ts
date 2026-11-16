// Prüfung der Werkzeug-Eingaben gegen ihr JSON-Schema (16.11.2026).
// Bewusst ohne Bibliothek: Dieselbe Datei läuft in Deno (Edge Function mcp) und in Vitest. Unterstützt nur die
// Teilmenge von JSON Schema, die die Werkzeuge verwenden; alles andere weist `pruefeSchema` ab (Katalogtest in
// src/utils/mcp/werkzeuge.test.ts).

export interface Schema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: false;
  enum?: readonly (string | number)[];
  format?: 'uuid' | 'date';
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Ein echter Kalendertag (2026-02-30 ist keiner) */
export function istKalendertag(text: string): boolean {
  if (!DATUM.test(text)) return false;
  const [j, m, t] = text.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

function pruefeWert(wert: unknown, schema: Schema, pfad: string, fehler: string[]): void {
  const name = pfad || 'Eingabe';
  switch (schema.type) {
    case 'object': {
      if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) {
        fehler.push(`${name}: Objekt erwartet`);
        return;
      }
      const obj = wert as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const pflicht of schema.required ?? []) {
        const vorhanden = Object.prototype.hasOwnProperty.call(obj, pflicht) && obj[pflicht] !== undefined && obj[pflicht] !== null;
        if (!vorhanden) fehler.push(`${pfad ? `${pfad}.` : ''}${pflicht}: fehlt`);
      }
      for (const [schluessel, inhalt] of Object.entries(obj)) {
        // Nur eigene Felder des Schemas: props['constructor'] fände sonst Object.prototype.constructor (QA 16.11.2026)
        const unter = Object.prototype.hasOwnProperty.call(props, schluessel) ? props[schluessel] : undefined;
        const unterPfad = pfad ? `${pfad}.${schluessel}` : schluessel;
        if (!unter) {
          if (schema.additionalProperties === false) fehler.push(`${unterPfad}: unbekanntes Feld`);
          continue;
        }
        // null steht für „nicht angegeben“; Pflichtfelder sind oben schon geprüft
        if (inhalt === null || inhalt === undefined) continue;
        pruefeWert(inhalt, unter, unterPfad, fehler);
      }
      return;
    }
    case 'string': {
      if (typeof wert !== 'string') {
        fehler.push(`${name}: Text erwartet`);
        return;
      }
      if (schema.minLength !== undefined && wert.length < schema.minLength) fehler.push(`${name}: mindestens ${schema.minLength} Zeichen`);
      if (schema.maxLength !== undefined && wert.length > schema.maxLength) fehler.push(`${name}: höchstens ${schema.maxLength} Zeichen`);
      if (schema.format === 'uuid' && !UUID.test(wert)) fehler.push(`${name}: keine gültige ID`);
      if (schema.format === 'date' && !istKalendertag(wert)) fehler.push(`${name}: Datum im Format JJJJ-MM-TT erwartet`);
      if (schema.pattern && !new RegExp(schema.pattern).test(wert)) fehler.push(`${name}: Format ungültig`);
      if (schema.enum && !schema.enum.includes(wert)) fehler.push(`${name}: erlaubt sind ${schema.enum.join(', ')}`);
      return;
    }
    case 'number':
    case 'integer': {
      if (typeof wert !== 'number' || !Number.isFinite(wert)) {
        fehler.push(`${name}: Zahl erwartet`);
        return;
      }
      if (schema.type === 'integer' && !Number.isInteger(wert)) fehler.push(`${name}: ganze Zahl erwartet`);
      if (schema.minimum !== undefined && wert < schema.minimum) fehler.push(`${name}: mindestens ${schema.minimum}`);
      if (schema.maximum !== undefined && wert > schema.maximum) fehler.push(`${name}: höchstens ${schema.maximum}`);
      if (schema.enum && !schema.enum.includes(wert)) fehler.push(`${name}: erlaubt sind ${schema.enum.join(', ')}`);
      return;
    }
    case 'boolean':
      if (typeof wert !== 'boolean') fehler.push(`${name}: true oder false erwartet`);
      return;
    case 'array': {
      if (!Array.isArray(wert)) {
        fehler.push(`${name}: Liste erwartet`);
        return;
      }
      if (schema.minItems !== undefined && wert.length < schema.minItems) fehler.push(`${name}: mindestens ${schema.minItems} Einträge`);
      if (schema.maxItems !== undefined && wert.length > schema.maxItems) fehler.push(`${name}: höchstens ${schema.maxItems} Einträge`);
      if (schema.items) wert.forEach((eintrag, i) => pruefeWert(eintrag, schema.items as Schema, `${name}[${i}]`, fehler));
      return;
    }
  }
}

/** Fehlermeldungen der Eingabe, leer wenn sie passt */
export function pruefeEingabe(wert: unknown, schema: Schema): string[] {
  const fehler: string[] = [];
  pruefeWert(wert ?? {}, schema, '', fehler);
  return fehler;
}

const BEKANNT = new Set([
  'type', 'description', 'properties', 'required', 'additionalProperties', 'enum', 'format', 'pattern',
  'minimum', 'maximum', 'minLength', 'maxLength', 'items', 'minItems', 'maxItems',
]);

/** Wirft, wenn ein Schema Schlüssel nutzt, die `pruefeEingabe` nicht prüft — sonst gälte eine Regel nur dem Anschein nach */
export function pruefeSchema(schema: Schema, pfad = ''): void {
  for (const schluessel of Object.keys(schema)) {
    if (!BEKANNT.has(schluessel)) throw new Error(`Schema ${pfad || '(Wurzel)'}: nicht unterstützter Schlüssel ${schluessel}`);
  }
  for (const [name, unter] of Object.entries(schema.properties ?? {})) pruefeSchema(unter, `${pfad}.${name}`);
  if (schema.items) pruefeSchema(schema.items, `${pfad}[]`);
  for (const pflicht of schema.required ?? []) {
    if (!schema.properties || !Object.prototype.hasOwnProperty.call(schema.properties, pflicht)) {
      throw new Error(`Schema ${pfad || '(Wurzel)'}: Pflichtfeld ${pflicht} ohne Beschreibung`);
    }
  }
}

// Bausteine für die Werkzeug-Schemas
export const ID = (description: string): Schema => ({ type: 'string', format: 'uuid', description });
export const DATUM_FELD = (description: string): Schema => ({ type: 'string', format: 'date', description });
export const MONAT_FELD = (description: string): Schema => ({
  type: 'string',
  pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
  description,
});
export const TEXT = (description: string, maxLength = 500): Schema => ({ type: 'string', maxLength, description });
export const BETRAG = (description: string): Schema => ({ type: 'number', minimum: -1_000_000, maximum: 1_000_000, description });
export const ANZAHL = (description: string, maximum: number): Schema => ({ type: 'integer', minimum: 1, maximum, description });
export const objekt = (properties: Record<string, Schema>, required: readonly string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
