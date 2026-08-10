import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  CalendarIcon,
  Loader2,
  Euro,
  FileText,
  CreditCard,
  AlertCircle,
  Check,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  BETRKV_KATEGORIEN,
  NICHT_UMLAGEFAEHIGE_KATEGORIEN,
  findeKategorieNachId,
  findeKategorieNachName,
} from "./nebenkostenKategorien";
import {
  useNebenkostenarten,
  useInvalidateNebenkosten,
  findeOderErstelleNebenkostenart,
  type KostenpositionMitArt,
} from "@/hooks/useNebenkostenDaten";

interface SplitLine {
  id: string;
  kategorieId: string;
  betrag: string;
  zeitraumVon: string;
  zeitraumBis: string;
  bezeichnung: string;
  existingPositionId?: string;
}

interface NebenkostenSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = manuelle Kostenposition ohne zugeordnete Bankbewegung. */
  zahlung: {
    id: string;
    betrag: number;
    buchungsdatum: string;
    empfaengername: string | null;
    verwendungszweck: string | null;
    iban: string | null;
  } | null;
  immobilieId: string;
  selectedYear: number;
  /** Bereits vorhandene Positionen dieser Zahlung. */
  bestehendePositionen?: KostenpositionMitArt[];
  /** Kategorie, die beim Öffnen vorausgewählt wird (z. B. aus dem KI-Vorschlag). */
  vorschlagKategorieId?: string;
}

