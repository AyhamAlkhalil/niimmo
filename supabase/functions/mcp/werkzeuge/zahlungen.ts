// MCP-Werkzeuge für Zahlungen und Forderungen (16.11.2026).
// Jeder Schreibweg bildet den Weg der App nach (Belege: Kommentare je Werkzeug). Der Zahlungsbezug ist ein
// Entweder-Oder: mietvertrag_id ODER immobilie_id, nie beides (CLAUDE.md Regel 5) — die Datenbank prüft das nicht.

import { kategorieBeiVertragszuordnung } from '../../_shared/zahlungsregeln.ts';
import { ilikeInSpalten, suchwoerter } from '../../_shared/suchbegriff.ts';
import { ANZAHL, BETRAG, DATUM_FELD, ID, MONAT_FELD, objekt, TEXT } from '../eingabe.ts';
import { IMMOBILIE_SPALTEN, type ImmobilieZeile, ladeVertragsmieter, nachId, objektName } from '../daten.ts';
import {
  aendereZeile,
  cent,
  ergebnis,
  Fachfehler,
  genauEine,
  type Kontext,
  loescheZeile,
  NUR_ADMIN,
  ohneIban,
  schreibfehler,
  type Werkzeug,
} from '../werkzeug.ts';

export const ZAHLKATEGORIEN = [
  'Miete',
  'Nichtmiete',
  'Mietkaution',
  'Ignorieren',
  'Rücklastschrift',
  'Nebenkosten',
  'Betriebskostenabrechnung',
] as const;

const ZAHLUNG_SPALTEN = 'id, buchungsdatum, betrag, kategorie, zugeordneter_monat, verwendungszweck, empfaengername, mietvertrag_id, immobilie_id';

interface ZahlungVoll {
  id: string;
  buchungsdatum: string | null;
  betrag: number | null;
  kategorie: string | null;
  zugeordneter_monat: string | null;
  verwendungszweck: string | null;
  empfaengername: string | null;
  mietvertrag_id: string | null;
  immobilie_id: string | null;
}

// ---------- reine Fachlogik (Vitest) ----------

/**
 * Felder beim Kategoriewechsel wie im Kategorie-Editor der App (PaymentKategorieEditor.tsx:66–84):
 * Nebenkosten und Nichtmiete gehören ans Objekt (Vertragsbezug fällt), Ignorieren löst den Vertragsbezug,
 * alle anderen ändern nur die Kategorie. `objektId` ist das Objekt der Zahlung oder ihres Vertrags.
 */
export function kategorieFelder(kategorie: string, objektId: string | null): Record<string, unknown> {
  if (kategorie === 'Nebenkosten' || kategorie === 'Nichtmiete') {
    if (!objektId) {
      throw new Fachfehler('Kein Objekt ermittelbar. Die Zahlung zuerst mit zahlung_objekt_zuordnen einem Objekt zuordnen.');
    }
    return { kategorie, immobilie_id: objektId, mietvertrag_id: null };
  }
  if (kategorie === 'Ignorieren') return { kategorie, mietvertrag_id: null };
  return { kategorie };
}

/** Sollmonat einer neuen Forderung: wie der Dialog der App nur von 2025 bis zum Folgejahr (CreateForderungModal) */
export function forderungsMonatErlaubt(monat: string, heute: string): boolean {
  const jahr = Number(monat.slice(0, 4));
  return jahr >= 2025 && jahr <= Number(heute.slice(0, 4)) + 1;
}

/** Zuordnung vor einer Änderung — für Antwort und Protokoll, damit sie sich zurückstellen lässt */
function vorherZuordnung(z: ZahlungVoll) {
  return { mietvertrag_id: z.mietvertrag_id, objekt_id: z.immobilie_id, kategorie: z.kategorie, monat: z.zugeordneter_monat };
}

// ---------- Lader ----------

async function ladeZahlung(ctx: Kontext, id: string): Promise<ZahlungVoll> {
  return genauEine<ZahlungVoll>(await ctx.db.from('zahlungen').select(ZAHLUNG_SPALTEN).eq('id', id).maybeSingle(), 'Zahlung');
}

