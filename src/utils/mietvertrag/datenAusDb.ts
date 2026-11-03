/**
 * Datenbankzeilen → Vertragsdaten für den Generator.
 *
 * Gemeinsame Grundlage für zwei Wege: den bestehenden Vertrag
 * (`useMietvertragPdfDaten`) und den neuen Vertragsentwurf
 * (`utils/mietvertrag/entwurf.ts`). Beide sollen dieselben Werte aus Objekt,
 * Einheit und Vermieter lesen — sonst druckt der Entwurf etwas anderes als
 * später der Nachdruck.
 *
 * Bewusst ohne Ersatzwerte: Fehlt eine Angabe, bleibt sie leer und die
 * Pflichtprüfung schlägt an. Der Vertrag darf nichts behaupten, was nicht
 * erfasst ist.
 */
import {
  BETRKV_KATEGORIEN,
  findeKategorieNachName,
  istBerechenbarerSchluessel,
} from '@/components/dashboard/nebenkosten/nebenkostenKategorien';
import type { Tables } from '@/integrations/supabase/types';
import type {
  BetriebskostenPosition,
  EinheitDaten,
  Heizungsart,
  MieterDaten,
  MietvertragDaten,
  ObjektDaten,
  SchluesselAngabe,
  StaffelStufe,
  VermieterDaten,
  Warmwasserart,
} from './typen';
import { istSonstigePosition } from './typen';

type Immobilie = Tables<'immobilien'>;
type Einheit = Tables<'einheiten'>;
type Vermieter = Tables<'vermieter'>;
type Mieter = Tables<'mieter'>;
type Vertrag = Tables<'mietvertrag'>;
type Nebenkostenart = Pick<Tables<'nebenkostenarten'>, 'name' | 'verteilerschluessel_art' | 'ist_umlagefaehig'>;

/**
 * Kostenarten in der Nummerierung der NiImmo-Hausvorlage.
 *
 * Sie geht bis 2.19 und weicht damit bewusst von der BetrKV ab, die unter
 * 2.17 nur „sonstige Betriebskosten" kennt: Rauchwarnmelder und Abgasmessung
 * sind dort eigene Zeilen. Genau so muessen sie im Vertrag stehen — nicht
 * benannte sonstige Betriebskosten sind nach § 556 Abs. 1 BGB nicht
 * umlagefaehig, eine Sammelzeile „sonstige" traegt also nichts.
 *
 * `kategorie` ist die Kostenart der Betriebskostenabrechnung, unter der diese
 * Kosten gebucht werden; deren Verteilerschlüssel gilt auch im Vertrag
 * (02.11.2026). Die Abrechnung muss dem vereinbarten Schlüssel folgen und kennt
 * nur Wohnfläche, Personen und Einheit. Bis dahin druckte der Vertrag eigene
 * Vorgaben — Wasser „nach erfasstem Verbrauch", Kabel „nach Nutzerzahl" —,
 * während die Abrechnung nach Personentagen und Einheiten verteilte.
 * Rauchwarnmelder laufen dort unter „Sonstige Betriebskosten", die
 * Abgasmessung unter der Schornsteinreinigung (Kehr- und Messgebühren).
 */
