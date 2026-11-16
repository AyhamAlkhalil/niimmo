// Lesende MCP-Werkzeuge für Mietverträge, Mietkonto und Rückstände (16.11.2026).
// Rückstand, Guthaben und offene Posten ausschließlich über den Rechenkern (_shared/mietkonto.ts) — dieselben
// Funktionen und dieselben Eingangsdaten (alle Forderungen und alle Zahlungen eines Vertrags) wie Rückstandsliste,
// Vertragsansicht und send-mahnung. Der frühere Telegram-Assistent rechnete hier anders und wurde deshalb entfernt.

import {
  berechneMietkontostand,
  getVertragsende,
  istLaufenderVertrag,
  type KontoForderung,
  type KontoZahlung,
  mietrueckstand,
  nurFaelligeForderungen,
  offenePosten,
  rueckstandInMonatsmieten,
  rueckstandSeit,
  zahlungsMonat,
} from '../../_shared/mietkonto.ts';
import { ID, MONAT_FELD, objekt } from '../eingabe.ts';
import {
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
  type VertragZeile,
} from '../daten.ts';
import { objektUebersicht } from './bestand.ts';
import { alleZeilen, cent, ergebnis, genauEine, type Kontext, NUR_ADMIN, ohneIban, type Werkzeug } from '../werkzeug.ts';

export interface ForderungZeile extends KontoForderung {
  id: string;
  mietvertrag_id: string;
  ist_faellig?: boolean | null;
}

export interface ZahlungZeile extends KontoZahlung {
  id: string;
  mietvertrag_id: string | null;
  verwendungszweck?: string | null;
  empfaengername?: string | null;
}

const FORDERUNG_SPALTEN = 'id, mietvertrag_id, sollmonat, sollbetrag, faelligkeitsdatum, ist_faellig, typ, ruecklastschrift_am';
const ZAHLUNG_KONTO_SPALTEN = 'id, mietvertrag_id, betrag, buchungsdatum, kategorie, zugeordneter_monat';

// ---------- reine Fachlogik (Vitest) ----------

/**
 * Stand des Mietkontos am Stichtag, wie die Rückstandsliste ihn zeigt: Saldo, Vorauszahlung, seit wann, wie viele
 * Monatsmieten, dazu die offenen Posten wie im Mahndialog.
 */
export function kontostand(
  vertrag: Pick<VertragZeile, 'status' | 'start_datum' | 'ende_datum' | 'kuendigungsdatum' | 'kaltmiete' | 'betriebskosten'>,
  forderungen: readonly KontoForderung[],
  zahlungen: readonly KontoZahlung[],
  stichtag: Date,
) {
  const k = berechneMietkontostand(vertrag, forderungen, zahlungen, stichtag);
  // Rückstandsliste (useRueckstaende): fällige Forderungen ohne Monatsfilter
  const faelligBisHeute = nurFaelligeForderungen(forderungen, stichtag);
  const monatsmiete = (Number(vertrag.kaltmiete) || 0) + (Number(vertrag.betriebskosten) || 0);
  const rueckstand = Math.max(0, k.rueckstand);
  return {
    rueckstand,
    guthaben: k.rueckstand < 0 ? cent(-k.rueckstand) : 0,
    faellige_forderungen: k.gesamtForderungen,
    zahlungen: k.gesamtZahlungen,
    noch_nicht_faellig: k.nichtFaellig,
    vorauszahlung: k.vorauszahlung,
    bka_zahlung_ohne_forderung: k.bkaOhneForderung,
    rueckstand_seit: rueckstandSeit(faelligBisHeute, zahlungen, k.rueckstand),
    rueckstand_in_monatsmieten: rueckstandInMonatsmieten(mietrueckstand(faelligBisHeute, k.rueckstand), monatsmiete),
    // Vertragsansicht (MietvertragDetailsModal): fällige Forderungen mit Monat
    offene_posten: offenePosten(nurFaelligeForderungen(forderungen.filter((f) => f.sollmonat), stichtag), rueckstand),
  };
}

