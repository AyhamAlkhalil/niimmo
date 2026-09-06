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
import { supabase } from "@/integrations/supabase/client";
import { generateMieterhoehungPdf, BEGRUENDUNGS_BEZEICHNUNG, type MieterhoehungPdfData, type BegruendungsArt } from "@/utils/mieterhoehungPdfGenerator";
import { useAktuellerVpi } from "@/hooks/useBasiszinsPerioden";
import { kappungsgrenzeProzent, maximaleKaltmiete, wirksamAb } from '@/utils/mieterhoehungRegeln';

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
  const { vpi: aktuellerVpi } = useAktuellerVpi();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable fields
  const [neueKaltmiete, setNeueKaltmiete] = useState("0.00");
  const [neueBetriebskosten, setNeueBetriebskosten] = useState("0.00");
  const [anrede, setAnrede] = useState("Herr");
  const [mieterAdresse, setMieterAdresse] = useState("");
  const [mieterPlzOrt, setMieterPlzOrt] = useState("");
  const [einheitBezeichnung, setEinheitBezeichnung] = useState("WE");
  const [istAngespannt, setIstAngespannt] = useState(false);
  // § 558a Abs. 2 BGB: ohne Begründungsmittel ist das Verlangen unwirksam.
  const [begruendungsart, setBegruendungsart] = useState<BegruendungsArt>("mietspiegel");
  const [begruendungText, setBegruendungText] = useState("");

  // § 558 Abs. 3 BGB: 15 % bei angespanntem Markt, sonst 20 % in drei Jahren.
  const kappungsgrenze = kappungsgrenzeProzent(istAngespannt);
  const maxKaltmiete = contractData ? maximaleKaltmiete(contractData.current_kaltmiete, istAngespannt) : 0;
  const erhoehungProzent = contractData && contractData.current_kaltmiete > 0
    ? ((parseFloat(neueKaltmiete) - contractData.current_kaltmiete) / contractData.current_kaltmiete * 100)
    : 0;
  const ueberKappung = erhoehungProzent > kappungsgrenze;

  // Fetch ist_angespannt from immobilien
  useEffect(() => {
    if (!isOpen || !contractData?.immobilie_id) return;
    const fetchAngespannt = async () => {
      const { data } = await (supabase as any)
        .from('immobilien')
        .select('ist_angespannt')
        .eq('id', contractData.immobilie_id)
        .single();
      setIstAngespannt(data?.ist_angespannt ?? false);
    };
    fetchAngespannt();
  }, [isOpen, contractData?.immobilie_id]);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen && contractData) {
      setNeueKaltmiete(contractData.current_kaltmiete.toFixed(2));
      setNeueBetriebskosten(contractData.current_betriebskosten.toFixed(2));
      setAnrede("Herr");
      setMieterAdresse(contractData.immobilie_adresse?.split(',')[0]?.trim() || '');
      setMieterPlzOrt(contractData.immobilie_adresse?.includes(',')
        ? contractData.immobilie_adresse.split(',').slice(1).join(',').trim()
        : '');
      setEinheitBezeichnung("WE");
      setBegruendungsart("mietspiegel");
      setBegruendungText("");
    }
  }, [isOpen, contractData]);

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
  }, [contractData, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung, neueKaltmiete, neueBetriebskosten]);

  // Generate PDF preview with debounce
  const regeneratePreview = useCallback(async () => {
    const pdfData = buildPdfData();
    if (!pdfData) return;

    setIsGeneratingPreview(true);
    try {
      const blob = await generateMieterhoehungPdf(pdfData);
      setPdfBlob(blob);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(URL.createObjectURL(blob));
    } catch (err) {
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
  }, [isOpen, anrede, mieterAdresse, mieterPlzOrt, einheitBezeichnung, neueKaltmiete, neueBetriebskosten]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  const handleDownload = () => {
    if (!pdfBlob) return;
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

  const handleSaveAndUpload = async () => {
    if (!contractData || !pdfBlob) return;
    setIsSubmitting(true);
    try {
      const mieterList = contractData.mieter || [];
      const vorname = mieterList[0]?.vorname || 'Mieter';
      const nachname = mieterList[0]?.nachname || '';
      const datum = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
      const fileName = `Mieterhoehung_${vorname}_${nachname}_${datum}.pdf`;
      const filePath = `mieterhoehungen/${contractData.mietvertrag_id}/${fileName}`;

      const arrayBuffer = await pdfBlob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(filePath, uint8, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw uploadError;

      await supabase.from('dokumente').insert({
        titel: `Mieterhöhung ${new Date().toLocaleDateString('de-DE')}`,
        pfad: filePath,
        kategorie: 'Schriftverkehr',
        dateityp: 'application/pdf',
        mietvertrag_id: contractData.mietvertrag_id,
      });

      // Die Miete am Vertrag bleibt unverändert: Nach § 558 BGB wird sie erst
      // mit der Zustimmung des Mieters und frühestens ab dem dritten
      // Kalendermonat nach Zugang geschuldet. Bis dahin steht das Verlangen
      // als eigener Vorgang. Wer hier wieder mietvertrag.kaltmiete setzt,
      // erzeugt Mahnungen gegen Mieter, die korrekt zahlen.
      const wirksamDatum = wirksamAb(new Date());
      const { error: vorgangError } = await supabase.from('mieterhoehungen').insert({
        mietvertrag_id: contractData.mietvertrag_id,
        verlangt_am: new Date().toISOString().split('T')[0],
        wirksam_ab: wirksamDatum.toISOString().split('T')[0],
        alte_kaltmiete: contractData.current_kaltmiete,
        alte_betriebskosten: contractData.current_betriebskosten,
        neue_kaltmiete: parseFloat(neueKaltmiete),
        neue_betriebskosten: parseFloat(neueBetriebskosten) || 0,
        begruendungsart,
        begruendung_text: begruendungText.trim(),
        dokument_pfad: filePath,
      });
      if (vorgangError) throw vorgangError;

      toast({
        title: "Erhöhungsverlangen gespeichert",
        description: `Die Miete am Vertrag bleibt unverändert. Sie ist erst nach Zustimmung des Mieters anzupassen, frühestens zum ${wirksamDatum.toLocaleDateString('de-DE')}.`,
      });
      onClose();
    } catch (err: any) {
      toast({ title: "Fehler", description: err.message || "Speichern fehlgeschlagen.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!contractData) return null;

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

                <Separator />

                {/* Recipient fields */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Empfänger</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Anrede</Label>
                      <Input value={anrede} onChange={(e) => setAnrede(e.target.value)} className="h-8 text-sm" />
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
                      <p className="text-[10px] text-muted-foreground">Kaltmiete</p>
                      <p className="text-sm font-bold">{contractData.current_kaltmiete.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</p>
                    </div>
                    <div className="p-2 bg-muted rounded text-center">
                      <p className="text-[10px] text-muted-foreground">Betriebskosten</p>
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

                  {/* Kappungsgrenze Hinweis */}
                  <div className={`p-2 rounded text-xs ${ueberKappung ? 'bg-destructive/10 border border-destructive/30 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                    <p className="font-medium">
                      Kappungsgrenze: {kappungsgrenze}% in 36 Monaten
                      {istAngespannt && ' (angespannter Markt)'}
                    </p>
                    <p>
                      Max. Kaltmiete: {maxKaltmiete.toFixed(2)} € | Erhöhung: {erhoehungProzent.toFixed(1)}%
                      {ueberKappung && ' — Überschreitung!'}
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
                <div className="p-2 rounded-lg border text-[10px] text-muted-foreground space-y-1">
                  <p className="font-medium">Hinweise:</p>
                  <p>• Neue Miete wird 3 Monate nach Zugang wirksam</p>
                  <p>• Frühestens 15 Monate nach Einzug/letzter Erhöhung</p>
                  <p>• Höchstens alle 12 Monate</p>
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

      {/* Confirm save dialog */}
      <AlertDialog open={showConfirmSave} onOpenChange={setShowConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mieterhöhung speichern?</AlertDialogTitle>
            <AlertDialogDescription>
              Das PDF wird in den Dokumenten gespeichert und die Vertragsmiete wird auf die neuen Werte aktualisiert. 
              Haben Sie die PDF-Vorschau geprüft?
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
