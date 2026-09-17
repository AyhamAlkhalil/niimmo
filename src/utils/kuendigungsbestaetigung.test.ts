import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  anredeAusDatenbank,
  anschriftZeile,
  briefanrede,
  bestaetigungsAbsaetze,
  mailadressenDerMieter,
  mietobjekt,
  type BestaetigungsDaten,
} from './kuendigungsbestaetigung';
import { generateKuendigungPdf, generateKuendigungsbestaetigungPdf } from './kuendigungPdfGenerator';

const BASIS: BestaetigungsDaten = {
  mieter: [{ vorname: 'Anna', nachname: 'Beispiel', anrede: 'Frau' }],
  strasse: 'Musterstraße 1',
  plzOrt: '31319 Sehnde',
  einheitBezeichnung: 'WE 03',
  immobilieAdresse: 'Musterstraße 1, 31319 Sehnde',
  vertragsart: 'wohnraum',
  einheitentyp: 'Wohnung',
  vertragStart: '2020-02-01',
  vertragsende: '2026-12-31',
  schreibenVom: '2026-09-10',
  eingangAm: '2026-09-12',
  datum: '2026-09-16',
  hatKaution: true,
  neueAnschriftBekannt: false,
};

describe('Anrede', () => {
  it('beugt je Person und setzt „Herrn" in die Anschrift', () => {
    expect(anschriftZeile({ vorname: 'Max', nachname: 'Beispiel', anrede: 'Herr' })).toBe('Herrn Max Beispiel');
    expect(anschriftZeile({ vorname: 'Anna', nachname: 'Beispiel', anrede: 'Frau' })).toBe('Frau Anna Beispiel');
    expect(anschriftZeile({ vorname: 'Kim', nachname: 'Beispiel', anrede: 'ohne' })).toBe('Kim Beispiel');
  });

  it('grüßt mehrere Mieter einzeln statt „Sehr geehrte/r"', () => {
    expect(briefanrede([
      { vorname: 'Anna', nachname: 'Beispiel', anrede: 'Frau' },
      { vorname: 'Max', nachname: 'Probe', anrede: 'Herr' },
    ])).toBe('Sehr geehrte Frau Beispiel, sehr geehrter Herr Probe,');
  });

  it('grüßt neutral, sobald eine Anrede fehlt — statt zu raten', () => {
    expect(briefanrede([
      { vorname: 'Anna', nachname: 'Beispiel', anrede: 'Frau' },
      { vorname: 'Kim', nachname: 'Probe', anrede: 'ohne' },
      { vorname: 'Max', nachname: 'Test', anrede: 'Herr' },
    ])).toBe('Guten Tag Anna Beispiel, Kim Probe und Max Test,');
  });

  it('fällt ohne Mieter auf die allgemeine Anrede zurück', () => {
    expect(briefanrede([])).toBe('Sehr geehrte Damen und Herren,');
    expect(briefanrede([{ vorname: ' ', nachname: '', anrede: 'Herr' }])).toBe('Sehr geehrte Damen und Herren,');
  });

  it('übernimmt nur eindeutige Werte aus mieter.anrede', () => {
    expect(anredeAusDatenbank('Frau')).toBe('Frau');
    expect(anredeAusDatenbank(' herr ')).toBe('Herr');
    expect(anredeAusDatenbank('Herr Dr.')).toBe('ohne');
    expect(anredeAusDatenbank(null)).toBe('ohne');
  });
});