export interface RueckstandsEintrag {
  mietvertrag_id: string;
  objekt: string;
  mietsache: string;
  mieter: string[];
  status: string | null;
  mahnstufe: number;
  betrag: number;
  art: 'rueckstand' | 'guthaben';
  rueckstand_seit: string | null;
  rueckstand_in_monatsmieten: number | null;
  vorauszahlung: number;
  /** Gegenbetrag an anderen offenen Verträgen derselben Mieter (Sammelzahlung) — die Software teilt nie selbst auf */
  verbundener_gegenbetrag: number;
}

/**
 * Rückstandsliste wie in der App (useMietkonto): jeder Vertrag, Saldo ab 1 Cent, Rückstand oder Guthaben.
 * Sammelzahlungen erkennt sie nur als Hinweis (verbundener_gegenbetrag), aufgeteilt wird nie (28.10.2026).
 */
export function rueckstandsliste(
  vertraege: readonly VertragZeile[],
  forderungen: readonly ForderungZeile[],
  zahlungen: readonly ZahlungZeile[],
  einheiten: ReadonlyMap<string, EinheitZeile>,
  objekte: ReadonlyMap<string, ImmobilieZeile>,
  mieter: ReadonlyMap<string, MieterKurz[]>,
  stichtag: Date,
): RueckstandsEintrag[] {
  const forderungenJe = gruppiere(forderungen, (f) => f.mietvertrag_id);
  const zahlungenJe = gruppiere(zahlungen, (z) => z.mietvertrag_id);
  const eintraege: (RueckstandsEintrag & { mieter_ids: string[] })[] = [];
  for (const v of vertraege) {
    const k = kontostand(v, forderungenJe.get(v.id) ?? [], zahlungenJe.get(v.id) ?? [], stichtag);
    const saldo = k.rueckstand > 0 ? k.rueckstand : -k.guthaben;
    if (Math.abs(saldo) < 0.01) continue;
    const einheit = v.einheit_id ? einheiten.get(v.einheit_id) : undefined;
    const vertragsmieter = mieter.get(v.id) ?? [];
    eintraege.push({
      mietvertrag_id: v.id,
      objekt: objektName(einheit?.immobilie_id ? objekte.get(einheit.immobilie_id) : undefined),
      mietsache: einheitText(einheit),
      mieter: vertragsmieter.map((m) => m.name),
      mieter_ids: vertragsmieter.map((m) => m.id),
      status: v.status,
      mahnstufe: v.mahnstufe ?? 0,
      betrag: Math.abs(saldo),
      art: saldo > 0 ? 'rueckstand' : 'guthaben',
      rueckstand_seit: k.rueckstand_seit,
      rueckstand_in_monatsmieten: k.rueckstand_in_monatsmieten,
      vorauszahlung: k.vorauszahlung,
      verbundener_gegenbetrag: 0,
    });
  }
  // Sammelzahlung erkennen (useRueckstaende): Gegenbetrag an anderen nicht beendeten Verträgen derselben Mieter
  const offen = eintraege.filter((e) => e.status !== 'beendet');
  for (const e of offen) {
    const ids = new Set(e.mieter_ids);
    e.verbundener_gegenbetrag = cent(offen
      .filter((a) => a.mietvertrag_id !== e.mietvertrag_id && a.art !== e.art && a.mieter_ids.some((id) => ids.has(id)))
      .reduce((s, a) => s + a.betrag, 0));
  }
  return eintraege
    .sort((a, b) => b.betrag - a.betrag)
    .map(({ mieter_ids: _ids, ...rest }) => rest);
}

// ---------- Lader ----------

async function ladeKonto(ctx: Kontext, vertragIds?: readonly string[]) {
  const [forderungen, zahlungen] = await Promise.all([
    alleZeilen<ForderungZeile>((von, bis) => {
      let q = ctx.db.from('mietforderungen').select(FORDERUNG_SPALTEN);
      if (vertragIds) q = q.in('mietvertrag_id', vertragIds);
      return q.order('id').range(von, bis);
    }, 'Forderungen'),
    alleZeilen<ZahlungZeile>((von, bis) => {
      let q = ctx.db.from('zahlungen').select(ZAHLUNG_KONTO_SPALTEN);
      q = vertragIds ? q.in('mietvertrag_id', vertragIds) : q.not('mietvertrag_id', 'is', null);
      return q.order('id').range(von, bis);
    }, 'Zahlungen'),
  ]);
  return { forderungen, zahlungen };
}

