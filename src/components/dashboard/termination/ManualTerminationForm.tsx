import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Calendar, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { terminationWebhookService } from "@/services/terminationWebhookService";

interface ManualTerminationFormProps {
  vertragId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ManualTerminationForm = ({
  vertragId,
  onSuccess,
  onCancel
}: ManualTerminationFormProps) => {
  const [kuendigungsdatum, setKuendigungsdatum] = useState("");
  const [grund, setGrund] = useState("");
  const [bemerkungen, setBemerkungen] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!kuendigungsdatum) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie ein Kündigungsdatum an",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Update contract status and termination date
      const { error: updateError } = await supabase
        .from('mietvertrag')
        .update({
          status: 'gekuendigt',
          kuendigungsdatum: kuendigungsdatum,
          aktualisiert_am: new Date().toISOString()
        })
        .eq('id', vertragId);

      if (updateError) {
        throw new Error('Fehler beim Aktualisieren des Vertrags: ' + updateError.message);
      }

      // Create document entry for manual termination
      const { error: docError } = await supabase
        .from('dokumente')
        .insert({
          mietvertrag_id: vertragId,
          kategorie: 'Kündigung',
          titel: `Kündigung - Manuelle Eingabe (${new Date(kuendigungsdatum + 'T12:00:00').toLocaleDateString('de-DE')})`,
          erstellt_von: 'Manuell',
          hochgeladen_am: new Date(kuendigungsdatum + 'T12:00:00').toISOString()
        });

      if (docError) {
        console.error('Kuendigung gespeichert, aber der Dokumenteintrag fehlt:', docError);
      }

      // Call webhook service
      try {
        await terminationWebhookService.notifyTermination({
          vertragId,
          kuendigungsdatum,
          grund,
          bemerkungen,
          method: 'manual'
        });
      } catch (webhookError) {
        console.warn('Kuendigungs-Webhook nicht erreicht:', webhookError);
      }

      toast({
        title: "Erfolg",
        description: "Mietvertrag wurde erfolgreich gekündigt",
      });

      onSuccess();
    } catch (error) {
      toast({
        title: "Fehler",
        description: error instanceof Error ? error.message : "Ein unbekannter Fehler ist aufgetreten",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="border-l-4 border-l-destructive bg-destructive/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Wichtiger Hinweis</p>
              <p className="text-sm text-muted-foreground">
                Diese Aktion ändert den Vertragsstatus auf "gekündigt". Dies kann nicht rückgängig gemacht werden.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div>
          <Label htmlFor="kuendigungsdatum" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Kündigungsdatum *
          </Label>
          <Input
            id="kuendigungsdatum"
            type="date"
            value={kuendigungsdatum}
            onChange={(e) => setKuendigungsdatum(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            required
          />
        </div>

        <div>
          <Label htmlFor="grund">Kündigungsgrund</Label>
          <Input
            id="grund"
            value={grund}
            onChange={(e) => setGrund(e.target.value)}
            placeholder="z.B. Eigenbedarf, Modernisierung..."
          />
        </div>

        <div>
          <Label htmlFor="bemerkungen">Bemerkungen</Label>
          <Textarea
            id="bemerkungen"
            value={bemerkungen}
            onChange={(e) => setBemerkungen(e.target.value)}
            placeholder="Zusätzliche Informationen zur Kündigung..."
            rows={3}
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Abbrechen
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={isLoading}
          className="flex items-center gap-2"
        >
          <FileText className="h-4 w-4" />
          {isLoading ? "Wird gekündigt..." : "Vertrag kündigen"}
        </Button>
      </div>
    </form>
  );
};