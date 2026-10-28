import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fristloseKuendigungFelder } from './contractUtils';

/**
 * Prüfung 28.10.2026: Stufe 3 setzte den Vertragsstatus nur im Browser nach der Antwort von
 * send-mahnung. Ging sie verloren, blieb der Vertrag aktiv, und ein neuer Versuch bekam 409.
 * Jetzt schickt der Dialog die Felder aus fristloseKuendigungFelder() mit, die Function prüft
 * sie und setzt sie im selben Update wie die Stufe.
 *
 * Deno-Code läuft hier nicht: Der Test schneidet die Prüfung aus dem Quelltext, übersetzt sie
 * und führt sie aus (wie sendMahnung.test.ts).
 */
const quelle = readFileSync('supabase/functions/send-mahnung/index.ts', 'utf-8');
const handler = quelle.slice(quelle.indexOf('serve(async'));

function ausschnitt(kopf: string): string {
  const start = quelle.indexOf(kopf);
  expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
  return quelle.slice(start, quelle.indexOf('\n}\n', start) + 3);
}

const js = ts.transpileModule(
  [ausschnitt('function istKalendertag('), ausschnitt('function pruefeKuendigungsfelder('), ausschnitt('function pruefeFristDatum(')].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
).outputText;
type Ergebnis = { status: string; kuendigungsdatum: string; ende_datum: string } | { fehler: string };
const geladen = new Function(`${js}\nreturn { pruefeKuendigungsfelder, pruefeFristDatum };`)() as {
  pruefeKuendigungsfelder: (felder: unknown, heute: string) => Ergebnis;
  pruefeFristDatum: (wert: unknown, heute: string) => string | { fehler: string };
};
const pruefe = geladen.pruefeKuendigungsfelder;

describe('send-mahnung prüft die Felder der fristlosen Kündigung', () => {
  it('nimmt an, was fristloseKuendigungFelder im Browser liefert', () => {
    const felder = fristloseKuendigungFelder(14, new Date(2026, 9, 28));
    expect(pruefe(felder, '2026-10-28')).toEqual({ status: 'gekuendigt', kuendigungsdatum: '2026-11-11', ende_datum: '2026-11-11' });
    // Ein früheres, noch nicht vergangenes Vertragsende bleibt — auch heute selbst
    expect(pruefe(fristloseKuendigungFelder(14, new Date(2026, 9, 28), '2026-10-28'), '2026-10-28')).not.toHaveProperty('fehler');
  });

  it('lehnt Form, Vergangenheit, verdrehte Reihenfolge und überlange Fristen ab', () => {
    const heute = '2026-10-28';
    const fall = (f: Record<string, unknown>) => pruefe({ status: 'gekuendigt', kuendigungsdatum: '2026-11-11', ende_datum: '2026-11-11', ...f }, heute);
    expect(fall({ status: 'beendet' })).toHaveProperty('fehler');
    expect(pruefe(null, heute)).toHaveProperty('fehler');
    expect(pruefe('gekuendigt', heute)).toHaveProperty('fehler');
    expect(fall({ kuendigungsdatum: '11.11.2026' })).toHaveProperty('fehler');
    expect(fall({ ende_datum: '2026-02-31' })).toHaveProperty('fehler');
    expect(fall({ kuendigungsdatum: '2026-10-27', ende_datum: '2026-10-27' })).toHaveProperty('fehler');
    expect(fall({ ende_datum: '2026-11-10' })).toHaveProperty('fehler');
    expect(fall({ ende_datum: '2027-10-29' })).toHaveProperty('fehler');
    expect(fall({ ende_datum: '2027-10-28' })).not.toHaveProperty('fehler');
  });

  it('prüft vor dem Versand und setzt die Felder im selben Update wie die Stufe', () => {
    const pruefung = handler.indexOf('pruefeKuendigungsfelder(data.kuendigung');
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/if \('fehler' in geprueft\)[\s\S]{0,200}status: 400/);
    const update = handler.indexOf("from('mietvertrag').update({\n      mahnstufe: neueMahnstufe");
    expect(handler.indexOf('...(kuendigung ? { ...kuendigung', update)).toBeGreaterThan(update);
    expect(handler).toContain('kuendigungGesetzt: kuendigung !== null && gespeichert');
  });

  it('der Dialog schickt die Felder mit und setzt den Status nur noch ersatzweise selbst', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).toMatch(/const kuendigung = mahnstufe >= 3\s*\? \{ \.\.\.fristloseKuendigungFelder\(/);
    expect(modal).toMatch(/mietvertragId: contractData\.mietvertrag_id,\s*kuendigung,/);
    expect(modal).toContain("if (kuendigung && versand?.kuendigungGesetzt === true)");
  });
});

/**
 * Review 28.10.2026: Die Mail rechnete die Zahlungsfrist am Versandtag (berlinerTag(fristTage)), das PDF
 * am Speichertag. Und ein beendeter Vertrag wäre durch Stufe 3 auf 'gekuendigt' zurückgeholt worden.
 */
describe('send-mahnung: Frist als Datum und kein Zurückholen beendeter Verträge', () => {
  it('nimmt eine Frist als Datum an: echt, nicht vergangen, höchstens 60 Tage', () => {
    const heute = '2026-10-28';
    expect(geladen.pruefeFristDatum('2026-11-04', heute)).toBe('2026-11-04');
    expect(geladen.pruefeFristDatum('2026-10-28', heute)).toBe('2026-10-28');
    expect(geladen.pruefeFristDatum('2026-12-27', heute)).toBe('2026-12-27');
    expect(geladen.pruefeFristDatum('2026-12-28', heute)).toHaveProperty('fehler');
    expect(geladen.pruefeFristDatum('2026-10-27', heute)).toHaveProperty('fehler');
    expect(geladen.pruefeFristDatum('2026-02-30', heute)).toHaveProperty('fehler');
    expect(geladen.pruefeFristDatum(7, heute)).toHaveProperty('fehler');
  });

  it('nennt in der Mail das geprüfte Datum und rechnet nur ohne es ab heute', () => {
    expect(quelle).toContain("const fristFormatted = fristDatum ? fristDatum.split('-').reverse().join('.') : berlinerTag(fristTage);");
    expect(handler).toContain('const htmlBody = generateMahnungHtml(data, fristDatum);');
    expect(handler.indexOf('pruefeFristDatum(data.fristDatum')).toBeLessThan(handler.indexOf('transporter.sendMail('));
  });

  it('lehnt Stufe 3 für einen beendeten Vertrag vor dem Versand ab und setzt nur laufende Verträge', () => {
    expect(handler).toContain(".select('mahnstufe, status')");
    const pruefung = handler.indexOf("if (vertragVorher.status !== 'aktiv' && vertragVorher.status !== 'gekuendigt')");
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler.slice(pruefung, pruefung + 400)).toContain('status: 409');
    expect(handler).toContain("if (kuendigung) stufenUpdate = stufenUpdate.in('status', ['aktiv', 'gekuendigt']);");
  });
});
