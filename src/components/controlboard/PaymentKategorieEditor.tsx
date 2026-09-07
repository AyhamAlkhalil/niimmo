import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KATEGORIE_PUNKT_KLASSEN, KATEGORIE_TON_KLASSEN, ZAHLUNG_KATEGORIEN, kategorieTon } from "@/utils/zahlungKategorie";

interface PaymentKategorieEditorProps {
  paymentId: string;
  currentKategorie: string | null;
  currentImmobilieId: string | null;
  onUpdate?: () => void;
  compact?: boolean;
}

// Bezeichnungen und Farbrollen kommen seit dem 07.09.2026 aus utils/zahlungKategorie.ts.

export function PaymentKategorieEditor({ 
  paymentId, 
  currentKategorie, 
  currentImmobilieId,
  onUpdate,
  compact = false 
}: PaymentKategorieEditorProps) {
  const [selectedKategorie, setSelectedKategorie] = useState(currentKategorie || "");
  const queryClient = useQueryClient();

  useEffect(() => {
    setSelectedKategorie(currentKategorie || "");
  }, [paymentId, currentKategorie]);
  /**
   * Immobilie einer Zahlung ueber ihren bisherigen Mietvertrag ermitteln.
   *
   * Beim Umbuchen auf Nebenkosten/Nichtmiete fiel bisher nur der Vertragsbezug
   * weg, ohne dass ein Objektbezug entstand. Die Zahlung war danach weder in
   * der Zahlungshistorie des Mieters noch in der Nebenkostenabrechnung der
   * Immobilie auffindbar -- die dortige Liste filtert auf immobilie_id.
   */
  const immobilieAusVertrag = async (): Promise<string | null> => {
    const { data: zahlung } = await supabase
      .from('zahlungen')
      .select('mietvertrag_id')
      .eq('id', paymentId)
      .maybeSingle();
    if (!zahlung?.mietvertrag_id) return null;

    const { data: vertrag } = await supabase
      .from('mietvertrag')
      .select('einheit_id')
      .eq('id', zahlung.mietvertrag_id)
      .maybeSingle();
    if (!vertrag?.einheit_id) return null;

    const { data: einheit } = await supabase
      .from('einheiten')
      .select('immobilie_id')
      .eq('id', vertrag.einheit_id)
      .maybeSingle();
    return einheit?.immobilie_id ?? null;
  };

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (kategorie: string) => {
      const updateData: Record<string, any> = {
        kategorie: kategorie as any,
      };

      if (["Nebenkosten", "Nichtmiete"].includes(kategorie)) {
        // Objektbezug herstellen, bevor der Vertragsbezug faellt.
        const immobilieId = currentImmobilieId ?? (await immobilieAusVertrag());
        if (!immobilieId) {
          throw new Error(
            "Keine Immobilie ermittelbar. Ordnen Sie die Zahlung im Tab \"Nebenkosten-Zuordnung\" einem Objekt zu."
          );
        }
        updateData.immobilie_id = immobilieId;
        updateData.mietvertrag_id = null;
      } else if (kategorie === "Ignorieren") {
        updateData.mietvertrag_id = null;
      }

      const { error } = await supabase
        .from('zahlungen')
        .update(updateData)
        .eq('id', paymentId);
      
      if (error) throw error;
    },
    onSuccess: (_, newKategorie) => {
      queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
      queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
      // Nebenkosten-Queries nur invalidieren wenn Kategorie gewechselt hat
      if (['Nebenkosten', 'Nichtmiete'].includes(newKategorie) ||
          ['Nebenkosten', 'Nichtmiete'].includes(currentKategorie || '')) {
        queryClient.invalidateQueries({ queryKey: ['unzugeordnete-nebenkosten'] });
        queryClient.invalidateQueries({ queryKey: ['zugeordnete-nebenkosten'] });
        queryClient.invalidateQueries({ queryKey: ['immobilie-nebenkosten-zahlungen'] });
      }
      onUpdate?.();
    },
    onError: (error: unknown) => {
      const grund = error instanceof Error ? error.message : "Unbekannter Fehler";
      toast.error(`Kategorie nicht geändert: ${grund}`);
      setSelectedKategorie(currentKategorie || "");
    }
  });

  const handleKategorieChange = (value: string) => {
    setSelectedKategorie(value);
    updateMutation.mutate(value, {
      onSuccess: () => {
        toast.success(
          ["Nebenkosten", "Nichtmiete"].includes(value)
            ? `Als "${value}" dem Objekt zugeordnet — steht dort in der Nebenkostenabrechnung bereit.`
            : `Kategorie auf "${value}" geändert`
        );
      },
    });
  };

  const getKategorieColor = (kat: string) => KATEGORIE_TON_KLASSEN[kat ? kategorieTon(kat) : "muted"];

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Select value={selectedKategorie} onValueChange={handleKategorieChange}>
          <SelectTrigger className={cn(
            "h-7 text-xs border px-2 py-0 min-w-[100px]",
            getKategorieColor(selectedKategorie)
          )}>
            <SelectValue placeholder="Kategorie" />
          </SelectTrigger>
          <SelectContent>
            {ZAHLUNG_KATEGORIEN.map((kat) => (
              <SelectItem key={kat.wert} value={kat.wert}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", KATEGORIE_PUNKT_KLASSEN[kat.ton])} />
                  {kat.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {updateMutation.isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  // Full-size version
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={selectedKategorie} onValueChange={handleKategorieChange}>
          <SelectTrigger className={cn(
            "w-40 border",
            getKategorieColor(selectedKategorie)
          )}>
            <SelectValue placeholder="Kategorie wählen..." />
          </SelectTrigger>
          <SelectContent>
            {ZAHLUNG_KATEGORIEN.map((kat) => (
              <SelectItem key={kat.wert} value={kat.wert}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-3 h-3 rounded-full", KATEGORIE_PUNKT_KLASSEN[kat.ton])} />
                  {kat.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {updateMutation.isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

    </div>
  );
}
