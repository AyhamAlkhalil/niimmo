/**
 * „Neuen Mietvertrag anlegen": Entwurf mit Vorschau statt sofort aktivem Vertrag.
 *
 * Bis 18.10.2026 legte der Knopf Mieter und Vertrag direkt aktiv an der
 * Einheit an. Beim Test mit einer Selbstauskunft entstand so eine echte
 * Monatsforderung für eine leere Wohnung. Jetzt:
 *   1. Selbstauskunft lesen (oder von Hand erfassen)
 *   2. Vertragsdaten — vorbelegt aus Objekt, Einheit und Vorvertrag, gekennzeichnet
 *   3. Vorschau des PDFs, daneben die Pflichtprüfung
 *   4. Entwurf speichern: Einheit bleibt frei, keine Forderungen
 * Aktiviert wird nach der Unterschrift über die Einheitskarte.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronUp, FileSignature, Info, Loader2, PenLine, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import VermieterStammdatenDialog from '@/components/dashboard/VermieterStammdatenDialog';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import {
  useEntwurfGrundlagen,
  useMieterAbgleich,
  useMietvertragEntwurf,
  wahrscheinlichsterVertrag,
  type EntwurfGrundlagenDaten,
} from '@/hooks/useMietvertragEntwurf';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { OCRProcessingService } from '@/services/ocrProcessingService';
import { speichereEntwurf } from '@/services/mietvertragEntwurfService';
import { getVertragsende } from '@/utils/contractUtils';
import { objektDaten, vermieterDaten } from '@/utils/mietvertrag/datenAusDb';
import {
  baueEntwurf,
  istLeerePerson,
  istWohnraumEinheit,
  leerePerson,
  mitPersonen,
  ohneHerkunft,
  personenAusSelbstauskunft,
  personenzahl,
  pruefeBlacklist,
  standardMietbeginn,
  wendeVorvertragAuslese,
  type EntwurfDatei,
  type EntwurfPerson,
  type HerkunftKarte,
  type SelbstauskunftAuslese,
  type VorvertragAuslese,
} from '@/utils/mietvertrag/entwurf';
import { hatBlocker, pruefeVertragsdaten } from '@/utils/mietvertrag/pflichtpruefung';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';
import {
  BetriebskostenEditor,
  KlauselFelder,
  MietsacheFelder,
  ObjektAngabenFelder,
} from '../mietvertrag-formular/Abschnitte';
import { useVertragsvorschau } from '@/hooks/useVertragsvorschau';
import { HerkunftHinweis, PruefungsHinweise, VertragsVorschau } from '../mietvertrag-formular/Bausteine';
import { InteressentenAbschnitt } from './InteressentenAbschnitt';
import { KonditionenAbschnitt } from './KonditionenAbschnitt';
import { VorvertragAbschnitt, type AusleseStatus } from './VorvertragAbschnitt';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  einheitId: string;
  /** Vorhandenen Entwurf bearbeiten; ohne ID entsteht ein neuer. */
  entwurfId?: string | null;
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

