import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, Download, FileText, Eye, RefreshCw, Upload, X, Calendar, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { generateKuendigungPdf, type KuendigungPdfData, type KuendigungsTyp } from "@/utils/kuendigungPdfGenerator";
import { terminationWebhookService } from "@/services/terminationWebhookService";
import { DocumentDragDropZone } from "../DocumentDragDropZone";
import { Progress } from "@/components/ui/progress";

interface TerminationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vertragId: string;
  einheit?: {
    id: string;
    nummer?: string;
    etage?: string;
  };
  immobilie?: {
    name: string;
    adresse: string;
  };
  onTerminationSuccess?: () => void;
}

interface MieterInfo {
  vorname: string;
  nachname: string;
  hauptmail?: string | null;
}

export const TerminationDialog = ({
  isOpen,
  onClose,
  vertragId,
  einheit,
  immobilie,
  onTerminationSuccess
}: TerminationDialogProps) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("manual");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetched contract data
  const [mieterList, setMieterList] = useState<MieterInfo[]>([]);
  const [startDatum, setStartDatum] = useState<string | null>(null);

  // ====== Manual Tab State ======
  const [kuendigungstyp, setKuendigungstyp] = useState<KuendigungsTyp>("ordentlich");
  const [kuendigungsdatum, setKuendigungsdatum] = useState("");
  const [auszugsdatum, setAuszugsdatum] = useState("");
  const [kuendigungsgrund, setKuendigungsgrund] = useState("");
  const [bemerkungen, setBemerkungen] = useState("");
  const [anrede, setAnrede] = useState("Herr");
  const [mieterAdresse, setMieterAdresse] = useState("");
  const [mieterPlzOrt, setMieterPlzOrt] = useState("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState("");
  const [useFreitext, setUseFreitext] = useState(false);
  const [freitext, setFreitext] = useState("");

  // PDF preview
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ====== Upload Tab State ======
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadKuendigungsdatum, setUploadKuendigungsdatum] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch contract + mieter data on open
  useEffect(() => {
    if (!isOpen || !vertragId) return;

    const fetchData = async () => {
      try {
        // Fetch contract
        const { data: vertrag } = await supabase
          .from('mietvertrag')
          .select('start_datum')
          .eq('id', vertragId)
          .single();

        setStartDatum(vertrag?.start_datum || null);

        // Fetch mieter
        const { data: mieterLinks } = await supabase
          .from('mietvertrag_mieter')
          .select('mieter_id, mieter:mieter_id(vorname, nachname, hauptmail)')
          .eq('mietvertrag_id', vertragId);

        const mieter: MieterInfo[] = (mieterLinks || []).map((link: any) => ({
          vorname: link.mieter?.vorname || '',
          nachname: link.mieter?.nachname || '',
          hauptmail: link.mieter?.hauptmail || null,
        }));
        setMieterList(mieter);
      } catch (err) {
        console.error('Mieterliste zum Vertrag konnte nicht geladen werden:', err);
        toast({
          title: "Mieterdaten nicht geladen",
          description: "Die Mieter zu diesem Vertrag konnten nicht geladen werden. Bitte Dialog erneut oeffnen.",
          variant: "destructive",
        });
      }
    };

    fetchData();
  }, [isOpen, vertragId]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab("manual");
      setShowConfirm(false);
      setShowUploadConfirm(false);
      setKuendigungstyp("ordentlich");
      setKuendigungsdatum("");
      setAuszugsdatum("");
      setKuendigungsgrund("");
      setBemerkungen("");
      setUseFreitext(false);
      setFreitext("");
      setSelectedFile(null);
      setUploadKuendigungsdatum("");
      setUploadProgress(0);

      setAnrede("Herr");
      setMieterAdresse(immobilie?.adresse?.split(',')[0]?.trim() || '');
      setMieterPlzOrt(immobilie?.adresse?.includes(',')
        ? immobilie.adresse.split(',').slice(1).join(',').trim()
        : '');
      setEinheitBezeichnung(einheit?.nummer ? `WE ${einheit.nummer}` : 'WE');
    }
  }, [isOpen, immobilie, einheit]);

  // Build PDF data
  const buildPdfData = useCallback((): KuendigungPdfData | null => {
    const fullName = mieterList.map(m => `${m.vorname} ${m.nachname}`).join(' & ');
    const nachname = mieterList[0]?.nachname || '';
    const heute = new Date();
    const datumStr = heute.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const vertragStart = startDatum
      ? new Date(startDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';

    const kuendigungFormatted = kuendigungsdatum
      ? new Date(kuendigungsdatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'TT.MM.JJJJ';

    const auszugFormatted = auszugsdatum
      ? new Date(auszugsdatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : kuendigungFormatted;

    return {
      anrede,
      mieterName: fullName || 'Mieter',
      mieterNachname: nachname,
      mieterAdresse,
      mieterPlzOrt,
      einheitBezeichnung,
      immobilieAdresse: immobilie?.adresse || '',
      vertragStart,
      kuendigungsdatum: kuendigungFormatted,
      kuendigungsgrund,
      kuendigungstyp,
      datum: datumStr,
      auszugsdatum: auszugFormatted,
      freitext: useFreitext ? freitext : undefined,
      bemerkungen: bemerkungen || undefined,
    };
  }, [mieterList, startDatum, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung,
    immobilie, kuendigungsdatum, auszugsdatum, kuendigungsgrund, kuendigungstyp, bemerkungen,
    useFreitext, freitext]);

  // Generate PDF preview
  const regeneratePreview = useCallback(async () => {
    const pdfData = buildPdfData();
    if (!pdfData) return;
    setIsGeneratingPreview(true);
    try {
      const blob = await generateKuendigungPdf(pdfData);
      setPdfBlob(blob);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('Kuendigungs-Vorschau konnte nicht erzeugt werden:', err);
      toast({
        title: "Vorschau nicht moeglich",
        description: "Das Kuendigungsschreiben konnte nicht erzeugt werden. Bitte pruefen Sie die Vertragsdaten.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [buildPdfData, pdfBlobUrl]);

  // Debounced preview
  useEffect(() => {
    if (!isOpen || activeTab !== 'manual') return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      regeneratePreview();
    }, 500);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [isOpen, activeTab, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung,
    kuendigungsdatum, auszugsdatum, kuendigungsgrund, kuendigungstyp, bemerkungen, useFreitext, freitext, mieterList, startDatum]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  const handleDownload = () => {
    if (!pdfBlobUrl) return;
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `Kuendigung_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ====== MANUAL: Save PDF + terminate ======
  const handleManualTermination = async () => {
    if (!kuendigungsdatum) {
      toast({ title: "Fehler", description: "Bitte Kündigungsdatum angeben", variant: "destructive" });
      return;
    }
    if (!pdfBlob) {
      toast({ title: "Fehler", description: "PDF konnte nicht erstellt werden", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const vorname = mieterList[0]?.vorname || 'Mieter';
      const nachname = mieterList[0]?.nachname || '';
      const datum = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
      const fileName = `Kuendigung_${vorname}_${nachname}_${datum}.pdf`;
      const filePath = `kuendigungen/${vertragId}/${fileName}`;

      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, uint8, { contentType: 'application/pdf', upsert: true });

      if (uploadError) throw new Error('Upload fehlgeschlagen: ' + uploadError.message);

      const { error: updateError } = await supabase
        .from('mietvertrag')
        .update({
          status: 'gekuendigt',
          kuendigungsdatum,
          // ende_datum ist die fuehrende Quelle des Vertragsendes
          // (utils/contractUtils.ts getVertragsende). Der Upload-Weg unten
          // schrieb es immer mit, dieser Weg nicht -- damit standen Karte und
          // Vertragsdetails wieder auf verschiedenen Aussagen, und jede
          // Auswertung ueber ende_datum uebersah manuell gekuendigte Vertraege.
          ende_datum: kuendigungsdatum,
          aktualisiert_am: new Date().toISOString()
        })
        .eq('id', vertragId);

      if (updateError) throw new Error('Vertragsaktualisierung fehlgeschlagen: ' + updateError.message);

      const kuendigungsdatumFormatted = new Date(kuendigungsdatum + 'T12:00:00').toLocaleDateString('de-DE');
      await supabase.from('dokumente').insert({
        titel: `Kündigungsschreiben ${kuendigungsdatumFormatted}`,
        pfad: filePath,
        kategorie: 'Kündigung',
        dateityp: 'application/pdf',
        mietvertrag_id: vertragId,
        hochgeladen_am: new Date(kuendigungsdatum + 'T12:00:00').toISOString(),
      });

      try {
        await terminationWebhookService.notifyTermination({
          vertragId, kuendigungsdatum, grund: kuendigungsgrund, bemerkungen, method: 'manual'
        });
      } catch { /* silent */ }

      toast({ title: "Erfolg", description: "Mietvertrag wurde gekündigt und das Kündigungsschreiben gespeichert." });
      onClose();
      onTerminationSuccess?.();
    } catch (error) {
      toast({
        title: "Fehler",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ====== UPLOAD TAB ======
  const validateAndSetFile = (file: File) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Ungültiger Dateityp", description: "PDF, JPG oder PNG erlaubt", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Datei zu groß", description: "Max. 10MB", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
  };

  const handleUploadTermination = async () => {
    if (!uploadKuendigungsdatum || !selectedFile) {
      toast({ title: "Fehler", description: "Bitte Kündigungsdatum und Dokument angeben.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    try {
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 80));
      }, 100);

      const fileExtension = selectedFile.name.split('.').pop();
      const fileName = `kuendigung_${vertragId}_${Date.now()}.${fileExtension}`;
      const { data: uploadData, error: storageError } = await supabase.storage
        .from('dokumente')
        .upload(fileName, selectedFile, { cacheControl: '3600', upsert: false });

      if (storageError) throw new Error('Upload fehlgeschlagen: ' + storageError.message);
      setUploadProgress(90);

      const { error: updateError } = await supabase
        .from('mietvertrag')
        .update({ status: 'gekuendigt', kuendigungsdatum: uploadKuendigungsdatum, ende_datum: uploadKuendigungsdatum, aktualisiert_am: new Date().toISOString() })
        .eq('id', vertragId);

      if (updateError) throw new Error('Vertragsaktualisierung fehlgeschlagen: ' + updateError.message);

      await supabase.from('dokumente').insert({
        mietvertrag_id: vertragId,
        kategorie: 'Kündigung',
        titel: `Kündigungsschreiben - ${selectedFile.name}`,
        pfad: uploadData.path,
        dateityp: selectedFile.type,
        groesse_bytes: selectedFile.size,
        erstellt_von: 'Upload',
        hochgeladen_am: new Date(uploadKuendigungsdatum + 'T12:00:00').toISOString()
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      try {
        await terminationWebhookService.notifyTermination({
          vertragId, kuendigungsdatum: uploadKuendigungsdatum, documentPath: uploadData.path,
          fileName: selectedFile.name, method: 'document_upload'
        });
      } catch { /* silent */ }

      toast({ title: "Erfolg", description: "Kündigung eingereicht und Dokument hochgeladen." });
      onClose();
      onTerminationSuccess?.();
    } catch (error) {
      toast({
        title: "Fehler",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
        variant: "destructive",
      });
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-[95vw] w-[1400px] max-h-[95vh] h-[90vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b bg-background flex-shrink-0">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-destructive" />
              <h2 className="text-lg font-semibold">Mietvertrag kündigen</h2>
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                Kündigung
              </Badge>
            </div>
            {einheit && (
              <p className="text-sm text-muted-foreground mr-8">
                {immobilie?.name} – {einheitBezeichnung}
                {einheit.etage && ` (${einheit.etage})`}
              </p>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
            <div className="px-6 pt-2 border-b flex-shrink-0">
              <TabsList className="grid w-full sm:w-[400px] grid-cols-2">
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  PDF erstellen & kündigen
                </TabsTrigger>
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Dokument hochladen
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ========== MANUAL TAB: Split-Screen ========== */}
            <TabsContent value="manual" className="flex-1 overflow-hidden m-0">
              <div className="flex flex-col md:flex-row h-full overflow-hidden">
                {/* LEFT: Form */}
                <ScrollArea className="w-full md:w-[420px] md:flex-shrink-0 border-b md:border-b-0 border-r-0 md:border-r">
                  <div className="p-5 space-y-5">
                    {/* Contract info */}
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vertragsdaten</h3>
                      <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                        <p><span className="text-muted-foreground">Objekt:</span> {immobilie?.name}</p>
                        <p><span className="text-muted-foreground">Adresse:</span> {immobilie?.adresse}</p>
                        <p><span className="text-muted-foreground">Mieter:</span> {mieterList.map(m => `${m.vorname} ${m.nachname}`).join(', ') || '–'}</p>
                        <p><span className="text-muted-foreground">Vertragsbeginn:</span> {startDatum ? new Date(startDatum).toLocaleDateString('de-DE') : 'N/A'}</p>
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
                            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
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
                          <Label className="text-xs">Einheit-Bezeichnung</Label>
                          <Input value={einheitBezeichnung} onChange={(e) => setEinheitBezeichnung(e.target.value)} className="mt-1 h-9" />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Kündigung Details */}
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Kündigungsdetails</h3>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs">Kündigungsart</Label>
                          <Select value={kuendigungstyp} onValueChange={(v) => setKuendigungstyp(v as KuendigungsTyp)}>
                            <SelectTrigger className="mt-1 h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ordentlich">Ordentliche Kündigung</SelectItem>
                              <SelectItem value="ausserordentlich_fristlos">Außerordentlich (fristlos)</SelectItem>
                              <SelectItem value="ausserordentlich_mit_frist">Außerordentlich (mit Frist)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {kuendigungstyp === 'ausserordentlich_fristlos' ? 'Kündigungsdatum *' : 'Kündigungsdatum / Zum-Datum *'}
                          </Label>
                          <Input
                            type="date"
                            value={kuendigungsdatum}
                            onChange={(e) => {
                              setKuendigungsdatum(e.target.value);
                              if (!auszugsdatum) setAuszugsdatum(e.target.value);
                            }}
                            className="mt-1 h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">
                            {kuendigungstyp === 'ausserordentlich_fristlos' ? 'Räumungsfrist bis' : 'Auszugsdatum'}
                          </Label>
                          <Input
                            type="date"
                            value={auszugsdatum}
                            onChange={(e) => setAuszugsdatum(e.target.value)}
                            className="mt-1 h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Kündigungsgrund</Label>
                          <Select
                            value={kuendigungsgrund}
                            onValueChange={setKuendigungsgrund}
                          >
                            <SelectTrigger className="mt-1 h-9">
                              <SelectValue placeholder="Grund auswählen..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Zahlungsverzug">Zahlungsverzug</SelectItem>
                              <SelectItem value="Eigenbedarf">Eigenbedarf</SelectItem>
                              <SelectItem value="Vertragsverletzung">Vertragsverletzung</SelectItem>
                              <SelectItem value="Wirtschaftliche Verwertung">Wirtschaftliche Verwertung</SelectItem>
                              <SelectItem value="Modernisierung">Modernisierung</SelectItem>
                              <SelectItem value="Sonstiges">Sonstiges</SelectItem>
                            </SelectContent>
                          </Select>
                          {kuendigungsgrund === 'Sonstiges' && (
                            <Input
                              value={bemerkungen}
                              onChange={(e) => setBemerkungen(e.target.value)}
                              placeholder="Grund beschreiben..."
                              className="mt-2 h-9"
                            />
                          )}
                        </div>
                        {kuendigungsgrund !== 'Sonstiges' && (
                          <div>
                            <Label className="text-xs">Bemerkungen</Label>
                            <Textarea
                              value={bemerkungen}
                              onChange={(e) => setBemerkungen(e.target.value)}
                              placeholder="Zusätzliche Informationen..."
                              rows={2}
                              className="mt-1"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Freitext */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Brieftext</h3>
                        <Button
                          variant={useFreitext ? "default" : "outline"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setUseFreitext(!useFreitext)}
                        >
                          {useFreitext ? "Standard verwenden" : "Freitext"}
                        </Button>
                      </div>
                      {useFreitext ? (
                        <Textarea
                          value={freitext}
                          onChange={(e) => setFreitext(e.target.value)}
                          placeholder="Eigenen Brieftext eingeben..."
                          className="min-h-[120px] text-sm"
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Es wird der Standard-Kündigungstext verwendet.
                        </p>
                      )}
                    </div>

                    {/* Warning + Actions */}
                    <Card className="border-l-4 border-l-destructive bg-destructive/5">
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-destructive text-sm">Wichtiger Hinweis</p>
                            <p className="text-xs text-muted-foreground">
                              Diese Aktion setzt den Vertragsstatus auf "gekündigt" und erstellt ein Kündigungsschreiben als PDF.
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="flex gap-2 pb-4">
                      <Button variant="outline" size="sm" onClick={handleDownload} disabled={!pdfBlobUrl}>
                        <Download className="h-4 w-4 mr-1.5" />
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowConfirm(true)}
                        disabled={isSubmitting || !kuendigungsdatum || !pdfBlob}
                        className="flex-1"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Wird gekündigt...</>
                        ) : (
                          <><FileText className="h-4 w-4 mr-1.5" />Kündigung bestätigen</>
                        )}
                      </Button>
                    </div>
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
                        title="Kündigung PDF Vorschau"
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
            </TabsContent>

            {/* ========== UPLOAD TAB ========== */}
            <TabsContent value="upload" className="flex-1 overflow-auto m-0 p-6">
              <div className="max-w-lg mx-auto space-y-4">
                <Card className="border-l-4 border-l-destructive bg-destructive/5">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                      <div>
                        <p className="font-medium text-destructive">Dokumenten-Upload</p>
                        <p className="text-sm text-muted-foreground">
                          Laden Sie das offizielle Kündigungsschreiben hoch. Unterstützt: PDF, JPG, PNG (max. 10MB)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div>
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Kündigungsdatum *
                  </Label>
                  <Input
                    type="date"
                    value={uploadKuendigungsdatum}
                    onChange={(e) => setUploadKuendigungsdatum(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Kündigungsdokument *
                  </Label>
                  <DocumentDragDropZone
                    onFileSelect={(file: File) => validateAndSetFile(file)}
                    accept=".pdf,.jpg,.jpeg,.png"
                    showOverlay={!selectedFile}
                  >
                    {!selectedFile ? (
                      <div
                        className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors mt-2"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Klicken oder Datei hierhin ziehen</p>
                        <p className="text-xs text-muted-foreground mt-1">PDF, JPG oder PNG – max. 10MB</p>
                      </div>
                    ) : (
                      <Card className="p-3 mt-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">{selectedFile.name}</span>
                            <span className="text-xs text-muted-foreground">({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                          </div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} disabled={isUploading}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {uploadProgress > 0 && (
                          <div className="mt-2">
                            <Progress value={uploadProgress} className="h-2" />
                            <p className="text-xs text-muted-foreground mt-1">
                              {uploadProgress === 100 ? 'Upload abgeschlossen' : `Upload: ${uploadProgress}%`}
                            </p>
                          </div>
                        )}
                      </Card>
                    )}
                  </DocumentDragDropZone>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); }}
                    className="hidden"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={onClose} disabled={isUploading}>Abbrechen</Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowUploadConfirm(true)}
                    disabled={isUploading || !selectedFile || !uploadKuendigungsdatum}
                    className="flex-1"
                  >
                    {uploadProgress === 100 ? <Check className="h-4 w-4 mr-1.5" /> : <FileText className="h-4 w-4 mr-1.5" />}
                    {isUploading ? "Wird verarbeitet..." : "Kündigung einreichen"}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirmation: Manual */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Kündigung bestätigen
            </AlertDialogTitle>
            <AlertDialogDescription>
              Haben Sie die PDF-Vorschau geprüft? Der Vertrag wird unwiderruflich auf "gekündigt" gesetzt
              und das Kündigungsschreiben wird gespeichert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleManualTermination} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ja, Vertrag kündigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation: Upload */}
      <AlertDialog open={showUploadConfirm} onOpenChange={setShowUploadConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Kündigung bestätigen
            </AlertDialogTitle>
            <AlertDialogDescription>
              Der Vertrag wird unwiderruflich auf "gekündigt" gesetzt und das hochgeladene Dokument wird gespeichert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleUploadTermination} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ja, Kündigung einreichen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
