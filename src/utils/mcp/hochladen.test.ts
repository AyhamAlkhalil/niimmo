import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PFAD } from '@/utils/storagePfad';
import { SERVER, WERKZEUGE } from '../../../supabase/functions/mcp/server.ts';
import { Fachfehler, type Kontext } from '../../../supabase/functions/mcp/werkzeug.ts';
import {
  abweichung,
  erkenneDateityp,
  erlaubterTyp,
  MAX_BYTES,
  mitMakros,
  pruefeGroesse,
  titelAus,
  UPLOAD_KATEGORIEN,
  uploadPfad,
  zufallsteil,
} from '../../../supabase/functions/mcp/werkzeuge/hochladen.ts';
import { DOKUMENT_KATEGORIEN } from '../../../supabase/functions/mcp/werkzeuge/verwaltung.ts';

const V1 = '11111111-1111-4111-8111-111111111111';
const O1 = '55555555-5555-4555-8555-555555555555';
const U1 = '66666666-6666-4666-8666-666666666666';
const D1 = '77777777-7777-4777-8777-777777777777';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SIGNIERT = `https://kmtgzrnpitlslivdvlyq.supabase.co/storage/v1/object/upload/sign/dokumente/${V1}/x.pdf?token=abc`;

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n% Test\n');
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const office = (teil: string) => zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  '_rels/.rels': strToU8('<Relationships/>'),
  [teil]: strToU8('<x/>'),
});

// ---------- Attrappe des supabase-js-Clients samt Speicher ----------

interface Aufruf {
  ziel: string;
  art: string;
  daten?: unknown;
  filter: [string, string, unknown][];
}
type Antwort = { data: unknown; error: { message: string; code?: string; hint?: string } | null };

function attrappe(antworten: (a: Aufruf) => Antwort) {
  const aufrufe: Aufruf[] = [];
  const melde = (a: Aufruf) => {
    aufrufe.push(a);
    return Promise.resolve(antworten(a));
  };
  const from = (tabelle: string) => {
    const a: Aufruf = { ziel: tabelle, art: 'select', filter: [] };
    const filter = (op: string) => (k: string, v?: unknown) => {
      a.filter.push([op, k, v]);
      return b;
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (d: unknown) => ((a.art = 'insert'), (a.daten = d), b),
      update: (d: unknown) => ((a.art = 'update'), (a.daten = d), b),
      delete: () => ((a.art = 'delete'), b),
      eq: filter('eq'), is: filter('is'), lt: filter('lt'), in: filter('in'),
      order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
      then: (ok: (x: Antwort) => unknown, fehler: (e: unknown) => unknown) => melde(a).then(ok, fehler),
    };
    return b;
  };
  const speicher = (art: string, daten: unknown) => melde({ ziel: 'speicher', art, daten, filter: [] });
  const db = {
    from,
    rpc: (fn: string, daten: unknown) => melde({ ziel: fn, art: 'rpc', daten, filter: [] }),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('dokumente');
        return {
          createSignedUploadUrl: (pfad: string) => speicher('signieren', pfad),
          list: (ordner: string, optionen: unknown) => speicher('auflisten', { ordner, optionen }),
          download: (pfad: string) => speicher('laden', pfad),
          remove: (pfade: string[]) => speicher('entfernen', pfade),
          update: (pfad: string, _body: unknown, optionen: unknown) => speicher('ersetzen', { pfad, optionen }),
          createSignedUrl: (pfad: string) => speicher('link', pfad),
        };
      },
    },
  };
  return { db, aufrufe };
}

const ok = (data: unknown): Antwort => ({ data, error: null });
const ctx = (db: unknown): Kontext => ({
  db, benutzerId: 'u1', rollen: new Set(['admin']), heute: '2026-11-27', stichtag: new Date(2026, 10, 27, 12),
});
const werkzeug = (name: string) => {
  const w = WERKZEUGE.find((x) => x.name === name);
  if (!w) throw new Error(`Werkzeug ${name} fehlt`);
  return w;
};
const vorbereiten = werkzeug('dokument_upload_vorbereiten');
const abschliessen = werkzeug('dokument_upload_abschliessen');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------- reine Fachlogik ----------

