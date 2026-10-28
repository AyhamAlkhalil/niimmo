import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, Download, Eye, Save, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateMieterhoehungPdf, BEGRUENDUNGS_BEZEICHNUNG, type MieterhoehungPdfData, type BegruendungsArt } from "@/utils/mieterhoehungPdfGenerator";
import { useAktuellerVpi } from "@/hooks/useBasiszinsPerioden";
import {
  kappungsBasis, kappungsgrenzeProzent, maximaleKaltmiete, mehrforderungProMonat, mieteAusVerlangen, mieteSeitVerlangenGeaendert,
  neueMieteAusEingabe, offeneVerlangenIds, offenesVerlangen, wirksamAb, wirksamAbTag, type ErhoehungsVorgang,
} from '@/utils/mieterhoehungRegeln';
import { format } from 'date-fns';
import { schriftstueckPfad } from '@/utils/storagePfad';

interface RentIncreaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractData: {
    mietvertrag_id: string;
    current_kaltmiete: number;
    current_betriebskosten: number;
    letzte_mieterhoehung_am: string | null;
    start_datum: string;
    months_since_last_increase: number;
    months_since_start: number;
    einheit_id?: string;
    immobilie_id?: string;
    immobilie_name?: string;
    immobilie_adresse?: string;
    mieter?: Array<{
      vorname: string;
      nachname: string;
      hauptmail: string | null;
      telnr: string | null;
    }>;
  } | null;
}