export function MietvertragEntwurfDialog({ isOpen, onClose, einheitId, entwurfId = null, onDirektErfassen }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  const grundlagen = useEntwurfGrundlagen(einheitId, isOpen);
  const vorhanden = useMietvertragEntwurf(entwurfId, isOpen);
  const { mieter: bestand, blacklist } = useMieterAbgleich(isOpen);
  const g = grundlagen.data;

  const [id, setId] = useState('');
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
  const initialisiert = useRef(false);
  /** Felder, die in dieser Sitzung von Hand geändert wurden — nur die gehen ans Objekt zurück. */
  const sitzungGeaendert = useRef(new Set<string>());
  /** Zählt Öffnungen; eine KI-Antwort aus einer früheren Sitzung wird verworfen. */
  const sitzung = useRef(0);

  const wohnraum = istWohnraumEinheit(g?.einheit.einheitentyp);

  // ─── Schließen setzt alles zurück ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) return;
    sitzung.current += 1;
    initialisiert.current = false;
    sitzungGeaendert.current = new Set();
    setAktualisiertAm(null);
    setStand(null);
    setPersonen([]);
    setDateien([]);
    setNeueSelbstauskuenfte([]);
    setVorvertragPfad(null);
    setAusleseStatus({ art: 'bereit' });
  }, [isOpen]);

  // ─── Vorvertrag lesen ────────────────────────────────────────────────────
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
        setStand(s => (s ? wendeVorvertragAuslese(s.daten, s.herkunft, auslese, gesamt) : s));

        const gefunden = [
          auslese.raumaufstellung && 'Räume',
          (auslese.einheit_bezeichnung || auslese.lage) && 'Lage',
          auslese.betriebskosten_positionen.length > 0 && `${auslese.betriebskosten_positionen.length} Kostenpositionen`,
          auslese.heizkosten_vorauszahlung && 'Heizkosten',
          auslese.schliessanlage && 'Schließanlage',
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
    []
  );

  // ─── Erste Fassung ───────────────────────────────────────────────────────
  useEffect(() => {
    // Erst mit frisch geladenen Daten belegen: Der Cache liefert sonst den Stand vor dem letzten Speichern.
    if (!isOpen || initialisiert.current || !g || grundlagen.isFetching) return;

    if (entwurfId) {
      if (!vorhanden.data || vorhanden.isFetching) return;
      const z = vorhanden.data;
      setId(z.id);
      setAktualisiertAm(z.aktualisiertAm);
      // Haus- und Vermieterangaben gelten wie gespeichert am Objekt, nicht wie im
      // Entwurf festgehalten — sonst schriebe das Speichern einen alten Stand zurück.
      const aktuell = objektDaten(g.immobilie);
      const einrichtungen = (g.immobilie.gemeinschaftseinrichtungen ?? []).filter(Boolean);
      setStand({
        daten: {
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
        },
        herkunft: z.herkunft,
      });
      setPersonen(z.personen.length > 0 ? z.personen : [leerePerson()]);
      setDateien(z.dateien);
      setVorvertragPfad(wahrscheinlichsterVertrag(g.vorvertragDokumente)?.pfad ?? null);
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
    setStand(neu);
    setPersonen([leerePerson()]);
    setDateien([]);
    const vorschlag = wahrscheinlichsterVertrag(g.vorvertragDokumente);
    setVorvertragPfad(vorschlag?.pfad ?? null);
    initialisiert.current = true;

    // Was nur im alten Dokument steht, gleich mitlesen — solange der
    // Vorvertrag keine gespeicherte Kostenaufstellung hat.
    const hatAufstellung =
      Array.isArray(g.vorvertrag?.betriebskosten_positionen) && g.vorvertrag.betriebskosten_positionen.length > 0;
    if (g.vorvertrag && vorschlag && !hatAufstellung && istWohnraumEinheit(g.einheit.einheitentyp)) {
      void liesVorvertrag(g, vorschlag.pfad);
    }
  }, [isOpen, g, grundlagen.isFetching, entwurfId, vorhanden.data, vorhanden.isFetching, liesVorvertrag]);

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

  // ─── Formular-Schnittstelle ──────────────────────────────────────────────
  const setDaten = useCallback(
    (aenderung: (d: MietvertragDaten) => MietvertragDaten) => setStand(s => (s ? { ...s, daten: aenderung(s.daten) } : s)),
    []
  );
  const geaendert = useCallback((feld: string) => {
    sitzungGeaendert.current.add(feld);
    setStand(s => (s ? { ...s, herkunft: ohneHerkunft(s.herkunft, feld) } : s));
  }, []);
  const markierung = useCallback(
    (feld: string) => <HerkunftHinweis quelle={stand?.herkunft[feld]} vorvertragBeginn={g?.vorvertrag?.start_datum} />,
    [stand?.herkunft, g?.vorvertrag?.start_datum]
  );

  const vertrag = useMemo(() => (stand ? mitPersonen(stand.daten, personen) : null), [stand, personen]);
  const befunde = useMemo(() => (vertrag && wohnraum ? pruefeVertragsdaten(vertrag) : []), [vertrag, wohnraum]);
  const blockiert = hatBlocker(befunde);
  const vorschau = useVertragsvorschau(vertrag, isOpen && wohnraum, blockiert);

  const blacklistTreffer = useMemo(() => pruefeBlacklist(personen, blacklist.data ?? []), [personen, blacklist.data]);

  // Was der Entwurf selbst braucht — unabhängig von der Vorlage
  const entwurfFehler = useMemo(() => {
    const f: string[] = [];
    const mitmieter = personen.filter(p => p.rolle === 'mitmieter' && !istLeerePerson(p));
    if (mitmieter.length === 0) f.push('Mindestens ein Mitmieter mit Namen.');
    if (!stand?.daten.mietbeginn) f.push('Mietbeginn.');
    if (!(stand && stand.daten.kaltmiete > 0)) f.push('Kaltmiete.');
    return f;
  }, [personen, stand]);

  // ─── Selbstauskunft ──────────────────────────────────────────────────────
  async function liesSelbstauskunft(datei: File) {
    // Die Datei wird auch dann abgelegt, wenn die Auslese scheitert — dann eben von Hand.
    const meineSitzung = sitzung.current;
    setNeueSelbstauskuenfte(l => [...l, datei]);
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
      setPersonen(alt => (alt.every(istLeerePerson) ? neu : [...alt, ...neu]));

      const wunsch = auslese.einzug_ab && auslese.einzug_ab !== 'sofort' ? auslese.einzug_ab : null;
      if (wunsch) {
        setStand(s => {
          if (!s || s.herkunft.mietbeginn !== 'berechnet') return s;
          const beginn = standardMietbeginn(heuteIso(), getVertragsende(g?.vorvertrag ?? null), wunsch);
          return {
            daten: { ...s.daten, mietbeginn: beginn },
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
  async function schreibeStammdatenZurueck(grundlage: EntwurfGrundlagenDaten, d: MietvertragDaten): Promise<string[]> {
    const hinweise: string[] = [];
    const imm = grundlage.immobilie;
    const einrichtungen = (d.mitbenutzungEinrichtungen ?? '')
      .split(/\s*,\s*/)
      .map(s => s.trim())
      .filter(Boolean);

    // Zurück ans Objekt geht nur, was dort fehlt oder in dieser Sitzung von Hand geändert wurde.
    const geaendertJetzt = (feld: string) => sitzungGeaendert.current.has(feld);
    const objekt: TablesUpdate<'immobilien'> = {};
    const zentral = d.objekt.heizungsart === 'zentral' || d.objekt.heizungsart === 'fernwaerme';
    if (d.objekt.heizungsart && d.objekt.heizungsart !== imm.heizungsart && (!imm.heizungsart || geaendertJetzt('objekt.heizungsart'))) {
      objekt.heizungsart = d.objekt.heizungsart;
    }
    const warmwasser = zentral ? d.objekt.warmwasser : null;
    if (warmwasser !== imm.warmwasser && (!imm.warmwasser || geaendertJetzt('objekt.warmwasser') || 'heizungsart' in objekt)) {
      objekt.warmwasser = warmwasser;
    }
    if (
      d.objekt.gesamtwohnflaecheQm &&
      d.objekt.gesamtwohnflaecheQm !== Number(imm.gesamtwohnflaeche ?? 0) &&
      (!imm.gesamtwohnflaeche || geaendertJetzt('objekt.gesamtwohnflaecheQm'))
    ) {
      objekt.gesamtwohnflaeche = d.objekt.gesamtwohnflaecheQm;
    }
    if (
      d.schliessanlageArt &&
      d.schliessanlageArt !== imm.schliessanlage_art &&
      (!imm.schliessanlage_art || geaendertJetzt('schliessanlageArt'))
    ) {
      objekt.schliessanlage_art = d.schliessanlageArt;
    }
    if (
      einrichtungen.length > 0 &&
      einrichtungen.join('|') !== (imm.gemeinschaftseinrichtungen ?? []).join('|') &&
      ((imm.gemeinschaftseinrichtungen ?? []).length === 0 || geaendertJetzt('mitbenutzungEinrichtungen'))
    ) {
      objekt.gemeinschaftseinrichtungen = einrichtungen;
    }
    if (Object.keys(objekt).length > 0) {
      const { error } = await supabase.from('immobilien').update(objekt).eq('id', imm.id);
      if (error) hinweise.push(`Angaben zum Haus wurden nicht am Objekt gespeichert (${error.message}).`);
    }

    // An der Einheit nur leere Felder füllen — die Lage im Vertrag kann anders formuliert sein.
    const e = grundlage.einheit;
    const einheit: TablesUpdate<'einheiten'> = {};
    if (!e.bezeichnung?.trim() && d.einheit.bezeichnung.trim()) einheit.bezeichnung = d.einheit.bezeichnung.trim();
    if (!e.etage?.trim() && d.einheit.lage.trim()) einheit.etage = d.einheit.lage.trim();
    if (!(Number(e.qm ?? 0) > 0) && d.einheit.wohnflaecheQm > 0) einheit.qm = d.einheit.wohnflaecheQm;
    if (Object.keys(einheit).length > 0) {
      const { error } = await supabase.from('einheiten').update(einheit).eq('id', e.id);
      if (error) hinweise.push(`Angaben zur Einheit wurden nicht gespeichert (${error.message}).`);
    }
    return hinweise;
  }

  async function speichern() {
    if (!stand || !vertrag || !g) return;
    if (entwurfFehler.length > 0) {
      toast({ title: 'Es fehlt noch', description: entwurfFehler.join(' '), variant: 'destructive' });
      return;
    }
    setSpeichert(true);
    try {
      const pdf = wohnraum && vorschau.aktuell ? vorschau.pdfBlob : null;
      const neueDateien = await speichereEntwurf({
        id,
        istNeu: !entwurfId,
        aktualisiertAm,
        einheitId,
        vorvertragId: g.vorvertrag?.id ?? null,
        daten: vertrag,
        personen: personen.filter(p => !istLeerePerson(p)),
        herkunft: stand.herkunft,
        bisherigeDateien: dateien,
        pdf,
        selbstauskuenfte: neueSelbstauskuenfte,
      });
      setDateien(neueDateien);
      setNeueSelbstauskuenfte([]);

      const hinweise = await schreibeStammdatenZurueck(g, stand.daten);
      logActivity('mietvertrag_entwurf_gespeichert', 'mietvertrag_entwurf', id, { mit_pdf: !!pdf });

      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] });
      // Nicht nur als veraltet markieren: beim nächsten Öffnen darf kein alter Stand aufblitzen
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', id] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-grundlagen'] });
      queryClient.invalidateQueries({ queryKey: ['immobilie', g.immobilie.id] });
      queryClient.invalidateQueries({ queryKey: ['einheiten', g.immobilie.id] });

      toast({
        title: entwurfId ? 'Entwurf gespeichert' : 'Entwurf erstellt',
        description: [
          pdf
            ? 'Das PDF liegt am Entwurf. Nach der Unterschrift auf der Einheitskarte aktivieren.'
            : wohnraum
              ? 'Ohne PDF — es entsteht, sobald alle Pflichtangaben erfasst sind.'
              : 'Die Einheit bleibt frei, bis der Entwurf aktiviert wird.',
          ...hinweise,
        ].join(' '),
        variant: hinweise.length > 0 ? 'destructive' : undefined,
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setSpeichert(false);
    }
  }

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
  const speichernGesperrt =
    speichert ||
    !stand ||
    liestSelbstauskunft ||
    ausleseStatus.art === 'laeuft' ||
    (wohnraum && !blockiert && !vorschau.aktuell && !vorschau.fehlgeschlagen);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={o => !o && !speichert && onClose()}>
        <DialogContent className="flex h-[92vh] max-w-[95vw] flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5" />
              {entwurfId ? 'Mietvertragsentwurf bearbeiten' : 'Neuer Mietvertrag — Entwurf'}
            </DialogTitle>
            <DialogDescription>
              {ueberschrift && <span className="font-medium text-foreground">{ueberschrift}. </span>}
              Der Vertrag wird erst nach der Unterschrift aktiviert. Bis dahin bleibt die Einheit frei und es entstehen
              keine Forderungen.
            </DialogDescription>
          </DialogHeader>

          {laedt && (
            <div className="flex flex-1 items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Objekt, Einheit und Vorvertrag werden geladen …</span>
            </div>
          )}

          {ladefehler && (
            <div className="flex flex-1 items-center justify-center p-8">
              <Alert variant="destructive" className="max-w-lg">
                <AlertDescription>Die Daten konnten nicht geladen werden: {String(ladefehler.message ?? ladefehler)}</AlertDescription>
              </Alert>
            </div>
          )}

          {stand && vertrag && g && !laedt && !ladefehler && (
            <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(420px,38%)_1fr]">
              {/* ── Formular ── */}
              <div className="space-y-5 overflow-y-auto border-r p-5">
                {entwurfFehler.length > 0 && (
                  <Alert>
                    <AlertDescription className="text-xs">
                      <span className="font-medium">Für den Entwurf fehlt noch: </span>
                      {entwurfFehler.join(' ')}
                    </AlertDescription>
                  </Alert>
                )}
                <VorvertragAbschnitt
                  vorvertrag={g.vorvertrag}
                  mieter={g.vorvertragMieter}
                  dokumente={g.vorvertragDokumente}
                  gewaehlt={vorvertragPfad}
                  setGewaehlt={setVorvertragPfad}
                  status={ausleseStatus}
                  onAuslesen={() => vorvertragPfad && void liesVorvertrag(g, vorvertragPfad)}
                />

                <InteressentenAbschnitt
                  personen={personen}
                  setPersonen={setPersonen}
                  bestand={bestand.data ?? []}
                  blacklistTreffer={blacklistTreffer}
                  onSelbstauskunft={datei => void liesSelbstauskunft(datei)}
                  liestSelbstauskunft={liestSelbstauskunft}
                  selbstauskuenfte={selbstauskuenfte}
                />

                <Separator />
                <KonditionenAbschnitt
                  entwurf={stand.daten}
                  setEntwurf={setDaten}
                  markierung={markierung}
                  geaendert={geaendert}
                  kautionFolgtMiete={stand.herkunft.kautionBetrag === 'berechnet' || stand.daten.kautionBetrag === 0}
                  onKautionBerechnet={() =>
                    setStand(s =>
                      s && s.herkunft.kautionBetrag !== 'berechnet'
                        ? { ...s, herkunft: { ...s.herkunft, kautionBetrag: 'berechnet' } }
                        : s
                    )
                  }
                />

                {wohnraum && (
                  <>
                    <Separator />
                    <ObjektAngabenFelder
                      entwurf={stand.daten}
                      setEntwurf={setDaten}
                      markierung={markierung}
                      geaendert={geaendert}
                      gesamtflaecheVorschlag={g.summeEinheitenQm}
                    />
                    <Separator />
                    <MietsacheFelder entwurf={stand.daten} setEntwurf={setDaten} markierung={markierung} geaendert={geaendert} />
                    <Separator />
                    <BetriebskostenEditor entwurf={stand.daten} setEntwurf={setDaten} markierung={markierung} geaendert={geaendert} />
                    <Separator />
                    <KlauselFelder entwurf={stand.daten} setEntwurf={setDaten} geaendert={geaendert} />
                  </>
                )}
              </div>

              {/* ── Vorschau ── */}
              <div className="flex flex-col overflow-hidden bg-muted/30">
                {wohnraum && blockiert ? (
                  // Statt einer leeren Fläche: was fehlt, steht dort, wo sonst der Vertrag stünde
                  <div className="flex-1 space-y-4 overflow-y-auto p-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Vorschau gesperrt</p>
                        <p className="text-sm text-muted-foreground">
                          Solange Pflichtangaben fehlen, entsteht kein PDF — ein Vertrag darf nichts behaupten, was nicht
                          erfasst ist. Der Entwurf lässt sich trotzdem speichern und später vervollständigen.
                        </p>
                      </div>
                    </div>
                    <PruefungsHinweise befunde={befunde} onVermieterOeffnen={() => setZeigeVermieter(true)} />
                  </div>
                ) : wohnraum ? (
                  <>
                    {befunde.length > 0 && (
                      <div className="border-b bg-background px-4 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setZeigeHinweise(z => !z)}
                        >
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
                        unterschriebenen Vertrag lädst du beim Aktivieren hoch.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background p-4">
                  <div className="text-xs text-muted-foreground">
                    {!entwurfId && onDirektErfassen && (
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onDirektErfassen}>
                        Bereits unterschriebenen Vertrag direkt erfassen
                      </Button>
                    )}
                    {wohnraum && (
                      <p>
                        {blockiert
                          ? 'Wird ohne PDF gespeichert, solange Pflichtangaben fehlen.'
                          : vorschau.fehlgeschlagen
                            ? 'Das PDF ließ sich nicht erzeugen — der Entwurf wird ohne PDF gespeichert.'
                            : vorschau.aktuell
                            ? 'Das PDF wird mit dem Entwurf abgelegt.'
                            : 'Vorschau wird aktualisiert …'}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={onClose} disabled={speichert}>
                      Abbrechen
                    </Button>
                    <Button onClick={() => void speichern()} disabled={speichernGesperrt}>
                      {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {entwurfId ? 'Entwurf speichern' : 'Entwurf erstellen'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
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
            if (r.data) setDaten(d => ({ ...d, vermieter: vermieterDaten(r.data.vermieter, r.data.immobilie) }));
          });
        }}
      />
    </>
  );
}