describe('Dateityp an den Bytes, nicht an der Endung', () => {
  it('erkennt PDF (auch mit Vorspann), JPG, PNG und ein echtes PDF aus pdf-lib', async () => {
    expect(erkenneDateityp(PDF_BYTES)).toBe('application/pdf');
    const mitVorspann = new Uint8Array([...new Uint8Array(500).fill(0x20), ...PDF_BYTES]);
    expect(erkenneDateityp(mitVorspann)).toBe('application/pdf');
    expect(erkenneDateityp(JPG_BYTES)).toBe('image/jpeg');
    expect(erkenneDateityp(PNG_BYTES)).toBe('image/png');
    const pdf = await PDFDocument.create();
    pdf.addPage();
    expect(erkenneDateityp(await pdf.save())).toBe('application/pdf');
  });

  it('unterscheidet DOCX und XLSX am Inhaltsverzeichnis des ZIP-Archivs', () => {
    expect(erkenneDateityp(office('word/document.xml'))).toBe(DOCX);
    expect(erkenneDateityp(office('xl/workbook.xml'))).toBe(XLSX);
  });

  it('hält ein DOCX mit „%PDF-“ in einem ungepackten ersten Eintrag nicht für PDF (Review 27.11.2026)', () => {
    const docx = zipSync({
      'a.txt': [strToU8('%PDF-1.4 hallo'), { level: 0 }],
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<x/>'),
    });
    expect(new TextDecoder().decode(docx.subarray(0, 200))).toContain('%PDF-');
    expect(erkenneDateityp(docx)).toBe(DOCX);
    expect(abweichung(docx, { groesse_bytes: docx.length, mime_type: DOCX })).toBeNull();
  });

  it('nimmt Dateien mit Makros nicht an, auch unter der Endung DOCX oder XLSX', () => {
    const docm = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<x/>'), 'word/vbaProject.bin': new Uint8Array(8) });
    expect(mitMakros(docm)).toBe(true);
    expect(mitMakros(office('word/document.xml'))).toBe(false);
    expect(erkenneDateityp(docm)).toBeNull();
    expect(abweichung(docm, { groesse_bytes: docm.length, mime_type: DOCX }))
      .toBe('Die Datei enthält Makros (vbaProject.bin); solche Dateien nimmt der Upload nicht an.');
  });

  it('zählt „%PDF-“ nur, wenn es ganz in den ersten 1024 Byte steht', () => {
    const ab = (n: number) => new Uint8Array([...new Uint8Array(n).fill(0x20), ...PDF_BYTES]);
    expect(erkenneDateityp(ab(1019))).toBe('application/pdf');
    expect(erkenneDateityp(ab(1020))).toBeNull();
  });

  it('weist ZIP ohne Office-Inhalt, abgeschnittene Archive, Text und leere Dateien ab', () => {
    expect(erkenneDateityp(zipSync({ 'word/document.xml': strToU8('<x/>') }))).toBeNull();
    expect(erkenneDateityp(zipSync({ '[Content_Types].xml': strToU8('<x/>'), 'bild.png': PNG_BYTES }))).toBeNull();
    const docx = office('word/document.xml');
    expect(erkenneDateityp(docx.subarray(0, docx.length - 30))).toBeNull();
    expect(erkenneDateityp(new TextEncoder().encode('Hallo, das ist kein PDF'))).toBeNull();
    expect(erkenneDateityp(new Uint8Array(0))).toBeNull();
    // %PDF- erst nach 1024 Byte zählt nicht
    expect(erkenneDateityp(new Uint8Array([...new Uint8Array(1100).fill(0x20), ...PDF_BYTES]))).toBeNull();
  });

  it('meldet abweichende Größe und abweichenden Typ verständlich', () => {
    expect(abweichung(PDF_BYTES, { groesse_bytes: PDF_BYTES.length, mime_type: 'application/pdf' })).toBeNull();
    expect(abweichung(PDF_BYTES, { groesse_bytes: 99, mime_type: 'application/pdf' }))
      .toBe(`Die hochgeladene Datei hat ${PDF_BYTES.length} Bytes, angegeben waren 99.`);
    expect(abweichung(PNG_BYTES, { groesse_bytes: PNG_BYTES.length, mime_type: 'application/pdf' }))
      .toBe('Der Inhalt ist PNG, angegeben war PDF.');
    expect(abweichung(new TextEncoder().encode('abc'), { groesse_bytes: 3, mime_type: DOCX }))
      .toMatch(/^Der Inhalt ist kein DOCX \(Word\).*Erlaubt sind PDF, JPG, PNG, DOCX und XLSX\.$/);
  });
});

