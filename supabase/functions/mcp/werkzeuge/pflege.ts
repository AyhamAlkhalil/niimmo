// MCP-Werkzeuge zur Pflege von Mietern, Zählern und Objekten (16.11.2026).

import { DATUM_FELD, ID, objekt, TEXT } from '../eingabe.ts';
import { aendereZeile, ALLE, Fachfehler, genauEine, type Kontext, NUR_ADMIN, schreibfehler, type Werkzeug } from '../werkzeug.ts';

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
 * Was eine Ablesung schreibt (ZaehlerVerwaltung.tsx:219, saveUnitDraft): Der aktuelle Stand am Stammsatz ändert sich nur,
 * wenn es noch kein Datum gibt oder die Ablesung nicht älter ist; eine Historienzeile entsteht nur bei geändertem Stand.
 * Ist nur das Datum neuer, rückt nur das Datum nach.
 */
export function ablesungPlan(
  neu: { stand: number; datum: string },
  alt: { stand: number | null; datum: string | null },
): { stammsatz: 'stand_und_datum' | 'nur_datum' | 'nichts'; historie: boolean } {
  const gleicherStand = alt.stand !== null && Number(alt.stand) === neu.stand;
  const aktuell = !alt.datum || neu.datum >= alt.datum;
  if (gleicherStand) return { stammsatz: alt.datum && neu.datum > alt.datum ? 'nur_datum' : 'nichts', historie: false };
  return { stammsatz: aktuell ? 'stand_und_datum' : 'nichts', historie: true };
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

export const PFLEGE_WERKZEUGE: readonly Werkzeug[] = [
  zaehlerstandErfassen,
  zaehlernummerAendern,
  mieterAendern,
  mieterLoeschen,
  objektMarktSetzen,
];
