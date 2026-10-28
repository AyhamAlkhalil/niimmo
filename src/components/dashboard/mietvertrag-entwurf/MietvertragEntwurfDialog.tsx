/**
 * „Neuen Mietvertrag anlegen" als geführter Ablauf (20.10.2026).
 *
 * Die Vorlage ist fest; der Ablauf befüllt ihre Platzhalter aus Objekt,
 * Einheit, Vorvertrag, Selbstauskunft und Eingaben — jeder Wert bleibt
 * änderbar und zeigt seine Quelle. Am Ende steht das PDF:
 *
 *   Grundlagen → Mieter → Miete & Laufzeit → Mietsache & Haus →
 *   Betriebskosten → Vereinbarungen → Prüfen & PDF → Unterschrift & Start
 *
 * Bis zum Aktivieren ist alles ein Entwurf (`mietvertrag_entwuerfe`): Die
 * Einheit bleibt frei, es entstehen keine Forderungen. Zwischenspeichern geht
 * jederzeit, Abbrechen fragt bei ungespeicherten Änderungen nach.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, FileCheck2, FileSignature, Info, Loader2, PenLine, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import VermieterStammdatenDialog from '@/components/dashboard/VermieterStammdatenDialog';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import {
  useEntwurfGrundlagen,
  useMieterAbgleich,
  useMietvertragEntwuerfe,
  useMietvertragEntwurf,
  wahrscheinlichsterVertrag,
  type EntwurfGrundlagenDaten,
} from '@/hooks/useMietvertragEntwurf';
import { useVertragsvorschau } from '@/hooks/useVertragsvorschau';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { OCRProcessingService } from '@/services/ocrProcessingService';
import { speichereEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { getVertragsende } from '@/utils/contractUtils';
import { objektDaten, vermieterDaten } from '@/utils/mietvertrag/datenAusDb';
import {
  baueEntwurf,
  hatNamen,
  indexVorschlag,
  istLeerePerson,
  istWohnraumEinheit,
  leerePerson,
  mitMietbeginn,
  mitPersonen,
  ohneHerkunft,
  personenAusSelbstauskunft,
  personenzahl,
  pruefeBlacklist,
  standardMietbeginn,
  wendeVorvertragAuslese,
  type EntwurfDatei,
  type EntwurfPerson,
  type Herkunft,
  type HerkunftKarte,
  type SelbstauskunftAuslese,
  type VorvertragAuslese,
} from '@/utils/mietvertrag/entwurf';
import {
  entwurfLuecken,
  istSchrittId,
  platzhalterUebersicht,
  schritteFuer,
  schrittTitel,
  schrittZustaende,
  type SchrittId,
} from '@/utils/mietvertrag/entwurfProzess';
import { hatBlocker, pruefeVertragsdaten } from '@/utils/mietvertrag/pflichtpruefung';
import { istPlausiblesDatum } from '@/utils/pdf/briefLayout';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';
import { EURO_BETRAG_HINWEIS } from '@/utils/euroBetrag';
import {
  AnlagenFelder,
  BetriebskostenEditor,
  EnergieausweisFelder,
  KleinreparaturFelder,
  MietsacheFelder,
  ObjektAngabenFelder,
  PersonenzahlFeld,
  SchluesselFelder,
  UebergabeFelder,
  UnterzeichnungFelder,
  ZusatzvereinbarungFeld,
} from '../mietvertrag-formular/Abschnitte';
import {
  Feldname,
  HerkunftHinweis,
  PruefungsHinweise,
  UngueltigeZahlFelder,
  VertragsVorschau,
} from '../mietvertrag-formular/Bausteine';
import { GrundlagenSchritt } from './GrundlagenSchritt';
import { InteressentenAbschnitt } from './InteressentenAbschnitt';
import { MieteSchritt } from './MieteSchritt';
import { PruefenSchritt } from './PruefenSchritt';
import { Schrittleiste } from './Schrittleiste';
import { StartSchritt } from './StartSchritt';
import type { AusleseStatus } from './VorvertragAbschnitt';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  einheitId: string;
  /** Vorhandenen Entwurf fortsetzen; ohne ID entsteht ein neuer. */
  entwurfId?: string | null;
  /** In diesem Schritt einsteigen, z. B. „start" für „Unterschrift & Start" auf der Einheitskarte. */
  startSchritt?: SchrittId | null;
  /** Ein bereits unterschriebener Vertrag wird weiter direkt erfasst (bisheriger Dialog). */
  onDirektErfassen?: () => void;
}

interface Stand {
  daten: MietvertragDaten;
  herkunft: HerkunftKarte;
}

function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Vergleich unabhängig von der Schlüsselreihenfolge — jsonb ordnet die Schlüssel beim Speichern um. */
function stabil(wert: unknown): string {
  return JSON.stringify(wert, (_schluessel, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .map(([k, w]) => [k, w === undefined ? null : w])
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
        )
      : v
  );
}

/** Was nicht im Entwurf, sondern am Objekt und beim Vermieter gepflegt wird. */
function stammdatenTeil(d: MietvertragDaten) {
  return {
    vermieter: d.vermieter,
    objekt: d.objekt,
    schliessanlageArt: d.schliessanlageArt,
    // Am Objekt als Liste gespeichert — „Waschkeller,Hof" und „Waschkeller, Hof" sind dasselbe
    mitbenutzungEinrichtungen: (d.mitbenutzungEinrichtungen ?? '')
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean)
      .join(', '),
  };
}

/** Rückschreiben ans Objekt bzw. an die Einheit — getrennt, weil beide Updates einzeln scheitern können. */
const FELDER_AM_OBJEKT = [
  'objekt.heizungsart',
  'objekt.warmwasser',
  'objekt.heizkostenSchluessel',
  'objekt.gesamtwohnflaecheQm',
  'schliessanlageArt',
  'mitbenutzungEinrichtungen',
  'objekt.energieausweis',
];
const FELDER_AN_EINHEIT = ['einheit.nebenraeume', 'einheit.einbaukueche'];

type Verlassen = 'schliessen' | 'direkt';

