import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from '@tanstack/react-query';
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
import { Loader2, AlertTriangle, Download, Mail, Send, ArrowLeft, FileText, Eye, RefreshCw, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generateMahnungPdf, type MahnungPdfData } from "@/utils/mahnungPdfGenerator";
import { berechneAlleVerzugszinsen, berechneVerzugsbeginn, getVerzugszinssatz, toLocalIso } from "@/utils/verzugszinsen";
import { useBasiszinsPerioden } from "@/hooks/useBasiszinsPerioden";

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
    mieter?: Array<{
      vorname: string;
      nachname: string;
      hauptmail: string | null;
      telnr: string | null;
    }>;
  } | null;
  rueckstand?: number;
}

export function MahnungErstellungModal({
  isOpen,
  onClose,
  contractData,
  rueckstand = 0
}: MahnungErstellungModalProps) {
  const { toast } = useToast();
  const { perioden, fromDB } = useBasiszinsPerioden();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [step, setStep] = useState<'edit' | 'email'>('edit');
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Email fields
  const [emailRecipient, setEmailRecipient] = useState<string>('');
  const [emailCc, setEmailCc] = useState<string>('');

  // Mahnung data
  const mahnstufe = (contractData?.mahnstufe || 0) + 1;
  const [anrede, setAnrede] = useState<string>("Herr");
  const [mieterAdresse, setMieterAdresse] = useState<string>("");
  const [mieterPlzOrt, setMieterPlzOrt] = useState<string>("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState<string>("");
  const [gesamtRueckstand, setGesamtRueckstand] = useState<string>("0.00");
  const [anzahlMonatsmieten, setAnzahlMonatsmieten] = useState<string>("1");
  
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
      setPdfPath(null);
      setGesamtRueckstand(rueckstand.toFixed(2));
      setEmailCc('');
      
      const firstMieter = contractData.mieter?.[0];
      setEmailRecipient(firstMieter?.hauptmail || '');
      setAnrede(firstMieter ? "Herr" : "Herr");
      setMieterAdresse(contractData.immobilie_adresse?.split(',')[0]?.trim() || '');
      setMieterPlzOrt(contractData.immobilie_adresse?.includes(',') 
        ? contractData.immobilie_adresse.split(',').slice(1).join(',').trim() 
        : '');
      setEinheitBezeichnung("WE");
      
      const monatsmiete = (contractData.current_kaltmiete || 0) + (contractData.current_betriebskosten || 0);
      const monate = monatsmiete > 0 ? Math.ceil(rueckstand / monatsmiete) : 1;
      setAnzahlMonatsmieten(String(Math.max(1, monate)));
      
      setMahnkostenProSchreiben("11.00");
      setAnzahlMahnschreiben(String(Math.max(1, contractData.mahnstufe || 1)));
      setMahnkostenGesamt((11 * Math.max(1, contractData.mahnstufe || 1)).toFixed(2));
      
      setVerzugszinsenGesamt("0.00");
      setVerzugszinsenDetails([]);
      setZahlungsfristTage("7");
      setRaeumungsfristTage("14");
      setUebergabeDatum("");
      setUseFreitext(false);
      setFreitext("");
    }
  }, [isOpen, contractData, rueckstand]);

  // Recalculate Mahnkosten when sub-values change
  useEffect(() => {
    const preis = parseFloat(mahnkostenProSchreiben) || 0;
    const anzahl = parseInt(anzahlMahnschreiben) || 0;
    setMahnkostenGesamt((preis * anzahl).toFixed(2));
  }, [mahnkostenProSchreiben, anzahlMahnschreiben]);

  // Generate the standard Mahnungstext for the current Mahnstufe
  const buildStandardText = useCallback((): string => {
    const rueckstandFormatted = (parseFloat(gesamtRueckstand) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const vertragStart = contractData?.start_datum
      ? new Date(contractData.start_datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';

    if (mahnstufe >= 3) {
      return `Sie haben seit Beginn des Mietverhältnisses am ${vertragStart} Ihre Mietzahlungen wiederholt verspätet und unregelmäßig erbracht. Trotz meiner Mahnung sind die Mietrückstände nicht ausgeglichen worden.\nDer Mietrückstand beläuft sich inzwischen auf ${anzahlMonatsmieten} Monatsmieten in Höhe von insgesamt ${rueckstandFormatted} €. Damit befinden Sie sich im erheblichen Zahlungsverzug im Sinne der §§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB.`;
    } else if (mahnstufe === 2) {
      return `trotz unserer ersten Mahnung sind die folgenden Zahlungen weiterhin nicht bei uns eingegangen. Wir fordern Sie hiermit erneut zur Zahlung auf.\nDer Mietrückstand beläuft sich auf insgesamt ${rueckstandFormatted} €.`;
    } else {
      return `wir möchten Sie darauf hinweisen, dass folgende Mietzahlungen noch nicht bei uns eingegangen sind:\nDer Mietrückstand beläuft sich auf insgesamt ${rueckstandFormatted} €.`;
    }
  }, [contractData, mahnstufe, gesamtRueckstand, anzahlMonatsmieten]);

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
    
    const raeumungsfrist = new Date();
    raeumungsfrist.setDate(raeumungsfrist.getDate() + (parseInt(raeumungsfristTage) || 14));
    const raeumungsfristStr = raeumungsfrist.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    const vertragStart = contractData.start_datum 
      ? new Date(contractData.start_datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';

    return {
      anrede,
      mieterName: firstName,
      mieterNachname: nachname,
      mieterAdresse,
      mieterPlzOrt,
      einheitBezeichnung,
      immobilieAdresse: contractData.immobilie_adresse || '',
      vertragStart,
      mahnstufe,
      datum: datumStr,
      offeneForderungen: [],
      gesamtRueckstand: parseFloat(gesamtRueckstand) || 0,
      anzahlMonatsmieten: parseInt(anzahlMonatsmieten) || 1,
      verzugszinsenDetails,
      verzugszinsenGesamt: parseFloat(verzugszinsenGesamt) || 0,
      mahnkostenProSchreiben: parseFloat(mahnkostenProSchreiben) || 0,
      anzahlMahnschreiben: parseInt(anzahlMahnschreiben) || 0,
      mahnkostenGesamt: parseFloat(mahnkostenGesamt) || 0,
      zahlungsfristDatum: zahlungsfristStr,
      raeumungsfristDatum: raeumungsfristStr,
      uebergabeDatum: uebergabeDatum
        ? new Date(uebergabeDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : undefined,
      freitext: useFreitext ? freitext : undefined,
    };
  }, [contractData, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung,
      gesamtRueckstand, anzahlMonatsmieten, verzugszinsenDetails, verzugszinsenGesamt,
      mahnkostenProSchreiben, anzahlMahnschreiben, mahnkostenGesamt,
      zahlungsfristTage, raeumungsfristTage, uebergabeDatum, mahnstufe, useFreitext, freitext]);

  // Generate PDF preview with debounce
  const regeneratePreview = useCallback(async () => {
    const pdfData = buildPdfData();
    if (!pdfData) return;
    
    setIsGeneratingPreview(true);
    try {
      const blob = await generateMahnungPdf(pdfData);
      setPdfBlob(blob);
      
      // Revoke old URL
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
    } catch (err) {
      console.error('Mahnungs-Vorschau konnte nicht erzeugt werden:', err);
      toast({
        title: "Vorschau nicht moeglich",
        description: "Das Mahnungs-PDF konnte nicht erzeugt werden. Bitte pruefen Sie die Vertragsdaten.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [buildPdfData, pdfBlobUrl]);

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
  }, [isOpen, step, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung,
      gesamtRueckstand, anzahlMonatsmieten, verzugszinsenGesamt,
      mahnkostenProSchreiben, anzahlMahnschreiben, mahnkostenGesamt,
      zahlungsfristTage, raeumungsfristTage, uebergabeDatum, useFreitext, freitext, verzugszinsenDetails]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  const handleSaveAndUpload = async () => {
    if (!contractData || !pdfBlob) return;
    
    setIsSubmitting(true);
    try {
      const mieterList = contractData.mieter || [];
      const vorname = mieterList[0]?.vorname || 'Mieter';
      const nachname = mieterList[0]?.nachname || '';
      const datum = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
      const fileName = `Mahnung_Stufe${mahnstufe}_${vorname}_${nachname}_${datum}.pdf`;
      const filePath = `mahnungen/${contractData.mietvertrag_id}/${fileName}`;
      
      // Upload PDF blob to storage
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      
      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, uint8, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        throw new Error('Upload fehlgeschlagen: ' + uploadError.message);
      }
      
      // Save document reference
      const mahnungTitle = mahnstufe === 1 ? '1. Zahlungserinnerung' : 
                           mahnstufe === 2 ? '2. Mahnung' : 
                           `${mahnstufe}. Mahnung / Letzte Zahlungsaufforderung`;
      
      await supabase.from('dokumente').insert({
        titel: `${mahnungTitle} ${new Date().toLocaleDateString('de-DE')}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: contractData.mietvertrag_id,
      });
      
      setPdfPath(filePath);
      
      toast({
        title: "Mahnung erstellt",
        description: "Das Mahnungsschreiben wurde gespeichert und kann jetzt versendet werden.",
      });
      
      setStep('email');
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
    if (!contractData || !emailRecipient) return;

    setIsSendingEmail(true);
    try {
      const recipientName = contractData.mieter?.map(m => `${m.vorname} ${m.nachname}`).join(' & ') || 'Mieter';
      const ccEmails = emailCc ? emailCc.split(',').map(e => e.trim()).filter(Boolean) : [];

      const { error } = await supabase.functions.invoke('send-mahnung', {
        body: {
          recipientEmail: emailRecipient,
          recipientName,
          ccEmails,
          mahnstufe,
          gesamtbetrag: (parseFloat(gesamtRueckstand) || 0) + (parseFloat(mahnkostenGesamt) || 0) + (parseFloat(verzugszinsenGesamt) || 0),
          rueckstandBetrag: parseFloat(gesamtRueckstand) || 0,
          mahngebuehren: parseFloat(mahnkostenGesamt) || 0,
          verzugszinsen: parseFloat(verzugszinsenGesamt) || 0,
          zusaetzlicheKosten: 0,
          zahlungsfristTage: parseInt(zahlungsfristTage),
          immobilieName: contractData.immobilie_name || 'N/A',
          immobilieAdresse: contractData.immobilie_adresse || 'N/A',
          pdfPath: pdfPath || '',
          mietvertragId: contractData.mietvertrag_id,
        }
      });

      if (error) throw error;

      // Ab Stufe 3 enthaelt das Schreiben eine fristlose Kuendigung nach
      // §§ 543 Abs. 2 Nr. 3, 569 Abs. 3 Nr. 1 BGB. Bis zum 06.09.2026 blieb der
      // Vertrag danach 'aktiv': Die Sollstellung lief weiter, das Dashboard
      // zaehlte die Einheit als vermietet, und keine Auswertung kannte den
      // Vorgang. Wer kuendigt, muss den Vertrag auch beenden.
      if (mahnstufe >= 3) {
        const heuteIso = new Date().toISOString().split('T')[0];
        const raeumungsfrist = new Date();
        raeumungsfrist.setDate(raeumungsfrist.getDate() + (parseInt(raeumungsfristTage) || 14));
        const raeumung = raeumungsfrist.toISOString().split('T')[0];
        const { error: statusError } = await supabase
          .from('mietvertrag')
          .update({
            status: 'gekuendigt',
            kuendigungsdatum: heuteIso,
            // ende_datum ist die fuehrende Quelle des Vertragsendes
            // (utils/contractUtils.ts) und muss deshalb mitgeschrieben werden.
            ende_datum: raeumung,
            aktualisiert_am: new Date().toISOString(),
          })
          .eq('id', contractData.mietvertrag_id);

        if (statusError) {
          toast({
            title: "Mahnung versendet, Vertragsstatus nicht gesetzt",
            description: `Das Kuendigungsschreiben ist raus, der Vertrag steht aber weiter auf aktiv: ${statusError.message}. Bitte den Status von Hand auf "gekuendigt" setzen.`,
            variant: "destructive",
          });
        } else {
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', contractData.mietvertrag_id] });
          queryClient.invalidateQueries({ queryKey: ['rueckstaende'] });
        }
      }

      toast({
        title: "E-Mail versendet",
        description: mahnstufe >= 3
          ? `Mahnung Stufe ${mahnstufe} mit fristloser Kündigung wurde an ${emailRecipient} versendet. Der Vertrag steht jetzt auf "gekündigt".`
          : `Mahnung Stufe ${mahnstufe} wurde an ${emailRecipient} versendet.`,
      });
      onClose();
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : 'E-Mail konnte nicht versendet werden',
        variant: "destructive",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const autoBerechneVerzugszinsen = useCallback(() => {
    const parsedBetrag = parseFloat(gesamtRueckstand) || 0;
    const monate = parseInt(anzahlMonatsmieten) || 1;
    const monatsBetrag = parsedBetrag / monate;
    const heute = new Date();

    // Verzugsbeginn: 4. Werktag des Folgemonats (§ 556b Abs. 1 BGB)
    const posten: Array<{ betrag: number; faelligAb: string }> = [];
    for (let i = 0; i < monate; i++) {
      // Faelligkeitsmonat: monate - i Monate zurueck (Miete fuer diesen Monat war faellig)
      const faelligkeitsMonat = new Date(heute.getFullYear(), heute.getMonth() - (monate - i), 1);
      const verzugsbeginn = berechneVerzugsbeginn(faelligkeitsMonat);
      posten.push({ betrag: monatsBetrag, faelligAb: toLocalIso(verzugsbeginn) });
    }

    const ergebnis = berechneAlleVerzugszinsen(posten, heute, perioden);

    setVerzugszinsenDetails(ergebnis.details.map(d => ({
      monat: `${d.monat} (${d.tage} Tage, ${d.verzugszinssatz.toFixed(2)}%)`,
      betrag: d.zinsbetrag,
    })));
    setVerzugszinsenGesamt(ergebnis.gesamt.toFixed(2));
  }, [gesamtRueckstand, anzahlMonatsmieten, perioden]);

  // Verzugszinsen automatisch berechnen wenn Modal öffnet oder Rückstand/Monate ändern
  useEffect(() => {
    if (!isOpen || parseFloat(gesamtRueckstand) <= 0) return;
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

  const parsedRueckstand = parseFloat(gesamtRueckstand) || 0;
  const parsedMahnkosten = parseFloat(mahnkostenGesamt) || 0;
  const parsedVerzugszinsen = parseFloat(verzugszinsenGesamt) || 0;
  const gesamtkosten = parsedRueckstand + parsedMahnkosten + parsedVerzugszinsen;

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
                  disabled={isSubmitting || parsedRueckstand <= 0}
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
                          onChange={(e) => setAnzahlMonatsmieten(e.target.value)} 
                          className="mt-1 h-9"
                        />
                      </div>
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
                        disabled={parseFloat(gesamtRueckstand) <= 0}
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
                  </div>

                  <Separator />

                  {/* Fristen */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fristen</h3>
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
          /* EMAIL STEP */
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b bg-background flex-shrink-0">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-destructive" />
                <h2 className="text-lg font-semibold">Mahnung per E-Mail versenden</h2>
                <Badge variant="outline" className={getMahnstufeColor(mahnstufe)}>
                  Stufe {mahnstufe}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mr-6">
                <Button variant="outline" size="sm" onClick={() => setStep('edit')}>
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Zurück
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => setShowConfirmSend(true)} 
                  disabled={isSendingEmail || !emailRecipient}
                  variant="destructive"
                >
                  {isSendingEmail ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Senden...</>
                  ) : (
                    <><Send className="h-4 w-4 mr-1.5" />Mahnung versenden</>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Email settings */}
              <div className="w-full md:w-[420px] md:flex-shrink-0 border-b md:border-b-0 border-r-0 md:border-r p-5 space-y-5 overflow-auto">
                <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1.5">
                  <p><span className="text-muted-foreground">Objekt:</span> {contractData.immobilie_name}</p>
                  <p>
                    <span className="text-muted-foreground">Gesamtbetrag:</span>{' '}
                    <span className="font-bold text-destructive">
                      {gesamtkosten.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </span>
                  </p>
                  <p><span className="text-muted-foreground">PDF:</span> ✅ wird als Anhang versendet</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label>Empfänger E-Mail *</Label>
                    <Input
                      type="email"
                      value={emailRecipient}
                      onChange={(e) => setEmailRecipient(e.target.value)}
                      placeholder="mieter@beispiel.de"
                      className="mt-1"
                    />
                    {contractData.mieter && contractData.mieter.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {contractData.mieter.map(m => `${m.vorname} ${m.nachname}`).join(', ')}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>CC (optional, kommagetrennt)</Label>
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
                    Die Mahnung wird direkt an den Mieter versendet. Bitte überprüfen Sie die E-Mail-Adresse.
                  </AlertDescription>
                </Alert>
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
              Mahnung Stufe {mahnstufe} wird gespeichert und als Dokument zum Mietvertrag abgelegt. Fortfahren?
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
                  ({raeumungsfristTage} Tage) datiert. Der Versand an {emailRecipient} kann nicht
                  rückgängig gemacht werden.
                </>
              ) : (
                <>Die Mahnung wird an {emailRecipient} versendet. Dies kann nicht rückgängig gemacht werden.</>
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
    </Dialog>
  );
}
