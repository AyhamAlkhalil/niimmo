import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as app from './mahnungVersand';
import { fristloseKuendigungFelder } from './contractUtils';

/**
 * send-mahnung läuft unter Deno und hier nicht. Der Test liest den Quelltext und sichert die
 * Reihenfolge der Prüfungen ab, an denen die Regel „Mahnstufe steigt nur durch Versand“ hängt.
 */
const quelle = readFileSync('supabase/functions/send-mahnung/index.ts', 'utf-8');
const handler = quelle.slice(quelle.indexOf('serve(async'));

describe('send-mahnung Mahnstufe', () => {
  it('prüft die angefragte Stufe vor dem Versand gegen die gespeicherte', () => {
    // 27.10.2026: Eine veraltete Stufe aus dem Dialog ging mit Schreiben und Mail raus
    // Seit 28.10.2026 ist die Stufe die der Vormerkung (oder bei aelteren App-Fassungen die angefragte)
    const pruefung = handler.indexOf('if (stufe !== bisherigeStufe + 1)');
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(handler.indexOf('transporter.sendMail('));
    expect(handler).toMatch(/if \(bisherigeStufe >= 3\)[\s\S]{0,200}, 409\)/);
  });

  it('erhöht erst nach dem Versand und nur, wenn der Stand noch derselbe ist', () => {
    // Seit 28.10.2026 bucht bucheStufe() für Mail, Post und das Klären abgebrochener Versände
    const versand = handler.indexOf('transporter.sendMail(');
    expect(handler.indexOf('await bucheStufe(', versand)).toBeGreaterThan(versand);
    const buchen = quelle.slice(quelle.indexOf('async function bucheStufe('), quelle.indexOf('async function vormerkungBeanspruchen('));
    expect(buchen).toContain("client.from('mietvertrag').update({\n    mahnstufe: b.neueStufe,");
    expect(buchen).toMatch(/stufenUpdate\.eq\('mahnstufe', b\.stufeVorher\)/);
    expect(buchen).toMatch(/aktualisiert\.length === 0/);
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

/**
 * 28.10.2026: Vormerken beim Speichern, Mailversand und Buchung „per Post versandt“. Die Prüfungen
 * werden aus dem Deno-Quelltext geschnitten, übersetzt und ausgeführt; die Regeln müssen mit
 * utils/mahnungVersand.ts übereinstimmen, die die Oberfläche vorab zeigt.
 */
describe('send-mahnung Postversand, Vormerkung und Empfänger', () => {
  function ausschnitt(kopf: string): string {
    const start = quelle.indexOf(kopf);
    expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
    return quelle.slice(start, quelle.indexOf('\n}\n', start) + 3);
  }
  const konstante = (name: string) => {
    const zeile = quelle.split('\n').find((z) => z.startsWith(`const ${name} =`));
    expect(zeile, name).toBeDefined();
    return zeile as string;
  };
  const js = ts.transpileModule(
    [
      konstante('MAILADRESSE'), konstante('MAX_EMPFAENGER'), konstante('POST_ZUGANG_TAGE'), konstante('SENDUNGSNUMMER'),
      ausschnitt('function istKalendertag('), ausschnitt('function tagPlus('), ausschnitt('function berlinerIsoTag('),
      ausschnitt('function pruefePostAufgabe('),
      ausschnitt('function pruefeSendungsnummer('), ausschnitt('function pruefeBetraege('), ausschnitt('function pruefeEmpfaenger('),
    ].join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  type Fehler = { fehler: string };
  const fn = new Function(`${js}\nreturn { tagPlus, berlinerIsoTag, pruefePostAufgabe, pruefeSendungsnummer, pruefeBetraege, pruefeEmpfaenger, POST_ZUGANG_TAGE, SENDUNGSNUMMER, MAX_EMPFAENGER };`)() as {
    tagPlus: (iso: string, tage: number) => string;
    berlinerIsoTag: (zeitpunkt: Date) => string;
    pruefePostAufgabe: (wert: unknown, schreibtag: string, heute: string, frist: string, raeumung: string | null) => { versendetAm: string; zugangAm: string } | Fehler;
    pruefeSendungsnummer: (wert: unknown) => string | null | Fehler;
    pruefeBetraege: (wert: unknown) => Record<string, number> | Fehler;
    pruefeEmpfaenger: (liste: unknown, einzeln: unknown, erlaubt: Set<string>) => string[] | { fehler: string; status: number };
    POST_ZUGANG_TAGE: number;
    SENDUNGSNUMMER: RegExp;
    MAX_EMPFAENGER: number;
  };

  it('rechnet Zugang und Fristen wie die App', () => {
    expect(fn.POST_ZUGANG_TAGE).toBe(app.POST_ZUGANG_TAGE);
    expect(fn.MAX_EMPFAENGER).toBe(app.MAX_EMPFAENGER);
    expect(fn.SENDUNGSNUMMER.source).toBe(app.SENDUNGSNUMMER.source);
    for (let i = 0; i < 800; i++) {
      const tag = app.tagPlus('2026-01-01', i);
      expect(fn.tagPlus(tag, 3)).toBe(app.tagPlus(tag, 3));
    }
    // Dieselben Fälle müssen in Function und Oberfläche gleich ausgehen
    const faelle: Array<[string, string, string, string, string | null]> = [
      ['2026-10-28', '2026-10-28', '2026-10-28', '2026-11-07', null],
      ['2026-10-28', '2026-10-28', '2026-10-28', '2026-10-31', null],
      ['2026-10-28', '2026-10-28', '2026-10-28', '2026-10-30', null],
      ['2026-10-29', '2026-10-28', '2026-10-28', '2026-11-07', null],
      ['2026-10-27', '2026-10-28', '2026-10-28', '2026-11-07', null],
      ['2026-10-28', '2026-10-28', '2026-10-28', '2026-11-07', '2026-10-30'],
      ['2026-10-28', '2026-10-28', '2026-10-30', '2026-11-07', '2026-11-11'],
    ];
    for (const [aufgabe, schreibtag, heute, frist, raeumung] of faelle) {
      const server = fn.pruefePostAufgabe(aufgabe, schreibtag, heute, frist, raeumung);
      const oberflaeche = app.postversandFehler({ aufgabeIso: aufgabe, schreibtagIso: schreibtag, heuteIso: heute, fristIso: frist, raeumungsendeIso: raeumung });
      expect('fehler' in server, `${aufgabe}/${frist}/${raeumung}`).toBe(oberflaeche !== null);
    }
    expect(fn.pruefePostAufgabe('2026-10-28', '2026-10-28', '2026-10-28', '2026-11-07', null)).toEqual({ versendetAm: '2026-10-28', zugangAm: '2026-10-31' });
    // Tag des Schreibens aus erstellt_am der Vormerkung, in deutscher Zeit
    expect(fn.berlinerIsoTag(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-28');
    expect(fn.berlinerIsoTag(new Date('2026-07-31T21:59:00Z'))).toBe('2026-07-31');
    expect(fn.pruefePostAufgabe('28.10.2026', '2026-10-28', '2026-10-28', '2026-11-07', null)).toHaveProperty('fehler');
    expect(fn.pruefePostAufgabe(undefined, '2026-10-28', '2026-10-28', '2026-11-07', null)).toHaveProperty('fehler');
  });

  it('prüft Sendungsnummer und Beträge der Vormerkung', () => {
    expect(fn.pruefeSendungsnummer(undefined)).toBeNull();
    expect(fn.pruefeSendungsnummer('  ')).toBeNull();
    expect(fn.pruefeSendungsnummer(' RR123456789DE ')).toBe('RR123456789DE');
    expect(fn.pruefeSendungsnummer('x;drop')).toHaveProperty('fehler');
    expect(fn.pruefeSendungsnummer(42)).toHaveProperty('fehler');
    const gut = { gesamtRueckstand: 1200, mahnkostenGesamt: 22, verzugszinsenGesamt: 0, zahlungsfristTage: 10 };
    expect(fn.pruefeBetraege(gut)).toEqual(gut);
    expect(fn.pruefeBetraege({ ...gut, gesamtRueckstand: -1 })).toHaveProperty('fehler');
    expect(fn.pruefeBetraege({ ...gut, mahnkostenGesamt: Number.NaN })).toHaveProperty('fehler');
    expect(fn.pruefeBetraege({ ...gut, zahlungsfristTage: 61 })).toHaveProperty('fehler');
    expect(fn.pruefeBetraege({ ...gut, zahlungsfristTage: 7.5 })).toHaveProperty('fehler');
    expect(fn.pruefeBetraege(null)).toHaveProperty('fehler');
  });

  it('nimmt nur einzelne, am Vertrag hinterlegte Adressen an — nie den rohen hauptmail-Text', () => {
    const erlaubt = new Set(['a@x.de', 'b@y.de']);
    expect(fn.pruefeEmpfaenger([' A@x.de ', 'b@y.de', 'a@x.de'], undefined, erlaubt)).toEqual(['a@x.de', 'b@y.de']);
    // Ältere App-Fassung: genau eine Adresse
    expect(fn.pruefeEmpfaenger(undefined, 'a@x.de', erlaubt)).toEqual(['a@x.de']);
    expect(fn.pruefeEmpfaenger(undefined, 'a@x.de, b@y.de', erlaubt)).toMatchObject({ status: 400 });
    expect(fn.pruefeEmpfaenger(['Max <a@x.de>'], undefined, erlaubt)).toMatchObject({ status: 400 });
    expect(fn.pruefeEmpfaenger(['c@z.de'], undefined, erlaubt)).toMatchObject({ status: 403 });
    expect(fn.pruefeEmpfaenger([], undefined, erlaubt)).toMatchObject({ status: 400 });
    const viele = ['1@x.de', '2@x.de', '3@x.de', '4@x.de', '5@x.de', '6@x.de'];
    expect(fn.pruefeEmpfaenger(viele, undefined, new Set(viele))).toMatchObject({ status: 400 });
  });

  it('lässt nur die zerlegten Mieteradressen zu und schickt nur an die geprüften', () => {
    expect(handler).not.toContain('erlaubteAdressen.add(m.hauptmail.trim().toLowerCase())');
    expect(handler).toContain("if (MAILADRESSE.test(adresse) && !adresse.endsWith('.')) erlaubteAdressen.add(adresse);");
    expect(handler).toContain('pruefeEmpfaenger(data.recipientEmails, data.recipientEmail, erlaubteAdressen)');
    expect(handler).toContain("to: empfaenger.join(', '),");
    expect(handler).not.toMatch(/to: data\.recipientEmail/);
    expect(handler).not.toMatch(/empfaenger: \[data\.recipientEmail\]/);
  });

  it('nimmt Stufe, Frist und Kündigung aus der Vormerkung und verlangt sie für Post', () => {
    expect(handler).toContain('const ausVormerkung = vormerkung !== null && versandart !== \'vormerken\';');
    expect(handler).toContain('const stufe = ausVormerkung && vormerkung ? Number(vormerkung.stufe) : Number(data.mahnstufe);');
    expect(handler).toContain('const kuendigungRoh = ausVormerkung && vormerkung ? vormerkung.kuendigung : data.kuendigung;');
    expect(handler).toContain('const fristRoh = ausVormerkung && vormerkung ? vormerkung.zahlungsfrist : data.fristDatum;');
    const postOhne = handler.indexOf("if (versandart === 'post' && !vormerkung)");
    expect(postOhne).toBeGreaterThan(0);
    expect(postOhne).toBeLessThan(handler.indexOf('await bucheStufe(', handler.indexOf("if (versandart === 'post' && vormerkung) {")));
    // Dateiname nennt die Stufe
    expect(handler).toContain('.startsWith(`Mahnung_Stufe${stufe}_`)');
  });

  it('prüft beim Vormerken wie beim Versand und kehrt vor jedem Mailversand zurück', () => {
    const vormerken = handler.indexOf("if (versandart === 'vormerken') {\n      const betraege");
    expect(vormerken).toBeGreaterThan(handler.indexOf('if (stufe !== bisherigeStufe + 1)'));
    expect(vormerken).toBeGreaterThan(handler.indexOf('pruefeKuendigungsfelder(kuendigungRoh'));
    expect(vormerken).toBeGreaterThan(handler.indexOf('pruefeFristDatum(fristRoh'));
    // Dokumentzeile für Vormerken und Post
    expect(vormerken).toBeGreaterThan(handler.indexOf(".from('dokumente')"));
    expect(handler.indexOf('return antwort({ success: true, vormerkungId')).toBeLessThan(handler.indexOf('transporter.sendMail('));
  });

  it('braucht für die Postbuchung kein Postfach und versendet keine Mail', () => {
    const post = handler.slice(handler.indexOf('// ── Post: beanspruchen'), handler.indexOf('// ── E-Mail: SMTP'));
    expect(post.length).toBeGreaterThan(500);
    expect(post).not.toContain('sendMail');
    expect(post).not.toContain('MAHNUNG_SMTP');
    // Der Postzweig kehrt immer zurück, bevor der Mailweg beginnt
    expect(post).toMatch(/return antwort\(\{\s*success: true,\s*message: `Mahnung Stufe \$\{stufe\} als per Post versandt gebucht`/);
    expect(handler.indexOf('Deno.env.get("MAHNUNG_SMTP_HOST")')).toBeGreaterThan(handler.indexOf('// ── E-Mail: SMTP'));
  });

  it('lehnt die Postbuchung ab, wenn das bedingte Update keine Zeile trifft, und setzt die Zeitpunkte', () => {
    expect(handler).toMatch(/await anspruchFreigeben\(supabase, vormerkung\.id\);\s*return antwort\(\{ error: 'Die Mahnstufe wurde nicht erhöht[\s\S]{0,200}, 409\)/);
    expect(quelle).toContain("naechste_mahnung_am: `${tagPlus(zugangAm, 30)}T12:00:00.000Z`");
    expect(quelle).toContain("letzte_mahnung_am: `${versendetAm}T12:00:00.000Z`");
  });
});

/**
 * Review 28.10.2026: Stufe-3-Vormerkung an einem späteren Tag, Doppelversand, unvollständige
 * Postbuchung, Alter der Vormerkung, Dokumentzeile im Mailweg. Verhalten ausgeführt, nicht nur indexOf.
 */
describe('send-mahnung nach dem Review: Vormerkung, Beanspruchen, Abschließen', () => {
  function ausschnitt(kopf: string): string {
    const start = quelle.indexOf(kopf);
    expect(start, `${kopf} nicht gefunden`).toBeGreaterThanOrEqual(0);
    return quelle.slice(start, quelle.indexOf('\n}\n', start) + 3);
  }
  const js = ts.transpileModule(
    [
      ausschnitt('function istKalendertag('), ausschnitt('function pruefeKuendigungsfelder('),
      ausschnitt('function pruefeVorgemerkteKuendigung('), ausschnitt('function versandSicherGescheitert('),
      ausschnitt('function gleicheVormerkung('),
    ].join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  type Felder = { status: string; kuendigungsdatum: string; ende_datum: string };
  const fn = new Function(`${js}\nreturn { pruefeKuendigungsfelder, pruefeVorgemerkteKuendigung, versandSicherGescheitert, gleicheVormerkung };`)() as {
    pruefeKuendigungsfelder: (f: unknown, heute: string) => Felder | { fehler: string };
    pruefeVorgemerkteKuendigung: (f: unknown, heute: string, fruehestens: string) => Felder | { fehler: string };
    versandSicherGescheitert: (fehler: unknown) => boolean;
    gleicheVormerkung: (z: unknown, stufe: number, frist: string | null, k: Felder | null, b: Record<string, number>) => boolean;
  };

  it('eine Stufe-3-Vormerkung bleibt an späteren Tagen bis zum Räumungsende versendbar — in Function und App gleich', () => {
    // Gespeichert am 28.10.2026 mit 14 Tagen Räumungsfrist: beide Felder auf den 11.11.2026
    const felder = fristloseKuendigungFelder(14, new Date(2026, 9, 28));
    expect(fn.pruefeKuendigungsfelder(felder, '2026-10-28')).not.toHaveProperty('fehler');
    // Versand drei Tage später per Mail und per Post (Zugang 03.11.)
    expect(fn.pruefeVorgemerkteKuendigung(felder, '2026-10-31', '2026-10-31')).toEqual(felder);
    expect(fn.pruefeVorgemerkteKuendigung(felder, '2026-10-31', '2026-11-03')).toEqual(felder);
    expect(app.vorgemerkteKuendigungFehler(felder, '2026-10-31')).toBeNull();
    // Am Räumungsende selbst noch, danach nicht mehr; per Post nicht, wenn der Zugang danach läge
    expect(fn.pruefeVorgemerkteKuendigung(felder, '2026-11-11', '2026-11-11')).not.toHaveProperty('fehler');
    expect(fn.pruefeVorgemerkteKuendigung(felder, '2026-11-12', '2026-11-12')).toHaveProperty('fehler');
    expect(fn.pruefeVorgemerkteKuendigung(felder, '2026-11-10', '2026-11-13')).toHaveProperty('fehler');
    const v = { id: 'v', stufe: 3, dokument_pfad: 'p.pdf', zahlungsfrist: '2026-11-20', kuendigung: felder, betraege: null, erstellt_am: '2026-10-28T10:00:00Z' };
    expect(app.angeboteneVormerkung([v], 3, '2026-10-31', new Set(['p.pdf']))).not.toBeNull();
    expect(app.angeboteneVormerkung([v], 3, '2026-11-12', new Set(['p.pdf']))).toBeNull();

    // Function und App entscheiden über alle Fälle gleich
    const faelle: Array<[Felder, string, string]> = [];
    for (const kd of ['2026-10-28', '2026-10-31', '2026-11-11', '2026-11-12']) {
      for (const heute of ['2026-10-28', '2026-10-31', '2026-11-11', '2026-11-12']) {
        for (const versatz of [0, 3]) {
          faelle.push([{ status: 'gekuendigt', kuendigungsdatum: kd, ende_datum: '2026-11-11' }, heute, app.tagPlus(heute, versatz)]);
        }
      }
    }
    for (const [f, heute, frueh] of faelle) {
      const server = fn.pruefeVorgemerkteKuendigung(f, heute, frueh);
      expect('fehler' in server, `${f.kuendigungsdatum}/${heute}/${frueh}`).toBe(app.vorgemerkteKuendigungFehler(f as Parameters<typeof app.vorgemerkteKuendigungFehler>[0], heute, frueh) !== null);
    }
    // kuendigungsdatum vor heute beendete den Vertrag im Nachtlauf — abgelehnt; nach dem Ende ebenso
    expect(fn.pruefeVorgemerkteKuendigung({ ...felder, kuendigungsdatum: '2026-10-28' }, '2026-10-31', '2026-10-31')).toHaveProperty('fehler');
    expect(fn.pruefeVorgemerkteKuendigung({ ...felder, kuendigungsdatum: '2026-11-12' }, '2026-10-31', '2026-10-31')).toHaveProperty('fehler');
  });

  it('gibt eine Vormerkung nur frei, wenn der Mailserver sicher nicht angenommen hat', () => {
    expect(fn.versandSicherGescheitert({ code: 'EENVELOPE', responseCode: 550 })).toBe(true);
    expect(fn.versandSicherGescheitert({ code: 'EMESSAGE', responseCode: 552 })).toBe(true);
    expect(fn.versandSicherGescheitert({ code: 'EAUTH' })).toBe(true);
    expect(fn.versandSicherGescheitert({ code: 'ESOCKET', syscall: 'connect' })).toBe(true);
    expect(fn.versandSicherGescheitert({ code: 'EDNS' })).toBe(true);
    // Unklar: Die Mail kann angekommen sein
    expect(fn.versandSicherGescheitert({ code: 'ETIMEDOUT' })).toBe(false);
    expect(fn.versandSicherGescheitert({ code: 'ECONNECTION' })).toBe(false);
    expect(fn.versandSicherGescheitert(new Error('irgendwas'))).toBe(false);
    expect(fn.versandSicherGescheitert(null)).toBe(false);
  });

  it('erkennt ein wiederholtes Vormerken mit denselben Werten', () => {
    const b = { gesamtRueckstand: 1200, mahnkostenGesamt: 22, verzugszinsenGesamt: 3.5, zahlungsfristTage: 7 };
    const k = { status: 'gekuendigt', kuendigungsdatum: '2026-11-11', ende_datum: '2026-11-11' };
    const zeile = { status: 'vorgemerkt', stufe: 3, zahlungsfrist: '2026-11-04', kuendigung: k, betraege: b };
    expect(fn.gleicheVormerkung(zeile, 3, '2026-11-04', k, b)).toBe(true);
    expect(fn.gleicheVormerkung(zeile, 3, '2026-11-05', k, b)).toBe(false);
    expect(fn.gleicheVormerkung(zeile, 3, '2026-11-04', { ...k, ende_datum: '2026-11-12' }, b)).toBe(false);
    expect(fn.gleicheVormerkung(zeile, 3, '2026-11-04', k, { ...b, gesamtRueckstand: 1201 })).toBe(false);
    expect(fn.gleicheVormerkung({ ...zeile, status: 'versendet' }, 3, '2026-11-04', k, b)).toBe(false);
    expect(fn.gleicheVormerkung({ ...zeile, stufe: 2, kuendigung: null }, 2, '2026-11-04', null, b)).toBe(true);
  });

  it('Mailweg: beansprucht die Vormerkung vor dem Versand und gibt sie nur bei sicherem Fehlschlag frei', () => {
    const mail = handler.slice(handler.indexOf('// ── E-Mail: SMTP'));
    const anspruch = mail.indexOf("vormerkungBeanspruchen(supabase, vormerkung.id, { versandart: 'email'");
    expect(anspruch).toBeGreaterThan(0);
    expect(anspruch).toBeLessThan(mail.indexOf('mailVormerken('));
    expect(anspruch).toBeLessThan(mail.indexOf('transporter.sendMail('));
    expect(mail).toMatch(/if \(beansprucht !== 'ok'\) \{\s*const abgelehnt = anspruchAbgelehnt\(beansprucht\);\s*return antwort\(\{ error: abgelehnt\.fehler \}, abgelehnt\.status\);/);
    const fang = mail.slice(mail.indexOf('} catch (versandFehler) {'), mail.indexOf('// Ab hier ist die Mail angenommen'));
    expect(fang).toContain('const sicherGescheitert = versandSicherGescheitert(versandFehler);');
    expect(fang).toMatch(/if \(vormerkung\) \{\s*if \(sicherGescheitert\) \{\s*\/\/[^\n]*\n\s*await anspruchFreigeben\(supabase, vormerkung\.id\);/);
    expect(fang).toMatch(/\} else \{[\s\S]{0,400}return antwort\(\{ error: 'Der Mailversand brach ohne eindeutige Antwort[\s\S]{0,300}, 502\)/);
    // Abschluss nach der Stufe, Trefferzahl geprüft (protokollAbschliessen)
    expect(mail.indexOf('protokollAbschliessen(supabase, vormerkung.id')).toBeGreaterThan(mail.indexOf('await bucheStufe('));
    const abschluss = ausschnitt('async function protokollAbschliessen(');
    expect(abschluss).toContain("if (!error && (data ?? []).length === 1) return true;");
    expect(abschluss).toContain(".eq('status', 'wird_versendet')");
    expect(ausschnitt('async function vormerkungBeanspruchen(')).toContain(".eq('status', 'vorgemerkt')");
  });

  it('Post: beansprucht mit Aufgabetag, bucht dann die Stufe und schließt ab; Wiederholung ist idempotent', () => {
    const post = handler.slice(handler.indexOf('// ── Post: beanspruchen'), handler.indexOf('// ── E-Mail: SMTP'));
    const anspruch = post.indexOf("vormerkungBeanspruchen(supabase, vormerkung.id, {\n          versandart: 'post',\n          versendet_am: versendetAm,");
    expect(anspruch).toBeGreaterThan(0);
    expect(anspruch).toBeLessThan(post.indexOf('await bucheStufe('));
    expect(post.indexOf('await bucheStufe(')).toBeLessThan(post.indexOf('protokollAbschliessen(supabase, vormerkung.id'));
    // Schon versendet mit derselben Versandart: Erfolg statt 409
    expect(handler).toMatch(/if \(vormerkung\?\.status === 'versendet'\) \{\s*if \(vormerkung\.versandart === versandart\) \{\s*return antwort\(\{\s*success: true,\s*bereitsVersendet: true,/);
    // Abgebrochene Postbuchung mit schon gebuchter Stufe: nur abschließen
    expect(handler).toMatch(/if \(fortsetzung && vormerkung && bisherigeStufe === stufe\) \{\s*const fertig = await protokollAbschliessen/);
    // Ein Mailversand in 'wird_versendet' wird nicht fortgesetzt
    expect(handler).toContain("if (vormerkung?.status === 'wird_versendet' && !fortsetzung)");
  });

  it('merkt nur frische Schreiben vor und prüft die Dokumentzeile auch im Mailweg mit Vormerkung', () => {
    expect(quelle).toContain('const MAX_ALTER_VORMERKUNG_MS = 30 * 60 * 1000;');
    const vormerken = handler.slice(handler.indexOf("if (versandart === 'vormerken') {\n      const betraege"), handler.indexOf('// ── Post: beanspruchen'));
    expect(vormerken).toContain(".storage.from('dokumente').list(ordner, { search: dateiname, limit: 10 })");
    expect(vormerken).toMatch(/if \(zuAlt\(datei\.created_at\) \|\| zuAlt\(hochgeladenAm\)\) \{\s*return antwort\([\s\S]{0,200}, 409\)/);
    // Idempotent vor der Altersprüfung
    expect(vormerken.indexOf('gleicheVormerkung(vormerkung')).toBeLessThan(vormerken.indexOf('zuAlt(datei.created_at)'));
    expect(handler).toContain("if (versandart !== 'email' || vormerkung) {");
  });

  it('klärt einen abgebrochenen Versand erst nach 15 Minuten und holt eine gesendete Mail nach', () => {
    const klaeren = handler.slice(handler.indexOf("if (versandart === 'freigeben') {"), handler.indexOf("if (vormerkung?.status === 'versendet') {"));
    expect(klaeren).toMatch(/Date\.now\(\) - Date\.parse\(vormerkung\.aktualisiert_am\) < HAENGT_NACH_MS[\s\S]{0,200}, 409\)/);
    const email = klaeren.slice(klaeren.indexOf('// E-Mail: Ob die Mail raus ist'));
    expect(email).toContain("if (mail?.status === 'gesendet') {");
    expect(email.indexOf("mail?.status === 'gesendet'")).toBeLessThan(email.indexOf('await anspruchFreigeben(supabase, vormerkung.id)'));
    // 15 Minuten, App und Function gleich (Review 28.10.2026)
    expect(quelle).toContain('const HAENGT_NACH_MS = 15 * 60 * 1000;');
    expect(app.HAENGT_NACH_MS).toBe(15 * 60 * 1000);
  });
});

/**
 * Review 28.10.2026, Runde 2: Lücken rund um 'wird_versendet' und 'freigeben'.
 */
describe('send-mahnung Runde 2: Abbrüche, Klären, ein Versand je Vertrag, mails nur lesen', () => {
  const mail = handler.slice(handler.indexOf('// ── E-Mail: SMTP'));

  it('A: gibt bei einem Fehler zwischen Beanspruchen und Versand frei und verlangt Mailprotokoll und Verknüpfung', () => {
    const vor = mail.slice(mail.indexOf('let mailId: string | null = null;'), mail.indexOf('await transporter.sendMail('));
    expect(vor).toMatch(/try \{\s*mailId = await mailVormerken\(/);
    expect(vor).toContain("if (!mailId) throw new Error('Mailprotokoll nicht angelegt');");
    expect(vor).toMatch(/\.update\(\{ mail_id: mailId \}\)\s*\.eq\('id', vormerkung\.id\)\s*\.eq\('status', 'wird_versendet'\)\s*\.select\('id'\);/);
    expect(vor).toContain('if (verknuepfFehler || (verknuepft ?? []).length !== 1) {');
    expect(vor).toMatch(/\} catch \(vorVersand\) \{[\s\S]{0,300}if \(vormerkung\) await anspruchFreigeben\(supabase, vormerkung\.id\);\s*return antwort\([\s\S]{0,200}, 500\);/);
  });

  it('A: läuft nach angenommenem Versand immer bis zum Protokoll durch, Fehler nur als Warnung', () => {
    const nach = mail.slice(mail.indexOf('// Ab hier ist die Mail angenommen'), mail.indexOf("console.log('Mahnung versendet:'"));
    expect(nach.length).toBeGreaterThan(500);
    // Kein vorzeitiges Ende zwischen Versand und Protokoll
    expect(nach).not.toMatch(/\breturn\b/);
    expect(nach).not.toMatch(/\bthrow\b/);
    expect(nach).toMatch(/try \{\s*if \(mailId && !\(await mailAbschliessen\(supabase, mailId, 'gesendet'\)\)\)/);
    expect(nach).toMatch(/try \{\s*const buchung = await bucheStufe\(/);
    expect(nach).toMatch(/try \{\s*if \(vormerkung\) \{\s*const fertig = await protokollAbschliessen\(/);
    const abschliessen = quelle.slice(quelle.indexOf('async function mailAbschliessen('), quelle.indexOf('function htmlZuText('));
    expect(abschliessen).toContain('): Promise<boolean> {');
    expect(abschliessen).toContain("if (!error && (data ?? []).length === 1) return true;");
  });

  it('B/D: gibt eine Mail ohne Beleg nur nach ausdrücklicher Bestätigung frei, nie bei Lesefehler', () => {
    const klaeren = handler.slice(handler.indexOf("if (versandart === 'freigeben') {"), handler.indexOf("if (vormerkung?.status === 'versendet') {"));
    const email = klaeren.slice(klaeren.indexOf('// E-Mail: Ob die Mail raus ist'));
    expect(email).toMatch(/if \(mailFehler\) \{[\s\S]{0,250}return antwort\(\{ error: 'Der Versandstatus der Mail konnte nicht gelesen werden[\s\S]{0,120}, 502\);/);
    const bestaetigung = email.indexOf('if (!nichtVersendet) {');
    expect(bestaetigung).toBeGreaterThan(0);
    expect(bestaetigung).toBeLessThan(email.indexOf('await anspruchFreigeben(supabase, vormerkung.id)'));
    expect(email.slice(bestaetigung, bestaetigung + 400)).toContain(', 409);');
    // D: Bei E-Mail schließt eine schon gebuchte Stufe allein nicht ab — nur mit mails 'gesendet' oder
    // von Hand bestätigt; beides über versandNachbuchen, sonst nirgends ein Abschluss
    expect(email).not.toContain('protokollAbschliessen(');
    expect(klaeren.match(/versandNachbuchen\(/g)).toHaveLength(2);
    const belegt = email.indexOf("if (mail?.status === 'gesendet') {\n        return await versandNachbuchen(");
    const vonHand = email.indexOf('if (versendet) {\n        return await versandNachbuchen(new Date(vormerkung.aktualisiert_am), true);');
    expect(belegt).toBeGreaterThan(0);
    expect(vonHand).toBeGreaterThan(belegt);
    expect(bestaetigung).toBeGreaterThan(vonHand);
    // Post verschickt nichts: Abschluss bei gebuchter Stufe, sonst Freigabe ohne Bestätigung
    const post = klaeren.slice(klaeren.indexOf("if (vormerkung.versandart === 'post') {"), klaeren.indexOf('// E-Mail: Ob die Mail raus ist'));
    expect(post).toMatch(/if \(stufeSteht\) \{\s*const fertig = await protokollAbschliessen/);
    expect(post).not.toContain('bestaetigtNichtVersendet');
  });

  it('C: lehnt Vormerken und Beanspruchen eines anderen Schreibens ab, solange ein Versand unklar ist', () => {
    const pruefung = handler.indexOf(".eq('status', 'wird_versendet')\n      .limit(2);");
    expect(pruefung).toBeGreaterThan(0);
    expect(handler).toMatch(/if \(\(beanspruchte \?\? \[\]\)\.some\(\(z: \{ id: string \}\) => z\.id !== vormerkung\?\.id\)\) \{\s*return antwort\(\{ error: UNKLAR_MELDUNG \}, 409\);/);
    expect(pruefung).toBeLessThan(handler.indexOf("if (versandart === 'vormerken') {\n      const betraege"));
    expect(pruefung).toBeLessThan(handler.indexOf('vormerkungBeanspruchen(supabase'));
    // Atomar fürs Beanspruchen: eindeutiger Teilindex je Vertrag → 23505 → anderer_versand
    expect(quelle).toContain("if (error.code === '23505') return 'anderer_versand';");
    expect(quelle).toContain("if (ergebnis === 'anderer_versand') return { fehler: UNKLAR_MELDUNG, status: 409 };");
  });

  it('G: gibt nach gescheiterter Stufenbuchung nicht frei, wenn der Stand nicht lesbar ist', () => {
    const post = handler.slice(handler.indexOf('// ── Post: beanspruchen'), handler.indexOf('// ── E-Mail: SMTP'));
    expect(post).toMatch(/if \(standFehler \|\| !jetzt\) \{[\s\S]{0,400}return antwort\(\{ error: 'Der Stand des Vertrags ist unklar[\s\S]{0,200}, 502\);/);
    const block = post.slice(post.indexOf('if (standFehler || !jetzt) {'), post.indexOf("if (Number((jetzt as"));
    expect(block).not.toContain('anspruchFreigeben');
  });

  it('E/C: Migration — mails nur lesbar für Clients, ein beanspruchter Versand je Vertrag', () => {
    const migration = readFileSync('supabase/migrations/20261028143000_mahnung_versand.sql', 'utf-8');
    expect(migration).toContain('drop policy if exists "Only admin can access mails" on public.mails;');
    expect(migration).toMatch(/create policy "Only admin can read mails"\s*on public\.mails\s*for select\s*to authenticated/);
    expect(migration).toContain('revoke insert, update, delete, truncate, references, trigger on table public.mails from authenticated;');
    expect(migration).toContain('revoke all on table public.mails from anon;');
    expect(migration).toMatch(/create unique index mahnung_versand_ein_versand_je_vertrag\s*on public\.mahnung_versand \(mietvertrag_id\)\s*where status = 'wird_versendet';/);
  });
});

/** Ergänzung 28.10.2026: unklaren Mailversand von Hand als versendet bestätigen (Gegenrichtung). */
describe('send-mahnung freigeben: von Hand als versendet bestätigt', () => {
  const klaeren = handler.slice(handler.indexOf("if (versandart === 'freigeben') {"), handler.indexOf("if (vormerkung?.status === 'versendet') {"));
  const nachbuchen = klaeren.slice(klaeren.indexOf('const versandNachbuchen = async'), klaeren.indexOf('// E-Mail: Ob die Mail raus ist'));

  it('lehnt beide Bestätigungen zugleich ab, vor allem anderen', () => {
    const konflikt = klaeren.indexOf('if (nichtVersendet && versendet) {');
    expect(konflikt).toBeGreaterThan(0);
    expect(klaeren.slice(konflikt, konflikt + 200)).toContain(', 400);');
    expect(konflikt).toBeLessThan(klaeren.indexOf('if (!vormerkung) return antwort('));
    expect(klaeren).toContain('const versendet = data.bestaetigtVersendet === true;');
  });

  it('bucht die Stufe mit denselben Prüfungen und schließt mit Vermerk ab', () => {
    expect(nachbuchen).toContain('if (!stufeSteht && bisherigeStufe === Number(vormerkung.stufe) - 1) {');
    expect(nachbuchen).toContain('pruefeVorgemerkteKuendigung(vormerkung.kuendigung, heuteIso, heuteIso)');
    expect(nachbuchen).toMatch(/await bucheStufe\(supabase, \{\s*mietvertragId: data\.mietvertragId,\s*stufeVorher,/);
    expect(nachbuchen).toContain('...(vonHand ? { von_hand_bestaetigt: true } : {}),');
    // mail_id bleibt: Der Abschluss setzt sie nicht
    expect(nachbuchen.slice(nachbuchen.indexOf('protokollAbschliessen('))).not.toContain('mail_id');
    expect(nachbuchen).toContain('von Hand als versendet bestätigt (Mietvertrag ${data.mietvertragId}, Nutzer ${nutzerId}).');
    // Versandtag ist der Tag des Anspruchs
    expect(klaeren).toContain('return await versandNachbuchen(new Date(vormerkung.aktualisiert_am), true);');
    expect(nachbuchen).toContain('const versandtag = berlinerIsoTag(zeitpunkt);');
  });

  it('gilt nur für Mails; eine Postbuchung lehnt die Bestätigungen ab', () => {
    const post = klaeren.slice(klaeren.indexOf("if (vormerkung.versandart === 'post') {"), klaeren.indexOf('const versandNachbuchen = async'));
    expect(post).toMatch(/if \(nichtVersendet \|\| versendet\) \{\s*return antwort\([\s\S]{0,200}, 400\);/);
  });

  it('Migration: von_hand_bestaetigt nur bei einer versendeten Mail', () => {
    const migration = readFileSync('supabase/migrations/20261028143000_mahnung_versand.sql', 'utf-8');
    expect(migration).toContain('von_hand_bestaetigt boolean not null default false,');
    expect(migration).toMatch(/check \(not von_hand_bestaetigt or \(status = 'versendet' and versandart = 'email'\)\)/);
  });
});

/** Review 28.10.2026, Runde 3 */
describe('send-mahnung Runde 3: unklarer Mailstatus, Stufe 3 beim Nachbuchen', () => {
  it('setzt die Mail nur bei sicherem Scheitern auf fehler, bei unklarem Ausgang bleibt sie entwurf', () => {
    const fang = handler.slice(handler.indexOf('} catch (versandFehler) {'), handler.indexOf('// Ab hier ist die Mail angenommen'));
    expect(fang).toMatch(/if \(sicherGescheitert\) \{\s*await mailAbschliessen\(supabase, mailId, 'fehler', fehlertext\);\s*\} else \{\s*await mailUnklarVermerken\(supabase, mailId, fehlertext\);/);
    expect(fang.match(/mailAbschliessen\(/g)).toHaveLength(1);
    const vermerk = quelle.slice(quelle.indexOf('async function mailUnklarVermerken('), quelle.indexOf('function htmlZuText('));
    expect(vermerk).not.toMatch(/status:/);
    expect(vermerk).toContain(".eq('status', 'entwurf')");
  });

  it('bucht Stufe 3 beim Nachbuchen nicht, wenn die Kündigungsfelder nicht mehr gelten', () => {
    const klaeren = handler.slice(handler.indexOf("if (versandart === 'freigeben') {"), handler.indexOf("if (vormerkung?.status === 'versendet') {"));
    const nachbuchen = klaeren.slice(klaeren.indexOf('const versandNachbuchen = async'), klaeren.indexOf('// E-Mail: Ob die Mail raus ist'));
    const pruefung = nachbuchen.indexOf("if (k && 'fehler' in k) {");
    expect(pruefung).toBeGreaterThan(0);
    expect(pruefung).toBeLessThan(nachbuchen.indexOf('await bucheStufe('));
    expect(pruefung).toBeLessThan(nachbuchen.indexOf('protokollAbschliessen('));
    expect(nachbuchen.slice(pruefung, pruefung + 600)).toMatch(/return antwort\(\{\s*error: `Kündigung nicht mehr gültig[\s\S]{0,250}\}, 409\);/);
    // Ohne Ersatz-Buchung ohne Kündigung
    expect(nachbuchen).toContain('kuendigung: k,');
    expect(nachbuchen).not.toContain("k && !('fehler' in k) ? k : null");
  });
});
