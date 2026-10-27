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
import { alsIsoTag, getVertragsende, istLaufenderVertrag } from '@/utils/contractUtils';
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from '@/constants/config';
import { istPlausiblesDatum } from '../pdf/briefLayout';
import { BETRKV_STANDARD, betriebskostenPositionen, einheitDaten, ersteIban, objektDaten, vermieterDaten } from './datenAusDb';
import { VORLAGE_VERSION, type Anrede, type MieterDaten, type MietvertragDaten, type Vertragsart } from './typen';

// ─── Typen ──────────────────────────────────────────────────────────────────

export type Herkunft =
  | 'vorvertrag'
  | 'objekt'
  | 'einheit'
  | 'selbstauskunft'
  | 'berechnet'
  /** Standardwert der Vorlage, z. B. Fälligkeit am 3. Werktag */
  | 'vorgabe'
  /** Vermieterstammdaten */
  | 'stammdaten'
  /** Verbraucherpreisindex aus `marktdaten` */
  | 'marktdaten';

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
  /** Wer eine Firma als Mieterin vertritt (Rubrum und Unterschrift). */
  vertretenDurch?: string | null;
  /** Woher die Angaben stammen; ohne Angabe von Hand erfasst. */
  quelle?: 'selbstauskunft' | 'bestand';
  /**
   * Stammdaten des Bestandsmieters, als er auf die Karte kam (Spaltenform). Beim Aktivieren
   * gehen nur Felder mit, die davon abweichen — sonst schrieb ein alter Entwurf eine
   * inzwischen geänderte Mail oder Rufnummer zurück (27.10.2026).
   */
  bestandStand?: BestandsStammdaten | null;
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
  /** „mindestens jedoch 12 Monate" → 12; wird als Kündigungsverzicht übernommen. */
  mindestlaufzeit_monate?: number | null;
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

