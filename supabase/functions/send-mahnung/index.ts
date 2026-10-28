import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import nodemailer from "npm:nodemailer@6.9.10";

const ALLOWED_ORIGINS = [
  'https://immobilien-blick-dashboard.lovable.app',
  'https://id-preview--8e9e2f9b-7950-413f-adfd-90b0d2663ae1.lovable.app',
  'https://dashboard.niimmo.de',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PDF_DATEINAME = /^[A-Za-z0-9_.-]+\.pdf$/;
// Eine Adresse ohne Leerraum, Komma, Semikolon, spitze Klammern oder Anfuehrungszeichen
const MAILADRESSE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;
const MAX_KOPIEN = 5;
const MAX_EMPFAENGER = 5;
// Zugang eines Briefs: Aufgabe zur Post + 3 Tage (28.10.2026). Im Zivilrecht gibt es keine
// gesetzliche Zugangsfiktion (§ 130 BGB), drei Tage sind die uebliche Annahme. Derselbe Wert wie
// POST_ZUGANG_TAGE in src/utils/mahnungVersand.ts -- sendMahnung.test.ts vergleicht beide.
const POST_ZUGANG_TAGE = 3;
// Sendungsnummer eines Einschreibens (wie SENDUNGSNUMMER in src/utils/mahnungVersand.ts)
const SENDUNGSNUMMER = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,63}$/;
// Vorgemerkt werden nur frisch gespeicherte Schreiben (28.10.2026): Einem alten PDF liessen sich
// sonst andere Stufen, Fristen oder Betraege unterschieben, als darin stehen.
const MAX_ALTER_VORMERKUNG_MS = 30 * 60 * 1000;
// Ein Versand, der so lange in 'wird_versendet' steht, gilt als abgebrochen und darf geklaert
// werden. Eine Edge Function laeuft hoechstens wenige Minuten (Wall-Clock-Limit 150 bzw. 400 s);
// 15 Minuten lassen sicheren Abstand (Review 28.10.2026).
const HAENGT_NACH_MS = 15 * 60 * 1000;
const ANTWORT_KOPF = { 'Content-Type': 'application/json' };
const UNKLAR_MELDUNG = 'Ein Versand für diesen Vertrag ist noch unklar oder läuft gerade. Bitte erst im Mahnungsdialog klären. Es wurde nichts versendet.';

/** Nur ein PDF direkt im Mahnungsordner dieses Vertrags (mietvertragId ist vorher als UUID geprueft). */
function mahnungsPdfErlaubt(pfad: string, mietvertragId: string): boolean {
  const praefix = `mahnungen/${mietvertragId}/`;
  if (!pfad.startsWith(praefix)) return false;
  const dateiname = pfad.slice(praefix.length);
  return PDF_DATEINAME.test(dateiname) && !dateiname.includes('..');
}

/**
 * Seit 28.10.2026 vier Arten (`versandart`):
 * - 'vormerken': beim Speichern des Schreibens. Prueft wie der Versand und legt in mahnung_versand
 *   eine Zeile 'vorgemerkt' mit Stufe, Frist, Kuendigungsfeldern und Betraegen an. Wiederholt mit
 *   denselben Werten: Erfolg.
 * - 'email' (Vorgabe, auch fuer aeltere App-Fassungen ohne das Feld): Mailversand. Gibt es zum
 *   Schreiben eine Vormerkung, kommen Stufe, Frist, Kuendigung und Betraege aus ihr, und sie wird
 *   vor dem Versand beansprucht ('wird_versendet') -- ein zweiter Aufruf versendet nicht doppelt.
 * - 'post': Buchung „per Post versandt“, ohne SMTP. Nur mit Vormerkung; beanspruchen, Stufe
 *   buchen, abschliessen. Eine Wiederholung schliesst eine abgebrochene Buchung ab.
 * - 'freigeben': klaert einen abgebrochenen Versand ('wird_versendet' seit mindestens 15 Minuten):
 *   abschliessen, wenn belegt oder von Hand als versendet bestaetigt; freigeben nur nach Bestaetigung.
 */
interface MahnungEmailRequest {
  versandart?: unknown;
  /** Aeltere App-Fassungen: genau eine Adresse */
  recipientEmail?: unknown;
  /** Seit 28.10.2026: 1–5 Adressen, jede an einem Mieter des Vertrags hinterlegt */
  recipientEmails?: unknown;
  recipientName: string;
  ccEmails?: string[];
  mahnstufe: number;
  gesamtbetrag: number;
  rueckstandBetrag: number;
  mahngebuehren: number;
  verzugszinsen: number;
  zusaetzlicheKosten: number;
  zahlungsfristTage: number;
  immobilieName: string;
  immobilieAdresse: string;
  pdfPath: string;
  mietvertragId: string;
  forderungen?: Array<{ sollmonat: string; sollbetrag: number }>;
  /** Nur Stufe 3: Ergebnis von fristloseKuendigungFelder() im Browser */
  kuendigung?: unknown;
  /** Zahlungsfrist aus dem gespeicherten Schreiben (JJJJ-MM-TT); ersetzt zahlungsfristTage */
  fristDatum?: unknown;
  /** Nur 'vormerken': Betraege des Schreibens fuer eine spaetere Mail */
  betraege?: unknown;
  /** Nur 'post': Tag der Aufgabe zur Post (JJJJ-MM-TT) */
  versendetAm?: unknown;
  /** Nur 'post', optional: Sendungsnummer eines Einschreibens */
  sendungsnummer?: unknown;
  /** Nur 'freigeben' (E-Mail ohne Beleg): ausdrücklich bestätigt, dass nichts versendet wurde */
  bestaetigtNichtVersendet?: unknown;
  /** Nur 'freigeben' (E-Mail ohne Beleg): ausdrücklich bestätigt, dass die Mail versendet wurde */
  bestaetigtVersendet?: unknown;
}

interface Vormerkung {
  id: string;
  stufe: number;
  status: 'vorgemerkt' | 'wird_versendet' | 'versendet';
  zahlungsfrist: string | null;
  kuendigung: unknown;
  betraege: Record<string, unknown> | null;
  versandart: 'email' | 'post' | null;
  versendet_am: string | null;
  zugang_am: string | null;
  sendungsnummer: string | null;
  mail_id: string | null;
  erstellt_am: string;
  aktualisiert_am: string;
}

const VORMERKUNG_SPALTEN = 'id, stufe, status, zahlungsfrist, kuendigung, betraege, versandart, versendet_am, zugang_am, sendungsnummer, mail_id, erstellt_am, aktualisiert_am';

interface SchreibenBetraege {
  gesamtRueckstand: number;
  mahnkostenGesamt: number;
  verzugszinsenGesamt: number;
  zahlungsfristTage: number;
}

interface KuendigungsFelder {
  status: 'gekuendigt';
  kuendigungsdatum: string;
  ende_datum: string;
}

/** JJJJ-MM-TT als echter Kalendertag (kein 31.02.) */
function istKalendertag(wert: unknown): wert is string {
  if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(wert)) return false;
  const [jahr, monat, tag] = wert.split('-').map(Number);
  const d = new Date(Date.UTC(jahr, monat - 1, tag));
  return d.getUTCFullYear() === jahr && d.getUTCMonth() === monat - 1 && d.getUTCDate() === tag;
}

/**
 * Felder der fristlosen Kuendigung aus dem Request (Stufe 3). Seit 28.10.2026 setzt die Function sie
 * im selben Update wie die Stufe: Bis dahin tat es nur der Browser nach der Antwort -- ging die
 * verloren, blieb der Vertrag aktiv, waehrend der Mieter die Kuendigung schon hatte, und ein neuer
 * Versuch bekam 409. Geprueft wird die Form, nicht die Rechnung: kein Tag vor heute (deutsche Zeit),
 * Ende nicht vor der Kuendigung, hoechstens ein Jahr Raeumungsfrist (raeumungsfristInTagen).
 */
function pruefeKuendigungsfelder(felder: unknown, heuteIso: string): KuendigungsFelder | { fehler: string } {
  const f = (felder ?? {}) as Record<string, unknown>;
  if (typeof felder !== 'object' || felder === null || f.status !== 'gekuendigt') {
    return { fehler: 'Der Vertragsstatus der Kündigung fehlt.' };
  }
  if (!istKalendertag(f.kuendigungsdatum) || !istKalendertag(f.ende_datum)) {
    return { fehler: 'Kündigungsdatum oder Vertragsende ist kein gültiges Datum.' };
  }
  if (f.kuendigungsdatum < heuteIso) {
    return { fehler: 'Das Kündigungsdatum liegt in der Vergangenheit.' };
  }
  if (f.ende_datum < f.kuendigungsdatum) {
    return { fehler: 'Das Vertragsende liegt vor dem Kündigungsdatum.' };
  }
  const [jahr, monat, tag] = heuteIso.split('-').map(Number);
  const spaetestens = new Date(Date.UTC(jahr, monat - 1, tag + 365)).toISOString().slice(0, 10);
  if (f.ende_datum > spaetestens) {
    return { fehler: 'Die Räumungsfrist ist länger als ein Jahr.' };
  }
  return { status: 'gekuendigt', kuendigungsdatum: f.kuendigungsdatum, ende_datum: f.ende_datum };
}

/**
 * Kuendigungsfelder einer Vormerkung beim (spaeteren) Versand, 28.10.2026. Geprueft wird gegen den
 * Versandtag, nicht gegen den Speichertag: Raeumungsende nicht vor heute bzw. bei Post nicht vor dem
 * Zugang (fruehestensIso), Kuendigungsdatum nicht nach dem Raeumungsende.
 *
 * kuendigungsdatum bleibt dabei, wie es vorgemerkt wurde, und darf nicht vor heute liegen. Es ist
 * in dieser Anwendung der Tag, ZU dem gekuendigt ist, nicht der Tag der Erklaerung:
 * fristloseKuendigungFelder() setzt es auf das Raeumungsende, weil der Nachtlauf
 * update_expired_terminated_contracts jeden Vertrag mit kuendigungsdatum < CURRENT_DATE beendet
 * (und check_contract_status_on_update schon beim Speichern). Mit dem Erklaerungstag stuende der
 * Vertrag am Folgetag auf 'beendet' -- der Fehler vom 27.10.2026. Eine so gebildete Vormerkung
 * bleibt damit bis zum Raeumungsende versendbar. Die Hoechstfrist von einem Jahr galt beim Vormerken
 * und wird spaeter nur kuerzer. Dieselbe Regel nutzt die App (vorgemerkteKuendigungFehler).
 */