async function objektDesVertrags(ctx: Kontext, mietvertragId: string): Promise<string | null> {
  const vertrag = ergebnis<{ einheit_id: string | null } | null>(
    await ctx.db.from('mietvertrag').select('einheit_id').eq('id', mietvertragId).maybeSingle(),
    'Lesen: Mietvertrag',
  );
  if (!vertrag?.einheit_id) return null;
  const einheit = ergebnis<{ immobilie_id: string | null } | null>(
    await ctx.db.from('einheiten').select('immobilie_id').eq('id', vertrag.einheit_id).maybeSingle(),
    'Lesen: Einheit',
  );
  return einheit?.immobilie_id ?? null;
}

// ---------- Lesen ----------

const zahlungenSuchen: Werkzeug = {
  name: 'zahlungen_suchen',
  titel: 'Zahlungen suchen',
  beschreibung:
    'Sucht Kontobewegungen nach Zeitraum, Kategorie, Vertrag, Objekt, Betrag oder Text im Verwendungszweck/Auftraggeber; ' +
    'ohne_zuordnung=true liefert Zahlungen ohne Vertrag und ohne Objekt. Neueste zuerst. Liefert zahlung_id für die ' +
    'Zuordnungswerkzeuge. IBANs (auch im Verwendungszweck) erscheinen nur als [IBAN].',
  eingabe: objekt({
    zahlung_id: ID('Genau diese Zahlung'),
    von: DATUM_FELD('Buchungsdatum ab (JJJJ-MM-TT)'),
    bis: DATUM_FELD('Buchungsdatum bis (JJJJ-MM-TT)'),
    kategorie: { type: 'string', enum: ZAHLKATEGORIEN, description: 'Kategorie der Zahlung' },
    mietvertrag_id: ID('Nur Zahlungen dieses Vertrags'),
    objekt_id: ID('Nur Zahlungen mit diesem Objektbezug'),
    ohne_zuordnung: { type: 'boolean', description: 'Nur Zahlungen ohne Vertrag und ohne Objekt' },
    text: TEXT('Suchwörter im Verwendungszweck oder Auftraggeber', 80),
    betrag_min: BETRAG('Mindestbetrag in Euro (Abgänge sind negativ)'),
    betrag_max: BETRAG('Höchstbetrag in Euro'),
    anzahl: ANZAHL('Höchstens so viele Zahlungen (Standard 50)', 200),
  }),
  rollen: NUR_ADMIN,
  schreibt: false,
  async ausfuehren(e, ctx) {
    let q = ctx.db.from('zahlungen').select(ZAHLUNG_SPALTEN, { count: 'exact' });
    if (e.zahlung_id) q = q.eq('id', e.zahlung_id);
    if (e.von) q = q.gte('buchungsdatum', e.von);
    if (e.bis) q = q.lte('buchungsdatum', e.bis);
    if (e.kategorie) q = q.eq('kategorie', e.kategorie);
    if (e.mietvertrag_id) q = q.eq('mietvertrag_id', e.mietvertrag_id);
    if (e.objekt_id) q = q.eq('immobilie_id', e.objekt_id);
    if (e.ohne_zuordnung) q = q.is('mietvertrag_id', null).is('immobilie_id', null);
    if (e.betrag_min !== undefined && e.betrag_min !== null) q = q.gte('betrag', e.betrag_min);
    if (e.betrag_max !== undefined && e.betrag_max !== null) q = q.lte('betrag', e.betrag_max);
    for (const wort of suchwoerter(e.text as string | undefined)) {
      q = q.or(ilikeInSpalten(['verwendungszweck', 'empfaengername'], wort));
    }
    const anzahl = (e.anzahl as number | undefined) ?? 50;
    const antwort = await q.order('buchungsdatum', { ascending: false }).order('id').limit(anzahl);
    const zahlungen = ergebnis<ZahlungVoll[]>(antwort, 'Suche in Zahlungen') ?? [];

    const vertragIds = [...new Set(zahlungen.map((z) => z.mietvertrag_id).filter((x): x is string => !!x))];
    const objektIds = [...new Set(zahlungen.map((z) => z.immobilie_id).filter((x): x is string => !!x))];
    const [mieter, objekte] = await Promise.all([
      ladeVertragsmieter(ctx, vertragIds),
      objektIds.length === 0
        ? Promise.resolve([] as ImmobilieZeile[])
        : ctx.db.from('immobilien').select(IMMOBILIE_SPALTEN).in('id', objektIds)
          .then((a: { data: ImmobilieZeile[] | null; error: { message: string } | null }) => ergebnis(a, 'Lesen: Objekte') ?? []),
    ]);
    const objektNachId = nachId(objekte as ImmobilieZeile[]);
    return {
      treffer_gesamt: antwort.count ?? zahlungen.length,
      angezeigt: zahlungen.length,
      zahlungen: zahlungen.map((z) => ({
        zahlung_id: z.id,
        buchungsdatum: z.buchungsdatum,
        betrag: Number(z.betrag) || 0,
        kategorie: z.kategorie,
        monat: z.zugeordneter_monat,
        verwendungszweck: ohneIban(z.verwendungszweck),
        auftraggeber: ohneIban(z.empfaengername),
        mietvertrag_id: z.mietvertrag_id,
        mieter: z.mietvertrag_id ? (mieter.get(z.mietvertrag_id) ?? []).map((m) => m.name) : undefined,
        objekt_id: z.immobilie_id,
        objekt: z.immobilie_id ? objektName(objektNachId.get(z.immobilie_id)) : undefined,
      })),
    };
  },
};

