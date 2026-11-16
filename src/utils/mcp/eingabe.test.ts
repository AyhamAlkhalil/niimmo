import { describe, expect, it } from 'vitest';
import { istKalendertag, MONAT_FELD, objekt, pruefeEingabe, pruefeSchema } from '../../../supabase/functions/mcp/eingabe.ts';

const schema = objekt({
  id: { type: 'string', format: 'uuid', description: 'ID' },
  tag: { type: 'string', format: 'date', description: 'Tag' },
  monat: MONAT_FELD('Monat'),
  art: { type: 'string', enum: ['a', 'b'], description: 'Art' },
  zahl: { type: 'integer', minimum: 0, maximum: 3, description: 'Zahl' },
  betrag: { type: 'number', description: 'Betrag' },
  liste: { type: 'array', items: { type: 'string', format: 'uuid', description: 'ID' }, minItems: 1, maxItems: 2, description: 'IDs' },
  text: { type: 'string', minLength: 2, maxLength: 4, description: 'Text' },
  schalter: { type: 'boolean', description: 'Schalter' },
}, ['id']);

const ID = '11111111-2222-4333-8444-555555555555';

describe('Eingabeprüfung der MCP-Werkzeuge', () => {
  it('lässt eine passende Eingabe durch', () => {
    expect(pruefeEingabe({ id: ID, tag: '2026-11-16', monat: '2026-11', art: 'a', zahl: 3, betrag: -12.5, liste: [ID], text: 'ab', schalter: false }, schema)).toEqual([]);
  });

  it('nennt jede Verletzung', () => {
    const fehler = pruefeEingabe({ tag: '2026-02-30', monat: '2026-13', art: 'c', zahl: 1.5, betrag: '12', liste: [], text: 'abcde', schalter: 'ja', neu: 1 }, schema);
    expect(fehler).toEqual(expect.arrayContaining([
      'id: fehlt',
      'tag: Datum im Format JJJJ-MM-TT erwartet',
      'monat: Format ungültig',
      'art: erlaubt sind a, b',
      'zahl: ganze Zahl erwartet',
      'betrag: Zahl erwartet',
      'liste: mindestens 1 Einträge',
      'text: höchstens 4 Zeichen',
      'schalter: true oder false erwartet',
      'neu: unbekanntes Feld',
    ]));
  });

  it('nimmt null als „nicht angegeben“, aber nicht bei Pflichtfeldern', () => {
    expect(pruefeEingabe({ id: ID, tag: null }, schema)).toEqual([]);
    expect(pruefeEingabe({ id: null }, schema)).toEqual(['id: fehlt']);
    expect(pruefeEingabe(undefined, schema)).toEqual(['id: fehlt']);
  });

  it('prüft echte Kalendertage', () => {
    expect(istKalendertag('2028-02-29')).toBe(true);
    expect(istKalendertag('2026-02-29')).toBe(false);
    expect(istKalendertag('2026-11-31')).toBe(false);
  });

  it('weist Schemas mit nicht geprüften Schlüsseln ab', () => {
    expect(() => pruefeSchema(schema)).not.toThrow();
    expect(() => pruefeSchema({ type: 'string', oneOf: [] } as never)).toThrow(/oneOf/);
    expect(() => pruefeSchema({ type: 'object', properties: {}, required: ['x'] })).toThrow(/Pflichtfeld x/);
  });

  it('lässt geerbte Namen nicht als Felder durch', () => {
    expect(pruefeEingabe(JSON.parse('{"id":"11111111-2222-4333-8444-555555555555","__proto__":{"x":1},"constructor":1,"toString":"x"}'), schema))
      .toEqual(['__proto__: unbekanntes Feld', 'constructor: unbekanntes Feld', 'toString: unbekanntes Feld']);
    expect(() => pruefeSchema({ type: 'object', properties: {}, required: ['toString'] })).toThrow(/Pflichtfeld toString/);
    expect(pruefeEingabe({}, objekt({ toString: { type: 'string', description: 'x' } }, ['toString']))).toEqual(['toString: fehlt']);
  });
});
