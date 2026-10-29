import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from "@supabase/supabase-js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle, Download, Mail, Mailbox, Send, ArrowLeft, FileText, Eye, RefreshCw, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generateMahnungPdf, mahnungAbsaetze, POSTEN_PRAEFIX, type MahnungPdfData } from "@/utils/mahnungPdfGenerator";
import { berechneAlleVerzugszinsen, getVerzugszinssatz, verzugspostenAusRueckstand } from "@/utils/verzugszinsen";
import { useBasiszinsPerioden } from "@/hooks/useBasiszinsPerioden";
import { schriftstueckPfad } from "@/utils/storagePfad";
import { edgeFehlertext } from "@/utils/edgeFehler";
import { fristloseKuendigungFelder, raeumungsfristInTagen } from "@/utils/contractUtils";
import { leseKautionsbetrag } from "@/utils/vertragKaution";
import { monatText, rueckstandInMonatsmieten, type OffenerPosten } from "@/utils/rueckstandSeit";
import { leseAnzahlSchreiben, leseMahnungBetraege, mahnkostenGesamtText, mahnungBetragsMeldung } from "@/utils/mahnungEingaben";
import { empfaengerDerAuswahl, mailadressenDerMieter, vorausgewaehlteEmpfaenger } from "@/utils/kuendigungsbestaetigung";
import {
  angeboteneVormerkung,
  berlinerKalendertag,
  betraegeDesSchreibens,
  deutschAusIso,
  fristVorgaben,
  istAblehnung,
  MAX_EMPFAENGER,
  POST_ZUGANG_TAGE,
  postversandFehler,
  sendungsnummerFehler,
  tageZwischen,
  versandStandAusVormerkung,
  vorgabeVersandart,
  zugangBeiPost,
  unklarerVersand,
  type KuendigungsFelder,
  type MahnungVormerkung,
  type SchreibenKern,
  type UnklarerVersand,
  type Versandart,
} from "@/utils/mahnungVersand";

const ANZAHL_MELDUNG = 'Die Anzahl der Schreiben muss eine ganze Zahl ab 0 sein.';

// mahnung_versand (Migration 20261028143000) steht erst nach dem Neuerzeugen in types.ts — bis dahin ohne Tabellentyp
const mahnungVersandTabelle = () => (supabase as unknown as SupabaseClient).from('mahnung_versand');

interface MahnungErstellungModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractData: {
    mietvertrag_id: string;
    current_kaltmiete: number;
    current_betriebskosten: number;
    letzte_mieterhoehung_am: string | null;
    start_datum: string;
    einheit_id?: string;
    immobilie_id?: string;
    immobilie_name?: string;
    immobilie_adresse?: string;
    mahnstufe?: number;
    /** Ergebnis von getVertragsende(); Stufe 3 schiebt ein früheres Ende nicht nach hinten */
    vertragsende?: string | null;
    mieter?: Array<{
      vorname: string;
      nachname: string;
      hauptmail: string | null;
      /** Für die Empfängerauswahl; zerlegt wie in der Kündigungsbestätigung (mailadressenDerMieter) */
      weitere_mails?: string | null;
      telnr: string | null;
    }>;
  } | null;
  rueckstand?: number;
  /** Die offenen Posten hinter dem Rückstand (offenePosten), ältester zuerst */
  offenePosten?: OffenerPosten[];
}

const KEINE_POSTEN: OffenerPosten[] = [];