// Ein ungültiges Datum kommt unverändert zurück: toISOString() würfe sonst
// mitten im Tippen eine RangeError und risse die ganze Seite mit (20.10.2026).
function tagDanach(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return datum;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function tagDavor(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return datum;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const zwei = (n: number) => String(n).padStart(2, '0');

/** Datum plus Monate; der 31.01. plus ein Monat ist der 28./29.02., nicht der 03.03. */
export function plusMonate(datum: string, monate: number): string {
  const [j, m, t] = datum.split('-').map(Number);
  const gesamt = m - 1 + monate;
  const jahr = j + Math.floor(gesamt / 12);
  const monat = ((gesamt % 12) + 12) % 12;
  const letzter = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
  return `${String(jahr).padStart(4, '0')}-${zwei(monat + 1)}-${zwei(Math.min(t, letzter))}`;
}

/**
 * Kündigungsverzicht über n Monate ab Mietbeginn: Beginn 01.06.2025 und
 * 12 Monate ergibt den 31.05.2026 — so steht es im Referenzvertrag. Fehlt der
 * gleichnamige Tag im Zielmonat (Beginn 31.01., ein Monat), endet die Frist mit
 * dem Monatsletzten, also am 28.02. (§ 188 Abs. 3 BGB), nicht am 27.02.
 */
export function kuendigungsverzichtNachMonaten(mietbeginn: string, monate: number): string {
  const ziel = plusMonate(mietbeginn, monate);
  return Number(ziel.slice(-2)) < Number(mietbeginn.slice(-2)) ? ziel : tagDavor(ziel);
}

/**
 * Verschiebt einen aus Monaten berechneten Kündigungsverzicht mit dem
 * Mietbeginn. Ein von Hand gewähltes Datum, das kein glattes Monatsende der
 * Laufzeit ist, bleibt stehen.
 */
export function verschiebeKuendigungsverzicht(alterBeginn: string, neuerBeginn: string, bis: string): string {
  if (!istPlausiblesDatum(alterBeginn) || !istPlausiblesDatum(neuerBeginn) || !istPlausiblesDatum(bis)) return bis;
  // Das Ende liegt im Monat „Beginn + n" oder — bei Beginn am Ersten — im Monat davor
  const [ja, ma] = alterBeginn.split('-').map(Number);
  const [jb, mb] = bis.split('-').map(Number);
  const ungefaehr = (jb - ja) * 12 + (mb - ma);
  const monate = [ungefaehr, ungefaehr + 1].find(m => m > 0 && kuendigungsverzichtNachMonaten(alterBeginn, m) === bis);
  return monate ? kuendigungsverzichtNachMonaten(neuerBeginn, monate) : bis;
}

/**
 * Neuer Mietbeginn; ein in Monaten vereinbarter Kündigungsverzicht, der noch
 * seine Herkunft trägt (nicht von Hand gesetzt), wandert mit. `alterBeginn`
 * ist der letzte gültige Mietbeginn — beim Tippen kommen Zwischenstände.
 */
export function mitMietbeginn(
  d: MietvertragDaten,
  neuerBeginn: string,
  verzichtFolgt: boolean,
  alterBeginn: string = d.mietbeginn
): MietvertragDaten {
  return {
    ...d,
    mietbeginn: neuerBeginn,
    kuendigungsverzichtBis:
      verzichtFolgt && d.kuendigungsverzichtBis
        ? verschiebeKuendigungsverzicht(alterBeginn, neuerBeginn, d.kuendigungsverzichtBis)
        : d.kuendigungsverzichtBis,
  };
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
  let beginn = istPlausiblesDatum(wunsch) && wunsch >= heute ? wunsch : ersterNaechsterMonat(heute);
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
    case 'vorgabe':
      return 'Vorgabe';
    case 'stammdaten':
      return 'aus Stammdaten';
    case 'marktdaten':
      return 'aus Marktdaten';
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
  if (objekt.energieausweisTyp) h = setze(h, 'objekt.energieausweis', 'objekt');

  const einheitWerte = einheitDaten(einheit, vorvertrag?.raumaufstellung?.trim() || null);
  if (einheitWerte.bezeichnung) h = setze(h, 'einheit.bezeichnung', 'einheit');
  if (einheitWerte.lage) h = setze(h, 'einheit.lage', 'einheit');
  if (einheitWerte.wohnflaecheQm > 0) h = setze(h, 'einheit.wohnflaecheQm', 'einheit');
  if (einheitWerte.raumaufstellung) {
    h = setze(h, 'einheit.raumaufstellung', vorvertrag?.raumaufstellung?.trim() ? 'vorvertrag' : 'einheit');
  }
  if (einheitWerte.nebenraeume?.trim()) h = setze(h, 'einheit.nebenraeume', 'einheit');
  h = setze(h, 'einheit.einbaukueche', 'einheit');

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

  // Was nicht aus einer Quelle kommt, ist ein Standardwert der Vorlage — auch
  // der soll als solcher erkennbar sein, bis jemand bewusst entscheidet.
  h = setze(h, 'vermieter', g.vermieter ? 'stammdaten' : null);
  // Das Mietkonto kommt vom Objekt, wenn dort eins steht — sonst aus den Vermieterstammdaten
  h = setze(h, 'vermieter.mietIban', ersteIban(immobilie['Kontonr.']) ? 'objekt' : g.vermieter?.miet_iban ? 'stammdaten' : null);
  h = setze(h, 'objekt.heizkostenSchluessel', 'objekt');
  for (const feld of [
    'betriebskostenModus',
    'kautionArt',
    'kautionRaten',
    'faelligkeitWerktag',
    'mietanpassungArt',
    'uebergabezustand',
    'kleinreparaturEinzelgrenze',
    'kleinreparaturJahresgrenzeProzent',
    'anlagen',
  ]) {
    h = setze(h, feld, 'vorgabe');
  }

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
      h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
    } else if (auslese.betriebskosten_vorauszahlung !== null) {
      d.betriebskostenVorauszahlung = auslese.betriebskosten_vorauszahlung;
      h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
    }
  } else if (!(d.betriebskostenVorauszahlung > 0) && auslese.betriebskosten_vorauszahlung) {
    d.betriebskostenVorauszahlung = auslese.betriebskosten_vorauszahlung;
    h = setze(h, 'betriebskostenVorauszahlung', 'vorvertrag');
  }

  // „mindestens jedoch 12 Monate" — im Referenzvertrag vom 01.06.2025 als
  // beidseitiger Kündigungsverzicht bis 31.05.2026 vereinbart.
  if (!d.kuendigungsverzichtBis && istPlausiblesDatum(d.mietbeginn) && auslese.mindestlaufzeit_monate && auslese.mindestlaufzeit_monate > 0) {
    d.kuendigungsverzichtBis = kuendigungsverzichtNachMonaten(d.mietbeginn, auslese.mindestlaufzeit_monate);
    h = setze(h, 'kuendigungsverzichtBis', 'vorvertrag');
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
      quelle: 'selbstauskunft' as const,
    };
  });
}

