// MCP-Werkzeuge zur Pflege von Mietern, Zählern und Objekten (16.11.2026).

import { DATUM_FELD, ID, objekt, TEXT } from '../eingabe.ts';
import { aendereZeile, ALLE, ergebnis, Fachfehler, genauEine, type Kontext, loescheZeile, NUR_ADMIN, schreibfehler, type Werkzeug } from '../werkzeug.ts';
import {
  EINHEIT_ZAEHLERARTEN,
  einheitZaehlerarten,
  HAUSANSCHLUSS_ZAEHLERARTEN,
  hausanschlussZaehlerarten,
  hausanschlussZweiterZaehler,
  type ObjektZaehlerKonfiguration,
  ZAEHLERART_BEZEICHNUNG,
} from '../../_shared/zaehlerarten.ts';

export const EINHEIT_ZAEHLER = ['strom', 'gas', 'kaltwasser', 'warmwasser'] as const;
export const OBJEKT_ZAEHLER = ['strom', 'gas', 'wasser'] as const;

// Wie send-mahnung: eine Adresse ohne Leerraum, Komma, Semikolon, spitze Klammern oder Anführungszeichen
const MAILADRESSE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

// ---------- reine Fachlogik (Vitest) ----------

export interface ZaehlerSpalten {
  stand: string;
  datum: string;
  nummer: string;
  /** zaehler_typ in zaehlerstand_historie */
  typ: string;
}

/** Spalten eines Zählers: an der Einheit `<art>_stand_aktuell`, am Objekt `allgemein_<art>_stand[_2]` (ZaehlerVerwaltung.tsx) */
export function zaehlerSpalten(ort: 'einheit' | 'objekt', art: string, satz: 1 | 2 = 1): ZaehlerSpalten {
  if (ort === 'einheit') {
    if (!(EINHEIT_ZAEHLER as readonly string[]).includes(art)) throw new Fachfehler(`Zähler an der Einheit: ${EINHEIT_ZAEHLER.join(', ')}`);
    if (satz !== 1) throw new Fachfehler('Einen zweiten Zählersatz gibt es nur am Objekt.');
    return { stand: `${art}_stand_aktuell`, datum: `${art}_stand_datum`, nummer: `${art}_zaehler`, typ: art };
  }
  if (!(OBJEKT_ZAEHLER as readonly string[]).includes(art)) throw new Fachfehler(`Hausanschlusszähler: ${OBJEKT_ZAEHLER.join(', ')}`);
  const n = satz === 2 ? '_2' : '';
  return { stand: `allgemein_${art}_stand${n}`, datum: `allgemein_${art}_datum${n}`, nummer: `allgemein_${art}_zaehler${n}`, typ: `${art}${n}` };
}

/**
 * Was eine Ablesung schreibt: Der aktuelle Stand am Stammsatz ändert sich nur, wenn es noch kein Datum gibt oder die
 * Ablesung nicht älter ist. Seit dem 26.11.2026 folgt er in der Datenbank ohnehin der jüngsten Ablesung der Historie
 * (Migration 20261126100000); derselbe Stand an einem späteren Tag ist deshalb ebenfalls eine Ablesung (Historie),
 * sonst legte der Trigger sie still an und die Antwort meldete „historie: false“.
 */
export function ablesungPlan(
  neu: { stand: number; datum: string },
  alt: { stand: number | null; datum: string | null },
): { stammsatz: 'stand_und_datum' | 'nur_datum' | 'nichts'; historie: boolean } {
  const gleicherStand = alt.stand !== null && Number(alt.stand) === neu.stand;
  const aktuell = !alt.datum || neu.datum >= alt.datum;
  if (gleicherStand) {
    const spaeter = !!alt.datum && neu.datum > alt.datum;
    return { stammsatz: spaeter ? 'nur_datum' : 'nichts', historie: spaeter };
  }
  return { stammsatz: aktuell ? 'stand_und_datum' : 'nichts', historie: true };
}

