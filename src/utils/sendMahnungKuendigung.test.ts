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
    // Seit 28.10.2026 aus der Vormerkung, bei aelteren App-Fassungen aus der Anfrage
    const pruefung = handler.indexOf('pruefeKuendigungsfelder(kuendigungRoh');
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/if \('fehler' in geprueft\)[\s\S]{0,250}, 400\)/);
    // Seit 28.10.2026 in bucheStufe(): Stufe und Kündigung in einem Update, für Mail und Post
    const buchen = quelle.slice(quelle.indexOf('async function bucheStufe('), quelle.indexOf('async function vormerkungBeanspruchen('));
    const update = buchen.indexOf("client.from('mietvertrag').update({\n    mahnstufe: b.neueStufe,");
    expect(update).toBeGreaterThan(0);
    expect(buchen.indexOf('...(b.kuendigung ? { ...b.kuendigung', update)).toBeGreaterThan(update);
    const mail = handler.slice(handler.indexOf('// ── E-Mail: SMTP'));
    expect(mail).toMatch(/await bucheStufe\(supabase, \{[\s\S]{0,250}kuendigung,\s*\}\);/);
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
    // Mit Vormerkung nennt die Mail Stufe und Betraege des gespeicherten Schreibens (28.10.2026)
    expect(handler).toContain('const htmlBody = generateMahnungHtml(inhalt, fristDatum);');
    expect(handler.indexOf('pruefeFristDatum(fristRoh')).toBeGreaterThan(0);
    expect(handler.indexOf('pruefeFristDatum(fristRoh')).toBeLessThan(handler.indexOf('transporter.sendMail('));
  });

  it('lehnt Stufe 3 für einen beendeten Vertrag vor dem Versand ab und setzt nur laufende Verträge', () => {
    expect(handler).toContain(".select('mahnstufe, status')");
    const pruefung = handler.indexOf("if (vertragVorher.status !== 'aktiv' && vertragVorher.status !== 'gekuendigt')");
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler.slice(pruefung, pruefung + 400)).toContain(', 409)');
    expect(quelle).toContain("if (b.kuendigung) stufenUpdate = stufenUpdate.in('status', ['aktiv', 'gekuendigt']);");
  });
});

/**
 * 28.10.2026: Stufe 3 per Post. Es gibt keinen Ersatzweg im Browser — die Kündigungsfelder sind beim
 * Vormerken und bei der Postbuchung Pflicht und kommen beim Versand aus der Vormerkung.
 */
describe('send-mahnung: Stufe 3 beim Vormerken und per Post', () => {
  it('verlangt die Kündigungsfelder für Vormerken und Post vor jeder Buchung', () => {
    const pflicht = handler.indexOf("if (stufe === 3 && versandart !== 'email' && (kuendigungRoh === undefined || kuendigungRoh === null))");
    expect(pflicht).toBeGreaterThan(0);
    expect(pflicht).toBeLessThan(handler.indexOf("if (versandart === 'vormerken') {\n      const betraege"));
    expect(pflicht).toBeLessThan(handler.indexOf('await bucheStufe(', handler.indexOf('// ── Post: beanspruchen')));
  });

  it('prüft eine Vormerkung beim Versand erneut gegen heute und bittet sonst um ein neues Schreiben', () => {
    expect(handler).toMatch(/const abhilfe = ausVormerkung \? ' Bitte ein neues Schreiben erstellen\.' : '';/);
    // Beim Vormerken gegen heute, beim Versand einer Vormerkung gegen Versandtag bzw. Zugang (Review 28.10.2026)
    expect(handler).toContain('pruefeKuendigungsfelder(kuendigungRoh, heuteIso)');
    expect(handler).toContain('pruefeVorgemerkteKuendigung(kuendigungRoh, heuteIso, zugangAm)');
    expect(handler).toContain('pruefeFristDatum(fristRoh, heuteIso)');
  });

  it('der Postweg im Dialog setzt den Status nicht selbst', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    const post = modal.slice(modal.indexOf('const handlePostBuchen'), modal.indexOf('const monatsmieteDesVertrags'));
    expect(post.length).toBeGreaterThan(100);
    expect(post).not.toContain(".from('mietvertrag')");
    expect(post).not.toContain('kuendigungGesetzt');
  });
});
