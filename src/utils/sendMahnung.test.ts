import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * send-mahnung läuft unter Deno und hier nicht. Der Test liest den Quelltext und sichert die
 * Reihenfolge der Prüfungen ab, an denen die Regel „Mahnstufe steigt nur durch Versand“ hängt.
 */
const quelle = readFileSync('supabase/functions/send-mahnung/index.ts', 'utf-8');
const handler = quelle.slice(quelle.indexOf('serve(async'));

describe('send-mahnung Mahnstufe', () => {
  it('prüft die angefragte Stufe vor dem Versand gegen die gespeicherte', () => {
    // 27.10.2026: Eine veraltete Stufe aus dem Dialog ging mit Schreiben und Mail raus
    const pruefung = handler.indexOf('if (data.mahnstufe !== bisherigeStufe + 1)');
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/if \(bisherigeStufe >= 3\)[\s\S]{0,200}status: 409/);
  });

  it('erhöht erst nach dem Versand und nur, wenn der Stand noch derselbe ist', () => {
    const update = handler.indexOf("from('mietvertrag').update({\n      mahnstufe: neueMahnstufe");
    expect(update).toBeGreaterThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/stufenUpdate\.eq\('mahnstufe', vertragVorher\.mahnstufe\)/);
    expect(handler).toMatch(/aktualisiert\.length === 0/);
  });
});

describe('send-mahnung CC-Adressen', () => {
  const zeile = quelle.split('\n').find((z) => z.startsWith('const MAILADRESSE ='));
  const muster = new RegExp((zeile ?? '').replace(/^const MAILADRESSE = \/(.*)\/;$/, '$1'));

  it('lässt nur wohlgeformte Adressen in den Mailkopf', () => {
    // 27.10.2026: Der Inhalt des freien CC-Felds ging ungeprüft in den Mailkopf
    expect(zeile).toBeDefined();
    expect(muster.test('kopie@niimmo.de')).toBe(true);
    expect(muster.test('a.b+c@kanzlei-x.de')).toBe(true);
    for (const falsch of ['', 'kopie', 'a@b', 'a b@c.de', 'a@b.de, c@d.de', 'x@y.de\r\nBcc: z@w.de', '"Name" <a@b.de>']) {
      expect(muster.test(falsch), falsch).toBe(false);
    }
  });

  it('prüft vor dem Versand und schickt nur die geprüfte Liste', () => {
    expect(handler.indexOf('kopie.some((adresse) => !MAILADRESSE.test(adresse))')).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/mailOptions\.cc = kopie\.join/);
    expect(handler).not.toMatch(/data\.ccEmails\.join/);
  });
});

describe('send-mahnung Datum und Fehler', () => {
  const start = quelle.indexOf('function berlinerTag(');
  const code = quelle.slice(start, quelle.indexOf('\n}\n', start) + 3);
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const berlinerTag: (versatz: number) => string = new Function(`${js}\nreturn berlinerTag;`)();

  afterEach(() => vi.useRealTimers());

  it('nennt Datum und Frist in deutscher Zeit, auch zwischen 0 und 2 Uhr', () => {
    // 27.10.2026: Die Function läuft in UTC, die Mail lag dann einen Tag vor dem Schreiben
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T23:30:00Z'));
    expect(berlinerTag(0)).toBe('28.10.2026');
    expect(berlinerTag(7)).toBe('04.11.2026');
    vi.setSystemTime(new Date('2026-07-31T22:30:00Z'));
    expect(berlinerTag(0)).toBe('01.08.2026');
    vi.setSystemTime(new Date('2026-03-27T12:00:00Z'));
    expect(berlinerTag(3)).toBe('30.03.2026');
  });

  it('gibt keine Rohmeldung des Mailservers an den Aufrufer zurück', () => {
    expect(handler).not.toMatch(/error: error instanceof Error \? error\.message/);
    expect(handler).not.toMatch(/throw new Error\("SMTP-Konfiguration/);
  });
});