// ---------- Werkzeuge ----------

const VERTRAG_DETAIL_SPALTEN = 'id, einheit_id, status, start_datum, ende_datum, kuendigungsdatum, vertrag_datum, kaltmiete, ' +
  'betriebskosten, heizkosten_vorauszahlung, betriebskosten_modus, mahnstufe, letzte_mahnung_am, kaution_betrag, kaution_ist, ' +
  'kaution_art, kaution_gezahlt_am, lastschrift, ruecklastschrift_gebuehr, anzahl_personen, mietanpassung_art, staffelplan, ' +
  'index_basis_wert, index_basis_monat, letzte_mieterhoehung_am, befristungsgrund, kuendigungsverzicht_bis, vertragsart, ' +
  'unterschrift_ausstehend, uebergabe_datum, strom_einzug, gas_einzug, kaltwasser_einzug, warmwasser_einzug, strom_auszug, ' +
  'gas_auszug, kaltwasser_auszug, warmwasser_auszug';

const mietvertragAnzeigen: Werkzeug = {
  name: 'mietvertrag_anzeigen',
  titel: 'Mietvertrag anzeigen',
  beschreibung:
    'Ein Mietvertrag mit Mietern, Mietsache, Laufzeit (maßgebliches Ende), Miete, Kaution, Mahnstufe, Mietanpassung und ' +
    'Zählerständen bei Ein- und Auszug, dazu der Stand des Mietkontos. Bankdaten gibt der Server nicht heraus.',
  eingabe: objekt({ mietvertrag_id: ID('ID des Mietvertrags') }, ['mietvertrag_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const v = genauEine<VertragZeile & Record<string, unknown>>(
      await ctx.db.from('mietvertrag').select(VERTRAG_DETAIL_SPALTEN).eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const einheit = v.einheit_id
      ? ergebnis<EinheitZeile | null>(await ctx.db.from('einheiten').select(EINHEIT_SPALTEN).eq('id', v.einheit_id).maybeSingle(), 'Lesen: Einheit')
      : null;
    const immobilie = einheit?.immobilie_id
      ? ergebnis<ImmobilieZeile | null>(await ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN).eq('id', einheit.immobilie_id).maybeSingle(), 'Lesen: Objekt')
      : null;
    const mieter = (await ladeVertragsmieter(ctx, [v.id])).get(v.id) ?? [];
    const { forderungen, zahlungen } = await ladeKonto(ctx, [v.id]);
    const mietkonto = kontostand(v, forderungen, zahlungen, ctx.stichtag);
    const zaehler = (['strom', 'gas', 'kaltwasser', 'warmwasser'] as const)
      .map((art) => ({ art, einzug: v[`${art}_einzug`] ?? null, auszug: v[`${art}_auszug`] ?? null }))
      .filter((z) => z.einzug != null || z.auszug != null);
    return {
      stichtag: ctx.heute,
      vertrag: {
        id: v.id,
        status: v.status,
        laeuft: istLaufenderVertrag(v, ctx.stichtag),
        objekt_id: einheit?.immobilie_id ?? null,
        objekt: objektName(immobilie),
        einheit_id: v.einheit_id,
        mietsache: einheitText(einheit),
        mieter,
        beginn: v.start_datum,
        ende: getVertragsende(v),
        vertragsdatum: v.vertrag_datum,
        unterschrift_ausstehend: Boolean(v.unterschrift_ausstehend),
        kaltmiete: Number(v.kaltmiete) || 0,
        betriebskosten: Number(v.betriebskosten) || 0,
        betriebskosten_modus: v.betriebskosten_modus,
        mietanpassung: v.mietanpassung_art,
        staffelplan: v.staffelplan ?? null,
        index_basis: v.index_basis_wert != null ? { wert: v.index_basis_wert, monat: v.index_basis_monat } : null,
        letzte_mieterhoehung_am: v.letzte_mieterhoehung_am,
        kaution: { soll: v.kaution_betrag, ist: v.kaution_ist, art: v.kaution_art, gezahlt_am: v.kaution_gezahlt_am },
        lastschrift: Boolean(v.lastschrift),
        ruecklastschrift_gebuehr: v.ruecklastschrift_gebuehr,
        mahnstufe: v.mahnstufe ?? 0,
        letzte_mahnung_am: v.letzte_mahnung_am,
        anzahl_personen: v.anzahl_personen,
        befristungsgrund: v.befristungsgrund,
        kuendigungsverzicht_bis: v.kuendigungsverzicht_bis,
        uebergabe_datum: v.uebergabe_datum,
        zaehlerstaende: zaehler,
      },
      mietkonto,
    };
  },
};

