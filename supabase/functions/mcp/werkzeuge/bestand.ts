// Lesende MCP-Werkzeuge für Objekte, Einheiten, Mieter und Zähler (16.11.2026).
// Leerstand und Mietsummen nur über den Kanon (getLaufenderVertrag, summiereLaufendeMieten), Vertragsende nur über
// getVertragsende — dieselben Funktionen wie in der App (_shared/mietkonto.ts).

import { getLaufenderVertrag, getVertragsende, istLaufenderVertrag, summiereLaufendeMieten } from '../../_shared/mietkonto.ts';
import { ilikeInSpalten, suchwoerter } from '../../_shared/suchbegriff.ts';
import { einheitenInReihenfolge, einheitenNummern } from '../../_shared/einheitenReihenfolge.ts';
import {
  einheitZaehlerarten,
  hausanschlussZaehlerarten,
  hausanschlussZweiterZaehler,
  type ObjektZaehlerKonfiguration,
} from '../../_shared/zaehlerarten.ts';
import { ANZAHL, ID, objekt, TEXT } from '../eingabe.ts';
import {
  anschrift,
  einheitText,
  EINHEIT_SPALTEN,
  type EinheitZeile,
  gruppiere,
  IMMOBILIE_SPALTEN,
  type ImmobilieZeile,
  ladeBestand,
  ladeVertragsmieter,
  type MieterKurz,
  nachId,
  objektName,
  VERTRAG_SPALTEN,
  type VertragZeile,
} from '../daten.ts';
import {
  ALLE,
  alleZeilen,
  NUR_ADMIN,
  cent,
  ergebnis,
  Fachfehler,
  genauEine,
  type Kontext,
  mieterBezeichnung,
  type Werkzeug,
} from '../werkzeug.ts';

// ---------- reine Fachlogik (Vitest) ----------

export interface ObjektUebersicht {
  id: string;
  name: string;
  anschrift: string;
  objekttyp: string | null;
  angespannter_markt: boolean;
  einheiten: number;
  vermietet: number;
  leer: number;
  kaltmiete_laufend: number;
  betriebskosten_laufend: number;
}

/** Je Objekt Einheiten, Leerstand und laufende Mieten am Stichtag — wie Objektkopf und Startseite der App */
export function objektUebersicht(
  immobilien: readonly ImmobilieZeile[],
  einheiten: readonly EinheitZeile[],
  vertraege: readonly VertragZeile[],
  stichtag: Date,
): ObjektUebersicht[] {
  const einheitenJeObjekt = gruppiere(einheiten, (e) => e.immobilie_id);
  const vertraegeJeEinheit = gruppiere(vertraege, (v) => v.einheit_id);
  return immobilien.map((i) => {
    const eigene = einheitenJeObjekt.get(i.id) ?? [];
    const vermietet = eigene.filter((e) => getLaufenderVertrag(vertraegeJeEinheit.get(e.id) ?? [], stichtag)).length;
    const mieten = summiereLaufendeMieten(eigene.flatMap((e) => vertraegeJeEinheit.get(e.id) ?? []), stichtag);
    return {
      id: i.id,
      name: objektName(i),
      anschrift: anschrift(i),
      objekttyp: i.objekttyp,
      angespannter_markt: Boolean(i.ist_angespannt),
      einheiten: eigene.length,
      vermietet,
      leer: eigene.length - vermietet,
      kaltmiete_laufend: cent(mieten.kaltmiete),
      betriebskosten_laufend: cent(mieten.betriebskosten),
    };
  });
}

/** Ein Vertrag, wie die Werkzeuge ihn ausgeben */
export function vertragKurz(v: VertragZeile, mieter: readonly MieterKurz[], stichtag: Date) {
  return {
    mietvertrag_id: v.id,
    mieter: mieter.map((m) => m.name),
    mieter_ids: mieter.map((m) => m.id),
    status: v.status,
    laeuft: istLaufenderVertrag(v, stichtag),
    beginn: v.start_datum,
    ende: getVertragsende(v),
    kaltmiete: Number(v.kaltmiete) || 0,
    betriebskosten: Number(v.betriebskosten) || 0,
    mahnstufe: v.mahnstufe ?? 0,
  };
}