export function MietvertragEntwurfDialog({
  isOpen,
  onClose,
  einheitId,
  entwurfId = null,
  startSchritt = null,
  onDirektErfassen,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  const grundlagen = useEntwurfGrundlagen(einheitId, isOpen);
  const vorhanden = useMietvertragEntwurf(entwurfId, isOpen);
  const { mieter: bestand, blacklist } = useMieterAbgleich(isOpen);
  const { data: alleEntwuerfe } = useMietvertragEntwuerfe(isOpen);
  const g = grundlagen.data;

  const [id, setId] = useState('');
  const [gespeichert, setGespeichert] = useState(false);
  const [stand, setStand] = useState<Stand | null>(null);
  const [personen, setPersonen] = useState<EntwurfPerson[]>([]);
  const [dateien, setDateien] = useState<EntwurfDatei[]>([]);
  const [neueSelbstauskuenfte, setNeueSelbstauskuenfte] = useState<File[]>([]);
  const [liestSelbstauskunft, setLiestSelbstauskunft] = useState(false);
  const [vorvertragPfad, setVorvertragPfad] = useState<string | null>(null);
  const [ausleseStatus, setAusleseStatus] = useState<AusleseStatus>({ art: 'bereit' });
  const [speichert, setSpeichert] = useState(false);
  const [zeigeVermieter, setZeigeVermieter] = useState(false);
  const [zeigeHinweise, setZeigeHinweise] = useState(false);
  const [aktualisiertAm, setAktualisiertAm] = useState<string | null>(null);
  const [schritt, setSchritt] = useState<SchrittId>('grundlagen');
  const [besucht, setBesucht] = useState<Set<SchrittId>>(new Set(['grundlagen']));
  const [ungespeichert, setUngespeichert] = useState(false);
  const [frageSchliessen, setFrageSchliessen] = useState<Verlassen | null>(null);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<Date | null>(null);
  const initialisiert = useRef(false);
  /** Felder, die in dieser Sitzung von Hand geändert wurden — nur die gehen ans Objekt zurück. */
  /** Je Feld ein Zähler: So erkennt das Speichern, ob ein Feld währenddessen erneut geändert wurde. */
  const sitzungGeaendert = useRef(new Map<string, number>());
  /**
   * Was in dieser Sitzung von Hand geändert wurde — anders als `sitzungGeaendert` nicht beim Speichern
   * geleert. Die Vorvertrags-Auslese lässt diese Felder stehen (28.10.2026).
   */
  const vonHandGeaendert = useRef(new Set<string>());
  /** Zahlenfelder mit abgelehntem Betrag (z. B. „1.200") — solange eines da ist, geht es nicht weiter. */
  const [ungueltigeZahlen, setUngueltigeZahlen] = useState<ReadonlySet<string>>(new Set());
  /** Zählt Öffnungen; eine KI-Antwort aus einer früheren Sitzung wird verworfen. */
  const sitzung = useRef(0);
  /** Zählt Eingaben; was während des Speicherns geändert wird, bleibt ungespeichert. */
  const aenderungen = useRef(0);
  const formular = useRef<HTMLDivElement>(null);

  const wohnraum = istWohnraumEinheit(g?.einheit.einheitentyp);
  const schritte = useMemo(() => schritteFuer(wohnraum), [wohnraum]);

  // ─── Schließen setzt alles zurück ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) return;
    sitzung.current += 1;
    initialisiert.current = false;
    sitzungGeaendert.current = new Map();
    vonHandGeaendert.current = new Set();
    aenderungen.current = 0;
    setAktualisiertAm(null);
    setGespeichert(false);
    setStand(null);
    setPersonen([]);
    setDateien([]);
    setNeueSelbstauskuenfte([]);
    setVorvertragPfad(null);
    setAusleseStatus({ art: 'bereit' });
    setSchritt('grundlagen');
    setBesucht(new Set(['grundlagen']));
    setUngespeichert(false);
    setFrageSchliessen(null);
    setZuletztGespeichert(null);
  }, [isOpen]);

  const markiereUngespeichert = useCallback(() => {
    aenderungen.current += 1;
    setUngespeichert(true);
  }, []);

  // ─── Vorvertrag lesen ────────────────────────────────────────────────────
  const liesVorvertrag = useCallback(
    async (grundlage: EntwurfGrundlagenDaten, pfad: string, vonHand: boolean) => {
      const dokument = grundlage.vorvertragDokumente.find(d => d.pfad === pfad);
      if (!dokument) return;
      const meineSitzung = sitzung.current;
      setAusleseStatus({ art: 'laeuft' });
      try {
        const { data: blob, error } = await supabase.storage.from('dokumente').download(dokument.pfad);
        if (error || !blob) throw new Error(error?.message ?? 'Dokument konnte nicht geladen werden.');
        const antwort = await OCRProcessingService.liesDokument<VorvertragAuslese>(blob, dokument.titel, 'vorvertrag');
        if (meineSitzung !== sitzung.current) return;
        if (!antwort.success || !antwort.extractedData) throw new Error(antwort.error ?? 'Keine Angaben erkannt.');
        const auslese = antwort.extractedData;
        const gesamt = grundlage.vorvertrag ? Number(grundlage.vorvertrag.betriebskosten ?? 0) : null;
        // Was während des Lesens von Hand eingetragen wurde, bleibt stehen
        setStand(s => (s ? wendeVorvertragAuslese(s.daten, s.herkunft, auslese, gesamt, f => vonHandGeaendert.current.has(f)) : s));
        if (vonHand) markiereUngespeichert();

        const gefunden = [
          auslese.raumaufstellung && 'Räume',
          (auslese.einheit_bezeichnung || auslese.lage) && 'Lage',
          auslese.betriebskosten_positionen.length > 0 && `${auslese.betriebskosten_positionen.length} Kostenpositionen`,
          auslese.heizkosten_vorauszahlung && 'Heizkosten',
          auslese.schliessanlage && 'Schließanlage',
          auslese.mindestlaufzeit_monate && 'Mindestlaufzeit',
        ].filter(Boolean);
        setAusleseStatus({
          art: 'fertig',
          text: gefunden.length > 0 ? `Gelesen: ${gefunden.join(', ')}.` : 'Gelesen, aber nichts Verwertbares gefunden.',
        });
      } catch (e) {
        if (meineSitzung === sitzung.current) {
          setAusleseStatus({ art: 'fehler', text: e instanceof Error ? e.message : String(e) });
        }
      }
    },
    [markiereUngespeichert]
  );

  // ─── Erste Fassung ───────────────────────────────────────────────────────
  useEffect(() => {
    // Erst mit frisch geladenen Daten belegen: Der Cache liefert sonst den Stand vor dem letzten Speichern.
    if (!isOpen || initialisiert.current || !g || grundlagen.isFetching) return;
    const verfuegbar = schritteFuer(istWohnraumEinheit(g.einheit.einheitentyp));
    const beginneBei = (s: SchrittId) => {
      const ziel = verfuegbar.includes(s) ? s : 'grundlagen';
      setSchritt(ziel);
      setBesucht(new Set(verfuegbar.slice(0, verfuegbar.indexOf(ziel) + 1)));
    };

    if (entwurfId) {
      if (!vorhanden.data || vorhanden.isFetching) return;
      const z = vorhanden.data;
      setId(z.id);
      setGespeichert(true);
      setAktualisiertAm(z.aktualisiertAm);
      // Haus- und Vermieterangaben gelten wie gespeichert am Objekt, nicht wie im
      // Entwurf festgehalten — sonst schriebe das Speichern einen alten Stand zurück.
      const aktuell = objektDaten(g.immobilie);
      const einrichtungen = (g.immobilie.gemeinschaftseinrichtungen ?? []).filter(Boolean);
      const daten: MietvertragDaten = {
        ...z.daten,
        vermieter: vermieterDaten(g.vermieter, g.immobilie),
        objekt: {
          ...aktuell,
          heizungsart: aktuell.heizungsart ?? z.daten.objekt.heizungsart,
          warmwasser: aktuell.warmwasser ?? z.daten.objekt.warmwasser,
          gesamtwohnflaecheQm: aktuell.gesamtwohnflaecheQm ?? z.daten.objekt.gesamtwohnflaecheQm,
        },
        schliessanlageArt: g.immobilie.schliessanlage_art ?? z.daten.schliessanlageArt,
        mitbenutzungEinrichtungen: einrichtungen.length > 0 ? einrichtungen.join(', ') : z.daten.mitbenutzungEinrichtungen,
      };
      setStand({ daten, herkunft: z.herkunft });
      // Haben sich Objekt oder Vermieter seitdem geändert, ist der gespeicherte Stand
      // (und ein PDF dazu) veraltet — das muss sichtbar sein, nicht still mitlaufen.
      if (stabil(stammdatenTeil(daten)) !== stabil(stammdatenTeil(z.daten))) {
        markiereUngespeichert();
        if (z.dateien.some(f => f.art === 'entwurf_pdf')) {
          toast({
            title: 'Stammdaten haben sich geändert',
            description:
              'Seit dem PDF wurden Angaben zum Haus oder zum Vermieter geändert. Der Entwurf zeigt den aktuellen Stand; beim Speichern entsteht das PDF neu.',
          });
        }
      }
      setPersonen(z.personen.length > 0 ? z.personen : [leerePerson()]);
      setDateien(z.dateien);
      setVorvertragPfad(wahrscheinlichsterVertrag(g.vorvertragDokumente)?.pfad ?? null);
      beginneBei(startSchritt ?? (istSchrittId(z.schritt) ? z.schritt : 'grundlagen'));
      initialisiert.current = true;
      return;
    }

    const neu = baueEntwurf({
      immobilie: g.immobilie,
      einheit: g.einheit,
      vermieter: g.vermieter,
      nebenkostenarten: g.nebenkostenarten,
      vorvertrag: g.vorvertrag,
      heute: heuteIso(),
    });
    setId(crypto.randomUUID());
    setGespeichert(false);
    setStand(neu);
    setPersonen([leerePerson()]);
    setDateien([]);
    const vorschlag = wahrscheinlichsterVertrag(g.vorvertragDokumente);
    setVorvertragPfad(vorschlag?.pfad ?? null);
    beginneBei(startSchritt ?? 'grundlagen');
    initialisiert.current = true;

    // Was nur im alten Dokument steht, gleich mitlesen — solange der
    // Vorvertrag keine gespeicherte Kostenaufstellung hat.
    const hatAufstellung =
      Array.isArray(g.vorvertrag?.betriebskosten_positionen) && g.vorvertrag.betriebskosten_positionen.length > 0;
    if (g.vorvertrag && vorschlag && !hatAufstellung && istWohnraumEinheit(g.einheit.einheitentyp)) {
      void liesVorvertrag(g, vorschlag.pfad, false);
    }
  }, [isOpen, g, grundlagen.isFetching, entwurfId, startSchritt, vorhanden.data, vorhanden.isFetching, liesVorvertrag, markiereUngespeichert, toast]);

  // ─── Personenzahl folgt der Personenliste, bis sie von Hand geändert wird ─
  useEffect(() => {
    setStand(s => {
      if (!s) return s;
      const automatisch = s.herkunft.anzahlPersonen === 'berechnet' || s.daten.anzahlPersonen === 0;
      const zahl = personenzahl(personen);
      if (!automatisch || zahl === 0 || (s.daten.anzahlPersonen === zahl && s.herkunft.anzahlPersonen === 'berechnet')) {
        return s;
      }
      return {
        daten: { ...s.daten, anzahlPersonen: zahl },
        herkunft: { ...s.herkunft, anzahlPersonen: 'berechnet' },
      };
    });
  }, [personen]);

  // Beim Schrittwechsel oben beginnen
  useEffect(() => {
    formular.current?.scrollTo({ top: 0 });
  }, [schritt]);

  // ─── Formular-Schnittstelle ──────────────────────────────────────────────
  const setDaten = useCallback(
    (aenderung: (d: MietvertragDaten) => MietvertragDaten) => setStand(s => (s ? { ...s, daten: aenderung(s.daten) } : s)),
    []
  );
  /** Für die Formulare: jede Eingabe gilt als ungespeicherte Änderung. */
  const setDatenVonHand = useCallback(
    (aenderung: (d: MietvertragDaten) => MietvertragDaten) => {
      setDaten(aenderung);
      markiereUngespeichert();
    },
    [setDaten, markiereUngespeichert]
  );
  const setPersonenVonHand = useCallback(
    (aenderung: (p: EntwurfPerson[]) => EntwurfPerson[]) => {
      setPersonen(aenderung);
      markiereUngespeichert();
    },
    [markiereUngespeichert]
  );
  const geaendert = useCallback(
    (feld: string) => {
      sitzungGeaendert.current.set(feld, (sitzungGeaendert.current.get(feld) ?? 0) + 1);
      vonHandGeaendert.current.add(feld);
      setStand(s => (s ? { ...s, herkunft: ohneHerkunft(s.herkunft, feld) } : s));
      markiereUngespeichert();
    },
    [markiereUngespeichert]
  );
  const meldeUngueltigeZahl = useCallback((schluessel: string, ungueltig: boolean) => {
    setUngueltigeZahlen(alt => {
      if (alt.has(schluessel) === ungueltig) return alt;
      const neu = new Set(alt);
      if (ungueltig) neu.add(schluessel);
      else neu.delete(schluessel);
      return neu;
    });
  }, []);
  const zahlFehler = ungueltigeZahlen.size > 0;
  const setzeHerkunft = useCallback(
    (feld: string, quelle: Herkunft) => setStand(s => (s ? { ...s, herkunft: { ...s.herkunft, [feld]: quelle } } : s)),
    []
  );
  const markierung = useCallback(
    (feld: string) => <HerkunftHinweis quelle={stand?.herkunft[feld]} vorvertragBeginn={g?.vorvertrag?.start_datum} />,
    [stand?.herkunft, g?.vorvertrag?.start_datum]
  );
  const formularProps = stand
    ? { entwurf: stand.daten, setEntwurf: setDatenVonHand, markierung, geaendert, setzeHerkunft }
    : null;

  const vertrag = useMemo(() => (stand ? mitPersonen(stand.daten, personen) : null), [stand, personen]);
  const befunde = useMemo(() => (vertrag && wohnraum ? pruefeVertragsdaten(vertrag) : []), [vertrag, wohnraum]);
  const blockiert = hatBlocker(befunde);
  const vorschau = useVertragsvorschau(vertrag, isOpen && wohnraum, blockiert);
  // Für das Speichern: der jeweils letzte Stand der Vorschau, auch während eines await
  const vorschauJetzt = useRef(vorschau);
  useEffect(() => {
    vorschauJetzt.current = vorschau;
  });
  const luecken = useMemo(() => (stand ? entwurfLuecken(stand.daten, personen) : []), [stand, personen]);
  const zustaende = useMemo(() => schrittZustaende(befunde, luecken), [befunde, luecken]);
  const platzhalter = useMemo(
    () => (vertrag && stand ? platzhalterUebersicht(vertrag, stand.herkunft, personen, befunde, wohnraum) : []),
    [vertrag, stand, personen, befunde, wohnraum]
  );
  const blacklistTreffer = useMemo(() => pruefeBlacklist(personen, blacklist.data ?? []), [personen, blacklist.data]);
  const vollstaendig = luecken.length === 0 && (!wohnraum || !blockiert);

  // ─── Navigation ──────────────────────────────────────────────────────────
  const geheZu = useCallback(
    (s: SchrittId) => {
      // Ohne Vorlage gibt es z. B. „Mietsache & Haus" nicht — dorthin führt kein Sprung
      if (!schritte.includes(s)) return;
      // Ein abgelehnter Betrag ginge beim Verlassen des Schritts verloren und stünde als 0 im Entwurf
      if (zahlFehler) {
        toast({ title: 'Betrag prüfen', description: EURO_BETRAG_HINWEIS, variant: 'destructive' });
        return;
      }
      setSchritt(s);
      setBesucht(b => new Set([...b, s]));
    },
    [schritte, zahlFehler, toast]
  );
  const index = schritte.indexOf(schritt);

  // ─── Selbstauskunft ──────────────────────────────────────────────────────
  async function liesSelbstauskunft(datei: File) {
    // Die Datei wird auch dann abgelegt, wenn die Auslese scheitert — dann eben von Hand.
    const meineSitzung = sitzung.current;
    setNeueSelbstauskuenfte(l => [...l, datei]);
    markiereUngespeichert();
    setLiestSelbstauskunft(true);
    try {
      const antwort = await OCRProcessingService.liesDokument<SelbstauskunftAuslese>(datei, datei.name, 'selbstauskunft');
      // Dialog inzwischen geschlossen: Personen dürfen nicht im nächsten Entwurf landen
      if (meineSitzung !== sitzung.current) return;
      if (!antwort.success || !antwort.extractedData) {
        toast({
          title: 'Selbstauskunft nicht gelesen',
          description: `${antwort.error ?? 'Keine Angaben erkannt.'} Bitte die Personen von Hand erfassen.`,
          variant: 'destructive',
        });
        return;
      }
      const auslese = antwort.extractedData;
      const neu = personenAusSelbstauskunft(auslese);
      if (neu.length === 0) {
        toast({ title: 'Keine Personen erkannt', description: 'Bitte die Personen von Hand erfassen.', variant: 'destructive' });
        return;
      }
      setPersonenVonHand(alt => (alt.every(istLeerePerson) ? neu : [...alt, ...neu]));

      const wunsch = auslese.einzug_ab && auslese.einzug_ab !== 'sofort' ? auslese.einzug_ab : null;
      if (wunsch) {
        setStand(s => {
          if (!s || s.herkunft.mietbeginn !== 'berechnet') return s;
          const beginn = standardMietbeginn(heuteIso(), getVertragsende(g?.vorvertrag ?? null), wunsch);
          return {
            // Ein aus dem Vorvertrag übernommener Verzicht („mindestens 12 Monate") wandert mit
            daten: mitMietbeginn(s.daten, beginn, !!s.herkunft.kuendigungsverzichtBis),
            herkunft: { ...s.herkunft, mietbeginn: beginn === wunsch ? 'selbstauskunft' : 'berechnet' },
          };
        });
      }
      toast({
        title: 'Selbstauskunft gelesen',
        description: `${neu.length} ${neu.length === 1 ? 'Person' : 'Personen'} übernommen. Bitte prüfen, wer Mitmieter und wer nur Mitbewohner ist.`,
      });
    } finally {
      if (meineSitzung === sitzung.current) setLiestSelbstauskunft(false);
    }
  }

  // ─── Speichern ───────────────────────────────────────────────────────────
  /** Angaben fürs ganze Haus und leere Felder der Einheit dorthin, wo sie hingehören. */
  async function schreibeStammdatenZurueck(
    grundlage: EntwurfGrundlagenDaten,
    d: MietvertragDaten,
    marker: Map<string, number>
  ): Promise<{ hinweise: string[]; offen: string[] }> {
    const hinweise: string[] = [];
    // Was nicht gespeichert werden konnte, bleibt als Handänderung vorgemerkt — sonst ginge es beim nächsten Speichern verloren
    const offen: string[] = [];
    const imm = grundlage.immobilie;
    const einrichtungen = (d.mitbenutzungEinrichtungen ?? '')
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean);

    // Zurück ans Objekt geht nur, was dort fehlt oder in dieser Sitzung von Hand geändert wurde.
    const geaendertJetzt = (feld: string) => marker.has(feld);
    const objekt: TablesUpdate<'immobilien'> = {};
    const zentral = d.objekt.heizungsart === 'zentral' || d.objekt.heizungsart === 'fernwaerme';
    if (d.objekt.heizungsart && d.objekt.heizungsart !== imm.heizungsart && (!imm.heizungsart || geaendertJetzt('objekt.heizungsart'))) {
      objekt.heizungsart = d.objekt.heizungsart;
    }
    const warmwasser = zentral ? d.objekt.warmwasser : null;
    if (warmwasser !== imm.warmwasser && (!imm.warmwasser || geaendertJetzt('objekt.warmwasser') || 'heizungsart' in objekt)) {
      objekt.warmwasser = warmwasser;
    }
    if (geaendertJetzt('objekt.heizkostenSchluessel') && d.objekt.heizkostenSchluessel !== imm.heizkosten_schluessel) {
      objekt.heizkosten_schluessel = d.objekt.heizkostenSchluessel;
    }
    if (
      d.objekt.gesamtwohnflaecheQm &&
      d.objekt.gesamtwohnflaecheQm !== Number(imm.gesamtwohnflaeche ?? 0) &&
      (!imm.gesamtwohnflaeche || geaendertJetzt('objekt.gesamtwohnflaecheQm'))
    ) {
      objekt.gesamtwohnflaeche = d.objekt.gesamtwohnflaecheQm;
    }
    if (d.schliessanlageArt && d.schliessanlageArt !== imm.schliessanlage_art && (!imm.schliessanlage_art || geaendertJetzt('schliessanlageArt'))) {
      objekt.schliessanlage_art = d.schliessanlageArt;
    }
    if (
      einrichtungen.length > 0 &&
      einrichtungen.join('|') !== (imm.gemeinschaftseinrichtungen ?? []).join('|') &&
      ((imm.gemeinschaftseinrichtungen ?? []).length === 0 || geaendertJetzt('mitbenutzungEinrichtungen'))
    ) {
      objekt.gemeinschaftseinrichtungen = einrichtungen;
    }
    if (geaendertJetzt('objekt.energieausweis')) {
      // Die fünf Angaben gehören zusammen — von Hand geändert, gehen sie gemeinsam ans Objekt
      objekt.energieausweis_typ = d.objekt.energieausweisTyp;
      objekt.energie_kennwert = d.objekt.energieausweisTyp ? d.objekt.energieKennwert : null;
      objekt.energietraeger = d.objekt.energieausweisTyp ? d.objekt.energietraeger?.trim() || null : null;
      objekt.energieeffizienzklasse = d.objekt.energieausweisTyp ? d.objekt.energieeffizienzklasse : null;
      // Ein halb getipptes Datum wird nicht geschrieben — das bisherige am Objekt bleibt stehen
      const gueltigBis = d.objekt.energieausweisGueltigBis;
      if (!gueltigBis || istPlausiblesDatum(gueltigBis)) objekt.energieausweis_gueltig_bis = gueltigBis || null;
    }
    if (Object.keys(objekt).length > 0) {
      const { data, error } = await supabase.from('immobilien').update(objekt).eq('id', imm.id).select('id');
      if (error || !data?.length) {
        hinweise.push(`Angaben zum Haus wurden nicht am Objekt gespeichert (${error?.message ?? 'keine Berechtigung'}).`);
        offen.push(...FELDER_AM_OBJEKT.filter(geaendertJetzt));
      }
    }

    // An der Einheit nur leere Felder füllen — die Lage im Vertrag kann anders formuliert sein.
    const e = grundlage.einheit;
    const einheit: TablesUpdate<'einheiten'> = {};
    if (!e.bezeichnung?.trim() && d.einheit.bezeichnung.trim()) einheit.bezeichnung = d.einheit.bezeichnung.trim();
    if (!e.etage?.trim() && d.einheit.lage.trim()) einheit.etage = d.einheit.lage.trim();
    if (!(Number(e.qm ?? 0) > 0) && d.einheit.wohnflaecheQm > 0) einheit.qm = d.einheit.wohnflaecheQm;
    const nebenraeume = d.einheit.nebenraeume?.trim() || null;
    if (nebenraeume && nebenraeume !== e.nebenraeume && (!e.nebenraeume?.trim() || geaendertJetzt('einheit.nebenraeume'))) {
      einheit.nebenraeume = nebenraeume;
    }
    if (geaendertJetzt('einheit.einbaukueche') && d.einheit.einbaukueche !== (e.einbaukueche ?? false)) {
      einheit.einbaukueche = d.einheit.einbaukueche;
    }
    if (Object.keys(einheit).length > 0) {
      const { data, error } = await supabase.from('einheiten').update(einheit).eq('id', e.id).select('id');
      if (error || !data?.length) {
        hinweise.push(`Angaben zur Einheit wurden nicht gespeichert (${error?.message ?? 'keine Berechtigung'}).`);
        offen.push(...FELDER_AN_EINHEIT.filter(geaendertJetzt));
      }
    }
    return { hinweise, offen };
  }

  async function speichern(opt: { naechsterSchritt?: SchrittId; danach?: () => void } = {}): Promise<boolean> {
    if (!stand || !vertrag || !g || speichert) return false;
    // Das Feld hat für einen abgelehnten Betrag 0 bzw. leer weitergegeben — so darf nichts gespeichert werden
    if (zahlFehler) {
      toast({ title: 'Nicht gespeichert', description: EURO_BETRAG_HINWEIS, variant: 'destructive' });
      return false;
    }
    setSpeichert(true);
    const standZaehler = aenderungen.current;
    const zielSchritt = opt.naechsterSchritt ?? schritt;
    // Was während des Speicherns dazukommt, bleibt für das nächste Speichern liegen
    const hochzuladen = neueSelbstauskuenfte;
    const marker = new Map(sitzungGeaendert.current);
    try {
      // Wird das PDF gerade erzeugt, kurz darauf warten — sonst ginge der Entwurf ohne PDF
      if (wohnraum && !blockiert) {
        for (let i = 0; i < 40 && !vorschauJetzt.current.aktuell && !vorschauJetzt.current.fehlgeschlagen; i++) {
          await new Promise(r => setTimeout(r, 150));
        }
      }
      // Das PDF wandert nur mit, wenn es genau diesen Stand zeigt — wer währenddessen
      // weitergetippt hat, speichert ohne PDF und behält ungespeicherte Änderungen
      const v = vorschauJetzt.current;
      const pdf = wohnraum && v.aktuell && aenderungen.current === standZaehler ? v.pdfBlob : null;
      const ergebnis = await speichereEntwurf({
        id,
        istNeu: !gespeichert,
        aktualisiertAm,
        einheitId,
        vorvertragId: g.vorvertrag?.id ?? null,
        daten: vertrag,
        personen: personen.filter(p => !istLeerePerson(p)),
        herkunft: stand.herkunft,
        bisherigeDateien: dateien,
        pdf,
        // Unverändert seit dem letzten Speichern: Das vorhandene PDF zeigt noch genau diesen Stand
        pdfBehalten: !ungespeichert,
        selbstauskuenfte: hochzuladen,
        schritt: zielSchritt,
      });
      setDateien(ergebnis.dateien);
      setAktualisiertAm(ergebnis.aktualisiertAm);
      setGespeichert(true);
      setNeueSelbstauskuenfte(l => l.filter(f => !hochzuladen.includes(f)));
      setUngespeichert(aenderungen.current !== standZaehler);
      setZuletztGespeichert(new Date());

      const { hinweise, offen } = await schreibeStammdatenZurueck(g, stand.daten, marker);
      // Nur erledigte Marker entfernen: Was während des Speicherns geändert wurde, bleibt vorgemerkt
      for (const [feld, zaehler] of marker) {
        // Nur erledigte Marker entfernen — wer das Feld währenddessen erneut geändert hat, behält ihn
        if (!offen.includes(feld) && sitzungGeaendert.current.get(feld) === zaehler) sitzungGeaendert.current.delete(feld);
      }
      logActivity('mietvertrag_entwurf_gespeichert', 'mietvertrag_entwurf', id, { mit_pdf: !!pdf, schritt: zielSchritt });

      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] });
      // Nicht nur als veraltet markieren: beim nächsten Öffnen darf kein alter Stand aufblitzen
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', id] });
      queryClient.invalidateQueries({ queryKey: ['immobilie', g.immobilie.id] });
      queryClient.invalidateQueries({ queryKey: ['einheiten', g.immobilie.id] });
      void grundlagen.refetch();

      if (hinweise.length > 0) {
        toast({ title: 'Entwurf gespeichert, aber', description: hinweise.join(' '), variant: 'destructive' });
      }
      if (opt.naechsterSchritt) geheZu(opt.naechsterSchritt);
      opt.danach?.();
      return true;
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
      return false;
    } finally {
      setSpeichert(false);
    }
  }

  function verlassen(ziel: Verlassen) {
    if (ziel === 'direkt') onDirektErfassen?.();
    else onClose();
  }

  /** Schließen oder zum direkten Erfassen wechseln — bei ungespeicherten Änderungen erst nachfragen. */
  function versucheSchliessen(ziel: Verlassen = 'schliessen') {
    if (speichert) return;
    if (ungespeichert) setFrageSchliessen(ziel);
    else verlassen(ziel);
  }

  // Neu laden oder Tab schließen: Eingaben, die noch nicht gespeichert sind, wären weg
  useEffect(() => {
    if (!isOpen || !(ungespeichert || speichert)) return;
    const warnen = (ereignis: BeforeUnloadEvent) => {
      ereignis.preventDefault();
      ereignis.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [isOpen, ungespeichert, speichert]);

  // ─── Darstellung ─────────────────────────────────────────────────────────
  const laedt = !stand && (grundlagen.isFetching || (!!entwurfId && vorhanden.isFetching));
  const ladefehler = grundlagen.error ?? vorhanden.error;
  const selbstauskuenfte = [
    ...dateien.filter(d => d.art === 'selbstauskunft').map(d => d.titel),
    ...neueSelbstauskuenfte.map(f => f.name),
  ];
  const ueberschrift = g
    ? [g.immobilie.name?.trim() || g.immobilie.strasse, g.einheit.bezeichnung || g.einheit.etage || g.einheit.einheitentyp]
        .filter(Boolean)
        .join(' · ')
    : '';
  const hauptmieter = (() => {
    const p = personen.find(x => x.rolle === 'mitmieter' && hatNamen(x));
    if (!p) return null;
    return p.istUnternehmen ? p.firmenname ?? null : `${p.vorname} ${p.nachname}`.trim() || null;
  })();
  const hatPdf = dateien.some(d => d.art === 'entwurf_pdf');
  const vorvertragId = g?.vorvertrag?.id ?? null;
  const gespeicherterEntwurf: EntwurfZeile | null = useMemo(
    () =>
      gespeichert && stand && vertrag
        ? {
            id,
            einheitId,
            vorvertragId,
            daten: vertrag,
            personen: personen.filter(p => !istLeerePerson(p)),
            herkunft: stand.herkunft,
            dateien,
            erstelltAm: '',
            aktualisiertAm: aktualisiertAm ?? '',
            schritt,
          }
        : null,
    [gespeichert, stand, vertrag, id, einheitId, vorvertragId, personen, dateien, aktualisiertAm, schritt]
  );
  const andere = (alleEntwuerfe ?? []).filter(e => e.einheitId === einheitId && e.id !== id);
  const pdfBereit = wohnraum && vollstaendig && vorschau.aktuell;
  const blockiertWeil = liestSelbstauskunft || ausleseStatus.art === 'laeuft';

  const statusText = speichert
    ? 'Speichert …'
    : ungespeichert
      ? 'Ungespeicherte Änderungen'
      : zuletztGespeichert
        ? `Gespeichert um ${zuletztGespeichert.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
        : gespeichert
          ? 'Gespeicherter Entwurf'
          : 'Noch nicht gespeichert';

  function schrittInhalt() {
    if (!stand || !g || !formularProps) return null;
    switch (schritt) {
      case 'grundlagen':
        return (
          <GrundlagenSchritt
            g={g}
            daten={stand.daten}
            vorvertragPfad={vorvertragPfad}
            setVorvertragPfad={setVorvertragPfad}
            ausleseStatus={ausleseStatus}
            onAuslesen={() => vorvertragPfad && void liesVorvertrag(g, vorvertragPfad, true)}
            onVermieterBearbeiten={() => setZeigeVermieter(true)}
            onDirektErfassen={!gespeichert && onDirektErfassen ? () => versucheSchliessen('direkt') : undefined}
          />
        );
      case 'mieter':
        return (
          <div className="space-y-5">
            {(bestand.error || blacklist.error) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {bestand.error &&
                    'Der Mieterbestand ist gerade nicht erreichbar — bestehende Mieter lassen sich nicht wählen, Dubletten werden nicht erkannt. '}
                  {blacklist.error && 'Die Bewerber-Blacklist konnte nicht geprüft werden. '}
                  Bitte den Ablauf später neu öffnen oder von Hand prüfen.
                </AlertDescription>
              </Alert>
            )}
            <InteressentenAbschnitt
              personen={personen}
              setPersonen={setPersonenVonHand}
              bestand={bestand.data ?? []}
              bestandLaedt={bestand.isLoading}
              bestandFehler={!!bestand.error}
              blacklistTreffer={blacklistTreffer}
              onSelbstauskunft={datei => void liesSelbstauskunft(datei)}
              liestSelbstauskunft={liestSelbstauskunft}
              selbstauskuenfte={selbstauskuenfte}
            />
            <Separator />
            <PersonenzahlFeld {...formularProps} />
          </div>
        );
      case 'miete':
        return (
          <MieteSchritt
            {...formularProps}
            kautionFolgtMiete={stand.herkunft.kautionBetrag === 'berechnet' || stand.daten.kautionBetrag === 0}
            verzichtFolgtBeginn={!!stand.herkunft.kuendigungsverzichtBis}
            indexVorschlag={indexVorschlag(g.vpi)}
            hauptmieter={hauptmieter}
          />
        );
      case 'mietsache':
        return (
          <div className="space-y-5">
            <MietsacheFelder {...formularProps} mitPersonenzahl={false} />
            <SchluesselFelder {...formularProps} />
            <Separator />
            <ObjektAngabenFelder {...formularProps} gesamtflaecheVorschlag={g.summeEinheitenQm} />
            <Separator />
            <EnergieausweisFelder {...formularProps} />
          </div>
        );
      case 'betriebskosten':
        return <BetriebskostenEditor {...formularProps} />;
      case 'vereinbarungen':
        return (
          <div className="space-y-5">
            <UebergabeFelder {...formularProps} />
            <KleinreparaturFelder {...formularProps} />
            <Separator />
            <div className="space-y-2">
              <Feldname htmlFor="besichtigt" marke={markierung('besichtigtAm')}>
                Wohnung besichtigt am
              </Feldname>
              <Input
                id="besichtigt"
                type="date"
                value={stand.daten.besichtigtAm ?? ''}
                onChange={e => {
                  setDatenVonHand(d => ({ ...d, besichtigtAm: e.target.value || null }));
                  geaendert('besichtigtAm');
                }}
              />
              <p className="text-xs text-muted-foreground">
                Nach einer Besichtigung besteht kein Widerrufsrecht; ohne Datum wird die Widerrufsbelehrung beigefügt.
              </p>
            </div>
            <AnlagenFelder {...formularProps} />
            <Separator />
            <ZusatzvereinbarungFeld {...formularProps} />
            <UnterzeichnungFelder {...formularProps} />
          </div>
        );
      case 'pruefen':
        return (
          <PruefenSchritt
            gruppen={platzhalter}
            befunde={befunde}
            luecken={luecken}
            wohnraum={wohnraum}
            schritte={schritte}
            vorvertragBeginn={g.vorvertrag?.start_datum ?? null}
            onGeheZu={geheZu}
            onVermieterOeffnen={() => setZeigeVermieter(true)}
          />
        );
      case 'start':
        return (
          <StartSchritt
            entwurf={gespeicherterEntwurf}
            ungespeichert={ungespeichert}
            wohnraum={wohnraum}
            vollstaendig={vollstaendig}
            luecken={luecken}
            andere={andere}
            speichert={speichert}
            onSpeichern={() => speichern()}
            onGeheZu={geheZu}
            onAktiviert={() => {
              setUngespeichert(false);
              onClose();
            }}
          />
        );
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={o => !o && versucheSchliessen()}>
        <DialogContent className="flex h-[94vh] max-w-[96vw] flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-3">
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {entwurfId ? 'Mietvertrag fortsetzen' : 'Neuer Mietvertrag'}
              {stand && <span className="text-sm font-normal text-muted-foreground">— {schrittTitel(schritt, wohnraum)}</span>}
            </DialogTitle>
            <DialogDescription>
              {ueberschrift && <span className="font-medium text-foreground">{ueberschrift}. </span>}
              Bis zum Aktivieren ist alles ein Entwurf: Die Einheit bleibt frei und es entstehen keine Forderungen.
            </DialogDescription>
          </DialogHeader>

          {laedt && (
            <div className="flex flex-1 items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Objekt, Einheit und Vorvertrag werden geladen …</span>
            </div>
          )}

          {ladefehler && !stand && (
            <div className="flex flex-1 items-center justify-center p-8">
              <Alert variant="destructive" className="max-w-lg">
                <AlertDescription>Die Daten konnten nicht geladen werden: {String(ladefehler.message ?? ladefehler)}</AlertDescription>
              </Alert>
            </div>
          )}

          {stand && vertrag && g && !laedt && (
            <>
              <Schrittleiste
                schritte={schritte}
                aktuell={schritt}
                zustaende={zustaende}
                besucht={besucht}
                wohnraum={wohnraum}
                onWaehle={geheZu}
              />

              <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(460px,42%)_1fr]">
                {/* ── Schritt ── */}
                <div ref={formular} className="overflow-y-auto border-r p-5">
                  <UngueltigeZahlFelder.Provider value={meldeUngueltigeZahl}>{schrittInhalt()}</UngueltigeZahlFelder.Provider>
                </div>

                {/* ── Vorschau ── */}
                <div className="hidden flex-col overflow-hidden bg-muted/30 lg:flex">
                  {wohnraum && blockiert ? (
                    schritt === 'pruefen' ? (
                      <div className="flex flex-1 items-center justify-center p-8 text-center">
                        <div className="max-w-sm space-y-2">
                          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
                          <p className="font-medium">Vorschau gesperrt</p>
                          <p className="text-sm text-muted-foreground">Sobald links nichts mehr fehlt, erscheint hier der Vertrag.</p>
                        </div>
                      </div>
                    ) : (
                      // Statt einer leeren Fläche: was fehlt, steht dort, wo sonst der Vertrag stünde
                      <div className="flex-1 space-y-4 overflow-y-auto p-6">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="font-medium">Vorschau gesperrt</p>
                            <p className="text-sm text-muted-foreground">
                              Solange Pflichtangaben fehlen, entsteht kein PDF — ein Vertrag darf nichts behaupten, was nicht
                              erfasst ist. Zwischenspeichern geht trotzdem.
                            </p>
                          </div>
                        </div>
                        <PruefungsHinweise befunde={befunde} onVermieterOeffnen={() => setZeigeVermieter(true)} />
                      </div>
                    )
                  ) : wohnraum ? (
                    <>
                      {befunde.length > 0 && (
                        <div className="border-b bg-background px-4 py-2">
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setZeigeHinweise(z => !z)}>
                            <Info className="h-3.5 w-3.5" />
                            {befunde.length} {befunde.length === 1 ? 'Hinweis' : 'Hinweise'} zur Vorlage
                            {zeigeHinweise ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                          {zeigeHinweise && (
                            <div className="max-h-64 overflow-y-auto pb-2 pt-1">
                              <PruefungsHinweise befunde={befunde} onVermieterOeffnen={() => setZeigeVermieter(true)} />
                            </div>
                          )}
                        </div>
                      )}
                      <VertragsVorschau gesperrt={false} pdfUrl={vorschau.pdfUrl} erzeugt={vorschau.erzeugt} />
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-8">
                      <div className="max-w-md space-y-2 text-center">
                        <FileSignature className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="font-medium">Keine Vorlage für {g.einheit.einheitentyp ?? 'diesen Einheitstyp'}</p>
                        <p className="text-sm text-muted-foreground">
                          Abgenommen ist bisher nur die Wohnraum-Vorlage. Der Entwurf hält Mieter und Konditionen fest; den
                          unterschriebenen Vertrag lädst du im letzten Schritt hoch.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Fußleiste ── */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-3">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => versucheSchliessen()} disabled={speichert}>
                    Abbrechen
                  </Button>
                  <Button variant="outline" onClick={() => void speichern()} disabled={speichert || blockiertWeil || zahlFehler}>
                    {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Zwischenspeichern
                  </Button>
                  <span className={ungespeichert ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>{statusText}</span>
                  {zahlFehler && (
                    <span role="alert" className="text-xs text-destructive">
                      {EURO_BETRAG_HINWEIS}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {wohnraum && schritt !== 'start' && (
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {blockiert || luecken.length > 0
                        ? 'PDF: Pflichtangaben offen'
                        : vorschau.fehlgeschlagen
                          ? 'PDF ließ sich nicht erzeugen'
                          : vorschau.aktuell
                            ? 'PDF bereit'
                            : 'Vorschau wird aktualisiert …'}
                    </span>
                  )}
                  {index > 0 && (
                    <Button variant="outline" onClick={() => geheZu(schritte[index - 1])} disabled={speichert || zahlFehler}>
                      <ArrowLeft className="h-4 w-4" />
                      Zurück
                    </Button>
                  )}
                  {schritt === 'pruefen' ? (
                    <Button
                      onClick={() => void speichern({ naechsterSchritt: 'start' })}
                      disabled={speichert || blockiertWeil || zahlFehler || (wohnraum ? !pdfBereit : luecken.length > 0)}
                      title={wohnraum && !pdfBereit ? 'Erst alle Pflichtangaben erfassen' : undefined}
                    >
                      {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                      {wohnraum ? (hatPdf && !ungespeichert ? 'PDF neu erstellen' : 'PDF erstellen') : 'Entwurf speichern'}
                    </Button>
                  ) : schritt === 'start' ? (
                    <Button variant="outline" onClick={() => versucheSchliessen()} disabled={speichert}>
                      Schließen
                    </Button>
                  ) : (
                    <Button onClick={() => geheZu(schritte[index + 1])} disabled={speichert || zahlFehler}>
                      Weiter
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Neben dem Dialog, nicht darin: sonst schließt das Speichern der Stammdaten auch den Entwurf. */}
      <VermieterStammdatenDialog
        isOpen={zeigeVermieter}
        onClose={() => setZeigeVermieter(false)}
        onGespeichert={() => {
          setZeigeVermieter(false);
          // Die ergänzten Stammdaten gleich in den Entwurf übernehmen
          void grundlagen.refetch().then(r => {
            if (!r.data) return;
            const neu = vermieterDaten(r.data.vermieter, r.data.immobilie);
            if (stand && stabil(neu) === stabil(stand.daten.vermieter)) return;
            setDaten(d => ({ ...d, vermieter: neu }));
            // Das gespeicherte PDF zeigt noch die alten Stammdaten — erst Speichern bringt beides zusammen
            markiereUngespeichert();
          });
        }}
      />

      <AlertDialog open={!!frageSchliessen} onOpenChange={o => !o && setFrageSchliessen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
            <AlertDialogDescription>
              {gespeichert
                ? 'Die letzten Änderungen am Entwurf sind noch nicht gespeichert.'
                : 'Der Entwurf wurde noch nicht gespeichert.'}{' '}
              Speichern und später an derselben Stelle weitermachen, oder verwerfen?
              {blockiertWeil && ' Die KI liest gerade noch ein Dokument — zum Speichern bitte kurz warten.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const ziel = frageSchliessen ?? 'schliessen';
                setFrageSchliessen(null);
                setUngespeichert(false);
                verlassen(ziel);
              }}
            >
              Verwerfen
            </Button>
            <AlertDialogAction
              disabled={blockiertWeil || zahlFehler}
              onClick={ev => {
                ev.preventDefault();
                const ziel = frageSchliessen ?? 'schliessen';
                setFrageSchliessen(null);
                void speichern({ danach: () => verlassen(ziel) });
              }}
            >
              {frageSchliessen === 'direkt' ? 'Speichern und wechseln' : 'Speichern und schließen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