const mietkontoAnzeigen: Werkzeug = {
  name: 'mietkonto_anzeigen',
  titel: 'Mietkonto anzeigen',
  beschreibung:
    'Mietkonto eines Vertrags: Rückstand oder Guthaben heute (nur fällige Forderungen; die Miete ist am 8. fällig), ' +
    'Vorauszahlung, seit wann offen, offene Posten, dazu Forderungen und Zahlungen je Monat. Gerechnet wie Rückstandsliste ' +
    'und Mahnung der App.',
  eingabe: objekt({
    mietvertrag_id: ID('ID des Mietvertrags'),
    ab_monat: MONAT_FELD('Buchungen ab diesem Monat (JJJJ-MM) auflisten; Standard: die letzten 12 Monate. Der Kontostand zählt immer alles.'),
  }, ['mietvertrag_id']),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const v = genauEine<VertragZeile>(
      await ctx.db.from('mietvertrag').select('id, einheit_id, status, start_datum, ende_datum, kuendigungsdatum, kaltmiete, betriebskosten, mahnstufe')
        .eq('id', e.mietvertrag_id).maybeSingle(),
      'Mietvertrag',
    );
    const [forderungen, zahlungen] = await Promise.all([
      alleZeilen<ForderungZeile>((von, bis) => ctx.db.from('mietforderungen').select(FORDERUNG_SPALTEN)
        .eq('mietvertrag_id', v.id).order('sollmonat').order('id').range(von, bis), 'Forderungen'),
      alleZeilen<ZahlungZeile>((von, bis) => ctx.db.from('zahlungen')
        .select(`${ZAHLUNG_KONTO_SPALTEN}, verwendungszweck, empfaengername`)
        .eq('mietvertrag_id', v.id).order('buchungsdatum').order('id').range(von, bis), 'Zahlungen'),
    ]);
    const [j, m] = ctx.heute.split('-').map(Number);
    const vor12 = new Date(j, m - 12, 1);
    const ab = (e.ab_monat as string | undefined) ??
      `${vor12.getFullYear()}-${String(vor12.getMonth() + 1).padStart(2, '0')}`;
    return {
      stichtag: ctx.heute,
      mietvertrag_id: v.id,
      kontostand: kontostand(v, forderungen, zahlungen, ctx.stichtag),
      buchungen_ab: ab,
      forderungen: forderungen
        .filter((f) => (f.sollmonat ?? '').slice(0, 7) >= ab)
        .map((f) => ({
          forderung_id: f.id,
          monat: (f.sollmonat ?? '').slice(0, 7),
          betrag: Number(f.sollbetrag) || 0,
          typ: f.ruecklastschrift_am ? 'Rücklastschriftgebühr' : f.typ,
          faellig_am: f.faelligkeitsdatum,
        })),
      zahlungen: zahlungen
        .filter((z) => zahlungsMonat(z) >= ab)
        .map((z) => ({
          zahlung_id: z.id,
          buchungsdatum: z.buchungsdatum,
          betrag: Number(z.betrag) || 0,
          kategorie: z.kategorie,
          monat: zahlungsMonat(z),
          verwendungszweck: ohneIban(z.verwendungszweck),
          auftraggeber: ohneIban(z.empfaengername),
        })),
    };
  },
};

