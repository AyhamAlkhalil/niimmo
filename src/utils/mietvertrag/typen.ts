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
export type Warmwasserart = 'zentral' | 'dezentral';

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
  /** Am Objekt gepflegt (`immobilien.heizungsart`). Leer = Vertrag wird nicht erzeugt. */
  heizungsart: Heizungsart | null;
  /** Zentral über die Heizung oder dezentral in der Wohnung. Leer = Vertrag wird nicht erzeugt. */
  warmwasser: Warmwasserart | null;
  /** Bezugsgröße der Umlage nach Fläche; wird in § 1 genannt, wenn gepflegt. */
  gesamtwohnflaecheQm: number | null;
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
  /** qm | personen | gleich | verbrauch (seit 10.11.2026); in älteren Daten auch einheit | nutzer */
  schluessel: string;
  /**
   * Schlüssel, nach dem die Betriebskostenabrechnung des Objekts verteilt —
   * nur zum Vergleich, wird nicht mit dem Vertrag gespeichert.
   */
  schluesselObjekt?: string;
  /**
   * Monatlicher Vorauszahlungsanteil dieser Position in Euro.
   * `null` heißt: Position ist benannt, aber ohne eigenen Betrag ausgewiesen.
   * Die Summe aller Beträge muss `betriebskostenVorauszahlung` ergeben —
   * `pflichtpruefung` blockiert den Druck, wenn die Spalte nicht aufgeht.
   */
  betrag: number | null;
  /**
   * Nur bei sonstigen Betriebskosten (2.19 und weitere ab 2.20): was genau
   * umgelegt wird, z. B. „Lüftungsanlage“ (seit 03.11.2026). Unbenannt sind
   * sonstige Betriebskosten nicht umlagefähig.
   */
  benennung?: string | null;
}

/** Letzte feste Position der Hausvorlage; ab hier folgen weitere sonstige Betriebskosten. */
export const SONSTIGE_NUMMER = '2.19';

/** Sonstige Betriebskosten: 2.19 und die von Hand angefügten ab 2.20. */
export function istSonstigePosition(nummer: string): boolean {
  const m = /^2\.(\d+)$/.exec(nummer.trim());
  return !!m && Number(m[1]) >= 19;
}

/** Die Zeile, wie sie im Vertrag steht: „Sonstige Betriebskosten: Lüftungsanlage“. */
export function positionsText(pos: Pick<BetriebskostenPosition, 'nummer' | 'bezeichnung' | 'benennung'>): string {
  const benennung = istSonstigePosition(pos.nummer) ? pos.benennung?.trim() : '';
  return benennung ? `${pos.bezeichnung}: ${benennung}` : pos.bezeichnung;
}

/** Nächste freie Nummer für eine weitere sonstige Position (2.20, 2.21, …). */
export function naechsteSonstigeNummer(positionen: readonly Pick<BetriebskostenPosition, 'nummer'>[]): string {
  const hoechste = positionen.reduce((max, p) => {
    const m = /^2\.(\d+)$/.exec(p.nummer.trim());
    return m ? Math.max(max, Number(m[1])) : max;
  }, 19);
  return `2.${hoechste + 1}`;
}

/** Für den Schnappschuss am Vertrag: die Benennung nur, wo es eine gibt. */
export function positionFuerDb(p: BetriebskostenPosition) {
  const benennung = istSonstigePosition(p.nummer) ? p.benennung?.trim() : '';
  return {
    nummer: p.nummer,
    bezeichnung: p.bezeichnung,
    schluessel: p.schluessel,
    umgelegt: p.umgelegt,
    betrag: p.betrag,
    ...(benennung ? { benennung } : {}),
  };
}

/**
 * Verteilerschlüssel, die die Betriebskostenabrechnung rechnen kann — nur diese
 * bietet der Vertrag zur Auswahl an. Die Namen stehen so auch in § 4.
 */
