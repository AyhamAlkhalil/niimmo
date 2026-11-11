/**
 * „Neue Vermietung“: das Mietverhältnis im System, in drei Schritten (seit 11.11.2026):
 *
 *   Mieter → Miete & Laufzeit → Abschließen
 *
 * Bis zum Abschließen ist die Vermietung ein Vorgang (`mietvertrag_entwuerfe`): Die Einheit gilt nicht als
 * vermietet, es entstehen keine Forderungen. „Mieter speichern“ legt den Mieter an, „Miete speichern“ merkt die
 * Eckdaten vor; die Einheit zeigt, wie weit der Vorgang ist. Zwischenspeichern geht jederzeit, Abbrechen fragt bei
 * ungespeicherten Änderungen nach.
 *
 * Der Mietvertrag als PDF ist kein Teil davon (Nutzer 11.11.2026: „ein anderer Prozess als einen Mietvertrag im
 * System zu haben … die Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt werden“).
 * Er entsteht am laufenden Vertrag (`MietvertragErstellungModal`); bis dahin lagen hier fünf Vertragsschritte mit
 * Vorschau zwischen Miete und Aktivieren.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, PenLine, Save } from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';
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
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { OCRProcessingService } from '@/services/ocrProcessingService';
import { speichereEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { getVertragsende } from '@/utils/contractUtils';
import { mitSchluesselnDesObjekts, objektDaten, vermieterDaten } from '@/utils/mietvertrag/datenAusDb';
import {
  baueEntwurf,
  hatNamen,
  indexVorschlag,
  istLeerePerson,
  istWohnraumEinheit,
  leerePerson,
  mitAngelegtenMietern,
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
  alsSchritt,
  bereichFuerFeld,
  naechsterWeitester,
  mieteVorgemerkt,
  ERSTER_SCHRITT,
  entwurfLuecken,
  SCHRITTE,
  schrittTitel,
  schrittZustaende,
  type SchrittId,
} from '@/utils/mietvertrag/entwurfProzess';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';
import { EURO_BETRAG_HINWEIS } from '@/utils/euroBetrag';
import { PersonenzahlFeld } from '../mietvertrag-formular/Abschnitte';
import { HerkunftHinweis, UngueltigeZahlFelder } from '../mietvertrag-formular/Bausteine';
import { AbschliessenSchritt } from './AbschliessenSchritt';
import { InteressentenAbschnitt } from './InteressentenAbschnitt';
import { useMieterAnlegen } from './MieterAnlegen';
import { MieteSchritt } from './MieteSchritt';
import { Schrittleiste } from './Schrittleiste';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  einheitId: string;
  /** Vorhandenen Entwurf fortsetzen; ohne ID entsteht ein neuer. */
  entwurfId?: string | null;
  /** In diesem Schritt einsteigen, z. B. „start“ für „Abschließen“ auf der Einheitskarte. */
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
/**
 * Was vom Objekt in den Vertrag übernommen wird (`vertragsZeile`). Hat es sich seit dem Speichern geändert, muss vor
 * dem Abschließen gespeichert werden — abgeschlossen wird der gespeicherte Stand.
 */
function vomObjektImVertrag(d: MietvertragDaten) {
  return {
    // Seit 03.11.2026 fest vom Objekt
    verteilerschluessel: d.betriebskostenPositionen.map(p => `${p.nummer}:${p.schluessel}`),
    schliessanlageArt: d.schliessanlageArt,
    // Am Objekt als Liste gespeichert — „Waschkeller,Hof" und „Waschkeller, Hof" sind dasselbe
    mitbenutzungEinrichtungen: (d.mitbenutzungEinrichtungen ?? '')
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean)
      .join(', '),
  };
}

/** Alles, was ein PDF aus dem früheren Ablauf vom Objekt und vom Vermieter zeigt. */
function stammdatenTeil(d: MietvertragDaten) {
  return { ...vomObjektImVertrag(d), vermieter: d.vermieter, objekt: d.objekt };
}