const rueckstaendeAuflisten: Werkzeug = {
  name: 'rueckstaende_auflisten',
  titel: 'Rückstände auflisten',
  beschreibung:
    'Rückstandsliste wie in der App: alle Verträge mit Rückstand (oder Guthaben) heute, größter Betrag zuerst, mit Mahnstufe, ' +
    'seit wann und in Monatsmieten. verbundener_gegenbetrag weist auf eine Sammelzahlung über mehrere Verträge desselben ' +
    'Mieters hin; die Software teilt so etwas nie selbst auf.',
  eingabe: objekt({
    art: { type: 'string', enum: ['rueckstand', 'guthaben', 'beide'], description: 'Standard: rueckstand' },
    objekt_id: ID('Nur Verträge dieses Objekts'),
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    const art = (e.art as string | undefined) ?? 'rueckstand';
    const { immobilien, einheiten, vertraege } = await ladeBestand(ctx);
    const [{ forderungen, zahlungen }, mieter] = await Promise.all([ladeKonto(ctx), ladeVertragsmieter(ctx)]);
    const einheitNachId = nachId(einheiten);
    const auswahl = e.objekt_id
      ? vertraege.filter((v) => v.einheit_id && einheitNachId.get(v.einheit_id)?.immobilie_id === e.objekt_id)
      : vertraege;
    const liste = rueckstandsliste(auswahl, forderungen, zahlungen, einheitNachId, nachId(immobilien), mieter, ctx.stichtag)
      .filter((x) => art === 'beide' || x.art === art);
    return {
      stichtag: ctx.heute,
      anzahl: liste.length,
      summe_rueckstand: cent(liste.filter((x) => x.art === 'rueckstand').reduce((s, x) => s + x.betrag, 0)),
      summe_guthaben: cent(liste.filter((x) => x.art === 'guthaben').reduce((s, x) => s + x.betrag, 0)),
      eintraege: liste,
    };
  },
};

const kennzahlen: Werkzeug = {
  name: 'kennzahlen',
  titel: 'Kennzahlen des Bestands',
  beschreibung:
    'Überblick heute: Objekte, Einheiten, Leerstand, laufende Kaltmieten und Betriebskosten-Vorauszahlungen, dazu Summe ' +
    'der Rückstände und Guthaben wie in der Rückstandsliste und die Verträge je Mahnstufe.',
  eingabe: objekt({}),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(_e, ctx) {
    const { immobilien, einheiten, vertraege } = await ladeBestand(ctx);
    const objekte = objektUebersicht(immobilien, einheiten, vertraege, ctx.stichtag);
    const bestand = {
      objekte: objekte.length,
      einheiten: einheiten.length,
      vermietet: objekte.reduce((s, o) => s + o.vermietet, 0),
      leer: objekte.reduce((s, o) => s + o.leer, 0),
      kaltmiete_laufend: cent(objekte.reduce((s, o) => s + o.kaltmiete_laufend, 0)),
      betriebskosten_laufend: cent(objekte.reduce((s, o) => s + o.betriebskosten_laufend, 0)),
    };
    const [{ forderungen, zahlungen }, mieter] = await Promise.all([ladeKonto(ctx), ladeVertragsmieter(ctx)]);
    const liste = rueckstandsliste(vertraege, forderungen, zahlungen, nachId(einheiten), nachId(immobilien), mieter, ctx.stichtag);
    const rueckstaende = liste.filter((x) => x.art === 'rueckstand');
    return {
      stichtag: ctx.heute,
      bestand,
      mietkonten: {
        vertraege_mit_rueckstand: rueckstaende.length,
        summe_rueckstand: cent(rueckstaende.reduce((s, x) => s + x.betrag, 0)),
        vertraege_mit_guthaben: liste.length - rueckstaende.length,
        summe_guthaben: cent(liste.filter((x) => x.art === 'guthaben').reduce((s, x) => s + x.betrag, 0)),
        // Nur nicht beendete Verträge: Bei einem beendeten Vertrag läuft kein Mahnverfahren mehr
        mahnstufen: [1, 2, 3].map((stufe) => ({
          stufe,
          vertraege: vertraege.filter((v) => v.status !== 'beendet' && (v.mahnstufe ?? 0) === stufe).length,
        })),
      },
    };
  },
};

export const MIETKONTO_WERKZEUGE: readonly Werkzeug[] = [mietvertragAnzeigen, mietkontoAnzeigen, rueckstaendeAuflisten, kennzahlen];