/**
 * Belegung einer Einheit: der laufende Vertrag (sonst Leerstand) und ein künftiger, schon geschlossener Vertrag.
 * Künftig ist ein aktiver Vertrag, dessen Beginn nach dem Stichtag liegt.
 */
export function belegung(
  vertraegeDerEinheit: readonly VertragZeile[],
  mieterJeVertrag: ReadonlyMap<string, MieterKurz[]>,
  stichtag: Date,
  heute: string,
) {
  const laufend = getLaufenderVertrag([...vertraegeDerEinheit], stichtag);
  const kuenftig = vertraegeDerEinheit
    .filter((v) => v.status === 'aktiv' && !!v.start_datum && v.start_datum > heute)
    .sort((a, b) => (a.start_datum ?? '').localeCompare(b.start_datum ?? ''))[0];
  return {
    leer: !laufend,
    laufender_vertrag: laufend ? vertragKurz(laufend, mieterJeVertrag.get(laufend.id) ?? [], stichtag) : null,
    kuenftiger_vertrag: kuenftig ? vertragKurz(kuenftig, mieterJeVertrag.get(kuenftig.id) ?? [], stichtag) : null,
  };
}

// ---------- Werkzeuge ----------

const objekteAuflisten: Werkzeug = {
  name: 'objekte_auflisten',
  titel: 'Objekte auflisten',
  beschreibung:
    'Alle Objekte (Immobilien) mit Anschrift, Zahl der Einheiten, vermietet/leer am heutigen Tag und Summe der laufenden ' +
    'Kaltmieten und Betriebskosten-Vorauszahlungen. Einstieg für jede Frage zum Bestand; liefert die objekt_id für weitere Werkzeuge.',
  eingabe: objekt({}),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(_e, ctx) {
    const { immobilien, einheiten, vertraege } = await ladeBestand(ctx);
    const objekte = objektUebersicht(immobilien, einheiten, vertraege, ctx.stichtag);
    return {
      stichtag: ctx.heute,
      objekte,
      summe: {
        einheiten: objekte.reduce((s, o) => s + o.einheiten, 0),
        leer: objekte.reduce((s, o) => s + o.leer, 0),
        kaltmiete_laufend: cent(objekte.reduce((s, o) => s + o.kaltmiete_laufend, 0)),
        betriebskosten_laufend: cent(objekte.reduce((s, o) => s + o.betriebskosten_laufend, 0)),
      },
    };
  },
};

const OBJEKT_DETAIL_SPALTEN = `${IMMOBILIE_SPALTEN}, baujahr, gesamtwohnflaeche, heizungsart, warmwasser, energieeffizienzklasse, ` +
  'energieausweis_gueltig_bis, vermieter_id, hat_strom, hat_gas, hat_wasser, versorger_strom_name, versorger_gas_name, ' +
  'versorger_wasser_name, allgemein_strom_zaehler, allgemein_strom_stand, allgemein_strom_datum, allgemein_gas_zaehler, ' +
  'allgemein_gas_stand, allgemein_gas_datum, allgemein_wasser_zaehler, allgemein_wasser_stand, allgemein_wasser_datum, ' +
  'allgemein_strom_zaehler_2, allgemein_strom_stand_2, allgemein_strom_datum_2, allgemein_gas_zaehler_2, allgemein_gas_stand_2, ' +
  'allgemein_gas_datum_2, allgemein_wasser_zaehler_2, allgemein_wasser_stand_2, allgemein_wasser_datum_2, ' +
  'zaehlerarten_einheiten, hausanschluss_zweiter_zaehler';

