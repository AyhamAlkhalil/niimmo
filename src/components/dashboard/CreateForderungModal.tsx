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

  // Gemeinsam
  const [typ, setTyp] = useState<"Miete" | "BKA">("Miete");
  const [betrag, setBetrag] = useState("");

  // Miete-spezifisch
  const [sollmonat, setSollmonat] = useState("");

  // BKA-spezifisch
  const [bkaArt, setBkaArt] = useState<"nachzahlung" | "guthaben">("nachzahlung");
  const [bkaJahr, setBkaJahr] = useState(String(new Date().getFullYear() - 1));

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2023 }, (_, i) => String(currentYear - i));
  const monatYears = Array.from({ length: currentYear + 2 - 2025 }, (_, i) => String(2025 + i));

  const totalRent = currentKaltmiete + currentBetriebskosten;

  const handleClose = () => {
    setTyp("Miete");
    setBetrag("");
    setSollmonat("");
    setBkaArt("nachzahlung");
    setBkaJahr(String(currentYear - 1));
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const betragNum = parseFloat(betrag.replace(",", "."));
    if (isNaN(betragNum) || betragNum <= 0) {
      toast({ title: "Fehler", description: "Bitte einen gültigen Betrag eingeben.", variant: "destructive" });
      return;
    }

    if (typ === "Miete" && !sollmonat) {
      toast({ title: "Fehler", description: "Bitte einen Monat wählen.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const sollbetrag = typ === "BKA" && bkaArt === "guthaben" ? -betragNum : betragNum;
      const sollmonatValue = typ === "BKA" ? `${bkaJahr}-12-01` : sollmonat;

      const { error } = await supabase.from("mietforderungen").insert({
        mietvertrag_id: mietvertragId,
        sollmonat: sollmonatValue,
        sollbetrag: Math.round(sollbetrag * 100) / 100,
        ist_faellig: typ === "BKA" ? bkaArt === "nachzahlung" : true,
        typ,
      });

      if (error) throw error;

      const beschreibung =
        typ === "BKA"
          ? `BKA ${bkaArt === "guthaben" ? "Guthaben" : "Nachzahlung"} ${bkaJahr}: ${betragNum.toFixed(2)} €`
          : `Forderung ${sollmonat.slice(0, 7)}: ${betragNum.toFixed(2)} €`;

      toast({ title: "Erfolgreich erstellt", description: beschreibung });
      handleClose();
      await queryClient.invalidateQueries({ queryKey: ["mietforderungen", mietvertragId] });
    } catch {
      toast({ title: "Fehler", description: "Eintrag konnte nicht gespeichert werden.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Forderung erstellen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Typ-Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setTyp("Miete")}
              className={`py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                typ === "Miete"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Mietzahlung
            </button>
            <button
              type="button"
              onClick={() => setTyp("BKA")}
              className={`py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                typ === "BKA"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              BKA-Abrechnung
            </button>
          </div>

          {/* Miete: Monat-Picker */}
          {typ === "Miete" && (
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
                  {monatYears.map((year) =>
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
          )}

          {/* BKA: Jahr + Art */}
          {typ === "BKA" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Abrechnungsjahr</Label>
                <div className="flex gap-2 flex-wrap">
                  {years.map((j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => setBkaJahr(j)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                        bkaJahr === j
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {j}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Art</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBkaArt("nachzahlung")}
                    className={`py-2 px-3 rounded-lg text-sm font-medium border transition-all ${
                      bkaArt === "nachzahlung"
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-input bg-background text-muted-foreground hover:border-amber-300"
                    }`}
                  >
                    Nachzahlung
                    <span className="block text-[10px] font-normal opacity-60">Mieter zahlt nach</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBkaArt("guthaben")}
                    className={`py-2 px-3 rounded-lg text-sm font-medium border transition-all ${
                      bkaArt === "guthaben"
                        ? "border-green-400 bg-green-50 text-green-800"
                        : "border-input bg-background text-muted-foreground hover:border-green-300"
                    }`}
                  >
                    Guthaben
                    <span className="block text-[10px] font-normal opacity-60">Mieter bekommt zurück</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Betrag */}
          <div className="space-y-1.5">
            <Label htmlFor="betrag" className="flex items-center gap-2">
              <Euro className="h-4 w-4" />
              Betrag
              {typ === "BKA" && bkaArt === "guthaben" && (
                <span className="text-xs font-normal text-green-600">(wird als Guthaben abgezogen)</span>
              )}
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
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
            </div>
            {typ === "Miete" && totalRent > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBetrag(String(totalRent))}
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