function pruefeVorgemerkteKuendigung(felder: unknown, heuteIso: string, fruehestensIso: string): KuendigungsFelder | { fehler: string } {
  const f = (felder ?? {}) as Record<string, unknown>;
  if (typeof felder !== 'object' || felder === null || f.status !== 'gekuendigt') {
    return { fehler: 'Der Vertragsstatus der Kündigung fehlt.' };
  }
  if (!istKalendertag(f.kuendigungsdatum) || !istKalendertag(f.ende_datum)) {
    return { fehler: 'Kündigungsdatum oder Vertragsende ist kein gültiges Datum.' };
  }
  if (f.ende_datum < fruehestensIso) {
    return { fehler: fruehestensIso > heuteIso ? 'Das Räumungsende im Schreiben liegt vor dem Zugang.' : 'Das Räumungsende im Schreiben ist schon vorbei.' };
  }
  if (f.kuendigungsdatum > f.ende_datum) {
    return { fehler: 'Das Vertragsende liegt vor dem Kündigungsdatum.' };
  }
  if (f.kuendigungsdatum < heuteIso) {
    return { fehler: 'Das Kündigungsdatum im Schreiben liegt in der Vergangenheit; der Vertrag würde sofort beendet.' };
  }
  return { status: 'gekuendigt', kuendigungsdatum: f.kuendigungsdatum, ende_datum: f.ende_datum };
}

/**
 * Zahlungsfrist als Datum aus dem gespeicherten Schreiben (28.10.2026). Mit zahlungsfristTage rechnete
 * die Mail vom Versandtag aus; lagen Speichern und Senden auf verschiedenen Tagen, nannte sie eine
 * andere Frist als das angehängte PDF. Erlaubt: echtes Datum, nicht vor heute, hoechstens 60 Tage.
 */
function pruefeFristDatum(wert: unknown, heuteIso: string): string | { fehler: string } {
  if (!istKalendertag(wert)) return { fehler: 'Die Zahlungsfrist ist kein gültiges Datum.' };
  if (wert < heuteIso) return { fehler: 'Die Zahlungsfrist im Schreiben ist schon abgelaufen. Bitte das Schreiben neu speichern.' };
  const [jahr, monat, tag] = heuteIso.split('-').map(Number);
  if (wert > new Date(Date.UTC(jahr, monat - 1, tag + 60)).toISOString().slice(0, 10)) {
    return { fehler: 'Die Zahlungsfrist liegt mehr als 60 Tage in der Zukunft.' };
  }
  return wert;
}

/**
 * Kalendertag in deutscher Zeit, um versatzTage verschoben, als TT.MM.JJJJ. Die Function laeuft
 * in UTC: Zwischen 0 und 2 Uhr nannte die Mail bis zum 27.10.2026 Datum und Frist einen Tag
 * frueher als das Schreiben, das im Browser entsteht.
 */
function berlinerTag(versatzTage: number): string {
  const [tag, monat, jahr] = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date())
    .split('.')
    .map(Number);
  // UTC-Mittag: Addieren von Tagen ueber eine Zeitumstellung hinweg bleibt auf dem Kalendertag
  const ziel = new Date(Date.UTC(jahr, monat - 1, tag + versatzTage, 12));
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(ziel);
}

/** JJJJ-MM-TT um tage Kalendertage verschoben, ueber UTC-Mittag (wie tagPlus in utils/mahnungVersand.ts) */
function tagPlus(isoTag: string, tage: number): string {
  const [jahr, monat, tag] = isoTag.split('-').map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tag + tage, 12)).toISOString().slice(0, 10);
}

/** Kalendertag eines Zeitpunkts in deutscher Zeit als JJJJ-MM-TT (wie berlinerKalendertag in utils/mahnungVersand.ts) */
function berlinerIsoTag(zeitpunkt: Date): string {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(zeitpunkt)
      .map((t) => [t.type, t.value]),
  );
  return `${teile.year}-${teile.month}-${teile.day}`;
}

/**
 * Buchung „per Post versandt“ (28.10.2026): Aufgabe frueestens am Tag des Schreibens (aus der
 * Vormerkung, nicht aus der Anfrage) und nicht in der Zukunft. Per Post beginnen die Fristen mit
 * dem Zugang -- Zahlungsfrist und Raeumungsende des Schreibens duerfen nicht davor liegen.
 * Dieselben Regeln zeigt die App vorab (postversandFehler in utils/mahnungVersand.ts).
 */
function pruefePostAufgabe(
  wert: unknown,
  schreibtagIso: string,
  heuteIso: string,
  fristIso: string,
  raeumungsendeIso: string | null,
): { versendetAm: string; zugangAm: string } | { fehler: string } {
  if (!istKalendertag(wert)) return { fehler: 'Das Datum der Aufgabe zur Post ist kein gültiges Datum.' };
  if (wert > heuteIso) return { fehler: 'Das Datum der Aufgabe zur Post liegt in der Zukunft.' };
  if (wert < schreibtagIso) {
    return { fehler: `Das Schreiben ist vom ${schreibtagIso.split('-').reverse().join('.')}; es kann nicht vorher zur Post gegeben worden sein.` };
  }
  const zugangAm = tagPlus(wert, POST_ZUGANG_TAGE);
  if (fristIso < zugangAm) {
    return { fehler: `Die Zahlungsfrist im Schreiben endet vor dem Zugang am ${zugangAm.split('-').reverse().join('.')}. Bitte ein neues Schreiben mit längerer Frist erstellen.` };
  }
  if (raeumungsendeIso && raeumungsendeIso < zugangAm) {
    return { fehler: `Das Räumungsende im Schreiben liegt vor dem Zugang am ${zugangAm.split('-').reverse().join('.')}. Bitte ein neues Schreiben mit längerer Räumungsfrist erstellen.` };
  }
  return { versendetAm: wert, zugangAm };
}

/** Optionale Sendungsnummer: leer ergibt null */
function pruefeSendungsnummer(wert: unknown): string | null | { fehler: string } {
  if (wert === undefined || wert === null) return null;
  if (typeof wert !== 'string') return { fehler: 'Die Sendungsnummer ist ungültig.' };
  const nummer = wert.trim();
  if (nummer === '') return null;
  return SENDUNGSNUMMER.test(nummer) ? nummer : { fehler: 'Die Sendungsnummer darf nur Buchstaben, Ziffern, Leerzeichen, Punkt und Bindestrich enthalten (höchstens 64 Zeichen).' };
}

/** Betraege des Schreibens fuer die Vormerkung: endliche Zahlen ab 0, Frist 1–60 Tage */
function pruefeBetraege(wert: unknown): SchreibenBetraege | { fehler: string } {
  const b = (wert ?? {}) as Record<string, unknown>;
  const betrag = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 10_000_000;
  if (typeof wert !== 'object' || wert === null
    || !betrag(b.gesamtRueckstand) || !betrag(b.mahnkostenGesamt) || !betrag(b.verzugszinsenGesamt)
    || !Number.isInteger(b.zahlungsfristTage) || (b.zahlungsfristTage as number) < 1 || (b.zahlungsfristTage as number) > 60) {
    return { fehler: 'Die Beträge des Schreibens sind unvollständig oder ungültig.' };
  }
  return {
    gesamtRueckstand: b.gesamtRueckstand as number,
    mahnkostenGesamt: b.mahnkostenGesamt as number,
    verzugszinsenGesamt: b.verzugszinsenGesamt as number,
    zahlungsfristTage: b.zahlungsfristTage as number,
  };
}

/**
 * Empfaenger der Mail (28.10.2026): eine Liste (recipientEmails) oder -- aeltere App-Fassungen --
 * genau eine Adresse (recipientEmail). Jede einzeln wohlgeformt und an einem Mieter des Vertrags
 * hinterlegt. Bis dahin galt auch der rohe hauptmail-Text: „a@x.de, b@y.de“ kam durch, und der
 * Mailserver schickte an beide, obwohl der Dialog nur eine Adresse zeigte.
 */
function pruefeEmpfaenger(
  liste: unknown,
  einzeln: unknown,
  erlaubt: Set<string>,
): string[] | { fehler: string; status: number } {
  const roh = Array.isArray(liste) ? liste : typeof einzeln === 'string' ? [einzeln] : [];
  const adressen = [...new Set(roh.map((a) => String(a ?? '').trim().toLowerCase()).filter(Boolean))];
  if (adressen.length === 0) return { fehler: 'Keine Empfängeradresse ausgewählt. Es wurde nichts versendet.', status: 400 };
  if (adressen.length > MAX_EMPFAENGER) {
    return { fehler: `Höchstens ${MAX_EMPFAENGER} Empfänger. Es wurde nichts versendet.`, status: 400 };
  }
  if (adressen.some((a) => !MAILADRESSE.test(a))) {
    return { fehler: 'Jede Empfängeradresse muss einzeln und vollständig angegeben sein. Es wurde nichts versendet.', status: 400 };
  }
  if (adressen.some((a) => !erlaubt.has(a))) {
    return { fehler: 'Die Empfängeradresse ist an diesem Mietvertrag nicht hinterlegt. Bitte zuerst in den Mieterdaten eintragen.', status: 403 };
  }
  return adressen;
}

/**
 * SMTP-Fehler, nach dem die Mail sicher NICHT angenommen wurde (28.10.2026): ausdrueckliche
 * Ablehnung des Mailservers (Antwortcode ab 400) oder ein Fehler vor der Uebergabe (Anmeldung,
 * Umschlag, Namensaufloesung, TLS, Verbindungsaufbau). Dann darf die Vormerkung wieder frei werden.
 * Alles andere (Zeitlimit, abgerissene Verbindung) ist unklar: Die Mail kann angekommen sein.
 */
function versandSicherGescheitert(fehler: unknown): boolean {
  const f = (fehler ?? {}) as { code?: unknown; responseCode?: unknown; syscall?: unknown };
  if (typeof f.responseCode === 'number' && f.responseCode >= 400) return true;
  if (typeof f.code === 'string' && ['EAUTH', 'EENVELOPE', 'EDNS', 'ETLS'].includes(f.code)) return true;
  return f.syscall === 'connect' || f.syscall === 'getaddrinfo';
}