/** Welche Zähler ein Objekt hat (Migration 20261124100000) */
export const ZAEHLERARTEN_SPALTEN = 'hat_wasser, hat_strom, hat_gas, zaehlerarten_einheiten, hausanschluss_zweiter_zaehler';

type ObjektDetail = ImmobilieZeile & ObjektZaehlerKonfiguration & Record<string, unknown>;

/** Zählerarten eines Objekts in Worten, wie die Auswahl „Zählerarten“ der App (ZaehlerartenAuswahl.tsx) */
export function zaehlerartenText(i: ObjektZaehlerKonfiguration | null | undefined) {
  return {
    hausanschluss: hausanschlussZaehlerarten(i),
    zweiter_zaehler: hausanschlussZweiterZaehler(i),
    einheiten: einheitZaehlerarten(i),
  };
}

/**
 * Hausanschlusszähler eines Objekts: die am Objekt gewählten, mit zweitem Satz nur, wo gewählt — wie Zählerverwaltung
 * und Objektübersicht (seit 26.11.2026; vorher alle befüllten Sätze, auch abgewählte).
 */
export function hausanschluesse(i: ObjektDetail) {
  const eintrag = (art: string, satz: 1 | 2) => {
    const n = satz === 2 ? '_2' : '';
    return {
      art,
      satz,
      zaehlernummer: i[`allgemein_${art}_zaehler${n}`] ?? null,
      stand: i[`allgemein_${art}_stand${n}`] ?? null,
      datum: i[`allgemein_${art}_datum${n}`] ?? null,
    };
  };
  return [
    ...hausanschlussZaehlerarten(i).map((art) => eintrag(art, 1)),
    ...hausanschlussZweiterZaehler(i).map((art) => eintrag(art, 2)),
  ];
}

