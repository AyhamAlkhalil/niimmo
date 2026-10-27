import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
