/**
 * Mietvertragsentwurf: Vorbelegung, Kennzeichnung der Herkunft und die
 * Datensätze, die beim Aktivieren entstehen.
 *
 * Hintergrund (16.10.2026): „Neuen Mietvertrag anlegen" legte Mieter und
 * Vertrag sofort aktiv an der Einheit an — beim Test mit einer Selbstauskunft
 * entstand eine echte Monatsforderung für eine leere Wohnung. Jetzt entsteht
 * zuerst ein Entwurf (`mietvertrag_entwuerfe`) mit PDF-Vorschau; erst das
 * Aktivieren nach der Unterschrift legt Mieter, Vertrag und Forderungen an.
 *
 * Vorbelegt wird aus drei Quellen, und jedes übernommene Feld bleibt als
 * solches erkennbar, bis es geändert wird:
 *  - Objekt:   Vermieter, Heizung, Warmwasser, Schließanlage, Einrichtungen, Gesamtfläche
 *  - Einheit:  Lage, Wohnfläche
 *  - Vorvertrag derselben Einheit: Miete, Betriebskosten, Heizkosten, Räume,
 *    Vormiete (Mietpreisbremse) — aus der Datenbank und, was nur im alten
 *    Dokument steht, aus der KI-Auslese
 */
import type { Tables, TablesInsert } from '@/integrations/supabase/types';
import { getVertragsende } from '@/utils/contractUtils';
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from '@/constants/config';
import { BETRKV_STANDARD, betriebskostenPositionen, einheitDaten, objektDaten, vermieterDaten } from './datenAusDb';
import { VORLAGE_VERSION, type Anrede, type MieterDaten, type MietvertragDaten, type Vertragsart } from './typen';

// ─── Typen ──────────────────────────────────────────────────────────────────

export type Herkunft = 'vorvertrag' | 'objekt' | 'einheit' | 'selbstauskunft' | 'berechnet';

/** Feldpfad (z. B. `kaltmiete`, `einheit.lage`) → Herkunft. Fehlt ein Feld, wurde es von Hand erfasst. */
export type HerkunftKarte = Record<string, Herkunft>;

export type PersonRolle = 'mitmieter' | 'mitbewohner';

export interface EntwurfPerson {
  /** Stabiler Schlüssel für die Oberfläche. */
  schluessel: string;
  /** Mitmieter steht im Vertrag und unterschreibt; Mitbewohner zählt nur zur Personenzahl. */
  rolle: PersonRolle;
  /** Vorhandener Mieterdatensatz, wenn die Person schon Mieter war (keine Dublette anlegen). */
  mieterId: string | null;
  anrede: Anrede | null;
  vorname: string;
  nachname: string;
  istUnternehmen: boolean;
  firmenname: string | null;
  geburtsdatum: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  verhaeltnis: string | null;
}

/** Datei am Entwurf: Entwurfs-PDF oder Selbstauskunft. */
export interface EntwurfDatei {
  pfad: string;
  titel: string;
  kategorie: 'Mietvertrag' | 'Mieterunterlagen';
  dateityp: string;
  groesse_bytes: number;
  art: 'entwurf_pdf' | 'selbstauskunft';
}

/** Antwort von `process-contract-ocr` mit `art: 'selbstauskunft'`. */
export interface SelbstauskunftAuslese {
  personen: {
    vorname: string;
    nachname: string;
    geburtsdatum: string | null;
    strasse: string | null;
    hausnummer: string | null;
    plz: string | null;
    ort: string | null;
    telefon: string | null;
    email: string | null;
    ist_interessent: boolean;
    verhaeltnis: string | null;
  }[];
  einzug_ab: string | null;
  objekt_adresse: string | null;
}

/** Antwort von `process-contract-ocr` mit `art: 'vorvertrag'`. */
export interface VorvertragAuslese {
  einheit_bezeichnung: string | null;
  lage: string | null;
  raumaufstellung: string | null;
  wohnflaeche_qm: number | null;
  schliessanlage: 'zentral' | 'einzel' | null;
  kaltmiete: number | null;
  betriebskosten_vorauszahlung: number | null;
  heizkosten_vorauszahlung: number | null;
  betriebskosten_positionen: { nummer: string; betrag: number | null; umgelegt: boolean }[];
  kaution: number | null;
  mietbeginn: string | null;
}

type Nebenkostenart = Pick<Tables<'nebenkostenarten'>, 'name' | 'verteilerschluessel_art' | 'ist_umlagefaehig'>;