describe('Brieftext', () => {
  it('nennt Schreiben, Zugang und Vertragsende mit deutschem Datum', () => {
    const text = bestaetigungsAbsaetze(BASIS).join(' ');
    expect(text).toContain('Eingang Ihrer Kündigung vom 10.09.2026, die uns am 12.09.2026 zugegangen ist.');
    expect(text).toContain('über die Wohnung WE 03, Musterstraße 1, 31319 Sehnde, begründet durch den Mietvertrag vom 01.02.2020, endet damit zum 31.12.2026.');
  });

  it('lässt fehlende Eingangsangaben weg, statt Platzhalter zu drucken', () => {
    const text = bestaetigungsAbsaetze({ ...BASIS, schreibenVom: null, eingangAm: null, vertragStart: null }).join(' ');
    expect(text).toContain('wir bestätigen den Eingang Ihrer Kündigung.');
    expect(text).not.toContain('N/A');
    expect(text).not.toContain('TT.MM');
    expect(text).toContain('Sehnde endet damit zum 31.12.2026.');
  });

  it('widerspricht der stillschweigenden Verlängerung', () => {
    expect(bestaetigungsAbsaetze(BASIS).join(' ')).toContain('§ 545 BGB');
  });

  it('richtet sich nach dem Einheitentyp statt immer „Wohnung" zu schreiben', () => {
    // vertragsart steht live überall auf dem Vorgabewert 'wohnraum'
    const stellplatz = bestaetigungsAbsaetze({ ...BASIS, einheitentyp: 'Stellplatz' }).join(' ');
    expect(stellplatz).toContain('über den Stellplatz');
    expect(stellplatz).toContain('Rückgabe des Stellplatzes');
    expect(stellplatz).not.toContain('Wohnung');
    expect(stellplatz).not.toContain('Zählerstände');
    expect(stellplatz).not.toContain('Versorgungsverträge');

    expect(mietobjekt('wohnraum', 'Gewerbe').akkusativ).toBe('die Gewerbeeinheit');
    expect(mietobjekt('wohnraum', 'Garage').genitiv).toBe('der Garage');
    expect(mietobjekt('wohnraum', 'Haus (Doppelhaushälfte, Reihenhaus)').akkusativ).toBe('das Haus');
    expect(mietobjekt('wohnraum', 'Sonstiges').akkusativ).toBe('das Mietobjekt');
    expect(mietobjekt('wohnraum', null).akkusativ).toBe('die Wohnung');
    // eine bewusst gesetzte Vertragsart geht vor
    expect(mietobjekt('gewerbe', 'Wohnung').akkusativ).toBe('die Gewerbeeinheit');
  });

  it('erwähnt Kaution und neue Anschrift nur, wenn sie fehlen bzw. bestehen', () => {
    const ohne = bestaetigungsAbsaetze({ ...BASIS, hatKaution: false, neueAnschriftBekannt: true }).join(' ');
    expect(ohne).not.toContain('Mietkaution');
    expect(ohne).not.toContain('neue Anschrift');
    const mit = bestaetigungsAbsaetze(BASIS).join(' ');
    expect(mit).toContain('Mietkaution');
    expect(mit).toContain('neue Anschrift');
  });

  it('ersetzt mit Freitext den Standardtext und behält die Hinweise', () => {
    const absaetze = bestaetigungsAbsaetze({
      ...BASIS,
      freitext: 'Erster Absatz\nmit Umbruch.\n\n\nZweiter Absatz.',
      bemerkungen: 'Schlüssel bitte im Büro abgeben.',
    });
    expect(absaetze).toEqual([
      'Erster Absatz mit Umbruch.',
      'Zweiter Absatz.',
      'Ergänzende Hinweise: Schlüssel bitte im Büro abgeben.',
    ]);
  });
});