/** Eine angelegte, aber nie ausgefüllte Personenkarte („Neue Person"). */
export function istLeerePerson(p: EntwurfPerson): boolean {
  return !p.vorname.trim() && !p.nachname.trim() && !p.firmenname?.trim();
}

/**
 * Hat die Person einen Namen der gewählten Art? Bei einer Firma zählt nur der
 * Firmenname, sonst Vor- oder Nachname — ein nach dem Umschalten stehen-
 * gebliebener Name der anderen Art macht noch keinen Mieter.
 */
export function hatNamen(p: EntwurfPerson): boolean {
  // Ein Mitbewohner ist immer ein Mensch; seine Karte zeigt nur Vor- und Nachname
  const firma = p.istUnternehmen && p.rolle === 'mitmieter';
  return firma ? !!p.firmenname?.trim() : !!(p.vorname.trim() || p.nachname.trim());
}

/**
 * Personenzahl: alle Menschen, die einziehen — Mitmieter und Mitbewohner. Eine Firma als Mieterin
 * wohnt nicht selbst; bis zum 27.10.2026 zählte sie als Person (Firma plus Mitarbeiter = 2 im
 * Vertrag und im Personenschlüssel der Betriebskosten, eine Firma allein = 1 statt einer Sperre).
 */
export function personenzahl(personen: EntwurfPerson[]): number {
  return personen.filter(p => hatNamen(p) && !(p.istUnternehmen && p.rolle === 'mitmieter')).length;
}