describe('Angaben aus Schritt 1', () => {
  it('nimmt nur die fünf Typen an, verzeiht image/jpg und Zusätze', () => {
    expect(erlaubterTyp('application/pdf')).toBe('application/pdf');
    expect(erlaubterTyp('Application/PDF; charset=binary')).toBe('application/pdf');
    expect(erlaubterTyp('image/jpg')).toBe('image/jpeg');
    expect(erlaubterTyp(XLSX)).toBe(XLSX);
    expect(() => erlaubterTyp('image/gif')).toThrow('Der Dateityp „image/gif“ ist nicht erlaubt. Erlaubt sind PDF, JPG, PNG, DOCX und XLSX.');
    expect(() => erlaubterTyp('application/msword')).toThrow(Fachfehler);
  });

  it('begrenzt auf 50 MB mit Angabe der Größe', () => {
    expect(() => pruefeGroesse(MAX_BYTES)).not.toThrow();
    expect(() => pruefeGroesse(Math.round(61.2 * 1024 * 1024))).toThrow('Die Datei ist 61,2 MB groß; über diesen Weg gehen höchstens 50 MB.');
    for (const ungueltig of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => pruefeGroesse(ungueltig), String(ungueltig)).toThrow('Die Größe der Datei fehlt oder ist ungültig');
    }
  });

  it('bildet den Pfad wie der Hochladen-Knopf der App, passend zur Prüfregel der Tabelle und zum Speicher', () => {
    const regel = /pfad ~ '([^']+)'/.exec(readFileSync('supabase/migrations/20261127100000_mcp_dokument_uploads.sql', 'utf-8'))?.[1];
    expect(regel).toBeTruthy();
    for (let i = 0; i < 50; i++) {
      const pfad = uploadPfad(V1, Date.now(), zufallsteil(), 'pdf');
      expect(pfad).toMatch(new RegExp(regel as string));
      expect(pfad).toMatch(STORAGE_PFAD);
      expect(pfad.startsWith(`${V1}/`)).toBe(true);
    }
    expect(new Set(Array.from({ length: 200 }, zufallsteil)).size).toBe(200);
  });

  it('nimmt den Titel, sonst den Dateinamen ohne Verzeichnis', () => {
    expect(titelAus('  Kündigung Mieter  ', 'k.pdf')).toBe('Kündigung Mieter');
    expect(titelAus(undefined, '/mnt/user-data/uploads/20261127 Kündigung.pdf')).toBe('20261127 Kündigung.pdf');
    expect(titelAus('', 'C:\\Briefe\\Brief.docx')).toBe('Brief.docx');
    expect(() => titelAus(' ', '/')).toThrow(Fachfehler);
  });
});

// ---------- Werkzeuge ----------

