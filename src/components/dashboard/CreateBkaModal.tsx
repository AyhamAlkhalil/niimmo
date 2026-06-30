import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Receipt, TrendingDown, TrendingUp } from "lucide-react";

interface CreateBkaModalProps {
  isOpen: boolean;
  onClose: () => void;
  mietvertragId: string;
}

export const CreateBkaModal = ({
  isOpen,
  onClose,
  mietvertragId,
}: CreateBkaModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [art, setArt] = useState<"nachzahlung" | "guthaben">("nachzahlung");
  const [betrag, setBetrag] = useState("");
  const [jahr, setJahr] = useState(String(new Date().getFullYear() - 1));

  const currentYear = new Date().getFullYear();
  const jahre = Array.from({ length: 6 }, (_, i) => String(currentYear - i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const betragNum = parseFloat(betrag.replace(",", "."));
    if (isNaN(betragNum) || betragNum <= 0) {
      toast({ title: "Fehler", description: "Bitte einen gültigen Betrag eingeben.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const sollbetrag = art === "guthaben" ? -betragNum : betragNum;

      const { error } = await supabase.from("mietforderungen").insert({
        mietvertrag_id: mietvertragId,
        sollmonat: `${jahr}-12-01`,
        sollbetrag: Math.round(sollbetrag * 100) / 100,
        ist_faellig: art === "nachzahlung",
        typ: "BKA",
      });

      if (error) throw error;

      toast({
        title: art === "nachzahlung" ? "BKA-Nachzahlung eingetragen" : "BKA-Guthaben eingetragen",
        description: `${betragNum.toFixed(2)} € für Abrechnungsjahr ${jahr} gespeichert.`,
      });

      setBetrag("");
      setArt("nachzahlung");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["mietforderungen", mietvertragId] });
    } catch {
      toast({ title: "Fehler", description: "Eintrag konnte nicht gespeichert werden.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Receipt className="h-5 w-5 text-blue-600" />
            </div>
            BKA-Saldo eintragen
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Art */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setArt("nachzahlung")}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                art === "nachzahlung"
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-muted bg-muted/30 text-muted-foreground hover:border-amber-200"
              }`}
            >
              <TrendingDown className="h-5 w-5" />
              Nachzahlung
              <span className="text-[10px] font-normal opacity-70">Mieter zahlt nach</span>
            </button>
            <button
              type="button"
              onClick={() => setArt("guthaben")}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                art === "guthaben"
                  ? "border-green-400 bg-green-50 text-green-800"
                  : "border-muted bg-muted/30 text-muted-foreground hover:border-green-200"
              }`}
            >
              <TrendingUp className="h-5 w-5" />
              Guthaben
              <span className="text-[10px] font-normal opacity-70">Mieter bekommt zurück</span>
            </button>
          </div>

          {/* Abrechnungsjahr */}
          <div className="space-y-1.5">
            <Label>Abrechnungsjahr</Label>
            <div className="flex gap-2 flex-wrap">
              {jahre.map((j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => setJahr(j)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    jahr === j
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted bg-muted/30 text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {j}
                </button>
              ))}
            </div>
          </div>

          {/* Betrag */}
          <div className="space-y-1.5">
            <Label htmlFor="betrag">
              Betrag{" "}
              <span className={`text-xs font-normal ${art === "guthaben" ? "text-green-600" : "text-amber-600"}`}>
                ({art === "guthaben" ? "wird als Guthaben abgezogen" : "wird als Forderung addiert"})
              </span>
            </Label>
            <div className="relative">
              <Input
                id="betrag"
                type="number"
                step="0.01"
                min="0.01"
                value={betrag}
                onChange={(e) => setBetrag(e.target.value)}
                placeholder="0,00"
                className="text-right pr-10"
                autoFocus
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className={art === "guthaben" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {isLoading ? "Speichern..." : art === "nachzahlung" ? "Nachzahlung eintragen" : "Guthaben eintragen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