export const VERTEILERSCHLUESSEL: { key: string; name: string }[] = [
  { key: 'qm', name: 'Wohnfläche' },
  { key: 'personen', name: 'Personenzahl' },
  { key: 'gleich', name: 'Einheit zu gleichen Teilen' },
  // Seit 10.11.2026 (Kundenmeldung „da fehlt die Option: Nach tatsächlichem Verbrauch“): Die Abrechnung erfasst den
  // Verbrauch je Nutzungsperiode in Schritt 2 und sperrt, solange einer fehlt (utils/nebenkostenVerbrauch.ts)
  { key: 'verbrauch', name: 'tatsächlichem Verbrauch' },
];

/** Altwerte gleicher Bedeutung zusammenführen: „einheit" verteilt wie „gleich". */
export function gleicherSchluessel(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s === 'einheit' ? 'gleich' : s ?? '');
  return n(a) === n(b);
}

const ALTE_SCHLUESSEL = new Map([
  ['einheit', 'Einheit zu gleichen Teilen'],
  ['nutzer', 'Nutzerzahl'],
  ['individuell', 'gesonderter Vereinbarung'],
]);

export function verteilerschluesselName(s: string): string {
  return VERTEILERSCHLUESSEL.find(v => v.key === s)?.name ?? ALTE_SCHLUESSEL.get(s) ?? s;
}

/** Kurzform für die Spalte „Verteilung“ der Kostentabelle in § 4 (seit 04.11.2026). */
export function verteilungKurz(s: string): string {
  if (s === 'gleich' || s === 'einheit') return 'je Einheit';
  if (s === 'verbrauch') return 'Verbrauch';
  if (s === 'nutzer') return 'Nutzerzahl';
  if (s === 'individuell') return 'Vereinbarung';
  return verteilerschluesselName(s);
}

export interface SchluesselAngabe {
  art: string;
  anzahl: number;
  /**
   * Von Hand benannt (seit 03.11.2026, etwa „Müllplatzschlüssel“). Solche Zeilen
   * dürfen beim Bearbeiten noch ohne Namen oder mit 0 dastehen — in den Vertrag
   * kommt nur, was `ausgehaendigteSchluessel` durchlässt.
   */
  frei?: boolean;
}

/**
 * Was im Vertrag steht und gespeichert wird: nur benannte Schlüssel mit Anzahl.
 * Gleich benannte Zeilen werden zusammengezählt — sonst stünden im Vertrag zwei
 * Zeilen, in der Spalte `mietvertrag.schluessel` aber eine Summe (Review 03.11.2026).
 */
export function ausgehaendigteSchluessel(liste: readonly SchluesselAngabe[]): SchluesselAngabe[] {
  const summe = new Map<string, number>();
  for (const s of liste) {
    const art = s.art.trim();
    const anzahl = Math.round(s.anzahl);
    if (!/[\p{L}\p{N}]/u.test(art) || !(anzahl > 0)) continue;
    summe.set(art, (summe.get(art) ?? 0) + anzahl);
  }
  return [...summe].map(([art, anzahl]) => ({ art, anzahl }));
}

export interface MietvertragDaten {
  vertragsart: Vertragsart;

  vermieter: VermieterDaten;
  /**
   * Wer bei Einzelvertretung für den Vermieter unterschreibt — einer der Namen aus
   * `vermieter.vertretenDurch` (seit 03.11.2026). Steht neben `vermieter`, weil der
   * Entwurf die Vermieterangaben bei jedem Öffnen frisch aus den Stammdaten lädt.
   */
  unterzeichnerVermieter?: string | null;
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
// 2026.2 (05.11.2026): Seitenbild der Word-Vorlage, § 24 entfallen, § 14 aus der Vorlage, Kautionskonto
// 2026.3 (08.11.2026): § 5 Wertsicherungsklausel im Wortlaut der Vorlage, Titel im Kopf, Anlage 2 = Verordnung
export const VORLAGE_VERSION = 'wohnraum-2026.3';