const POSITIONEN: { nummer: string; bezeichnung: string; kategorie: string }[] = [
  { nummer: '2.1', bezeichnung: 'Laufende öffentliche Lasten des Grundstücks (Grundsteuer)', kategorie: 'grundsteuer' },
  { nummer: '2.2', bezeichnung: 'Kosten der Wasserversorgung', kategorie: 'wasserversorgung' },
  { nummer: '2.3', bezeichnung: 'Kosten der Entwässerung', kategorie: 'entwaesserung' },
  { nummer: '2.4', bezeichnung: 'Kosten des Betriebs und der Wartung der Heizungsanlage', kategorie: 'heizkosten' },
  { nummer: '2.5', bezeichnung: 'Kosten des Betriebs und der Wartung der Warmwasserversorgung', kategorie: 'warmwasserkosten' },
  { nummer: '2.6', bezeichnung: 'Kosten verbundener Heizungs- und Warmwasserversorgungsanlagen', kategorie: 'verbundene_anlagen' },
  { nummer: '2.7', bezeichnung: 'Kosten des Betriebs des Personen- oder Lastenaufzugs', kategorie: 'aufzug' },
  { nummer: '2.8', bezeichnung: 'Kosten der Straßenreinigung und Müllbeseitigung', kategorie: 'strassenreinigung_muell' },
  { nummer: '2.9', bezeichnung: 'Kosten der Gebäudereinigung und Ungezieferbekämpfung', kategorie: 'gebaeudereinigung' },
  { nummer: '2.10', bezeichnung: 'Kosten der Gartenpflege', kategorie: 'gartenpflege' },
  { nummer: '2.11', bezeichnung: 'Kosten der Beleuchtung', kategorie: 'beleuchtung' },
  { nummer: '2.12', bezeichnung: 'Kosten der Schornsteinreinigung', kategorie: 'schornsteinreinigung' },
  { nummer: '2.13', bezeichnung: 'Kosten der Sach- und Haftpflichtversicherung', kategorie: 'versicherungen' },
  { nummer: '2.14', bezeichnung: 'Kosten für den Hauswart', kategorie: 'hauswart' },
  { nummer: '2.15', bezeichnung: 'Kosten für Antennen- und Kabelanschluss', kategorie: 'antenne_kabel' },
  { nummer: '2.16', bezeichnung: 'Kosten des Betriebs der Einrichtungen für die Wäschepflege', kategorie: 'waeschepflege' },
  { nummer: '2.17', bezeichnung: 'Kosten des Betriebs der Rauchwarnmeldeeinrichtung', kategorie: 'sonstige_betriebskosten' },
  { nummer: '2.18', bezeichnung: 'Kosten der Abgasmessung', kategorie: 'schornsteinreinigung' },
  { nummer: '2.19', bezeichnung: 'Sonstige Betriebskosten', kategorie: 'sonstige_betriebskosten' },
];

/** Verbindliche Kundenvorgabe der Abrechnung für eine Kostenart. */
function vorgabeSchluessel(kategorie: string): string {
  return BETRKV_KATEGORIEN.find(k => k.id === kategorie)?.schluessel ?? 'qm';
}

export const BETRKV_STANDARD: { nummer: string; bezeichnung: string; kategorie: string; schluessel: string }[] =
  POSITIONEN.map(p => ({ ...p, schluessel: vorgabeSchluessel(p.kategorie) }));

/**
 * Schlüssel, nach dem die Betriebskostenabrechnung dieses Objekts die
 * Kostenart verteilt — mit derselben Zuordnung und derselben Rangfolge wie
 * Schritt 3 der Abrechnung: der an der Nebenkostenart gepflegte, sonst die
 * Kundenvorgabe. Einen dort nicht berechenbaren Altwert rechnet die Abrechnung
 * nach Wohnfläche, also steht er auch hier so.
 *
 * Mehrere Arten einer Kostenart („Heizung" und „Heizkosten"): Die Abrechnung
 * nimmt den Schlüssel der Art, an der die erste Kostenposition hängt. Hier
 * zählen nur umlagefähige Arten, und ein gepflegter Schlüssel geht einer Art
 * ohne Schlüssel vor (Review 02.11.2026). Live hatten alle Doppelungen
 * denselben Schlüssel.
 */
export function schluesselDesObjekts(nebenkostenarten: Nebenkostenart[], kategorie: string): string {
  const gepflegt = nebenkostenarten.find(
    n => n.ist_umlagefaehig !== false && !!n.verteilerschluessel_art && findeKategorieNachName(n.name)?.id === kategorie
  )?.verteilerschluessel_art;
  if (!gepflegt) return vorgabeSchluessel(kategorie);
  return istBerechenbarerSchluessel(gepflegt) ? gepflegt : 'qm';
}

/** Eine im Vertrag gespeicherte Position — Schnappschuss aus der Datenbank. */
interface GespeichertePosition {
  nummer?: string;
  bezeichnung?: string;
  schluessel?: string;
  umgelegt?: boolean;
  betrag?: number | string | null;
  benennung?: string | null;
}

/** Kostenart der Abrechnung zu einer Vertragsposition; weitere sonstige (ab 2.20) wie 2.19. */
function kategorieDerPosition(nummer: string): string | undefined {
  return (
    BETRKV_STANDARD.find(s => s.nummer === nummer)?.kategorie ??
    (istSonstigePosition(nummer) ? 'sonstige_betriebskosten' : undefined)
  );
}

function benennungAus(z: GespeichertePosition): string | null {
  return typeof z.benennung === 'string' && z.benennung.trim() ? z.benennung.trim() : null;
}

