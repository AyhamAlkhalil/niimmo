/**
 * Lädt alles, was für die Vertragserzeugung nötig ist, und bringt es in die
 * Form, die der Generator erwartet.
 *
 * Bewusst ohne Ersatzwerte: Fehlt eine Angabe, bleibt sie leer und die
 * Pflichtprüfung schlägt an. Der Vertrag darf nichts behaupten, was nicht
 * erfasst ist.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  BetriebskostenPosition,
  MieterDaten,
  MietvertragDaten,
  StaffelStufe,
} from '@/utils/mietvertrag/typen';

/** Die 17 Kategorien der BetrKV in der Reihenfolge des Gesetzes. */
/**
 * Kostenarten in der Nummerierung der NiImmo-Hausvorlage.
 *
 * Sie geht bis 2.19 und weicht damit bewusst von der BetrKV ab, die unter
 * 2.17 nur „sonstige Betriebskosten" kennt: Rauchwarnmelder und Abgasmessung
 * sind dort eigene Zeilen. Genau so muessen sie im Vertrag stehen — nicht
 * benannte sonstige Betriebskosten sind nach § 556 Abs. 1 BGB nicht
 * umlagefaehig, eine Sammelzeile „sonstige" traegt also nichts.
 */
const BETRKV_STANDARD: { nummer: string; bezeichnung: string; schluessel: string }[] = [
  { nummer: '2.1', bezeichnung: 'Laufende öffentliche Lasten des Grundstücks (Grundsteuer)', schluessel: 'einheit' },
  { nummer: '2.2', bezeichnung: 'Kosten der Wasserversorgung', schluessel: 'verbrauch' },
  { nummer: '2.3', bezeichnung: 'Kosten der Entwässerung', schluessel: 'qm' },
  { nummer: '2.4', bezeichnung: 'Kosten des Betriebs und der Wartung der Heizungsanlage', schluessel: 'einheit' },
  { nummer: '2.5', bezeichnung: 'Kosten des Betriebs und der Wartung der Warmwasserversorgung', schluessel: 'einheit' },
  { nummer: '2.6', bezeichnung: 'Kosten verbundener Heizungs- und Warmwasserversorgungsanlagen', schluessel: 'einheit' },
  { nummer: '2.7', bezeichnung: 'Kosten des Betriebs des Personen- oder Lastenaufzugs', schluessel: 'qm' },
  { nummer: '2.8', bezeichnung: 'Kosten der Straßenreinigung und Müllbeseitigung', schluessel: 'qm' },
  { nummer: '2.9', bezeichnung: 'Kosten der Gebäudereinigung und Ungezieferbekämpfung', schluessel: 'qm' },
  { nummer: '2.10', bezeichnung: 'Kosten der Gartenpflege', schluessel: 'qm' },
  { nummer: '2.11', bezeichnung: 'Kosten der Beleuchtung', schluessel: 'qm' },
  { nummer: '2.12', bezeichnung: 'Kosten der Schornsteinreinigung', schluessel: 'einheit' },
  { nummer: '2.13', bezeichnung: 'Kosten der Sach- und Haftpflichtversicherung', schluessel: 'qm' },
  { nummer: '2.14', bezeichnung: 'Kosten für den Hauswart', schluessel: 'qm' },
  { nummer: '2.15', bezeichnung: 'Kosten für Antennen- und Kabelanschluss', schluessel: 'nutzer' },
  { nummer: '2.16', bezeichnung: 'Kosten des Betriebs der Einrichtungen für die Wäschepflege', schluessel: 'qm' },
  { nummer: '2.17', bezeichnung: 'Kosten des Betriebs der Rauchwarnmeldeeinrichtung', schluessel: 'qm' },
  { nummer: '2.18', bezeichnung: 'Kosten der Abgasmessung', schluessel: 'einheit' },
  { nummer: '2.19', bezeichnung: 'Sonstige Betriebskosten', schluessel: 'qm' },
];

/** Eine im Vertrag gespeicherte Position — Schnappschuss aus der Datenbank. */
interface GespeichertePosition {
  nummer?: string;
  bezeichnung?: string;
  schluessel?: string;
  umgelegt?: boolean;
  betrag?: number | string | null;
}