/** Gleiche Werte wie die vorhandene Vormerkung: Ein wiederholtes Vormerken ist dann ein Erfolg. */
function gleicheVormerkung(
  z: Vormerkung,
  stufe: number,
  frist: string | null,
  kuendigung: KuendigungsFelder | null,
  betraege: SchreibenBetraege,
): boolean {
  const k = (z.kuendigung ?? null) as Partial<KuendigungsFelder> | null;
  const b = (z.betraege ?? {}) as Record<string, unknown>;
  const gleicheKuendigung = k === null
    ? kuendigung === null
    : kuendigung !== null && k.kuendigungsdatum === kuendigung.kuendigungsdatum && k.ende_datum === kuendigung.ende_datum;
  return z.status === 'vorgemerkt' && Number(z.stufe) === stufe && z.zahlungsfrist === frist && gleicheKuendigung
    && b.gesamtRueckstand === betraege.gesamtRueckstand && b.mahnkostenGesamt === betraege.mahnkostenGesamt
    && b.verzugszinsenGesamt === betraege.verzugszinsenGesamt && b.zahlungsfristTage === betraege.zahlungsfristTage;
}

/** Post: letzte Mahnung am Aufgabetag, naechste 30 Tage nach dem Zugang; Mail: jetzt und 30 Tage danach. */
function zeitpunkteFuer(versandart: 'email' | 'post', versendetAm: string, zugangAm: string) {
  return versandart === 'post'
    ? { letzte_mahnung_am: `${versendetAm}T12:00:00.000Z`, naechste_mahnung_am: `${tagPlus(zugangAm, 30)}T12:00:00.000Z` }
    : { letzte_mahnung_am: new Date().toISOString(), naechste_mahnung_am: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
}

type Client = ReturnType<typeof createClient>;

/**
 * Stufe und bei Stufe 3 die Kuendigung im selben bedingten Update (27./28.10.2026): nur, wenn die
 * gespeicherte Stufe noch die gepruefte ist; mit Kuendigung nur fuer einen laufenden Vertrag. Die
 * Erhoehung laesst der Trigger mahnstufe_nur_durch_versand nur mit Service-Role zu (dieser Client).
 */
async function bucheStufe(
  client: Client,
  b: { mietvertragId: string; stufeVorher: number | null; neueStufe: number; zeitpunkte: Record<string, string>; kuendigung: KuendigungsFelder | null },
): Promise<{ gespeichert: boolean; fehler: string | null }> {
  let stufenUpdate = client.from('mietvertrag').update({
    mahnstufe: b.neueStufe,
    ...b.zeitpunkte,
    // Stufe 3: Kuendigung im selben Update -- Stufe und Status stehen nur gemeinsam oder gar nicht
    ...(b.kuendigung ? { ...b.kuendigung, aktualisiert_am: new Date().toISOString() } : {}),
  }).eq('id', b.mietvertragId);
  stufenUpdate = b.stufeVorher === null
    ? stufenUpdate.is('mahnstufe', null)
    : stufenUpdate.eq('mahnstufe', b.stufeVorher);
  // Mit Kuendigung nur, solange der Vertrag noch laeuft -- wurde er inzwischen beendet, bleibt er es
  if (b.kuendigung) stufenUpdate = stufenUpdate.in('status', ['aktiv', 'gekuendigt']);
  const { data: aktualisiert, error } = await stufenUpdate.select('id');
  if (error || !aktualisiert || aktualisiert.length === 0) {
    return { gespeichert: false, fehler: error?.message ?? 'Stand hat sich zwischenzeitlich geaendert' };
  }
  return { gespeichert: true, fehler: null };
}

/**
 * Vormerkung beanspruchen (28.10.2026): nur aus 'vorgemerkt', atomar ueber die Bedingung. Zwei
 * gleichzeitige Aufrufe (Doppelklick, zwei Tabs, Wiederholung nach Zeitlimit) -- genau einer gewinnt.
 * Je Vertrag darf nur eine Zeile beansprucht sein (eindeutiger Teilindex): Ein anderes Schreiben
 * desselben Vertrags ergibt 23505 und damit 'anderer_versand'.
 */
async function vormerkungBeanspruchen(
  client: Client,
  id: string,
  felder: Record<string, unknown>,
): Promise<'ok' | 'vergeben' | 'anderer_versand' | { fehler: string }> {
  const { data, error } = await client.from('mahnung_versand')
    .update({ ...felder, status: 'wird_versendet' })
    .eq('id', id)
    .eq('status', 'vorgemerkt')
    .select('id');
  if (error) {
    if (error.code === '23505') return 'anderer_versand';
    console.error('Vormerkung nicht beansprucht:', error.message);
    return { fehler: error.message };
  }
  return (data ?? []).length === 1 ? 'ok' : 'vergeben';
}

/** Antwort auf ein misslungenes Beanspruchen */
function anspruchAbgelehnt(ergebnis: 'vergeben' | 'anderer_versand' | { fehler: string }): { fehler: string; status: number } {
  if (ergebnis === 'vergeben') return { fehler: 'Dieses Schreiben wird bereits versendet oder ist versendet. Es wurde nichts versendet.', status: 409 };
  if (ergebnis === 'anderer_versand') return { fehler: UNKLAR_MELDUNG, status: 409 };
  return { fehler: 'Die Mahnung konnte nicht versendet werden. Es wurde nichts versendet.', status: 500 };
}

/** Beanspruchung zuruecknehmen, wenn sicher nichts versendet bzw. gebucht wurde. */
async function anspruchFreigeben(client: Client, id: string): Promise<boolean> {
  const { data, error } = await client.from('mahnung_versand')
    .update({ status: 'vorgemerkt', versandart: null, versendet_am: null, zugang_am: null, mail_id: null, sendungsnummer: null })
    .eq('id', id)
    .eq('status', 'wird_versendet')
    .select('id');
  if (error) console.error('Vormerkung nicht freigegeben:', error.message);
  return !error && (data ?? []).length === 1;
}

/**
 * Versand abschliessen: 'wird_versendet' → 'versendet'. Trifft das keine Zeile, zaehlt es nur als
 * erledigt, wenn ein paralleler Aufruf sie schon abgeschlossen hat; sonst einmal wiederholen.
 */
async function protokollAbschliessen(client: Client, id: string, felder: Record<string, unknown>): Promise<boolean> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const { data, error } = await client.from('mahnung_versand')
      .update({ ...felder, status: 'versendet' })
      .eq('id', id)
      .eq('status', 'wird_versendet')
      .select('id');
    if (!error && (data ?? []).length === 1) return true;
    if (error) console.error('Versandprotokoll nicht abgeschlossen:', error.message);
    const { data: stand } = await client.from('mahnung_versand').select('status').eq('id', id).maybeSingle();
    if ((stand as { status?: string } | null)?.status === 'versendet') return true;
  }
  return false;
}