/**
 * Hat das Objekt diesen Zähler? Wie Zählerverwaltung und Hausmeister-Ansicht der App, die abgewählte Zählerarten gar
 * nicht erst anbieten (_shared/zaehlerarten.ts, seit 26.11.2026 auch hier).
 */
export function zaehlerVorhanden(
  ort: 'einheit' | 'objekt',
  art: string,
  satz: 1 | 2,
  konfig: ObjektZaehlerKonfiguration | null | undefined,
): boolean {
  if (ort === 'einheit') return (einheitZaehlerarten(konfig) as string[]).includes(art);
  return ((satz === 2 ? hausanschlussZweiterZaehler(konfig) : hausanschlussZaehlerarten(konfig)) as string[]).includes(art);
}

const ZAEHLERARTEN_SPALTEN = 'hat_wasser, hat_strom, hat_gas, zaehlerarten_einheiten, hausanschluss_zweiter_zaehler';

/** Bricht ab, wenn das Objekt diesen Zähler laut seinen Zählerarten nicht hat */
async function pruefeZaehlerart(ctx: Kontext, ort: { ort: 'einheit' | 'objekt'; id: string }, art: string, satz: 1 | 2): Promise<void> {
  let objektId: string | null = ort.ort === 'objekt' ? ort.id : null;
  if (ort.ort === 'einheit') {
    const einheit = genauEine<{ id: string; immobilie_id?: string | null }>(
      await ctx.db.from('einheiten').select('id, immobilie_id').eq('id', ort.id).maybeSingle(),
      'Einheit',
    );
    objektId = einheit.immobilie_id ?? null;
  }
  if (!objektId) return;
  const konfig = ergebnis<ObjektZaehlerKonfiguration | null>(
    await ctx.db.from('immobilien').select(`id, ${ZAEHLERARTEN_SPALTEN}`).eq('id', objektId).maybeSingle(),
    'Lesen: Objekt',
  );
  if (!konfig || zaehlerVorhanden(ort.ort, art, satz, konfig)) return;
  const was = ort.ort === 'einheit'
    ? `Die Einheiten dieses Objekts haben keinen ${ZAEHLERART_BEZEICHNUNG[art as keyof typeof ZAEHLERART_BEZEICHNUNG] ?? art}-Zähler`
    : `Das Objekt hat keinen ${satz === 2 ? 'zweiten ' : ''}${ZAEHLERART_BEZEICHNUNG[art as keyof typeof ZAEHLERART_BEZEICHNUNG] ?? art}-Hausanschlusszähler`;
  throw new Fachfehler(`${was} (Zählerarten am Objekt). Ist das falsch, zuerst zaehlerarten_festlegen.`);
}

/** Text der Eingabe getrimmt, leer wird null (useMietvertragMutations.ts:712: trim || null) */
const textOderNull = (wert: unknown): string | null => (typeof wert === 'string' ? wert.trim() || null : null);

export function mieterFelder(e: Record<string, unknown>): Record<string, string | null> {
  const zuordnung: Record<string, string> = {
    vorname: 'vorname',
    nachname: 'nachname',
    mail: 'hauptmail',
    weitere_mails: 'weitere_mails',
    telefon: 'telnr',
    strasse: 'strasse',
    hausnummer: 'hausnummer',
    plz: 'plz',
    ort: 'ort',
  };
  const felder: Record<string, string | null> = {};
  for (const [eingabe, spalte] of Object.entries(zuordnung)) {
    if (e[eingabe] === undefined || e[eingabe] === null) continue;
    felder[spalte] = textOderNull(e[eingabe]);
  }
  if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
  if (felder.hauptmail && !MAILADRESSE.test(felder.hauptmail)) throw new Fachfehler('Die Mailadresse ist ungültig.');
  if ('vorname' in felder && 'nachname' in felder && !felder.vorname && !felder.nachname) {
    throw new Fachfehler('Vor- und Nachname dürfen nicht beide leer sein.');
  }
  return felder;
}

// ---------- Werkzeuge ----------