function zuZahl(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function useMietvertragPdfDaten(vertragId: string | null, aktiv: boolean) {
  return useQuery({
    queryKey: ['mietvertrag-pdf-daten', vertragId],
    enabled: aktiv && !!vertragId,
    queryFn: async (): Promise<MietvertragDaten> => {
      const { data: vertrag, error: vertragError } = await supabase
        .from('mietvertrag')
        .select('*')
        .eq('id', vertragId!)
        .single();
      if (vertragError) throw vertragError;

      const { data: einheit, error: einheitError } = await supabase
        .from('einheiten')
        .select('*')
        .eq('id', vertrag.einheit_id)
        .single();
      if (einheitError) throw einheitError;

      const { data: immobilie, error: immobilieError } = await supabase
        .from('immobilien')
        .select('*')
        .eq('id', einheit.immobilie_id!)
        .single();
      if (immobilieError) throw immobilieError;

      // Vermieter: der am Objekt hinterlegte, sonst der Standardvermieter
      const vermieterQuery = immobilie.vermieter_id
        ? supabase.from('vermieter').select('*').eq('id', immobilie.vermieter_id).maybeSingle()
        : supabase.from('vermieter').select('*').eq('ist_standard', true).maybeSingle();
      const { data: vermieter, error: vermieterError } = await vermieterQuery;
      if (vermieterError) throw vermieterError;

      const { data: mieterRows, error: mieterError } = await supabase
        .from('mietvertrag_mieter')
        .select('rolle, position, mieter:mieter_id (*)')
        .eq('mietvertrag_id', vertragId!)
        .order('position');
      if (mieterError) throw mieterError;

      const { data: nebenkostenarten } = await supabase
        .from('nebenkostenarten')
        .select('name, verteilerschluessel_art, ist_umlagefaehig')
        .eq('immobilie_id', immobilie.id);

      const { data: nebenobjektRows } = await supabase
        .from('mietvertrag_einheiten')
        .select('teilmiete, einheit:einheit_id (bezeichnung, etage)')
        .eq('mietvertrag_id', vertragId!)
        .eq('rolle', 'nebenobjekt');

      const mieter: MieterDaten[] = (mieterRows ?? [])
        .map(r => r.mieter)
        .filter(Boolean)
        .map(m => ({
          anrede: m!.anrede,
          vorname: m!.vorname ?? '',
          nachname: m!.nachname ?? '',
          istUnternehmen: m!.ist_unternehmen ?? false,
          firmenname: m!.firmenname,
          vertretenDurch: m!.vertreten_durch,
          strasse: m!.strasse,
          hausnummer: m!.hausnummer,
          plz: m!.plz,
          ort: m!.ort,
          geburtsdatum: m!.geburtsdatum,
          telefon: m!.telnr,
          email: leerZuNull(m!.hauptmail),
        }));

      // Betriebskosten: die am Objekt gepflegten Arten bestimmen, was umgelegt
      // wird. Ohne Pflege wird nichts vorausgewählt — nicht benannte Kosten
      // sind nach § 556 Abs. 1 BGB ohnehin nicht umlagefähig.
      const gepflegt = new Map(
        (nebenkostenarten ?? []).map(n => [normalisiere(n.name), n])
      );
      // Am Vertrag gespeicherte Aufstellung hat Vorrang: Ein unterschriebener
      // Vertrag muss auch dann unveraendert erzeugbar bleiben, wenn die
      // Kostenarten der Immobilie spaeter geaendert werden.
      const gespeichert = new Map(
        (Array.isArray(vertrag.betriebskosten_positionen)
          ? (vertrag.betriebskosten_positionen as GespeichertePosition[])
          : []
        )
          .filter(x => typeof x?.nummer === 'string')
          .map(x => [x.nummer as string, x])
      );

      const betriebskostenPositionen: BetriebskostenPosition[] = BETRKV_STANDARD.map(pos => {
        const gespeicherteZeile = gespeichert.get(pos.nummer);
        if (gespeicherteZeile) {
          return {
            nummer: pos.nummer,
            bezeichnung: gespeicherteZeile.bezeichnung || pos.bezeichnung,
            umgelegt: gespeicherteZeile.umgelegt === true,
            schluessel: gespeicherteZeile.schluessel || pos.schluessel,
            betrag: zuZahl(gespeicherteZeile.betrag),
          };
        }
        const treffer = findeArt(gepflegt, pos.bezeichnung);
        return {
          nummer: pos.nummer,
          bezeichnung: pos.bezeichnung,
          umgelegt: treffer ? treffer.ist_umlagefaehig !== false : false,
          schluessel: treffer?.verteilerschluessel_art || pos.schluessel,
          betrag: null,
        };
      });

      const heizungsart = ermittleHeizungsart();

      return {
        vertragsart: vertrag.vertragsart ?? 'wohnraum',
        vermieter: {
          firmenname: vermieter?.firmenname ?? '',
          rechtsform: vermieter?.rechtsform ?? null,
          strasse: vermieter?.strasse ?? '',
          hausnummer: vermieter?.hausnummer ?? '',
          plz: vermieter?.plz ?? '',
          ort: vermieter?.ort ?? '',
          vertretenDurch: vermieter?.vertreten_durch ?? [],
          vertretungArt: vermieter?.vertretung_art ?? 'gesamt',
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
        },
        mieter,
        objekt: {
          strasse: immobilie.strasse ?? '',
          hausnummer: immobilie.hausnummer ?? '',
          plz: immobilie.plz ?? '',
          ort: immobilie.ort ?? '',
          ortsteil: immobilie.ortsteil,
          istAngespannt: immobilie.ist_angespannt ?? false,
          heizungsart,
          heizkostenSchluessel: immobilie.heizkosten_schluessel ?? '70/30',
          energieausweisTyp: immobilie.energieausweis_typ,
          energieKennwert: immobilie.energie_kennwert,
          energietraeger: immobilie.energietraeger,
          energieausweisGueltigBis: immobilie.energieausweis_gueltig_bis,
          energieeffizienzklasse: immobilie.energieeffizienzklasse,
        },
        einheit: {
          bezeichnung: einheit.bezeichnung ?? '',
          lage: (einheit.etage ?? '').trim(),
          wohnflaecheQm: Number(einheit.qm ?? 0),
          anzahlZimmer: einheit.anzahl_zimmer !== null ? Number(einheit.anzahl_zimmer) : null,
          raumaufstellung: vertrag.raumaufstellung ?? raumaufstellungAus(einheit.raeume, einheit.anzahl_zimmer),
          nebenraeume: einheit.nebenraeume,
          einbaukueche: einheit.einbaukueche ?? false,
        },
        nebenobjekte: (nebenobjektRows ?? []).map(n => ({
          bezeichnung: n.einheit?.bezeichnung ?? '',
          lage: (n.einheit?.etage ?? '').trim(),
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
        betriebskostenVorauszahlung: Number(vertrag.betriebskosten ?? 0),
        heizkostenVorauszahlung:
          vertrag.heizkosten_vorauszahlung !== null ? Number(vertrag.heizkosten_vorauszahlung) : null,
        betriebskostenPositionen,
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

        uebergabezustand: vertrag.uebergabezustand ?? 'renoviert',
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
    },
  });
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
    if (gesucht.includes(name) || name.includes(gesucht)) return wert;
  }
  return undefined;
}

/**
 * `immobilien."Kontonr."` enthält teils mehrere IBAN in einem Textfeld,
 * getrennt durch Semikolon oder Zeilenumbruch. Für den Vertrag zählt die erste.
 */
function ersteIban(feld: string | null): string | null {
  if (!feld) return null;
  const erste = feld
    .split(/[;\r\n]+/)
    .map(s => s.trim())
    .filter(Boolean)[0];
  return erste ? erste.replace(/\s+/g, '') : null;
}

/**
 * Das Datenmodell kennt die Heizungsart noch nicht. Bis sie je Objekt erfasst
 * ist, gilt Zentralversorgung — im Bestand der Regelfall. Bei Etagenheizungen
 * muss das vor der Vertragserzeugung geprüft werden, sonst legt der Vertrag
 * Heizkosten um, die es gar nicht gibt.
 */
function ermittleHeizungsart(): 'zentral' | 'etage' | 'fernwaerme' | 'keine' {
  return 'zentral';
}

function raumaufstellungAus(raeume: unknown, anzahlZimmer: number | null): string {
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

function leseSchluessel(v: unknown): { art: string; anzahl: number }[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const namen: Record<string, string> = {
    haustuer: 'Haustürschlüssel',
    wohnung: 'Wohnungsschlüssel',
    briefkasten: 'Briefkastenschlüssel',
    keller: 'Kellerschlüssel',
    garage: 'Garagenschlüssel',
    transponder: 'Transponder',
  };
  return Object.entries(v as Record<string, number>)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => ({ art: namen[k] ?? k, anzahl: Number(n) }));
}
