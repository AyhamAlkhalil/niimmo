import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Zap, Flame, Droplets, Mail, Copy, Check, Send, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { COMPANY } from '@/config/company';

interface VersorgerInfo {
  typ: 'strom' | 'gas' | 'wasser';
  label: string;
  icon: typeof Zap;
  name: string;
  email: string;
}

interface VersorgerBenachrichtigungDialogProps {
  isOpen: boolean;
  onClose: () => void;
  immobilieId: string;
  mieterName: string;
  uebergabeDatum: Date;
  zaehlerstaende: {
    strom?: string;
    gas?: string;
    wasser?: string;
  };
  adresse: string;
  einheitBezeichnung?: string;
  isEinzug?: boolean;
  pdfBlob?: Blob | null;
  pdfFileName?: string;
  contractIds?: string[];
  initialSelected?: Set<string>;
  /** Bereits gespeicherter Storage-Pfad aus UebergabeDialog — Upload wird übersprungen */
  preSavedPdfPath?: string;
}

export const VersorgerBenachrichtigungDialog = ({
  isOpen,
  onClose,
  immobilieId,
  mieterName,
  uebergabeDatum,
  zaehlerstaende,
  adresse,
  einheitBezeichnung,
  isEinzug = false,
  pdfBlob,
  pdfFileName,
  contractIds = [],
  initialSelected,
  preSavedPdfPath,
}: VersorgerBenachrichtigungDialogProps) => {
  const { toast } = useToast();
  const [versorger, setVersorger] = useState<VersorgerInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailTexte, setEmailTexte] = useState<{ [typ: string]: string }>({});
  const [emailSubjects, setEmailSubjects] = useState<{ [typ: string]: string }>({});
  const [copiedTyp, setCopiedTyp] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [sentResult, setSentResult] = useState<{ sent: string[]; failed: string[] } | null>(null);

  const datumFormatiert = format(uebergabeDatum, "dd.MM.yyyy", { locale: de });
  const aktion = isEinzug ? "Einzug" : "Auszug";

  useEffect(() => {
    if (!isOpen || !immobilieId) return;
    setSentResult(null);

    const fetchVersorger = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('immobilien')
        .select('versorger_strom_name, versorger_strom_email, versorger_gas_name, versorger_gas_email, versorger_wasser_name, versorger_wasser_email')
        .eq('id', immobilieId)
        .single();

      if (!data) {
        setIsLoading(false);
        return;
      }

      const liste: VersorgerInfo[] = [];
      if (data.versorger_strom_name || data.versorger_strom_email) {
        liste.push({ typ: 'strom', label: 'Strom', icon: Zap, name: data.versorger_strom_name || '', email: data.versorger_strom_email || '' });
      }
      if (data.versorger_gas_name || data.versorger_gas_email) {
        liste.push({ typ: 'gas', label: 'Gas', icon: Flame, name: data.versorger_gas_name || '', email: data.versorger_gas_email || '' });
      }
      if (data.versorger_wasser_name || data.versorger_wasser_email) {
        liste.push({ typ: 'wasser', label: 'Wasser', icon: Droplets, name: data.versorger_wasser_name || '', email: data.versorger_wasser_email || '' });
      }

      setVersorger(liste);

      if (initialSelected && initialSelected.size > 0) {
        setSelected(new Set(initialSelected));
      }

      const texte: { [typ: string]: string } = {};
      const subjects: { [typ: string]: string } = {};
      for (const v of liste) {
        const zaehlerstand = zaehlerstaende[v.typ] || 'nicht erfasst';
        subjects[v.typ] = `${aktion}smeldung - ${adresse}${mieterName ? `, ${mieterName}` : ''}`;
        texte[v.typ] = `Sehr geehrte Damen und Herren,

hiermit teilen wir Ihnen mit, dass am ${datumFormatiert} ein ${aktion} in folgender Wohnung stattgefunden hat:

Adresse: ${adresse}${einheitBezeichnung ? `, ${einheitBezeichnung}` : ''}
Mieter: ${mieterName}
Datum: ${datumFormatiert}
Zählerstand ${v.label}: ${zaehlerstand}

Bitte nehmen Sie die ${isEinzug ? 'Anmeldung' : 'Abmeldung'} entsprechend vor.

Mit freundlichen Grüßen
${COMPANY.name}
${COMPANY.ansprechpartner.unterschrift}
${COMPANY.strasse}, ${COMPANY.plzOrt}
Tel. ${COMPANY.ansprechpartner.telefon}`;
      }
      setEmailTexte(texte);
      setEmailSubjects(subjects);
      setIsLoading(false);
    };

    fetchVersorger();
  }, [isOpen, immobilieId, mieterName, datumFormatiert, aktion, adresse, einheitBezeichnung, zaehlerstaende, isEinzug, initialSelected]);

  const toggleSelected = (typ: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(typ)) next.delete(typ); else next.add(typ);
      return next;
    });
  };

  const copyToClipboard = async (typ: string) => {
    const v = versorger.find(x => x.typ === typ);
    if (!v) return;
    const text = `An: ${v.email}\nBetreff: ${emailSubjects[typ] || ''}\n\n${emailTexte[typ] || ''}`;
    await navigator.clipboard.writeText(text);
    setCopiedTyp(typ);
    setTimeout(() => setCopiedTyp(null), 2000);
    toast({ title: "In Zwischenablage kopiert", description: `E-Mail-Entwurf für ${v.label} kopiert.` });
  };

  const uploadPdf = async (): Promise<string | undefined> => {
    // PDF wurde bereits in UebergabeDialog gespeichert — direkt Pfad zurückgeben
    if (preSavedPdfPath) return preSavedPdfPath;
    if (!pdfBlob || !pdfFileName || contractIds.length === 0) return undefined;
    const filePath = `uebergabeprotokolle/${contractIds[0]}/${pdfFileName}`;
    const { error } = await supabase.storage
      .from('dokumente')
      .upload(filePath, pdfBlob, { contentType: 'application/pdf', upsert: true });
    if (error) {
      return undefined;
    }
    return filePath;
  };

  const handleSend = async () => {
    const selectedVersorger = versorger.filter(v => selected.has(v.typ) && v.email);
    if (selectedVersorger.length === 0) {
      toast({ title: "Keine Auswahl", description: "Bitte wählen Sie mindestens einen Versorger mit E-Mail-Adresse aus.", variant: "destructive" });
      return;
    }

    setIsSending(true);
    const sent: string[] = [];
    const failed: string[] = [];

    try {
      let pdfPath: string | undefined;
      try {
        pdfPath = await uploadPdf();
      } catch (e) {
        // Versand laeuft weiter, aber ohne Anhang - das muss sichtbar sein
        console.error('PDF-Upload fehlgeschlagen, die Versorger-Mails gehen ohne Anhang raus:', e);
        toast({
          title: "Anhang fehlt",
          description: "Das Protokoll-PDF konnte nicht hochgeladen werden. Die Benachrichtigungen gehen ohne Anhang raus.",
          variant: "destructive",
        });
      }

      for (const v of selectedVersorger) {
        try {
          const response = await supabase.functions.invoke("send-uebergabe-email", {
            body: {
              recipients: [{ mieterId: v.typ, email: v.email, name: v.name || v.label }],
              subject: emailSubjects[v.typ] || `${aktion}smeldung`,
              body: emailTexte[v.typ] || '',
              contractIds,
              uebergabeDatum: format(uebergabeDatum, "yyyy-MM-dd"),
              pdfPath,
            },
          });
          if (response.error) throw response.error;
          sent.push(v.label);
        } catch (e) {
          failed.push(v.label);
        }
      }

      setSentResult({ sent, failed });

      if (sent.length > 0) {
        toast({ title: "E-Mails versendet", description: `${sent.join(", ")} erfolgreich benachrichtigt.` });
      }
      if (failed.length > 0) {
        toast({ title: "Fehler", description: `${failed.join(", ")} konnten nicht versendet werden.`, variant: "destructive" });
      }
    } finally {
      setIsSending(false);
    }
  };

  const selectedWithEmail = versorger.filter(v => selected.has(v.typ) && v.email);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Versorger benachrichtigen
          </DialogTitle>
        </DialogHeader>

        {sentResult ? (
          <div className="py-6 space-y-4">
            {sentResult.sent.length > 0 && (
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800">Erfolgreich versendet</p>
                  <p className="text-sm text-green-700">{sentResult.sent.join(", ")}</p>
                </div>
              </div>
            )}
            {sentResult.failed.length > 0 && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Fehlgeschlagen</p>
                  <p className="text-sm text-red-700">{sentResult.failed.join(", ")}</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Schließen</Button>
            </DialogFooter>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : versorger.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground py-4">
              Keine Versorger-Daten für diese Immobilie hinterlegt.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Schließen</Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wählen Sie die Versorger aus, die über den {aktion} informiert werden sollen.
              {pdfBlob && " Das Übergabeprotokoll wird als PDF-Anhang mitgesendet."}
            </p>

            {pdfBlob && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                PDF-Protokoll wird als Anhang mitgesendet
              </div>
            )}

            {versorger.map((v) => {
              const Icon = v.icon;
              const isSelected = selected.has(v.typ);
              return (
                <div key={v.typ} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`versorger-confirm-${v.typ}`}
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(v.typ)}
                      />
                      <Label htmlFor={`versorger-confirm-${v.typ}`} className="flex items-center gap-2 cursor-pointer">
                        <Icon className="h-4 w-4" />
                        <span className="font-medium">{v.label}</span>
                        {v.name && <span className="text-muted-foreground text-xs">({v.name})</span>}
                      </Label>
                    </div>
                    {v.email && <span className="text-xs text-muted-foreground">{v.email}</span>}
                  </div>

                  {isSelected && (
                    <>
                      {!v.email && (
                        <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                          Keine E-Mail-Adresse hinterlegt – Versand nicht möglich.
                        </p>
                      )}
                      <div>
                        <Label className="text-xs text-muted-foreground">Betreff</Label>
                        <Input
                          value={emailSubjects[v.typ] || ''}
                          onChange={(e) => setEmailSubjects(prev => ({ ...prev, [v.typ]: e.target.value }))}
                          className="mt-1 h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Nachricht (editierbar)</Label>
                        <Textarea
                          value={emailTexte[v.typ] || ''}
                          onChange={(e) => setEmailTexte(prev => ({ ...prev, [v.typ]: e.target.value }))}
                          className="mt-1 text-sm min-h-[150px] resize-none"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(v.typ)}
                        className="gap-1.5 text-xs h-7"
                      >
                        {copiedTyp === v.typ ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedTyp === v.typ ? 'Kopiert' : 'In Zwischenablage kopieren'}
                      </Button>
                    </>
                  )}
                </div>
              );
            })}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} disabled={isSending}>
                Abbrechen
              </Button>
              <Button
                onClick={handleSend}
                disabled={isSending || selectedWithEmail.length === 0}
              >
                {isSending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Wird gesendet...</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" />
                    {selectedWithEmail.length > 0
                      ? `${selectedWithEmail.length} E-Mail${selectedWithEmail.length > 1 ? 's' : ''} senden`
                      : 'Senden'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
