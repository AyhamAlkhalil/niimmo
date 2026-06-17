import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PaymentKategorieEditorProps {
  paymentId: string;
  currentKategorie: string | null;
  currentImmobilieId: string | null;
  onUpdate?: () => void;
  compact?: boolean;
}

const KATEGORIEN = [
  { value: "Miete", label: "Miete", color: "bg-green-100 text-green-800 border-green-200" },
  { value: "Nebenkosten", label: "Nebenkosten", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "Nichtmiete", label: "Nichtmiete", color: "bg-gray-100 text-gray-800 border-gray-200" },
  { value: "Mietkaution", label: "Mietkaution", color: "bg-purple-100 text-purple-800 border-purple-200" },
  { value: "Rücklastschrift", label: "Rücklastschrift", color: "bg-red-100 text-red-800 border-red-200" },
  { value: "Ignorieren", label: "Ignorieren", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { value: "Betriebskostenabrechnung", label: "BKA (Mieter)", color: "bg-amber-100 text-amber-800 border-amber-200" },
];

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
  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (kategorie: string) => {
      const updateData: Record<string, any> = {
        kategorie: kategorie as any,
      };
      // Clear mietvertrag_id for non-rent categories
      if (["Nebenkosten", "Nichtmiete", "Ignorieren"].includes(kategorie)) {
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
      if (newKategorie === 'Nebenkosten' || currentKategorie === 'Nebenkosten') {
        queryClient.invalidateQueries({ queryKey: ['unzugeordnete-nebenkosten'] });
        queryClient.invalidateQueries({ queryKey: ['zugeordnete-nebenkosten'] });
      }
      onUpdate?.();
    },
    onError: (error) => {
      toast.error("Fehler beim Aktualisieren der Kategorie");
    }
  });

  const handleKategorieChange = (value: string) => {
    setSelectedKategorie(value);
    updateMutation.mutate(value);
    toast.success(`Kategorie auf "${value}" geändert`);
  };

  const getKategorieColor = (kat: string) => {
    return KATEGORIEN.find(k => k.value === kat)?.color || "bg-gray-100 text-gray-800";
  };

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
          <SelectContent className="bg-white z-50">
            {KATEGORIEN.map((kat) => (
              <SelectItem key={kat.value} value={kat.value}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", kat.color.split(" ")[0])} />
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
          <SelectContent className="bg-white z-50">
            {KATEGORIEN.map((kat) => (
              <SelectItem key={kat.value} value={kat.value}>
                <div className="flex items-center gap-2">
                  <div className={cn("w-3 h-3 rounded-full", kat.color.split(" ")[0])} />
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