export function MahnungErstellungModal({
  isOpen,
  onClose,
  contractData,
  rueckstand = 0,
  offenePosten = KEINE_POSTEN,
}: MahnungErstellungModalProps) {
  const { toast } = useToast();
  const { perioden, fromDB } = useBasiszinsPerioden();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [step, setStep] = useState<'edit' | 'versand'>('edit');
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [showConfirmPost, setShowConfirmPost] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  // Eingaben, aus denen pdfBlob entstand (wie RentIncreaseModal). Die Vorschau läuft 500 ms plus
  // Erzeugungszeit hinter dem Formular her; bis zum 28.10.2026 wurde in dieser Zeit das alte PDF
  // abgelegt und versendet, während Betrag und Frist der Mail schon aus dem neuen Stand kamen.
  const [pdfStand, setPdfStand] = useState<string | null>(null);
  // Abgelegtes Schreiben samt den Daten, aus denen es entstand — die Mail nennt genau diese Werte.
  // Zahlungsfrist und Räumungsende als Tage des Schreibens: Am Versandtag neu gerechnet, wichen sie
  // ab, wenn Speichern und Senden auf verschiedenen Tagen lagen (Review 28.10.2026).
  // Seit 28.10.2026 auch aus einer Vormerkung (Dialog neu geöffnet, Schreiben noch nicht versandt);
  // send-mahnung nimmt Stufe, Frist und Kündigung dann ohnehin aus der Vormerkung.
  const [gespeichert, setGespeichert] = useState<{
    pfad: string;
    daten: SchreibenKern;
    fristIso: string;
    kuendigung: KuendigungsFelder | null;
  } | null>(null);
  // Aktuelle Vorschau-URL; der Wert im Closure von regeneratePreview war veraltet (Review 28.10.2026)
  const pdfUrlRef = useRef<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ein älterer Vorschaulauf, der später fertig wird, darf den neueren nicht überschreiben
  const vorschauLauf = useRef(0);
  
  // Versand (28.10.2026): per E-Mail an ausgewählte Mieteradressen oder als „per Post versandt“ gebucht
  const [versandart, setVersandart] = useState<Versandart>('email');
  // Empfänger aus den zerlegten Mieteradressen wie in der Kündigungsbestätigung. Bis zum 28.10.2026
  // stand hier der rohe hauptmail-Text: „a@x.de, b@y.de“ ging an beide, angezeigt war einer.
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([]);
  const [emailCc, setEmailCc] = useState<string>('');
  // Kalendertage in Berlin wie in send-mahnung, nicht in der Ortszeit des Rechners (28.10.2026)
  const [aufgabeAm, setAufgabeAm] = useState<string>(berlinerKalendertag());
  // Tag des gespeicherten Schreibens (frühester Aufgabetag); send-mahnung nimmt erstellt_am der Vormerkung
  const [schreibtag, setSchreibtag] = useState<string>(berlinerKalendertag());
  const [sendungsnummer, setSendungsnummer] = useState<string>('');
  // „Neues Schreiben erstellen“ statt die offene Vormerkung zu versenden
  const [angebotVerworfen, setAngebotVerworfen] = useState(false);
  const [vormerkungLaedt, setVormerkungLaedt] = useState(false);

  // Mahnung data
  const mahnstufe = (contractData?.mahnstufe || 0) + 1;
  const adressen = useMemo(() => mailadressenDerMieter(contractData?.mieter ?? []), [contractData?.mieter]);
  const versandEmpfaenger = useMemo(() => empfaengerDerAuswahl(ausgewaehlt, adressen), [ausgewaehlt, adressen]);
  // Leer = alle Mieter neutral beim Namen; „Herr“ als Vorgabe sprach jede Mieterin falsch an
  const [anrede, setAnrede] = useState<string>("");
  const [mieterAdresse, setMieterAdresse] = useState<string>("");
  const [mieterPlzOrt, setMieterPlzOrt] = useState<string>("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState<string>("");
  const [gesamtRueckstand, setGesamtRueckstand] = useState<string>("0.00");
  
  // Verzugszinsen
  const [verzugszinsenDetails, setVerzugszinsenDetails] = useState<Array<{
    monat: string;
    betrag: number;
    laufend?: boolean;
  }>>([]);
  const [verzugszinsenGesamt, setVerzugszinsenGesamt] = useState<string>("0.00");
  
  // Mahnkosten
  const [mahnkostenProSchreiben, setMahnkostenProSchreiben] = useState<string>("11.00");
  const [anzahlMahnschreiben, setAnzahlMahnschreiben] = useState<string>("1");
  const [mahnkostenGesamt, setMahnkostenGesamt] = useState<string>("11.00");
  
  // Zahlungsfrist
  // Vorgaben 7/14 Tage, ohne Mailadresse 10/17 (fristVorgaben, beim Öffnen gesetzt)
  const [zahlungsfristTage, setZahlungsfristTage] = useState<string>("7");
  const [raeumungsfristTage, setRaeumungsfristTage] = useState<string>("14");
  const [uebergabeDatum, setUebergabeDatum] = useState<string>("");
  
  // Freitext
  const [useFreitext, setUseFreitext] = useState(false);
  const [freitext, setFreitext] = useState<string>("");

  // Reset when modal opens
  useEffect(() => {
    if (isOpen && contractData) {
      setStep('edit');
      setGespeichert(null);
      setPdfBlob(null);
      setPdfStand(null);
      setGesamtRueckstand(rueckstand.toFixed(2));
      setEmailCc('');

      // Ohne Mailadresse bleibt nur die Post; die Fristvorgaben enthalten dann die Postlaufzeit
      const vorgabe = vorgabeVersandart(mailadressenDerMieter(contractData.mieter ?? []));
      setVersandart(vorgabe);
      setAusgewaehlt(vorausgewaehlteEmpfaenger(contractData.mieter ?? []));
      setAufgabeAm(berlinerKalendertag());
      setSendungsnummer('');
      setAngebotVerworfen(false);
      setAnrede("");
      setMieterAdresse(contractData.immobilie_adresse?.split(',')[0]?.trim() || '');
      setMieterPlzOrt(contractData.immobilie_adresse?.includes(',') 
        ? contractData.immobilie_adresse.split(',').slice(1).join(',').trim() 
        : '');
      setEinheitBezeichnung("WE");
      
      // Je Schreiben dieser Mahnfolge einschließlich des jetzigen (Miete ist kalendermäßig fällig,
      // § 286 Abs. 2 Nr. 1 BGB). Bis zum 27.10.2026 ergab max(1, alteStufe || 1) für Stufe 1/2/3
      // die Anzahl 1/1/2.
      const anzahlSchreiben = (contractData.mahnstufe || 0) + 1;
      setMahnkostenProSchreiben("11.00");
      setAnzahlMahnschreiben(String(anzahlSchreiben));
      setMahnkostenGesamt((11 * anzahlSchreiben).toFixed(2));
      
      setVerzugszinsenGesamt("0.00");
      setVerzugszinsenDetails([]);
      setZahlungsfristTage(fristVorgaben(vorgabe).zahlungsfristTage);
      setRaeumungsfristTage(fristVorgaben(vorgabe).raeumungsfristTage);
      setUebergabeDatum("");
      setUseFreitext(false);
      setFreitext("");
    }
    // Nur beim Öffnen oder Vertragswechsel: contractData ist bei jedem Rendern des Vertragsfensters
    // ein neues Objekt -- bis zum 27.10.2026 fielen berechnete Zinsen beim Fensterfokus still auf 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contractData?.mietvertrag_id]);

  // Recalculate Mahnkosten when sub-values change
  useEffect(() => {
    setMahnkostenGesamt(mahnkostenGesamtText(mahnkostenProSchreiben, anzahlMahnschreiben));
  }, [mahnkostenProSchreiben, anzahlMahnschreiben]);

  // „1.250“ ist kein Betrag (leseKautionsbetrag) — parseFloat machte daraus bis zum 28.10.2026 still 1,25 €
  const betraege = useMemo(
    () => leseMahnungBetraege({ rueckstand: gesamtRueckstand, mahnkostenProSchreiben, verzugszinsen: verzugszinsenGesamt }),
    [gesamtRueckstand, mahnkostenProSchreiben, verzugszinsenGesamt]
  );
  const betragsMeldung = mahnungBetragsMeldung(betraege.ungueltig);

  // Monatsmieten im Rückstand nur aus dem Mietanteil (ohne BKA-Nachzahlung und Gebühren) wie die Rückstandsliste,
  // höchstens der eingetragene Rückstand; abgerundet auf eine Stelle (rueckstandInMonatsmieten). Bis zum 29.10.2026
  // ein freies Feld, beim Öffnen aus dem Gesamtrückstand gesetzt: 500 € Miete + 600 € BKA standen als
  // „2,2 Monatsmieten“ im Kündigungsschreiben (Prüfung 29.10.2026)
  const monatsmieteDesVertrags = (contractData?.current_kaltmiete || 0) + (contractData?.current_betriebskosten || 0);
  const mietanteil = Math.min(
    betraege.werte.rueckstand,
    offenePosten.filter((p) => p.art === 'Miete').reduce((s, p) => s + p.betrag, 0)
  );
  const anzahlMonatsmieten = String(rueckstandInMonatsmieten(mietanteil, monatsmieteDesVertrags) ?? 0);
  // Fristlos nach § 543 Abs. 2 Nr. 3, § 569 Abs. 3 Nr. 1 BGB erst, wenn der Mietrückstand eine Monatsmiete
  // übersteigt (zwei Termine mit mehr als einer Monatsmiete oder zwei Monatsmieten über mehr als zwei Termine).
  // Bis zum 29.10.2026 kündigte Stufe 3 auch bei 0,3 Monatsmieten (Prüfung 29.10.2026).
  const fristlosGesperrt = mahnstufe >= 3 && !(mietanteil > monatsmieteDesVertrags + 0.005);
  // Die offenen Posten passen nur zum ungeänderten Rückstand; wer ihn von Hand ändert, bekommt keine Aufzählung
  const postenImSchreiben = Math.abs(betraege.werte.rueckstand - rueckstand) < 0.005 ? offenePosten : KEINE_POSTEN;
  const postenZeilen = useMemo(() => postenImSchreiben.map((p) => ({
    monat: p.monat ? `${monatText(p.monat)}${p.art === 'Miete' ? '' : ` – ${p.art}`}` : 'Sonstige Forderungen',
    betrag: p.betrag,
  })), [postenImSchreiben]);
  // „-2“ Schreiben ergab negative Mahnkosten (QA 28.10.2026)
  const anzahlUngueltig = leseAnzahlSchreiben(anzahlMahnschreiben) === undefined;

  // Generate the standard Mahnungstext for the current Mahnstufe — derselbe Wortlaut wie im PDF (mahnungAbsaetze)
  const buildStandardText = useCallback((): string => {
    const vertragStart = contractData?.start_datum
      ? new Date(contractData.start_datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';
    return mahnungAbsaetze({
      mahnstufe,
      vertragStart,
      offeneForderungen: postenZeilen,
      gesamtRueckstand: betraege.werte.rueckstand,
      anzahlMonatsmieten: parseFloat(anzahlMonatsmieten) || 0,
    })
      .map((absatz) => (absatz.startsWith(POSTEN_PRAEFIX) ? `  ${absatz.slice(POSTEN_PRAEFIX.length)}` : absatz))
      .join('\n');
  }, [contractData, mahnstufe, betraege, anzahlMonatsmieten, postenZeilen]);

  // Build PDF data from state
  const buildPdfData = useCallback((): MahnungPdfData | null => {
    if (!contractData) return null;
    
    const mieterList = contractData.mieter || [];
    const firstName = mieterList.map(m => `${m.vorname} ${m.nachname}`).join(' & ');
    const nachname = mieterList[0]?.nachname || '';
    
    const heute = new Date();
    const datumStr = heute.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    const zahlungsfrist = new Date();
    zahlungsfrist.setDate(zahlungsfrist.getDate() + (parseInt(zahlungsfristTage) || 7));
    const zahlungsfristStr = zahlungsfrist.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    // Dasselbe Räumungsende, das der Vertrag beim Versand bekommt (fristloseKuendigungFelder) —
    // mit dem bestehenden Vertragsende, sonst nannte das Schreiben einen späteren Tag als der Vertrag
    const raeumungsfristStr = fristloseKuendigungFelder(parseInt(raeumungsfristTage), new Date(), contractData.vertragsende).ende_datum.split('-').reverse().join('.');
    
    const vertragStart = contractData.start_datum 
      ? new Date(contractData.start_datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';

    return {
      anrede,
      mieterName: firstName,
      mieterNachname: nachname,
      mieter: mieterList.map(m => ({ vorname: m.vorname, nachname: m.nachname })),
      mieterAdresse,
      mieterPlzOrt,
      einheitBezeichnung,
      immobilieAdresse: contractData.immobilie_adresse || '',
      vertragStart,
      mahnstufe,
      datum: datumStr,
      offeneForderungen: postenZeilen,
      gesamtRueckstand: betraege.werte.rueckstand,
      anzahlMonatsmieten: parseFloat(anzahlMonatsmieten) || 0,
      verzugszinsenDetails,
      verzugszinsenGesamt: betraege.werte.verzugszinsen,
      mahnkostenProSchreiben: betraege.werte.mahnkostenProSchreiben,
      anzahlMahnschreiben: leseAnzahlSchreiben(anzahlMahnschreiben) ?? 0,
      mahnkostenGesamt: leseKautionsbetrag(mahnkostenGesamt) ?? 0,
      zahlungsfristDatum: zahlungsfristStr,
      zahlungsfristTage: parseInt(zahlungsfristTage) || 7,
      raeumungsfristDatum: raeumungsfristStr,
      uebergabeDatum: uebergabeDatum
        ? new Date(uebergabeDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : undefined,
      freitext: useFreitext ? freitext : undefined,
    };
  }, [contractData, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung,
      betraege, anzahlMonatsmieten, verzugszinsenDetails, postenZeilen,
      anzahlMahnschreiben, mahnkostenGesamt,
      zahlungsfristTage, raeumungsfristTage, uebergabeDatum, mahnstufe, useFreitext, freitext]);

  // Generate PDF preview with debounce
  const regeneratePreview = useCallback(async () => {
    const pdfData = buildPdfData();
    if (!pdfData) return;
    const lauf = ++vorschauLauf.current;
    
    setIsGeneratingPreview(true);
    try {
      const blob = await generateMahnungPdf(pdfData);
      if (lauf !== vorschauLauf.current) return;
      setPdfBlob(blob);
      setPdfStand(JSON.stringify(pdfData));
      
      // Revoke old URL
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfBlobUrl(url);
    } catch (err) {
      if (lauf !== vorschauLauf.current) return;
      // Kein altes Schreiben stehen lassen, das danach gespeichert werden könnte
      setPdfBlob(null);
      setPdfStand(null);
      console.error('Mahnungs-Vorschau konnte nicht erzeugt werden:', err);
      toast({
        title: "Vorschau nicht moeglich",
        description: "Das Mahnungs-PDF konnte nicht erzeugt werden. Bitte pruefen Sie die Vertragsdaten.",
        variant: "destructive",
      });
    } finally {
      if (lauf === vorschauLauf.current) setIsGeneratingPreview(false);
    }
  }, [buildPdfData]);

  // Der Stand, den ein jetzt erzeugtes PDF hätte. Speichern und Senden gehen nur, wenn die Vorschau
  // genau daraus entstand (28.10.2026).
  const aktuellerStand = JSON.stringify(buildPdfData());
  const vorschauAktuell = pdfBlob !== null && pdfStand === aktuellerStand;

  // Debounced preview regeneration on data changes
  useEffect(() => {
    if (!isOpen || step !== 'edit') return;
    
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      regeneratePreview();
    }, 500);
    
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // Am Stand statt an einzelnen Feldern: auch Vertragsangaben (Stufe, Vertragsende) gehören ins PDF
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step, aktuellerStand]);

  // Cleanup blob URL on unmount; beim Wechsel gibt regeneratePreview die alte URL frei
  useEffect(() => {
    return () => {
      // Gewollt die zuletzt erzeugte URL, nicht die beim Einhängen
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  // Gespeichert, aber noch nicht versandt (28.10.2026): send-mahnung merkt jedes Schreiben beim
  // Speichern vor. Passt eine Vormerkung zur nächsten Stufe und ist sie nicht veraltet, bietet der
  // Dialog an, sie jetzt zu versenden — ein gedrucktes, aber nicht gebuchtes Schreiben ging sonst verloren.
  const vertragsId = contractData?.mietvertrag_id;
  const { data: angebot = null, isError: angebotFehler } = useQuery({
    queryKey: ['mahnung-vormerkungen', vertragsId, mahnstufe, rueckstand],
    enabled: isOpen && !!vertragsId,
    staleTime: 0,
    queryFn: async (): Promise<MahnungVormerkung | null> => {
      // Bewusst begrenzt: angeboten wird nur die jüngste passende Vormerkung
      const { data: zeilen, error } = await mahnungVersandTabelle()
        .select('id, stufe, dokument_pfad, zahlungsfrist, kuendigung, betraege, erstellt_am')
        .eq('mietvertrag_id', vertragsId)
        .eq('status', 'vorgemerkt')
        .eq('stufe', mahnstufe)
        .order('erstellt_am', { ascending: false })
        .limit(10);
      if (error) throw error;
      const liste = (zeilen ?? []) as MahnungVormerkung[];
      if (liste.length === 0) return null;
      // Nur Schreiben, die noch unter Dokumente liegen — send-mahnung lehnt die anderen ohnehin ab
      const { data: dokumente, error: dokumentFehler } = await supabase
        .from('dokumente')
        .select('pfad')
        .eq('mietvertrag_id', vertragsId)
        .eq('geloescht', false)
        .in('pfad', liste.map(v => v.dokument_pfad));
      if (dokumentFehler) throw dokumentFehler;
      const vorhanden = new Set((dokumente ?? []).map(d => d.pfad as string));
      return angeboteneVormerkung(liste, mahnstufe, berlinerKalendertag(), vorhanden, rueckstand);
    },
  });

  // Beansprucht, aber nicht abgeschlossen (28.10.2026): Absturz oder Zeitlimit während des Versands.
  // Ob die Mail raus ist, ist unklar — der Dialog bietet das Schreiben deshalb nicht erneut an,
  // sondern lässt den Versand klären (send-mahnung 'freigeben': abschließen oder freigeben).
  const { data: unklar = null, refetch: unklarNeuLaden, isError: unklarFehler, isSuccess: unklarGeprueft } = useQuery({
    queryKey: ['mahnung-unklar', vertragsId],
    enabled: isOpen && !!vertragsId,
    staleTime: 0,
    queryFn: async () => {
      const { data: zeilen, error } = await mahnungVersandTabelle()
        .select('id, stufe, dokument_pfad, versandart, erstellt_am, aktualisiert_am')
        .eq('mietvertrag_id', vertragsId)
        .eq('status', 'wird_versendet')
        .order('aktualisiert_am', { ascending: false })
        .limit(5);
      if (error) throw error;
      return unklarerVersand((zeilen ?? []) as UnklarerVersand[]);
    },
  });
  const [klaertGerade, setKlaertGerade] = useState(false);
  // Mailversand ohne Beleg: Freigeben oder Nachbuchen nur nach ausdrücklicher Bestätigung (Review 28.10.2026)
  const [showConfirmFreigabe, setShowConfirmFreigabe] = useState(false);
  const [showConfirmVersendet, setShowConfirmVersendet] = useState(false);

  const versandKlaeren = async (bestaetigung: 'nicht_versendet' | 'versendet' | null) => {
    if (!contractData || !unklar) return;
    setKlaertGerade(true);
    try {
      const { data: ergebnis, error } = await supabase.functions.invoke('send-mahnung', {
        body: {
          versandart: 'freigeben',
          mietvertragId: contractData.mietvertrag_id,
          pdfPath: unklar.zeile.dokument_pfad,
          // Nur aus den Bestätigungsdialogen; send-mahnung bucht trotzdem nach, wenn mails 'gesendet' zeigt
          bestaetigtNichtVersendet: bestaetigung === 'nicht_versendet' || undefined,
          bestaetigtVersendet: bestaetigung === 'versendet' || undefined,
        },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['mahnung-vormerkungen', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['mahnung-versand', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
      void unklarNeuLaden();
      const abgeschlossen = ergebnis?.ergebnis === 'abgeschlossen';
      toast({
        title: abgeschlossen ? "Versand abgeschlossen" : "Schreiben freigegeben",
        description: ergebnis?.warnung
          ? ergebnis.warnung
          : abgeschlossen
            ? ergebnis?.vonHand
              ? "Der Versand ist als von Hand bestätigt gebucht. Bitte den Dialog neu öffnen."
              : "Der Versand war erfolgt und ist jetzt gebucht. Bitte den Dialog neu öffnen."
            : "Das Schreiben gilt als nicht versendet und kann erneut versendet werden. Bitte den Dialog neu öffnen.",
        variant: ergebnis?.warnung ? "destructive" : undefined,
      });
      onClose();
    } catch (err) {
      toast({ title: "Fehler", description: await edgeFehlertext(err, 'Der Versand konnte nicht geklärt werden'), variant: "destructive" });
    } finally {
      setKlaertGerade(false);
    }
  };

  // Postversand: dieselben Regeln wie in send-mahnung, vorab sichtbar (utils/mahnungVersand.ts)
  const heuteIso = berlinerKalendertag();
  const schreibtagIso = gespeichert ? schreibtag : heuteIso;
  const zugangIso = /^\d{4}-\d{2}-\d{2}$/.test(aufgabeAm) ? zugangBeiPost(aufgabeAm) : null;
  const postFehler = gespeichert
    ? postversandFehler({
        aufgabeIso: aufgabeAm,
        schreibtagIso,
        heuteIso,
        fristIso: gespeichert.fristIso,
        raeumungsendeIso: gespeichert.kuendigung?.ende_datum ?? null,
      })
    : null;
  const nummerFehler = sendungsnummerFehler(sendungsnummer);

  const vormerkungVersenden = async () => {
    if (!angebot) return;
    setVormerkungLaedt(true);
    try {
      const { data: datei, error } = await supabase.storage.from('dokumente').download(angebot.dokument_pfad);
      if (error || !datei) throw new Error('Das gespeicherte Schreiben konnte nicht geladen werden.');
      // Eine noch laufende Vorschau würde das geladene Schreiben sonst überschreiben
      vorschauLauf.current++;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      const url = URL.createObjectURL(datei);
      pdfUrlRef.current = url;
      setPdfBlobUrl(url);
      setGespeichert(versandStandAusVormerkung(angebot));
      setSchreibtag(berlinerKalendertag(new Date(angebot.erstellt_am)));
      setAufgabeAm(berlinerKalendertag());
      setStep('versand');
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : 'Das gespeicherte Schreiben konnte nicht geladen werden.',
        variant: "destructive",
      });
    } finally {
      setVormerkungLaedt(false);
    }
  };

  const handleSaveAndUpload = async () => {
    if (!contractData || !pdfBlob) return;
    // Blob und Daten zu Beginn festhalten: beide gehören zusammen, auch wenn weiter getippt wird
    const blob = pdfBlob;
    const stand = pdfStand;
    if (betraege.ungueltig.length > 0 || anzahlUngueltig) {
      toast({ title: "Eingabe prüfen", description: betragsMeldung || ANZAHL_MELDUNG, variant: "destructive" });
      return;
    }
    if (!stand || stand !== aktuellerStand) {
      toast({ title: "Vorschau wird noch erstellt", description: "Das Schreiben entspricht noch nicht den aktuellen Eingaben. Bitte einen Moment warten." });
      return;
    }
    const daten = JSON.parse(stand) as MahnungPdfData;
    // send-mahnung nimmt höchstens 60 Tage und keine vergangene Frist an — vor dem Ablegen prüfen
    if (!(daten.zahlungsfristTage >= 1 && daten.zahlungsfristTage <= 60)) {
      toast({ title: "Zahlungsfrist prüfen", description: "Die Zahlungsfrist muss zwischen 1 und 60 Tagen liegen.", variant: "destructive" });
      return;
    }
    // Frist und Räumungsende genau wie im Schreiben (TT.MM.JJJJ); Mail und Vertrag bekommen diese Tage
    const fristIso = daten.zahlungsfristDatum.split('.').reverse().join('-');
    const kuendigung = mahnstufe >= 3
      ? { ...fristloseKuendigungFelder(parseInt(raeumungsfristTage), new Date(), contractData.vertragsende) }
      : null;
    if (kuendigung && kuendigung.ende_datum.split('-').reverse().join('.') !== daten.raeumungsfristDatum) {
      toast({ title: "Vorschau wird noch erstellt", description: "Das Räumungsende im Schreiben ist nicht mehr aktuell. Bitte einen Moment warten." });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Pfad ohne Mieternamen: Supabase Storage lehnt Umlaute ab (InvalidKey),
      // die Mahnung war für diese Mieter nicht speicherbar. Die Uhrzeit trennt
      // zwei Mahnungen desselben Tages, die sich vorher still überschrieben.
      const filePath = schriftstueckPfad('mahnungen', contractData.mietvertrag_id, `Mahnung_Stufe${mahnstufe}`, new Date());
      
      // Upload PDF blob to storage
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      
      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, uint8, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) {
        throw new Error('Upload fehlgeschlagen: ' + uploadError.message);
      }
      
      // Save document reference
      const mahnungTitle = mahnstufe === 1 ? '1. Zahlungserinnerung' : 
                           mahnstufe === 2 ? '2. Mahnung' : 
                           `${mahnstufe}. Mahnung / Letzte Zahlungsaufforderung`;
      
      const { data: dokument, error: dokumentFehler } = await supabase.from('dokumente').insert({
        titel: `${mahnungTitle} ${new Date().toLocaleDateString('de-DE')}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: contractData.mietvertrag_id,
      }).select('id').single();
      // Ohne Zeile in dokumente ist das Schreiben unsichtbar (bis 27.10.2026 ungeprüft, Erfolg gemeldet)
      if (dokumentFehler || !dokument) {
        await supabase.storage.from('dokumente').remove([filePath]);
        throw new Error('Das Schreiben konnte nicht unter Dokumente abgelegt werden: ' + (dokumentFehler?.message ?? 'keine Zeile angelegt'));
      }

      // Vormerken (28.10.2026): send-mahnung prüft Stufe, Frist und Kündigung wie beim Versand und
      // hält sie fest. Danach lässt sich das Schreiben per E-Mail versenden oder als per Post versandt
      // buchen — auch später nach erneutem Öffnen. Scheitert das, wird das Schreiben wieder entfernt:
      // Ohne Vormerkung ließe es sich weder per Post buchen noch später versenden.
      const vormerken = () => supabase.functions.invoke('send-mahnung', {
        body: {
          versandart: 'vormerken',
          mietvertragId: contractData.mietvertrag_id,
          mahnstufe,
          pdfPath: filePath,
          fristDatum: fristIso,
          kuendigung: kuendigung ?? undefined,
          betraege: betraegeDesSchreibens(daten),
        },
      });
      let { error: vormerkFehler } = await vormerken();
      // Ohne eindeutige Ablehnung (Netz, Zeitlimit, 5xx) einmal wiederholen: Hat der erste Aufruf die
      // Vormerkung doch angelegt, meldet send-mahnung mit denselben Werten Erfolg, und nichts wird gelöscht
      if (vormerkFehler && !istAblehnung(vormerkFehler)) {
        ({ error: vormerkFehler } = await vormerken());
      }
      if (vormerkFehler) {
        const grund = await edgeFehlertext(vormerkFehler, 'Das Schreiben konnte nicht zum Versand vorgemerkt werden.');
        // Aufräumen und das Ergebnis melden: Bleibt das Schreiben liegen, ist es nicht versendbar
        const { error: loeschFehler } = await supabase.from('dokumente').delete().eq('id', dokument.id);
        const { data: entfernt, error: entfernFehler } = loeschFehler
          ? { data: null, error: null }
          : await supabase.storage.from('dokumente').remove([filePath]);
        const rest = loeschFehler
          ? ' Das Schreiben konnte nicht wieder entfernt werden und liegt weiter unter Dokumente; es ist nicht zum Versand vorgemerkt.'
          : entfernFehler || !entfernt || entfernt.length === 0
            ? ' Die PDF-Datei konnte nicht aus dem Speicher entfernt werden.'
            : '';
        throw new Error(grund + rest);
      }

      setGespeichert({ pfad: filePath, daten, fristIso, kuendigung });
      setSchreibtag(berlinerKalendertag());
      queryClient.invalidateQueries({ queryKey: ['mahnung-vormerkungen', contractData.mietvertrag_id] });

      toast({
        title: "Mahnung gespeichert",
        description: "Das Schreiben liegt unter Dokumente und kann jetzt per E-Mail oder per Post versendet werden.",
      });

      setAufgabeAm(berlinerKalendertag());
      setStep('versand');
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : 'Fehler beim Speichern',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `Mahnung_Stufe${mahnstufe}_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSendEmail = async () => {
    // Betrag, Frist und Räumungsende der Mail kommen aus dem abgelegten Schreiben, nicht aus dem
    // Formular — sonst nannte die Mail andere Werte als das angehängte PDF (28.10.2026)
    const stand = gespeichert;
    if (!contractData || versandEmpfaenger.length === 0 || !stand) return;
    // Frist und Räumungsende stammen vom Tag des Speicherns. Sind sie inzwischen vorbei, passt das
    // Schreiben nicht mehr — neu speichern statt eine abgelaufene Frist zu versenden
    const heuteIso = berlinerKalendertag();
    if (stand.fristIso < heuteIso || (stand.kuendigung && stand.kuendigung.ende_datum < heuteIso)) {
      toast({
        title: "Schreiben veraltet",
        description: "Zahlungsfrist oder Räumungsende im gespeicherten Schreiben liegen schon in der Vergangenheit. Bitte zurückgehen, das Schreiben neu speichern und dann senden.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingEmail(true);
    try {
      const recipientName = contractData.mieter?.map(m => `${m.vorname} ${m.nachname}`).join(' & ') || 'Mieter';
      // Komma, Semikolon oder Leerzeichen trennen; send-mahnung prüft jede Adresse (27.10.2026)
      const ccEmails = emailCc ? emailCc.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean) : [];
      // Stufe 3: Status und Vertragsende gehen mit, send-mahnung setzt sie im selben Update wie die
      // Stufe (28.10.2026). Bis dahin setzte sie nur der Browser nach der Antwort — ging die verloren,
      // blieb der Vertrag aktiv, und ein neuer Versuch bekam 409. Beide Felder auf das Räumungsende
      // des gespeicherten Schreibens.
      const kuendigung = stand.kuendigung ?? undefined;

      const { data: versand, error } = await supabase.functions.invoke('send-mahnung', {
        body: {
          versandart: 'email',
          // Nur ausgewählte, zerlegte Mieteradressen; send-mahnung prüft jede einzeln (28.10.2026)
          recipientEmails: versandEmpfaenger,
          recipientName,
          ccEmails,
          mahnstufe,
          gesamtbetrag: stand.daten.gesamtRueckstand + stand.daten.mahnkostenGesamt + stand.daten.verzugszinsenGesamt,
          rueckstandBetrag: stand.daten.gesamtRueckstand,
          mahngebuehren: stand.daten.mahnkostenGesamt,
          verzugszinsen: stand.daten.verzugszinsenGesamt,
          zusaetzlicheKosten: 0,
          // Gleiche Vorgabe wie im PDF -- ohne sie nannte die Mail bei leerem Feld „heute“ als Frist
          zahlungsfristTage: stand.daten.zahlungsfristTage,
          // Die Frist als Tag des Schreibens; ältere Fassungen der Function rechnen mit den Tagen
          fristDatum: stand.fristIso,
          immobilieName: contractData.immobilie_name || 'N/A',
          immobilieAdresse: contractData.immobilie_adresse || 'N/A',
          pdfPath: stand.pfad,
          mietvertragId: contractData.mietvertrag_id,
          kuendigung,
        }
      });

      if (error) throw error;
      // Es gibt nur einen Toast zugleich (use-toast, TOAST_LIMIT = 1): Warnungen werden gesammelt
      // und am Ende statt der Erfolgsmeldung gezeigt -- bis zum 27.10.2026 verdrängte die
      // Erfolgsmeldung sie sofort, auch „Vertragsstatus nicht gesetzt“ bei Stufe 3.
      const probleme: string[] = [];
      if (versand?.warnung) probleme.push(versand.warnung);

      // Ab Stufe 3 enthaelt das Schreiben eine fristlose Kuendigung nach
      // §§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB. Bis zum 06.09.2026 blieb der
      // Vertrag danach 'aktiv': Die Sollstellung lief weiter, das Dashboard
      // zaehlte die Einheit als vermietet, und keine Auswertung kannte den
      // Vorgang. Wer kuendigt, muss den Vertrag auch beenden.
      if (kuendigung && versand?.kuendigungGesetzt === true) {
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
        queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
      } else if (kuendigung) {
        // Nur wenn die Function den Status nicht bestätigt (ältere Fassung, Stufe nicht gespeichert):
        // wie bisher im Browser nachziehen — dieselben Werte, also unschädlich doppelt
        // Nur einen laufenden Vertrag — ein beendeter bleibt beendet (Review 28.10.2026)
        const { data: gesetzt, error: statusError } = await supabase
          .from('mietvertrag')
          .update({
            ...kuendigung,
            aktualisiert_am: new Date().toISOString(),
          })
          .eq('id', contractData.mietvertrag_id)
          .in('status', ['aktiv', 'gekuendigt'])
          .select('id');

        if (statusError) {
          probleme.push(`Vertragsstatus nicht gesetzt: Das Kuendigungsschreiben ist raus, der Vertrag steht aber weiter auf aktiv (${statusError.message}). Bitte den Status von Hand auf "gekuendigt" setzen.`);
        } else if (!gesetzt || gesetzt.length === 0) {
          probleme.push('Vertragsstatus nicht gesetzt: Der Vertrag ist weder aktiv noch gekündigt. Bitte Status und Vertragsende am Vertrag prüfen.');
        } else {
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['mahnung-vormerkungen', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['mahnung-versand', contractData.mietvertrag_id] });

      const anAdressen = versandEmpfaenger.join(', ');
      if (probleme.length > 0) {
        toast({
          title: "Mahnung versendet – bitte prüfen",
          description: probleme.join(' '),
          variant: "destructive",
        });
      } else {
        toast({
          title: "E-Mail versendet",
          // Wiederholung (Doppelklick, zweiter Tab): send-mahnung versendet nicht doppelt (28.10.2026)
          description: versand?.bereitsVersendet
            ? 'Dieses Schreiben war bereits versendet; es ging keine zweite Mail raus.'
            : mahnstufe >= 3
              ? `Mahnung Stufe ${mahnstufe} mit fristloser Kündigung wurde an ${anAdressen} versendet. Der Vertrag steht jetzt auf "gekündigt".`
              : `Mahnung Stufe ${mahnstufe} wurde an ${anAdressen} versendet.`,
        });
      }
      onClose();
    } catch (err) {
      toast({
        title: "Fehler",
        description: await edgeFehlertext(err, 'E-Mail konnte nicht versendet werden'),
        variant: "destructive",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  // „Per Post versandt“ (28.10.2026): send-mahnung bucht die Stufe aus der Vormerkung, mit denselben
  // Prüfungen wie beim Mailversand, bei Stufe 3 samt Kündigungsfeldern im selben Update. Anders als im
  // Mailweg setzt der Browser hier nie selbst den Status: Scheitert die Buchung, ist nichts geschehen.
  const handlePostBuchen = async () => {
    const stand = gespeichert;
    if (!contractData || !stand) return;
    const fehler = postFehler ?? nummerFehler;
    if (fehler) {
      toast({ title: "Postversand prüfen", description: fehler, variant: "destructive" });
      return;
    }

    setIsSendingEmail(true);
    try {
      const { data: buchung, error } = await supabase.functions.invoke('send-mahnung', {
        body: {
          versandart: 'post',
          mietvertragId: contractData.mietvertrag_id,
          mahnstufe,
          pdfPath: stand.pfad,
          versendetAm: aufgabeAm,
          sendungsnummer: sendungsnummer.trim() || undefined,
        },
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
      queryClient.invalidateQueries({ queryKey: ['mahnung-vormerkungen', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['mahnung-versand', contractData.mietvertrag_id] });

      const zugang = deutschAusIso(typeof buchung?.zugangAm === 'string' ? buchung.zugangAm : zugangBeiPost(aufgabeAm));
      if (buchung?.warnung) {
        toast({ title: "Postversand gebucht – bitte prüfen", description: buchung.warnung, variant: "destructive" });
      } else {
        toast({
          title: "Postversand gebucht",
          description: buchung?.bereitsVersendet
            ? `Dieser Postversand war bereits gebucht (Zugang voraussichtlich ${zugang}).`
            : stand.kuendigung
            ? `Mahnung Stufe ${mahnstufe} mit fristloser Kündigung ist als per Post versandt gebucht (Zugang voraussichtlich ${zugang}). Der Vertrag steht jetzt auf "gekündigt".`
            : `Mahnung Stufe ${mahnstufe} ist als per Post versandt gebucht (Zugang voraussichtlich ${zugang}).`,
        });
      }
      onClose();
    } catch (err) {
      toast({
        title: "Fehler",
        description: await edgeFehlertext(err, 'Der Postversand konnte nicht gebucht werden'),
        variant: "destructive",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Nur der Rückstand zählt: hinge die Rechnung an allen Beträgen, überschriebe sie jede Eingabe der Zinssumme
  const rueckstandWert = betraege.werte.rueckstand;
  const rueckstandUngueltig = betraege.ungueltig.includes('rueckstand');
  const autoBerechneVerzugszinsen = useCallback(() => {
    // Unlesbarer Rückstand: keine Zinsen aus einem falschen Betrag rechnen
    if (rueckstandUngueltig) return;
    const parsedBetrag = rueckstandWert;
    const heute = new Date();
    // Offen sind die jüngsten fälligen Monate, je eine Monatsmiete; Verzug ab dem Tag nach dem 3. Werktag des
    // Mietmonats, Zinssatz je Basiszins-Periode (utils/verzugszinsen.ts, seit 27.10.2026)
    const posten = verzugspostenAusRueckstand(parsedBetrag, monatsmieteDesVertrags, heute);
    const ergebnis = berechneAlleVerzugszinsen(posten, heute, perioden);

    setVerzugszinsenDetails(ergebnis.details.map(d => ({
      monat: `${d.monat} (${d.tage} Tage, ${d.verzugszinssatz.toFixed(2)}%)`,
      betrag: d.zinsbetrag,
    })));
    setVerzugszinsenGesamt(ergebnis.gesamt.toFixed(2));
  }, [rueckstandWert, rueckstandUngueltig, monatsmieteDesVertrags, perioden]);

  // Verzugszinsen automatisch berechnen wenn Modal öffnet oder Rückstand/Monate ändern
  useEffect(() => {
    if (!isOpen || rueckstandWert <= 0) return;
    autoBerechneVerzugszinsen();
  }, [isOpen, autoBerechneVerzugszinsen]);

  const addVerzugszinsenDetail = () => {
    setVerzugszinsenDetails(prev => [...prev, { monat: '', betrag: 0 }]);
  };

  const removeVerzugszinsenDetail = (index: number) => {
    setVerzugszinsenDetails(prev => prev.filter((_, i) => i !== index));
  };

  const updateVerzugszinsenDetail = (index: number, field: string, value: any) => {
    setVerzugszinsenDetails(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  if (!contractData) return null;

  const parsedRueckstand = betraege.werte.rueckstand;
  const parsedMahnkosten = leseKautionsbetrag(mahnkostenGesamt) ?? 0;
  const parsedVerzugszinsen = betraege.werte.verzugszinsen;
  const gesamtkosten = parsedRueckstand + parsedMahnkosten + parsedVerzugszinsen;
  // Im Versandschritt zählt das abgelegte Schreiben
  const versandGesamt = gespeichert
    ? gespeichert.daten.gesamtRueckstand + gespeichert.daten.mahnkostenGesamt + gespeichert.daten.verzugszinsenGesamt
    : gesamtkosten;
  // Solange ein Versand unklar ist, lehnt send-mahnung neue Vormerkungen ab — erst klären (Review 28.10.2026)
  // Auch gesperrt, solange nicht geprüft ist, ob ein Versand unklar ist (lädt oder Fehler)
  const speichernGesperrt = isSubmitting || fristlosGesperrt || parsedRueckstand <= 0 || betraege.ungueltig.length > 0 || anzahlUngueltig || !vorschauAktuell || unklar !== null || !unklarGeprueft;

  const getMahnstufeColor = (stufe: number) => {
    if (stufe === 1) return "bg-yellow-100 text-yellow-800 border-yellow-300";
    if (stufe === 2) return "bg-orange-100 text-orange-800 border-orange-300";
    return "bg-red-100 text-red-800 border-red-300";
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[95vh] h-[90vh] overflow-hidden flex flex-col p-0">
        {step === 'edit' ? (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b bg-background flex-shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <FileText className="h-5 w-5 text-destructive shrink-0" />
                <h2 className="text-base sm:text-lg font-semibold">Mahnung erstellen</h2>
                <Badge variant="outline" className={getMahnstufeColor(mahnstufe)}>
                  Stufe {mahnstufe}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={!pdfBlobUrl}>
                  <Download className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowConfirmSave(true)}
                  disabled={speichernGesperrt}
                  variant="destructive"
                >
                  {isSubmitting ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Speichern...</>
                  ) : (
                    <><Send className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Speichern & weiter</span><span className="sm:hidden">Speichern</span></>
                  )}
                </Button>
              </div>
            </div>

            {/* Split-screen content */}
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* LEFT: Editable Fields */}
              <ScrollArea className="w-full md:w-[420px] md:flex-shrink-0 border-b md:border-b-0 border-r-0 md:border-r">
                <div className="p-5 space-y-5">
                  {/* Gespeichert, aber noch nicht versandt */}
                  {angebot && !angebotVerworfen && !unklar && (
                    <Alert>
                      <Mailbox className="h-4 w-4" />
                      <AlertDescription className="text-sm space-y-3">
                        <p>
                          Das Schreiben der Stufe {angebot.stufe} vom{' '}
                          {deutschAusIso(berlinerKalendertag(new Date(angebot.erstellt_am)))} ist gespeichert, aber noch nicht versandt.
                          Zahlungsfrist {deutschAusIso(angebot.zahlungsfrist.slice(0, 10))}.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={vormerkungVersenden} disabled={vormerkungLaedt || fristlosGesperrt}>
                            {vormerkungLaedt ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                            Jetzt versenden (E-Mail oder Post)
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAngebotVerworfen(true)} disabled={vormerkungLaedt}>
                            Neues Schreiben erstellen
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  {/* Beansprucht, aber nicht abgeschlossen: nicht erneut anbieten, sondern klären */}
                  {unklar && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm space-y-3">
                        <p>
                          Versand unklar: Das Schreiben der Stufe {unklar.zeile.stufe} wurde am{' '}
                          {new Date(unklar.zeile.aktualisiert_am).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}{' '}
                          {unklar.zeile.versandart === 'post' ? 'zur Postbuchung' : 'zum Mailversand'} angestoßen, der Vorgang
                          wurde aber nicht abgeschlossen.
                          {unklar.zeile.versandart === 'email'
                            ? ' Bitte im Mail-Protokoll (System → Mails) und im Postausgang prüfen, ob die Mail raus ist, und das Ergebnis bestätigen. Steht sie im Mail-Protokoll als gesendet, wird der Versand in jedem Fall nachgebucht.'
                            : ' „Klären“ schließt die Buchung ab, wenn die Mahnstufe schon steht, und gibt das Schreiben sonst wieder frei.'}
                          {' '}Ein neues Schreiben lässt sich erst nach dem Klären speichern.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => (unklar.zeile.versandart === 'email' ? setShowConfirmFreigabe(true) : versandKlaeren(null))}
                            disabled={!unklar.klaerbar || klaertGerade}
                          >
                            {klaertGerade && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            {unklar.zeile.versandart === 'email' ? 'Als nicht versendet freigeben' : 'Buchung klären'}
                          </Button>
                          {unklar.zeile.versandart === 'email' && (
                            <Button size="sm" variant="outline" onClick={() => setShowConfirmVersendet(true)} disabled={!unklar.klaerbar || klaertGerade}>
                              Mail ist versendet worden
                            </Button>
                          )}
                        </div>
                        {!unklar.klaerbar && (
                          <p className="text-xs">
                            Möglich ab {unklar.klaerbarAb.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })} Uhr — bis dahin
                            kann der Versand noch laufen.
                          </p>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  {unklarFehler && (
                    <p className="text-xs text-destructive" role="alert">
                      Ob ein früherer Versand noch unklar ist, konnte nicht geprüft werden. Speichern ist gesperrt;
                      bitte den Dialog neu öffnen.
                    </p>
                  )}
                  {angebotFehler && (
                    <p className="text-xs text-destructive" role="alert">
                      Gespeicherte, noch nicht versandte Schreiben konnten nicht geprüft werden.
                    </p>
                  )}

                  {/* Vertragsdaten */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vertragsdaten</h3>
                    <div className="space-y-3">
                      <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                        <p><span className="text-muted-foreground">Objekt:</span> {contractData.immobilie_name}</p>
                        <p><span className="text-muted-foreground">Adresse:</span> {contractData.immobilie_adresse}</p>
                        <p><span className="text-muted-foreground">Mieter:</span> {contractData.mieter?.map(m => `${m.vorname} ${m.nachname}`).join(', ')}</p>
                        <p><span className="text-muted-foreground">Vertragsbeginn:</span> {contractData.start_datum ? new Date(contractData.start_datum).toLocaleDateString('de-DE') : 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Empfänger */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Empfänger im Brief</h3>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Anrede</Label>
                        <Select value={anrede} onValueChange={setAnrede}>
                          <SelectTrigger className="mt-1 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Herr">Herr</SelectItem>
                            <SelectItem value="Frau">Frau</SelectItem>
                            <SelectItem value="Herr und Frau">Herr und Frau</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Straße</Label>
                        <Input value={mieterAdresse} onChange={(e) => setMieterAdresse(e.target.value)} className="mt-1 h-9" />
                      </div>
                      <div>
                        <Label className="text-xs">PLZ + Ort</Label>
                        <Input value={mieterPlzOrt} onChange={(e) => setMieterPlzOrt(e.target.value)} className="mt-1 h-9" />
                      </div>
                      <div>
                        <Label className="text-xs">Einheit-Bezeichnung (z.B. WE 3)</Label>
                        <Input value={einheitBezeichnung} onChange={(e) => setEinheitBezeichnung(e.target.value)} className="mt-1 h-9" />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Rückstand */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Rückstand</h3>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Gesamtrückstand (€)</Label>
                        <Input 
                          type="number" step="0.01" 
                          value={gesamtRueckstand} 
                          onChange={(e) => setGesamtRueckstand(e.target.value)} 
                          className="mt-1 h-9 text-lg font-semibold"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Anzahl Monatsmieten im Rückstand</Label>
                        <Input 
                          type="number" 
                          value={anzahlMonatsmieten} 
                          readOnly
                          title="Aus dem Mietanteil des Rückstands, ohne Betriebskostennachzahlung und Gebühren"
                          className="mt-1 h-9 bg-muted/40"
                        />
                      </div>
                      {fristlosGesperrt && (
                        <p className="text-xs text-destructive" role="alert">
                          Keine fristlose Kündigung möglich: Der Mietrückstand ({mietanteil.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €) übersteigt
                          eine Monatsmiete ({monatsmieteDesVertrags.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €) nicht
                          (§ 543 Abs. 2 Nr. 3, § 569 Abs. 3 Nr. 1 BGB). Betriebskostennachzahlungen und Gebühren zählen dafür nicht.
                        </p>
                      )}
                      {betraege.ungueltig.includes('rueckstand') && (
                        <p className="text-xs text-destructive" role="alert">{betragsMeldung}</p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* Verzugszinsen */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Verzugszinsen</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={autoBerechneVerzugszinsen}
                        disabled={parsedRueckstand <= 0 || betraege.ungueltig.includes('rueckstand')}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Auto berechnen
                      </Button>
                    </div>
                    <div className="mb-3 px-2 py-1.5 rounded bg-muted/60 text-xs text-muted-foreground flex items-center gap-1.5">
                      <span>§ 288 BGB:</span>
                      <span className="font-medium text-foreground">{perioden[0]?.satz.toFixed(2)}% Basiszins + 5% = {getVerzugszinssatz(new Date(), perioden).toFixed(2)}% Verzugszins</span>
                      {fromDB && <span className="ml-auto text-green-600">● DB</span>}
                    </div>
                    <div className="space-y-3">
                      {verzugszinsenDetails.map((detail, i) => (
                        <div key={i} className="flex gap-2 items-end">
                          <div className="flex-1">
                            <Label className="text-xs">Monat</Label>
                            <Input 
                              value={detail.monat} 
                              onChange={(e) => updateVerzugszinsenDetail(i, 'monat', e.target.value)}
                              placeholder="z.B. Mai 2025"
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                          <div className="w-24">
                            <Label className="text-xs">Betrag (€)</Label>
                            <DecimalInput
                              step="0.01"
                              value={detail.betrag}
                              onValueChange={(wert) => updateVerzugszinsenDetail(i, 'betrag', wert ?? 0)}
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeVerzugszinsenDetail(i)}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={addVerzugszinsenDetail} className="w-full h-8 text-xs">
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Monat hinzufügen
                      </Button>
                      <div>
                        <Label className="text-xs">Zwischensumme Verzugszinsen (€)</Label>
                        <Input 
                          type="number" step="0.01" 
                          value={verzugszinsenGesamt} 
                          onChange={(e) => setVerzugszinsenGesamt(e.target.value)} 
                          className="mt-1 h-9"
                        />
                        {betraege.ungueltig.includes('verzugszinsen') && (
                          <p className="text-xs text-destructive mt-1" role="alert">{betragsMeldung}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Mahnkosten */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Mahnkosten</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Pro Schreiben (€)</Label>
                        <Input 
                          type="number" step="0.01" 
                          value={mahnkostenProSchreiben} 
                          onChange={(e) => setMahnkostenProSchreiben(e.target.value)} 
                          className="mt-1 h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Anzahl Schreiben</Label>
                        <Input 
                          type="number" 
                          value={anzahlMahnschreiben} 
                          onChange={(e) => setAnzahlMahnschreiben(e.target.value)} 
                          className="mt-1 h-9"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Gesamt: {parsedMahnkosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </p>
                    {betraege.ungueltig.includes('mahnkostenProSchreiben') && (
                      <p className="text-xs text-destructive mt-1" role="alert">{betragsMeldung}</p>
                    )}
                    {anzahlUngueltig && (
                      <p className="text-xs text-destructive mt-1" role="alert">{ANZAHL_MELDUNG}</p>
                    )}
                  </div>

                  <Separator />

                  {/* Fristen */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fristen</h3>
                    {adressen.length === 0 && (
                      <p className="text-xs text-muted-foreground mb-3">
                        Keine Mailadresse hinterlegt – Versand per Post. Die Fristen enthalten {POST_ZUGANG_TAGE} Tage Postlaufzeit,
                        weil sie erst mit dem Zugang beginnen.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Zahlungsfrist (Tage)</Label>
                        <Input
                          type="number"
                          value={zahlungsfristTage}
                          onChange={(e) => setZahlungsfristTage(e.target.value)}
                          className="mt-1 h-9"
                        />
                      </div>
                      {mahnstufe >= 3 && (
                        <div>
                          <Label className="text-xs">Räumungsfrist (Tage)</Label>
                          <Input
                            type="number"
                            value={raeumungsfristTage}
                            onChange={(e) => setRaeumungsfristTage(e.target.value)}
                            className="mt-1 h-9"
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-3">
                      <Label className="text-xs">Übergabedatum (optional)</Label>
                      <Input
                        type="date"
                        value={uebergabeDatum}
                        onChange={(e) => setUebergabeDatum(e.target.value)}
                        className="mt-1 h-9"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Wird im Brief als Termin für die Wohnungsübergabe angegeben.
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Freitext Option */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Brieftext</h3>
                      <Button
                        variant={useFreitext ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (!useFreitext) {
                            if (!freitext) {
                              setFreitext(buildStandardText());
                            }
                            setUseFreitext(true);
                          } else {
                            setUseFreitext(false);
                          }
                        }}
                      >
                        {useFreitext ? "Standard verwenden" : "Freitext"}
                      </Button>
                    </div>
                    {useFreitext && (
                      <Textarea
                        value={freitext}
                        onChange={(e) => setFreitext(e.target.value)}
                        placeholder="Eigenen Brieftext eingeben..."
                        className="min-h-[160px] text-sm"
                      />
                    )}
                    {!useFreitext && (
                      <p className="text-xs text-muted-foreground">
                        Es wird der Standard-Mahnungstext für Stufe {mahnstufe} verwendet.
                      </p>
                    )}
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-destructive/5 rounded-lg border border-destructive/20">
                    <h4 className="font-semibold text-sm mb-2">Zusammenfassung</h4>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mietrückstand:</span>
                        <span>{parsedRueckstand.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Verzugszinsen:</span>
                        <span>{parsedVerzugszinsen.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mahnkosten:</span>
                        <span>{parsedMahnkosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-between font-bold text-base">
                        <span>Gesamt:</span>
                        <span className="text-destructive">{gesamtkosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                      </div>
                    </div>
                  </div>

                  {mahnstufe >= 3 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Diese Mahnung enthält eine fristlose Kündigung. Bei Nichtzahlung können Räumungsklage und weitere rechtliche Schritte eingeleitet werden.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </ScrollArea>

              {/* RIGHT: PDF Preview */}
              <div className="hidden md:flex flex-1 flex-col bg-muted/30 min-w-0">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50 flex-shrink-0">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    <span>PDF-Vorschau</span>
                    {isGeneratingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {!isGeneratingPreview && pdfBlob && !vorschauAktuell && (
                      <span className="text-xs">wird aktualisiert …</span>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={regeneratePreview}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Aktualisieren
                  </Button>
                </div>
                <div className="flex-1 p-4 overflow-auto">
                  {pdfBlobUrl ? (
                    <iframe 
                      src={pdfBlobUrl} 
                      title="Mahnung PDF Vorschau"
                      className="w-full h-full min-h-[600px] bg-white shadow-lg rounded border"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin mb-3" />
                      <p className="text-sm">PDF wird generiert...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* VERSAND: per E-Mail oder „per Post versandt“ buchen */
          <div className="flex flex-col h-full">
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b bg-background flex-shrink-0">
              <div className="flex items-center gap-3">
                {versandart === 'post'
                  ? <Mailbox className="h-5 w-5 text-destructive" />
                  : <Mail className="h-5 w-5 text-destructive" />}
                <h2 className="text-lg font-semibold">Mahnung versenden</h2>
                <Badge variant="outline" className={getMahnstufeColor(mahnstufe)}>
                  Stufe {mahnstufe}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mr-6">
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={!pdfBlobUrl}>
                  <Download className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">PDF</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setStep('edit')}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Zurück
                </Button>
                {versandart === 'email' ? (
                  <Button
                    size="sm"
                    onClick={() => setShowConfirmSend(true)}
                    disabled={isSendingEmail || versandEmpfaenger.length === 0 || versandEmpfaenger.length > MAX_EMPFAENGER || !gespeichert}
                    variant="destructive"
                  >
                    {isSendingEmail ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Senden...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-1.5" />Mahnung versenden</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setShowConfirmPost(true)}
                    disabled={isSendingEmail || !gespeichert || postFehler !== null || nummerFehler !== null}
                    variant="destructive"
                  >
                    {isSendingEmail ? (
                      <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Buchen...</>
                    ) : (
                      <><Mailbox className="h-4 w-4 mr-1.5" />Als per Post versandt buchen</>
                    )}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Versandweg und Angaben */}
              <div className="w-full md:w-[420px] md:flex-shrink-0 border-b md:border-b-0 border-r-0 md:border-r p-5 space-y-5 overflow-auto">
                <div>
                  <Label>Versandweg</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Versandweg">
                    <Button
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={versandart === 'email'}
                      variant={versandart === 'email' ? 'default' : 'outline'}
                      onClick={() => setVersandart('email')}
                      disabled={adressen.length === 0 || isSendingEmail}
                    >
                      <Mail className="h-4 w-4 mr-1.5" />E-Mail
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={versandart === 'post'}
                      variant={versandart === 'post' ? 'default' : 'outline'}
                      onClick={() => setVersandart('post')}
                      disabled={isSendingEmail}
                    >
                      <Mailbox className="h-4 w-4 mr-1.5" />Post
                    </Button>
                  </div>
                  {adressen.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Für diesen Vertrag ist keine Mailadresse hinterlegt. Versand per Post – oder zuerst beim
                      Mieter eine Adresse eintragen.
                    </p>
                  )}
                </div>

                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1.5">
                  <p><span className="text-muted-foreground">Objekt:</span> {contractData.immobilie_name}</p>
                  <p>
                    <span className="text-muted-foreground">Gesamtbetrag:</span>{' '}
                    <span className="font-bold text-destructive">
                      {versandGesamt.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </span>
                  </p>
                  {gespeichert && (
                    <>
                      <p><span className="text-muted-foreground">Schreiben vom:</span> {gespeichert.daten.datum}</p>
                      <p><span className="text-muted-foreground">Zahlungsfrist:</span> {gespeichert.daten.zahlungsfristDatum}</p>
                      {gespeichert.kuendigung && (
                        <p><span className="text-muted-foreground">Räumungsende:</span> {deutschAusIso(gespeichert.kuendigung.ende_datum)}</p>
                      )}
                    </>
                  )}
                  {versandart === 'email' && (
                    <p><span className="text-muted-foreground">PDF:</span> wird als Anhang versendet</p>
                  )}
                </div>

                {versandart === 'email' ? (
                  <>
                    <div className="space-y-4">
                      <div>
                        <Label>Empfänger *</Label>
                        <div className="mt-1 space-y-2">
                          {adressen.map(adresse => (
                            <label key={adresse} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={ausgewaehlt.includes(adresse)}
                                onCheckedChange={an =>
                                  setAusgewaehlt(liste => an ? [...liste, adresse] : liste.filter(a => a !== adresse))
                                }
                              />
                              <span className="truncate">{adresse}</span>
                            </label>
                          ))}
                        </div>
                        {contractData.mieter && contractData.mieter.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {contractData.mieter.map(m => `${m.vorname} ${m.nachname}`).join(', ')}
                          </p>
                        )}
                        {versandEmpfaenger.length === 0 && adressen.length > 0 && (
                          <p className="text-xs text-destructive mt-1" role="alert">Bitte mindestens eine Adresse auswählen.</p>
                        )}
                        {versandEmpfaenger.length > MAX_EMPFAENGER && (
                          <p className="text-xs text-destructive mt-1" role="alert">Höchstens {MAX_EMPFAENGER} Empfänger.</p>
                        )}
                      </div>
                      <div>
                        <Label>CC (optional, höchstens 5, kommagetrennt)</Label>
                        <Input
                          type="text"
                          value={emailCc}
                          onChange={(e) => setEmailCc(e.target.value)}
                          placeholder="kopie@beispiel.de"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-muted/50 rounded-lg border text-sm space-y-1">
                      <p className="font-medium">E-Mail-Vorschau:</p>
                      <p className="text-xs">
                        <span className="font-medium">Betreff:</span>{' '}
                        {mahnstufe >= 3
                          ? `${mahnstufe}. und letzte Mahnung — Mietrückstand | ${contractData.immobilie_name}`
                          : `${mahnstufe}. Mahnung — Mietrückstand | ${contractData.immobilie_name}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        HTML-Template mit NilImmo-Branding, Forderungsübersicht und PDF-Anhang.
                      </p>
                    </div>

                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Die Mahnung wird direkt an die ausgewählten Adressen versendet. Bitte die Auswahl prüfen.
                      </AlertDescription>
                    </Alert>
                  </>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Schreiben herunterladen, drucken und zur Post geben. Danach hier buchen: Die Mahnstufe
                      steigt dann auf {mahnstufe}.
                    </p>
                    <div>
                      <Label htmlFor="mahnung-aufgabe">Zur Post gegeben am *</Label>
                      <Input
                        id="mahnung-aufgabe"
                        type="date"
                        value={aufgabeAm}
                        min={schreibtagIso}
                        max={heuteIso}
                        onChange={(e) => setAufgabeAm(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    {zugangIso && gespeichert && (
                      <div className="text-sm space-y-1">
                        <p>
                          <span className="text-muted-foreground">Zugang voraussichtlich:</span>{' '}
                          {deutschAusIso(zugangIso)} ({POST_ZUGANG_TAGE} Tage nach Aufgabe)
                        </p>
                        <p>
                          <span className="text-muted-foreground">Zahlungsfrist:</span>{' '}
                          {deutschAusIso(gespeichert.fristIso)} – {tageZwischen(zugangIso, gespeichert.fristIso)} Tage nach Zugang
                        </p>
                        {gespeichert.kuendigung && (
                          <p>
                            <span className="text-muted-foreground">Räumungsende:</span>{' '}
                            {deutschAusIso(gespeichert.kuendigung.ende_datum)} – {tageZwischen(zugangIso, gespeichert.kuendigung.ende_datum)} Tage nach Zugang
                          </p>
                        )}
                      </div>
                    )}
                    {postFehler && (
                      <p className="text-xs text-destructive" role="alert">{postFehler}</p>
                    )}
                    <div>
                      <Label htmlFor="mahnung-sendungsnummer">Sendungsnummer (Einschreiben, optional)</Label>
                      <Input
                        id="mahnung-sendungsnummer"
                        type="text"
                        value={sendungsnummer}
                        onChange={(e) => setSendungsnummer(e.target.value)}
                        placeholder="z. B. RR123456789DE"
                        className="mt-1"
                      />
                      {nummerFehler && (
                        <p className="text-xs text-destructive mt-1" role="alert">{nummerFehler}</p>
                      )}
                    </div>
                    {mahnstufe >= 3 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Die fristlose Kündigung wird erst mit dem Zugang wirksam, und den Zugang muss der
                          Vermieter beweisen. Bitte per Einwurf-Einschreiben oder Boten zustellen.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>

              {/* PDF Preview in email step too */}
              <div className="hidden md:flex flex-1 flex-col bg-muted/30 min-w-0">
                <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/50 text-sm text-muted-foreground flex-shrink-0">
                  <Eye className="h-4 w-4" />
                  <span>PDF-Anhang Vorschau</span>
                </div>
                <div className="flex-1 p-4 overflow-auto">
                  {pdfBlobUrl ? (
                    <iframe 
                      src={pdfBlobUrl} 
                      title="Mahnung PDF"
                      className="w-full h-full min-h-[600px] bg-white shadow-lg rounded border"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <p className="text-sm">Keine PDF-Vorschau verfügbar</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      <AlertDialog open={showConfirmSave} onOpenChange={setShowConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mahnung speichern?</AlertDialogTitle>
            <AlertDialogDescription>
              Mahnung Stufe {mahnstufe} wird gespeichert, als Dokument zum Mietvertrag abgelegt und zum Versand
              vorgemerkt. Versendet ist sie erst per E-Mail oder mit der Buchung „per Post versandt“. Fortfahren?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAndUpload}>
              Bestätigen & Speichern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConfirmSend} onOpenChange={setShowConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mahnstufe >= 3 ? 'Fristlose Kündigung versenden?' : 'Mahnung versenden?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mahnstufe >= 3 ? (
                <>
                  Dieses Schreiben kündigt das Mietverhältnis <strong>außerordentlich fristlos</strong>
                  {' '}(§§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB). Mit dem Versand wird der Vertrag
                  auf „gekündigt" gesetzt und das Vertragsende auf das Ende der Räumungsfrist
                  ({gespeichert?.kuendigung
                    ? gespeichert.kuendigung.ende_datum.split('-').reverse().join('.')
                    : `${raeumungsfristInTagen(parseInt(raeumungsfristTage))} Tage`}) datiert. Der Versand an {versandEmpfaenger.join(', ')} kann nicht
                  rückgängig gemacht werden.
                </>
              ) : (
                <>Die Mahnung wird an {versandEmpfaenger.join(', ')} versendet. Dies kann nicht rückgängig gemacht werden.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleSendEmail} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Bestätigen & Senden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConfirmFreigabe} onOpenChange={setShowConfirmFreigabe}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mail als nicht versendet freigeben?</AlertDialogTitle>
            <AlertDialogDescription>
              Nur bestätigen, wenn die Mail laut Postausgang des Mahnungspostfachs nicht versendet wurde. Danach
              lässt sich das Schreiben erneut versenden — war die Mail doch raus, bekommt der Mieter sie doppelt.
              Steht die Mail im Mail-Protokoll als gesendet, bucht die Anwendung den Versand stattdessen nach.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => versandKlaeren('nicht_versendet')} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ich habe im Postausgang geprüft: nicht versendet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConfirmVersendet} onOpenChange={setShowConfirmVersendet}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mail als versendet bestätigen?</AlertDialogTitle>
            <AlertDialogDescription>
              Nur bestätigen, wenn die Mail laut Postausgang des Mahnungspostfachs tatsächlich versendet wurde.
              Die Mahnstufe steigt dann auf {unklar?.zeile.stufe}
              {unklar?.zeile.stufe === 3 ? ', und der Vertrag wird mit den Feldern des Schreibens gekündigt' : ''}.
              Die Bestätigung wird mit Ihrer Nutzerkennung protokolliert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => versandKlaeren('versendet')} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ich habe im Postausgang geprüft: die Mail ist versendet worden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showConfirmPost} onOpenChange={setShowConfirmPost}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mahnstufe >= 3 ? 'Fristlose Kündigung als per Post versandt buchen?' : 'Postversand buchen?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Mahnung Stufe {mahnstufe}, zur Post gegeben am {deutschAusIso(aufgabeAm)}
              {zugangIso ? `, Zugang voraussichtlich am ${deutschAusIso(zugangIso)}` : ''}. Die Mahnstufe steigt auf {mahnstufe}.
              {gespeichert?.kuendigung && (
                <>
                  {' '}Das Schreiben kündigt das Mietverhältnis <strong>außerordentlich fristlos</strong>; der Vertrag
                  wird auf „gekündigt" gesetzt, Vertragsende {deutschAusIso(gespeichert.kuendigung.ende_datum)}.
                </>
              )}
              {' '}Die Buchung kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handlePostBuchen} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Bestätigen & Buchen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