export interface EntwurfGrundlagen {
  immobilie: Tables<'immobilien'>;
  einheit: Tables<'einheiten'>;
  vermieter: Tables<'vermieter'> | null;
  nebenkostenarten: Nebenkostenart[];
  /** Letzter Vertrag derselben Einheit, gleich welcher Status. */
  vorvertrag: Tables<'mietvertrag'> | null;
  /** YYYY-MM-DD */
  heute: string;
}

// ─── Kleine Helfer ──────────────────────────────────────────────────────────

const WOHNRAUM_TYPEN = ['Wohnung', 'Haus (Doppelhaushälfte, Reihenhaus)'];

/** Nur für Wohnungen und Häuser gibt es eine abgenommene Vorlage (Entscheidung vom 18.10.2026). */
export function istWohnraumEinheit(einheitentyp: string | null | undefined): boolean {
  return WOHNRAUM_TYPEN.includes(einheitentyp ?? '');
}

function vertragsartFuer(einheitentyp: string | null | undefined): Vertragsart {
  if (istWohnraumEinheit(einheitentyp)) return 'wohnraum';
  if (einheitentyp === 'Gewerbe') return 'gewerbe';
  if (einheitentyp === 'Stellplatz' || einheitentyp === 'Garage') return 'stellplatz';
  return 'sonstiges';
}

export function rund2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Kaution: drei Nettokaltmieten, das zulässige Maximum (§ 551 Abs. 1 BGB). */
export function kautionFuer(kaltmiete: number): number {
  return kaltmiete > 0 ? rund2(kaltmiete * 3) : 0;
}

