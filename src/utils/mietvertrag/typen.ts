/**
 * Datentypen für die Vertragserzeugung.
 *
 * Die Struktur folgt den 126 Platzhaltern, die aus 14 echten NiImmo-Verträgen
 * abgeleitet wurden. Alles, was der Vertrag aussagt, muss hier herkommen —
 * der Generator rät nichts und setzt keine Ersatzwerte ein.
 */

export type Vertragsart = 'wohnraum' | 'gewerbe' | 'stellplatz' | 'sonstiges';
export type BetriebskostenModus = 'vorauszahlung' | 'pauschale' | 'inklusiv';
export type Uebergabezustand = 'renoviert' | 'teilrenoviert' | 'unrenoviert';
export type KautionArt = 'barkaution' | 'buergschaft' | 'verpfaendung' | 'sparbuch' | 'keine';
export type MietanpassungArt = 'keine' | 'staffel' | 'index';
export type Befristungsgrund = 'eigenbedarf' | 'bauliche_massnahme' | 'dienstwohnung';
export type SchliessanlageArt = 'einzel' | 'zentral';
export type Anrede = 'Herr' | 'Frau' | 'Divers' | 'Firma';
export type Vertretungsart = 'einzel' | 'gesamt';
export type Heizungsart = 'zentral' | 'etage' | 'fernwaerme' | 'keine';

export interface VermieterDaten {
  firmenname: string;
  rechtsform: string | null;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  vertretenDurch: string[];
  vertretungArt: Vertretungsart;
  registergericht: string | null;
  handelsregister: string | null;
  steuernummer: string | null;
  ustId: string | null;
  telefon: string | null;
  fax: string | null;
  email: string | null;
  /** Konto, auf das Miete und Betriebskosten gehen. */
  mietIban: string | null;
  mietBic: string | null;
  /** Getrenntes Kautionskonto nach § 551 Abs. 3 BGB. Leer = es gibt keins. */
  kautionIban: string | null;
  kautionBic: string | null;
  stammdatenGeprueft: boolean;
}

export interface MieterDaten {
  anrede: Anrede | null;
  vorname: string;
  nachname: string;
  istUnternehmen: boolean;
  firmenname: string | null;
  vertretenDurch: string | null;
  /** Anschrift VOR Einzug — im Rubrum als „zur Zeit wohnhaft in". */
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  geburtsdatum: string | null;
  telefon: string | null;
  email: string | null;
}

export interface ObjektDaten {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  ortsteil: string | null;
  /** Gebiet mit angespanntem Wohnungsmarkt — löst die Mietpreisbremse aus. */
  istAngespannt: boolean;
  heizungsart: Heizungsart;
  heizkostenSchluessel: string;
  energieausweisTyp: 'bedarf' | 'verbrauch' | null;
  energieKennwert: number | null;
  energietraeger: string | null;
  energieausweisGueltigBis: string | null;
  energieeffizienzklasse: string | null;
}

export interface EinheitDaten {
  /** „WE 12" — die Kennung, wie sie auch im Verwendungszweck auftaucht. */
  bezeichnung: string;
  /** Lage im Gebäude, z. B. „Haus rechts, Dachgeschoss rechts". */
  lage: string;
  wohnflaecheQm: number;
  anzahlZimmer: number | null;
  /** Ausformulierte Raumaufstellung für § 1, z. B. „3,5 Zimmer, 1 Küche, 1 Bad". */
  raumaufstellung: string;
  nebenraeume: string | null;
  einbaukueche: boolean;
}

export interface StaffelStufe {
  gueltigAb: string;
  kaltmiete: number;
}

export interface BetriebskostenPosition {
  /** Nummer nach BetrKV, z. B. „2.1". */
  nummer: string;
  bezeichnung: string;
  /** Wird diese Position umgelegt? */
  umgelegt: boolean;
  /** qm | personen | einheit | verbrauch | nutzer */
  schluessel: string;
  /**
   * Monatlicher Vorauszahlungsanteil dieser Position in Euro.
   * `null` heißt: Position ist benannt, aber ohne eigenen Betrag ausgewiesen.
   * Die Summe aller Beträge muss `betriebskostenVorauszahlung` ergeben —
   * `pflichtpruefung` blockiert den Druck, wenn die Spalte nicht aufgeht.
   */
  betrag: number | null;
}

export interface SchluesselAngabe {
  art: string;
  anzahl: number;
}

export interface MietvertragDaten {
  vertragsart: Vertragsart;

  vermieter: VermieterDaten;
  mieter: MieterDaten[];
  objekt: ObjektDaten;
  einheit: EinheitDaten;
  /** Mitvermietete Nebenobjekte, z. B. Garage oder Stellplatz. */
  nebenobjekte: { bezeichnung: string; lage: string; teilmiete: number | null }[];

  mietbeginn: string;
  /** Nur bei Befristung; ohne Grund darf nicht befristet werden (§ 575 BGB). */
  vertragsende: string | null;
  befristungsgrund: Befristungsgrund | null;
  befristungsgrundText: string | null;
  kuendigungsverzichtBis: string | null;
  uebergabeDatum: string | null;

  kaltmiete: number;
  betriebskostenModus: BetriebskostenModus;
  betriebskostenVorauszahlung: number;
  heizkostenVorauszahlung: number | null;
  betriebskostenPositionen: BetriebskostenPosition[];
  abrechnungszeitraum: string;

  kautionBetrag: number;
  kautionArt: KautionArt;
  kautionRaten: number;

  faelligkeitWerktag: number;
  lastschrift: boolean;
  lastschriftKontoinhaber: string | null;
  lastschriftIban: string | null;
  lastschriftBic: string | null;
  sepaMandatsreferenz: string | null;

  mietanpassungArt: MietanpassungArt;
  staffelplan: StaffelStufe[] | null;
  indexBasisWert: number | null;
  indexBasisMonat: string | null;

  anzahlPersonen: number;
  schluessel: SchluesselAngabe[];
  schliessanlageArt: SchliessanlageArt | null;
  mitbenutzungEinrichtungen: string | null;

  uebergabezustand: Uebergabezustand;
  /** Nur bei uebergabezustand = 'renoviert' zulässig (BGH VIII ZR 185/14). */
  schoenheitsreparaturen: boolean;
  kleinreparaturEinzelgrenze: number;
  kleinreparaturJahresgrenzeProzent: number;

  /** Mietpreisbremse: Vormiete für die Ausnahme nach § 556e Abs. 1 BGB. */
  vormieteNetto: number | null;
  vormieteBis: string | null;
  mietpreisbremseAuskunftAm: string | null;

  /** Besichtigung schließt das Widerrufsrecht aus (§ 312 Abs. 4 S. 2 BGB). */
  besichtigtAm: string | null;

  zusatzvereinbarungen: string | null;

  vertragsdatum: string | null;
  unterschriftOrt: string | null;

  /** Anlagen, die mitgedruckt werden. */
  anlagen: {
    hausordnung: boolean;
    betrkvKatalog: boolean;
    widerrufsbelehrung: boolean;
    datenschutzhinweis: boolean;
    mietspiegelEinwilligung: boolean;
  };
}

/** Fassung der Klauseltexte. Wandert in mietvertrag.vorlage_version. */
export const VORLAGE_VERSION = 'wohnraum-2026.1';
