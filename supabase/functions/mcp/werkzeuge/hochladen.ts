// MCP-Werkzeuge zum Ablegen von Dateien im Reiter „Dokumente“ (27.11.2026, Leitfaden des Kunden vom 27.11.2026).
//
// Claude schreibt eine Datei nicht als Base64 in den Werkzeugaufruf (schon 100 KB wären rund 135.000 Zeichen), sondern
// lädt sie aus seiner Arbeitsumgebung per HTTP-PUT an eine signierte Upload-URL des Speichers hoch:
//   1. dokument_upload_vorbereiten → upload_id und upload_url (an genau einen Pfad gebunden, überschreibt nichts)
//   2. curl -X PUT -H "Content-Type: …" --data-binary @datei "<upload_url>"
//   3. dokument_upload_abschliessen → prüft Größe und Typ an den Bytes, legt die Zeile in dokumente an
// Ablageort und Datensatz wie der Hochladen-Knopf der App (hooks/useDocumentUpload.ts), damit es keinen zweiten
// Ablageort gibt. Zwischen den Schritten merkt sich mcp_dokument_uploads den Vorgang (Migration 20261127100000).
// Die signierte URL des Speichers gilt fest 2 Stunden (storage-js createSignedUploadUrl); die Frist von 15 Minuten
// setzt der Abschluss durch.

import { ID, objekt, TEXT } from '../eingabe.ts';
import { DOKUMENT_KATEGORIEN, LINK_SEKUNDEN, OHNE_LINK } from './verwaltung.ts';
import { Fachfehler, genauEine, NUR_ADMIN, schreibfehler, type Kontext, type Werkzeug } from '../werkzeug.ts';

/** Höchstgröße wie die Upload-Grenze des Speichers für die App */
export const MAX_BYTES = 50 * 1024 * 1024;
/** So lange nach dem Vorbereiten lässt sich abschließen */
export const FRIST_MINUTEN = 15;
/** Die signierte URL gilt 2 Stunden; erst danach kann ein offener Vorgang nicht mehr beschrieben werden */
export const AUFRAEUMEN_NACH_MINUTEN = 125;