// ---------- Schreiben ----------

const zahlungVertragZuordnen: Werkzeug = {
  name: 'zahlung_vertrag_zuordnen',
  titel: 'Zahlung einem Mietvertrag zuordnen',
  beschreibung:
    'Ordnet eine Zahlung einem Mietvertrag zu (der Objektbezug fällt weg). Kategorie wie in der App: Mietkaution, ' +
    'Rücklastschrift und Betriebskostenabrechnung bleiben, alles andere wird Miete. Optional den Monat setzen, für den die ' +
    'Zahlung gilt. Sammelzahlungen für mehrere Verträge nie selbst aufteilen — das entscheidet der Nutzer in der App.',
  eingabe: objekt({
    zahlung_id: ID('ID der Zahlung'),
    mietvertrag_id: ID('ID des Mietvertrags'),
    monat: MONAT_FELD('Monat, für den die Zahlung gilt (JJJJ-MM); ohne Angabe bleibt er unverändert'),
  }, ['zahlung_id', 'mietvertrag_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const zahlung = await ladeZahlung(ctx, e.zahlung_id as string);
    genauEine(await ctx.db.from('mietvertrag').select('id').eq('id', e.mietvertrag_id).maybeSingle(), 'Mietvertrag');
    // AssignPaymentDialog.tsx:138
    const felder: Record<string, unknown> = {
      mietvertrag_id: e.mietvertrag_id,
      immobilie_id: null,
      kategorie: kategorieBeiVertragszuordnung(zahlung.kategorie),
    };
    if (e.monat) felder.zugeordneter_monat = e.monat;
    await aendereZeile(ctx, 'zahlungen', zahlung.id, felder, 'Zahlung zuordnen');
    return { ok: true, zahlung_id: zahlung.id, ...felder, vorher: vorherZuordnung(zahlung) };
  },
};

const zahlungObjektZuordnen: Werkzeug = {
  name: 'zahlung_objekt_zuordnen',
  titel: 'Zahlung einem Objekt zuordnen',
  beschreibung:
    'Ordnet eine Zahlung einem Objekt zu, z. B. Nebenkosten oder sonstige Objektzahlungen; der Vertragsbezug fällt weg, ' +
    'die Kategorie bleibt. Ist die Zahlung schon einer Betriebskostenabrechnung zugeordnet, lehnt die Datenbank ab.',
  eingabe: objekt({ zahlung_id: ID('ID der Zahlung'), objekt_id: ID('ID des Objekts') }, ['zahlung_id', 'objekt_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const zahlung = await ladeZahlung(ctx, e.zahlung_id as string);
    genauEine(await ctx.db.from('immobilien').select('id').eq('id', e.objekt_id).maybeSingle(), 'Objekt');
    // AssignPaymentDialog.tsx (Objekt-Zuordnung)
    await aendereZeile(ctx, 'zahlungen', zahlung.id, { immobilie_id: e.objekt_id, mietvertrag_id: null }, 'Zahlung zuordnen');
    return { ok: true, zahlung_id: zahlung.id, objekt_id: e.objekt_id, kategorie: zahlung.kategorie, vorher: vorherZuordnung(zahlung) };
  },
};

const zahlungZuordnungAufheben: Werkzeug = {
  name: 'zahlung_zuordnung_aufheben',
  titel: 'Zuordnung einer Zahlung aufheben',
  beschreibung: 'Löst eine Zahlung von Vertrag und Objekt. Die Zahlung selbst bleibt erhalten.',
  eingabe: objekt({ zahlung_id: ID('ID der Zahlung') }, ['zahlung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const zahlung = await ladeZahlung(ctx, e.zahlung_id as string);
    await aendereZeile(ctx, 'zahlungen', zahlung.id, { mietvertrag_id: null, immobilie_id: null }, 'Zuordnung aufheben');
    return { ok: true, zahlung_id: zahlung.id, vorher: vorherZuordnung(zahlung) };
  },
};

const zahlungKategorieAendern: Werkzeug = {
  name: 'zahlung_kategorie_aendern',
  titel: 'Kategorie einer Zahlung ändern',
  beschreibung:
    'Ändert die Kategorie wie der Kategorie-Editor der App: Nebenkosten und Nichtmiete hängen die Zahlung ans Objekt ' +
    '(der Vertragsbezug fällt), Ignorieren löst den Vertragsbezug, die übrigen ändern nur die Kategorie. Nur Miete, ' +
    'Rücklastschrift und Betriebskostenabrechnung zählen im Mietkonto. Rücklastschrift an einem Vertrag legt automatisch ' +
    'die Rücklastschriftgebühr als Forderung an.',
  eingabe: objekt({
    zahlung_id: ID('ID der Zahlung'),
    kategorie: { type: 'string', enum: ZAHLKATEGORIEN, description: 'Neue Kategorie' },
  }, ['zahlung_id', 'kategorie']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const zahlung = await ladeZahlung(ctx, e.zahlung_id as string);
    const kategorie = e.kategorie as string;
    const braucht = kategorie === 'Nebenkosten' || kategorie === 'Nichtmiete';
    const objektId = braucht
      ? zahlung.immobilie_id ?? (zahlung.mietvertrag_id ? await objektDesVertrags(ctx, zahlung.mietvertrag_id) : null)
      : null;
    const felder = kategorieFelder(kategorie, objektId);
    await aendereZeile(ctx, 'zahlungen', zahlung.id, felder, 'Kategorie ändern');
    return { ok: true, zahlung_id: zahlung.id, ...felder, vorher: vorherZuordnung(zahlung) };
  },
};

const zahlungMonatAendern: Werkzeug = {
  name: 'zahlung_monat_aendern',
  titel: 'Monat einer Zahlung ändern',
  beschreibung:
    'Setzt den Monat (JJJJ-MM), für den eine Zahlung im Mietkonto gilt. Bei einer Rücklastschrift verschiebt das auch deren Gebühr.',
  eingabe: objekt({ zahlung_id: ID('ID der Zahlung'), monat: MONAT_FELD('Monat JJJJ-MM') }, ['zahlung_id', 'monat']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const zahlung = await ladeZahlung(ctx, e.zahlung_id as string);
    // MietvertragTimelineView.tsx:252–290 (nur zugeordneter_monat)
    await aendereZeile(ctx, 'zahlungen', zahlung.id, { zugeordneter_monat: e.monat }, 'Monat ändern');
    return { ok: true, zahlung_id: zahlung.id, vorher: zahlung.zugeordneter_monat, monat: e.monat };
  },
};

const forderungAnlegen: Werkzeug = {
  name: 'forderung_anlegen',
  titel: 'Forderung anlegen',
  beschreibung:
    'Legt eine Forderung im Mietkonto an, z. B. eine Nachforderung (typ Miete) oder eine Betriebskostennachzahlung bzw. ' +
    'ein BKA-Guthaben (typ BKA, negativ). Monatsmieten legt die nächtliche Sollstellung selbst an; eine von Hand angelegte ' +
    'Monatsmiete für einen künftigen Monat ersetzt die automatische. Betrag darf nicht 0 sein.',
  eingabe: objekt({
    mietvertrag_id: ID('ID des Mietvertrags'),
    monat: MONAT_FELD('Sollmonat JJJJ-MM (2025 bis Folgejahr)'),
    betrag: BETRAG('Betrag in Euro; negativ für Gutschrift'),
    typ: { type: 'string', enum: ['Miete', 'BKA'], description: 'Miete oder BKA (Betriebskostenabrechnung)' },
  }, ['mietvertrag_id', 'monat', 'betrag', 'typ']),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const betrag = cent(e.betrag as number);
    if (betrag === 0) throw new Fachfehler('Der Betrag darf nicht 0 sein.');
    if (!forderungsMonatErlaubt(e.monat as string, ctx.heute)) {
      throw new Fachfehler('Der Monat muss zwischen Januar 2025 und Dezember des Folgejahres liegen.');
    }
    genauEine(await ctx.db.from('mietvertrag').select('id').eq('id', e.mietvertrag_id).maybeSingle(), 'Mietvertrag');
    // CreateForderungModal.tsx:76
    const { data, error } = await ctx.db.from('mietforderungen')
      .insert({ mietvertrag_id: e.mietvertrag_id, sollmonat: `${e.monat}-01`, sollbetrag: betrag, typ: e.typ })
      .select('id, faelligkeitsdatum')
      .single();
    if (error) throw schreibfehler(error, 'Forderung anlegen');
    return { ok: true, forderung_id: data.id, faellig_am: data.faelligkeitsdatum, betrag, typ: e.typ, monat: e.monat };
  },
};

const forderungBetragAendern: Werkzeug = {
  name: 'forderung_betrag_aendern',
  titel: 'Betrag einer Forderung ändern',
  beschreibung:
    'Ändert den Betrag einer Forderung (z. B. Minderung). 0 heißt bewusst erlassen, negativ ist eine Gutschrift. ' +
    'Den Monat einer Forderung ändert die App nicht; dafür löschen und neu anlegen.',
  eingabe: objekt({ forderung_id: ID('ID der Forderung (aus mietkonto_anzeigen)'), betrag: BETRAG('Neuer Betrag in Euro') }, [
    'forderung_id',
    'betrag',
  ]),
  rollen: NUR_ADMIN,
  schreibt: true,
  async ausfuehren(e, ctx) {
    const alt = genauEine<{ id: string; sollbetrag: number }>(
      await ctx.db.from('mietforderungen').select('id, sollbetrag').eq('id', e.forderung_id).maybeSingle(),
      'Forderung',
    );
    // MietvertragTimelineView.tsx:166 (nur sollbetrag)
    const betrag = cent(e.betrag as number);
    await aendereZeile(ctx, 'mietforderungen', alt.id, { sollbetrag: betrag }, 'Forderung ändern');
    return { ok: true, forderung_id: alt.id, vorher: Number(alt.sollbetrag), betrag };
  },
};

const forderungLoeschen: Werkzeug = {
  name: 'forderung_loeschen',
  titel: 'Forderung löschen',
  beschreibung:
    'Löscht eine Forderung aus dem Mietkonto. Eine gelöschte Monatsmiete legt die Sollstellung nicht neu an.',
  eingabe: objekt({ forderung_id: ID('ID der Forderung (aus mietkonto_anzeigen)') }, ['forderung_id']),
  rollen: NUR_ADMIN,
  schreibt: true,
  zerstoerend: true,
  async ausfuehren(e, ctx) {
    const alt = genauEine<{ id: string; sollmonat: string; sollbetrag: number; typ: string; mietvertrag_id: string }>(
      await ctx.db.from('mietforderungen').select('id, sollmonat, sollbetrag, typ, mietvertrag_id').eq('id', e.forderung_id).maybeSingle(),
      'Forderung',
    );
    // MietvertragTimelineView.tsx:131
    await loescheZeile(ctx, 'mietforderungen', alt.id, 'Forderung löschen');
    return { ok: true, geloescht: { ...alt, sollbetrag: Number(alt.sollbetrag) } };
  },
};

export const ZAHLUNGS_WERKZEUGE: readonly Werkzeug[] = [
  zahlungenSuchen,
  zahlungVertragZuordnen,
  zahlungObjektZuordnen,
  zahlungZuordnungAufheben,
  zahlungKategorieAendern,
  zahlungMonatAendern,
  forderungAnlegen,
  forderungBetragAendern,
  forderungLoeschen,
];
