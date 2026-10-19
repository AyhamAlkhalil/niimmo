import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, Send, AlertCircle, CheckCircle2, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { de } from "date-fns/locale";
import { istMailadresse, versandAuswerten } from "@/utils/uebergabeMail";

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
  isEinzug: boolean;
  /** Mieter mit der Mailadresse aus den Stammdaten */
  mieter: Mieter[];
  /** Im Übergabeformular eingetragene Adressen; haben Vorrang vor den Stammdaten */
  adressVorschlaege?: { [mieterId: string]: string };
  contracts: ContractInfo[];
  uebergabeDatum: Date;
  mieterName: string;
  /** Storage-Pfad des gespeicherten Protokolls — der Dialog öffnet erst nach dem Speichern */
  pdfPfad: string;
  /** Meldet die Adressen, an die tatsächlich versendet wurde */
  onVersendet?: (adressen: string[]) => void;
}

interface VersandErgebnis {
  gesendet: string[];
  fehlgeschlagen: string[];
}

/**
 * Versand des gespeicherten Übergabeprotokolls an die Mieter.
 *
 * Der Dialog bleibt nach dem Schließen eingehängt (UebergabeDialog): Bearbeitete
 * Texte und der Versandstand überleben so ein versehentliches Tippen daneben.
 * Bis zum 19.10.2026 waren beide danach weg — und wer den Dialog wieder öffnete,
 * sah nichts davon, dass schon versendet war, und schickte ein zweites Mal.
 */