const ZAEHLER_EINGABE = {
  einheit_id: ID('Zähler dieser Einheit'),
  objekt_id: ID('Hausanschlusszähler dieses Objekts'),
  zaehler: { type: 'string' as const, enum: ['strom', 'gas', 'kaltwasser', 'warmwasser', 'wasser'], description: 'Einheit: strom, gas, kaltwasser, warmwasser; Objekt: strom, gas, wasser' },
  satz: { type: 'integer' as const, enum: [1, 2], description: 'Nur am Objekt: erster oder zweiter Zählersatz (Standard 1)' },
};

function zaehlerOrt(e: Record<string, unknown>): { ort: 'einheit' | 'objekt'; id: string; tabelle: string } {
  if (!e.einheit_id === !e.objekt_id) throw new Fachfehler('Genau eines von einheit_id oder objekt_id angeben.');
  return e.einheit_id
    ? { ort: 'einheit', id: e.einheit_id as string, tabelle: 'einheiten' }
    : { ort: 'objekt', id: e.objekt_id as string, tabelle: 'immobilien' };
}

const zaehlerstandErfassen: Werkzeug = {
  name: 'zaehlerstand_erfassen',
  titel: 'Zählerstand erfassen',
  beschreibung:
    'Trägt eine Ablesung ein — an einer Einheit oder an einem Hausanschluss des Objekts — wie die Zählerverwaltung der App: ' +
    'neuer Eintrag in der Historie, aktueller Stand nur, wenn die Ablesung nicht älter ist als der bisherige. Ohne Datum gilt ' +
    'heute. Ein- und Auszugsstände eines Vertrags erfasst die Übergabe in der App.',
  eingabe: objekt({
    ...ZAEHLER_EINGABE,
    stand: { type: 'number', minimum: 0, maximum: 100_000_000, description: 'Abgelesener Stand' },
    datum: DATUM_FELD('Tag der Ablesung (Standard heute, nicht in der Zukunft)'),
  }, ['zaehler', 'stand']),
  rollen: ALLE,
  schreibt: true,
  async ausfuehren(e, ctx: Kontext) {
    const ort = zaehlerOrt(e);
    const spalten = zaehlerSpalten(ort.ort, e.zaehler as string, ((e.satz as number | undefined) ?? 1) as 1 | 2);
    const datum = (e.datum as string | undefined) ?? ctx.heute;
    if (datum > ctx.heute) throw new Fachfehler('Das Ablesedatum liegt in der Zukunft.');
    await pruefeZaehlerart(ctx, ort, e.zaehler as string, ((e.satz as number | undefined) ?? 1) as 1 | 2);
    const alt = genauEine<Record<string, unknown> & { id: string }>(
      await ctx.db.from(ort.tabelle).select(`id, ${spalten.stand}, ${spalten.datum}, ${spalten.nummer}`).eq('id', ort.id).maybeSingle(),
      ort.ort === 'einheit' ? 'Einheit' : 'Objekt',
    );
    const altStand = alt[spalten.stand] == null ? null : Number(alt[spalten.stand]);
    const altDatum = (alt[spalten.datum] as string | null) ?? null;
    const stand = e.stand as number;
    const plan = ablesungPlan({ stand, datum }, { stand: altStand, datum: altDatum });

    // Erst die Historie, dann der Stammsatz: Scheitert der zweite Schritt, ist die Ablesung trotzdem belegt
    // (die App schreibt umgekehrt; ohne Transaktion ist so die bessere Hälfte gesichert, Review 16.11.2026)
    if (plan.historie) {
      const { error } = await ctx.db.from('zaehlerstand_historie').insert({
        ...(ort.ort === 'einheit' ? { einheit_id: ort.id } : { immobilie_id: ort.id }),
        zaehler_typ: spalten.typ,
        zaehler_nummer: (alt[spalten.nummer] as string | null) ?? null,
        stand,
        datum,
        quelle: 'manuell',
        erstellt_von: ctx.benutzerId,
      });
      if (error) throw schreibfehler(error, 'Historie speichern');
    }
    // Nur Zählerspalten — RLS ließe den Hausmeister jede Spalte der Einheit ändern
    if (plan.stammsatz === 'stand_und_datum') {
      await aendereZeile(ctx, ort.tabelle, ort.id, { [spalten.stand]: stand, [spalten.datum]: datum }, 'Zählerstand speichern');
    } else if (plan.stammsatz === 'nur_datum') {
      await aendereZeile(ctx, ort.tabelle, ort.id, { [spalten.datum]: datum }, 'Ablesedatum speichern');
    }
    const hinweis = altStand !== null && altDatum && datum >= altDatum && stand < altStand
      ? `Der Stand ist kleiner als der bisherige (${altStand} am ${altDatum}). Zählerwechsel oder Tippfehler?`
      : plan.stammsatz === 'nichts' && plan.historie
        ? `Nur in die Historie: Der aktuelle Stand (${altStand} am ${altDatum}) ist neuer.`
        : !plan.historie && plan.stammsatz === 'nichts' ? 'Unverändert: Dieser Stand ist schon erfasst.' : undefined;
    return {
      ok: true, zaehler: spalten.typ, stand, datum, aktueller_stand_geaendert: plan.stammsatz !== 'nichts', historie: plan.historie, hinweis,
      vorher: { stand: altStand, datum: altDatum },
    };
  },
};

