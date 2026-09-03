import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface Kommentar {
  id: string;
  kommentar: string;
  erstellt_am: string;
  verfasser: { anzeigename: string; kuerzel: string } | null;
}

/**
 * Verlauf zu einer Aufgabe. Jeder neue Beitrag benachrichtigt in der Datenbank
 * die verantwortliche Person, den Melder und alle Markierten.
 */
export const AufgabeKommentare = ({ aufgabenId }: { aufgabenId: string }) => {
  const [entwurf, setEntwurf] = useState("");
  const queryClient = useQueryClient();

  const { data: kommentare = [], isLoading } = useQuery({
    queryKey: ["aufgabe-kommentare", aufgabenId],
    queryFn: async (): Promise<Kommentar[]> => {
      const { data, error } = await supabase
        .from("dev_ticket_kommentare")
        .select(
          `id, kommentar, erstellt_am,
           verfasser:app_benutzer!dev_ticket_kommentare_verfasser_id_fkey (anzeigename, kuerzel)`,
        )
        .eq("ticket_id", aufgabenId)
        .order("erstellt_am", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as Kommentar[];
    },
  });

  const hinzufuegen = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase
        .from("dev_ticket_kommentare")
        .insert({ ticket_id: aufgabenId, kommentar: text });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aufgabe-kommentare", aufgabenId] });
      setEntwurf("");
    },
    onError: () => toast.error("Der Kommentar konnte nicht gespeichert werden"),
  });

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4" />
        Verlauf ({kommentare.length})
      </h4>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Wird geladen...</p>
      ) : (
        kommentare.length > 0 && (
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {kommentare.map((k) => (
              <div key={k.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="whitespace-pre-wrap">{k.kommentar}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {k.verfasser?.anzeigename ? `${k.verfasser.anzeigename} · ` : ""}
                  {format(new Date(k.erstellt_am), "dd.MM.yyyy HH:mm", { locale: de })}
                </p>
              </div>
            ))}
          </div>
        )
      )}

      <div className="flex gap-2">
        <Textarea
          value={entwurf}
          onChange={(e) => setEntwurf(e.target.value)}
          placeholder="Anmerkung hinzufügen..."
          className="min-h-[60px] text-sm"
        />
        <Button
          size="icon"
          onClick={() => entwurf.trim() && hinzufuegen.mutate(entwurf.trim())}
          disabled={!entwurf.trim() || hinzufuegen.isPending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
