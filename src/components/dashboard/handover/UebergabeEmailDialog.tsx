import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, Send, AlertCircle, CheckCircle2, Plus, X, Upload } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface Mieter {
  id: string;
  vorname: string;
  nachname: string | null;
  hauptmail: string | null;
}

interface ContractInfo {
  id: string;
  einheit: {
    etage?: string | null;
    immobilie: {
      name: string;
      adresse: string;
    };
  };
}

interface UebergabeEmailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mieter: Mieter[];
  contracts: ContractInfo[];
  uebergabeDatum: Date;
  mieterName: string;
  pdfBlob?: Blob | null;
  pdfFileName?: string;
  /** Bereits gespeicherter Storage-Pfad aus UebergabeDialog — Upload wird übersprungen */
  preSavedPdfPath?: string;
}

export const UebergabeEmailDialog = ({
  isOpen,
  onClose,
  mieter,
  contracts,
  uebergabeDatum,
  mieterName,
  pdfBlob,
  pdfFileName,
  preSavedPdfPath,
}: UebergabeEmailDialogProps) => {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [emailsSent, setEmailsSent] = useState(false);
  const [pdfAlreadyUploaded, setPdfAlreadyUploaded] = useState(false);

  // Initialize email addresses from mieter data
  const [emailAddresses, setEmailAddresses] = useState<{ [mieterId: string]: string }>(
    () => {
      const initial: { [key: string]: string } = {};
      mieter.forEach((m) => {
        initial[m.id] = m.hauptmail || "";
      });
      return initial;
    }
  );

  // Additional CC recipients
  const [ccEmails, setCcEmails] = useState<string[]>([""]);

  const propertyInfo = contracts.length > 0
    ? `${contracts[0].einheit.immobilie.name}, ${contracts[0].einheit.immobilie.adresse}`
    : "Ihre Wohnung";

  const [emailSubject, setEmailSubject] = useState(
    `Bestätigung Ihrer Wohnungsübergabe am ${format(uebergabeDatum, "dd.MM.yyyy", { locale: de })}`
  );

  const [emailBody, setEmailBody] = useState(
    `Sehr geehrte/r ${mieterName},

hiermit bestätigen wir die erfolgreiche Übergabe der Wohnung in ${propertyInfo} am ${format(uebergabeDatum, "dd.MM.yyyy", { locale: de })}.

Alle Zählerstände wurden dokumentiert und das Übergabeprotokoll wurde erstellt. Eine Kopie des Protokolls finden Sie im Anhang dieser E-Mail.

Wir bedanken uns für das angenehme Mietverhältnis und wünschen Ihnen für die Zukunft alles Gute.

Mit freundlichen Grüßen
Ihre Hausverwaltung`
  );

  const updateEmailAddress = (mieterId: string, email: string) => {
    setEmailAddresses((prev) => ({
      ...prev,
      [mieterId]: email,
    }));
  };

  const addCcEmail = () => {
    setCcEmails((prev) => [...prev, ""]);
  };

  const removeCcEmail = (index: number) => {
    setCcEmails((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCcEmail = (index: number, value: string) => {
    setCcEmails((prev) => prev.map((e, i) => (i === index ? value : e)));
  };

  const hasValidEmails = Object.values(emailAddresses).some(
    (email) => email && email.includes("@")
  );

  // Upload PDF to Supabase and save document reference
  const uploadPdfAndSaveRef = async (): Promise<string | undefined> => {
    // PDF wurde bereits in UebergabeDialog gespeichert — direkt Pfad zurückgeben
    if (preSavedPdfPath) return preSavedPdfPath;
    if (!pdfBlob || !pdfFileName) return undefined;
    if (pdfAlreadyUploaded) {
      return `uebergabeprotokolle/${contracts[0]?.id || 'unknown'}/${pdfFileName}`;
    }

    const filePath = `uebergabeprotokolle/${contracts[0]?.id || 'unknown'}/${pdfFileName}`;
    const { error: uploadError } = await supabase.storage
      .from('dokumente')
      .upload(filePath, pdfBlob, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw uploadError;

    // Save document reference for each contract
    for (const contract of contracts) {
      await supabase.from('dokumente').insert({
        titel: `Übergabeprotokoll ${format(uebergabeDatum, "dd.MM.yyyy")}`,
        pfad: filePath,
        kategorie: 'Übergabeprotokoll',
        dateityp: 'application/pdf',
        mietvertrag_id: contract.id,
      });
    }

    setPdfAlreadyUploaded(true);
    return filePath;
  };

  const handleUploadPdf = async () => {
    if (!pdfBlob || !pdfFileName) {
      toast({ title: "Kein PDF vorhanden", description: "Bitte erstellen Sie zuerst die Vorschau.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      await uploadPdfAndSaveRef();
      toast({ title: "PDF hochgeladen", description: "Das Protokoll wurde in den Dokumenten gespeichert." });
    } catch (error) {
      toast({ title: "Fehler", description: "PDF konnte nicht hochgeladen werden.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendEmails = async () => {
    const validEmails = Object.entries(emailAddresses)
      .filter(([_, email]) => email && email.includes("@"))
      .map(([mieterId, email]) => ({
        mieterId,
        email,
        name: mieter.find((m) => m.id === mieterId)
          ? `${mieter.find((m) => m.id === mieterId)!.vorname} ${mieter.find((m) => m.id === mieterId)!.nachname || ""}`
          : "",
      }));

    // Add CC emails as additional recipients
    const validCcEmails = ccEmails
      .filter((e) => e && e.includes("@"))
      .map((email) => ({ mieterId: "cc", email, name: "CC" }));

    const allRecipients = [...validEmails, ...validCcEmails];

    if (allRecipients.length === 0) {
      toast({
        title: "Keine E-Mail-Adressen",
        description: "Bitte geben Sie mindestens eine gültige E-Mail-Adresse ein.",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);

    try {
      // Upload PDF if available (reuses existing upload if already done)
      let pdfFilePath: string | undefined;
      try {
        pdfFilePath = await uploadPdfAndSaveRef();
      } catch (uploadErr) {
        // Versand laeuft weiter, aber ohne Anhang - das muss sichtbar sein
        console.error('PDF-Upload fehlgeschlagen, die E-Mail geht ohne Anhang raus:', uploadErr);
        toast({
          title: "Anhang fehlt",
          description: "Das Protokoll-PDF konnte nicht hochgeladen werden. Die E-Mail wird ohne Anhang versendet.",
          variant: "destructive",
        });
      }

      const response = await supabase.functions.invoke("send-uebergabe-email", {
        body: {
          recipients: allRecipients,
          subject: emailSubject,
          body: emailBody,
          contractIds: contracts.map((c) => c.id),
          uebergabeDatum: format(uebergabeDatum, "yyyy-MM-dd"),
          pdfPath: pdfFilePath,
        },
      });

      if (response.error) {
        // Tatsächliche Fehlermeldung aus dem Response-Body extrahieren
        let errorMessage = response.error.message || "Unbekannter Fehler";
        try {
          const ctx = (response.error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) errorMessage = body.error;
          }
        } catch (parseErr) {
          // Antwort ohne JSON-Body - die Rohmeldung oben bleibt stehen
          console.warn('Fehlerantwort der Edge Function nicht lesbar:', parseErr);
        }
        throw new Error(errorMessage);
      }

      setEmailsSent(true);

      // Update email addresses in database if changed
      for (const [mieterId, email] of Object.entries(emailAddresses)) {
        const originalMieter = mieter.find((m) => m.id === mieterId);
        if (originalMieter && email && email !== originalMieter.hauptmail) {
          await supabase
            .from("mieter")
            .update({ hauptmail: email })
            .eq("id", mieterId);
        }
      }

      toast({
        title: "E-Mails versendet",
        description: `${allRecipients.length} E-Mail(s) wurden erfolgreich versendet.`,
      });
    } catch (error) {
      toast({
        title: "Fehler beim Versenden",
        description: error instanceof Error ? error.message : "Die E-Mails konnten nicht versendet werden.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Übergabeprotokoll versenden
          </DialogTitle>
        </DialogHeader>

        {emailsSent ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              E-Mails erfolgreich versendet!
            </h3>
            <p className="text-gray-600 mb-6">
              Die Empfänger wurden über die Wohnungsübergabe informiert.
            </p>
            <Button onClick={onClose}>Schließen</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* PDF Info */}
            {pdfBlob && (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2 text-green-700 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>PDF-Protokoll wird als Anhang mitgesendet</span>
                </div>
                <Button size="sm" variant="outline" onClick={handleUploadPdf} disabled={isUploading}>
                  {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  <span className="ml-1 text-xs">Nur speichern</span>
                </Button>
              </div>
            )}

            {/* Mieter Recipients */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Empfänger (Mieter)</Label>
              {mieter.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">
                      {m.vorname} {m.nachname || ""}
                    </Label>
                    <Input
                      type="email"
                      placeholder="E-Mail-Adresse eingeben..."
                      value={emailAddresses[m.id] || ""}
                      onChange={(e) => updateEmailAddress(m.id, e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              ))}

              {!hasValidEmails && mieter.length > 0 && (
                <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-50 p-2 rounded-lg">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>Bitte geben Sie mindestens eine gültige E-Mail-Adresse ein.</span>
                </div>
              )}
            </div>

            {/* CC Recipients */}
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Weitere Empfänger (CC)</Label>
                <Button variant="ghost" size="sm" onClick={addCcEmail} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  Hinzufügen
                </Button>
              </div>
              {ccEmails.map((email, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="email"
                    placeholder="z.B. hausverwaltung@firma.de"
                    value={email}
                    onChange={(e) => updateCcEmail(index, e.target.value)}
                    className="h-10 flex-1"
                  />
                  {ccEmails.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeCcEmail(index)} className="h-10 px-2">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Email Subject */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Betreff</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="h-10"
              />
            </div>

            {/* Email Body */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Nachricht</Label>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="min-h-[180px] resize-none"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={onClose} disabled={isSending}>
                Abbrechen
              </Button>
              <Button
                onClick={handleSendEmails}
                disabled={isSending || (!hasValidEmails && ccEmails.every(e => !e || !e.includes("@")))}
              >
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Wird gesendet...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    E-Mail senden
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
