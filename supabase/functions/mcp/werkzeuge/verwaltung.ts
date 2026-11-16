// MCP-Werkzeuge für Aufgaben, Versicherungen, Darlehen und Dokumente (16.11.2026).

import { darlehenStand, summiereDarlehen } from '../../_shared/darlehen.ts';
import { ANZAHL, BETRAG, DATUM_FELD, ID, objekt, TEXT } from '../eingabe.ts';
import { IMMOBILIE_SPALTEN, type ImmobilieZeile, nachId, objektName } from '../daten.ts';
import {
  aendereZeile,
  cent,
  ergebnis,
  Fachfehler,
  genauEine,
  loescheZeile,
  NUR_ADMIN,
  schreibfehler,
  type Werkzeug,
} from '../werkzeug.ts';

// Werte wie in src/components/aufgaben/aufgabenDarstellung.ts (die Datei lädt lucide-react und läuft nicht in Deno);
// src/utils/mcp/werkzeuge.test.ts prüft, dass beide Listen gleich bleiben. Nur `quelle` hat einen CHECK in der DB.
export const AUFGABEN_STATUS = ['offen', 'geplant', 'in_entwicklung', 'in_testing', 'fertig'] as const;
export const AUFGABEN_PRIORITAET = ['kritisch', 'hoch', 'mittel', 'niedrig'] as const;
export const AUFGABEN_TYP = ['bug', 'aufgabe', 'feature'] as const;

export const DOKUMENT_KATEGORIEN = [
  'Mietvertrag', 'Kündigung', 'Übergabeprotokoll', 'Sonstiges', 'Mieterunterlagen', 'Schriftverkehr', 'Versicherungen',
  'Betriebskostenabrechnung', 'Kaufvertrag', 'Grundbuchauszug', 'Energieausweis', 'Rechnung',
] as const;

/** Dauer eines Download-Links: kurz, weil er im Chatverlauf steht */
const LINK_SEKUNDEN = 600;

/**
 * Kategorien ohne Download-Link über MCP: Mieterunterlagen enthalten Ausweiskopien, Gehaltsnachweise und Bankdaten —
 * genau das, was der Server auch in mieter_anzeigen nicht herausgibt (docs/architektur.md §7). Öffnen nur in der App.
 */
export const OHNE_LINK = ['Mieterunterlagen'] as const;

// ---------- reine Fachlogik (Vitest) ----------

export interface DarlehenAenderung {
  restschuld?: number | null;
  restschuld_stichtag?: string | null;
  ende_datum?: string | null;
}

/**
 * Prüfungen der Darlehensverwaltung (DarlehenVerwaltung.tsx:357): Restschuld nur mit Stichtag, Stichtag nicht in der
 * Zukunft, Laufzeitende nicht vor dem Stichtag. `alt` ist der gespeicherte Stand.
 */
export function pruefeDarlehen(neu: DarlehenAenderung, alt: { restschuld_stichtag: string | null; ende_datum: string | null }, heute: string): void {
  // null zählt wie „nicht angegeben“ — sonst ginge ein Stichtag ohne Restschuld durch (Review 16.11.2026)
  if ((neu.restschuld == null) !== (neu.restschuld_stichtag == null)) {
    throw new Fachfehler('Restschuld und Stichtag gehören zusammen: beide angeben.');
  }
  if (neu.restschuld != null && neu.restschuld < 0) throw new Fachfehler('Die Restschuld darf nicht negativ sein.');
  if (neu.restschuld_stichtag && neu.restschuld_stichtag > heute) throw new Fachfehler('Der Stichtag darf nicht in der Zukunft liegen.');
  const stichtag = neu.restschuld_stichtag ?? alt.restschuld_stichtag;
  const ende = neu.ende_datum ?? alt.ende_datum;
  if (stichtag && ende && ende < stichtag) throw new Fachfehler('Das Laufzeitende liegt vor dem Stichtag der Restschuld.');
}