describe('Katalog', () => {
  it('beide Werkzeuge nur für Admins, schreibend, nicht zerstörend; Mietvertrag nicht als Kategorie', () => {
    for (const w of [vorbereiten, abschliessen]) {
      expect(w.rollen).toEqual(['admin']);
      expect(w.schreibt).toBe(true);
      expect(w.zerstoerend).toBeFalsy();
    }
    const kategorien = vorbereiten.eingabe.properties?.kategorie.enum ?? [];
    expect(kategorien).not.toContain('Mietvertrag');
    expect([...kategorien, 'Mietvertrag'].sort()).toEqual([...DOKUMENT_KATEGORIEN].sort());
    expect(UPLOAD_KATEGORIEN).toEqual(kategorien);
    expect(SERVER.hinweise).toContain('dokument_upload_vorbereiten und dokument_upload_abschliessen');
  });
});

describe('dokument_upload_vorbereiten', () => {
  const eingabe = {
    mietvertrag_id: V1,
    dateiname: '/mnt/user-data/uploads/20261127 Kündigung.pdf',
    kategorie: 'Kündigung',
    mime_type: 'application/pdf',
    groesse_bytes: 96695,
  };
  const normal = (a: Aufruf): Antwort => {
    if (a.ziel === 'mietvertrag') return ok({ id: V1 });
    if (a.ziel === 'immobilien') return ok({ id: O1 });
    if (a.ziel === 'mcp_dokument_uploads' && a.art === 'select') return ok([]);
    if (a.ziel === 'mcp_dokument_uploads' && a.art === 'insert') return ok({ id: U1 });
    if (a.art === 'signieren') return ok({ signedUrl: SIGNIERT, path: a.daten, token: 'abc' });
    return ok(null);
  };

  it('signiert einen Pfad unter dem Vertrag, merkt den Vorgang 15 Minuten vor und nennt PUT, Header und curl', async () => {
    const { db, aufrufe } = attrappe(normal);
    const r = await vorbereiten.ausfuehren(eingabe, ctx(db)) as Record<string, unknown>;
    const signiert = aufrufe.find((a) => a.art === 'signieren');
    expect(signiert?.daten).toMatch(new RegExp(`^${V1}/\\d{13}_[a-z0-9]+\\.pdf$`));
    const vorgemerkt = aufrufe.find((a) => a.art === 'insert')?.daten as Record<string, unknown>;
    expect(vorgemerkt).toEqual({
      pfad: signiert?.daten,
      mietvertrag_id: V1,
      immobilie_id: null,
      dateiname: '/mnt/user-data/uploads/20261127 Kündigung.pdf',
      titel: '20261127 Kündigung.pdf',
      kategorie: 'Kündigung',
      mime_type: 'application/pdf',
      groesse_bytes: 96695,
      gueltig_bis: '2026-11-27T10:15:00.000Z',
    });
    expect(r).toMatchObject({
      upload_id: U1,
      upload_url: SIGNIERT,
      methode: 'PUT',
      header: { 'Content-Type': 'application/pdf' },
      gueltig_bis: '2026-11-27T10:15:00.000Z',
      gueltig_bis_uhrzeit: '11:15 Uhr',
    });
    expect(r.befehl).toBe(`curl -sS --fail-with-body -X PUT -H "Content-Type: application/pdf" --data-binary @"<Pfad zur Datei>" "${SIGNIERT}"`);
    expect(r.falls_blockiert).toContain('kmtgzrnpitlslivdvlyq.supabase.co');
  });

  it('legt an einem Objekt ab, wenn objekt_id statt mietvertrag_id kommt', async () => {
    const { db, aufrufe } = attrappe(normal);
    await vorbereiten.ausfuehren({ ...eingabe, mietvertrag_id: undefined, objekt_id: O1, mime_type: 'image/jpg', titel: 'Foto' }, ctx(db));
    expect(aufrufe.find((a) => a.art === 'signieren')?.daten).toMatch(new RegExp(`^${O1}/\\d{13}_[a-z0-9]+\\.jpg$`));
    expect(aufrufe.find((a) => a.art === 'insert')?.daten).toMatchObject({ mietvertrag_id: null, immobilie_id: O1, mime_type: 'image/jpeg', titel: 'Foto' });
  });

  it('weist falsches Ziel, Typ, Größe und die Kategorie Mietvertrag ab, bevor etwas geschrieben wird', async () => {
    const faelle: [Record<string, unknown>, string | RegExp][] = [
      [{ ...eingabe, objekt_id: O1 }, 'Genau eines von mietvertrag_id oder objekt_id angeben.'],
      [{ ...eingabe, mietvertrag_id: undefined }, 'Genau eines von mietvertrag_id oder objekt_id angeben.'],
      [{ ...eingabe, mime_type: 'image/gif' }, /nicht erlaubt\. Erlaubt sind PDF, JPG, PNG, DOCX und XLSX/],
      [{ ...eingabe, groesse_bytes: 60 * 1024 * 1024 }, 'Die Datei ist 60 MB groß; über diesen Weg gehen höchstens 50 MB.'],
      [{ ...eingabe, kategorie: 'Mietvertrag' }, 'Mietvertrags-Dokumente tragen die Fassungen des Vertrags. Bitte in der App im Baustein Mietvertrag hochladen.'],
      [{ ...eingabe, kategorie: 'Unbekannt' }, /^Die Kategorie „Unbekannt“ gibt es nicht\. Erlaubt sind: Kündigung, /],
      [{ ...eingabe, mietvertrag_id: '', objekt_id: '' }, 'Genau eines von mietvertrag_id oder objekt_id angeben.'],
      [{ ...eingabe, dateiname: ' \n ', titel: 'Titel' }, 'Bitte einen Dateinamen angeben.'],
      [{ ...eingabe, groesse_bytes: Number.NaN }, /Größe der Datei fehlt oder ist ungültig/],
    ];
    for (const [e, meldung] of faelle) {
      const { db, aufrufe } = attrappe(normal);
      await expect(vorbereiten.ausfuehren(e, ctx(db))).rejects.toThrow(meldung);
      expect(aufrufe).toEqual([]);
    }
  });

  it('behandelt eine leere zweite ID wie nicht angegeben', async () => {
    const { db, aufrufe } = attrappe(normal);
    await vorbereiten.ausfuehren({ ...eingabe, objekt_id: '' }, ctx(db));
    expect(aufrufe.find((a) => a.art === 'insert')?.daten).toMatchObject({ mietvertrag_id: V1, immobilie_id: null });
  });

  it('gibt für einen Vertrag, den das Konto nicht sieht, keine URL heraus', async () => {
    const { db, aufrufe } = attrappe((a) => (a.ziel === 'mietvertrag' ? ok(null) : normal(a)));
    await expect(vorbereiten.ausfuehren(eingabe, ctx(db))).rejects.toThrow('Mietvertrag nicht gefunden oder kein Zugriff.');
    expect(aufrufe.some((a) => a.art === 'signieren' || a.art === 'insert')).toBe(false);
  });

  it('meldet eine verweigerte Signatur (Regel des Buckets) und merkt nichts vor', async () => {
    const { db, aufrufe } = attrappe((a) => (a.art === 'signieren'
      ? { data: null, error: { message: 'new row violates row-level security policy' } }
      : normal(a)));
    await expect(vorbereiten.ausfuehren(eingabe, ctx(db))).rejects.toThrow('Dieses Konto darf keine Dokumente ablegen.');
    expect(aufrufe.some((a) => a.art === 'insert')).toBe(false);
  });

  it('räumt abgelaufene offene Vorgänge samt Datei weg, und ein Fehler dabei hält den Upload nicht auf', async () => {
    const alt = { id: 'alt-1', pfad: `${V1}/1764000000000_alt.pdf` };
    const { db, aufrufe } = attrappe((a) => (a.ziel === 'mcp_dokument_uploads' && a.art === 'select' ? ok([alt]) : normal(a)));
    await vorbereiten.ausfuehren(eingabe, ctx(db));
    const suche = aufrufe.find((a) => a.ziel === 'mcp_dokument_uploads' && a.art === 'select');
    expect(suche?.filter).toEqual([['is', 'abgeschlossen_am', null], ['lt', 'created_at', '2026-11-27T07:55:00.000Z']]);
    expect(aufrufe.find((a) => a.art === 'entfernen')?.daten).toEqual([alt.pfad]);
    expect(aufrufe.find((a) => a.art === 'delete')?.filter).toEqual([['in', 'id', ['alt-1']], ['is', 'abgeschlossen_am', null]]);

    const kaputt = attrappe((a) => (a.ziel === 'mcp_dokument_uploads' && a.art === 'select'
      ? ok([alt])
      : a.art === 'entfernen' ? { data: null, error: { message: 'Speicher weg' } } : normal(a)));
    const r = await vorbereiten.ausfuehren(eingabe, ctx(kaputt.db)) as Record<string, unknown>;
    expect(r.upload_id).toBe(U1);
    // Ohne entfernte Datei bleibt die Zeile stehen, damit der nächste Lauf es erneut versucht
    expect(kaputt.aufrufe.some((a) => a.art === 'delete')).toBe(false);
  });
});