function generateMahnungHtml(data: MahnungEmailRequest, fristDatum: string | null): string {
  // Bei leerem Fristfeld kam null an -- die Mail nannte dann den heutigen Tag als Frist,
  // das PDF heute + 7 (27.10.2026). Gleiche Vorgabe wie im PDF.
  const fristTage = Number.isFinite(Number(data.zahlungsfristTage)) && Number(data.zahlungsfristTage) > 0
    ? Number(data.zahlungsfristTage)
    : 7;
  // Geprueftes Datum aus dem Schreiben; ohne (aeltere App-Fassung) wie bisher ab heute gerechnet
  const fristFormatted = fristDatum ? fristDatum.split('-').reverse().join('.') : berlinerTag(fristTage);
  const heute = berlinerTag(0);

  let eskalationsText = '';
  let headerColor = '#E67E22';
  switch (data.mahnstufe) {
    case 1:
      eskalationsText = 'Wir bitten Sie höflich, den ausstehenden Betrag bis zum genannten Datum zu begleichen. Sollte die Zahlung bereits unterwegs sein, betrachten Sie dieses Schreiben als gegenstandslos.';
      headerColor = '#E67E22';
      break;
    case 2:
      eskalationsText = 'Trotz unserer ersten Mahnung haben wir bislang keinen Zahlungseingang feststellen können. Wir fordern Sie daher nachdrücklich auf, den offenen Betrag umgehend zu begleichen. Sollten Sie nicht innerhalb der genannten Frist zahlen, behalten wir uns die Einleitung weiterer Maßnahmen vor.';
      headerColor = '#E74C3C';
      break;
    case 3:
    default:
      // Das beigefügte Schreiben spricht die fristlose Kündigung aus, und der Vertrag steht danach auf
      // „gekündigt“. Bis zum 27.10.2026 kündigte die Mail sie nur an („werden … kündigen“).
      eskalationsText = '<strong>Mit dem beigefügten Schreiben kündigen wir das Mietverhältnis fristlos.</strong> Bitte gleichen Sie den Gesamtbetrag dennoch innerhalb der genannten Frist aus und beachten Sie die im Schreiben genannte Räumungsfrist. Die entstehenden Kosten gehen zu Ihren Lasten.';
      headerColor = '#C0392B';
      break;
  }

  let forderungenRows = '';
  if (data.forderungen && data.forderungen.length > 0) {
    forderungenRows = data.forderungen.map(f => {
      const monat = new Date(f.sollmonat).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${monat}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${f.sollbetrag.toFixed(2)} €</td></tr>`;
    }).join('');
  }

  const logoUrl = 'https://dashboard.niimmo.de/nilimmo-logo.png';

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background-color:${headerColor};padding:24px 32px;text-align:center;">
  <img src="${logoUrl}" alt="NilImmo" height="40" style="margin-bottom:12px;display:inline-block;" />
  <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">${data.mahnstufe}. Mahnung — Mietrückstand</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;">Datum: ${heute}</p>
  <p style="margin:0 0 8px;font-size:15px;">Sehr geehrte/r <strong>${data.recipientName}</strong>,</p>
  <p style="margin:0 0 20px;font-size:15px;">bezüglich Ihres Mietvertrags für das Objekt <strong>${data.immobilieName}</strong>, ${data.immobilieAdresse}, besteht folgender Zahlungsrückstand:</p>
  ${forderungenRows ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #ddd;border-radius:4px;overflow:hidden;">
    <tr style="background-color:#f8f8f8;">
      <th style="padding:10px 12px;text-align:left;font-size:14px;border-bottom:2px solid #ddd;">Monat</th>
      <th style="padding:10px 12px;text-align:right;font-size:14px;border-bottom:2px solid #ddd;">Betrag</th>
    </tr>
    ${forderungenRows}
  </table>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background-color:#fdf2f0;border-radius:6px;padding:4px;">
    <tr><td style="padding:8px 16px;font-size:14px;">Mietrückstand</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.rueckstandBetrag.toFixed(2)} €</td></tr>
    <tr><td style="padding:8px 16px;font-size:14px;">Mahngebühren</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.mahngebuehren.toFixed(2)} €</td></tr>
    ${data.verzugszinsen > 0 ? `<tr><td style="padding:8px 16px;font-size:14px;">Verzugszinsen</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.verzugszinsen.toFixed(2)} €</td></tr>` : ''}
    ${data.zusaetzlicheKosten > 0 ? `<tr><td style="padding:8px 16px;font-size:14px;">Zusätzliche Kosten</td><td style="padding:8px 16px;text-align:right;font-size:14px;">${data.zusaetzlicheKosten.toFixed(2)} €</td></tr>` : ''}
    <tr style="border-top:2px solid ${headerColor};">
      <td style="padding:12px 16px;font-size:16px;font-weight:700;color:${headerColor};">Gesamtbetrag</td>
      <td style="padding:12px 16px;text-align:right;font-size:18px;font-weight:700;color:${headerColor};">${data.gesamtbetrag.toFixed(2)} €</td>
    </tr>
  </table>
  <div style="background-color:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin-bottom:20px;border-radius:0 4px 4px 0;">
    <p style="margin:0;font-size:14px;font-weight:600;">Bitte überweisen Sie den Gesamtbetrag von ${data.gesamtbetrag.toFixed(2)} € bis spätestens zum <strong>${fristFormatted}</strong>.</p>
  </div>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6;">${eskalationsText}</p>
  <p style="margin:0 0 8px;font-size:14px;">Das Mahnungsschreiben ist dieser E-Mail als PDF beigefügt.</p>
  <p style="margin:0 0 4px;font-size:14px;">Mit freundlichen Grüßen</p>
  <p style="margin:0 0 0;font-size:14px;font-weight:600;">Ihre Hausverwaltung — NilImmo</p>
</td></tr>
<tr><td style="background-color:#f8f8f8;padding:20px 32px;border-top:1px solid #eee;">
  <p style="margin:0 0 4px;font-size:11px;color:#888;text-align:center;">NilImmo Hausverwaltung</p>
  <p style="margin:0 0 4px;font-size:11px;color:#888;text-align:center;">Diese E-Mail wurde automatisch generiert. Bei Fragen wenden Sie sich bitte an Ihre Hausverwaltung.</p>
  <p style="margin:0;font-size:11px;color:#888;text-align:center;">Mahnstufe: ${data.mahnstufe} | Datum: ${heute}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Mail-Protokoll (21.09.2026) ───────────────────────────────────────────────
// Betreff und Text entstanden bisher nur hier und waren nach dem Versand weg.
// Jede Mail wird deshalb vor dem Versand gespeichert und danach auf `gesendet`
// oder `fehler` gesetzt. Scheitert das Protokollieren, wird trotzdem versendet:
// ein fehlendes Protokoll ist ärgerlich, eine nicht versendete Mail schlimmer.
async function mailVormerken(
  client: ReturnType<typeof createClient>,
  eintrag: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await client.from('mails').insert(eintrag).select('id').single();
    if (error) {
      console.error('[mails] Vormerken fehlgeschlagen:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (fehler) {
    console.error('[mails] Vormerken fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
    return null;
  }
}

/**
 * Seit 28.10.2026 mit Ergebnis und einer Wiederholung: Das Klaeren eines abgebrochenen Versands
 * ('freigeben') wertet mails.status aus. Ein still gescheitertes Update auf 'gesendet' liess eine
 * versendete Mail sonst als unklar erscheinen. Wirft nie.
 */
async function mailAbschliessen(
  client: ReturnType<typeof createClient>,
  id: string | null,
  status: 'gesendet' | 'fehler',
  fehlertext?: string,
): Promise<boolean> {
  if (!id) return false;
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const { data, error } = await client
        .from('mails')
        .update({
          status,
          gesendet_am: status === 'gesendet' ? new Date().toISOString() : null,
          fehler: fehlertext ?? null,
        })
        .eq('id', id)
        .select('id');
      if (!error && (data ?? []).length === 1) return true;
      console.error('[mails] Abschluss fehlgeschlagen:', error?.message ?? 'keine Zeile');
    } catch (fehler) {
      console.error('[mails] Abschluss fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
    }
  }
  return false;
}

/**
 * Unklarer Versandausgang (Zeitlimit, abgerissene Verbindung), 28.10.2026: Status bleibt 'entwurf',
 * nur der Fehlertext wird vermerkt. 'fehler' hiesse „sicher nicht versendet“ -- das stimmt hier nicht.
 * Wirft nie.
 */
async function mailUnklarVermerken(client: ReturnType<typeof createClient>, id: string | null, fehlertext: string): Promise<void> {
  if (!id) return;
  try {
    const { error } = await client
      .from('mails')
      .update({ fehler: `Versand unklar, möglicherweise zugestellt: ${fehlertext}` })
      .eq('id', id)
      .eq('status', 'entwurf');
    if (error) console.error('[mails] Vermerk fehlgeschlagen:', error.message);
  } catch (fehler) {
    console.error('[mails] Vermerk fehlgeschlagen:', fehler instanceof Error ? fehler.message : 'unbekannt');
  }
}

/** Grobe Klartextfassung des HTML-Briefs, damit das Protokoll lesbar ist. */
function htmlZuText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: authError } = await authClient.auth.getUser();
  // Beides pruefen: Ein fehlender Nutzer ohne Fehlerobjekt kam sonst durch.
  if (authError || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Diese Funktion verschickt Post an Mieter und aendert die Mahnstufe --
  // das ist Verwaltungsarbeit und keine Hausmeistertaetigkeit.
  const rollenClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: istAdmin, error: rolleError } = await rollenClient.rpc('is_admin', { _user_id: userData.user.id });
  if (rolleError || istAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const data: MahnungEmailRequest = await req.json();
    const antwort = (inhalt: Record<string, unknown>, status = 200) =>
      new Response(JSON.stringify(inhalt), { status, headers: { ...corsHeaders, ...ANTWORT_KOPF } });

    // Ohne das Feld: Mailversand wie bei aelteren App-Fassungen (28.10.2026)
    const versandart = data.versandart === undefined || data.versandart === null ? 'email' : data.versandart;
    if (versandart !== 'email' && versandart !== 'post' && versandart !== 'vormerken' && versandart !== 'freigeben') {
      return antwort({ error: 'Unbekannte Versandart. Es wurde nichts versendet.' }, 400);
    }
    // Keine Mieternamen, Mailadressen oder Betraege ins Protokoll -- nur IDs.
    console.log('Mahnung:', { mietvertragId: data.mietvertragId, versandart });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const nutzerId = userData.user.id;

    // Die Vertrags-ID geht in die Pfadpruefung unten ein und muss deshalb eine
    // UUID sein: Mit "x/../.." als ID haette die Praefixpruefung selbst auf
    // fremde Ordner gezeigt.
    if (typeof data.mietvertragId !== 'string' || !UUID.test(data.mietvertragId)) {
      return antwort({ error: 'mietvertragId fehlt oder ist ungültig' }, 400);
    }

    // Vormerken, Post und Freigeben gibt es nur zu einem gespeicherten Schreiben
    if (versandart !== 'email' && !data.pdfPath) {
      return antwort({ error: 'Das gespeicherte Schreiben fehlt. Es wurde nichts gebucht.' }, 400);
    }

    // Der Storage-Pfad kam ungeprueft aus dem Request und wurde mit
    // Service-Role geladen: Damit liess sich jede Datei des Buckets an eine
    // frei gewaehlte Adresse schicken. Er muss zu diesem Vertrag gehoeren.
    // Seit 17.10.2026 als Erlaubnisliste: Die Storage-URL wird vom URL-Parser
    // normalisiert, und der loest nicht nur "..", sondern auch "%2e%2e" und
    // ".%2E" auf -- "mahnungen/<id>/%2e%2e/%2e%2e/x" landete bei x. Nach dem
    // Praefix darf deshalb nur ein einzelner Dateiname ohne "%" und "/" stehen,
    // so wie ihn utils/storagePfad.ts baut.
    if (data.pdfPath && (typeof data.pdfPath !== 'string' || !mahnungsPdfErlaubt(data.pdfPath, data.mietvertragId))) {
      console.error('Pfad gehoert nicht zum Vertrag');
      return antwort({ error: 'Der Anhang gehört nicht zu diesem Mietvertrag.' }, 403);
    }
    const pdfPfad: string | null = data.pdfPath || null;
    const heuteIso = berlinerTag(0).split('.').reverse().join('-');

    // Vormerkung des Schreibens (28.10.2026): Beim Speichern legt 'vormerken' sie mit Stufe, Frist,
    // Kuendigungsfeldern und Betraegen an. Der Versand nimmt diese Werte, nicht die der Anfrage --
    // so laesst sich ein gespeichertes Schreiben auch spaeter versenden, und ein veralteter Dialog
    // kann keine andere Stufe oder Frist unterschieben.
    let vormerkung: Vormerkung | null = null;
    if (pdfPfad) {
      const { data: zeile, error: vormerkungFehler } = await supabase
        .from('mahnung_versand')
        .select(VORMERKUNG_SPALTEN)
        .eq('mietvertrag_id', data.mietvertragId)
        .eq('dokument_pfad', pdfPfad)
        .maybeSingle();
      if (vormerkungFehler) {
        console.error('Vormerkung nicht lesbar:', vormerkungFehler.message);
        return antwort({ error: 'Das gespeicherte Schreiben konnte nicht geprüft werden. Es wurde nichts versendet.' }, 500);
      }
      vormerkung = (zeile as Vormerkung | null) ?? null;
    }

    // Die Stufe in Schreiben und Mail rechnet die App aus dem Stand beim Oeffnen des Dialogs
    // (gespeicherte Stufe + 1). Hatte inzwischen jemand anders gemahnt, gingen Schreiben und
    // Mail mit der alten Stufe raus, waehrend der Vertrag eine Stufe weiter zaehlte; auf Stufe 3
    // kam eine "4. Mahnung" heraus (27.10.2026). Die Stufe muss zur gespeicherten passen --
    // beim Vormerken ebenso wie beim Versand.
    const { data: vertragVorher, error: vorherFehler } = await supabase
      .from('mietvertrag')
      .select('mahnstufe, status')
      .eq('id', data.mietvertragId)
      .maybeSingle();
    if (vorherFehler || !vertragVorher) {
      console.error('Mahnstufe nicht lesbar:', vorherFehler?.message ?? 'Vertrag nicht gefunden');
      return antwort({ error: 'Die Mahnstufe des Vertrags konnte nicht gelesen werden. Es wurde nichts versendet.' }, 500);
    }
    const bisherigeStufe = Number(vertragVorher.mahnstufe) || 0;
    const stufeVorher: number | null = vertragVorher.mahnstufe === null ? null : Number(vertragVorher.mahnstufe);

    // ── Freigeben: abgebrochenen Versand klaeren ──────────────────────────────
    if (versandart === 'freigeben') {
      const nichtVersendet = data.bestaetigtNichtVersendet === true;
      const versendet = data.bestaetigtVersendet === true;
      if (nichtVersendet && versendet) {
        return antwort({ error: 'Bitte entweder „versendet“ oder „nicht versendet“ bestätigen, nicht beides.' }, 400);
      }
      if (!vormerkung) return antwort({ error: 'Zu diesem Schreiben gibt es keine Vormerkung.' }, 404);
      if (vormerkung.status !== 'wird_versendet') return antwort({ success: true, ergebnis: vormerkung.status });
      if (Date.now() - Date.parse(vormerkung.aktualisiert_am) < HAENGT_NACH_MS) {
        return antwort({ error: 'Der Versand läuft möglicherweise noch. Bitte in 15 Minuten erneut prüfen.' }, 409);
      }
      const stufeSteht = bisherigeStufe === Number(vormerkung.stufe);

      // Post verschickt nichts: Steht die Stufe, ist gebucht und nur das Protokoll offen; sonst ist
      // nichts geschehen und die Vormerkung wird wieder frei. Die Bestaetigungen gelten nur fuer Mails.
      if (vormerkung.versandart === 'post') {
        if (nichtVersendet || versendet) {
          return antwort({ error: 'Die Bestätigung gilt nur für einen Mailversand. Eine Postbuchung wird über „Buchung klären“ abgeschlossen.' }, 400);
        }
        if (stufeSteht) {
          const fertig = await protokollAbschliessen(supabase, vormerkung.id, {});
          return fertig
            ? antwort({ success: true, ergebnis: 'abgeschlossen' })
            : antwort({ error: 'Das Versandprotokoll konnte nicht abgeschlossen werden.' }, 500);
        }
        const frei = await anspruchFreigeben(supabase, vormerkung.id);
        return frei
          ? antwort({ success: true, ergebnis: 'freigegeben' })
          : antwort({ error: 'Die Vormerkung konnte nicht freigegeben werden. Bitte den Dialog neu öffnen.' }, 409);
      }

      // Versand nachbuchen: Stufe aus der Vormerkung (wie beim Versand: nur von bisherigeStufe aus,
      // Kuendigung nur mit gueltigen Feldern, nur fuer einen laufenden Vertrag) und abschliessen.
      // mail_id bleibt, wie sie ist.
      const versandNachbuchen = async (zeitpunkt: Date, vonHand: boolean) => {
        const versandtag = berlinerIsoTag(zeitpunkt);
        const hinweise: string[] = [];
        if (!stufeSteht && bisherigeStufe === Number(vormerkung.stufe) - 1) {
          const k = vormerkung.kuendigung ? pruefeVorgemerkteKuendigung(vormerkung.kuendigung, heuteIso, heuteIso) : null;
          if (k && 'fehler' in k) {
            // Stufe 3 ohne gueltige Kuendigung nicht buchen (Review 28.10.2026): Stufe 3 ohne Status
            // waere der Zustand, den das Kuendigen im selben Update verhindern soll. Der Anspruch bleibt
            // zum Klaeren stehen.
            return antwort({
              error: `Kündigung nicht mehr gültig (${k.fehler}) – Vertrag bitte von Hand bearbeiten. Die Mahnstufe wurde nicht gebucht; der Versand bleibt zum Klären offen.`,
            }, 409);
          }
          const buchung = await bucheStufe(supabase, {
            mietvertragId: data.mietvertragId,
            stufeVorher,
            neueStufe: Number(vormerkung.stufe),
            zeitpunkte: { letzte_mahnung_am: zeitpunkt.toISOString(), naechste_mahnung_am: new Date(zeitpunkt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() },
            kuendigung: k,
          });
          if (!buchung.gespeichert) hinweise.push('Die Mahnstufe wurde nicht erhöht. Bitte die Stufe am Vertrag prüfen.');
        } else if (!stufeSteht) {
          hinweise.push(`Die Mail ist versendet, der Vertrag steht aber auf Mahnstufe ${bisherigeStufe}. Bitte die Stufe am Vertrag prüfen.`);
        }
        const fertig = await protokollAbschliessen(supabase, vormerkung.id, {
          versendet_am: versandtag,
          zugang_am: versandtag,
          ...(vonHand ? { von_hand_bestaetigt: true } : {}),
        });
        if (!fertig) hinweise.push('Das Versandprotokoll konnte nicht abgeschlossen werden.');
        await supabase.from('system_logs').insert({
          message: vonHand
            ? `Mahnung Stufe ${vormerkung.stufe} per E-Mail von Hand als versendet bestätigt (Mietvertrag ${data.mietvertragId}, Nutzer ${nutzerId}).`
            : `Mahnung Stufe ${vormerkung.stufe} per E-Mail nachgebucht, Mail laut Protokoll gesendet (Mietvertrag ${data.mietvertragId}).`,
        });
        return antwort({ success: true, ergebnis: 'abgeschlossen', vonHand, warnung: hinweise.length > 0 ? hinweise.join(' ') : null });
      };

      // E-Mail: Ob die Mail raus ist, belegt nur mails.status -- 'gesendet' steht dort erst nach
      // angenommenem Versand. Die Stufe allein genuegt nicht, sie kann durch ein anderes Schreiben
      // derselben Stufe gestiegen sein (Review 28.10.2026).
      let mail: { status?: string; gesendet_am?: string | null } | null = null;
      if (vormerkung.mail_id) {
        const { data: mailZeile, error: mailFehler } = await supabase.from('mails').select('status, gesendet_am').eq('id', vormerkung.mail_id).maybeSingle();
        if (mailFehler) {
          // Nie freigeben, wenn der Beleg nicht lesbar ist -- sonst droht ein Doppelversand
          console.error('Mailstatus nicht lesbar:', mailFehler.message);
          return antwort({ error: 'Der Versandstatus der Mail konnte nicht gelesen werden. Bitte manuell klären; es wurde nichts freigegeben.' }, 502);
        }
        mail = mailZeile as { status?: string; gesendet_am?: string | null } | null;
      }
      // Laut Protokoll versendet: nachbuchen, gleich welche Bestaetigung kam
      if (mail?.status === 'gesendet') {
        return await versandNachbuchen(mail.gesendet_am ? new Date(mail.gesendet_am) : new Date(), false);
      }
      // Von Hand als versendet bestaetigt (Postausgang geprueft), 28.10.2026: Selbstauskunft wie die
      // Postbuchung, nur fuer Admins (oben geprueft). Versandtag ist der Tag des Anspruchs; vermerkt in
      // von_hand_bestaetigt und system_logs mit Nutzer-ID.
      if (versendet) {
        return await versandNachbuchen(new Date(vormerkung.aktualisiert_am), true);
      }
      // Nicht nachweislich versendet (keine Mailzeile, 'entwurf' oder 'fehler'): nur nach ausdruecklicher
      // Bestaetigung im Dialog („Ich habe im Postausgang geprüft: nicht versendet“)
      if (!nichtVersendet) {
        return antwort({
          error: 'Ob die Mail versendet wurde, ist nicht belegt. Bitte im Postausgang prüfen und ausdrücklich bestätigen, ob sie versendet wurde oder nicht.',
          bestaetigungNoetig: true,
        }, 409);
      }
      const frei = await anspruchFreigeben(supabase, vormerkung.id);
      return frei
        ? antwort({ success: true, ergebnis: 'freigegeben' })
        : antwort({ error: 'Die Vormerkung konnte nicht freigegeben werden. Bitte den Dialog neu öffnen.' }, 409);
    }

    // Schon versendet: Wiederholung mit derselben Versandart (Doppelklick, Zeitlimit) ist ein Erfolg
    // ohne zweiten Versand; mit anderer Versandart ein Konflikt
    if (vormerkung?.status === 'versendet') {
      if (vormerkung.versandart === versandart) {
        return antwort({
          success: true,
          bereitsVersendet: true,
          message: 'Dieses Schreiben ist bereits versandt.',
          versandart,
          recipients: [],
          zugangAm: vormerkung.zugang_am,
          warnung: null,
          kuendigungGesetzt: vormerkung.kuendigung !== null && (vertragVorher.status === 'gekuendigt' || vertragVorher.status === 'beendet'),
        });
      }
      return antwort({ error: 'Dieses Schreiben ist bereits versandt. Es wurde nichts versendet.' }, 409);
    }
    // Wird gerade versendet oder ist abgebrochen: Nur eine Postbuchung setzt sich selbst fort (sie hat
    // nichts verschickt, ihre Werte stehen in der Zeile). Ein Mailversand ist zu klaeren ('freigeben').
    const fortsetzung = versandart === 'post' && vormerkung?.status === 'wird_versendet' && vormerkung.versandart === 'post';
    if (vormerkung?.status === 'wird_versendet' && !fortsetzung) {
      return antwort({ error: 'Dieses Schreiben wird bereits versendet, oder ein früherer Versand ist unklar. Bitte im Mail-Protokoll prüfen und den Versand im Mahnungsdialog klären. Es wurde nichts versendet.' }, 409);
    }
    // Post nur mit Vormerkung: Ohne Mail gibt es sonst keinen Beleg, welches Schreiben mit welcher Frist rausging
    if (versandart === 'post' && !vormerkung) {
      return antwort({ error: 'Das Schreiben ist nicht zum Versand vorgemerkt. Bitte das Schreiben neu speichern. Es wurde nichts gebucht.' }, 400);
    }
    // Ein ANDERES Schreiben desselben Vertrags ist beansprucht (Versand unklar oder laufend): erst klaeren
    // (Review 28.10.2026). Sonst ginge neben einer moeglicherweise zugestellten Mahnung eine zweite raus.
    // Fuer das Beanspruchen setzt das zusaetzlich der eindeutige Teilindex je Vertrag durch.
    const { data: beanspruchte, error: beanspruchtFehler } = await supabase
      .from('mahnung_versand')
      .select('id')
      .eq('mietvertrag_id', data.mietvertragId)
      .eq('status', 'wird_versendet')
      .limit(2);
    if (beanspruchtFehler) {
      console.error('Offene Versände nicht lesbar:', beanspruchtFehler.message);
      return antwort({ error: 'Offene Versände des Vertrags konnten nicht geprüft werden. Es wurde nichts versendet.' }, 500);
    }
    if ((beanspruchte ?? []).some((z: { id: string }) => z.id !== vormerkung?.id)) {
      return antwort({ error: UNKLAR_MELDUNG }, 409);
    }

    // Stufe aus der Vormerkung; beim Vormerken und bei aelteren App-Fassungen aus der Anfrage
    const ausVormerkung = vormerkung !== null && versandart !== 'vormerken';
    const stufe = ausVormerkung && vormerkung ? Number(vormerkung.stufe) : Number(data.mahnstufe);
    if (ausVormerkung && data.mahnstufe !== undefined && data.mahnstufe !== null && Number(data.mahnstufe) !== stufe) {
      return antwort({ error: 'Das gespeicherte Schreiben gehört zu einer anderen Mahnstufe. Bitte den Dialog neu öffnen. Es wurde nichts versendet.' }, 409);
    }
    if (!Number.isInteger(stufe) || stufe < 1 || stufe > 3) {
      return antwort({ error: 'Die Mahnstufe ist ungültig. Es wurde nichts versendet.' }, 400);
    }
    // Der Dateiname nennt die Stufe (schriftstueckPfad: Mahnung_Stufe<n>_…). Ein altes Schreiben
    // der Stufe 1 darf nicht als Stufe 2 versendet oder gebucht werden (28.10.2026).
    if (pdfPfad && !pdfPfad.slice(`mahnungen/${data.mietvertragId}/`.length).startsWith(`Mahnung_Stufe${stufe}_`)) {
      return antwort({ error: 'Das Schreiben gehört zu einer anderen Mahnstufe. Es wurde nichts versendet.' }, 409);
    }

    // Abgebrochene Postbuchung, deren Stufe schon steht: nur noch das Protokoll abschliessen
    if (fortsetzung && vormerkung && bisherigeStufe === stufe) {
      const fertig = await protokollAbschliessen(supabase, vormerkung.id, {});
      if (!fertig) {
        return antwort({ error: 'Die Mahnstufe ist gebucht, das Versandprotokoll konnte aber nicht abgeschlossen werden. Bitte erneut versuchen.' }, 500);
      }
      return antwort({
        success: true,
        bereitsVersendet: true,
        message: 'Die Postbuchung wurde abgeschlossen.',
        versandart: 'post',
        recipients: [],
        zugangAm: vormerkung.zugang_am,
        warnung: null,
        kuendigungGesetzt: vormerkung.kuendigung !== null,
      });
    }

    // Nur Mail: Empfaenger und Kopie. Die Adressen muessen an einem Mieter dieses Vertrags
    // hinterlegt sein, statt aus dem Request zu stammen.
    let empfaenger: string[] = [];
    let kopie: string[] = [];
    if (versandart === 'email') {
      const { data: vertragsMieter, error: mieterError } = await supabase
        .from('mietvertrag_mieter')
        .select('mieter(hauptmail, weitere_mails)')
        .eq('mietvertrag_id', data.mietvertragId);

      if (mieterError) {
        console.error('Mieter des Vertrags nicht lesbar');
        return antwort({ error: 'Empfänger konnte nicht geprüft werden.' }, 500);
      }

      const erlaubteAdressen = new Set<string>();
      for (const zeile of vertragsMieter ?? []) {
        const m = (zeile as Record<string, { hauptmail?: string | null; weitere_mails?: string | null }>).mieter;
        // Nur die zerlegten Adressen, wie mailadressenDerMieter() in der App sie zeigt (27./28.10.2026).
        // Der rohe hauptmail-Text gilt nicht mehr: „a@x.de, b@y.de“ ging sonst an beide.
        for (const teil of `${m?.hauptmail ?? ''} ${m?.weitere_mails ?? ''}`.split(/[,;\s<>]+/)) {
          const adresse = teil.trim().toLowerCase();
          if (MAILADRESSE.test(adresse) && !adresse.endsWith('.')) erlaubteAdressen.add(adresse);
        }
      }

      const geprueft = pruefeEmpfaenger(data.recipientEmails, data.recipientEmail, erlaubteAdressen);
      if (!Array.isArray(geprueft)) {
        if (geprueft.status === 403) console.error('Empfaenger gehoert nicht zum Vertrag');
        return antwort({ error: geprueft.fehler }, geprueft.status);
      }
      empfaenger = geprueft;

      // CC ist in der App bewusst ein freies Feld (Kopie ans eigene Postfach, an die Kanzlei).
      // Bis zum 27.10.2026 ging sein Inhalt ungeprueft in den Mailkopf; jetzt nur wohlgeformte
      // Adressen, hoechstens fuenf.
      kopie = Array.isArray(data.ccEmails)
        ? data.ccEmails.map((adresse) => String(adresse ?? '').trim()).filter(Boolean)
        : [];
      if (kopie.length > MAX_KOPIEN || kopie.some((adresse) => !MAILADRESSE.test(adresse))) {
        return antwort({ error: `Die CC-Adressen sind ungültig. Erlaubt sind höchstens ${MAX_KOPIEN} vollständige Mailadressen. Es wurde nichts versendet.` }, 400);
      }
    }

    if (bisherigeStufe >= 3) {
      return antwort({ error: 'Der Vertrag steht bereits auf Mahnstufe 3. Es wurde nichts versendet.' }, 409);
    }
    if (stufe !== bisherigeStufe + 1) {
      return antwort({ error: `Der Vertrag steht inzwischen auf Mahnstufe ${bisherigeStufe}. Bitte den Dialog neu öffnen, damit Schreiben und Mail die richtige Stufe nennen. Es wurde nichts versendet.` }, 409);
    }

    const fristRoh = ausVormerkung && vormerkung ? vormerkung.zahlungsfrist : data.fristDatum;
    if (versandart !== 'email' && (fristRoh === undefined || fristRoh === null)) {
      return antwort({ error: 'Die Zahlungsfrist des Schreibens fehlt. Es wurde nichts gebucht.' }, 400);
    }
    let fristDatum: string | null = null;
    if (fristRoh !== undefined && fristRoh !== null) {
      const geprueft = pruefeFristDatum(fristRoh, heuteIso);
      if (typeof geprueft !== 'string') {
        return antwort({ error: `${geprueft.fehler} Es wurde nichts versendet.` }, 400);
      }
      fristDatum = geprueft;
    }

    // Post: Aufgabetag, Zugang, Sendungsnummer -- bei der Fortsetzung die beim Beanspruchen gespeicherten
    let versendetAm = heuteIso;
    let zugangAm = heuteIso;
    let sendungsnummer: string | null = null;
    if (versandart === 'post' && vormerkung && fristDatum) {
      const aufgabe = pruefePostAufgabe(
        fortsetzung ? vormerkung.versendet_am : data.versendetAm,
        berlinerIsoTag(new Date(vormerkung.erstellt_am)),
        heuteIso,
        fristDatum,
        null,
      );
      if ('fehler' in aufgabe) return antwort({ error: `${aufgabe.fehler} Es wurde nichts gebucht.` }, 400);
      versendetAm = aufgabe.versendetAm;
      zugangAm = aufgabe.zugangAm;
      const nummer = pruefeSendungsnummer(fortsetzung ? vormerkung.sendungsnummer : data.sendungsnummer);
      if (nummer !== null && typeof nummer !== 'string') return antwort({ error: `${nummer.fehler} Es wurde nichts gebucht.` }, 400);
      sendungsnummer = nummer;
    }

    // Stufe 3 kuendigt fristlos: Status und Vertragsende vor dem Versand pruefen, gesetzt werden sie
    // mit der Stufe. Beim Vormerken (und bei aelteren App-Fassungen) gegen heute; beim Versand einer
    // Vormerkung gegen den Versandtag bzw. den Zugang (pruefeVorgemerkteKuendigung) -- so bleibt ein
    // gespeichertes Schreiben bis zum Raeumungsende versendbar. Ohne die Felder (aeltere App-Fassung)
    // bleibt es beim Setzen im Browser; Vormerken und Post verlangen sie.
    const kuendigungRoh = ausVormerkung && vormerkung ? vormerkung.kuendigung : data.kuendigung;
    if (stufe === 3 && versandart !== 'email' && (kuendigungRoh === undefined || kuendigungRoh === null)) {
      return antwort({ error: 'Die Felder der fristlosen Kündigung fehlen. Es wurde nichts gebucht.' }, 400);
    }
    let kuendigung: KuendigungsFelder | null = null;
    if (kuendigungRoh !== undefined && kuendigungRoh !== null) {
      const geprueft = stufe !== 3
        ? { fehler: 'Eine Kündigung gehört nur zur Mahnstufe 3.' }
        : ausVormerkung
          ? pruefeVorgemerkteKuendigung(kuendigungRoh, heuteIso, zugangAm)
          : pruefeKuendigungsfelder(kuendigungRoh, heuteIso);
      if ('fehler' in geprueft) {
        const abhilfe = ausVormerkung ? ' Bitte ein neues Schreiben erstellen.' : '';
        return antwort({ error: `${geprueft.fehler}${abhilfe} Es wurde nichts versendet.` }, 400);
      }
      // Ein beendeter Vertrag wuerde sonst auf 'gekuendigt' zurueckgeholt (Review 28.10.2026)
      if (vertragVorher.status !== 'aktiv' && vertragVorher.status !== 'gekuendigt') {
        return antwort({ error: 'Der Vertrag ist bereits beendet. Die Mahnung der Stufe 3 kündigt fristlos und kann deshalb nicht versendet werden. Es wurde nichts versendet.' }, 409);
      }
      kuendigung = geprueft;
    }

    // Vormerken, Post und Mail mit Vormerkung: Das Schreiben muss unter Dokumente liegen. Ohne Zeile
    // in dokumente ist es in der App unsichtbar, und versendet wuerde ein nicht nachvollziehbares Schreiben.
    let hochgeladenAm: string | null = null;
    if (versandart !== 'email' || vormerkung) {
      const { data: dokument, error: dokumentFehler } = await supabase
        .from('dokumente')
        .select('id, hochgeladen_am')
        .eq('mietvertrag_id', data.mietvertragId)
        .eq('pfad', pdfPfad)
        .eq('geloescht', false)
        .limit(1)
        .maybeSingle();
      if (dokumentFehler) {
        console.error('Dokumentzeile nicht lesbar:', dokumentFehler.message);
        return antwort({ error: 'Das Schreiben konnte nicht geprüft werden. Es wurde nichts versendet.' }, 500);
      }
      if (!dokument) {
        return antwort({ error: 'Das Schreiben liegt nicht unter Dokumente. Bitte das Schreiben neu speichern. Es wurde nichts versendet.' }, 409);
      }
      hochgeladenAm = (dokument as { hochgeladen_am?: string | null }).hochgeladen_am ?? null;
    }

    // ── Vormerken: Zeile anlegen, fertig ─────────────────────────────────────
    if (versandart === 'vormerken') {
      const betraege = pruefeBetraege(data.betraege);
      if ('fehler' in betraege) return antwort({ error: betraege.fehler }, 400);
      // Wiederholung (Zeitlimit, zweiter Klick): mit denselben Werten ein Erfolg -- der Dialog loescht dann nichts
      if (vormerkung) {
        return gleicheVormerkung(vormerkung, stufe, fristDatum, kuendigung, betraege)
          ? antwort({ success: true, vormerkungId: vormerkung.id, mahnstufe: stufe, bereitsVorgemerkt: true })
          : antwort({ error: 'Dieses Schreiben ist bereits mit anderen Werten vorgemerkt.' }, 409);
      }
      // Nur frisch gespeicherte Schreiben: Dokumentzeile und Datei hoechstens 30 Minuten alt. Das Alter
      // der Datei kommt aus dem Speicher (vom Server gesetzt), nicht aus einer Spalte, die der Client schreibt.
      const ordner = `mahnungen/${data.mietvertragId}`;
      const dateiname = (pdfPfad as string).slice(ordner.length + 1);
      const { data: dateien, error: listFehler } = await supabase.storage.from('dokumente').list(ordner, { search: dateiname, limit: 10 });
      const datei = (dateien ?? []).find((d: { name: string }) => d.name === dateiname) as { created_at?: string | null } | undefined;
      if (listFehler || !datei) {
        return antwort({ error: 'Das Schreiben liegt nicht im Speicher. Bitte das Schreiben neu speichern.' }, 409);
      }
      const zuAlt = (zeitpunkt: string | null | undefined) => {
        const ms = Date.parse(zeitpunkt ?? '');
        return !Number.isFinite(ms) || Date.now() - ms > MAX_ALTER_VORMERKUNG_MS;
      };
      if (zuAlt(datei.created_at) || zuAlt(hochgeladenAm)) {
        return antwort({ error: 'Vorgemerkt werden nur frisch gespeicherte Schreiben (höchstens 30 Minuten alt). Bitte das Schreiben neu speichern.' }, 409);
      }
      const { data: neu, error: anlegeFehler } = await supabase
        .from('mahnung_versand')
        .insert({
          mietvertrag_id: data.mietvertragId,
          stufe,
          status: 'vorgemerkt',
          dokument_pfad: pdfPfad,
          zahlungsfrist: fristDatum,
          kuendigung,
          betraege,
          erstellt_von: nutzerId,
        })
        .select('id')
        .single();
      if (anlegeFehler || !neu) {
        console.error('Vormerkung nicht angelegt:', anlegeFehler?.message ?? 'ohne Zeile');
        // 23505: Ein paralleler Aufruf hat dasselbe Schreiben gerade vorgemerkt -- mit gleichen Werten ein Erfolg
        if (anlegeFehler?.code === '23505') {
          const { data: parallel } = await supabase.from('mahnung_versand').select(VORMERKUNG_SPALTEN).eq('dokument_pfad', pdfPfad).maybeSingle();
          if (parallel && gleicheVormerkung(parallel as Vormerkung, stufe, fristDatum, kuendigung, betraege)) {
            return antwort({ success: true, vormerkungId: (parallel as Vormerkung).id, mahnstufe: stufe, bereitsVorgemerkt: true });
          }
          return antwort({ error: 'Dieses Schreiben ist bereits mit anderen Werten vorgemerkt.' }, 409);
        }
        return antwort({ error: 'Das Schreiben konnte nicht zum Versand vorgemerkt werden.' }, 500);
      }
      console.log('Mahnung vorgemerkt:', { mietvertragId: data.mietvertragId, mahnstufe: stufe });
      return antwort({ success: true, vormerkungId: (neu as { id: string }).id, mahnstufe: stufe });
    }

    // ── Post: beanspruchen, Stufe buchen, abschliessen ───────────────────────
    // Die Postbuchung verschickt nichts. Die Reihenfolge sorgt dafuer, dass eine gebuchte Stufe nie ohne
    // Protokoll stehen bleibt: Aufgabetag, Zugang und Sendungsnummer stehen schon beim Beanspruchen in
    // der Zeile; bricht der Aufruf danach ab, schliesst eine Wiederholung oder 'freigeben' ab.
    if (versandart === 'post' && vormerkung) {
      if (!fortsetzung) {
        const beansprucht = await vormerkungBeanspruchen(supabase, vormerkung.id, {
          versandart: 'post',
          versendet_am: versendetAm,
          zugang_am: zugangAm,
          sendungsnummer,
          erstellt_von: nutzerId,
        });
        if (beansprucht !== 'ok') {
          const abgelehnt = anspruchAbgelehnt(beansprucht);
          return antwort({ error: abgelehnt.fehler }, abgelehnt.status);
        }
      }
      const buchung = await bucheStufe(supabase, {
        mietvertragId: data.mietvertragId,
        stufeVorher,
        neueStufe: stufe,
        zeitpunkte: zeitpunkteFuer('post', versendetAm, zugangAm),
        kuendigung,
      });
      if (!buchung.gespeichert) {
        // Ein paralleler Aufruf derselben Buchung kann die Stufe schon gesetzt haben -- dann nur abschliessen
        const { data: jetzt, error: standFehler } = await supabase.from('mietvertrag').select('mahnstufe').eq('id', data.mietvertragId).maybeSingle();
        if (standFehler || !jetzt) {
          // Stand unbekannt: nicht freigeben -- die Stufe kann gebucht sein. Die Zeile bleibt beansprucht
          // und wird ueber den Dialog geklaert bzw. durch eine Wiederholung abgeschlossen (Review 28.10.2026)
          console.error('Stand nach gescheiterter Stufenbuchung nicht lesbar:', standFehler?.message ?? 'kein Vertrag');
          return antwort({ error: 'Der Stand des Vertrags ist unklar. Bitte die Mahnstufe prüfen und die Buchung im Mahnungsdialog wiederholen oder klären.' }, 502);
        }
        if (Number((jetzt as { mahnstufe?: number | null }).mahnstufe) !== stufe) {
          console.error('Mahnstufe nicht gespeichert:', buchung.fehler);
          await anspruchFreigeben(supabase, vormerkung.id);
          return antwort({ error: 'Die Mahnstufe wurde nicht erhöht: Stufe oder Status des Vertrags haben sich inzwischen geändert. Es wurde nichts gebucht. Bitte den Dialog neu öffnen.' }, 409);
        }
      }
      const fertig = await protokollAbschliessen(supabase, vormerkung.id, {});
      await supabase.from('system_logs').insert({
        message: `Mahnung Stufe ${stufe} per Post gebucht, aufgegeben am ${versendetAm} (Mietvertrag ${data.mietvertragId}).`,
      });
      console.log('Mahnung per Post gebucht:', { mietvertragId: data.mietvertragId, mahnstufe: stufe });
      return antwort({
        success: true,
        message: `Mahnung Stufe ${stufe} als per Post versandt gebucht`,
        versandart: 'post',
        recipients: [],
        zugangAm,
        warnung: fertig ? null : 'Die Mahnstufe ist gebucht, das Versandprotokoll aber noch nicht abgeschlossen. Bitte die Buchung erneut auslösen oder den Versand im Dialog klären.',
        kuendigungGesetzt: kuendigung !== null,
      });
    }

    // ── E-Mail: SMTP, Anhang, Versand ────────────────────────────────────────
    // SMTP config -- nur der Mailweg braucht sie; die Postbuchung geht auch ohne Postfach
    const smtpHost = Deno.env.get("MAHNUNG_SMTP_HOST") || Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("MAHNUNG_SMTP_PORT") || Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("MAHNUNG_SMTP_USER") || Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("MAHNUNG_SMTP_PASS") || Deno.env.get("SMTP_PASS");
    const smtpFromEmail = Deno.env.get("MAHNUNG_SMTP_FROM_EMAIL") || Deno.env.get("SMTP_FROM_EMAIL") || "mahnung@niimmo.de";
    const smtpFromName = Deno.env.get("MAHNUNG_SMTP_FROM_NAME") || Deno.env.get("SMTP_FROM_NAME") || "NiImmo Hausverwaltung";

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFromEmail) {
      console.error('SMTP-Konfiguration fuer Mahnungen unvollstaendig (MAHNUNG_SMTP_*)');
      return antwort({ success: false, error: 'Der Mailversand für Mahnungen ist nicht eingerichtet. Es wurde nichts versendet.' }, 500);
    }

    let pdfBuffer: Buffer | null = null;
    // Datum in deutscher Zeit; toISOString() lag zwischen 0 und 2 Uhr auf dem Vortag
    const pdfFilename = `Mahnung_Stufe${stufe}_${heuteIso}.pdf`;
    if (pdfPfad) {
      console.log('Loading PDF from storage:', pdfPfad);
      const { data: fileData, error: fileError } = await supabase.storage
        .from('dokumente')
        .download(pdfPfad);

      if (fileError) {
        // Frueher nur geloggt: Der Mieter bekam dann eine Mahnungs-Mail ohne
        // das Mahnschreiben, die Antwort meldete trotzdem Erfolg, und die
        // Mahnstufe stieg. Ohne Anhang wird nicht versendet.
        console.error('PDF download error:', fileError);
        return antwort({ error: 'Das Mahnschreiben konnte nicht geladen werden. Es wurde nichts versendet und die Mahnstufe nicht erhöht.' }, 502);
      } else if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
        console.log('PDF loaded successfully, size:', pdfBuffer.length);
      }
    }

    // Mit Vormerkung nennt die Mail Stufe und Betraege des gespeicherten Schreibens, nicht die
    // der Anfrage -- beim spaeteren Versand hat der Dialog die Betraege gar nicht mehr (28.10.2026)
    const gespeicherteBetraege = vormerkung?.betraege ? pruefeBetraege(vormerkung.betraege) : null;
    const inhalt: MahnungEmailRequest = gespeicherteBetraege && !('fehler' in gespeicherteBetraege)
      ? {
          ...data,
          mahnstufe: stufe,
          rueckstandBetrag: gespeicherteBetraege.gesamtRueckstand,
          mahngebuehren: gespeicherteBetraege.mahnkostenGesamt,
          verzugszinsen: gespeicherteBetraege.verzugszinsenGesamt,
          zusaetzlicheKosten: 0,
          gesamtbetrag: gespeicherteBetraege.gesamtRueckstand + gespeicherteBetraege.mahnkostenGesamt + gespeicherteBetraege.verzugszinsenGesamt,
          zahlungsfristTage: gespeicherteBetraege.zahlungsfristTage,
        }
      : { ...data, mahnstufe: stufe };

    // Generate HTML email
    const htmlBody = generateMahnungHtml(inhalt, fristDatum);
    const betreff = stufe === 3
      ? `${stufe}. und letzte Mahnung — Mietrückstand | ${data.immobilieName}`
      : `${stufe}. Mahnung — Mietrückstand | ${data.immobilieName}`;

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailOptions: any = {
      from: `${smtpFromName} <${smtpFromEmail}>`,
      // Nur die geprueften, einzelnen Adressen -- nie der Text aus der Anfrage
      to: empfaenger.join(', '),
      subject: betreff,
      html: htmlBody,
    };

    if (kopie.length > 0) {
      mailOptions.cc = kopie.join(', ');
    }

    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }];
    }

    // Vormerkung beanspruchen, erst jetzt: Alles Pruefbare ist geprueft. Ein zweiter Aufruf
    // (Doppelklick, zweiter Tab, Wiederholung nach Zeitlimit) findet sie nicht mehr 'vorgemerkt'
    // und versendet nicht doppelt (28.10.2026).
    if (vormerkung) {
      const beansprucht = await vormerkungBeanspruchen(supabase, vormerkung.id, { versandart: 'email', erstellt_von: nutzerId });
      if (beansprucht !== 'ok') {
        const abgelehnt = anspruchAbgelehnt(beansprucht);
        return antwort({ error: abgelehnt.fehler }, abgelehnt.status);
      }
    }

    // Zwischen Beanspruchen und Versand ist sicher nichts raus: Jeder Fehler hier gibt die Vormerkung
    // wieder frei (Review 28.10.2026). Mit Vormerkung wird nur versendet, wenn Mailprotokoll und
    // Verknuepfung stehen -- ohne sie liesse sich ein abgebrochener Versand spaeter nicht klaeren.
    // Aeltere App-Fassungen ohne Vormerkung versenden wie bisher auch ohne Protokoll.
    let mailId: string | null = null;
    try {
      mailId = await mailVormerken(supabase, {
        typ: 'mahnung',
        status: 'entwurf',
        betreff,
        text: htmlZuText(htmlBody),
        html: htmlBody,
        empfaenger,
        kopie,
        anhang_pfad: pdfPfad,
        anhang_name: pdfBuffer ? pdfFilename : null,
        mietvertrag_id: data.mietvertragId,
        erstellt_von: nutzerId,
        nutzlast: { mahnstufe: stufe, vormerkung_id: vormerkung?.id ?? null },
      });
      if (vormerkung) {
        if (!mailId) throw new Error('Mailprotokoll nicht angelegt');
        // Verknuepfung fuer das Klaeren eines abgebrochenen Versands (mails.status zeigt, ob er raus ist)
        const { data: verknuepft, error: verknuepfFehler } = await supabase
          .from('mahnung_versand')
          .update({ mail_id: mailId })
          .eq('id', vormerkung.id)
          .eq('status', 'wird_versendet')
          .select('id');
        if (verknuepfFehler || (verknuepft ?? []).length !== 1) {
          throw new Error(verknuepfFehler?.message ?? 'Vormerkung nicht mit dem Mailprotokoll verknuepft');
        }
      }
    } catch (vorVersand) {
      console.error('Vor dem Versand abgebrochen:', vorVersand instanceof Error ? vorVersand.message : 'unbekannt');
      if (mailId) await mailAbschliessen(supabase, mailId, 'fehler', 'Vor dem Versand abgebrochen, nicht versendet.');
      if (vormerkung) await anspruchFreigeben(supabase, vormerkung.id);
      return antwort({ error: 'Die Mahnung konnte nicht versendet werden: Das Mailprotokoll ließ sich nicht anlegen. Es wurde nichts versendet und die Mahnstufe nicht erhöht.' }, 500);
    }

    try {
      await transporter.sendMail(mailOptions);
    } catch (versandFehler) {
      const fehlertext = versandFehler instanceof Error ? versandFehler.message : 'Unbekannter Fehler';
      const sicherGescheitert = versandSicherGescheitert(versandFehler);
      // Nur ein sicheres Scheitern ist 'fehler'. Bei unklarem Ausgang kann die Mail zugestellt sein:
      // Sie bleibt 'entwurf' (mails kennt nur entwurf/gesendet/fehler) mit Vermerk (Review 28.10.2026).
      if (sicherGescheitert) {
        await mailAbschliessen(supabase, mailId, 'fehler', fehlertext);
      } else {
        await mailUnklarVermerken(supabase, mailId, fehlertext);
      }
      if (vormerkung) {
        if (sicherGescheitert) {
          // Sicher nicht angenommen: Die Vormerkung wird wieder frei und laesst sich erneut versenden
          await anspruchFreigeben(supabase, vormerkung.id);
        } else {
          // Unklar (Zeitlimit, abgerissene Verbindung): nicht freigeben, sonst droht ein Doppelversand
          console.error('Mailversand unklar:', versandFehler instanceof Error ? versandFehler.message : 'unbekannt');
          return antwort({ error: 'Der Mailversand brach ohne eindeutige Antwort des Mailservers ab. Die Mail wurde möglicherweise zugestellt. Bitte im Mail-Protokoll prüfen und den Versand im Mahnungsdialog klären. Die Mahnstufe wurde nicht erhöht.' }, 502);
        }
      }
      throw versandFehler;
    }

    // Ab hier ist die Mail angenommen. Der Rest laeuft IMMER durch -- Mailprotokoll, Stufe,
    // Versandprotokoll --, ein Fehler ist nur noch eine Warnung. Ein Abbruch liesse eine versendete
    // Mail als unklar stehen, und ein spaeteres Freigeben verschickte sie doppelt (Review 28.10.2026).
    const hinweise: string[] = [];
    try {
      if (mailId && !(await mailAbschliessen(supabase, mailId, 'gesendet'))) {
        hinweise.push('Die Mail ist versendet, das Mailprotokoll steht aber noch nicht auf „gesendet“.');
      }
    } catch (fehler) {
      console.error('Mailprotokoll nicht abgeschlossen:', fehler instanceof Error ? fehler.message : 'unbekannt');
      hinweise.push('Die Mail ist versendet, das Mailprotokoll steht aber noch nicht auf „gesendet“.');
    }

    // Erst nach erfolgreichem Versand: Die neue Mahnstufe kam frueher ungeprueft aus dem Request --
    // damit konnte jeder Aufrufer jeden Vertrag unmittelbar auf Stufe 3 setzen und die Regel umgehen,
    // dass die Stufe nur durch tatsaechlichen Versand steigt. Jetzt ist sie vorher gegen den
    // gespeicherten Stand geprueft (bisherigeStufe + 1).
    //
    // Das Schreiben wird geprueft (27.10.2026): Hat zwischen Pruefung und Versand jemand anders
    // gemahnt, trifft das Update keine Zeile. Die Mail ist an dieser Stelle schon raus -- deshalb
    // kein Fehler (ein Neuversuch verschickte sie doppelt), sondern eine Warnung, die der Dialog
    // sichtbar anzeigt.
    const neueMahnstufe = stufe;
    let gespeichert = false;
    try {
      const buchung = await bucheStufe(supabase, {
        mietvertragId: data.mietvertragId,
        stufeVorher,
        neueStufe: neueMahnstufe,
        zeitpunkte: zeitpunkteFuer('email', heuteIso, heuteIso),
        kuendigung,
      });
      gespeichert = buchung.gespeichert;
      if (!gespeichert) console.error('Mahnstufe nicht gespeichert:', buchung.fehler);
    } catch (fehler) {
      console.error('Mahnstufe nicht gespeichert:', fehler instanceof Error ? fehler.message : 'unbekannt');
    }
    if (!gespeichert) {
      // Den Status setzt dann die App nach (kuendigungGesetzt = false) und meldet selbst, falls das scheitert
      hinweise.push(`Die Mahnung ist versendet, die Mahnstufe wurde aber nicht auf ${neueMahnstufe} erhöht. Bitte die Stufe am Vertrag prüfen.`);
    }

    // Versandprotokoll (28.10.2026): Art, Tag, Zugang und Person. Die Mail ist raus -- ein fehlendes
    // Protokoll wird gemeldet, macht den Versand aber nicht rueckgaengig.
    try {
      if (vormerkung) {
        const fertig = await protokollAbschliessen(supabase, vormerkung.id, {
          versendet_am: heuteIso,
          zugang_am: heuteIso,
          mail_id: mailId,
          erstellt_von: nutzerId,
        });
        if (!fertig) hinweise.push('Die Mail ist versendet, das Versandprotokoll wurde aber nicht abgeschlossen.');
      } else {
        // Aeltere App-Fassung ohne Vormerkung: Zeile gleich als versendet
        const { error: protokollFehler } = await supabase.from('mahnung_versand').insert({
          mietvertrag_id: data.mietvertragId,
          stufe,
          status: 'versendet',
          herkunft: 'altclient',
          versandart: 'email',
          dokument_pfad: pdfPfad,
          zahlungsfrist: fristDatum,
          kuendigung,
          versendet_am: heuteIso,
          zugang_am: heuteIso,
          mail_id: mailId,
          erstellt_von: nutzerId,
        });
        if (protokollFehler) {
          console.error('Versandprotokoll nicht gespeichert:', protokollFehler.message);
          hinweise.push('Die Mail ist versendet, das Versandprotokoll wurde aber nicht gespeichert.');
        }
      }
    } catch (fehler) {
      console.error('Versandprotokoll nicht gespeichert:', fehler instanceof Error ? fehler.message : 'unbekannt');
      hinweise.push('Die Mail ist versendet, das Versandprotokoll wurde aber nicht gespeichert.');
    }

    console.log('Mahnung versendet:', { mietvertragId: data.mietvertragId, mahnstufe: neueMahnstufe });
    await supabase.from('system_logs').insert({
      message: `Mahnung Stufe ${neueMahnstufe} per E-Mail versendet (Mietvertrag ${data.mietvertragId}).`,
    });

    return antwort({
      success: true,
      message: `Mahnung Stufe ${stufe} erfolgreich per E-Mail versendet`,
      versandart: 'email',
      recipients: empfaenger,
      zugangAm: null,
      warnung: hinweise.length > 0 ? hinweise.join(' ') : null,
      // Die App setzt den Status nur noch selbst, wenn hier nicht true steht
      kuendigungGesetzt: kuendigung !== null && gespeichert,
    });

  } catch (error) {
    // Die Meldung des Mailservers (Host, Kennung, Antwortcode) bleibt im Protokoll und in der
    // Tabelle mails; an den Aufrufer ging sie bis zum 27.10.2026 roh zurueck.
    console.error('Error in send-mahnung function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Die Mahnung konnte nicht versendet werden. Die Mahnstufe wurde nicht erhöht; Einzelheiten stehen im Protokoll der Function.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