export const DATEITYPEN = {
  'application/pdf': { endung: 'pdf', name: 'PDF' },
  'image/jpeg': { endung: 'jpg', name: 'JPG' },
  'image/png': { endung: 'png', name: 'PNG' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { endung: 'docx', name: 'DOCX (Word)' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { endung: 'xlsx', name: 'XLSX (Excel)' },
} as const;
export type Dateityp = keyof typeof DATEITYPEN;

/** Mietvertrags-Dokumente tragen die Vertragsfassungen (utils/mietvertrag/fassungen.ts) — nur in der App ablegen */
export const UPLOAD_KATEGORIEN = DOKUMENT_KATEGORIEN.filter((k) => k !== 'Mietvertrag');

// ---------- reine Fachlogik (Vitest) ----------

const ERLAUBT_TEXT = 'Erlaubt sind PDF, JPG, PNG, DOCX und XLSX.';

/** Der angegebene Typ als einer der erlaubten; „image/jpg“ und Zusätze wie „; charset=…“ sind geläufig */
export function erlaubterTyp(angabe: string): Dateityp {
  const typ = angabe.split(';')[0].trim().toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  if (Object.prototype.hasOwnProperty.call(DATEITYPEN, typ)) return typ as Dateityp;
  throw new Fachfehler(`Der Dateityp „${angabe}“ ist nicht erlaubt. ${ERLAUBT_TEXT}`);
}

export function megabyte(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

export function pruefeGroesse(bytes: number): void {
  // Number.isInteger fängt auch NaN und Infinity ab — „NaN > MAX“ wäre false (QA 27.11.2026)
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new Fachfehler('Die Größe der Datei fehlt oder ist ungültig: bitte die Anzahl Bytes als ganze Zahl angeben.');
  }
  if (bytes > MAX_BYTES) {
    throw new Fachfehler(`Die Datei ist ${megabyte(bytes)} groß; über diesen Weg gehen höchstens ${megabyte(MAX_BYTES)}.`);
  }
}

/** Ablageort wie useDocumentUpload: <Vertrag oder Objekt>/<Zeitstempel>_<Zufall>.<Endung>, nur ASCII */
export function uploadPfad(zielId: string, jetztMs: number, zufall: string, endung: string): string {
  return `${zielId}/${jetztMs}_${zufall}.${endung}`;
}

export function zufallsteil(): string {
  const werte = crypto.getRandomValues(new Uint32Array(2));
  return Array.from(werte, (w) => w.toString(36).padStart(7, '0')).join('').slice(0, 12);
}

/** Titel im Reiter Dokumente: der angegebene, sonst der Dateiname ohne Verzeichnis */
export function titelAus(titel: string | undefined, dateiname: string): string {
  const name = dateiname.split(/[\\/]/).pop()?.trim() ?? '';
  const ergebnis = titel?.trim() || name;
  if (!ergebnis) throw new Fachfehler('Bitte einen Dateinamen oder Titel angeben.');
  return ergebnis;
}

function beginntMit(b: Uint8Array, kennung: readonly number[], ab = 0): boolean {
  if (b.length < ab + kennung.length) return false;
  return kennung.every((wert, i) => b[ab + i] === wert);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * Namen der Einträge eines ZIP-Archivs aus dem zentralen Verzeichnis am Dateiende. DOCX und XLSX sind beides ZIP;
 * unterscheiden lassen sie sich nur am Inhalt (word/… bzw. xl/…). null, wenn das Verzeichnis nicht lesbar ist.
 */
export function zipEintraege(b: Uint8Array): string[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Der Abschlusssatz (22 Byte plus Kommentar bis 64 KB) steht am Ende
  const untergrenze = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= untergrenze; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    const anzahl = dv.getUint16(i + 10, true);
    let p = dv.getUint32(i + 16, true);
    const namen: string[] = [];
    const text = new TextDecoder();
    for (let n = 0; n < anzahl; n++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return null;
      const nameLaenge = dv.getUint16(p + 28, true);
      const ende = p + 46 + nameLaenge;
      if (ende > b.length) return null;
      namen.push(text.decode(b.subarray(p + 46, ende)));
      p = ende + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return namen;
  }
  return null;
}

/** Makros (.docm/.xlsm unter falscher Endung) stecken in vbaProject.bin */
const MAKRO = /(^|\/)vbaProject\.bin$/i;

export function mitMakros(b: Uint8Array): boolean {
  return beginntMit(b, ZIP) && (zipEintraege(b) ?? []).some((n) => MAKRO.test(n));
}

/** Dateityp an den ersten Bytes (bei DOCX/XLSX am Inhaltsverzeichnis), nicht an der Endung */
export function erkenneDateityp(b: Uint8Array): Dateityp | null {
  // ZIP zuerst: ein DOCX mit „%PDF-“ in einem ungepackten ersten Eintrag gälte sonst als PDF (Review 27.11.2026)
  if (beginntMit(b, ZIP)) {
    const namen = zipEintraege(b);
    if (!namen || !namen.includes('[Content_Types].xml') || namen.some((n) => MAKRO.test(n))) return null;
    if (namen.some((n) => n.startsWith('word/'))) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (namen.some((n) => n.startsWith('xl/'))) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return null;
  }
  if (beginntMit(b, JPG)) return 'image/jpeg';
  if (beginntMit(b, PNG)) return 'image/png';
  // Leser nehmen „%PDF-“ innerhalb der ersten 1024 Byte an (PDF-Referenz, Anhang H): ganz darin, also ab Byte 1019
  for (let i = 0; i + PDF.length <= Math.min(1024, b.length); i++) {
    if (beginntMit(b, PDF, i)) return 'application/pdf';
  }
  return null;
}

/** Was an der hochgeladenen Datei nicht zur Angabe aus Schritt 1 passt, oder null */
export function abweichung(b: Uint8Array, erwartet: { groesse_bytes: number; mime_type: string }): string | null {
  if (b.length !== Number(erwartet.groesse_bytes)) {
    return `Die hochgeladene Datei hat ${b.length} Bytes, angegeben waren ${erwartet.groesse_bytes}.`;
  }
  if (mitMakros(b)) return 'Die Datei enthält Makros (vbaProject.bin); solche Dateien nimmt der Upload nicht an.';
  const typ = erkenneDateityp(b);
  const soll = DATEITYPEN[erwartet.mime_type as Dateityp]?.name ?? erwartet.mime_type;
  if (!typ) return `Der Inhalt ist kein ${soll} (keine der erlaubten Dateiarten erkannt). ${ERLAUBT_TEXT}`;
  if (typ !== erwartet.mime_type) return `Der Inhalt ist ${DATEITYPEN[typ].name}, angegeben war ${soll}.`;
  return null;
}

export function uhrzeitBerlin(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// ---------- Speicher ----------

const BUCKET = 'dokumente';

interface UploadZeile {
  id: string;
  pfad: string;
  titel: string;
  kategorie: string;
  mime_type: string;
  groesse_bytes: number;
  gueltig_bis: string;
  dokument_id: string | null;
  abgeschlossen_am: string | null;
}

/** Datei verwerfen; ein Fehler dabei wird nur protokolliert — der Aufräumlauf versucht es später erneut */
async function verwerfe(ctx: Kontext, pfad: string): Promise<void> {
  try {
    const { error } = await ctx.db.storage.from(BUCKET).remove([pfad]);
    if (error) console.error('[mcp] Upload nicht verworfen:', error.message);
  } catch (e) {
    console.error('[mcp] Upload nicht verworfen:', e instanceof Error ? e.message : String(e));
  }
}

/** Größe und gespeicherter Typ der hochgeladenen Datei aus den Metadaten des Speichers, ohne sie zu laden */
async function gespeicherteDatei(ctx: Kontext, pfad: string): Promise<{ groesse: number; typ: string } | null> {
  const trenner = pfad.lastIndexOf('/');
  const name = pfad.slice(trenner + 1);
  const { data, error } = await ctx.db.storage.from(BUCKET).list(pfad.slice(0, trenner), { limit: 10, search: name });
  if (error) {
    console.error('[mcp] Speicher nicht abfragbar:', error.message);
    throw new Fachfehler('Der Speicher ließ sich gerade nicht abfragen. Bitte dokument_upload_abschliessen gleich noch einmal aufrufen.');
  }
  const objekt = ((data ?? []) as { name: string; metadata?: Record<string, unknown> | null }[]).find((o) => o.name === name);
  if (!objekt) return null;
  return {
    groesse: Number(objekt.metadata?.size ?? objekt.metadata?.contentLength),
    typ: String(objekt.metadata?.mimetype ?? '').split(';')[0].trim().toLowerCase(),
  };
}

/**
 * Offene Vorgänge, deren signierte URL abgelaufen ist, samt Datei entfernen. Läuft bei jedem Vorbereiten mit, statt
 * als eigener Job: Dateien im Speicher lassen sich nur über die Storage-Schnittstelle löschen, nicht per SQL. Eine
 * liegengebliebene Datei ist bis dahin unsichtbar, weil ihr die Zeile in dokumente fehlt. Scheitert nie den Upload.
 */
export async function raeumeAuf(ctx: Kontext, jetztMs = Date.now()): Promise<void> {
  try {
    const grenze = new Date(jetztMs - AUFRAEUMEN_NACH_MINUTEN * 60_000).toISOString();
    const { data, error } = await ctx.db.from('mcp_dokument_uploads').select('id, pfad')
      .is('abgeschlossen_am', null).lt('created_at', grenze).order('created_at').limit(50);
    if (error || !data?.length) return;
    const zeilen = data as { id: string; pfad: string }[];
    const { error: speicherFehler } = await ctx.db.storage.from(BUCKET).remove(zeilen.map((z) => z.pfad));
    if (speicherFehler) {
      console.error('[mcp] Aufräumen im Speicher fehlgeschlagen:', speicherFehler.message);
      return;
    }
    const { error: loeschFehler } = await ctx.db.from('mcp_dokument_uploads').delete()
      .in('id', zeilen.map((z) => z.id)).is('abgeschlossen_am', null);
    if (loeschFehler) console.error('[mcp] Offene Uploads nicht gelöscht:', loeschFehler.message);
  } catch (e) {
    console.error('[mcp] Aufräumen fehlgeschlagen:', e instanceof Error ? e.message : String(e));
  }
}

async function ergebnisZu(ctx: Kontext, upload: UploadZeile, dokumentId: string | null, bereits: boolean) {
  if (!dokumentId) {
    return { ok: true, bereits_abgeschlossen: true, dokument_id: null, hinweis: 'Das Dokument zu diesem Upload wurde inzwischen gelöscht.' };
  }
  let link: string | null = null;
  let hinweis: string | undefined;
  if ((OHNE_LINK as readonly string[]).includes(upload.kategorie)) {
    hinweis = 'Mieterunterlagen öffnet nur die App, deshalb kein Link.';
  } else {
    const { data, error } = await ctx.db.storage.from(BUCKET).createSignedUrl(upload.pfad, LINK_SEKUNDEN);
    if (error || !data?.signedUrl) console.error('[mcp] Link nicht erzeugt:', error?.message ?? 'ohne Antwort');
    else link = data.signedUrl;
  }
  return {
    ok: true,
    bereits_abgeschlossen: bereits,
    dokument_id: dokumentId,
    titel: upload.titel,
    kategorie: upload.kategorie,
    link,
    ...(link ? { link_gueltig_minuten: LINK_SEKUNDEN / 60 } : {}),
    ...(hinweis ? { hinweis } : {}),
  };
}

// ---------- Werkzeuge ----------

const dokumentUploadVorbereiten: Werkzeug = {
  name: 'dokument_upload_vorbereiten',
  titel: 'Dokument hochladen (Schritt 1: vorbereiten)',
  beschreibung:
    'Erster Schritt, um eine Datei an einem Mietvertrag oder Objekt abzulegen (Reiter „Dokumente“). Liefert eine ' +
    `einmalige Upload-URL; die Datei danach innerhalb von ${FRIST_MINUTEN} Minuten per HTTP-PUT mit den angegebenen ` +
    'Headern hochladen (der fertige curl-Befehl steht in der Antwort) und dann dokument_upload_abschliessen aufrufen. ' +
    `${ERLAUBT_TEXT.replace('.', '')}, bis 50 MB. Die Kategorie Mietvertrag geht nur in der App.`,
  eingabe: objekt({
    mietvertrag_id: ID('Vertrag, an dem die Datei abgelegt wird — genau eines von mietvertrag_id oder objekt_id'),
    objekt_id: ID('Objekt, an dem die Datei abgelegt wird'),
    dateiname: { ...TEXT('Dateiname, z. B. „20261127 Kündigungsbestätigung.pdf“', 255), minLength: 1 },
    titel: TEXT('Titel im Reiter Dokumente; ohne Angabe der Dateiname', 200),
    kategorie: {
      type: 'string',
      enum: UPLOAD_KATEGORIEN,
      description: 'Kategorie. Mietvertrag fehlt bewusst: daran hängen die Vertragsfassungen, das geht nur in der App.',
    },
    mime_type: TEXT(
      'Dateityp: application/pdf, image/jpeg, image/png, application/vnd.openxmlformats-officedocument.wordprocessingml.document ' +
        '(DOCX) oder application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (XLSX)',
      120,
    ),
    groesse_bytes: { type: 'integer', minimum: 1, description: `Größe der Datei in Bytes (z. B. stat -c %s), höchstens ${MAX_BYTES}` },
  }, ['dateiname', 'kategorie', 'mime_type', 'groesse_bytes']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    // Leertext zählt wie „nicht angegeben“ — sonst ginge immobilie_id: '' in den Insert (QA 27.11.2026)
    const vertragId = (e.mietvertrag_id as string | undefined) || null;
    const objektId = (e.objekt_id as string | undefined) || null;
    if (!vertragId === !objektId) throw new Fachfehler('Genau eines von mietvertrag_id oder objekt_id angeben.');
    const typ = erlaubterTyp((e.mime_type as string | undefined) ?? '');
    pruefeGroesse(e.groesse_bytes as number);
    const kategorie = e.kategorie as string;
    if (kategorie === 'Mietvertrag') {
      throw new Fachfehler('Mietvertrags-Dokumente tragen die Fassungen des Vertrags. Bitte in der App im Baustein Mietvertrag hochladen.');
    }
    if (!(UPLOAD_KATEGORIEN as readonly string[]).includes(kategorie)) {
      throw new Fachfehler(`Die Kategorie „${kategorie ?? ''}“ gibt es nicht. Erlaubt sind: ${UPLOAD_KATEGORIEN.join(', ')}.`);
    }
    // JS-trim entfernt mehr als btrim in der Prüfregel; was hier nicht leer ist, ist es dort auch nicht
    const dateiname = ((e.dateiname as string | undefined) ?? '').trim();
    if (!dateiname) throw new Fachfehler('Bitte einen Dateinamen angeben.');
    const titel = titelAus(e.titel as string | undefined, dateiname);

    // Ziel lesen (RLS): ein Vertrag oder Objekt, das das Konto nicht sieht, bekommt keine URL
    const ziel = genauEine<{ id: string }>(
      await ctx.db.from(vertragId ? 'mietvertrag' : 'immobilien').select('id').eq('id', vertragId ?? objektId).maybeSingle(),
      vertragId ? 'Mietvertrag' : 'Objekt',
    );

    await raeumeAuf(ctx);

    const pfad = uploadPfad(ziel.id, Date.now(), zufallsteil(), DATEITYPEN[typ].endung);
    // Ohne upsert: ein zweiter PUT auf denselben Pfad scheitert, bestehende Dateien lassen sich so nicht überschreiben.
    // Der Speicher prüft beim Signieren die Upload-Regel des Buckets (nur Admin) mit dem Token des Nutzers.
    const { data: signiert, error: signierFehler } = await ctx.db.storage.from(BUCKET).createSignedUploadUrl(pfad);
    if (signierFehler || !signiert?.signedUrl) {
      console.error('[mcp] Upload-URL nicht erzeugt:', signierFehler?.message ?? 'ohne Antwort');
      throw new Fachfehler(
        /row-level security|unauthorized|403/i.test(signierFehler?.message ?? '')
          ? 'Dieses Konto darf keine Dokumente ablegen.'
          : 'Die Upload-URL ließ sich nicht erzeugen. Bitte später erneut versuchen.',
      );
    }

    const gueltigBis = new Date(Date.now() + FRIST_MINUTEN * 60_000).toISOString();
    const { data: vorgang, error } = await ctx.db.from('mcp_dokument_uploads').insert({
      pfad,
      mietvertrag_id: vertragId,
      immobilie_id: objektId,
      dateiname,
      titel,
      kategorie,
      mime_type: typ,
      groesse_bytes: e.groesse_bytes,
      gueltig_bis: gueltigBis,
    }).select('id').single();
    if (error || !vorgang) throw schreibfehler(error ?? { message: 'ohne Antwort' }, 'Upload vormerken');

    const url = signiert.signedUrl as string;
    return {
      upload_id: vorgang.id,
      upload_url: url,
      methode: 'PUT',
      header: { 'Content-Type': typ },
      gueltig_bis: gueltigBis,
      gueltig_bis_uhrzeit: `${uhrzeitBerlin(gueltigBis)} Uhr`,
      befehl: `curl -sS --fail-with-body -X PUT -H "Content-Type: ${typ}" --data-binary @"<Pfad zur Datei>" "${url}"`,
      naechster_schritt: 'Nach erfolgreichem PUT dokument_upload_abschliessen mit dieser upload_id aufrufen. Erst dann erscheint das Dokument in der App.',
      falls_blockiert:
        `Lehnt die Arbeitsumgebung den PUT ab (Proxy, Netzwerk, 403 vor dem Speicher), muss ein Admin in claude.ai unter ` +
        `Einstellungen → Fähigkeiten den Host ${new URL(url).host} für den Netzwerkzugriff freigeben.`,
    };
  },
};

const dokumentUploadAbschliessen: Werkzeug = {
  name: 'dokument_upload_abschliessen',
  titel: 'Dokument hochladen (Schritt 2: abschließen)',
  beschreibung:
    'Zweiter Schritt nach dem PUT-Upload: prüft die Datei (Größe, Typ an den ersten Bytes) und legt das Dokument im ' +
    'Reiter „Dokumente“ an. Erst danach ist es im Dashboard sichtbar. Ein zweiter Aufruf mit derselben upload_id legt ' +
    'kein zweites Dokument an.',
  eingabe: objekt({ upload_id: ID('upload_id aus dokument_upload_vorbereiten') }, ['upload_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const upload = genauEine<UploadZeile>(
      await ctx.db.from('mcp_dokument_uploads')
        .select('id, pfad, titel, kategorie, mime_type, groesse_bytes, gueltig_bis, dokument_id, abgeschlossen_am')
        .eq('id', e.upload_id).maybeSingle(),
      'Upload',
    );
    if (upload.abgeschlossen_am) return await ergebnisZu(ctx, upload, upload.dokument_id, true);

    // Nach Ablauf nicht löschen: Die Uhr der Datenbank (RPC) kann um Sekunden abweichen, ein gleichzeitiger Abschluss
    // dort noch gelingen — die Datei wäre dann weg, die Zeile in dokumente nicht. raeumeAuf holt sie später (Review).
    const frist = Date.parse(upload.gueltig_bis);
    if (!(frist >= Date.now())) {
      throw new Fachfehler(
        `Die Upload-URL ist ${Number.isNaN(frist) ? '' : `seit ${uhrzeitBerlin(upload.gueltig_bis)} Uhr `}abgelaufen. Bitte ` +
          'dokument_upload_vorbereiten erneut aufrufen und die Datei neu hochladen.',
      );
    }

    // Erst die Größe aus den Metadaten: geladen wird nur eine Datei mit der angegebenen Größe (höchstens 50 MB). Der
    // signierte PUT selbst ist nicht auf die Angabe begrenzt, und eine große Datei sprengte den Speicher der Function.
    const gespeichert = await gespeicherteDatei(ctx, upload.pfad);
    if (!gespeichert) {
      throw new Fachfehler(
        'Unter dieser upload_id liegt noch keine Datei. Erst die Datei per PUT an die upload_url hochladen (Antwort ' +
          'HTTP 200), dann abschließen.',
      );
    }
    if (gespeichert.groesse !== Number(upload.groesse_bytes)) {
      if (Number.isNaN(gespeichert.groesse)) {
        throw new Fachfehler('Die Größe der hochgeladenen Datei ließ sich nicht lesen. Bitte gleich noch einmal abschließen.');
      }
      await verwerfe(ctx, upload.pfad);
      throw new Fachfehler(
        `Die hochgeladene Datei hat ${gespeichert.groesse} Bytes, angegeben waren ${upload.groesse_bytes}. Die Datei ` +
          'wurde verworfen; bitte dokument_upload_vorbereiten erneut aufrufen.',
      );
    }

    const { data: datei, error: ladeFehler } = await ctx.db.storage.from(BUCKET).download(upload.pfad);
    if (ladeFehler || !datei) {
      console.error('[mcp] Upload nicht lesbar:', ladeFehler?.message ?? 'ohne Antwort');
      throw new Fachfehler('Die hochgeladene Datei ließ sich gerade nicht lesen. Bitte dokument_upload_abschliessen gleich noch einmal aufrufen.');
    }
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const fehler = abweichung(bytes, upload);
    if (fehler) {
      await verwerfe(ctx, upload.pfad);
      throw new Fachfehler(`${fehler} Die Datei wurde verworfen; bitte dokument_upload_vorbereiten erneut aufrufen.`);
    }

    // Ohne Header Content-Type speichert der Speicher einen falschen Typ, und die App zeigt die Datei nicht an:
    // dann mit dem erkannten Typ neu ablegen (Regel „Nur Admin darf Dokumente ersetzen“)
    if (gespeichert.typ !== upload.mime_type) {
      const { error: ersetzFehler } = await ctx.db.storage.from(BUCKET)
        .update(upload.pfad, bytes, { contentType: upload.mime_type, upsert: true });
      if (ersetzFehler) {
        console.error('[mcp] Dateityp nicht berichtigt:', ersetzFehler.message);
        await verwerfe(ctx, upload.pfad);
        throw new Fachfehler(
          `Die Datei wurde ohne den Header Content-Type: ${upload.mime_type} hochgeladen und ließ sich nicht berichtigen. ` +
            'Bitte dokument_upload_vorbereiten erneut aufrufen und den Header mitschicken.',
        );
      }
    }

    const { data, error } = await ctx.db.rpc('mcp_dokument_upload_abschliessen', {
      p_upload_id: upload.id,
      p_groesse_bytes: bytes.length,
    });
    if (error) throw schreibfehler(error, 'Dokument anlegen');
    const antwort = data as { dokument_id?: string | null; neu?: boolean } | null;
    if (!antwort || typeof antwort !== 'object') throw new Fachfehler('Das Dokument ließ sich nicht anlegen.');
    return await ergebnisZu(ctx, upload, antwort.dokument_id ?? null, !antwort.neu);
  },
};

export const HOCHLADE_WERKZEUGE: readonly Werkzeug[] = [dokumentUploadVorbereiten, dokumentUploadAbschliessen];
