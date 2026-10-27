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