export function NebenkostenSplitDialog({
  open,
  onOpenChange,
  zahlung,
  immobilieId,
  selectedYear,
  bestehendePositionen,
  vorschlagKategorieId,
}: NebenkostenSplitDialogProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateNebenkosten(immobilieId);
  const { data: nebenkostenarten } = useNebenkostenarten(immobilieId);
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const istManuell = zahlung === null;
  const defaultVon = `${selectedYear}-01-01`;
  const defaultBis = `${selectedYear}-12-31`;

  const createEmptyLine = useCallback(
    (kategorieId = ""): SplitLine => ({
      id: crypto.randomUUID(),
      kategorieId,
      betrag: "",
      zeitraumVon: defaultVon,
      zeitraumBis: defaultBis,
      bezeichnung: kategorieId ? findeKategorieNachId(kategorieId)?.name ?? "" : "",
    }),
    [defaultVon, defaultBis]
  );

  // Nur beim Öffnen befüllen. Ohne diese Sperre würde jeder Hintergrund-Refetch
  // von React Query (z. B. beim Fensterwechsel) die Eingaben zurücksetzen.
  const [initialisiertFuer, setInitialisiertFuer] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      if (initialisiertFuer !== null) setInitialisiertFuer(null);
      return;
    }

    const schluessel = zahlung?.id ?? "manuell";
    if (initialisiertFuer === schluessel) return;

    if (bestehendePositionen && bestehendePositionen.length > 0) {
      setLines(
        bestehendePositionen.map((pos) => ({
          id: crypto.randomUUID(),
          kategorieId: findeKategorieNachName(pos.nebenkostenart?.name)?.id ?? "",
          betrag: pos.gesamtbetrag.toString(),
          zeitraumVon: pos.zeitraum_von ?? defaultVon,
          zeitraumBis: pos.zeitraum_bis ?? defaultBis,
          bezeichnung: pos.bezeichnung || "",
          existingPositionId: pos.id,
        }))
      );
    } else {
      setLines([createEmptyLine(vorschlagKategorieId ?? "")]);
    }
    setInitialisiertFuer(schluessel);
  }, [
    open,
    zahlung?.id,
    initialisiertFuer,
    bestehendePositionen,
    vorschlagKategorieId,
    createEmptyLine,
    defaultVon,
    defaultBis,
  ]);

  const zahlungBetrag = Math.abs(zahlung?.betrag || 0);

  const assignedTotal = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const val = parseFloat(line.betrag);
        return sum + (isNaN(val) ? 0 : val);
      }, 0),
    [lines]
  );

  const restBetrag = zahlungBetrag - assignedTotal;
  const progressPercent = zahlungBetrag > 0 ? Math.min((assignedTotal / zahlungBetrag) * 100, 100) : 0;
  // Bei manuellen Positionen gibt es keinen Zahlungsbetrag, der begrenzt.
  const isOverBudget = !istManuell && assignedTotal > zahlungBetrag + 0.01;

  const addLine = () => {
    const newLine = createEmptyLine();
    if (!istManuell && restBetrag > 0.01) newLine.betrag = restBetrag.toFixed(2);
    setLines((prev) => [...prev, newLine]);
  };

  const removeLine = (lineId: string) => setLines((prev) => prev.filter((l) => l.id !== lineId));

  const updateLine = (lineId: string, field: keyof SplitLine, value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const updated = { ...l, [field]: value };
        if (field === "kategorieId" && !l.bezeichnung) {
          const kat = findeKategorieNachId(value);
          if (kat) updated.bezeichnung = kat.name;
        }
        return updated;
      })
    );
  };

  const canSave = useMemo(() => {
    if (lines.length === 0 || isOverBudget) return false;
    return lines.every((line) => {
      const betrag = parseFloat(line.betrag);
      return (
        line.kategorieId &&
        !isNaN(betrag) &&
        betrag > 0 &&
        line.zeitraumVon &&
        line.zeitraumBis &&
        line.zeitraumBis >= line.zeitraumVon
      );
    });
  }, [lines, isOverBudget]);

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);

    try {
      const behaltenIds = lines.map((l) => l.existingPositionId).filter(Boolean) as string[];
      const zuLoeschen = (bestehendePositionen || []).filter(
        (p) => !behaltenIds.includes(p.id)
      );

      if (zuLoeschen.length > 0) {
        const { error } = await supabase
          .from("kostenpositionen")
          .delete()
          .in("id", zuLoeschen.map((p) => p.id));
        if (error) throw error;
      }

      for (const line of lines) {
        const kategorie = findeKategorieNachId(line.kategorieId);
        if (!kategorie) continue;

        const nebenkostenartId = await findeOderErstelleNebenkostenart(
          immobilieId,
          line.kategorieId,
          nebenkostenarten
        );

        const positionData = {
          immobilie_id: immobilieId,
          zahlung_id: zahlung?.id ?? null,
          nebenkostenart_id: nebenkostenartId,
          gesamtbetrag: parseFloat(line.betrag),
          zeitraum_von: line.zeitraumVon,
          zeitraum_bis: line.zeitraumBis,
          bezeichnung: line.bezeichnung || kategorie.name,
          ist_umlagefaehig: kategorie.umlagefaehig,
          quelle: istManuell ? "manuell" : "zahlung",
        };

        if (line.existingPositionId) {
          const { error } = await supabase
            .from("kostenpositionen")
            .update(positionData)
            .eq("id", line.existingPositionId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("kostenpositionen").insert(positionData);
          if (error) throw error;
        }
      }

      toast({
        title: "✓ Gespeichert",
        description: `${lines.length} Kostenposition${lines.length > 1 ? "en" : ""} gespeichert.`,
      });

      invalidate();
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unbekannter Fehler";
      toast({ title: "Fehler", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const SCHLUESSEL_LABELS: Record<string, string> = {
    qm: "nach m²",
    personen: "nach Personentagen",
    gleich: "gleichmäßig",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[92vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Euro className="h-5 w-5 text-primary" />
            {istManuell ? "Kostenposition manuell anlegen" : "Zahlung aufteilen"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-3 space-y-3 shrink-0 border-b">
          {istManuell ? (
            <p className="text-sm text-muted-foreground">
              Für Kosten ohne passende Bankbewegung — etwa bar bezahlte Rechnungen oder Beträge, die
              über ein anderes Konto liefen. Der Zeitraum bestimmt, in welches Abrechnungsjahr die
              Kosten fallen.
            </p>
          ) : (
            zahlung && (
              <>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">
                      {zahlung.empfaengername || "Unbekannter Empfänger"}
                    </p>
                    <Badge variant="outline" className="font-bold px-2.5 py-0.5">
                      {zahlungBetrag.toFixed(2)} €
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="h-3 w-3" />
                      {format(new Date(zahlung.buchungsdatum), "dd. MMMM yyyy", { locale: de })}
                    </span>
                    {zahlung.iban && (
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {zahlung.iban}
                      </span>
                    )}
                  </div>
                  {zahlung.verwendungszweck && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1 line-clamp-2">
                      <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                      {zahlung.verwendungszweck}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Verteilt</span>
                    <div className="flex items-center gap-2">
                      <span className={cn("font-bold", isOverBudget && "text-destructive")}>
                        {assignedTotal.toFixed(2)} €
                      </span>
                      <span className="text-muted-foreground">/ {zahlungBetrag.toFixed(2)} €</span>
                      {restBetrag > 0.01 && !isOverBudget && (
                        <Badge variant="secondary" className="text-xs">
                          Rest: {restBetrag.toFixed(2)} €
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Progress
                    value={progressPercent}
                    className={cn("h-1.5", isOverBudget && "[&>div]:bg-destructive")}
                  />
                  {isOverBudget && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Summe übersteigt den Zahlungsbetrag – bitte korrigieren.
                    </p>
                  )}
                </div>
              </>
            )
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
          {lines.map((line, index) => {
            const selectedKat = findeKategorieNachId(line.kategorieId);
            const zeitraumUeberJahr =
              line.zeitraumVon < defaultVon || line.zeitraumBis > defaultBis;

            return (
              <div key={line.id} className="rounded-lg border p-4 space-y-3 bg-card">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Position {index + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {selectedKat && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          selectedKat.umlagefaehig
                            ? "border-green-300 text-green-700"
                            : "border-amber-300 text-amber-700"
                        )}
                      >
                        {selectedKat.betrkvNummer ?? (selectedKat.umlagefaehig ? "§2" : "—")}
                        {" · "}
                        {SCHLUESSEL_LABELS[selectedKat.schluessel] ?? selectedKat.schluessel}
                      </Badge>
                    )}
                    {lines.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeLine(line.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Nebenkostenart</Label>
                    <Select
                      value={line.kategorieId}
                      onValueChange={(v) => updateLine(line.id, "kategorieId", v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Kategorie wählen..." />
                      </SelectTrigger>
                      <SelectContent className="bg-background border shadow-lg z-[200] max-h-[260px]">
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                          Umlagefähig (BetrKV §2)
                        </div>
                        {BETRKV_KATEGORIEN.map((kat) => {
                          const Icon = kat.icon;
                          return (
                            <SelectItem key={kat.id} value={kat.id}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                <span className="text-xs text-muted-foreground mr-1">
                                  {kat.betrkvNummer}
                                </span>
                                {kat.name}
                              </div>
                            </SelectItem>
                          );
                        })}
                        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t mt-1 pt-1">
                          Nicht umlagefähig
                        </div>
                        {NICHT_UMLAGEFAEHIGE_KATEGORIEN.map((kat) => {
                          const Icon = kat.icon;
                          return (
                            <SelectItem key={kat.id} value={kat.id}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                {kat.name}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Betrag</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.betrag}
                        onChange={(e) => updateLine(line.id, "betrag", e.target.value)}
                        placeholder="0.00"
                        className="h-9 text-sm pr-7"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        €
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Bezeichnung</Label>
                  <Input
                    value={line.bezeichnung}
                    onChange={(e) => updateLine(line.id, "bezeichnung", e.target.value)}
                    placeholder="z.B. Gebäudeversicherung 2024"
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Zeitraum von</Label>
                    <Input
                      type="date"
                      value={line.zeitraumVon}
                      onChange={(e) => updateLine(line.id, "zeitraumVon", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Zeitraum bis</Label>
                    <Input
                      type="date"
                      value={line.zeitraumBis}
                      onChange={(e) => updateLine(line.id, "zeitraumBis", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                {zeitraumUeberJahr && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Zeitraum reicht über {selectedYear} hinaus — der Betrag wird zeitanteilig auf die
                    berührten Abrechnungsjahre verteilt.
                  </p>
                )}
              </div>
            );
          })}

          <Button variant="outline" onClick={addLine} className="w-full gap-2 border-dashed">
            <Plus className="h-4 w-4" />
            Weitere Position hinzufügen
            {!istManuell && restBetrag > 0.01 && !isOverBudget && (
              <span className="text-muted-foreground text-xs ml-1">
                (Rest: {restBetrag.toFixed(2)} €)
              </span>
            )}
          </Button>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {lines.length > 1 ? `${lines.length} Positionen speichern` : "Position speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