describe('Mailadressen der Mieter', () => {
  it('zerlegt weitere_mails wie send-mahnung und entfernt Dubletten', () => {
    expect(mailadressenDerMieter([
      { hauptmail: ' Anna@Example.org ', weitere_mails: 'anna@example.org; zweit@example.org, kein-eintrag' },
      { hauptmail: null, weitere_mails: null },
      { hauptmail: 'max@example.org', weitere_mails: '' },
    ])).toEqual(['anna@example.org', 'zweit@example.org', 'max@example.org']);
  });
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

const WINANSI: Record<number, string> = { 0x96: '–', 0x97: '—', 0x84: '„', 0x93: '“' };

function rohtext(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** Textstücke in Zeichenreihenfolge, Leerraum vereinheitlicht (Blocksatz setzt Wort für Wort). */
function textAusPdf(bytes: Uint8Array): string {
  const stuecke: string[] = [];
  const muster = /\((?:\\.|[^\\()])*\)/g;
  const roh = rohtext(bytes);
  let t: RegExpExecArray | null;
  while ((t = muster.exec(roh)) !== null) {
    stuecke.push(
      t[0].slice(1, -1)
        .replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\([()\\])/g, '$1')
    );
  }
  return stuecke.join(' ')
    .replace(/[\u0080-\u009f]/g, z => WINANSI[z.charCodeAt(0)] ?? z)
    .replace(/\s+/g, ' ');
}

async function bytesVon(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('Kündigungsbestätigung als PDF', () => {
  it('trägt Betreff, Anschrift, Anrede, Vertragsende und Unterschrift', async () => {
    const text = textAusPdf(await bytesVon(await generateKuendigungsbestaetigungPdf({
      ...BASIS,
      mieter: [
        { vorname: 'Anna', nachname: 'Beispiel', anrede: 'Frau' },
        { vorname: 'Max', nachname: 'Probe', anrede: 'Herr' },
      ],
    })));
    expect(text).toContain('Bestätigung Ihrer Kündigung');
    expect(text).toContain('MV – Musterstraße 1, 31319 Sehnde, WE 03');
    expect(text).toContain('Frau Anna Beispiel');
    expect(text).toContain('Herrn Max Probe');
    expect(text).toContain('Sehr geehrte Frau Beispiel, sehr geehrter Herr Probe,');
    expect(text).toContain('Sehnde, 16.09.2026');
    expect(text).toContain('endet damit zum 31.12.2026.');
    expect(text).toContain('Dennis Mikyas');
    expect(text).toContain('HRB 208111');
  });

  it('schreibt nach einem Seitenumbruch in Brieftextschrift weiter, nicht in der Fußzeilenschrift', async () => {
    const lang = Array.from({ length: 45 }, (_, i) => `Absatz ${i} mit etwas Text, der eine Zeile füllt.`).join('\n\n');
    const roh = rohtext(await bytesVon(await generateKuendigungsbestaetigungPdf({ ...BASIS, freitext: lang })));
    const seiten = roh.split(/\bstream\b/).filter(s => s.includes(' Tf'));
    expect(seiten.length).toBeGreaterThan(1);
    for (const folgeseite of seiten.slice(1)) {
      expect(folgeseite.match(/\/F\d+ ([\d.]+) Tf/)?.[1]).toBe('10');
    }
  });

  it('lässt das Kündigungsschreiben durch den gemeinsamen Briefrahmen unverändert', async () => {
    const text = textAusPdf(await bytesVon(await generateKuendigungPdf({
      anrede: 'Herr',
      mieterName: 'Max Probe',
      mieterNachname: 'Probe',
      mieterAdresse: 'Musterstraße 1',
      mieterPlzOrt: '31319 Sehnde',
      einheitBezeichnung: 'WE 03',
      immobilieAdresse: 'Musterstraße 1, 31319 Sehnde',
      vertragStart: '01.02.2020',
      kuendigungsdatum: '31.12.2026',
      kuendigungsgrund: 'Eigenbedarf',
      kuendigungstyp: 'ordentlich',
      datum: '16.09.2026',
      auszugsdatum: '31.12.2026',
    })));
    expect(text).toContain('Kündigung des Mietvertrages');
    expect(text).toContain('Sehr geehrte/r Herr Probe,');
    expect(text).toContain('ordentlich zum 31.12.2026.');
    expect(text).toContain('Grund der Kündigung: Eigenbedarf');
    expect(text).toContain('Mit freundlichem Gruß');
  });
});

/**
 * Die Edge Function verschickt Post an Mieter. Die Regeln aus
 * docs/architektur.md §7 gelten auch für sie — geprüft am Quelltext, weil
 * Deno-Code hier nicht läuft.
 */
describe('send-kuendigungsbestaetigung hält die Versandregeln ein', () => {
  const quelle = readFileSync('supabase/functions/send-kuendigungsbestaetigung/index.ts', 'utf-8');
  const config = readFileSync('supabase/config.toml', 'utf-8');

  it('ist eingetragen und prüft Login und Admin-Rolle selbst', () => {
    expect(config).toContain('[functions.send-kuendigungsbestaetigung]');
    expect(quelle).toContain('auth.getUser()');
    expect(quelle).toMatch(/authError \|\| !userData\?\.user\?\.id/);
    expect(quelle).toContain("rpc('is_admin'");
    // Service-Role erst nach bestandener Prüfung
    expect(quelle.indexOf('SUPABASE_SERVICE_ROLE_KEY')).toBeGreaterThan(quelle.indexOf('auth.getUser()'));
  });

  it('nimmt Anhang und Empfänger nicht ungeprüft aus dem Request', () => {
    expect(quelle).toContain('kuendigungen/${mietvertragId}/');
    expect(quelle).toContain("'..'");
    expect(quelle).toContain('hauptmail');
    expect(quelle).toContain('weitere_mails');
  });

  it('liest das Vertragsende aus der Datenbank und pinnt supabase-js', () => {
    expect(quelle).toMatch(/ende_datum \|\| .*kuendigungsdatum/);
    expect(quelle).toContain('supabase-js@2.49.1');
    expect(quelle).toContain('escapeHtml(');
  });
});

/**
 * Review 17.09.2026: Die Vorschau läuft 400 ms hinter dem Formular her. Ohne
 * Sperre ließ sich in dieser Zeit das alte PDF speichern und versenden, während
 * der Dialog den neuen Stand als gespeichert meldete.
 */
describe('Kündigungsbestätigung speichert nur, was die Vorschau zeigt', () => {
  const dialog = readFileSync('src/components/dashboard/termination/KuendigungsbestaetigungDialog.tsx', 'utf-8');

  it('sperrt Speichern und Senden, solange die Vorschau nicht zum Formular passt', () => {
    expect(dialog).toContain('const vorschauAktuell = pdfBlob !== null && blobSignatur === signatur;');
    expect(dialog.match(/disabled=\{!vorschauAktuell/g)?.length).toBe(2);
  });

  it('merkt sich den Stand des erzeugten PDFs, nicht den des Formulars', () => {
    expect(dialog).toContain('setGespeichert({ pfad, signatur: stand });');
    expect(dialog).toContain('if (stand !== signatur) throw new Error(');
  });
});