describe('dokument_upload_abschliessen', () => {
  const vorgang = (felder: Record<string, unknown> = {}) => ({
    id: U1,
    pfad: `${V1}/1764237600000_abcd1234.pdf`,
    titel: '20261127 Kündigung.pdf',
    kategorie: 'Kündigung',
    mime_type: 'application/pdf',
    groesse_bytes: PDF_BYTES.length,
    gueltig_bis: '2026-11-27T10:15:00.000Z',
    dokument_id: null,
    abgeschlossen_am: null,
    ...felder,
  });
  const NAME = '1764237600000_abcd1234.pdf';
  /** Datei im Speicher: Inhalt plus Metadaten wie storage.list sie liefert (size, mimetype) */
  const mit = (zeile: Record<string, unknown>, datei: Blob | null, weiter: (a: Aufruf) => Antwort | undefined = () => undefined) =>
    attrappe((a) => {
      const sonder = weiter(a);
      if (sonder) return sonder;
      if (a.ziel === 'mcp_dokument_uploads') return ok(zeile);
      if (a.art === 'auflisten') {
        return ok(datei ? [{ name: `${NAME}x`, metadata: { size: 1 } }, { name: NAME, metadata: { size: datei.size, mimetype: datei.type } }] : []);
      }
      if (a.art === 'laden') return datei ? ok(datei) : { data: null, error: { message: 'Object not found' } };
      if (a.art === 'rpc') return ok({ dokument_id: D1, neu: true });
      if (a.art === 'link') return ok({ signedUrl: 'https://example.invalid/link' });
      return ok(null);
    });
  const pdf = () => new Blob([PDF_BYTES], { type: 'application/pdf' });

  it('prüft die Datei, legt das Dokument per RPC an und liefert den Link', async () => {
    const { db, aufrufe } = mit(vorgang(), pdf());
    const r = await abschliessen.ausfuehren({ upload_id: U1 }, ctx(db));
    expect(aufrufe.find((a) => a.art === 'auflisten')?.daten).toEqual({ ordner: V1, optionen: { limit: 10, search: NAME } });
    expect(aufrufe.find((a) => a.art === 'rpc')).toMatchObject({
      ziel: 'mcp_dokument_upload_abschliessen',
      daten: { p_upload_id: U1, p_groesse_bytes: PDF_BYTES.length },
    });
    expect(aufrufe.some((a) => a.art === 'ersetzen' || a.art === 'entfernen')).toBe(false);
    expect(r).toEqual({
      ok: true,
      bereits_abgeschlossen: false,
      dokument_id: D1,
      titel: '20261127 Kündigung.pdf',
      kategorie: 'Kündigung',
      link: 'https://example.invalid/link',
      link_gueltig_minuten: 10,
    });
  });

  it('legt beim zweiten Aufruf kein zweites Dokument an', async () => {
    const { db, aufrufe } = mit(vorgang({ dokument_id: D1, abgeschlossen_am: '2026-11-27T10:05:00Z' }), pdf());
    const r = await abschliessen.ausfuehren({ upload_id: U1 }, ctx(db));
    expect(r).toMatchObject({ bereits_abgeschlossen: true, dokument_id: D1 });
    expect(aufrufe.some((a) => a.art === 'laden' || a.art === 'rpc')).toBe(false);

    // Auch wenn zwei Aufrufe gleichzeitig prüfen: die RPC meldet neu = false
    const zweiter = mit(vorgang(), pdf(), (a) => (a.art === 'rpc' ? ok({ dokument_id: D1, neu: false }) : undefined));
    expect(await abschliessen.ausfuehren({ upload_id: U1 }, ctx(zweiter.db))).toMatchObject({ bereits_abgeschlossen: true, dokument_id: D1 });
  });

  it('lehnt nach Ablauf der Frist ab, ohne die Datei zu löschen — das übernimmt der Aufräumlauf', async () => {
    const { db, aufrufe } = mit(vorgang({ gueltig_bis: '2026-11-27T09:59:00.000Z' }), pdf());
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(db))).rejects.toThrow(
      'Die Upload-URL ist seit 10:59 Uhr abgelaufen. Bitte dokument_upload_vorbereiten erneut aufrufen und die Datei neu hochladen.',
    );
    expect(aufrufe.some((a) => ['entfernen', 'laden', 'rpc'].includes(a.art))).toBe(false);
    // Genau zum Fristende gilt sie noch
    const grenze = mit(vorgang({ gueltig_bis: '2026-11-27T10:00:00.000Z' }), pdf());
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(grenze.db))).resolves.toMatchObject({ dokument_id: D1 });
    const kaputt = mit(vorgang({ gueltig_bis: 'kaputt' }), pdf());
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(kaputt.db))).rejects.toThrow('Die Upload-URL ist abgelaufen.');
  });

  it('meldet, wenn noch nichts hochgeladen ist, und unterscheidet einen Fehler des Speichers', async () => {
    const { db, aufrufe } = mit(vorgang(), null);
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(db))).rejects.toThrow(/noch keine Datei.*per PUT/);
    expect(aufrufe.some((a) => ['laden', 'rpc', 'entfernen'].includes(a.art))).toBe(false);

    const speicher = mit(vorgang(), pdf(), (a) => (a.art === 'auflisten' ? { data: null, error: { message: '503' } } : undefined));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(speicher.db))).rejects.toThrow('Der Speicher ließ sich gerade nicht abfragen.');
    const laden = mit(vorgang(), pdf(), (a) => (a.art === 'laden' ? { data: null, error: { message: '503' } } : undefined));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(laden.db))).rejects.toThrow('Die hochgeladene Datei ließ sich gerade nicht lesen.');
    expect([...speicher.aufrufe, ...laden.aufrufe].some((a) => a.art === 'entfernen' || a.art === 'rpc')).toBe(false);
  });

  it('verwirft eine Datei mit anderer Größe, ohne sie zu laden, und eine mit anderem Inhalt', async () => {
    const groesse = mit(vorgang({ groesse_bytes: 999 }), pdf());
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(groesse.db))).rejects.toThrow(
      `Die hochgeladene Datei hat ${PDF_BYTES.length} Bytes, angegeben waren 999. Die Datei wurde verworfen; bitte dokument_upload_vorbereiten erneut aufrufen.`,
    );
    expect(groesse.aufrufe.some((a) => a.art === 'entfernen')).toBe(true);
    expect(groesse.aufrufe.some((a) => a.art === 'laden' || a.art === 'rpc')).toBe(false);

    // Ein Netzfehler beim Verwerfen ändert die Meldung nicht (QA 27.11.2026)
    const netz = mit(vorgang({ groesse_bytes: 999 }), pdf());
    netz.db.storage.from = (() => {
      const echt = netz.db.storage.from;
      return (bucket: string) => ({ ...echt(bucket), remove: () => Promise.reject(new Error('netz')) });
    })();
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(netz.db))).rejects.toThrow(/angegeben waren 999\. Die Datei wurde verworfen/);

    const inhalt = mit(vorgang({ groesse_bytes: PNG_BYTES.length }), new Blob([PNG_BYTES], { type: 'application/pdf' }));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(inhalt.db))).rejects.toThrow('Der Inhalt ist PNG, angegeben war PDF.');
    expect(inhalt.aufrufe.some((a) => a.art === 'entfernen')).toBe(true);
    expect(inhalt.aufrufe.some((a) => a.art === 'rpc')).toBe(false);
  });

  it('berichtigt den gespeicherten Typ, wenn der PUT ohne Content-Type kam', async () => {
    const bytesBeimErsetzen: Uint8Array[] = [];
    const { db, aufrufe } = mit(vorgang(), new Blob([PDF_BYTES], { type: 'application/x-www-form-urlencoded' }));
    const echteFrom = db.storage.from;
    db.storage.from = (bucket: string) => ({
      ...echteFrom(bucket),
      update: (pfad: string, body: Uint8Array, optionen: unknown) => {
        bytesBeimErsetzen.push(body);
        return echteFrom(bucket).update(pfad, body, optionen);
      },
    });
    await abschliessen.ausfuehren({ upload_id: U1 }, ctx(db));
    expect(bytesBeimErsetzen).toEqual([PDF_BYTES]);
    expect(aufrufe.find((a) => a.art === 'ersetzen')?.daten).toEqual({
      pfad: `${V1}/1764237600000_abcd1234.pdf`,
      optionen: { contentType: 'application/pdf', upsert: true },
    });
    expect(aufrufe.findIndex((a) => a.art === 'ersetzen')).toBeLessThan(aufrufe.findIndex((a) => a.art === 'rpc'));

    const scheitert = mit(vorgang(), new Blob([PDF_BYTES]), (a) => (a.art === 'ersetzen' ? { data: null, error: { message: 'nein' } } : undefined));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(scheitert.db))).rejects.toThrow(/ohne den Header Content-Type: application\/pdf/);
    expect(scheitert.aufrufe.some((a) => a.art === 'rpc')).toBe(false);
  });

  it('gibt für Mieterunterlagen keinen Link heraus', async () => {
    const { db, aufrufe } = mit(vorgang({ kategorie: 'Mieterunterlagen' }), pdf());
    const r = await abschliessen.ausfuehren({ upload_id: U1 }, ctx(db)) as Record<string, unknown>;
    expect(r.link).toBeNull();
    expect(r.hinweis).toContain('nur die App');
    expect(aufrufe.some((a) => a.art === 'link')).toBe(false);
  });

  it('reicht Meldungen der Datenbank im Wortlaut durch und meldet einen unbekannten Upload', async () => {
    const regel = mit(vorgang(), pdf(), (a) => (a.art === 'rpc'
      ? { data: null, error: { message: 'Die Upload-URL ist abgelaufen. Bitte dokument_upload_vorbereiten erneut aufrufen.', code: 'P0001' } }
      : undefined));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(regel.db))).rejects.toThrow('Die Upload-URL ist abgelaufen.');

    const unbekannt = mit(null as unknown as Record<string, unknown>, pdf());
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(unbekannt.db))).rejects.toThrow('Upload nicht gefunden oder kein Zugriff.');

    const leer = mit(vorgang(), pdf(), (a) => (a.art === 'rpc' ? ok(null) : undefined));
    await expect(abschliessen.ausfuehren({ upload_id: U1 }, ctx(leer.db))).rejects.toThrow('Das Dokument ließ sich nicht anlegen.');
  });
});