export function zuZahl(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const HEIZUNGSARTEN: Heizungsart[] = ['zentral', 'etage', 'fernwaerme', 'keine'];
const WARMWASSERARTEN: Warmwasserart[] = ['zentral', 'dezentral'];

export function vermieterDaten(vermieter: Vermieter | null, immobilie: Immobilie): VermieterDaten {
  return {
    firmenname: vermieter?.firmenname ?? '',
    rechtsform: vermieter?.rechtsform ?? null,
    strasse: vermieter?.strasse ?? '',
    hausnummer: vermieter?.hausnummer ?? '',
    plz: vermieter?.plz ?? '',
    ort: vermieter?.ort ?? '',
    vertretenDurch: vermieter?.vertreten_durch ?? [],
    vertretungArt: (vermieter?.vertretung_art as VermieterDaten['vertretungArt']) ?? 'gesamt',
    registergericht: vermieter?.registergericht ?? null,
    handelsregister: vermieter?.handelsregister ?? null,
    steuernummer: vermieter?.steuernummer ?? null,
    ustId: vermieter?.ust_id ?? null,
    telefon: vermieter?.telefon ?? null,
    fax: vermieter?.fax ?? null,
    email: vermieter?.email ?? null,
    // Miete geht auf das Objektkonto, sofern eins hinterlegt ist
    mietIban: ersteIban(immobilie['Kontonr.']) ?? vermieter?.miet_iban ?? null,
    mietBic: vermieter?.miet_bic ?? null,
    kautionIban: vermieter?.kaution_iban ?? null,
    kautionBic: vermieter?.kaution_bic ?? null,
    stammdatenGeprueft: vermieter?.stammdaten_geprueft ?? false,
  };
}

export function objektDaten(immobilie: Immobilie): ObjektDaten {
  return {
    strasse: immobilie.strasse ?? '',
    hausnummer: immobilie.hausnummer ?? '',
    plz: immobilie.plz ?? '',
    ort: immobilie.ort ?? '',
    ortsteil: immobilie.ortsteil,
    istAngespannt: immobilie.ist_angespannt ?? false,
    // Seit 18.10.2026 am Objekt gepflegt; vorher galt stillschweigend „zentral".
    heizungsart: HEIZUNGSARTEN.includes(immobilie.heizungsart as Heizungsart)
      ? (immobilie.heizungsart as Heizungsart)
      : null,
    warmwasser: WARMWASSERARTEN.includes(immobilie.warmwasser as Warmwasserart)
      ? (immobilie.warmwasser as Warmwasserart)
      : null,
    gesamtwohnflaecheQm: zuZahl(immobilie.gesamtwohnflaeche),
    heizkostenSchluessel: immobilie.heizkosten_schluessel ?? '70/30',
    energieausweisTyp: immobilie.energieausweis_typ,
    energieKennwert: immobilie.energie_kennwert,
    energietraeger: immobilie.energietraeger,
    energieausweisGueltigBis: immobilie.energieausweis_gueltig_bis,
    energieeffizienzklasse: immobilie.energieeffizienzklasse,
  };
}

export function einheitDaten(einheit: Einheit, raumaufstellung: string | null): EinheitDaten {
  return {
    bezeichnung: einheit.bezeichnung ?? '',
    lage: (einheit.etage ?? '').trim(),
    wohnflaecheQm: Number(einheit.qm ?? 0),
    anzahlZimmer: einheit.anzahl_zimmer !== null ? Number(einheit.anzahl_zimmer) : null,
    raumaufstellung: raumaufstellung?.trim() || raumaufstellungAus(einheit.raeume, einheit.anzahl_zimmer),
    nebenraeume: einheit.nebenraeume,
    einbaukueche: einheit.einbaukueche ?? false,
  };
}

export function mieterDaten(m: Mieter): MieterDaten {
  return {
    anrede: m.anrede as MieterDaten['anrede'],
    vorname: m.vorname ?? '',
    nachname: m.nachname ?? '',
    istUnternehmen: m.ist_unternehmen ?? false,
    firmenname: m.firmenname,
    vertretenDurch: m.vertreten_durch,
    strasse: m.strasse,
    hausnummer: m.hausnummer,
    plz: m.plz,
    ort: m.ort,
    geburtsdatum: m.geburtsdatum,
    telefon: m.telnr,
    email: leerZuNull(m.hauptmail),
  };
}

/**
 * Betriebskosten: Eine am Vertrag gespeicherte Aufstellung hat Vorrang — ein
 * unterschriebener Vertrag muss unverändert nachdruckbar bleiben, auch wenn
 * die Kostenarten der Immobilie später geändert werden. Sonst bestimmen die am
 * Objekt gepflegten Arten, was umgelegt wird; ohne Pflege wird nichts
 * vorausgewählt.
 *
 * Der Verteilerschlüssel kommt aus der Betriebskostenabrechnung des Objekts
 * (`schluesselDesObjekts`). Ein neuer Vertrag übernimmt vom Vorvertrag nur, was
 * umgelegt wird und mit welchem Betrag (`schluesselVomObjekt`): Das Haus wird
 * für alle Mieter nach demselben Schlüssel abgerechnet, ein abweichender
 * Schlüssel aus einem alten Vertrag liefe in die nächste Abrechnung.
 */
export function betriebskostenPositionen(
  nebenkostenarten: Nebenkostenart[],
  gespeichertRoh: unknown,
  { schluesselVomObjekt = false }: { schluesselVomObjekt?: boolean } = {}
): BetriebskostenPosition[] {
  const gepflegt = new Map(nebenkostenarten.map(n => [normalisiere(n.name), n]));
  const gespeichert = new Map(
    (Array.isArray(gespeichertRoh) ? (gespeichertRoh as GespeichertePosition[]) : [])
      .filter(x => typeof x?.nummer === 'string')
      .map(x => [x.nummer as string, x])
  );

  const standard = BETRKV_STANDARD.map<BetriebskostenPosition>(pos => {
    const schluesselObjekt = schluesselDesObjekts(nebenkostenarten, pos.kategorie);
    const gespeicherteZeile = gespeichert.get(pos.nummer);
    if (gespeicherteZeile) {
      const benennung = benennungAus(gespeicherteZeile);
      return {
        nummer: pos.nummer,
        bezeichnung: gespeicherteZeile.bezeichnung || pos.bezeichnung,
        umgelegt: gespeicherteZeile.umgelegt === true,
        schluessel: (!schluesselVomObjekt && gespeicherteZeile.schluessel) || schluesselObjekt,
        schluesselObjekt,
        betrag: zuZahl(gespeicherteZeile.betrag),
        ...(benennung && istSonstigePosition(pos.nummer) ? { benennung } : {}),
      };
    }
    const treffer = findeArt(gepflegt, pos.bezeichnung);
    return {
      nummer: pos.nummer,
      bezeichnung: pos.bezeichnung,
      umgelegt: treffer ? treffer.ist_umlagefaehig !== false : false,
      schluessel: schluesselObjekt,
      schluesselObjekt,
      betrag: null,
    };
  });

  // Weitere sonstige Betriebskosten (ab 2.20, seit 03.11.2026) gehen mit, sonst fiele z. B. die
  // Lüftungsanlage beim Nachdruck oder beim nächsten Vertrag still heraus
  const schluesselSonstige = schluesselDesObjekts(nebenkostenarten, 'sonstige_betriebskosten');
  const weitere = [...gespeichert.values()]
    .filter(z => istSonstigePosition(z.nummer as string) && !BETRKV_STANDARD.some(s => s.nummer === z.nummer))
    .sort((a, b) => Number((a.nummer as string).split('.')[1]) - Number((b.nummer as string).split('.')[1]))
    .map<BetriebskostenPosition>(z => {
      const benennung = benennungAus(z);
      return {
        nummer: (z.nummer as string).trim(),
        bezeichnung: z.bezeichnung || 'Sonstige Betriebskosten',
        umgelegt: z.umgelegt === true,
        schluessel: (!schluesselVomObjekt && z.schluessel) || schluesselSonstige,
        schluesselObjekt: schluesselSonstige,
        betrag: zuZahl(z.betrag),
        ...(benennung ? { benennung } : {}),
      };
    });
  return [...standard, ...weitere];
}

/**
 * Frischt den Vergleichswert `schluesselObjekt` am aktuellen Stand des Objekts
 * auf. Ohne `uebernehmen` (Nachdruck eines unterschriebenen Vertrags) bleibt
 * der im Vertrag stehende Schlüssel, eine Abweichung zeigt die Pflichtprüfung.
 * Mit `uebernehmen` (neuer Vertrag, seit 03.11.2026) gilt der Schlüssel des
 * Objekts auch im Vertrag — der Kunde: „fix pro Objekt … einmal in den
 * Stammdaten des Objektes angelegt“.
 */
export function mitSchluesselnDesObjekts(
  positionen: BetriebskostenPosition[],
  nebenkostenarten: Nebenkostenart[],
  { uebernehmen = false }: { uebernehmen?: boolean } = {}
): BetriebskostenPosition[] {
  return positionen.map(p => {
    const kategorie = kategorieDerPosition(p.nummer);
    if (!kategorie) return p;
    const schluesselObjekt = schluesselDesObjekts(nebenkostenarten, kategorie);
    return { ...p, schluesselObjekt, ...(uebernehmen ? { schluessel: schluesselObjekt } : {}) };
  });
}

export interface VertragsZeilen {
  vertrag: Vertrag;
  einheit: Einheit;
  immobilie: Immobilie;
  vermieter: Vermieter | null;
  mieter: Mieter[];
  nebenkostenarten: Nebenkostenart[];
  nebenobjekte: { teilmiete: number | null; bezeichnung: string | null; etage: string | null }[];
}

/** Ein bestehender Vertrag in der Form, die der Generator erwartet. */
export function vertragsDaten(z: VertragsZeilen): MietvertragDaten {
  const { vertrag } = z;
  const heizkosten = vertrag.heizkosten_vorauszahlung !== null ? Number(vertrag.heizkosten_vorauszahlung) : null;

  return {
    vertragsart: vertrag.vertragsart ?? 'wohnraum',
    vermieter: vermieterDaten(z.vermieter, z.immobilie),
    mieter: z.mieter.map(mieterDaten),
    objekt: objektDaten(z.immobilie),
    einheit: einheitDaten(z.einheit, vertrag.raumaufstellung),
    nebenobjekte: z.nebenobjekte.map(n => ({
      bezeichnung: n.bezeichnung ?? '',
      lage: (n.etage ?? '').trim(),
      teilmiete: n.teilmiete !== null ? Number(n.teilmiete) : null,
    })),

    mietbeginn: vertrag.start_datum ?? '',
    vertragsende: vertrag.ende_datum,
    befristungsgrund: vertrag.befristungsgrund,
    befristungsgrundText: vertrag.befristungsgrund_text,
    kuendigungsverzichtBis: vertrag.kuendigungsverzicht_bis,
    uebergabeDatum: vertrag.uebergabe_datum,

    kaltmiete: Number(vertrag.kaltmiete ?? 0),
    betriebskostenModus: vertrag.betriebskosten_modus ?? 'vorauszahlung',
    // `betriebskosten` ist wie bei allen Bestandsverträgen die gesamte
    // monatliche Vorauszahlung — nur so stimmt die Sollstellung. Ist ein
    // Heizkostenanteil ausgewiesen, steht er in § 4 getrennt.
    betriebskostenVorauszahlung: Math.round((Number(vertrag.betriebskosten ?? 0) - (heizkosten ?? 0)) * 100) / 100,
    heizkostenVorauszahlung: heizkosten,
    betriebskostenPositionen: betriebskostenPositionen(z.nebenkostenarten, vertrag.betriebskosten_positionen),
    abrechnungszeitraum: 'das Kalenderjahr',

    kautionBetrag: Number(vertrag.kaution_betrag ?? 0),
    kautionArt: vertrag.kaution_art ?? 'barkaution',
    kautionRaten: vertrag.kaution_raten ?? 3,

    faelligkeitWerktag: vertrag.faelligkeit_werktag ?? 3,
    lastschrift: vertrag.lastschrift ?? false,
    lastschriftKontoinhaber: vertrag.kontoinhaber,
    lastschriftIban: vertrag.bankkonto_mieter,
    lastschriftBic: vertrag.bankkonto_mieter_bic,
    sepaMandatsreferenz: vertrag.sepa_mandatsreferenz,

    mietanpassungArt: vertrag.mietanpassung_art ?? 'keine',
    staffelplan: leseStaffelplan(vertrag.staffelplan),
    indexBasisWert: vertrag.index_basis_wert !== null ? Number(vertrag.index_basis_wert) : null,
    indexBasisMonat: vertrag.index_basis_monat,

    anzahlPersonen: vertrag.anzahl_personen ?? 0,
    schluessel: leseSchluessel(vertrag.schluessel),
    schliessanlageArt: vertrag.schliessanlage_art,
    mitbenutzungEinrichtungen: vertrag.mitbenutzung_einrichtungen,

    // Nicht erfasst bleibt nicht erfasst: Die Vorgabe 'renoviert' umging bis zum 27.10.2026 die
    // Pflichtprüfung, behauptete im Nachdruck „renoviert übergeben“ (141 von 141 Verträgen ohne Angabe)
    // und wurde in die Datenbank zurückgeschrieben.
    uebergabezustand: vertrag.uebergabezustand ?? null,
    schoenheitsreparaturen: vertrag.schoenheitsreparaturen ?? false,
    kleinreparaturEinzelgrenze: Number(vertrag.kleinreparatur_einzelgrenze ?? 100),
    kleinreparaturJahresgrenzeProzent: Number(vertrag.kleinreparatur_jahresgrenze_prozent ?? 8),

    vormieteNetto: vertrag.vormiete_netto !== null ? Number(vertrag.vormiete_netto) : null,
    vormieteBis: vertrag.vormiete_bis,
    mietpreisbremseAuskunftAm: vertrag.mietpreisbremse_auskunft_am,

    besichtigtAm: vertrag.besichtigt_am,
    zusatzvereinbarungen: vertrag.zusatzvereinbarungen,

    vertragsdatum: vertrag.vertrag_datum,
    unterschriftOrt: vertrag.unterschrift_ort,

    anlagen: {
      hausordnung: true,
      betrkvKatalog: vertrag.betriebskosten_modus !== 'inklusiv',
      widerrufsbelehrung: !vertrag.besichtigt_am,
      datenschutzhinweis: true,
      mietspiegelEinwilligung: false,
    },
  };
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function leerZuNull(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

function normalisiere(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-zäöüß]/g, '');
}

function findeArt<T>(map: Map<string, T>, bezeichnung: string): T | undefined {
  const gesucht = normalisiere(bezeichnung);
  const direkt = map.get(gesucht);
  if (direkt) return direkt;
  for (const [name, wert] of map) {
    // Ein Name ohne Buchstaben würde sonst jede Position treffen
    if (!name) continue;
    if (gesucht.includes(name) || name.includes(gesucht)) return wert;
  }
  return undefined;
}

/**
 * `immobilien."Kontonr."` enthält teils mehrere IBAN in einem Textfeld,
 * getrennt durch Semikolon oder Zeilenumbruch. Für den Vertrag zählt die erste.
 */
export function ersteIban(feld: string | null): string | null {
  if (!feld) return null;
  const erste = feld
    .split(/[;\r\n]+/)
    .map(s => s.trim())
    .filter(Boolean)[0];
  return erste ? erste.replace(/\s+/g, '') : null;
}

export function raumaufstellungAus(raeume: unknown, anzahlZimmer: number | null): string {
  if (raeume && typeof raeume === 'object' && Object.keys(raeume).length > 0) {
    const namen: Record<string, string> = {
      zimmer: 'Zimmer',
      kueche: 'Küche',
      bad: 'Badezimmer',
      gaeste_wc: 'Gäste-WC',
      balkon: 'Balkon',
      keller: 'Kellerraum',
      boden: 'Bodenraum',
      garten: 'Gartenanteil',
    };
    return Object.entries(raeume as Record<string, number>)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n.toLocaleString('de-DE')} ${namen[k] ?? k}`)
      .join(', ');
  }
  return anzahlZimmer ? `${anzahlZimmer.toLocaleString('de-DE')} Zimmer` : '';
}

function leseStaffelplan(v: unknown): StaffelStufe[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((s): s is { gueltig_ab: string; kaltmiete: number } =>
      !!s && typeof s === 'object' && 'gueltig_ab' in s && 'kaltmiete' in s
    )
    .map(s => ({ gueltigAb: String(s.gueltig_ab), kaltmiete: Number(s.kaltmiete) }));
}

export function leseSchluessel(v: unknown): SchluesselAngabe[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const namen: Record<string, string> = {
    haustuer: 'Haustürschlüssel',
    wohnung: 'Wohnungsschlüssel',
    briefkasten: 'Briefkastenschlüssel',
    keller: 'Kellerschlüssel',
    garage: 'Garagenschlüssel',
    transponder: 'Transponder',
  };
  // Frei benannte Schlüssel (seit 03.11.2026) stehen als „müllplatzschlüssel“ in der Spalte — zurück in Lesbar
  const lesbar = (k: string) => {
    const text = k.replace(/_+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  return Object.entries(v as Record<string, number>)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => (namen[k] ? { art: namen[k], anzahl: Number(n) } : { art: lesbar(k), anzahl: Number(n), frei: true }));
}