/** Dokumente der Kategorie Mietvertrag tragen die Vertragsfassungen (utils/mietvertrag/fassungen.ts) — nur in der App ändern */
export function dokumentAenderbar(kategorie: string | null, neueKategorie?: string): void {
  if (kategorie === 'Mietvertrag' || neueKategorie === 'Mietvertrag') {
    throw new Fachfehler(
      'Mietvertrags-Dokumente tragen die Fassungen des Vertrags (unterschrieben/offen). Bitte in der App im Baustein ' +
        'Mietvertrag bearbeiten.',
    );
  }
}

// ---------- Aufgaben ----------

const aufgabenAuflisten: Werkzeug = {
  name: 'aufgaben_auflisten',
  titel: 'Aufgaben auflisten',
  beschreibung: 'Aufgaben und Meldungen (Board der App) mit Status, Dringlichkeit, Art und Zuständigkeit. Standard: nur nicht fertige.',
  eingabe: objekt({
    status: { type: 'string', enum: AUFGABEN_STATUS, description: 'Nur dieser Status' },
    auch_fertige: { type: 'boolean', description: 'Auch fertige Aufgaben zeigen' },
    anzahl: ANZAHL('Höchstens so viele (Standard 100)', 300),
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    let q = ctx.db.from('dev_tickets').select(
      'id, titel, kurzbeschreibung, typ, status, prioritaet, quelle, verantwortlich_id, melder_id, erstellt_am, erledigt_am',
    );
    if (e.status) q = q.eq('status', e.status);
    else if (!e.auch_fertige) q = q.neq('status', 'fertig');
    const aufgaben = ergebnis<Record<string, string | null>[]>(
      await q.order('erstellt_am', { ascending: false }).limit((e.anzahl as number | undefined) ?? 100),
      'Lesen: Aufgaben',
    ) ?? [];
    const benutzer = nachId(ergebnis<{ id: string; anzeigename: string }[]>(
      await ctx.db.from('app_benutzer').select('id, anzeigename'),
      'Lesen: Benutzer',
    ) ?? []);
    return {
      aufgaben: aufgaben.map((a) => ({
        ...a,
        verantwortlich: a.verantwortlich_id ? benutzer.get(a.verantwortlich_id)?.anzeigename ?? null : null,
        melder: a.melder_id ? benutzer.get(a.melder_id)?.anzeigename ?? null : null,
      })),
    };
  },
};

const aufgabeAnzeigen: Werkzeug = {
  name: 'aufgabe_anzeigen',
  titel: 'Aufgabe anzeigen',
  beschreibung: 'Eine Aufgabe mit Beschreibung, Seite, von der sie gemeldet wurde, und allen Kommentaren.',
  eingabe: objekt({ aufgabe_id: ID('ID der Aufgabe') }, ['aufgabe_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const a = genauEine<Record<string, unknown> & { id: string; screenshot_pfade: string[] | null }>(
      await ctx.db.from('dev_tickets').select(
        'id, titel, kurzbeschreibung, beschreibung, typ, status, prioritaet, quelle, verantwortlich_id, melder_id, seiten_titel, ' +
          'screenshot_pfade, erstellt_am, aktualisiert_am, erledigt_am',
      ).eq('id', e.aufgabe_id).maybeSingle(),
      'Aufgabe',
    );
    const kommentare = ergebnis<{ id: string; kommentar: string; erstellt_am: string; verfasser_id: string | null }[]>(
      await ctx.db.from('dev_ticket_kommentare').select('id, kommentar, erstellt_am, verfasser_id').eq('ticket_id', a.id).order('erstellt_am'),
      'Lesen: Kommentare',
    ) ?? [];
    const benutzer = nachId(ergebnis<{ id: string; anzeigename: string }[]>(
      await ctx.db.from('app_benutzer').select('id, anzeigename'),
      'Lesen: Benutzer',
    ) ?? []);
    const { screenshot_pfade, ...rest } = a;
    return {
      aufgabe: {
        ...rest,
        verantwortlich: a.verantwortlich_id ? benutzer.get(a.verantwortlich_id as string)?.anzeigename ?? null : null,
        melder: a.melder_id ? benutzer.get(a.melder_id as string)?.anzeigename ?? null : null,
        bildschirmfotos: screenshot_pfade?.length ?? 0,
      },
      kommentare: kommentare.map((k) => ({
        kommentar: k.kommentar,
        am: k.erstellt_am,
        von: k.verfasser_id ? benutzer.get(k.verfasser_id)?.anzeigename ?? null : null,
      })),
    };
  },
};

const benutzerAuflisten: Werkzeug = {
  name: 'benutzer_auflisten',
  titel: 'Benutzer auflisten',
  beschreibung: 'Aktive Personen des Benutzerverzeichnisses mit Funktion — für die Zuständigkeit von Aufgaben (verantwortlich_id).',
  eingabe: objekt({}),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(_e, ctx) {
    const zeilen = ergebnis(
      await ctx.db.from('app_benutzer').select('id, anzeigename, kuerzel, funktion, darf_aufgaben').eq('aktiv', true).order('sortierung'),
      'Lesen: Benutzer',
    );
    return { benutzer: zeilen ?? [] };
  },
};

const aufgabeAnlegen: Werkzeug = {
  name: 'aufgabe_anlegen',
  titel: 'Aufgabe anlegen',
  beschreibung:
    'Legt eine Aufgabe auf dem Board an (Status offen). Ohne verantwortlich_id übernimmt sie wie in der App die Person ' +
    'mit der Funktion Entwicklung.',
  eingabe: objekt({
    titel: { ...TEXT('Kurzer Titel', 200), minLength: 3 },
    typ: { type: 'string', enum: AUFGABEN_TYP, description: 'bug, aufgabe oder feature' },
    prioritaet: { type: 'string', enum: AUFGABEN_PRIORITAET, description: 'Dringlichkeit' },
    beschreibung: TEXT('Beschreibung', 5000),
    verantwortlich_id: ID('Zuständige Person (aus benutzer_auflisten)'),
  }, ['titel', 'typ', 'prioritaet']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const titel = (e.titel as string).trim();
    if (titel.length < 3) throw new Fachfehler('Der Titel braucht mindestens drei Zeichen.');
    let verantwortlich = (e.verantwortlich_id as string | undefined) ?? null;
    if (!verantwortlich) {
      // AufgabeAnlegen-Dialog: Vorbelegung mit dem Benutzer der Funktion Entwicklung
      const entwicklung = ergebnis<{ id: string }[]>(
        await ctx.db.from('app_benutzer').select('id').eq('funktion', 'entwicklung').eq('aktiv', true).eq('darf_aufgaben', true).limit(1),
        'Lesen: Benutzer',
      );
      verantwortlich = entwicklung?.[0]?.id ?? null;
    }
    // hooks/useAufgaben.ts (useAufgabeAnlegen); melder_id und erstellt_von setzt die Datenbank
    const { data, error } = await ctx.db.from('dev_tickets').insert({
      titel,
      typ: e.typ,
      prioritaet: e.prioritaet,
      beschreibung: (e.beschreibung as string | undefined)?.trim() || null,
      status: 'offen',
      quelle: 'manuell',
      verantwortlich_id: verantwortlich,
    }).select('id').single();
    if (error) throw schreibfehler(error, 'Aufgabe anlegen');
    return { ok: true, aufgabe_id: data.id, verantwortlich_id: verantwortlich };
  },
};

const aufgabeAendern: Werkzeug = {
  name: 'aufgabe_aendern',
  titel: 'Aufgabe ändern',
  beschreibung:
    'Ändert Titel, Art, Status, Dringlichkeit, Beschreibung oder Zuständigkeit. Der Wechsel auf „fertig“ benachrichtigt den ' +
    'Melder in der App — nur setzen, wenn die Sache wirklich erledigt ist.',
  eingabe: objekt({
    aufgabe_id: ID('ID der Aufgabe'),
    titel: { ...TEXT('Titel', 200), minLength: 3 },
    typ: { type: 'string', enum: AUFGABEN_TYP, description: 'Art' },
    status: { type: 'string', enum: AUFGABEN_STATUS, description: 'Status' },
    prioritaet: { type: 'string', enum: AUFGABEN_PRIORITAET, description: 'Dringlichkeit' },
    beschreibung: TEXT('Beschreibung', 5000),
    verantwortlich_id: ID('Zuständige Person (aus benutzer_auflisten)'),
  }, ['aufgabe_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const felder: Record<string, unknown> = {};
    for (const feld of ['titel', 'typ', 'status', 'prioritaet', 'beschreibung', 'verantwortlich_id'] as const) {
      if (e[feld] !== undefined && e[feld] !== null) felder[feld] = typeof e[feld] === 'string' ? (e[feld] as string).trim() : e[feld];
    }
    if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
    if ('titel' in felder && (felder.titel as string).length < 3) throw new Fachfehler('Der Titel braucht mindestens drei Zeichen.');
    // Wie beim Anlegen: leere Beschreibung als null
    if (felder.beschreibung === '') felder.beschreibung = null;
    // hooks/useAufgaben.ts (useAufgabeAendern)
    await aendereZeile(ctx, 'dev_tickets', e.aufgabe_id as string, felder, 'Aufgabe ändern');
    return { ok: true, aufgabe_id: e.aufgabe_id, geaendert: felder };
  },
};

const aufgabeKommentieren: Werkzeug = {
  name: 'aufgabe_kommentieren',
  titel: 'Aufgabe kommentieren',
  beschreibung: 'Schreibt einen Kommentar unter eine Aufgabe, im Namen des angemeldeten Nutzers.',
  eingabe: objekt({ aufgabe_id: ID('ID der Aufgabe'), kommentar: { ...TEXT('Kommentar', 5000), minLength: 1 } }, ['aufgabe_id', 'kommentar']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const kommentar = (e.kommentar as string).trim();
    if (!kommentar) throw new Fachfehler('Der Kommentar ist leer.');
    genauEine(await ctx.db.from('dev_tickets').select('id').eq('id', e.aufgabe_id).maybeSingle(), 'Aufgabe');
    // AufgabeKommentare.tsx:46; verfasser_id und erstellt_von setzt die Datenbank
    const { data, error } = await ctx.db.from('dev_ticket_kommentare')
      .insert({ ticket_id: e.aufgabe_id, kommentar })
      .select('id').single();
    if (error) throw schreibfehler(error, 'Kommentar speichern');
    return { ok: true, kommentar_id: data.id };
  },
};

// ---------- Versicherungen ----------

const VERSICHERUNG_FELDER = ['typ', 'firma', 'kontaktperson', 'email', 'telefon', 'vertragsnummer', 'jahresbeitrag', 'notizen'] as const;

const versicherungenAuflisten: Werkzeug = {
  name: 'versicherungen_auflisten',
  titel: 'Versicherungen auflisten',
  beschreibung: 'Versicherungspolicen je Objekt mit Versicherer, Ansprechpartner, Vertragsnummer und Jahresbeitrag.',
  eingabe: objekt({ objekt_id: ID('Nur dieses Objekt') }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    let q = ctx.db.from('versicherungen').select(`id, immobilie_id, ${VERSICHERUNG_FELDER.join(', ')}`);
    if (e.objekt_id) q = q.eq('immobilie_id', e.objekt_id);
    const policen = ergebnis<(Record<string, unknown> & { immobilie_id: string; jahresbeitrag: number | null })[]>(
      await q.order('immobilie_id').order('typ'),
      'Lesen: Versicherungen',
    ) ?? [];
    const objekte = nachId(ergebnis<ImmobilieZeile[]>(await ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN), 'Lesen: Objekte') ?? []);
    return {
      policen: policen.map((p) => ({ ...p, objekt: objektName(objekte.get(p.immobilie_id)) })),
      jahresbeitraege_gesamt: cent(policen.reduce((s, p) => s + (Number(p.jahresbeitrag) || 0), 0)),
    };
  },
};

const versicherungSpeichern: Werkzeug = {
  name: 'versicherung_speichern',
  titel: 'Versicherung anlegen oder ändern',
  beschreibung:
    'Legt eine Police an (mit objekt_id und typ) oder ändert eine bestehende (mit versicherung_id; nur die angegebenen Felder). ' +
    'Typen der App: Wohngebäude, Haftpflicht, Hausrat, Rechtsschutz, Elementar, Sonstige.',
  eingabe: objekt({
    versicherung_id: ID('Bestehende Police ändern'),
    objekt_id: ID('Neue Police für dieses Objekt'),
    typ: TEXT('Art der Versicherung', 80),
    firma: TEXT('Versicherer', 200),
    kontaktperson: TEXT('Ansprechpartner', 200),
    email: TEXT('Mail des Ansprechpartners', 200),
    telefon: TEXT('Telefon des Ansprechpartners', 80),
    vertragsnummer: TEXT('Vertrags- oder Policennummer', 120),
    jahresbeitrag: BETRAG('Jahresbeitrag in Euro'),
    notizen: TEXT('Notizen', 2000),
  }),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const felder: Record<string, unknown> = {};
    for (const feld of VERSICHERUNG_FELDER) {
      if (e[feld] === undefined || e[feld] === null) continue;
      felder[feld] = typeof e[feld] === 'string' ? ((e[feld] as string).trim() || null) : e[feld];
    }
    if (typeof felder.jahresbeitrag === 'number') {
      if (felder.jahresbeitrag < 0) throw new Fachfehler('Der Jahresbeitrag darf nicht negativ sein.');
      felder.jahresbeitrag = cent(felder.jahresbeitrag);
    }
    if (e.versicherung_id) {
      if (e.objekt_id) throw new Fachfehler('Entweder versicherung_id (ändern) oder objekt_id (anlegen) angeben.');
      if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
      if ('typ' in felder && !felder.typ) throw new Fachfehler('Der Typ darf nicht leer sein.');
      await aendereZeile(ctx, 'versicherungen', e.versicherung_id as string, felder, 'Versicherung ändern');
      return { ok: true, versicherung_id: e.versicherung_id, geaendert: felder };
    }
    if (!e.objekt_id || !felder.typ) throw new Fachfehler('Zum Anlegen objekt_id und typ angeben.');
    genauEine(await ctx.db.from('immobilien').select('id').eq('id', e.objekt_id).maybeSingle(), 'Objekt');
    // ImmobilienVersicherungenTab.tsx:104 (handleSave)
    const { data, error } = await ctx.db.from('versicherungen').insert({ immobilie_id: e.objekt_id, ...felder }).select('id').single();
    if (error) throw schreibfehler(error, 'Versicherung anlegen');
    return { ok: true, versicherung_id: data.id };
  },
};