const objektAnzeigen: Werkzeug = {
  name: 'objekt_anzeigen',
  titel: 'Objekt anzeigen',
  beschreibung:
    'Ein Objekt mit Stammdaten, Hausanschlusszählern und allen Einheiten. Je Einheit: leer oder der laufende Vertrag ' +
    '(Mieter, Miete, Ende, Mahnstufe) sowie ein schon geschlossener künftiger Vertrag.',
  eingabe: objekt({ objekt_id: ID('ID des Objekts (aus objekte_auflisten oder suche)') }, ['objekt_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const id = e.objekt_id as string;
    const immobilie = genauEine<ObjektDetail>(
      await ctx.db.from('immobilien').select(OBJEKT_DETAIL_SPALTEN).eq('id', id).maybeSingle(),
      'Objekt',
    );
    // Reihenfolge und Nummer wie Objektübersicht und Zählerliste der App (_shared/einheitenReihenfolge.ts)
    const einheiten = einheitenInReihenfolge(ergebnis<EinheitZeile[]>(
      await ctx.db.from('einheiten').select(EINHEIT_SPALTEN).eq('immobilie_id', id).order('id'),
      'Lesen: Einheiten',
    ) ?? []);
    const einheitIds = einheiten.map((x) => x.id);
    const vertraege = einheitIds.length === 0 ? [] : await alleZeilen<VertragZeile>(
      (von, bis) => ctx.db.from('mietvertrag').select(VERTRAG_SPALTEN).in('einheit_id', einheitIds).order('start_datum').order('id').range(von, bis),
      'Mietverträge',
    );
    const mieter = await ladeVertragsmieter(ctx, vertraege.map((v) => v.id));
    const jeEinheit = gruppiere(vertraege, (v) => v.einheit_id);
    const zeilen = einheiten.map((einheit, index) => ({
      einheit_id: einheit.id,
      einheit_nummer: index + 1,
      mietsache: einheitText(einheit),
      ...belegung(jeEinheit.get(einheit.id) ?? [], mieter, ctx.stichtag, ctx.heute),
    }));
    const mieten = summiereLaufendeMieten(vertraege, ctx.stichtag);
    return {
      stichtag: ctx.heute,
      objekt: {
        id: immobilie.id,
        name: objektName(immobilie),
        anschrift: anschrift(immobilie),
        objekttyp: immobilie.objekttyp,
        baujahr: immobilie.baujahr,
        gesamtwohnflaeche: immobilie.gesamtwohnflaeche,
        heizungsart: immobilie.heizungsart,
        warmwasser: immobilie.warmwasser,
        energieeffizienzklasse: immobilie.energieeffizienzklasse,
        energieausweis_gueltig_bis: immobilie.energieausweis_gueltig_bis,
        angespannter_markt: Boolean(immobilie.ist_angespannt),
        versorger: {
          strom: immobilie.versorger_strom_name ?? null,
          gas: immobilie.versorger_gas_name ?? null,
          wasser: immobilie.versorger_wasser_name ?? null,
        },
        zaehlerarten: zaehlerartenText(immobilie),
        hausanschlusszaehler: hausanschluesse(immobilie),
      },
      kennzahlen: {
        einheiten: einheiten.length,
        leer: zeilen.filter((z) => z.leer).length,
        kaltmiete_laufend: cent(mieten.kaltmiete),
        betriebskosten_laufend: cent(mieten.betriebskosten),
      },
      einheiten: zeilen,
    };
  },
};

const EINHEIT_DETAIL_SPALTEN = `${EINHEIT_SPALTEN}, raeume, nebenraeume, ausstattung, einbaukueche, soll_miete, ` +
  'strom_zaehler, strom_stand_aktuell, strom_stand_datum, gas_zaehler, gas_stand_aktuell, gas_stand_datum, ' +
  'kaltwasser_zaehler, kaltwasser_stand_aktuell, kaltwasser_stand_datum, warmwasser_zaehler, warmwasser_stand_aktuell, warmwasser_stand_datum';

type EinheitDetail = EinheitZeile & Record<string, unknown>;

/**
 * Zähler einer Einheit mit aktuellem Stand (= jüngste Ablesung, Migration 20261126100000): die Zählerarten, die das
 * Objekt für seine Einheiten gewählt hat — wie die Spalten der Zählerliste (seit 26.11.2026; vorher alle befüllten).
 */
export function einheitZaehler(e: EinheitDetail, objekt: ObjektZaehlerKonfiguration | null | undefined) {
  return einheitZaehlerarten(objekt).map((art) => ({
    art,
    zaehlernummer: e[`${art}_zaehler`] ?? null,
    stand: e[`${art}_stand_aktuell`] ?? null,
    datum: e[`${art}_stand_datum`] ?? null,
  }));
}

/** Zählerarten und Einheitennummer zu einer Einheit (ein Objekt, dessen Einheiten) */
async function objektZurEinheit(ctx: Kontext, einheit: EinheitZeile) {
  if (!einheit.immobilie_id) return { objekt: null, nummer: null };
  const [objekt, geschwister] = await Promise.all([
    ctx.db.from('immobilien').select(`${IMMOBILIE_SPALTEN}, ${ZAEHLERARTEN_SPALTEN}`).eq('id', einheit.immobilie_id).maybeSingle(),
    ctx.db.from('einheiten').select('id, erstellt_am').eq('immobilie_id', einheit.immobilie_id),
  ]);
  const nummern = einheitenNummern(ergebnis<{ id: string; erstellt_am: string | null }[]>(geschwister, 'Lesen: Einheiten') ?? []);
  return {
    objekt: ergebnis<(ImmobilieZeile & ObjektZaehlerKonfiguration) | null>(objekt, 'Lesen: Objekt'),
    nummer: nummern.get(einheit.id) ?? null,
  };
}

const einheitAnzeigen: Werkzeug = {
  name: 'einheit_anzeigen',
  titel: 'Einheit anzeigen',
  beschreibung:
    'Eine Einheit mit Ausstattung, aktuellen Zählerständen und allen Verträgen (Verlauf, neueste zuerst), dazu Belegung heute.',
  eingabe: objekt({ einheit_id: ID('ID der Einheit (aus objekt_anzeigen)') }, ['einheit_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const einheit = genauEine<EinheitDetail>(
      await ctx.db.from('einheiten').select(EINHEIT_DETAIL_SPALTEN).eq('id', e.einheit_id).maybeSingle(),
      'Einheit',
    );
    const [{ objekt: immobilie, nummer }, vertraege] = await Promise.all([
      objektZurEinheit(ctx, einheit),
      ctx.db.from('mietvertrag').select(VERTRAG_SPALTEN).eq('einheit_id', einheit.id).order('start_datum', { ascending: false }),
    ]);
    const liste = ergebnis<VertragZeile[]>(vertraege, 'Lesen: Mietverträge') ?? [];
    const mieter = await ladeVertragsmieter(ctx, liste.map((v) => v.id));
    return {
      stichtag: ctx.heute,
      einheit: {
        id: einheit.id,
        einheit_nummer: nummer,
        mietsache: einheitText(einheit),
        objekt_id: einheit.immobilie_id,
        objekt: objektName(immobilie),
        einheitentyp: einheit.einheitentyp,
        etage: einheit.etage,
        qm: einheit.qm,
        zimmer: einheit.anzahl_zimmer,
        einbaukueche: einheit.einbaukueche ?? null,
        nebenraeume: einheit.nebenraeume ?? null,
        ausstattung: einheit.ausstattung ?? null,
        soll_miete: einheit.soll_miete ?? null,
        zaehler: einheitZaehler(einheit, immobilie),
      },
      ...belegung(liste, mieter, ctx.stichtag, ctx.heute),
      vertraege: liste.map((v) => vertragKurz(v, mieter.get(v.id) ?? [], ctx.stichtag)),
    };
  },
};

const suche: Werkzeug = {
  name: 'suche',
  titel: 'Suche',
  beschreibung:
    'Sucht Objekte (Name, Anschrift) und Mieter (Vor-, Nach-, Firmenname, Mail) und nennt zu jedem Mieter seine Verträge mit ' +
    'Objekt und Mietsache. Mehrere Wörter müssen alle passen. Liefert die IDs für die weiteren Werkzeuge.',
  eingabe: objekt({ begriff: { ...TEXT('Suchbegriff, z. B. Nachname oder Straße', 80), minLength: 2 } }, ['begriff']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    // Wie die Suche der App (SearchPanel): je Wort ein Filter über die Spalten, alle Wörter zusammen (UND)
    const woerter = suchwoerter(e.begriff as string).filter((w) => w.length >= 2);
    if (woerter.length === 0) throw new Fachfehler('Der Suchbegriff braucht mindestens zwei Buchstaben oder Ziffern.');
    let objekteAbfrage = ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN);
    let mieterAbfrage = ctx.db.from('mieter').select('id, vorname, nachname, firmenname');
    for (const wort of woerter) {
      objekteAbfrage = objekteAbfrage.or(ilikeInSpalten(['name', 'adresse', 'strasse', 'ort'], wort));
      mieterAbfrage = mieterAbfrage.or(ilikeInSpalten(['vorname', 'nachname', 'firmenname', 'hauptmail'], wort));
    }
    const [objekteAntwort, mieterAntwort] = await Promise.all([
      objekteAbfrage.order('name').limit(50),
      mieterAbfrage.order('nachname').order('id').limit(31),
    ]);
    const objekte = ergebnis<ImmobilieZeile[]>(objekteAntwort, 'Suche in Objekten') ?? [];
    const gefunden = ergebnis<{ id: string; vorname: string | null; nachname: string | null; firmenname: string | null }[]>(
      mieterAntwort,
      'Suche in Mietern',
    ) ?? [];
    const mieter = gefunden.slice(0, 30);

    // Verträge der gefundenen Mieter mit Objekt und Mietsache
    const ids = mieter.map((m) => m.id);
    const verknuepfungen = ids.length === 0 ? [] : ergebnis<{ mietvertrag_id: string; mieter_id: string }[]>(
      await ctx.db.from('mietvertrag_mieter').select('mietvertrag_id, mieter_id').in('mieter_id', ids),
      'Lesen: Vertragsmieter',
    ) ?? [];
    const vertragIds = [...new Set(verknuepfungen.map((v) => v.mietvertrag_id))];
    const vertraege = vertragIds.length === 0 ? [] : ergebnis<VertragZeile[]>(
      await ctx.db.from('mietvertrag').select(VERTRAG_SPALTEN).in('id', vertragIds),
      'Lesen: Mietverträge',
    ) ?? [];
    const einheitIds = [...new Set(vertraege.map((v) => v.einheit_id).filter((x): x is string => !!x))];
    const einheiten = einheitIds.length === 0 ? [] : ergebnis<EinheitZeile[]>(
      await ctx.db.from('einheiten').select(EINHEIT_SPALTEN).in('id', einheitIds),
      'Lesen: Einheiten',
    ) ?? [];
    const objektIds = [...new Set(einheiten.map((x) => x.immobilie_id).filter((x): x is string => !!x))];
    const objekteDerVertraege = objektIds.length === 0 ? [] : ergebnis<ImmobilieZeile[]>(
      await ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN).in('id', objektIds),
      'Lesen: Objekte',
    ) ?? [];
    const vertragNachId = nachId(vertraege);
    const einheitNachId = nachId(einheiten);
    const objektNachId = nachId(objekteDerVertraege);

    return {
      objekte: objekte.map((i) => ({ objekt_id: i.id, name: objektName(i), anschrift: anschrift(i) })),
      mieter: mieter.map((m) => ({
        mieter_id: m.id,
        name: mieterBezeichnung(m),
        vertraege: verknuepfungen
          .filter((v) => v.mieter_id === m.id)
          .map((v) => vertragNachId.get(v.mietvertrag_id))
          .filter((v): v is VertragZeile => !!v)
          .sort((a, b) => (b.start_datum ?? '').localeCompare(a.start_datum ?? ''))
          .map((v) => {
            const einheit = v.einheit_id ? einheitNachId.get(v.einheit_id) : undefined;
            return {
              mietvertrag_id: v.id,
              status: v.status,
              laeuft: istLaufenderVertrag(v, ctx.stichtag),
              beginn: v.start_datum,
              ende: getVertragsende(v),
              objekt: objektName(einheit?.immobilie_id ? objektNachId.get(einheit.immobilie_id) : undefined),
              mietsache: einheitText(einheit),
            };
          }),
      })),
      hinweis: gefunden.length > 30 ? 'Mehr als 30 Mieter gefunden — Suchbegriff genauer fassen.' : undefined,
    };
  },
};