function tagDanach(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function ersterNaechsterMonat(heute: string): string {
  const [j, m] = heute.split('-').map(Number);
  return m === 12 ? `${j + 1}-01-01` : `${j}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Mietbeginn-Vorschlag: der Einzugswunsch aus der Selbstauskunft, sonst der
 * Erste des Folgemonats — aber nie vor dem Ende des Vorvertrags.
 */
export function standardMietbeginn(heute: string, vorvertragEnde: string | null, wunsch: string | null): string {
  let beginn = wunsch && /^\d{4}-\d{2}-\d{2}$/.test(wunsch) && wunsch >= heute ? wunsch : ersterNaechsterMonat(heute);
  if (vorvertragEnde && beginn <= vorvertragEnde) beginn = tagDanach(vorvertragEnde);
  return beginn;
}

function setze(herkunft: HerkunftKarte, feld: string, quelle: Herkunft | null): HerkunftKarte {
  if (!quelle) return herkunft;
  return { ...herkunft, [feld]: quelle };
}

/** Ein von Hand geändertes Feld verliert seine Kennzeichnung. */
export function ohneHerkunft(herkunft: HerkunftKarte, ...felder: string[]): HerkunftKarte {
  if (!felder.some(f => f in herkunft)) return herkunft;
  const neu = { ...herkunft };
  for (const f of felder) delete neu[f];
  return neu;
}

export function herkunftText(quelle: Herkunft, vorvertragBeginn: string | null): string {
  switch (quelle) {
    case 'vorvertrag':
      return vorvertragBeginn
        ? `aus Vorvertrag vom ${new Date(`${vorvertragBeginn}T12:00:00`).toLocaleDateString('de-DE')}`
        : 'aus Vorvertrag';
    case 'objekt':
      return 'aus Objekt';
    case 'einheit':
      return 'aus Einheit';
    case 'selbstauskunft':
      return 'aus Selbstauskunft';
    case 'berechnet':
      return 'berechnet';
  }
}

// ─── Vorbelegung ────────────────────────────────────────────────────────────

/**
 * Erste Fassung eines Entwurfs aus Objekt, Einheit und Vorvertrag.
 * Mieter kommen später aus der Selbstauskunft oder von Hand dazu.
 */
export function baueEntwurf(g: EntwurfGrundlagen): { daten: MietvertragDaten; herkunft: HerkunftKarte } {
  const { immobilie, einheit, vorvertrag } = g;
  let h: HerkunftKarte = {};

  const objekt = objektDaten(immobilie);
  if (objekt.heizungsart) h = setze(h, 'objekt.heizungsart', 'objekt');
  if (objekt.warmwasser) h = setze(h, 'objekt.warmwasser', 'objekt');
  if (objekt.gesamtwohnflaecheQm) h = setze(h, 'objekt.gesamtwohnflaecheQm', 'objekt');

  const einheitWerte = einheitDaten(einheit, vorvertrag?.raumaufstellung?.trim() || null);
  if (einheitWerte.bezeichnung) h = setze(h, 'einheit.bezeichnung', 'einheit');
  if (einheitWerte.lage) h = setze(h, 'einheit.lage', 'einheit');
  if (einheitWerte.wohnflaecheQm > 0) h = setze(h, 'einheit.wohnflaecheQm', 'einheit');
  if (einheitWerte.raumaufstellung) {
    h = setze(h, 'einheit.raumaufstellung', vorvertrag?.raumaufstellung?.trim() ? 'vorvertrag' : 'einheit');
  }

  const schliessanlage = immobilie.schliessanlage_art ?? vorvertrag?.schliessanlage_art ?? null;
  if (schliessanlage) h = setze(h, 'schliessanlageArt', immobilie.schliessanlage_art ? 'objekt' : 'vorvertrag');

  const einrichtungen = (immobilie.gemeinschaftseinrichtungen ?? []).map(e => e.trim()).filter(Boolean);
  const mitbenutzung = einrichtungen.length > 0 ? einrichtungen.join(', ') : vorvertrag?.mitbenutzung_einrichtungen ?? null;
  if (mitbenutzung) h = setze(h, 'mitbenutzungEinrichtungen', einrichtungen.length > 0 ? 'objekt' : 'vorvertrag');

  // Miete und Nebenkosten aus dem Vorvertrag. `betriebskosten` ist dort die
  // gesamte Vorauszahlung; ein ausgewiesener Heizkostenanteil wird abgezogen.
  const kaltmiete = vorvertrag ? Number(vorvertrag.kaltmiete ?? 0) : 0;
  const heizkosten = vorvertrag?.heizkosten_vorauszahlung != null ? Number(vorvertrag.heizkosten_vorauszahlung) : null;
  const betriebskosten = vorvertrag ? rund2(Number(vorvertrag.betriebskosten ?? 0) - (heizkosten ?? 0)) : 0;
  if (vorvertrag) {
    if (kaltmiete > 0) h = setze(h, 'kaltmiete', 'vorvertrag');
    if (betriebskosten > 0) h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
    if (heizkosten !== null) h = setze(h, 'heizkostenVorauszahlung', 'vorvertrag');
  }

  const positionen = betriebskostenPositionen(g.nebenkostenarten, vorvertrag?.betriebskosten_positionen ?? null);
  if (Array.isArray(vorvertrag?.betriebskosten_positionen) && vorvertrag.betriebskosten_positionen.length > 0) {
    h = setze(h, 'betriebskostenPositionen', 'vorvertrag');
  }

  const kaution = kautionFuer(kaltmiete);
  if (kaution > 0) h = setze(h, 'kautionBetrag', 'berechnet');

  const vorvertragEnde = getVertragsende(vorvertrag);
  const mietbeginn = standardMietbeginn(g.heute, vorvertragEnde, null);
  h = setze(h, 'mietbeginn', 'berechnet');

  // Vormiete für die Ausnahme nach § 556e Abs. 1 BGB — nur dort, wo die
  // Mietpreisbremse gilt.
  const vormieteNetto = immobilie.ist_angespannt && kaltmiete > 0 ? kaltmiete : null;
  const vormieteBis = vormieteNetto !== null ? vorvertragEnde : null;
  if (vormieteNetto !== null) h = setze(h, 'vormieteNetto', 'vorvertrag');

  const daten: MietvertragDaten = {
    vertragsart: vertragsartFuer(einheit.einheitentyp),
    vermieter: vermieterDaten(g.vermieter, immobilie),
    mieter: [],
    objekt,
    einheit: einheitWerte,
    nebenobjekte: [],

    mietbeginn,
    vertragsende: null,
    befristungsgrund: null,
    befristungsgrundText: null,
    kuendigungsverzichtBis: null,
    uebergabeDatum: null,

    kaltmiete,
    betriebskostenModus: 'vorauszahlung',
    betriebskostenVorauszahlung: betriebskosten,
    heizkostenVorauszahlung: heizkosten,
    betriebskostenPositionen: positionen,
    abrechnungszeitraum: 'das Kalenderjahr',

    kautionBetrag: kaution,
    kautionArt: 'barkaution',
    kautionRaten: 3,

    faelligkeitWerktag: 3,
    lastschrift: false,
    lastschriftKontoinhaber: null,
    lastschriftIban: null,
    lastschriftBic: null,
    sepaMandatsreferenz: null,

    mietanpassungArt: 'keine',
    staffelplan: null,
    indexBasisWert: null,
    indexBasisMonat: null,

    anzahlPersonen: 0,
    schluessel: [],
    schliessanlageArt: schliessanlage,
    mitbenutzungEinrichtungen: mitbenutzung,

    uebergabezustand: 'renoviert',
    schoenheitsreparaturen: false,
    kleinreparaturEinzelgrenze: 100,
    kleinreparaturJahresgrenzeProzent: 8,

    vormieteNetto,
    vormieteBis,
    mietpreisbremseAuskunftAm: null,

    besichtigtAm: null,
    zusatzvereinbarungen: null,

    vertragsdatum: null,
    unterschriftOrt: null,

    anlagen: {
      hausordnung: true,
      betrkvKatalog: true,
      widerrufsbelehrung: true,
      datenschutzhinweis: true,
      mietspiegelEinwilligung: false,
    },
  };

  return { daten, herkunft: h };
}

/**
 * Was nur im alten Vertragsdokument steht, aus der KI-Auslese übernehmen.
 *
 * Werte aus der Datenbank haben Vorrang — die Miete dort ist die zuletzt
 * geschuldete (nach Erhöhungen), das Dokument zeigt den Stand bei Abschluss.
 * Aus dem Dokument kommen nur Felder, die noch leer sind, und die
 * Kostenaufstellung, solange sie noch keine Beträge trägt.
 */
export function wendeVorvertragAuslese(
  daten: MietvertragDaten,
  herkunft: HerkunftKarte,
  auslese: VorvertragAuslese,
  vorvertragGesamtBetriebskosten: number | null
): { daten: MietvertragDaten; herkunft: HerkunftKarte } {
  let h = herkunft;
  const d: MietvertragDaten = { ...daten, einheit: { ...daten.einheit } };

  if (!d.einheit.bezeichnung && auslese.einheit_bezeichnung) {
    d.einheit.bezeichnung = auslese.einheit_bezeichnung;
    h = setze(h, 'einheit.bezeichnung', 'vorvertrag');
  }
  if (!d.einheit.lage && auslese.lage) {
    d.einheit.lage = auslese.lage;
    h = setze(h, 'einheit.lage', 'vorvertrag');
  }
  if (!d.einheit.raumaufstellung && auslese.raumaufstellung) {
    d.einheit.raumaufstellung = auslese.raumaufstellung;
    h = setze(h, 'einheit.raumaufstellung', 'vorvertrag');
  }
  if (!(d.einheit.wohnflaecheQm > 0) && auslese.wohnflaeche_qm && auslese.wohnflaeche_qm > 0) {
    d.einheit.wohnflaecheQm = auslese.wohnflaeche_qm;
    h = setze(h, 'einheit.wohnflaecheQm', 'vorvertrag');
  }
  if (!d.schliessanlageArt && auslese.schliessanlage) {
    d.schliessanlageArt = auslese.schliessanlage;
    h = setze(h, 'schliessanlageArt', 'vorvertrag');
  }
  if (!(d.kaltmiete > 0) && auslese.kaltmiete && auslese.kaltmiete > 0) {
    d.kaltmiete = auslese.kaltmiete;
    h = setze(h, 'kaltmiete', 'vorvertrag');
    if (!(d.kautionBetrag > 0)) {
      d.kautionBetrag = kautionFuer(d.kaltmiete);
      h = setze(h, 'kautionBetrag', 'berechnet');
    }
  }

  // Heizkosten getrennt ausweisen, wenn der alte Vertrag das tat. Die Summe
  // aus der Datenbank bleibt maßgeblich, nur ihre Aufteilung kommt aus dem Dokument.
  if (!(d.heizkostenVorauszahlung && d.heizkostenVorauszahlung > 0) && auslese.heizkosten_vorauszahlung && auslese.heizkosten_vorauszahlung > 0) {
    d.heizkostenVorauszahlung = auslese.heizkosten_vorauszahlung;
    h = setze(h, 'heizkostenVorauszahlung', 'vorvertrag');
    if (vorvertragGesamtBetriebskosten !== null && vorvertragGesamtBetriebskosten > 0) {
      d.betriebskostenVorauszahlung = rund2(vorvertragGesamtBetriebskosten - auslese.heizkosten_vorauszahlung);
    } else if (auslese.betriebskosten_vorauszahlung !== null) {
      d.betriebskostenVorauszahlung = auslese.betriebskosten_vorauszahlung;
    }
    h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
  } else if (!(d.betriebskostenVorauszahlung > 0) && auslese.betriebskosten_vorauszahlung) {
    d.betriebskostenVorauszahlung = auslese.betriebskosten_vorauszahlung;
    h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
  }

  const ohneBetraege = d.betriebskostenPositionen.every(p => p.betrag === null);
  if (ohneBetraege && auslese.betriebskosten_positionen.length > 0) {
    const ausDokument = new Map(auslese.betriebskosten_positionen.map(p => [p.nummer, p]));
    d.betriebskostenPositionen = d.betriebskostenPositionen.map(pos => {
      const p = ausDokument.get(pos.nummer);
      if (!p) return { ...pos, umgelegt: false, betrag: null };
      return { ...pos, umgelegt: p.umgelegt, betrag: p.umgelegt ? p.betrag : null };
    });
    h = setze(h, 'betriebskostenPositionen', 'vorvertrag');
  }

  return { daten: d, herkunft: h };
}

// ─── Personen ───────────────────────────────────────────────────────────────

let zaehler = 0;
export function neuerSchluessel(): string {
  zaehler += 1;
  return `p${Date.now().toString(36)}${zaehler}`;
}

export function leerePerson(rolle: PersonRolle = 'mitmieter'): EntwurfPerson {
  return {
    schluessel: neuerSchluessel(),
    rolle,
    mieterId: null,
    anrede: null,
    vorname: '',
    nachname: '',
    istUnternehmen: false,
    firmenname: null,
    geburtsdatum: null,
    strasse: null,
    hausnummer: null,
    plz: null,
    ort: null,
    telefon: null,
    email: null,
    verhaeltnis: null,
  };
}

/**
 * Personen aus der Selbstauskunft. Vorgabe ist „Mitmieter" für alle — wer nur
 * mit einzieht, wird im Dialog auf „Mitbewohner" umgestellt. Eine weitere
 * Person ohne eigene Anschrift wohnt in aller Regel beim Interessenten.
 */
export function personenAusSelbstauskunft(auslese: SelbstauskunftAuslese): EntwurfPerson[] {
  const interessent = auslese.personen.find(p => p.ist_interessent) ?? auslese.personen[0];
  return auslese.personen.map(p => {
    const ohneAnschrift = !p.strasse && !p.plz && !p.ort;
    const anschrift = ohneAnschrift && interessent ? interessent : p;
    return {
      ...leerePerson('mitmieter'),
      vorname: p.vorname,
      nachname: p.nachname,
      geburtsdatum: p.geburtsdatum,
      strasse: anschrift.strasse,
      hausnummer: anschrift.hausnummer,
      plz: anschrift.plz,
      ort: anschrift.ort,
      telefon: p.telefon,
      email: p.email,
      verhaeltnis: p.verhaeltnis,
    };
  });
}

/** Eine angelegte, aber nie ausgefüllte Personenkarte („Weitere Person"). */
export function istLeerePerson(p: EntwurfPerson): boolean {
  return !p.vorname.trim() && !p.nachname.trim() && !p.firmenname?.trim();
}

/** Personenzahl: alle, die einziehen — Mitmieter und Mitbewohner. */
export function personenzahl(personen: EntwurfPerson[]): number {
  return personen.filter(p => !istLeerePerson(p)).length;
}

/** Vertragsparteien in Generator-Form: nur Mitmieter, leere Karten nicht. */
export function mieterFuerVertrag(personen: EntwurfPerson[]): MieterDaten[] {
  return personen
    .filter(p => p.rolle === 'mitmieter' && !istLeerePerson(p))
    .map(p => ({
      anrede: p.anrede,
      vorname: p.vorname.trim(),
      nachname: p.nachname.trim(),
      istUnternehmen: p.istUnternehmen,
      firmenname: p.istUnternehmen ? p.firmenname?.trim() || null : null,
      vertretenDurch: null,
      strasse: p.strasse,
      hausnummer: p.hausnummer,
      plz: p.plz,
      ort: p.ort,
      geburtsdatum: p.istUnternehmen ? null : p.geburtsdatum,
      telefon: p.telefon,
      email: p.email,
    }));
}

/**
 * Vergleichsformen eines Namens: „Müller" ergibt „mueller" und „muller", damit
 * es sowohl „Mueller" als auch „Muller" trifft; „René" ergibt „rene".
 */
function namensformen(s: string | null | undefined): string[] {
  const basis = (s ?? '').normalize('NFC').toLowerCase().replace(/ß/g, 'ss');
  const ohneZeichen = (t: string) =>
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const umschrift = ohneZeichen(basis.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
  const einfach = ohneZeichen(basis);
  return umschrift === einfach ? [einfach] : [umschrift, einfach];
}

function gleicherName(a: string | null | undefined, b: string | null | undefined): boolean {
  const formenB = namensformen(b);
  return namensformen(a).some(f => f !== '' && formenB.includes(f));
}

/** Rufnummer als nationale Ziffernfolge: „+49 (0) 511 …", „0049 511 …" und „0511 …" sind gleich. */
function ziffern(s: string | null | undefined): string {
  let d = (s ?? '').replace(/\D/g, '');
  if (d.startsWith('0049')) d = `0${d.slice(4)}`;
  else if (d.startsWith('49')) d = `0${d.slice(2)}`;
  return d.replace(/^00/, '0');
}

/**
 * Gibt es die Person schon als Mieter? Am 15.10.2026 entstand beim Test eine
 * Dublette, weil der Dialog nicht nachsah. Treffer: gleicher Vor- und
 * Nachname, solange die Geburtsdaten nicht widersprechen — oder dieselbe Mail.
 */
export function findeVorhandeneMieter<M extends Pick<Tables<'mieter'>, 'id' | 'vorname' | 'nachname' | 'geburtsdatum' | 'hauptmail'>>(
  person: EntwurfPerson,
  mieter: M[]
): M[] {
  const hatVor = namensformen(person.vorname)[0] !== '';
  const hatNach = namensformen(person.nachname)[0] !== '';
  const mail = person.email?.trim().toLowerCase() || null;
  if (!hatVor && !hatNach && !mail) return [];

  return mieter.filter(m => {
    if (mail && m.hauptmail?.trim().toLowerCase() === mail) return true;
    if (!hatVor || !hatNach) return false;
    if (!gleicherName(m.vorname, person.vorname) || !gleicherName(m.nachname, person.nachname)) return false;
    return !(person.geburtsdatum && m.geburtsdatum && person.geburtsdatum !== m.geburtsdatum);
  });
}

export interface BlacklistTreffer {
  person: string;
  eintrag: string;
  grund: string | null;
  merkmal: 'Name' | 'E-Mail' | 'Telefon';
}

/** Abgleich mit der Bewerber-Blacklist. Ein Treffer warnt, sperrt aber nicht. */
export function pruefeBlacklist(
  personen: EntwurfPerson[],
  blacklist: Pick<Tables<'bewerbung_blacklist'>, 'name' | 'email' | 'telefon' | 'grund'>[]
): BlacklistTreffer[] {
  const treffer: BlacklistTreffer[] = [];
  for (const p of personen) {
    const anzeige = p.istUnternehmen ? p.firmenname ?? '' : `${p.vorname} ${p.nachname}`.trim();
    const hatName = namensformen(p.vorname)[0] !== '' && namensformen(p.nachname)[0] !== '';
    const mail = p.email?.trim().toLowerCase() || null;
    const tel = ziffern(p.telefon);

    for (const b of blacklist) {
      let merkmal: BlacklistTreffer['merkmal'] | null = null;
      if (mail && b.email?.trim().toLowerCase() === mail) merkmal = 'E-Mail';
      else if (tel.length >= 6 && ziffern(b.telefon) === tel) merkmal = 'Telefon';
      // Einträge stehen als „Vorname Nachname" oder „Nachname, Vorname" in der Liste
      else if (hatName && (gleicherName(b.name, `${p.vorname}${p.nachname}`) || gleicherName(b.name, `${p.nachname}${p.vorname}`))) merkmal = 'Name';
      else if (p.istUnternehmen && gleicherName(b.name, p.firmenname)) merkmal = 'Name';
      if (merkmal) treffer.push({ person: anzeige, eintrag: b.name, grund: b.grund, merkmal });
    }
  }
  return treffer;
}

// ─── Aktivieren: die Datensätze ─────────────────────────────────────────────

/**
 * Firmenmieter: Listen, Suche und Schreiben zeigen den Mieter über Vor- und
 * Nachname an; massgeblich für den Vertrag sind ist_unternehmen und firmenname
 * (wie im Erfassungsdialog seit 07.10.2026).
 */
function namensfelder(p: EntwurfPerson): { vorname: string; nachname: string } {
  if (!p.istUnternehmen || !p.firmenname?.trim()) {
    return { vorname: p.vorname.trim(), nachname: p.nachname.trim() };
  }
  const teile = p.firmenname.trim().split(/\s+/);
  return teile.length >= 2
    ? { vorname: teile.slice(0, -1).join(' '), nachname: teile[teile.length - 1] }
    : { vorname: p.firmenname.trim(), nachname: '(Firma)' };
}

export function mieterZeile(p: EntwurfPerson): TablesInsert<'mieter'> {
  return {
    ...namensfelder(p),
    anrede: p.istUnternehmen ? 'Firma' : p.anrede,
    hauptmail: p.email?.trim() || null,
    telnr: p.telefon?.trim() || null,
    geburtsdatum: p.istUnternehmen ? null : p.geburtsdatum,
    ist_unternehmen: p.istUnternehmen,
    firmenname: p.istUnternehmen ? p.firmenname?.trim() || null : null,
    strasse: p.strasse?.trim() || null,
    hausnummer: p.hausnummer?.trim() || null,
    plz: p.plz?.trim() || null,
    ort: p.ort?.trim() || null,
  };
}

/** Bisher stand jede Verknüpfung als „Hauptmieter, Position 1" in der Datenbank. */
export function mieterRolle(position: number): Tables<'mietvertrag_mieter'>['rolle'] {
  return position === 1 ? 'Hauptmieter' : position === 2 ? 'Zweitmieter' : 'Drittmieter';
}

export interface VertragsZeileArgs {
  id: string;
  einheitId: string;
  daten: MietvertragDaten;
  herkunft: HerkunftKarte;
  vorvertragId: string | null;
  /** Nur bei Wohnraum mit erzeugtem PDF. */
  mitVorlage: boolean;
}

export function vertragsZeile(a: VertragsZeileArgs): TablesInsert<'mietvertrag'> {
  const d = a.daten;
  const heizkosten = d.heizkostenVorauszahlung && d.heizkostenVorauszahlung > 0 ? rund2(d.heizkostenVorauszahlung) : null;
  return {
    id: a.id,
    einheit_id: a.einheitId,
    status: 'aktiv',
    vertragsart: d.vertragsart,
    start_datum: d.mietbeginn,
    ende_datum: d.vertragsende,
    befristungsgrund: d.befristungsgrund,
    befristungsgrund_text: d.befristungsgrundText,
    kuendigungsverzicht_bis: d.kuendigungsverzichtBis,
    uebergabe_datum: d.uebergabeDatum,

    kaltmiete: rund2(d.kaltmiete),
    // Gesamte Vorauszahlung wie bei allen Bestandsverträgen — die Sollstellung
    // rechnet kaltmiete + betriebskosten.
    betriebskosten: rund2((d.betriebskostenModus === 'inklusiv' ? 0 : d.betriebskostenVorauszahlung) + (heizkosten ?? 0)),
    heizkosten_vorauszahlung: heizkosten,
    betriebskosten_modus: d.betriebskostenModus,
    betriebskosten_positionen: d.betriebskostenPositionen.map(p => ({
      nummer: p.nummer,
      bezeichnung: p.bezeichnung,
      schluessel: p.schluessel,
      umgelegt: p.umgelegt,
      betrag: p.betrag,
    })),

    kaution_betrag: d.kautionArt === 'keine' ? null : rund2(d.kautionBetrag) || null,
    kaution_art: d.kautionArt,
    kaution_raten: d.kautionRaten,
    kaution_status: 'offen',

    faelligkeit_werktag: d.faelligkeitWerktag,
    lastschrift: d.lastschrift,
    bankkonto_mieter: d.lastschriftIban?.replace(/\s+/g, '') || null,
    bankkonto_mieter_bic: d.lastschriftBic?.trim() || null,
    kontoinhaber: d.lastschriftKontoinhaber?.trim() || null,
    sepa_mandatsreferenz: d.sepaMandatsreferenz?.trim() || null,
    ruecklastschrift_gebuehr: RUECKLASTSCHRIFT_GEBUEHR_EUR,

    mietanpassung_art: d.mietanpassungArt,
    staffelplan: d.staffelplan?.map(s => ({ gueltig_ab: s.gueltigAb, kaltmiete: s.kaltmiete })) ?? null,
    index_basis_wert: d.indexBasisWert,
    index_basis_monat: d.indexBasisMonat,

    anzahl_personen: d.anzahlPersonen > 0 ? d.anzahlPersonen : null,
    schliessanlage_art: d.schliessanlageArt,
    mitbenutzung_einrichtungen: d.mitbenutzungEinrichtungen?.trim() || null,
    raumaufstellung: d.einheit.raumaufstellung?.trim() || null,

    uebergabezustand: d.uebergabezustand,
    schoenheitsreparaturen: d.uebergabezustand === 'renoviert' ? d.schoenheitsreparaturen : false,
    kleinreparatur_einzelgrenze: d.kleinreparaturEinzelgrenze,
    kleinreparatur_jahresgrenze_prozent: d.kleinreparaturJahresgrenzeProzent,

    vormiete_netto: d.vormieteNetto,
    vormiete_bis: d.vormieteBis,
    mietpreisbremse_auskunft_am: d.mietpreisbremseAuskunftAm,
    besichtigt_am: d.besichtigtAm,
    zusatzvereinbarungen: d.zusatzvereinbarungen?.trim() || null,
    vertrag_datum: d.vertragsdatum,
    unterschrift_ort: d.unterschriftOrt?.trim() || null,
    vorlage_version: a.mitVorlage ? VORLAGE_VERSION : null,

    vorvertrag_id: a.vorvertragId,
    werte_herkunft: Object.keys(a.herkunft).length > 0 ? a.herkunft : null,
  };
}

export interface AktivierungsDaten {
  vertrag: TablesInsert<'mietvertrag'>;
  /** Neu anzulegende Mieter; `schluessel` verbindet sie mit der Verknüpfung. */
  neueMieter: { schluessel: string; zeile: TablesInsert<'mieter'> }[];
  verknuepfungen: {
    mieter_id: string | null;
    schluessel: string;
    rolle: Tables<'mietvertrag_mieter'>['rolle'];
    position: number;
  }[];
}

/**
 * Was `aktiviere_mietvertrag_entwurf` in einer Transaktion anlegt. Leere
 * Personenkarten fallen weg, ein zweimal gewählter Bestandsmieter zählt einmal.
 */
export function aktivierungsDaten(a: VertragsZeileArgs & { personen: EntwurfPerson[] }): AktivierungsDaten {
  const gesehen = new Set<string>();
  const parteien = a.personen.filter(p => {
    if (p.rolle !== 'mitmieter' || istLeerePerson(p)) return false;
    if (!p.mieterId) return true;
    if (gesehen.has(p.mieterId)) return false;
    gesehen.add(p.mieterId);
    return true;
  });

  return {
    vertrag: vertragsZeile(a),
    neueMieter: parteien.filter(p => !p.mieterId).map(p => ({ schluessel: p.schluessel, zeile: mieterZeile(p) })),
    verknuepfungen: parteien.map((p, i) => ({
      mieter_id: p.mieterId,
      schluessel: p.schluessel,
      rolle: mieterRolle(i + 1),
      position: i + 1,
    })),
  };
}

/** Wie viele Monatsforderungen beim Aktivieren nachgeholt werden (Mietbeginn bis laufender Monat). */
export function monateNachzuholen(mietbeginn: string | null, heute: string): number {
  if (!mietbeginn || !/^\d{4}-\d{2}/.test(mietbeginn)) return 0;
  const [jb, mb] = mietbeginn.split('-').map(Number);
  const [jh, mh] = heute.split('-').map(Number);
  return Math.max(0, (jh - jb) * 12 + (mh - mb) + 1);
}

/**
 * Vertrag im Generator-Format mit den Mitmietern als Vertragsparteien. Die
 * Personenzahl bleibt ein eigenes Feld — sie folgt der Personenliste nur,
 * solange niemand sie von Hand geändert hat (Kinder stehen oft nicht in der
 * Selbstauskunft).
 */
export function mitPersonen(daten: MietvertragDaten, personen: EntwurfPerson[]): MietvertragDaten {
  return { ...daten, mieter: mieterFuerVertrag(personen) };
}

/** Summe der Kostenaufstellung, wie sie die Pflichtprüfung vergleicht. */
export function positionenSumme(daten: MietvertragDaten): number {
  return rund2(
    daten.betriebskostenPositionen
      .filter(p => p.umgelegt && p.betrag !== null)
      .reduce((s, p) => s + (p.betrag ?? 0), 0)
  );
}

export { BETRKV_STANDARD };
