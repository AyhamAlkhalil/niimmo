import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Building2, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useInvalidateNebenkosten } from "@/hooks/useNebenkostenDaten";

interface ZahlungObjektWechselDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Objekt, aus dem heraus umgebucht wird. */
  immobilieId: string;
  zahlung: {
    id: string;
    betrag: number;
    buchungsdatum: string;
    empfaengername: string | null;
    verwendungszweck: string | null;
  } | null;
  /** Anzahl Kostenpositionen dieser Zahlung — solange welche bestehen, wird nicht umgebucht. */
  anzahlZuordnungen: number;
}

/**
 * Bucht eine Ausgabe auf ein anderes Objekt um.
 *
 * Kundenmeldung 10.09.2026: Beim Erstellen der Nebenkosten lag eine Zahlung im
 * falschen Objekt und ließ sich von dort nicht verschieben. Der Zahlungsbezug ist
 * entweder-oder: Wird ein Objekt gesetzt, muss der Mietvertragsbezug fallen,
 * sonst zählt die Zahlung doppelt.
 */
export function ZahlungObjektWechselDialog({
  open,
  onOpenChange,
  immobilieId,
  zahlung,
  anzahlZuordnungen,
}: ZahlungObjektWechselDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNebenkosten(immobilieId);
  const [zielId, setZielId] = useState<string | null>(null);

  // Auswahl je Zahlung zurücksetzen, sonst steht beim nächsten Öffnen noch das
  // Ziel der vorigen Buchung im Fenster.
  useEffect(() => {
    if (open) setZielId(null);
  }, [open, zahlung?.id]);

  const objekte = useQuery({
    queryKey: ["immobilien-auswahl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immobilien")
        .select("id, name, adresse")
        .order("name");
      if (error) throw error;
      return (data || []).map((o) => ({
        id: o.id,
        name: o.name ?? "Ohne Namen",
        adresse: o.adresse ?? "",
      }));
    },
    enabled: open,
  });

  const umbuchen = useMutation({
    mutationFn: async (zielImmobilieId: string) => {
      if (!zahlung) throw new Error("Keine Zahlung gewählt");

      // Der Zählwert aus der Oberfläche kann veraltet sein, wenn jemand anderes
      // die Zahlung inzwischen zugeordnet hat. Deshalb unmittelbar vor dem
      // Schreiben noch einmal an der Datenbank nachsehen — sonst zeigt eine
      // Kostenposition danach still auf ein Objekt, in dem ihre Zahlung nicht
      // mehr geführt wird.
      const { data: bestehende, error: pruefung } = await supabase
        .from("kostenpositionen")
        .select("id")
        .eq("zahlung_id", zahlung.id)
        .limit(1);
      if (pruefung) throw pruefung;
      if ((bestehende || []).length > 0) {
        throw new Error(
          "Die Zahlung ist inzwischen einer Kostenart zugeordnet. Bitte die Zuordnung zuerst entfernen."
        );
      }

      // mietvertrag_id wird bewusst geleert: Eine Zahlung hängt entweder am
      // Mietvertrag oder am Objekt, nie an beidem — sonst wird sie doppelt gezählt.
      const { error } = await supabase
        .from("zahlungen")
        .update({ immobilie_id: zielImmobilieId, mietvertrag_id: null })
        .eq("id", zahlung.id);
      if (error) throw error;
      return zielImmobilieId;
    },
    onSuccess: (zielImmobilieId) => {
      const ziel = objekte.data?.find((o) => o.id === zielImmobilieId);
      toast({
        title: "✓ Umgebucht",
        description: `Die Zahlung liegt jetzt bei ${ziel?.name ?? "dem gewählten Objekt"} und ist hier nicht mehr zu sehen.`,
      });
      queryClient.invalidateQueries({ queryKey: ["immobilie-nebenkosten-zahlungen"] });
      // Der Nebenkosten-Arbeitsplatz im Controlboard fuehrt dieselbe Zahlung in
      // eigenen Listen. Ohne diese beiden Schluessel zeigte er das alte Objekt
      // weiter an, bis jemand die Seite neu laedt.
      queryClient.invalidateQueries({ queryKey: ["unzugeordnete-nebenkosten"] });
      queryClient.invalidateQueries({ queryKey: ["zugeordnete-nebenkosten"] });
      invalidate();
      setZielId(null);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Umbuchen fehlgeschlagen", description: error.message, variant: "destructive" });
    },
  });

  const gesperrt = anzahlZuordnungen > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Auf anderes Objekt buchen
          </DialogTitle>
          <DialogDescription>
            Die Ausgabe wird dem gewählten Objekt zugeordnet und ist danach in dessen Abrechnung zu
            finden, nicht mehr in dieser.
          </DialogDescription>
        </DialogHeader>

        {zahlung && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium">
                {zahlung.empfaengername || "Unbekannter Empfänger"}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-destructive">
                {(zahlung.betrag ?? 0).toFixed(2)} €
              </span>
            </div>
            {zahlung.verwendungszweck && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {zahlung.verwendungszweck}
              </p>
            )}
          </div>
        )}

        {gesperrt ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Diese Zahlung ist hier bereits {anzahlZuordnungen} Kostenposition(en) zugeordnet. Die
              Zuordnung gehört zu diesem Objekt und kann nicht mitwandern. Entfernen Sie sie zuerst
              rechts in der Kategorie, dann lässt sich die Zahlung umbuchen.
            </span>
          </div>
        ) : objekte.isLoading ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Objekte werden geladen …</p>
        ) : objekte.isError ? (
          <p className="p-4 text-center text-sm font-medium text-destructive" role="alert">
            Die Objekte konnten nicht geladen werden. Bitte das Fenster schließen und erneut öffnen.
          </p>
        ) : (
          <div className="max-h-[22rem] overflow-y-auto rounded-md border" role="listbox" aria-label="Zielobjekt">
            {(objekte.data ?? []).map((objekt) => {
              const istAktuell = objekt.id === immobilieId;
              const gewaehlt = objekt.id === zielId;
              return (
                <button
                  key={objekt.id}
                  type="button"
                  role="option"
                  aria-selected={gewaehlt}
                  disabled={istAktuell}
                  onClick={() => setZielId(objekt.id)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                    gewaehlt && "bg-primary/10"
                  )}
                >
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{objekt.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {istAktuell ? "aktuelles Objekt" : objekt.adresse}
                    </span>
                  </span>
                  {gewaehlt && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={umbuchen.isPending}>
            Abbrechen
          </Button>
          <Button
            onClick={() => zielId && umbuchen.mutate(zielId)}
            disabled={gesperrt || !zielId || zielId === immobilieId || umbuchen.isPending}
          >
            {umbuchen.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Wird umgebucht …
              </>
            ) : (
              "Umbuchen"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