/** Stand der automatischen Vorvertrags-Auslese beim Anlegen. */
type AusleseStatus = { art: 'bereit' } | { art: 'laeuft' } | { art: 'fertig' } | { art: 'fehler'; text: string };

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
  const mieterAnlegen = useMieterAnlegen();

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
  const [ausleseStatus, setAusleseStatus] = useState<AusleseStatus>({ art: 'bereit' });
  const [speichert, setSpeichert] = useState(false);
  const [aktualisiertAm, setAktualisiertAm] = useState<string | null>(null);
  const [schritt, setSchritt] = useState<SchrittId>(ERSTER_SCHRITT);
  /** Weitester gespeicherter Schritt — der Stand der Vermietung an der Einheit (11.11.2026). */
  const [weitester, setWeitester] = useState<SchrittId | null>(null);
  const weitesterRef = useRef<SchrittId | null>(null);
  useEffect(() => {
    weitesterRef.current = weitester;
  }, [weitester]);
  const [besucht, setBesucht] = useState<Set<SchrittId>>(new Set([ERSTER_SCHRITT]));
  const [ungespeichert, setUngespeichert] = useState(false);
  const [frageSchliessen, setFrageSchliessen] = useState<Verlassen | null>(null);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<Date | null>(null);
  const initialisiert = useRef(false);
  /** Was in dieser Sitzung von Hand geändert wurde — die Vorvertrags-Auslese lässt diese Felder stehen (28.10.2026). */
  const vonHandGeaendert = useRef(new Set<string>());
  /** Zahlenfelder mit abgelehntem Betrag (z. B. „1.200") — solange eines da ist, geht es nicht weiter. */
  const [ungueltigeZahlen, setUngueltigeZahlen] = useState<ReadonlySet<string>>(new Set());
  /** Zählt Öffnungen; eine KI-Antwort aus einer früheren Sitzung wird verworfen. */
  const sitzung = useRef(0);
  /** Zählt Eingaben; was während des Speicherns geändert wird, bleibt ungespeichert. */
  const aenderungen = useRef(0);
  const formular = useRef<HTMLDivElement>(null);

  const wohnraum = istWohnraumEinheit(g?.einheit.einheitentyp);
  const schritte = SCHRITTE;

  // ─── Schließen setzt alles zurück ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) return;
    sitzung.current += 1;
    initialisiert.current = false;
    vonHandGeaendert.current = new Set();
    aenderungen.current = 0;
    setAktualisiertAm(null);
    setGespeichert(false);
    setStand(null);
    setPersonen([]);
    setDateien([]);
    setNeueSelbstauskuenfte([]);
    setAusleseStatus({ art: 'bereit' });
    setSchritt(ERSTER_SCHRITT);
    setWeitester(null);
    setBesucht(new Set([ERSTER_SCHRITT]));
    setUngespeichert(false);
    setFrageSchliessen(null);
    setZuletztGespeichert(null);
  }, [isOpen]);

  const markiereUngespeichert = useCallback(() => {
    aenderungen.current += 1;
    setUngespeichert(true);
  }, []);

  // ─── Vorvertrag lesen ────────────────────────────────────────────────────
  /**
   * Beim Anlegen liest die KI den letzten Vertrag der Einheit mit — was nur im alten Dokument steht (Räume,
   * Kostenaufstellung, Heizkosten, Mindestlaufzeit). Es geht beim Abschließen in den Vertrag und steht damit auch
   * im Mietvertrag (PDF), der dort noch einmal geprüft wird.
   */
  const liesVorvertrag = useCallback(
    async (grundlage: EntwurfGrundlagenDaten, pfad: string) => {
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
        // Eine vorgemerkte Miete bleibt: Sonst stünde wieder die alte aus dem Vorvertrag im neuen Vertrag (11.11.2026)
        const geschuetzt = (f: string) =>
          vonHandGeaendert.current.has(f) || (mieteVorgemerkt(weitesterRef.current) && bereichFuerFeld(f) === 'miete');
        setStand(s => (s ? wendeVorvertragAuslese(s.daten, s.herkunft, auslese, gesamt, geschuetzt) : s));
        setAusleseStatus({ art: 'fertig' });
      } catch (e) {
        if (meineSitzung !== sitzung.current) return;
        const text = e instanceof Error ? e.message : String(e);
        setAusleseStatus({ art: 'fehler', text });
        // Kein stiller Fehlschlag: Die Werte bleiben dann die aus der Datenbank
        toast({
          title: 'Vorvertrag nicht gelesen',
          description: `${text} Vorbelegt sind die Werte aus der Datenbank — bitte Miete und Laufzeit prüfen.`,
        });
      }
    },
    [toast]
  );

  // ─── Erste Fassung ───────────────────────────────────────────────────────
  useEffect(() => {
    // Erst mit frisch geladenen Daten belegen: Der Cache liefert sonst den Stand vor dem letzten Speichern.
    if (!isOpen || initialisiert.current || !g || grundlagen.isFetching) return;
    const beginneBei = (s: SchrittId) => {
      setSchritt(s);
      setBesucht(new Set(SCHRITTE.slice(0, SCHRITTE.indexOf(s) + 1)));
    };

    if (entwurfId) {
      if (!vorhanden.data || vorhanden.isFetching) return;
      const z = vorhanden.data;
      setId(z.id);
      setGespeichert(true);
      setAktualisiertAm(z.aktualisiertAm);
      // Ein Entwurf aus dem Ablauf bis zum 11.11.2026 kann auf einem Vertragsschritt stehen: Der liegt vor dem Abschließen
      setWeitester(alsSchritt(z.weitesterSchritt));
      // Haus- und Vermieterangaben gelten wie gespeichert am Objekt, nicht wie im
      // Entwurf festgehalten — sonst schriebe das Speichern einen alten Stand zurück.
      const aktuell = objektDaten(g.immobilie);
      const einrichtungen = (g.immobilie.gemeinschaftseinrichtungen ?? []).filter(Boolean);
      const daten: MietvertragDaten = {
        ...z.daten,
        vermieter: vermieterDaten(g.vermieter),
        objekt: {
          ...aktuell,
          heizungsart: aktuell.heizungsart ?? z.daten.objekt.heizungsart,
          warmwasser: aktuell.warmwasser ?? z.daten.objekt.warmwasser,
          gesamtwohnflaecheQm: aktuell.gesamtwohnflaecheQm ?? z.daten.objekt.gesamtwohnflaecheQm,
        },
        schliessanlageArt: g.immobilie.schliessanlage_art ?? z.daten.schliessanlageArt,
        mitbenutzungEinrichtungen: einrichtungen.length > 0 ? einrichtungen.join(', ') : z.daten.mitbenutzungEinrichtungen,
        betriebskostenPositionen: mitSchluesselnDesObjekts(z.daten.betriebskostenPositionen, g.nebenkostenarten, { uebernehmen: true }),
      };
      setStand({ daten, herkunft: z.herkunft });
      // Hat sich am Objekt geändert, was in den Vertrag geht, ist der gespeicherte Stand veraltet: erst speichern.
      // Ein PDF aus dem früheren Ablauf zeigt auch Haus und Vermieter — ist es veraltet, fällt es beim Speichern weg.
      // Nur vergleichen, was die Vermietung betrifft; sonst stünde ohne Grund „ungespeichert“ da (Review 11.11.2026).
      const pdfVeraltet =
        z.dateien.some(f => f.art === 'entwurf_pdf') && stabil(stammdatenTeil(daten)) !== stabil(stammdatenTeil(z.daten));
      if (pdfVeraltet || stabil(vomObjektImVertrag(daten)) !== stabil(vomObjektImVertrag(z.daten))) {
        markiereUngespeichert();
        toast({
          title: 'Angaben am Objekt haben sich geändert',
          description: pdfVeraltet
            ? 'Seit dem PDF wurden Angaben zum Haus oder zum Vermieter geändert. Beim Speichern entfällt das alte PDF; den Mietvertrag erstellst du nach dem Abschließen an der Einheit.'
            : 'Verteilerschlüssel, Schließanlage oder Gemeinschaftseinrichtungen sind am Objekt neu. Bitte speichern — abgeschlossen wird der gespeicherte Stand.',
        });
      }
      setPersonen(z.personen.length > 0 ? z.personen : [leerePerson()]);
      setDateien(z.dateien);
      // Nie aufs Abschließen, solange die Miete nicht vorgemerkt ist — etwa bei einem Entwurf der alten App auf
      // „Grundlagen“, die damals vor der Miete kam (Review 11.11.2026)
      const weiterBei = alsSchritt(z.schritt) ?? ERSTER_SCHRITT;
      beginneBei(startSchritt ?? (weiterBei === 'start' && !mieteVorgemerkt(z.weitesterSchritt) ? 'miete' : weiterBei));
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
      vpi: g.vpi,
    });
    setId(crypto.randomUUID());
    setGespeichert(false);
    setStand(neu);
    setPersonen([leerePerson()]);
    setDateien([]);
    const vorschlag = wahrscheinlichsterVertrag(g.vorvertragDokumente);
    beginneBei(startSchritt ?? ERSTER_SCHRITT);
    initialisiert.current = true;

    // Was nur im alten Dokument steht, gleich mitlesen — solange der
    // Vorvertrag keine gespeicherte Kostenaufstellung hat.
    const hatAufstellung =
      Array.isArray(g.vorvertrag?.betriebskosten_positionen) && g.vorvertrag.betriebskosten_positionen.length > 0;
    if (g.vorvertrag && vorschlag && !hatAufstellung && istWohnraumEinheit(g.einheit.einheitentyp)) {
      void liesVorvertrag(g, vorschlag.pfad);
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
  const luecken = useMemo(() => (stand ? entwurfLuecken(stand.daten, personen) : []), [stand, personen]);
  const zustaende = useMemo(() => schrittZustaende(luecken), [luecken]);
  const blacklistTreffer = useMemo(() => pruefeBlacklist(personen, blacklist.data ?? []), [personen, blacklist.data]);

  // ─── Navigation ──────────────────────────────────────────────────────────
  const geheZu = useCallback(
    (s: SchrittId) => {
      // Ein abgelehnter Betrag ginge beim Verlassen des Schritts verloren und stünde als 0 im Entwurf
      if (zahlFehler) {
        toast({ title: 'Betrag prüfen', description: EURO_BETRAG_HINWEIS, variant: 'destructive' });
        return;
      }
      setSchritt(s);
      setBesucht(b => new Set([...b, s]));
    },
    [zahlFehler, toast]
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
  /**
   * `vormerken`: „Miete speichern“ — nur damit rückt der Vorgang über die Miete hinaus (Review 11.11.2026). Haus- und
   * Einheitsangaben gehen von hier nicht mehr ans Objekt zurück: Die Vermietung zeigt sie nicht; das macht der
   * Mietvertrag (PDF), in dem man sie sieht.
   */
  async function speichern(opt: { naechsterSchritt?: SchrittId; danach?: () => void; vormerken?: boolean } = {}): Promise<boolean> {
    if (!stand || !vertrag || !g || speichert) return false;
    // Das Feld hat für einen abgelehnten Betrag 0 bzw. leer weitergegeben — so darf nichts gespeichert werden
    if (zahlFehler) {
      toast({ title: 'Nicht gespeichert', description: EURO_BETRAG_HINWEIS, variant: 'destructive' });
      return false;
    }
    setSpeichert(true);
    const standZaehler = aenderungen.current;
    const zielSchritt = opt.naechsterSchritt ?? schritt;
    const neuWeitester = naechsterWeitester(weitester, zielSchritt, !!opt.vormerken);
    // Was während des Speicherns dazukommt, bleibt für das nächste Speichern liegen
    const hochzuladen = neueSelbstauskuenfte;
    try {
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
        // Ein PDF entsteht hier nicht mehr. Eines aus dem früheren Ablauf bleibt nur, solange es den Stand noch zeigt.
        pdf: null,
        pdfBehalten: !ungespeichert,
        selbstauskuenfte: hochzuladen,
        schritt: zielSchritt,
        weitesterSchritt: neuWeitester,
      });
      setDateien(ergebnis.dateien);
      setAktualisiertAm(ergebnis.aktualisiertAm);
      setWeitester(neuWeitester);
      setGespeichert(true);
      setNeueSelbstauskuenfte(l => l.filter(f => !hochzuladen.includes(f)));
      setUngespeichert(aenderungen.current !== standZaehler);
      setZuletztGespeichert(new Date());

      logActivity('mietvertrag_entwurf_gespeichert', 'mietvertrag_entwurf', id, { schritt: zielSchritt });

      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] });
      // Nicht nur als veraltet markieren: beim nächsten Öffnen darf kein alter Stand aufblitzen
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', id] });

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

  /**
   * „Mieter speichern“: Der Mieter ist der erste Zwischenstand der Vermietung und kommt gleich in den Bestand
   * (11.11.2026: „nicht durch den Button … einfach ein Prozess“). Weiter geht es erst, wenn er angelegt ist.
   * Steht nur ein Bestandsmieter auf den Karten, wird wie bisher nur gespeichert.
   */
  async function mieterSpeichern(ziel: SchrittId) {
    const legtAn = await mieterAnlegen.starten({
      entwurfId: id,
      personen,
      bestand: bestand.error ? undefined : bestand.data,
      vorher: () => speichern(),
      danach: ergebnis => {
        // Ohne den Datensatz an der Karte schriebe das nächste Speichern ihn weg — die Aktivierung legte die Person dann doppelt an
        setPersonen(p => mitAngelegtenMietern(p, ergebnis.personen));
        setAktualisiertAm(ergebnis.aktualisiertAm);
        geheZu(ziel);
      },
    });
    if (!legtAn) void speichern({ naechsterSchritt: ziel });
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
            weitesterSchritt: weitester,
          }
        : null,
    [gespeichert, stand, vertrag, id, einheitId, vorvertragId, personen, dateien, aktualisiertAm, schritt, weitester]
  );
  const andere = (alleEntwuerfe ?? []).filter(e => e.einheitId === einheitId && e.id !== id);
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
      case 'mieter':
        return (
          <div className="space-y-5">
            <p className="text-sm">
              Zuerst den Mieter: Selbstauskunft hochladen oder einen vorhandenen Mieter wählen und die Angaben prüfen.
              „Mieter speichern“ legt ihn im Mieterbestand an; danach Miete und Mietbeginn vormerken und die Vermietung
              abschließen. Die Einheit zeigt, wie weit die Vermietung ist. Den Mietvertrag als PDF erstellst du, wenn du
              ihn brauchst, am laufenden Vertrag.
            </p>
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
            {!gespeichert && onDirektErfassen && (
              <p className="text-xs text-muted-foreground">
                Der Vertrag ist schon unterschrieben und soll nur erfasst werden?{' '}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => versucheSchliessen('direkt')}
                >
                  Bestehenden Vertrag direkt erfassen
                </Button>
              </p>
            )}
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
      case 'start':
        return (
          <AbschliessenSchritt
            entwurf={gespeicherterEntwurf}
            mieteVorgemerkt={mieteVorgemerkt(weitester)}
            ungespeichert={ungespeichert}
            wohnraum={wohnraum}
            luecken={luecken}
            andere={andere}
            speichert={speichert}
            onSpeichern={() => speichern()}
            onGeheZu={geheZu}
            onAbgeschlossen={() => {
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
        {/* Handy (10.11.2026): ganzer Bildschirm, Höhe in dvh — mit vh verdeckte die Browserleiste die Fußleiste */}
        {/* Ohne Vertragsvorschau reicht eine Spalte; breit genug für die Personenkarten (11.11.2026) */}
        <DialogContent className="flex h-[100dvh] max-w-full flex-col gap-0 border-0 p-0 sm:h-[90vh] sm:max-w-4xl sm:border">
          <DialogHeader className="border-b py-3 pl-4 pr-12 text-left sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5 shrink-0" />
              {entwurfId ? 'Vermietung fortsetzen' : 'Neue Vermietung'}
              {/* Auf dem Handy nennt die Schrittleiste den Schritt */}
              {stand && <span className="hidden text-sm font-normal text-muted-foreground sm:inline">— {schrittTitel(schritt)}</span>}
            </DialogTitle>
            <DialogDescription>
              {ueberschrift && <span className="font-medium text-foreground">{ueberschrift}. </span>}
              <span className="hidden sm:inline">
                Bis zum Abschließen ist die Vermietung ein Vorgang: Die Einheit gilt nicht als vermietet und es entstehen keine Forderungen.
              </span>
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
              <Schrittleiste schritte={schritte} aktuell={schritt} zustaende={zustaende} besucht={besucht} onWaehle={geheZu} />

              <div ref={formular} className="flex-1 overflow-y-auto p-4 sm:p-5">
                <UngueltigeZahlFelder.Provider value={meldeUngueltigeZahl}>{schrittInhalt()}</UngueltigeZahlFelder.Provider>
              </div>

              {/* ── Fußleiste ── */}
              {/* Handy (10.11.2026): Weiter/Zurück oben in voller Breite, darunter Speichern, der Status
                  in eigener Zeile — vorher lief die Leiste rechts aus dem Bild. Abbrechen übernimmt dort das X im Kopf. */}
              <div className="flex flex-col-reverse gap-2 border-t bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:pb-3">
                <div className="flex flex-wrap items-center gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                  <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => versucheSchliessen()} disabled={speichert}>
                    Abbrechen
                  </Button>
                  <Button
                    variant="outline"
                    className="px-3 sm:px-5"
                    onClick={() => void speichern()}
                    disabled={speichert || blockiertWeil || zahlFehler}
                  >
                    {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span className="sm:hidden">Speichern</span>
                    <span className="hidden sm:inline">Zwischenspeichern</span>
                  </Button>
                  <span className={cn('basis-full text-xs sm:basis-auto', ungespeichert ? 'text-warning' : 'text-muted-foreground')}>
                    {statusText}
                  </span>
                  {zahlFehler && (
                    <span role="alert" className="basis-full text-xs text-destructive sm:basis-auto">
                      {EURO_BETRAG_HINWEIS}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap [&>button]:flex-1 sm:[&>button]:flex-none">
                  {blockiertWeil && !speichert && (
                    <span className="flex basis-full items-center gap-1 text-xs text-muted-foreground sm:basis-auto">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {liestSelbstauskunft ? 'Selbstauskunft wird gelesen …' : 'Vorvertrag wird gelesen …'}
                    </span>
                  )}
                  {index > 0 && (
                    <Button variant="outline" onClick={() => geheZu(schritte[index - 1])} disabled={speichert || zahlFehler}>
                      <ArrowLeft className="h-4 w-4" />
                      Zurück
                    </Button>
                  )}
                  {schritt === 'start' ? (
                    <Button variant="outline" onClick={() => versucheSchliessen()} disabled={speichert}>
                      Schließen
                    </Button>
                  ) : schritt === 'mieter' ? (
                    <Button
                      onClick={() => void mieterSpeichern(schritte[index + 1])}
                      disabled={speichert || blockiertWeil || zahlFehler || !hauptmieter || mieterAnlegen.beschaeftigt}
                      title={!hauptmieter ? 'Erst mindestens einen Mitmieter mit Namen erfassen' : undefined}
                    >
                      {speichert || mieterAnlegen.beschaeftigt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Mieter speichern
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    // Merkt Miete und Mietbeginn vor — die zweite Stufe der Vermietung; danach das Abschließen (11.11.2026)
                    <Button
                      onClick={() => void speichern({ naechsterSchritt: 'start', vormerken: true })}
                      disabled={speichert || blockiertWeil || zahlFehler}
                    >
                      {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Miete speichern
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!frageSchliessen} onOpenChange={o => !o && setFrageSchliessen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
            <AlertDialogDescription>
              {gespeichert
                ? 'Die letzten Änderungen an der Vermietung sind noch nicht gespeichert.'
                : 'Die Vermietung wurde noch nicht gespeichert.'}{' '}
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
      {mieterAnlegen.dialog}
    </>
  );
}