export const UebergabeEmailDialog = ({
  isOpen,
  onClose,
  isEinzug,
  mieter,
  adressVorschlaege = {},
  contracts,
  uebergabeDatum,
  mieterName,
  pdfPfad,
  onVersendet,
}: UebergabeEmailDialogProps) => {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  // Ergebnis des letzten Versands — solange gesetzt, zeigt der Dialog die Übersicht statt des Formulars
  const [ergebnis, setErgebnis] = useState<VersandErgebnis | null>(null);
  // Alle Adressen, an die in diesem Dialog schon versendet wurde, mit Uhrzeit des letzten Versands
  const [bisherVersendet, setBisherVersendet] = useState<{ adressen: string[]; am: Date } | null>(null);

  const [emailAddresses, setEmailAddresses] = useState<{ [mieterId: string]: string }>(() => {
    const initial: { [key: string]: string } = {};
    mieter.forEach((m) => {
      initial[m.id] = adressVorschlaege[m.id] || m.hauptmail || "";
    });
    return initial;
  });
  // Eine hier geänderte Adresse geht nur auf ausdrücklichen Wunsch in die
  // Stammdaten. Bis zum 19.10.2026 überschrieb jeder Versand still die
  // Mailadresse des Mieters — auch mit einer nur einmal genutzten.
  const [adresseUebernehmen, setAdresseUebernehmen] = useState<{ [mieterId: string]: boolean }>({});

  // Additional CC recipients
  const [ccEmails, setCcEmails] = useState<string[]>([""]);

  const propertyInfo = contracts.length > 0
    ? `${contracts[0].einheit.immobilie.name}, ${contracts[0].einheit.immobilie.adresse}`
    : "Ihre Wohnung";
  const datum = format(uebergabeDatum, "dd.MM.yyyy", { locale: de });

  // Beim Einzug ohne den Abschied, den die Mail bis zum 19.10.2026 auch neuen Mietern mitgab
  const [emailSubject, setEmailSubject] = useState(
    isEinzug ? `Übergabeprotokoll zu Ihrem Einzug am ${datum}` : `Bestätigung Ihrer Wohnungsübergabe am ${datum}`
  );

  const [emailBody, setEmailBody] = useState(
    isEinzug
      ? `Sehr geehrte/r ${mieterName},

hiermit bestätigen wir die Übergabe der Wohnung in ${propertyInfo} an Sie am ${datum}.

Alle Zählerstände wurden dokumentiert und das Übergabeprotokoll wurde erstellt. Eine Kopie des Protokolls finden Sie im Anhang dieser E-Mail.

Wir wünschen Ihnen einen guten Start in Ihrem neuen Zuhause.

Mit freundlichen Grüßen
Ihre Hausverwaltung`
      : `Sehr geehrte/r ${mieterName},

hiermit bestätigen wir die erfolgreiche Übergabe der Wohnung in ${propertyInfo} am ${datum}.

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

  const hasValidEmails = Object.values(emailAddresses).some(istMailadresse);
  // Etwas eingetragen, aber keine vollständige Adresse
  const ungueltig = (email: string | undefined) => !!email?.trim() && !istMailadresse(email);
  const geaendert = (m: Mieter) => istMailadresse(emailAddresses[m.id]) && emailAddresses[m.id].trim() !== (m.hauptmail ?? "").trim();

  const handleSendEmails = async () => {
    const validEmails = mieter
      .filter((m) => istMailadresse(emailAddresses[m.id]))
      .map((m) => ({
        mieterId: m.id,
        email: emailAddresses[m.id].trim(),
        name: `${m.vorname} ${m.nachname || ""}`.trim(),
      }));

    // Add CC emails as additional recipients
    const validCcEmails = ccEmails
      .filter(istMailadresse)
      .map((email) => ({ mieterId: "cc", email: email.trim(), name: "CC" }));

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
      const response = await supabase.functions.invoke("send-uebergabe-email", {
        body: {
          recipients: allRecipients,
          subject: emailSubject,
          body: emailBody,
          contractIds: contracts.map((c) => c.id),
          uebergabeDatum: format(uebergabeDatum, "yyyy-MM-dd"),
          pdfPath: pdfPfad,
        },
      });

      if (response.error) {
        // Tatsächliche Fehlermeldung aus dem Response-Body extrahieren
        let errorMessage = response.error.message || "Unbekannter Fehler";
        try {
          const ctx = (response.error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
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

      // Die Function meldet je Adresse, ob sie angenommen wurde. Bis zum
      // 19.10.2026 zählte der Dialog einfach alle Empfänger als versendet.
      const { gesendet, fehlgeschlagen } = versandAuswerten(response.data, allRecipients.map((r) => r.email));
      setErgebnis({ gesendet, fehlgeschlagen });
      if (gesendet.length > 0) {
        setBisherVersendet((vorher) => ({
          adressen: [...new Set([...(vorher?.adressen ?? []), ...gesendet])],
          am: new Date(),
        }));
        onVersendet?.(gesendet);
      }

      // Nur ausdrücklich gewünschte und tatsächlich angenommene Adressen übernehmen
      const nichtGespeichert: string[] = [];
      for (const m of mieter) {
        const email = emailAddresses[m.id]?.trim();
        if (!adresseUebernehmen[m.id] || !geaendert(m) || !gesendet.includes(email)) continue;
        const { error } = await supabase.from("mieter").update({ hauptmail: email }).eq("id", m.id);
        if (error) nichtGespeichert.push(`${m.vorname} ${m.nachname || ""}`.trim());
      }
      if (nichtGespeichert.length > 0) {
        toast({
          title: "Adresse nicht übernommen",
          description: `Die neue Mailadresse von ${nichtGespeichert.join(", ")} konnte nicht beim Mieter gespeichert werden.`,
          variant: "destructive",
        });
      }

      if (fehlgeschlagen.length > 0) {
        toast({
          title: `${fehlgeschlagen.length} von ${allRecipients.length} E-Mails nicht versendet`,
          description: `Nicht zugestellt an: ${fehlgeschlagen.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "E-Mails versendet",
          description: `${gesendet.length} E-Mail(s) wurden versendet.`,
        });
      }
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
    // Während des Versands nicht schließbar: Sonst bliebe offen, ob die Mail raus ist
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSending && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-600" />
            Übergabeprotokoll versenden
          </DialogTitle>
        </DialogHeader>

        {ergebnis ? (
          <div className="py-4 space-y-4">
            {ergebnis.gesendet.length > 0 && (
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800">Versendet an</p>
                  <p className="text-sm text-green-700 break-all">{ergebnis.gesendet.join(", ")}</p>
                </div>
              </div>
            )}
            {ergebnis.fehlgeschlagen.length > 0 && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Nicht zugestellt an</p>
                  <p className="text-sm text-red-700 break-all">{ergebnis.fehlgeschlagen.join(", ")}</p>
                  <p className="text-xs text-red-700 mt-1">Bitte die Adresse prüfen und erneut senden.</p>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setErgebnis(null)}>
                {ergebnis.fehlgeschlagen.length > 0 ? "Zurück und erneut senden" : "Weitere E-Mail senden"}
              </Button>
              <Button onClick={onClose}>Schließen</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {bisherVersendet && (
              <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span className="break-all">
                  Bereits versendet an {bisherVersendet.adressen.join(", ")} (zuletzt{" "}
                  {format(bisherVersendet.am, "HH:mm", { locale: de })} Uhr).
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              <span>PDF-Protokoll wird als Anhang mitgesendet</span>
            </div>

            {/* Mieter Recipients */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Empfänger (Mieter)</Label>
              {mieter.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {m.vorname} {m.nachname || ""}
                  </Label>
                  <Input
                    type="email"
                    placeholder="E-Mail-Adresse eingeben..."
                    value={emailAddresses[m.id] || ""}
                    onChange={(e) => updateEmailAddress(m.id, e.target.value)}
                    className={cn("h-10", ungueltig(emailAddresses[m.id]) && "border-destructive focus-visible:ring-destructive")}
                  />
                  {ungueltig(emailAddresses[m.id]) && (
                    <p className="text-xs text-destructive">Adresse unvollständig — an sie wird nicht versendet.</p>
                  )}
                  {geaendert(m) && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`adresse-uebernehmen-${m.id}`}
                        checked={!!adresseUebernehmen[m.id]}
                        onCheckedChange={(wert) => setAdresseUebernehmen((prev) => ({ ...prev, [m.id]: wert === true }))}
                      />
                      <Label htmlFor={`adresse-uebernehmen-${m.id}`} className="text-xs font-normal cursor-pointer">
                        Als neue Mailadresse beim Mieter speichern
                      </Label>
                    </div>
                  )}
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
                    className={cn("h-10 flex-1", ungueltig(email) && "border-destructive focus-visible:ring-destructive")}
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
                disabled={isSending || (!hasValidEmails && !ccEmails.some(istMailadresse))}
              >
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Wird gesendet...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    {bisherVersendet ? "Erneut senden" : "E-Mail senden"}
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