const mieterAnzeigen: Werkzeug = {
  name: 'mieter_anzeigen',
  titel: 'Mieter anzeigen',
  beschreibung:
    'Stammdaten eines Mieters mit Kontaktdaten (Mail, Telefon, Anschrift) und allen seinen Verträgen. ' +
    'Geburtsdatum, Ausweisnummer und Bankdaten gibt der Server bewusst nicht heraus.',
  eingabe: objekt({ mieter_id: ID('ID des Mieters (aus suche oder mietvertrag_anzeigen)') }, ['mieter_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const m = genauEine<Record<string, string | boolean | null> & { id: string }>(
      await ctx.db.from('mieter')
        .select('id, anrede, vorname, nachname, firmenname, ist_unternehmen, vertreten_durch, hauptmail, weitere_mails, telnr, strasse, hausnummer, plz, ort')
        .eq('id', e.mieter_id).maybeSingle(),
      'Mieter',
    );
    const verknuepfungen = ergebnis<{ mietvertrag_id: string }[]>(
      await ctx.db.from('mietvertrag_mieter').select('mietvertrag_id').eq('mieter_id', m.id),
      'Lesen: Vertragsmieter',
    ) ?? [];
    const vertragIds = verknuepfungen.map((v) => v.mietvertrag_id);
    const vertraege = vertragIds.length === 0 ? [] : ergebnis<VertragZeile[]>(
      await ctx.db.from('mietvertrag').select(VERTRAG_SPALTEN).in('id', vertragIds).order('start_datum', { ascending: false }),
      'Lesen: Mietverträge',
    ) ?? [];
    const einheitIds = [...new Set(vertraege.map((v) => v.einheit_id).filter((x): x is string => !!x))];
    const einheiten = einheitIds.length === 0 ? [] : ergebnis<EinheitZeile[]>(
      await ctx.db.from('einheiten').select(EINHEIT_SPALTEN).in('id', einheitIds), 'Lesen: Einheiten',
    ) ?? [];
    const objektIds = [...new Set(einheiten.map((x) => x.immobilie_id).filter((x): x is string => !!x))];
    const objekte = objektIds.length === 0 ? [] : ergebnis<ImmobilieZeile[]>(
      await ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN).in('id', objektIds), 'Lesen: Objekte',
    ) ?? [];
    const mitmieter = await ladeVertragsmieter(ctx, vertragIds);
    const einheitNachId = nachId(einheiten);
    const objektNachId = nachId(objekte);
    return {
      mieter: {
        id: m.id,
        name: mieterBezeichnung(m as never),
        anrede: m.anrede,
        vorname: m.vorname,
        nachname: m.nachname,
        firmenname: m.firmenname,
        vertreten_durch: m.vertreten_durch,
        mail: m.hauptmail,
        weitere_mails: m.weitere_mails,
        telefon: m.telnr,
        anschrift: [[m.strasse, m.hausnummer].filter(Boolean).join(' '), [m.plz, m.ort].filter(Boolean).join(' ')]
          .filter(Boolean).join(', ') || null,
      },
      vertraege: vertraege.map((v) => {
        const einheit = v.einheit_id ? einheitNachId.get(v.einheit_id) : undefined;
        return {
          ...vertragKurz(v, mitmieter.get(v.id) ?? [], ctx.stichtag),
          objekt: objektName(einheit?.immobilie_id ? objektNachId.get(einheit.immobilie_id) : undefined),
          mietsache: einheitText(einheit),
        };
      }),
    };
  },
};