const zaehlernummerAendern: Werkzeug = {
  name: 'zaehlernummer_aendern',
  titel: 'Zählernummer ändern',
  beschreibung: 'Setzt die Nummer eines Zählers an einer Einheit oder einem Hausanschluss (leerer Text löscht sie), z. B. nach einem Zählerwechsel.',
  eingabe: objekt({ ...ZAEHLER_EINGABE, nummer: TEXT('Neue Zählernummer; leer zum Löschen', 80) }, ['zaehler', 'nummer']),
  rollen: ALLE,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const ort = zaehlerOrt(e);
    const spalten = zaehlerSpalten(ort.ort, e.zaehler as string, ((e.satz as number | undefined) ?? 1) as 1 | 2);
    const nummer = textOderNull(e.nummer);
    await pruefeZaehlerart(ctx, ort, e.zaehler as string, ((e.satz as number | undefined) ?? 1) as 1 | 2);
    // useMietvertragMutations.ts:471 (trim || null); eine neue Nummer allein erzeugt keine Historie
    await aendereZeile(ctx, ort.tabelle, ort.id, { [spalten.nummer]: nummer }, 'Zählernummer ändern');
    return { ok: true, zaehler: spalten.typ, nummer };
  },
};

const mieterAendern: Werkzeug = {
  name: 'mieter_aendern',
  titel: 'Mieter-Stammdaten ändern',
  beschreibung: 'Ändert Name, Mail, Telefon oder Anschrift eines Mieters. Nur die angegebenen Felder; leerer Text löscht ein Feld.',
  eingabe: objekt({
    mieter_id: ID('ID des Mieters'),
    vorname: TEXT('Vorname', 120),
    nachname: TEXT('Nachname', 120),
    mail: TEXT('Haupt-Mailadresse (für Mahnungen und Schreiben)', 200),
    weitere_mails: TEXT('Weitere Mailadressen', 500),
    telefon: TEXT('Telefonnummer', 80),
    strasse: TEXT('Straße', 200),
    hausnummer: TEXT('Hausnummer', 20),
    plz: TEXT('Postleitzahl', 10),
    ort: TEXT('Ort', 120),
  }, ['mieter_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const felder = mieterFelder(e);
    // useMietvertragMutations.ts:712 (finishGlobalSave), MietvertragErstellungModal.tsx:385 (Anschrift)
    await aendereZeile(ctx, 'mieter', e.mieter_id as string, felder, 'Mieter ändern');
    return { ok: true, mieter_id: e.mieter_id, geaendert: Object.keys(felder) };
  },
};

const mieterLoeschen: Werkzeug = {
  name: 'mieter_loeschen',
  titel: 'Mieter ohne Vertrag löschen',
  beschreibung:
    'Löscht Mieter, die an keinem Vertrag, keinem offenen Vermietungsentwurf und keiner WhatsApp-Nachricht hängen. Die ' +
    'Datenbank behält alle anderen und nennt den Grund.',
  eingabe: objekt({
    mieter_ids: { type: 'array', items: ID('ID eines Mieters'), minItems: 1, maxItems: 20, description: 'IDs der Mieter' },
  }, ['mieter_ids']),
  rollen: NUR_ADMIN,
  schreibt: true,
  zerstoerend: true,
  async ausfuehren(e, ctx) {
    // services/mieterOhneVertragService.ts:25
    const { data, error } = await ctx.db.rpc('loesche_mieter_ohne_vertrag', { p_mieter_ids: e.mieter_ids });
    if (error) throw schreibfehler(error, 'Mieter löschen');
    return { ok: true, geloescht: data?.geloescht ?? [], behalten: data?.behalten ?? [] };
  },
};

const objektMarktSetzen: Werkzeug = {
  name: 'objekt_angespannter_markt_setzen',
  titel: 'Angespannten Wohnungsmarkt kennzeichnen',
  beschreibung:
    'Setzt die Kennzeichnung „angespannter Wohnungsmarkt“ eines Objekts. Sie steuert Kappungsgrenze (15 % statt 20 %) und ' +
    'Mietpreisbremse in Mieterhöhung und Vertrag.',
  eingabe: objekt({ objekt_id: ID('ID des Objekts'), angespannt: { type: 'boolean', description: 'true = angespannter Markt' } }, [
    'objekt_id',
    'angespannt',
  ]),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const alt = genauEine<{ id: string; name: string | null; ist_angespannt: boolean | null }>(
      await ctx.db.from('immobilien').select('id, name, ist_angespannt').eq('id', e.objekt_id).maybeSingle(),
      'Objekt',
    );
    // ImmobilienDetail.tsx:283. Nie `ort` mitschicken: Der Trigger immobilien_angespannter_markt setzt den Schalter sonst neu.
    await aendereZeile(ctx, 'immobilien', alt.id, { ist_angespannt: e.angespannt }, 'Kennzeichnung ändern');
    return { ok: true, objekt_id: alt.id, vorher: Boolean(alt.ist_angespannt), angespannt: e.angespannt };
  },
};