export function RentIncreaseModal({ isOpen, onClose, contractData }: RentIncreaseModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { vpi: aktuellerVpi } = useAktuellerVpi();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  // Eingaben, aus denen pdfBlob entstand — gespeichert wird nur ein PDF zum aktuellen Stand
  const [pdfStand, setPdfStand] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [showConfirmZustimmung, setShowConfirmZustimmung] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable fields
  const [neueKaltmiete, setNeueKaltmiete] = useState("0.00");
  const [neueBetriebskosten, setNeueBetriebskosten] = useState("0.00");
  // Leer = alle Mieter neutral beim Namen; „Herr“ als Vorgabe sprach jede Mieterin falsch an
  const [anrede, setAnrede] = useState("");
  const [mieterAdresse, setMieterAdresse] = useState("");
  const [mieterPlzOrt, setMieterPlzOrt] = useState("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState("WE");
  const [istAngespannt, setIstAngespannt] = useState(false);
  const [angespanntUnbekannt, setAngespanntUnbekannt] = useState(false);
  const [fruehereErhoehungen, setFruehereErhoehungen] = useState<ErhoehungsVorgang[]>([]);
  const [erhoehungenGeladen, setErhoehungenGeladen] = useState<'laedt' | 'ok' | 'fehler'>('laedt');
  // § 558a Abs. 2 BGB: ohne Begründungsmittel ist das Verlangen unwirksam.
  const [begruendungsart, setBegruendungsart] = useState<BegruendungsArt>("mietspiegel");
  const [begruendungText, setBegruendungText] = useState("");
  // Liegt die Zustimmung des Mieters bereits vor, darf die Vertragsmiete
  // sofort geändert werden (§ 558b Abs. 1 BGB).
  const [mieterHatZugestimmt, setMieterHatZugestimmt] = useState(false);

  // § 558 Abs. 3 BGB: 15 % bei angespanntem Markt, sonst 20 % in drei Jahren — gerechnet von der
  // Miete drei Jahre vor dem Wirksamwerden (kappungsBasis), nicht von der heutigen.
  const kappungsgrenze = kappungsgrenzeProzent(istAngespannt);
  // Solange die früheren Erhöhungen nicht geladen sind (oder das Laden scheiterte), ist die Basis
  // unbekannt — bis zum 27.10.2026 galt dann still die heutige Miete als sicher (Review)
  const basisGerechnet = contractData
    ? kappungsBasis(contractData.current_kaltmiete, wirksamAbTag(new Date()), contractData.letzte_mieterhoehung_am, fruehereErhoehungen)
    : { betrag: 0, sicher: true };
  const basis = erhoehungenGeladen === 'ok' ? basisGerechnet : { ...basisGerechnet, sicher: false };
  const maxKaltmiete = maximaleKaltmiete(basis.betrag, istAngespannt);
  const erhoehungProzent = basis.betrag > 0
    ? ((parseFloat(neueKaltmiete) - basis.betrag) / basis.betrag * 100)
    : 0;
  const ueberKappung = erhoehungProzent > kappungsgrenze + 1e-9;
  // § 558b Abs. 1 BGB: geschuldet ab Beginn des dritten Kalendermonats nach
  // Zugang. Wer heute erfasst, setzt die Miete also in der Regel zu früh.
  const wirksamAbDatum = wirksamAb(new Date());
  const erhoehungGiltSpaeter = wirksamAbDatum > new Date();
  // Offenes Verlangen: dessen Zustimmung wird erfasst, statt ein neues Schreiben anzulegen (28.10.2026)
  const verlangen = erhoehungenGeladen === 'ok' ? offenesVerlangen(fruehereErhoehungen) : null;
  const verlangenGiltSpaeter = !!verlangen?.wirksam_ab && verlangen.wirksam_ab.slice(0, 10) > format(new Date(), 'yyyy-MM-dd');
  const verlangenMiete = verlangen ? mieteAusVerlangen(verlangen) : null;
  const verlangtAmText = verlangen?.verlangt_am ? new Date(`${verlangen.verlangt_am.slice(0, 10)}T00:00:00`).toLocaleDateString('de-DE') : '–';
  const verlangenWirksamText = verlangen?.wirksam_ab ? new Date(`${verlangen.wirksam_ab.slice(0, 10)}T00:00:00`).toLocaleDateString('de-DE') : '–';

  // Neben einem offenen Verlangen gibt es keinen Haken „zugestimmt“: er legte einen zweiten Vorgang mit
  // heutigem Datum an (Review 28.10.2026). Zugestimmt wird über „Zustimmung zum Verlangen erfassen“.
  useEffect(() => {
    if (verlangen) setMieterHatZugestimmt(false);
  }, [verlangen]);

  // Fetch ist_angespannt from immobilien
  useEffect(() => {
    if (!isOpen || !contractData?.immobilie_id) return;
    const fetchAngespannt = async () => {
      const { data, error } = await (supabase as any)
        .from('immobilien')
        .select('ist_angespannt')
        .eq('id', contractData.immobilie_id)
        .single();
      // Ein Lesefehler ergab bis zum 27.10.2026 still 20 %; jetzt die strengere Grenze und ein Hinweis
      setAngespanntUnbekannt(!!error);
      setIstAngespannt(error ? true : data?.ist_angespannt ?? false);
    };
    fetchAngespannt();
  }, [isOpen, contractData?.immobilie_id]);

  // Frühere wirksame Erhöhungen für die Ausgangsmiete der Kappungsgrenze
  useEffect(() => {
    if (!isOpen || !contractData?.mietvertrag_id) return;
    // Beim Vertragswechsel nicht mit den Vorgängen des vorherigen Vertrags rechnen
    setFruehereErhoehungen([]);
    setErhoehungenGeladen('laedt');
    let abgebrochen = false;
    (async () => {
      const { data, error } = await supabase
        .from('mieterhoehungen')
        .select('id, verlangt_am, wirksam_ab, alte_kaltmiete, alte_betriebskosten, neue_kaltmiete, neue_betriebskosten, status')
        .eq('mietvertrag_id', contractData.mietvertrag_id);
      if (abgebrochen) return;
      setFruehereErhoehungen(error ? [] : (data ?? []) as typeof fruehereErhoehungen);
      setErhoehungenGeladen(error ? 'fehler' : 'ok');
    })();
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contractData?.mietvertrag_id]);

  // Reset when modal opens — nur beim Öffnen oder Vertragswechsel. Bis zum 27.10.2026 hing er am
  // Objekt contractData, das die Liste bei jedem Neuladen neu baut: Eingaben fielen still zurück,
  // und das PDF eines zuvor geöffneten Vertrags blieb speicherbar.
  useEffect(() => {
    if (isOpen && contractData) {
      setPdfBlob(null);
      setPdfStand(null);
      setPdfBlobUrl(null);
      setNeueKaltmiete(contractData.current_kaltmiete.toFixed(2));
      setNeueBetriebskosten(contractData.current_betriebskosten.toFixed(2));
      setAnrede("");
      setMieterAdresse(contractData.immobilie_adresse?.split(',')[0]?.trim() || '');
      setMieterPlzOrt(contractData.immobilie_adresse?.includes(',')
        ? contractData.immobilie_adresse.split(',').slice(1).join(',').trim()
        : '');
      setEinheitBezeichnung("WE");
      setBegruendungsart("mietspiegel");
      setBegruendungText("");
      setMieterHatZugestimmt(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contractData?.mietvertrag_id]);

  // Build PDF data
  const buildPdfData = useCallback((): MieterhoehungPdfData | null => {
    if (!contractData) return null;

    const mieterList = contractData.mieter || [];
    const fullName = mieterList.map(m => `${m.vorname} ${m.nachname}`).join(' & ');
    const nachname = mieterList[0]?.nachname || '';

    const heute = new Date();
    const datumStr = heute.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // § 558b Abs. 1 BGB: Beginn des dritten Kalendermonats nach Zugang,
    // nicht schlicht "heute + 3 Monate".
    const wirksamDate = wirksamAb(heute);
    const wirksamStr = wirksamDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return {
      anrede,
      mieterName: fullName,
      mieterNachname: nachname,
      mieter: mieterList.map(m => ({ vorname: m.vorname, nachname: m.nachname })),
      mieterAdresse,
      mieterPlzOrt,
      immobilieName: contractData.immobilie_name || '',
      immobilieAdresse: contractData.immobilie_adresse || '',
      einheitBezeichnung,
      aktuelleKaltmiete: contractData.current_kaltmiete,
      aktuelleBetriebskosten: contractData.current_betriebskosten,
      neueKaltmiete: parseFloat(neueKaltmiete) || 0,
      neueBetriebskosten: parseFloat(neueBetriebskosten) || 0,
      datum: datumStr,
      wirksamDatum: wirksamStr,
      begruendungsart,
      begruendungText,
    };
  }, [contractData, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung, neueKaltmiete, neueBetriebskosten, begruendungsart, begruendungText]);

  // Generate PDF preview with debounce
  const regeneratePreview = useCallback(async () => {
    const pdfData = buildPdfData();
    if (!pdfData) return;

    setIsGeneratingPreview(true);
    try {
      const blob = await generateMieterhoehungPdf(pdfData);
      setPdfBlob(blob);
      setPdfStand(JSON.stringify(pdfData));
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
    } catch (err) {
      // Kein altes Schreiben stehen lassen, das danach gespeichert werden könnte
      setPdfBlob(null);
      setPdfStand(null);
      console.error('Mieterhoehungs-Vorschau konnte nicht erzeugt werden:', err);
      toast({
        title: "Vorschau nicht moeglich",
        description: "Das Mieterhoehungsschreiben konnte nicht erzeugt werden. Bitte pruefen Sie die Vertragsdaten.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [buildPdfData, pdfBlobUrl]);

  // Debounced preview regeneration
  useEffect(() => {
    if (!isOpen) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      regeneratePreview();
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // Begründung und Vertrag gehören dazu: ohne sie blieb die Begründung (§ 558a) im PDF auf dem alten Stand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contractData?.mietvertrag_id, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung, neueKaltmiete, neueBetriebskosten, begruendungsart, begruendungText]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  /** Meldet eine leere oder ungültige neue Miete, statt ein Schreiben mit 0 € zu liefern. */
  const pruefeNeueMiete = () => {
    const miete = neueMieteAusEingabe(neueKaltmiete, neueBetriebskosten, contractData?.current_kaltmiete);
    if ('fehler' in miete) {
      toast({ title: "Neue Miete unvollständig", description: miete.fehler, variant: "destructive" });
      return null;
    }
    if (!pdfBlob || pdfStand !== JSON.stringify(buildPdfData())) {
      toast({ title: "Vorschau wird noch erstellt", description: "Das Schreiben entspricht noch nicht den aktuellen Eingaben. Bitte einen Moment warten." });
      return null;
    }
    return miete;
  };

  const handleDownload = () => {
    if (!pdfBlob || !pruefeNeueMiete()) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mieterhoehung_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Download erfolgreich", description: "Das Mieterhöhungsschreiben wurde heruntergeladen." });
  };

  /**
   * Die einzige Stelle, die die Vertragsmiete schreibt — nur mit erfasster Zustimmung (§ 558b Abs. 1 BGB).
   * Seit 28.10.2026 führen zwei Wege hierher: Speichern mit gesetztem Haken und „Zustimmung zum Verlangen
   * erfassen“. In beiden ist wirksamIso das Wirksamwerden des Verlangens, nicht der Tag der Zustimmung.
   */
  const mieteNachZustimmungSetzen = async (
    mieterHatZugestimmt: boolean,
    miete: { kaltmiete: number; betriebskosten: number | null },
    wirksamIso: string
  ): Promise<{ message: string } | null> => {
    if (!contractData) return { message: 'Kein Vertrag gewählt.' };
    if (mieterHatZugestimmt) {
      const { data: geschrieben, error: mieteError } = await supabase.from('mietvertrag').update({
        kaltmiete: miete.kaltmiete,
        // Ohne Betriebskosten im Verlangen bleibt die Vorauszahlung, statt auf 0 € zu fallen (28.10.2026)
        ...(miete.betriebskosten !== null ? { betriebskosten: miete.betriebskosten } : {}),
        // Die Sperrfrist (§ 558 Abs. 1) zählt ab dem Wirksamwerden, nicht ab dem Tag der Zustimmung
        letzte_mieterhoehung_am: wirksamIso,
        aktualisiert_am: new Date().toISOString(),
      }).eq('id', contractData.mietvertrag_id).select('id');
      if (mieteError) return mieteError;
      // Keine Zeile getroffen ist kein Erfolg (Vertrag weg oder nicht änderbar)
      if (!geschrieben || geschrieben.length === 0) return { message: 'Der Vertrag wurde nicht gefunden oder ist nicht änderbar.' };
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
      queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
      queryClient.invalidateQueries({ queryKey: ['rent-increase-eligibility'] });
    }
    return null;
  };

  const handleSaveAndUpload = async () => {
    if (!contractData || !pdfBlob) return;
    if (mieterHatZugestimmt && verlangen) {
      toast({ title: "Offenes Verlangen", description: `Bitte „Zustimmung zum Verlangen vom ${verlangtAmText} erfassen“ nutzen.`, variant: "destructive" });
      return;
    }
    const neueMiete = pruefeNeueMiete();
    if (!neueMiete) return;
    // Offene Verlangen, die dieses Schreiben ersetzt — nur bekannt, wenn die Vorgänge geladen sind
    const zurueckzuziehen = erhoehungenGeladen === 'ok' ? offeneVerlangenIds(fruehereErhoehungen) : [];
    setIsSubmitting(true);
    try {
      // Pfad ohne Mieternamen: Supabase Storage lehnt Umlaute ab (InvalidKey),
      // die Mieterhöhung war für diese Mieter nicht speicherbar.
      const filePath = schriftstueckPfad('mieterhoehungen', contractData.mietvertrag_id, 'Mieterhoehung', new Date());

      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, uint8, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;

      // Ohne Vorgang kein Schreiben: Scheitert danach etwas, verschwinden Datei und Dokumentzeile wieder.
      // Bis zum 28.10.2026 blieben sie stehen — ein Verlangen in den Dokumenten, das es nie gab.
      let dokumentEingetragen = false;
      const zurueckrollen = async () => {
        if (dokumentEingetragen) await supabase.from('dokumente').delete().eq('pfad', filePath);
        await supabase.storage.from('dokumente').remove([filePath]);
      };

      // Ohne Zeile in dokumente ist die Datei in der App unsichtbar (bis 27.10.2026 ungeprüft)
      const { error: dokumentError } = await supabase.from('dokumente').insert({
        titel: `Mieterhöhung ${new Date().toLocaleDateString('de-DE')}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: contractData.mietvertrag_id,
      });
      if (dokumentError) await zurueckrollen();
      if (dokumentError) throw dokumentError;
      dokumentEingetragen = true;

      // Ohne Zustimmung bleibt die Vertragsmiete unverändert: Nach § 558 BGB
      // erhöht der Vermieter nicht einseitig, und selbst mit Zustimmung ist die
      // erhöhte Miete erst ab dem dritten Kalendermonat nach Zugang geschuldet
      // (§ 558b Abs. 1 BGB). Wer sie zu früh setzt, erzeugt Mahnungen gegen
      // Mieter, die korrekt zahlen — genau das passierte bis zum 06.09.2026.
      // Kalendertage lokal: toISOString() lag in deutscher Zeit einen Tag zu früh (27.10.2026)
      const jetzt = new Date();
      const heuteIso = format(jetzt, 'yyyy-MM-dd');
      const wirksamDatum = wirksamAb(jetzt);
      const wirksamIso = wirksamAbTag(jetzt);

      const { data: neuerVorgang, error: vorgangError } = await supabase.from('mieterhoehungen').insert({
        mietvertrag_id: contractData.mietvertrag_id,
        verlangt_am: heuteIso,
        wirksam_ab: wirksamIso,
        alte_kaltmiete: contractData.current_kaltmiete,
        alte_betriebskosten: contractData.current_betriebskosten,
        neue_kaltmiete: neueMiete.kaltmiete,
        neue_betriebskosten: neueMiete.betriebskosten,
        begruendungsart,
        begruendung_text: begruendungText.trim(),
        dokument_pfad: filePath,
        status: mieterHatZugestimmt ? 'wirksam' : 'verlangt',
        zugestimmt_am: mieterHatZugestimmt ? heuteIso : null,
      }).select('id').single();
      if (vorgangError) {
        await zurueckrollen();
        throw vorgangError;
      }
      queryClient.invalidateQueries({ queryKey: ['rent-increase-eligibility'] });

      // Das neue Schreiben ersetzt offene Verlangen (im Dialog angekündigt); nur solange sie noch offen sind
      let rueckzugFehlgeschlagen = false;
      if (zurueckzuziehen.length > 0) {
        const { error: rueckzugError } = await supabase.from('mieterhoehungen')
          .update({ status: 'zurueckgezogen', aktualisiert_am: new Date().toISOString() })
          .in('id', zurueckzuziehen)
          .eq('status', 'verlangt');
        rueckzugFehlgeschlagen = !!rueckzugError;
      }

      if (mieterHatZugestimmt) {
        const mieteError = await mieteNachZustimmungSetzen(mieterHatZugestimmt, neueMiete, wirksamIso);

        if (mieteError) {
          // Wie bei „Zustimmung erfassen“: der Vorgang wird wieder offen, damit die Zustimmung später
          // über das offene Verlangen nachgeholt werden kann — sonst stünde er für immer auf wirksam
          const { data: zurueck } = neuerVorgang
            ? await supabase.from('mieterhoehungen')
              .update({ status: 'verlangt', zugestimmt_am: null, aktualisiert_am: new Date().toISOString() })
              .eq('id', neuerVorgang.id)
              .eq('status', 'wirksam')
              .select('id')
            : { data: null };
          toast({
            title: "Schreiben gespeichert, Miete nicht geändert",
            description: zurueck && zurueck.length > 0
              ? `Die Vertragsmiete steht weiter auf dem alten Wert (${mieteError.message}). Das Verlangen ist offen — die Zustimmung bitte über „Zustimmung zum Verlangen erfassen“ nachholen.`
              : `Der Vorgang steht auf wirksam, die Vertragsmiete aber weiter auf dem alten Wert (${mieteError.message}). Bitte Vorgang und Miete am Vertrag prüfen.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Miete erhöht",
            description: erhoehungGiltSpaeter
              ? `Die Vertragsmiete steht jetzt auf ${neueMiete.kaltmiete.toFixed(2)} € kalt. Achtung: Geschuldet ist sie erst ab ${wirksamDatum.toLocaleDateString('de-DE')} — bis dahin kann das System zu viel Soll ausweisen.`
              : `Die Vertragsmiete steht jetzt auf ${neueMiete.kaltmiete.toFixed(2)} € kalt.`,
          });
        }
      } else if (rueckzugFehlgeschlagen) {
        toast({
          title: "Verlangen gespeichert, altes nicht zurückgezogen",
          description: "Das neue Verlangen ist gespeichert, das bisherige offene Verlangen steht aber weiter auf „verlangt“. Bitte den Vorgang prüfen.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erhöhungsverlangen gespeichert",
          description: `${zurueckzuziehen.length > 0 ? 'Das bisherige offene Verlangen ist zurückgezogen. ' : ''}Die Miete am Vertrag bleibt unverändert. Sobald der Mieter zustimmt, hier erneut öffnen und „Zustimmung erfassen“ wählen — frühestens geschuldet ist sie zum ${wirksamDatum.toLocaleDateString('de-DE')}.`,
        });
      }
      onClose();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message || "Speichern fehlgeschlagen.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Zustimmung zu einem offenen Verlangen (28.10.2026): derselbe Vorgang wird wirksam, kein neues
   * Schreiben, kein zweiter Vorgang. wirksam_ab bleibt das des Verlangens; die Vertragsmiete setzt
   * dieselbe Stelle wie beim Speichern mit Haken.
   *
   * Reihenfolge (Review 28.10.2026): erst der Vorgang, bedingt auf 'verlangt' — so übernimmt bei zwei
   * offenen Fenstern nur eine Zustimmung die Miete. Scheitert danach die Miete, wird der Vorgang bedingt
   * auf 'verlangt' zurückgesetzt, damit ein neuer Versuch möglich bleibt. Bei Fehler bleibt der Dialog offen.
   */
  const handleZustimmungErfassen = async () => {
    const vorgang = verlangen;
    if (!contractData || !vorgang?.wirksam_ab) return;
    const miete = mieteAusVerlangen(vorgang);
    if (!miete) {
      toast({ title: "Verlangen unvollständig", description: "Im gespeicherten Verlangen fehlt die neue Miete. Bitte den Vorgang prüfen.", variant: "destructive" });
      return;
    }
    const wirksamIso = vorgang.wirksam_ab.slice(0, 10);
    setIsSubmitting(true);
    try {
      const { data: geaendert, error: vorgangError } = await supabase.from('mieterhoehungen')
        .update({ status: 'wirksam', zugestimmt_am: format(new Date(), 'yyyy-MM-dd'), aktualisiert_am: new Date().toISOString() })
        .eq('id', vorgang.id)
        .eq('status', 'verlangt')
        .select('id');
      if (vorgangError) throw vorgangError;
      if (!geaendert || geaendert.length === 0) {
        throw new Error('Das Verlangen ist nicht mehr offen. Bitte den Dialog neu öffnen.');
      }

      const mieteError = await mieteNachZustimmungSetzen(true, miete, wirksamIso);
      if (mieteError) {
        const { data: zurueck, error: rueckError } = await supabase.from('mieterhoehungen')
          .update({ status: 'verlangt', zugestimmt_am: null, aktualisiert_am: new Date().toISOString() })
          .eq('id', vorgang.id)
          .eq('status', 'wirksam')
          .select('id');
        const zurueckgesetzt = !rueckError && !!zurueck && zurueck.length > 0;
        throw new Error(zurueckgesetzt
          ? `Die Vertragsmiete wurde nicht geändert (${mieteError.message}). Das Verlangen ist weiter offen — bitte erneut versuchen.`
          : `Die Vertragsmiete wurde nicht geändert (${mieteError.message}), der Vorgang steht aber auf „wirksam“. Bitte Vorgang und Miete am Vertrag prüfen.`);
      }
      queryClient.invalidateQueries({ queryKey: ['rent-increase-eligibility'] });

      const ab = new Date(`${wirksamIso}T00:00:00`).toLocaleDateString('de-DE');
      toast({
        title: "Zustimmung erfasst",
        description: verlangenGiltSpaeter
          ? `Die Vertragsmiete steht jetzt auf ${miete.kaltmiete.toFixed(2)} € kalt. Achtung: Geschuldet ist sie erst ab ${ab} — bis dahin kann das System zu viel Soll ausweisen.`
          : `Die Vertragsmiete steht jetzt auf ${miete.kaltmiete.toFixed(2)} € kalt, wirksam seit ${ab}.`,
      });
      onClose();
    } catch (err: unknown) {
      // Dialog bleibt offen: die Meldung muss gelesen werden, ein neuer Versuch bleibt möglich
      toast({ title: "Zustimmung nicht erfasst", description: err instanceof Error ? err.message : "Zustimmung konnte nicht erfasst werden.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!contractData) return null;

  const mieteEingabe = neueMieteAusEingabe(neueKaltmiete, neueBetriebskosten, contractData.current_kaltmiete);
  const currentTotal = contractData.current_kaltmiete + contractData.current_betriebskosten;
  const newTotal = (parseFloat(neueKaltmiete) || 0) + (parseFloat(neueBetriebskosten) || 0);
  const increase = newTotal - currentTotal;
  const increasePercent = currentTotal > 0 ? (increase / currentTotal) * 100 : 0;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-[95vw] w-[1200px] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <TrendingUp className="h-5 w-5 text-orange-600 shrink-0" />
                <span>Mieterhöhung erstellen</span>
                {istAngespannt ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Angespannter Markt · </span>Kappung {kappungsgrenze}%
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Normaler Markt · </span>Kappung {kappungsgrenze}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={!pdfBlob}
                  className="gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowConfirmSave(true)}
                  disabled={!pdfBlob || isSubmitting}
                  className="gap-1.5"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span className="hidden sm:inline">Speichern & Vertrag aktualisieren</span>
                  <span className="sm:hidden">Speichern</span>
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col md:flex-row flex-1 overflow-hidden border-t">
            {/* Left: Edit form */}
            <ScrollArea className="w-full md:w-[380px] md:shrink-0 border-b md:border-b-0 border-r-0 md:border-r">
              <div className="p-4 space-y-4">
                {/* Contract info */}
                <div className="p-3 bg-muted rounded-lg space-y-1 text-sm">
                  <p><span className="font-medium">Objekt:</span> {contractData.immobilie_name || 'N/A'}</p>
                  <p><span className="font-medium">Adresse:</span> {contractData.immobilie_adresse || 'N/A'}</p>
                  {contractData.mieter && contractData.mieter.length > 0 && (
                    <p><span className="font-medium">Mieter:</span> {contractData.mieter.map(m => `${m.vorname} ${m.nachname}`).join(', ')}</p>
                  )}
                </div>

                {verlangen?.wirksam_ab && (
                  <div className="space-y-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="font-medium">
                      Offenes Erhöhungsverlangen vom {verlangtAmText}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Kaltmiete {Number(verlangen.alte_kaltmiete ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} →{' '}
                      {Number(verlangen.neue_kaltmiete ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })},
                      wirksam ab {verlangenWirksamText}.
                      Hat der Mieter zugestimmt, hier erfassen — es entsteht kein neues Schreiben.
                      Ein neues Schreiben unten ersetzt dieses Verlangen; es wird dann als zurückgezogen markiert.
                    </p>
                    {mieteSeitVerlangenGeaendert(verlangen, contractData.current_kaltmiete, contractData.current_betriebskosten) && (
                      <p className="text-xs text-warning">
                        Kaltmiete oder Betriebskosten am Vertrag haben sich seit dem Verlangen geändert. Bitte prüfen, ob die Zustimmung noch passt.
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowConfirmZustimmung(true)}
                      disabled={isSubmitting}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Zustimmung zum Verlangen vom {verlangtAmText} erfassen
                    </Button>
                  </div>
                )}

                <Separator />

                {/* Recipient fields */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Empfänger</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Anrede</Label>
                      <Input value={anrede} onChange={(e) => setAnrede(e.target.value)} placeholder="Herr, Frau oder leer" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Einheit</Label>
                      <Input value={einheitBezeichnung} onChange={(e) => setEinheitBezeichnung(e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Straße</Label>
                    <Input value={mieterAdresse} onChange={(e) => setMieterAdresse(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">PLZ / Ort</Label>
                    <Input value={mieterPlzOrt} onChange={(e) => setMieterPlzOrt(e.target.value)} className="h-8 text-sm" />
                  </div>
                </div>

                <Separator />

                {/* Current rent (read-only) */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Aktuelle Miete</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-muted rounded text-center">
                      <p className="text-xs text-muted-foreground">Kaltmiete</p>
                      <p className="text-sm font-bold">{contractData.current_kaltmiete.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                    </div>
                    <div className="p-2 bg-muted rounded text-center">
                      <p className="text-xs text-muted-foreground">Betriebskosten</p>
                      <p className="text-sm font-bold">{contractData.current_betriebskosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {aktuellerVpi && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded px-2 py-1.5">
                    <Info className="h-3 w-3 shrink-0" />
                    <span>Aktueller VPI: <strong>{aktuellerVpi.wert}</strong> · Stand {new Date(aktuellerVpi.stichtag).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} · Basis 2020=100</span>
                  </div>
                )}

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Neue Miete</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Neue Kaltmiete (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={neueKaltmiete}
                        onChange={(e) => setNeueKaltmiete(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Neue BK (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={neueBetriebskosten}
                        onChange={(e) => setNeueBetriebskosten(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {'fehler' in mieteEingabe && (
                    <p className="text-xs text-destructive" role="alert">{mieteEingabe.fehler}</p>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      Begründung nach § 558a BGB <span className="text-destructive">*</span>
                    </Label>
                    <Select value={begruendungsart} onValueChange={(v) => setBegruendungsart(v as BegruendungsArt)}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(BEGRUENDUNGS_BEZEICHNUNG).map(([wert, text]) => (
                          <SelectItem key={wert} value={wert}>{text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={begruendungText}
                      onChange={(e) => setBegruendungText(e.target.value)}
                      placeholder={
                        begruendungsart === 'vergleichswohnungen'
                          ? 'Drei vergleichbare Wohnungen mit Anschrift, Lage, Größe und Miete benennen.'
                          : begruendungsart === 'mietspiegel'
                          ? 'Mietspiegel und Feld benennen, z. B. „Mietspiegel Sehnde 2025, Feld C3: 8,10–9,40 €/m²".'
                          : 'Fundstelle des Begründungsmittels angeben, die der Mieter nachprüfen kann.'
                      }
                      className="text-sm min-h-[72px]"
                    />
                    {!begruendungText.trim() && (
                      <p className="text-xs text-destructive">
                        Ohne Begründung ist das Erhöhungsverlangen formunwirksam — es wird kein Schreiben erzeugt.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 rounded border border-border p-2">
                    <label className={`flex items-start gap-2 ${verlangen ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={mieterHatZugestimmt}
                        onChange={(e) => setMieterHatZugestimmt(e.target.checked)}
                        disabled={!!verlangen}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="text-xs">
                        <span className="font-medium">Der Mieter hat der Erhöhung zugestimmt</span>
                        <span className="block text-muted-foreground">
                          Dann wird die Kaltmiete beim Speichern sofort im Vertrag geändert. Ohne Haken bleibt
                          sie stehen, bis die Zustimmung vorliegt.
                        </span>
                        {verlangen && (
                          <span className="block mt-1 text-warning">
                            Gesperrt, weil ein Verlangen offen ist: Bitte oben „Zustimmung zum Verlangen vom {verlangtAmText} erfassen“ nutzen.
                            Ein neues Schreiben ohne Haken zieht das offene Verlangen zurück.
                          </span>
                        )}
                      </span>
                    </label>
                    {mieterHatZugestimmt && erhoehungGiltSpaeter && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        Geschuldet ist die erhöhte Miete erst ab{' '}
                        <strong>{wirksamAbDatum.toLocaleDateString('de-DE')}</strong> (§ 558b Abs. 1 BGB).
                        Wenn Sie jetzt ändern, weist das System bis dahin ein zu hohes Soll aus — der Mieter
                        erscheint als säumig und wird gemahnt.
                      </p>
                    )}
                  </div>

                  {/* Kappungsgrenze Hinweis */}
                  <div className={`p-2 rounded text-xs ${ueberKappung ? 'bg-destructive/10 border border-destructive/30 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                    <p className="font-medium">
                      Kappungsgrenze: {kappungsgrenze}% in 36 Monaten
                      {istAngespannt && ' (angespannter Markt)'}
                    </p>
                    <p>
                      Max. Kaltmiete: {maxKaltmiete.toFixed(2)} € | Erhöhung: {erhoehungProzent.toFixed(1)}%
                      {ueberKappung && ' — Überschreitung!'}
                      {erhoehungenGeladen === 'fehler' ? (
                        <span className="block mt-1">
                          Frühere Mieterhöhungen ließen sich nicht laden; gerechnet wird mit der heutigen Miete. Die Kappungsgrenze gilt für die Miete von vor drei Jahren — bitte die damalige Miete prüfen.
                        </span>
                      ) : erhoehungenGeladen === 'laedt' ? (
                        <span className="block mt-1">Frühere Mieterhöhungen werden geladen …</span>
                      ) : !basis.sicher && (
                        <span className="block mt-1">
                          Die Miete wurde in den letzten drei Jahren schon erhöht; die Kappungsgrenze gilt für die Miete von vor drei Jahren. Bitte die damalige Miete prüfen.
                        </span>
                      )}
                      {angespanntUnbekannt && (
                        <span className="block mt-1">Ob ein angespannter Markt vorliegt, ließ sich nicht prüfen — gerechnet wird mit der strengeren Grenze von 15 %.</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Summary */}
                <div className="p-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span>Aktuelle Gesamtmiete:</span>
                    <span>{currentTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Neue Gesamtmiete:</span>
                    <span>{newTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                  </div>
                  <Separator className="bg-orange-200" />
                  <div className="flex justify-between font-bold">
                    <span>Erhöhung:</span>
                    <span className={increase >= 0 ? 'text-orange-600' : 'text-destructive'}>
                      {increase >= 0 ? '+' : ''}{increase.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                      {' '}({increasePercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>

                {/* Legal info */}
                <div className="p-2 rounded-lg border text-xs text-muted-foreground space-y-1">
                  <p className="font-medium">Hinweise:</p>
                  {/* § 558 Abs. 1 BGB (28.10.2026): verlangt werden darf nach 12 Monaten, die 15 Monate gelten zum Wirksamwerden */}
                  <p>• Geschuldet ab Beginn des dritten Monats nach Zugang (§ 558b Abs. 1 BGB)</p>
                  <p>• Verlangen frühestens 12 Monate nach Einzug bzw. letzter Erhöhung (§ 558 Abs. 1 Satz 2 BGB)</p>
                  <p>• Beim Wirksamwerden muss die Miete seit 15 Monaten unverändert sein (§ 558 Abs. 1 Satz 1 BGB)</p>
                </div>
              </div>
            </ScrollArea>

            {/* Right: PDF Preview */}
            <div className="hidden md:flex flex-1 bg-muted/50 p-4 flex-col min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Live-Vorschau</span>
                {isGeneratingPreview && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex-1 rounded-lg overflow-hidden shadow-lg bg-background">
                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    title="Mieterhöhungsschreiben Vorschau"
                    className="w-full h-full min-h-[500px]"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full min-h-[500px]">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zustimmung zu einem offenen Verlangen */}
      <AlertDialog open={showConfirmZustimmung} onOpenChange={setShowConfirmZustimmung}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zustimmung des Mieters erfassen?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Verlangen vom {verlangtAmText} wird wirksam, es entsteht kein neues Schreiben.{' '}
              {verlangenMiete && (
                <>
                  Die Vertragsmiete wird {verlangenGiltSpaeter ? 'sofort ' : ''}auf{' '}
                  {verlangenMiete.kaltmiete.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} kalt
                  {verlangenMiete.betriebskosten !== null && ` und ${verlangenMiete.betriebskosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} Betriebskosten`} gesetzt
                  {verlangenGiltSpaeter && contractData ? (
                    <>
                      , wirksam ist die Erhöhung erst ab {verlangenWirksamText}. Bis dahin ist die Monatsforderung um{' '}
                      {mehrforderungProMonat(verlangenMiete, contractData.current_kaltmiete, contractData.current_betriebskosten)
                        .toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} zu hoch.
                    </>
                  ) : '.'}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleZustimmungErfassen}>
              Ja, Zustimmung erfassen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm save dialog */}
      <AlertDialog open={showConfirmSave} onOpenChange={setShowConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mieterhöhung speichern?</AlertDialogTitle>
            <AlertDialogDescription>
              Das PDF wird in den Dokumenten gespeichert.{' '}
              {mieterHatZugestimmt
                ? 'Die Vertragsmiete wird auf die neuen Werte aktualisiert.'
                : 'Die Vertragsmiete bleibt unverändert, bis die Zustimmung erfasst ist.'}
              {verlangen && ` Das offene Verlangen vom ${verlangtAmText} wird danach als zurückgezogen markiert.`}
              {' '}Haben Sie die PDF-Vorschau geprüft?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveAndUpload}>
              Ja, speichern & aktualisieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