const zaehlerstaendeAnzeigen: Werkzeug = {
  name: 'zaehlerstaende_anzeigen',
  titel: 'Zählerstände anzeigen',
  beschreibung:
    'Aktuelle Zählerstände und die letzten Ablesungen (Historie) einer Einheit oder der Hausanschlüsse eines Objekts. ' +
    'Genau eines von einheit_id oder objekt_id angeben.',
  eingabe: objekt({
    einheit_id: ID('ID der Einheit'),
    objekt_id: ID('ID des Objekts (Hausanschlusszähler)'),
    anzahl: ANZAHL('Wie viele Ablesungen der Historie (Standard 20)', 100),
  }),
  rollen: ALLE,
  schreibt: false,
  async ausfuehren(e, ctx: Kontext) {
    const einheitId = e.einheit_id as string | undefined;
    const objektId = e.objekt_id as string | undefined;
    if (!einheitId === !objektId) throw new Fachfehler('Genau eines von einheit_id oder objekt_id angeben.');
    const anzahl = (e.anzahl as number | undefined) ?? 20;
    // Mit ID: Damit lässt sich eine Ablesung über ablesung_korrigieren oder ablesung_loeschen ändern
    let q = ctx.db.from('zaehlerstand_historie').select('id, zaehler_typ, zaehler_nummer, stand, datum, quelle, mietvertrag_id, erfassung');
    q = einheitId ? q.eq('einheit_id', einheitId) : q.eq('immobilie_id', objektId).is('einheit_id', null);
    const historie = ergebnis<Record<string, unknown>[]>(
      await q.order('datum', { ascending: false }).order('id').limit(anzahl),
      'Lesen: Zählerstände',
    ) ?? [];
    if (einheitId) {
      const einheit = genauEine<EinheitDetail>(
        await ctx.db.from('einheiten').select(EINHEIT_DETAIL_SPALTEN).eq('id', einheitId).maybeSingle(),
        'Einheit',
      );
      const { objekt, nummer } = await objektZurEinheit(ctx, einheit);
      return { einheit_id: einheit.id, einheit_nummer: nummer, mietsache: einheitText(einheit), aktuell: einheitZaehler(einheit, objekt), historie };
    }
    const immobilie = genauEine<ObjektDetail>(
      await ctx.db.from('immobilien').select(OBJEKT_DETAIL_SPALTEN).eq('id', objektId).maybeSingle(),
      'Objekt',
    );
    return { objekt_id: immobilie.id, objekt: objektName(immobilie), aktuell: hausanschluesse(immobilie), historie };
  },
};