// ---------- Zählerarten und Ablesungen (26.11.2026) ----------

const ARTEN_LISTE = (arten: readonly string[], description: string) => ({
  type: 'array' as const,
  items: { type: 'string' as const, enum: arten },
  maxItems: arten.length,
  description,
});

const zaehlerartenFestlegen: Werkzeug = {
  name: 'zaehlerarten_festlegen',
  titel: 'Zählerarten eines Objekts festlegen',
  beschreibung:
    'Legt fest, welche Zähler ein Objekt hat — wie die Auswahl „Zählerarten“ der App: Hausanschluss (wasser, strom, gas), ' +
    'Hausanschlüsse mit zweitem Zähler und die Zählerarten der Einheiten (kaltwasser, warmwasser, strom, gas). Nur ' +
    'angegebene Listen ändern sich; eine Liste nennt alle Arten, die vorhanden sind. Abgewählte Zähler erscheinen nicht ' +
    'mehr in Zählerliste, Objektübersicht und Vertragsansicht; gespeicherte Stände bleiben erhalten.',
  eingabe: objekt({
    objekt_id: ID('ID des Objekts'),
    hausanschluss: ARTEN_LISTE(HAUSANSCHLUSS_ZAEHLERARTEN, 'Hausanschlüsse mit Zähler, z. B. ["wasser", "strom"]'),
    zweiter_zaehler: ARTEN_LISTE(HAUSANSCHLUSS_ZAEHLERARTEN, 'Hausanschlüsse mit zweitem Zähler, z. B. ["wasser"]'),
    einheiten: ARTEN_LISTE(EINHEIT_ZAEHLERARTEN, 'Zähler der Einheiten, z. B. ["kaltwasser", "strom", "gas"]'),
  }, ['objekt_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    // ZaehlerartenAuswahl.tsx:58 (speichere)
    const alt = genauEine<ObjektZaehlerKonfiguration & { id: string; name: string | null }>(
      await ctx.db.from('immobilien').select(`id, name, ${ZAEHLERARTEN_SPALTEN}`).eq('id', e.objekt_id).maybeSingle(),
      'Objekt',
    );
    const felder = zaehlerartenFelder(e);
    if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
    await aendereZeile(ctx, 'immobilien', alt.id, felder, 'Zählerarten speichern');
    const neu = { ...alt, ...felder } as ObjektZaehlerKonfiguration;
    const beschreibe = (k: ObjektZaehlerKonfiguration) => ({
      hausanschluss: hausanschlussZaehlerarten(k),
      zweiter_zaehler: hausanschlussZweiterZaehler(k),
      einheiten: einheitZaehlerarten(k),
    });
    // Ein zweiter Zähler gilt nur mit erstem — angefragt oder bisher vorhanden, jetzt aber ohne ersten (Review 26.11.2026)
    const ersteNeu = hausanschlussZaehlerarten(neu) as string[];
    const ohneErsten = [...new Set([
      ...(Array.isArray(e.zweiter_zaehler) ? e.zweiter_zaehler as string[] : []),
      ...(hausanschlussZweiterZaehler(alt) as string[]),
    ])].filter((art) => !ersteNeu.includes(art) && (neu.hausanschluss_zweiter_zaehler ?? []).includes(art));
    const hinweise = [
      ohneErsten.length > 0 ? `Ein zweiter Zähler gilt nur mit erstem: ${ohneErsten.join(', ')} hat keinen Hausanschlusszähler.` : null,
      Array.isArray(e.einheiten) && einheitZaehlerarten(neu).length === 0 ? 'Die Einheiten haben jetzt keine Zähler mehr.' : null,
    ].filter(Boolean);
    return {
      ok: true,
      objekt_id: alt.id,
      vorher: beschreibe(alt),
      nachher: beschreibe(neu),
      hinweis: hinweise.length > 0 ? hinweise.join(' ') : undefined,
    };
  },
};

/** Spalten zu den angegebenen Listen (reine Fachlogik, Vitest) */
export function zaehlerartenFelder(e: Record<string, unknown>): Record<string, unknown> {
  const liste = (wert: unknown) => (Array.isArray(wert) ? (wert as string[]) : null);
  const felder: Record<string, unknown> = {};
  const hausanschluss = liste(e.hausanschluss);
  if (hausanschluss) for (const art of HAUSANSCHLUSS_ZAEHLERARTEN) felder[`hat_${art}`] = hausanschluss.includes(art);
  const zweiter = liste(e.zweiter_zaehler);
  if (zweiter) felder.hausanschluss_zweiter_zaehler = HAUSANSCHLUSS_ZAEHLERARTEN.filter((art) => zweiter.includes(art));
  const einheiten = liste(e.einheiten);
  if (einheiten) felder.zaehlerarten_einheiten = EINHEIT_ZAEHLERARTEN.filter((art) => einheiten.includes(art));
  return felder;
}

type AblesungZeile = {
  id: string;
  einheit_id: string | null;
  immobilie_id: string | null;
  zaehler_typ: string;
  zaehler_nummer: string | null;
  stand: number | null;
  datum: string;
  quelle: string | null;
};

const ABLESUNG_SPALTEN = 'id, einheit_id, immobilie_id, zaehler_typ, zaehler_nummer, stand, datum, quelle';

/** Der aktuelle Stand nach einer Änderung — die Datenbank zieht ihn aus der Historie nach (Migration 20261126100000) */
async function aktuellerStand(ctx: Kontext, a: AblesungZeile) {
  const einheit = !!a.einheit_id;
  const art = a.zaehler_typ.replace('_2', '');
  const satz: 1 | 2 = a.zaehler_typ.endsWith('_2') ? 2 : 1;
  let spalten: ZaehlerSpalten;
  try {
    spalten = zaehlerSpalten(einheit ? 'einheit' : 'objekt', art, satz);
  } catch {
    return null;
  }
  const zeile = ergebnis<Record<string, unknown> | null>(
    await ctx.db.from(einheit ? 'einheiten' : 'immobilien').select(`id, ${spalten.stand}, ${spalten.datum}`)
      .eq('id', einheit ? a.einheit_id : a.immobilie_id).maybeSingle(),
    'Lesen: aktueller Stand',
  );
  return zeile ? { stand: zeile[spalten.stand] ?? null, datum: zeile[spalten.datum] ?? null } : null;
}

const ablesungKorrigieren: Werkzeug = {
  name: 'ablesung_korrigieren',
  titel: 'Ablesung korrigieren',
  beschreibung:
    'Korrigiert eine Ablesung der Historie (ID aus zaehlerstaende_anzeigen): Stand, Datum oder Zählernummer — wie die ' +
    'Historie in der App. Der aktuelle Stand folgt danach immer der jüngsten Ablesung; die Antwort nennt ihn.',
  eingabe: objekt({
    ablesung_id: ID('ID der Ablesung'),
    stand: { type: 'number', minimum: 0, maximum: 100_000_000, description: 'Richtiger Stand' },
    datum: DATUM_FELD('Richtiger Tag der Ablesung (nicht in der Zukunft)'),
    zaehlernummer: TEXT('Richtige Zählernummer; leer zum Löschen', 80),
  }, ['ablesung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    // ZaehlerHistorie.tsx (updateMutation)
    const alt = genauEine<AblesungZeile>(
      await ctx.db.from('zaehlerstand_historie').select(ABLESUNG_SPALTEN).eq('id', e.ablesung_id).maybeSingle(),
      'Ablesung',
    );
    const felder: Record<string, unknown> = {};
    if (typeof e.stand === 'number') felder.stand = e.stand;
    if (typeof e.datum === 'string') {
      if (e.datum > ctx.heute) throw new Fachfehler('Das Ablesedatum liegt in der Zukunft.');
      felder.datum = e.datum;
    }
    if (e.zaehlernummer !== undefined) felder.zaehler_nummer = textOderNull(e.zaehlernummer);
    if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
    await aendereZeile(ctx, 'zaehlerstand_historie', alt.id, felder, 'Ablesung korrigieren');
    return {
      ok: true,
      ablesung_id: alt.id,
      zaehler: alt.zaehler_typ,
      vorher: { stand: alt.stand, datum: alt.datum, zaehlernummer: alt.zaehler_nummer },
      aktueller_stand: await aktuellerStand(ctx, alt),
    };
  },
};

const ablesungLoeschen: Werkzeug = {
  name: 'ablesung_loeschen',
  titel: 'Ablesung löschen',
  beschreibung:
    'Löscht eine falsche Ablesung aus der Historie (ID aus zaehlerstaende_anzeigen) — wie die Historie in der App. Der ' +
    'aktuelle Stand fällt dann auf die nächstjüngere Ablesung zurück; die Antwort nennt ihn.',
  eingabe: objekt({ ablesung_id: ID('ID der Ablesung') }, ['ablesung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  zerstoerend: true,
  async ausfuehren(e, ctx) {
    // ZaehlerHistorie.tsx (deleteMutation)
    const alt = genauEine<AblesungZeile>(
      await ctx.db.from('zaehlerstand_historie').select(ABLESUNG_SPALTEN).eq('id', e.ablesung_id).maybeSingle(),
      'Ablesung',
    );
    await loescheZeile(ctx, 'zaehlerstand_historie', alt.id, 'Ablesung löschen');
    return {
      ok: true,
      zaehler: alt.zaehler_typ,
      vorher: { stand: alt.stand, datum: alt.datum, quelle: alt.quelle },
      aktueller_stand: await aktuellerStand(ctx, alt),
    };
  },
};

export const PFLEGE_WERKZEUGE: readonly Werkzeug[] = [
  zaehlerstandErfassen,
  zaehlernummerAendern,
  mieterAendern,
  mieterLoeschen,
  objektMarktSetzen,
  zaehlerartenFestlegen,
  ablesungKorrigieren,
  ablesungLoeschen,
];