const versicherungLoeschen: Werkzeug = {
  name: 'versicherung_loeschen',
  titel: 'Versicherung löschen',
  beschreibung: 'Löscht eine Police endgültig.',
  eingabe: objekt({ versicherung_id: ID('ID der Police') }, ['versicherung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  zerstoerend: true,
  async ausfuehren(e, ctx) {
    // Vorher lesen: Was gelöscht wurde, steht danach im Protokoll (ohne Ansprechpartner)
    const alt = genauEine<Record<string, unknown> & { id: string }>(
      await ctx.db.from('versicherungen').select('id, immobilie_id, typ, firma, vertragsnummer, jahresbeitrag').eq('id', e.versicherung_id).maybeSingle(),
      'Versicherung',
    );
    // ImmobilienVersicherungenTab.tsx:164
    await loescheZeile(ctx, 'versicherungen', alt.id, 'Versicherung löschen');
    return { ok: true, geloescht: alt };
  },
};

// ---------- Darlehen ----------

const DARLEHEN_SPALTEN = 'id, bezeichnung, bank, darlehensbetrag, restschuld, restschuld_stichtag, zinssatz_prozent, ' +
  'tilgungssatz_prozent, monatliche_rate, start_datum, ende_datum, notizen';

const darlehenAuflisten: Werkzeug = {
  name: 'darlehen_auflisten',
  titel: 'Darlehen auflisten',
  beschreibung:
    'Alle Darlehen mit Objekten, Konditionen und der Restschuld heute — fortgerechnet ab dem Stichtag wie die ' +
    'Darlehensverwaltung der App (Rate zum Monatsende, Zins 30/360) — samt nächster Rate mit Zins- und Tilgungsanteil.',
  eingabe: objekt({}),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(_e, ctx) {
    const [darlehen, zuordnung, objekte] = await Promise.all([
      ctx.db.from('darlehen').select(DARLEHEN_SPALTEN).order('bezeichnung'),
      ctx.db.from('darlehen_immobilien').select('darlehen_id, immobilie_id'),
      ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN),
    ]);
    const liste = ergebnis<(Record<string, unknown> & {
      id: string;
      restschuld: number | null;
      restschuld_stichtag: string | null;
      zinssatz_prozent: number | null;
      monatliche_rate: number | null;
      ende_datum: string | null;
    })[]>(darlehen, 'Lesen: Darlehen') ?? [];
    const zu = ergebnis<{ darlehen_id: string; immobilie_id: string }[]>(zuordnung, 'Lesen: Darlehensobjekte') ?? [];
    const objektNachId = nachId(ergebnis<ImmobilieZeile[]>(objekte, 'Lesen: Objekte') ?? []);
    const mitStand = liste.map((d) => ({ d, stand: darlehenStand(d, ctx.heute) }));
    const summe = summiereDarlehen(mitStand.map(({ d, stand }) => ({ stand, monatliche_rate: d.monatliche_rate })));
    return {
      stichtag: ctx.heute,
      darlehen: mitStand.map(({ d, stand }) => ({
        ...d,
        objekte: zu.filter((z) => z.darlehen_id === d.id).map((z) => objektName(objektNachId.get(z.immobilie_id))),
        restschuld_heute: stand.restschuld,
        restschuld_ohne_stichtag: stand.ohneStichtag,
        status: stand.status,
        naechste_rate: stand.naechsteRate,
        getilgt_am: stand.getilgtAm,
        restschuld_am_laufzeitende: stand.restschuldAmLaufzeitende,
        laufzeit_abgelaufen: stand.laufzeitAbgelaufen,
      })),
      summe,
    };
  },
};

const darlehenAendern: Werkzeug = {
  name: 'darlehen_aendern',
  titel: 'Darlehen ändern',
  beschreibung:
    'Ändert Konditionen eines Darlehens. Eine neue Restschuld (z. B. vom Kontoauszug) immer mit ihrem Stichtag angeben; ' +
    'der Stichtag darf nicht in der Zukunft liegen. Nur die angegebenen Felder ändern sich.',
  eingabe: objekt({
    darlehen_id: ID('ID des Darlehens'),
    bezeichnung: { ...TEXT('Bezeichnung', 200), minLength: 1 },
    bank: TEXT('Bank', 200),
    restschuld: BETRAG('Restschuld in Euro zum Stichtag'),
    restschuld_stichtag: DATUM_FELD('Stichtag der Restschuld'),
    zinssatz_prozent: { type: 'number', minimum: 0, maximum: 30, description: 'Sollzins in Prozent p. a.' },
    tilgungssatz_prozent: { type: 'number', minimum: 0, maximum: 100, description: 'Anfängliche Tilgung in Prozent' },
    monatliche_rate: BETRAG('Monatsrate in Euro'),
    ende_datum: DATUM_FELD('Laufzeit bzw. Zinsbindung bis'),
    notizen: TEXT('Notizen', 2000),
  }, ['darlehen_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const alt = genauEine<{ id: string; restschuld_stichtag: string | null; ende_datum: string | null }>(
      await ctx.db.from('darlehen').select('id, restschuld_stichtag, ende_datum').eq('id', e.darlehen_id).maybeSingle(),
      'Darlehen',
    );
    pruefeDarlehen(e as DarlehenAenderung, alt, ctx.heute);
    const felder: Record<string, unknown> = {};
    for (const feld of ['bezeichnung', 'bank', 'restschuld', 'restschuld_stichtag', 'zinssatz_prozent', 'tilgungssatz_prozent', 'monatliche_rate', 'ende_datum', 'notizen'] as const) {
      if (e[feld] === undefined || e[feld] === null) continue;
      felder[feld] = typeof e[feld] === 'string' ? ((e[feld] as string).trim() || null) : e[feld];
    }
    if (Object.keys(felder).length === 0) throw new Fachfehler('Keine Änderung angegeben.');
    if (typeof felder.monatliche_rate === 'number' && felder.monatliche_rate < 0) throw new Fachfehler('Die Rate darf nicht negativ sein.');
    for (const betrag of ['restschuld', 'monatliche_rate'] as const) {
      if (typeof felder[betrag] === 'number') felder[betrag] = cent(felder[betrag] as number);
    }
    // DarlehenVerwaltung.tsx:210 (saveMutation)
    await aendereZeile(ctx, 'darlehen', alt.id, felder, 'Darlehen ändern');
    return { ok: true, darlehen_id: alt.id, geaendert: felder };
  },
};

// ---------- Dokumente ----------

const dokumenteAuflisten: Werkzeug = {
  name: 'dokumente_auflisten',
  titel: 'Dokumente auflisten',
  beschreibung: 'Dokumente an einem Vertrag oder Objekt (ohne gelöschte), neueste zuerst. Den Inhalt öffnet dokument_link.',
  eingabe: objekt({
    mietvertrag_id: ID('Dokumente dieses Vertrags'),
    objekt_id: ID('Dokumente dieses Objekts'),
    kategorie: { type: 'string', enum: DOKUMENT_KATEGORIEN, description: 'Nur diese Kategorie' },
    anzahl: ANZAHL('Höchstens so viele (Standard 50)', 200),
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    if (!e.mietvertrag_id === !e.objekt_id) throw new Fachfehler('Genau eines von mietvertrag_id oder objekt_id angeben.');
    let q = ctx.db.from('dokumente').select('id, titel, kategorie, dateityp, groesse_bytes, hochgeladen_am, erstellt_von')
      .eq('geloescht', false);
    q = e.mietvertrag_id ? q.eq('mietvertrag_id', e.mietvertrag_id) : q.eq('immobilie_id', e.objekt_id);
    if (e.kategorie) q = q.eq('kategorie', e.kategorie);
    const zeilen = ergebnis(await q.order('hochgeladen_am', { ascending: false }).limit((e.anzahl as number | undefined) ?? 50), 'Lesen: Dokumente');
    return { dokumente: zeilen ?? [] };
  },
};

const dokumentLink: Werkzeug = {
  name: 'dokument_link',
  titel: 'Dokument öffnen (Link)',
  beschreibung: `Erzeugt einen Download-Link zu einem Dokument, gültig ${LINK_SEKUNDEN / 60} Minuten, zum Anklicken durch den Nutzer. ` +
    'Mieterunterlagen sind ausgenommen.',
  eingabe: objekt({ dokument_id: ID('ID des Dokuments') }, ['dokument_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const dok = genauEine<{ id: string; titel: string; pfad: string | null; geloescht: boolean; kategorie: string | null }>(
      await ctx.db.from('dokumente').select('id, titel, pfad, geloescht, kategorie').eq('id', e.dokument_id).maybeSingle(),
      'Dokument',
    );
    if (dok.geloescht || !dok.pfad) throw new Fachfehler('Das Dokument ist gelöscht oder hat keine Datei.');
    if ((OHNE_LINK as readonly string[]).includes(dok.kategorie ?? '')) {
      throw new Fachfehler('Mieterunterlagen (Ausweis, Nachweise) öffnet nur die App, nicht der KI-Zugang.');
    }
    const { data, error } = await ctx.db.storage.from('dokumente').createSignedUrl(dok.pfad, LINK_SEKUNDEN);
    if (error || !data?.signedUrl) {
      console.error('[mcp] Link nicht erzeugt:', error?.message ?? 'ohne Antwort');
      throw new Fachfehler('Für dieses Dokument ließ sich kein Link erzeugen.');
    }
    return { titel: dok.titel, link: data.signedUrl, gueltig_minuten: LINK_SEKUNDEN / 60 };
  },
};

const dokumentKategorieAendern: Werkzeug = {
  name: 'dokument_kategorie_aendern',
  titel: 'Kategorie eines Dokuments ändern',
  beschreibung: 'Ordnet ein Dokument einer anderen Kategorie zu. Mietvertrags-Dokumente bleiben der App vorbehalten.',
  eingabe: objekt({
    dokument_id: ID('ID des Dokuments'),
    kategorie: { type: 'string', enum: DOKUMENT_KATEGORIEN, description: 'Neue Kategorie' },
  }, ['dokument_id', 'kategorie']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const dok = genauEine<{ id: string; kategorie: string | null }>(
      await ctx.db.from('dokumente').select('id, kategorie').eq('id', e.dokument_id).maybeSingle(),
      'Dokument',
    );
    dokumentAenderbar(dok.kategorie, e.kategorie as string);
    // ImmobilienDocumentsTab.tsx:93, MietvertragDocumentsTab.tsx:187
    await aendereZeile(ctx, 'dokumente', dok.id, { kategorie: e.kategorie }, 'Kategorie ändern');
    return { ok: true, dokument_id: dok.id, vorher: dok.kategorie, kategorie: e.kategorie };
  },
};

const dokumentLoeschen: Werkzeug = {
  name: 'dokument_loeschen',
  titel: 'Dokument löschen',
  beschreibung:
    'Blendet ein Dokument aus (wie „Löschen“ in der App; die Datei bleibt im Speicher, wiederherstellen kann die App nicht). ' +
    'Mietvertrags-Dokumente bleiben der App vorbehalten.',
  eingabe: objekt({ dokument_id: ID('ID des Dokuments') }, ['dokument_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  zerstoerend: true,
  async ausfuehren(e, ctx) {
    const dok = genauEine<{ id: string; kategorie: string | null; titel: string }>(
      await ctx.db.from('dokumente').select('id, kategorie, titel').eq('id', e.dokument_id).maybeSingle(),
      'Dokument',
    );
    dokumentAenderbar(dok.kategorie);
    // ImmobilienDocumentsTab.tsx:241, MietvertragDocumentsTab.tsx:346 (Soft-Delete)
    await aendereZeile(ctx, 'dokumente', dok.id, { geloescht: true }, 'Dokument löschen');
    return { ok: true, dokument_id: dok.id, titel: dok.titel };
  },
};

export const VERWALTUNGS_WERKZEUGE: readonly Werkzeug[] = [
  aufgabenAuflisten,
  aufgabeAnzeigen,
  benutzerAuflisten,
  aufgabeAnlegen,
  aufgabeAendern,
  aufgabeKommentieren,
  versicherungenAuflisten,
  versicherungSpeichern,
  versicherungLoeschen,
  darlehenAuflisten,
  darlehenAendern,
  dokumenteAuflisten,
  dokumentLink,
  dokumentKategorieAendern,
  dokumentLoeschen,
];
