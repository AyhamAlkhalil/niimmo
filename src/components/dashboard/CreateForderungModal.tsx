import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Euro, Calendar } from "lucide-react";

interface CreateForderungModalProps {
  isOpen: boolean;
  onClose: () => void;
  mietvertragId: string;
  currentKaltmiete?: number;
  currentBetriebskosten?: number;
}

const MONTHS = [
  { value: "01", label: "Januar" },
  { value: "02", label: "Februar" },
  { value: "03", label: "März" },
  { value: "04", label: "April" },
  { value: "05", label: "Mai" },
  { value: "06", label: "Juni" },
  { value: "07", label: "Juli" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "Oktober" },
  { value: "11", label: "November" },
  { value: "12", label: "Dezember" },
];

export const CreateForderungModal = ({
  isOpen,
  onClose,
  mietvertragId,
  currentKaltmiete = 0,
  currentBetriebskosten = 0,
}: CreateForderungModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [typ, setTyp] = useState<"Miete" | "BKA">("Miete");
  const [sollmonat, setSollmonat] = useState("");
  const [sollbetrag, setSollbetrag] = useState("");

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear + 2 - 2025 }, (_, i) => String(2025 + i));
  const totalRent = currentKaltmiete + currentBetriebskosten;

  const handleClose = () => {
    setTyp("Miete");
    setSollmonat("");
    setSollbetrag("");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sollmonat) {
      toast({ title: "Fehler", description: "Bitte einen Monat wählen.", variant: "destructive" });
      return;
    }

    const betrag = parseFloat(sollbetrag.replace(",", "."));
    if (isNaN(betrag) || betrag === 0) {
      toast({ title: "Fehler", description: "Bitte einen gültigen Betrag eingeben.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.from("mietforderungen").insert({
        mietvertrag_id: mietvertragId,
        sollmonat,
        sollbetrag: Math.round(betrag * 100) / 100,
        typ,
      });

      if (error) throw error;

      toast({
        title: "Forderung erstellt",
        description: `${typ === "BKA" ? "BKA-Forderung" : "Forderung"} über ${Math.abs(betrag).toFixed(2)} € wurde eingetragen.`,
      });

      handleClose();
      await queryClient.invalidateQueries({ queryKey: ["mietforderungen", mietvertragId] });
    } catch {
      toast({ title: "Fehler", description: "Forderung konnte nicht erstellt werden.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Forderung erstellen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Typ */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setTyp("Miete")}
              className={`py-1.5 rounded-md text-sm font-medium transition-all ${
                typ === "Miete"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Miete
            </button>
            <button
              type="button"
              onClick={() => setTyp("BKA")}
              className={`py-1.5 rounded-md text-sm font-medium transition-all ${
                typ === "BKA"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              BKA
            </button>
          </div>

          {/* Monat */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Monat
            </Label>
            <Select value={sollmonat} onValueChange={setSollmonat}>
              <SelectTrigger>
                <SelectValue placeholder="Monat wählen" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) =>
                  MONTHS.map((month) => {
                    const val = `${year}-${month.value}-01`;
                    return (
                      <SelectItem key={val} value={val}>
                        {month.label} {year}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Betrag */}
          <div className="space-y-1.5">
            <Label htmlFor="sollbetrag" className="flex items-center gap-2">
              <Euro className="h-4 w-4" />
              Betrag
              {typ === "BKA" && (
                <span className="text-xs font-normal text-muted-foreground">(negativ = Guthaben)</span>
              )}
            </Label>
            <div className="relative">
              <Input
                id="sollbetrag"
                type="number"
                step="0.01"
                value={sollbetrag}
                onChange={(e) => setSollbetrag(e.target.value)}
                placeholder="0,00"
                className="text-right pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
            </div>
            {typ === "Miete" && totalRent > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSollbetrag(String(totalRent))}
                className="w-full text-xs"
              >
                Aktuelle Miete übernehmen ({totalRent.toLocaleString()} €)
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Speichern..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