const zaehlerAuflisten: Werkzeug = {
  name: 'zaehler_auflisten',
  titel: 'Zähler auflisten',
  beschreibung:
    'Zählerverzeichnis wie die Zählerliste der App: je Objekt die gewählten Zählerarten, die Hausanschlusszähler und je ' +
    'Einheit („Einheit N“ wie in der App, Mietsache) die vorhandenen Zähler mit Nummer, aktuellem Stand und Ablesedatum. ' +
    'Liefert objekt_id und einheit_id für zaehlerstand_erfassen.',
  eingabe: objekt({ objekt_id: ID('Nur dieses Objekt') }),
  rollen: ALLE,
  schreibt: false,
  async ausfuehren(e, ctx) {
    // Je Seite eine neue Abfrage: supabase-js-Builder sind veränderlich, order/range hingen sonst doppelt an
    const objektAbfrage = () => {
      const q = ctx.db.from('immobilien').select(OBJEKT_DETAIL_SPALTEN);
      return e.objekt_id ? q.eq('id', e.objekt_id) : q;
    };
    const einheitAbfrage = () => {
      const q = ctx.db.from('einheiten').select(EINHEIT_DETAIL_SPALTEN);
      return e.objekt_id ? q.eq('immobilie_id', e.objekt_id) : q;
    };
    const [objekte, einheiten] = await Promise.all([
      alleZeilen<ObjektDetail>((von, bis) => objektAbfrage().order('name').order('id').range(von, bis), 'Objekte'),
      alleZeilen<EinheitDetail>((von, bis) => einheitAbfrage().order('id').range(von, bis), 'Einheiten'),
    ]);
    const jeObjekt = gruppiere(einheiten, (x) => x.immobilie_id);
    return {
      objekte: objekte.map((o) => ({
        objekt_id: o.id,
        objekt: objektName(o),
        anschrift: anschrift(o),
        zaehlerarten: zaehlerartenText(o),
        hausanschlusszaehler: hausanschluesse(o),
        // Reihenfolge und „Einheit N“ wie die Zählerliste der App
        einheiten: einheitenInReihenfolge(jeObjekt.get(o.id) ?? []).map((x, index) => ({
          einheit_id: x.id,
          einheit_nummer: index + 1,
          mietsache: einheitText(x),
          zaehler: einheitZaehler(x, o),
        })),
      })),
    };
  },
};

export const BESTAND_WERKZEUGE: readonly Werkzeug[] = [
  zaehlerAuflisten,
  suche,
  objekteAuflisten,
  objektAnzeigen,
  einheitAnzeigen,
  mieterAnzeigen,
  zaehlerstaendeAnzeigen,
];