/** Vertragsparteien in Generator-Form: nur Mitmieter, leere Karten nicht. */
export function mieterFuerVertrag(personen: EntwurfPerson[]): MieterDaten[] {
  return personen
    .filter(p => p.rolle === 'mitmieter' && hatNamen(p))
    .map(p => ({
      anrede: p.anrede,
      vorname: p.vorname.trim(),
      nachname: p.nachname.trim(),
      istUnternehmen: p.istUnternehmen,
      firmenname: p.istUnternehmen ? p.firmenname?.trim() || null : null,
      vertretenDurch: p.istUnternehmen ? p.vertretenDurch?.trim() || null : null,
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
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
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

/**
 * Beschreiben zwei Personenkarten dieselbe Person?
 *
 * Wer erst einen Bestandsmieter wählte und danach dessen Selbstauskunft hochlud, bekam eine
 * zweite, neue Karte derselben Person ohne jeden Hinweis — die Suche schloss schon gewählte
 * Mieter aus. Beim Aktivieren wurde die Person neu angelegt, zweimal verknüpft und doppelt
 * in die Personenzahl gezählt (27.10.2026).
 *
 * „sicher“ (sperrt das Aktivieren): gleicher Vor- und Nachname und dazu gleiches Geburtsdatum
 * oder — wenn eines fehlt — gleiche Mail. „möglich“ (nur Hinweis): gleicher Name, sonst nichts,
 * was widerspricht (Vater und Sohn ohne Geburtsdatum). Eine gemeinsame Mail allein zählt nicht:
 * Paare tragen oft dieselbe Familienadresse ein. Zwei Karten desselben Bestandsmieters
 * entdoppelt aktivierungsDaten() selbst.
 */
export function gleichePersonGrad(a: EntwurfPerson, b: EntwurfPerson): 'sicher' | 'moeglich' | null {
  if (a.mieterId && b.mieterId) return null;
  if (!gleicherName(a.vorname, b.vorname) || !gleicherName(a.nachname, b.nachname)) return null;
  const gebA = a.geburtsdatum?.trim() || null;
  const gebB = b.geburtsdatum?.trim() || null;
  if (gebA && gebB) return gebA === gebB ? 'sicher' : null;
  const mailA = a.email?.trim().toLowerCase() || null;
  const mailB = b.email?.trim().toLowerCase() || null;
  if (mailA && mailB && mailA === mailB) return 'sicher';
  return 'moeglich';
}

export function istGleichePerson(a: EntwurfPerson, b: EntwurfPerson): boolean {
  return gleichePersonGrad(a, b) === 'sicher';
}

/** Was eine Personenkarte von einem vorhandenen Mieter übernimmt. */
export type BestandsMieter = Pick<
  Tables<'mieter'>,
  | 'id'
  | 'vorname'
  | 'nachname'
  | 'geburtsdatum'
  | 'hauptmail'
  | 'telnr'
  | 'anrede'
  | 'strasse'
  | 'hausnummer'
  | 'plz'
  | 'ort'
  | 'ist_unternehmen'
  | 'firmenname'
  | 'vertreten_durch'
>;

/** Leerer Text im Bestand zählt wie keine Angabe. */
function angabe(s: string | null | undefined): string | null {
  return s?.trim() ? s : null;
}

/**
 * Vorhandenen Mieter in eine Personenkarte übernehmen: seine Stammdaten zählen,
 * leere Felder füllt die Karte. Die Anschrift vor Einzug kommt zuerst aus der
 * Karte (Selbstauskunft), denn im Bestand steht meist keine.
 */
export function mitBestandsmieter(p: EntwurfPerson, m: BestandsMieter): EntwurfPerson {
  // Ein Firmenmieter ohne firmenname fiele beim Aktivieren still heraus (hatNamen) —
  // sein Name steht dann wie bei jedem Firmenmieter in Vor- und Nachname
  const firmaAusNamen = m.ist_unternehmen
    ? angabe([m.vorname, m.nachname].filter(n => angabe(n) && n !== '(Firma)').join(' '))
    : null;
  return {
    ...p,
    mieterId: m.id,
    quelle: 'bestand',
    vorname: angabe(m.vorname) ?? p.vorname,
    nachname: angabe(m.nachname) ?? p.nachname,
    istUnternehmen: m.ist_unternehmen ?? false,
    firmenname: angabe(m.firmenname) ?? firmaAusNamen ?? p.firmenname,
    vertretenDurch: angabe(m.vertreten_durch) ?? p.vertretenDurch ?? null,
    anrede: (m.anrede as Anrede | null) ?? p.anrede,
    geburtsdatum: m.geburtsdatum ?? p.geburtsdatum,
    email: angabe(m.hauptmail) ?? p.email,
    telefon: angabe(m.telnr) ?? p.telefon,
    strasse: p.strasse ?? angabe(m.strasse),
    hausnummer: p.hausnummer ?? angabe(m.hausnummer),
    plz: p.plz ?? angabe(m.plz),
    ort: p.ort ?? angabe(m.ort),
    // Genau wie mieterZeile() normalisiert — sonst gälten unveränderte Felder als geändert
    // (bei Firmen ist die Anrede immer „Firma“, es gibt kein Geburtsdatum; Vertretung nur bei Firmen)
    bestandStand: {
      anrede: m.ist_unternehmen ? 'Firma' : (m.anrede ?? null),
      hauptmail: m.hauptmail?.trim() || null,
      telnr: m.telnr?.trim() || null,
      geburtsdatum: m.ist_unternehmen ? null : m.geburtsdatum?.trim() || null,
      vertreten_durch: m.ist_unternehmen ? m.vertreten_durch?.trim() || null : null,
      strasse: m.strasse?.trim() || null,
      hausnummer: m.hausnummer?.trim() || null,
      plz: m.plz?.trim() || null,
      ort: m.ort?.trim() || null,
    },
  };
}

/**
 * Suchwörter. Rufnummern stehen meist mit Leerzeichen da („+49 511 49 12 345") —
 * aufeinanderfolgende Ziffernwörter zählen als eines, sonst passt „+49" allein auf
 * nichts. Wörter ohne Buchstaben und Ziffern („Hans - Weiß") fallen weg.
 */
function suchwoerter(suchbegriff: string): string[] {
  const woerter: string[] = [];
  for (const w of suchbegriff.trim().split(/\s+/)) {
    if (!/[\p{L}\d@]/u.test(w)) continue;
    const vorher = woerter[woerter.length - 1];
    const ziffernwort = /^[\d+()/-]+$/.test(w);
    if (ziffernwort && vorher !== undefined && /^[\d+()/ -]+$/.test(vorher)) {
      woerter[woerter.length - 1] = `${vorher} ${w}`;
    } else {
      woerter.push(w);
    }
  }
  return woerter;
}

/**
 * Suche für „Bestehenden Mieter wählen" (27.10.2026: neue und bestehende Mieter
 * sollen in einem Vertrag zusammen stehen können). Jedes Suchwort muss in Name,
 * Firma, Mail oder Telefon vorkommen; Umlaute wie bei der Dublettenprüfung.
 * Ohne Suchwort kommt der ganze Bestand, nach Nachnamen sortiert.
 */
export function sucheMieter<M extends Pick<Tables<'mieter'>, 'id' | 'vorname' | 'nachname' | 'firmenname' | 'hauptmail' | 'telnr'>>(
  mieter: M[],
  suchbegriff: string,
  ohne: ReadonlySet<string> = new Set()
): M[] {
  const woerter = suchwoerter(suchbegriff);
  return mieter
    .filter(m => !ohne.has(m.id))
    .filter(m => {
      const namen = [m.vorname, m.nachname, m.firmenname].flatMap(namensformen).filter(Boolean);
      const mail = m.hauptmail?.trim().toLowerCase() ?? '';
      const tel = ziffern(m.telnr);
      return woerter.every(w => {
        if (namensformen(w).some(f => f !== '' && namen.some(n => n.includes(f)))) return true;
        if (mail.includes(w.toLowerCase())) return true;
        // Nur mit Vorwahlzeichen umschreiben — sonst würde aus „4912" mitten in der Nummer „012"
        const z = /^(\+|00)/.test(w) ? ziffern(w) : w.replace(/\D/g, '');
        return z.length >= 3 && tel.includes(z);
      });
    })
    .sort(
      (a, b) =>
        (a.nachname ?? '').localeCompare(b.nachname ?? '', 'de') || (a.vorname ?? '').localeCompare(b.vorname ?? '', 'de')
    );
}

/** Verträge eines Mieters, soweit die Auswahl sie zum Unterscheiden zeigt. */
export interface MieterVertragsbezug {
  mietvertrag:
    | (Pick<Tables<'mietvertrag'>, 'status' | 'start_datum' | 'ende_datum' | 'kuendigungsdatum'> & {
        einheiten: (Pick<Tables<'einheiten'>, 'einheitentyp'> & { immobilien: Pick<Tables<'immobilien'>, 'name'> | null }) | null;
      })
    | null;
}

function tagDe(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-');
  return `${t}.${m}.${j}`;
}

/**
 * Wo wohnt oder wohnte der Mieter? Im Bestand stehen weder Anschrift noch meist
 * ein Geburtsdatum (27.10.2026: 0 bzw. 39 von 145 Mietern) — zwei gleiche Namen
 * unterscheidet erst das Objekt.
 */
export function mieterBezug(bezuege: MieterVertragsbezug[] | null | undefined, stichtag: Date = new Date()): string | null {
  const vertraege = (bezuege ?? []).map(b => b.mietvertrag).filter((v): v is NonNullable<typeof v> => !!v);
  const mietsache = (v: (typeof vertraege)[number]) =>
    [v.einheiten?.immobilien?.name, v.einheiten?.einheitentyp].filter(Boolean).join(', ') || 'Einheit ohne Angabe';

  const laufend = vertraege.filter(v => istLaufenderVertrag(v, stichtag));
  if (laufend.length > 0) return `aktuell: ${[...new Set(laufend.map(mietsache))].join('; ')}`;

  const tag = alsIsoTag(stichtag);
  const kuenftig = vertraege
    .filter(v => (v.status === 'aktiv' || v.status === 'gekuendigt') && !!v.start_datum && v.start_datum > tag)
    .sort((a, b) => a.start_datum!.localeCompare(b.start_datum!));
  if (kuenftig.length > 0) return `ab ${tagDe(kuenftig[0].start_datum!)}: ${mietsache(kuenftig[0])}`;

  const frueher = vertraege
    .map(v => ({ v, ende: getVertragsende(v) }))
    .filter((x): x is { v: (typeof vertraege)[number]; ende: string } => !!x.ende)
    .sort((a, b) => b.ende.localeCompare(a.ende));
  if (frueher.length > 0) return `bis ${tagDe(frueher[0].ende)}: ${mietsache(frueher[0].v)}`;
  // Beendet, aber ohne Datum (Altbestand)
  return vertraege.length > 0 ? `früher: ${mietsache(vertraege[0])}` : null;
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
    // '' in einer DATE-Spalte ließe Anlegen und Aktivieren scheitern
    geburtsdatum: p.istUnternehmen ? null : p.geburtsdatum?.trim() || null,
    ist_unternehmen: p.istUnternehmen,
    firmenname: p.istUnternehmen ? p.firmenname?.trim() || null : null,
    vertreten_durch: p.istUnternehmen ? p.vertretenDurch?.trim() || null : null,
    strasse: p.strasse?.trim() || null,
    hausnummer: p.hausnummer?.trim() || null,
    plz: p.plz?.trim() || null,
    ort: p.ort?.trim() || null,
  };
}

/** Schlüsselarten wie in `mietvertrag.schluessel` (Schlüssel → Anzeige im Vertrag). */
export const SCHLUESSEL_ARTEN: { key: string; name: string }[] = [
  { key: 'haustuer', name: 'Haustürschlüssel' },
  { key: 'wohnung', name: 'Wohnungsschlüssel' },
  { key: 'briefkasten', name: 'Briefkastenschlüssel' },
  { key: 'keller', name: 'Kellerschlüssel' },
  { key: 'garage', name: 'Garagenschlüssel' },
  { key: 'transponder', name: 'Transponder' },
];

/** Schlüsselaufstellung für die Spalte `mietvertrag.schluessel`. */
export function schluesselFuerDb(schluessel: MietvertragDaten['schluessel']): Record<string, number> {
  // Map statt Objekt: eine Art „constructor" träfe sonst die geerbte Eigenschaft
  const ergebnis = new Map<string, number>();
  for (const s of schluessel) {
    const anzahl = Math.round(s.anzahl);
    if (!(anzahl > 0)) continue;
    const key =
      SCHLUESSEL_ARTEN.find(a => a.name === s.art)?.key ??
      s.art.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) continue;
    ergebnis.set(key, (ergebnis.get(key) ?? 0) + anzahl);
  }
  return Object.fromEntries(ergebnis);
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
    ende_datum: d.vertragsende || null,
    befristungsgrund: d.befristungsgrund,
    befristungsgrund_text: d.befristungsgrundText,
    kuendigungsverzicht_bis: d.kuendigungsverzichtBis || null,
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
    // Ohne Lastschrift gehören keine Kontodaten des Mieters an den Vertrag
    bankkonto_mieter: (d.lastschrift && d.lastschriftIban?.replace(/\s+/g, '')) || null,
    bankkonto_mieter_bic: (d.lastschrift && d.lastschriftBic?.trim()) || null,
    kontoinhaber: (d.lastschrift && d.lastschriftKontoinhaber?.trim()) || null,
    sepa_mandatsreferenz: (d.lastschrift && d.sepaMandatsreferenz?.trim()) || null,
    ruecklastschrift_gebuehr: RUECKLASTSCHRIFT_GEBUEHR_EUR,

    mietanpassung_art: d.mietanpassungArt,
    // Nur die gewählte Anpassungsart — ein liegengebliebener Staffelplan gilt nicht neben einer Indexmiete
    staffelplan: d.mietanpassungArt === 'staffel' ? d.staffelplan?.map(s => ({ gueltig_ab: s.gueltigAb, kaltmiete: s.kaltmiete })) ?? null : null,
    index_basis_wert: d.mietanpassungArt === 'index' ? d.indexBasisWert : null,
    index_basis_monat: d.mietanpassungArt === 'index' ? d.indexBasisMonat : null,

    anzahl_personen: d.anzahlPersonen > 0 ? d.anzahlPersonen : null,
    schluessel: schluesselFuerDb(d.schluessel),
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

/**
 * Angaben eines Bestandsmieters, wie sie auf der Karte stehen. Die Aktivierung
 * übernimmt daraus, was neu oder geändert ist — leere Felder löschen nichts, und
 * eine vorhandene Anschrift bleibt (sie kann die eines anderen Vertrags sein).
 */
export type BestandsStammdaten = Pick<
  TablesInsert<'mieter'>,
  'anrede' | 'hauptmail' | 'telnr' | 'geburtsdatum' | 'vertreten_durch' | 'strasse' | 'hausnummer' | 'plz' | 'ort'
>;

export interface AktivierungsDaten {
  vertrag: TablesInsert<'mietvertrag'>;
  /** Neu anzulegende Mieter; `schluessel` verbindet sie mit der Verknüpfung. */
  neueMieter: { schluessel: string; zeile: TablesInsert<'mieter'> }[];
  verknuepfungen: {
    mieter_id: string | null;
    schluessel: string;
    rolle: Tables<'mietvertrag_mieter'>['rolle'];
    position: number;
    /** Nur bei Bestandsmietern: Kartenangaben für die Stammdaten (seit 27.10.2026). */
    stammdaten?: BestandsStammdaten;
  }[];
}

/**
 * Kartenangaben eines Bestandsmieters in Spaltenform — wie bei einem neuen Mieter.
 *
 * Nur, was auf der Karte ergänzt oder geändert wurde: Ein Feld, das noch so steht, wie es
 * bei der Übernahme aus dem Bestand kam, geht nicht mit. Bis zum 27.10.2026 gingen alle
 * Felder mit, und ein Entwurf, der Tage lag, schrieb eine inzwischen im Bestand geänderte
 * Mail oder Rufnummer still auf den alten Stand zurück — Mahnungen gingen dann an die alte
 * Adresse. Karten ohne `bestandStand` (vor diesem Tag gespeichert) geben weiter alles mit.
 */
export function bestandsStammdaten(p: EntwurfPerson): BestandsStammdaten {
  const { anrede, hauptmail, telnr, geburtsdatum, vertreten_durch, strasse, hausnummer, plz, ort } = mieterZeile(p);
  const karte: BestandsStammdaten = { anrede, hauptmail, telnr, geburtsdatum, vertreten_durch, strasse, hausnummer, plz, ort };
  const stand = p.bestandStand;
  if (!stand) return karte;
  return Object.fromEntries(
    Object.entries(karte).filter(([feld, wert]) => (wert ?? null) !== (stand[feld as keyof BestandsStammdaten] ?? null))
  ) as BestandsStammdaten;
}

/**
 * Was `aktiviere_mietvertrag_entwurf` in einer Transaktion anlegt. Leere
 * Personenkarten fallen weg, ein zweimal gewählter Bestandsmieter zählt einmal.
 * Bestandsmieter bringen ihre Kartenangaben mit — bis zum 27.10.2026 landete eine
 * dort geänderte Mail oder Rufnummer nur im Vertrag, nie in den Stammdaten.
 */
export function aktivierungsDaten(a: VertragsZeileArgs & { personen: EntwurfPerson[] }): AktivierungsDaten {
  const gesehen = new Set<string>();
  const parteien = a.personen.filter(p => {
    if (p.rolle !== 'mitmieter' || !hatNamen(p)) return false;
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
      ...(p.mieterId ? { stammdaten: bestandsStammdaten(p) } : {}),
    })),
  };
}

/**
 * Ausgangswert einer Indexmiete: der zuletzt veröffentlichte VPI (2020 = 100)
 * aus `marktdaten`. Bei Vertragsschluss gilt der dann aktuelle Stand.
 */
export function indexVorschlag(vpi: { wert: number | string | null; stichtag: string | null } | null): {
  wert: number;
  monat: string;
} | null {
  if (!vpi?.stichtag || vpi.wert === null || vpi.wert === undefined) return null;
  const wert = Number(vpi.wert);
  if (!Number.isFinite(wert) || wert <= 0) return null;
  return { wert, monat: `${vpi.stichtag.slice(0, 7)}-01` };
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
