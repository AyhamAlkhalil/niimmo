import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, ArrowRightLeft, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface PaymentSplit {
  id: string;
  dbId?: string;
  betrag: number;
  kategorie: "Miete" | "Mietkaution" | "Nichtmiete" | "Ignorieren" | "Rücklastschrift";
  verwendungszweck: string;
  zugeordneter_monat: string;
}

interface PaymentSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: any;
  vertragId: string;
  formatBetrag: (betrag: number) => string;
  availableMonths?: string[];
  editMode?: boolean;
  existingSplitPayments?: any[];
}

const PAYMENT_CATEGORIES = [
  "Miete",
  "Mietkaution",
  "Nichtmiete",
  "Ignorieren",
  "Rücklastschrift"
] as const;

function formatMonthLabel(ym: string): string {
  if (!ym || ym.length < 7) return ym;
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function extractCleanVerwendungszweck(raw: string): string {
  if (!raw) return "";
  const idx = raw.indexOf(" | SPLIT_GROUP_");
  if (idx !== -1) return raw.slice(0, idx);
  const idx2 = raw.indexOf("SPLIT_GROUP_");
  if (idx2 !== -1) return raw.slice(0, idx2).trim();
  return raw;
}

function extractSplitMeta(payment: any): { timestamp: string | null; originalData: any | null } {
  const vz = payment?.verwendungszweck || "";
  const match = vz.match(/SPLIT_GROUP_(\d+)_ORIGINAL_(.+)/);
  if (!match) return { timestamp: null, originalData: null };
  try {
    return {
      timestamp: match[1],
      originalData: JSON.parse(decodeURIComponent(match[2])),
    };
  } catch {
    return { timestamp: match[1], originalData: null };
  }
}

function buildInitialSplits(
  payment: any,
  editMode: boolean,
  existingSplitPayments?: any[]
): PaymentSplit[] {
  if (editMode && existingSplitPayments && existingSplitPayments.length > 0) {
    return existingSplitPayments.map((p) => ({
      id: p.id,
      dbId: p.id,
      betrag: Number(p.betrag),
      kategorie: p.kategorie || "Miete",
      verwendungszweck: extractCleanVerwendungszweck(p.verwendungszweck || ""),
      zugeordneter_monat: (p.zugeordneter_monat || p.buchungsdatum || "").slice(0, 7),
    }));
  }
  return [
    {
      id: "1",
      betrag: Number(payment?.betrag || 0),
      kategorie: payment?.kategorie || "Miete",
      verwendungszweck: payment?.verwendungszweck || "",
      zugeordneter_monat: (payment?.zugeordneter_monat || payment?.buchungsdatum || "").slice(0, 7),
    },
  ];
}

export function PaymentSplitModal({
  isOpen,
  onClose,
  payment,
  vertragId,
  formatBetrag,
  availableMonths = [],
  editMode = false,
  existingSplitPayments = [],
}: PaymentSplitModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [splits, setSplits] = useState<PaymentSplit[]>(() =>
    buildInitialSplits(payment, editMode, existingSplitPayments)
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSplits(buildInitialSplits(payment, editMode, existingSplitPayments));
  }, [isOpen, editMode]);

  const originalAmount = editMode
    ? existingSplitPayments.reduce((sum, p) => sum + Number(p.betrag), 0)
    : Number(payment?.betrag || 0);

  const totalSplitAmount = splits.reduce((sum, s) => sum + s.betrag, 0);
  const remainingAmount = originalAmount - totalSplitAmount;
  const isBalanced =
    Math.abs(parseFloat(originalAmount.toFixed(2)) - parseFloat(totalSplitAmount.toFixed(2))) <=
    0.02;

  // Combine passed months with the payment's own month, deduplicated, sorted desc
  const monthOptions = Array.from(
    new Set([
      ...availableMonths,
      (payment?.zugeordneter_monat || payment?.buchungsdatum || "").slice(0, 7),
    ])
  )
    .filter(Boolean)
    .sort()
    .reverse();

  const addSplit = () => {
    setSplits([
      ...splits,
      {
        id: Date.now().toString(),
        betrag: parseFloat(Math.max(0, remainingAmount).toFixed(2)),
        kategorie: "Miete",
        verwendungszweck: "",
        zugeordneter_monat: monthOptions[0] || "",
      },
    ]);
  };

  const removeSplit = (id: string) => {
    if (splits.length <= 1) return;
    setSplits(splits.filter((s) => s.id !== id));
  };

  const updateSplit = (id: string, field: keyof PaymentSplit, value: string | number) => {
    setSplits(
      splits.map((s) =>
        s.id === id
          ? { ...s, [field]: field === "betrag" ? parseFloat(value.toString()) || 0 : value }
          : s
      )
    );
  };

  const handleSave = async () => {
    if (!isBalanced) {
      toast({
        title: "Fehler",
        description: `Die Teilbeträge (${formatBetrag(totalSplitAmount)}) müssen dem Gesamtbetrag (${formatBetrag(originalAmount)}) entsprechen.`,
        variant: "destructive",
      });
      return;
    }
    if (splits.length <= 1) {
      toast({
        title: "Fehler",
        description: "Mindestens 2 Teilzahlungen erforderlich.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      let splitTimestamp: string;
      let originalPaymentData: any;

      if (editMode && existingSplitPayments.length > 0) {
        const meta = extractSplitMeta(existingSplitPayments[0]);
        splitTimestamp = meta.timestamp || Date.now().toString();
        originalPaymentData = meta.originalData || {
          buchungsdatum: payment?.buchungsdatum,
          mietvertrag_id: payment?.mietvertrag_id,
          empfaengername: payment?.empfaengername,
          kategorie: payment?.kategorie,
          betrag: parseFloat(originalAmount.toFixed(2)),
          verwendungszweck: extractCleanVerwendungszweck(payment?.verwendungszweck || ""),
          iban: payment?.iban,
          zugeordneter_monat: payment?.zugeordneter_monat,
          import_datum: payment?.import_datum || new Date().toISOString(),
        };
      } else {
        splitTimestamp = Date.now().toString();
        originalPaymentData = {
          buchungsdatum: payment.buchungsdatum,
          mietvertrag_id: payment.mietvertrag_id,
          empfaengername: payment.empfaengername,
          kategorie: payment.kategorie,
          betrag: parseFloat(originalAmount.toFixed(2)),
          verwendungszweck: payment.verwendungszweck || "",
          iban: payment.iban,
          zugeordneter_monat: payment.zugeordneter_monat,
          import_datum: payment.import_datum || new Date().toISOString(),
        };
      }

      const splitMarker = `SPLIT_GROUP_${splitTimestamp}_ORIGINAL_${encodeURIComponent(
        JSON.stringify(originalPaymentData)
      )}`;

      const newPayments = splits.map((split) => {
        const cleanVz = split.verwendungszweck.trim();
        return {
          buchungsdatum: payment?.buchungsdatum || originalPaymentData.buchungsdatum,
          mietvertrag_id: payment?.mietvertrag_id || originalPaymentData.mietvertrag_id,
          empfaengername: payment?.empfaengername || originalPaymentData.empfaengername,
          kategorie: split.kategorie as
            | "Miete"
            | "Mietkaution"
            | "Nichtmiete"
            | "Ignorieren"
            | "Rücklastschrift",
          betrag: parseFloat(split.betrag.toFixed(2)),
          verwendungszweck: cleanVz ? `${cleanVz} | ${splitMarker}` : splitMarker,
          iban: payment?.iban || originalPaymentData.iban,
          zugeordneter_monat: split.zugeordneter_monat
            || (payment?.zugeordneter_monat || originalPaymentData.zugeordneter_monat || '').slice(0, 7)
            || null,
          import_datum:
            payment?.import_datum ||
            originalPaymentData.import_datum ||
            new Date().toISOString(),
        };
      });

      const { data: insertedPayments, error: insertError } = await supabase
        .from("zahlungen")
        .insert(newPayments)
        .select();

      if (insertError) throw new Error(`Fehler beim Erstellen der Teilzahlungen: ${insertError.message}`);

      const idsToDelete = editMode
        ? existingSplitPayments.map((p) => p.id)
        : [payment.id];

      const { error: deleteError } = await supabase
        .from("zahlungen")
        .delete()
        .in("id", idsToDelete);

      if (deleteError) {
        if (insertedPayments?.length) {
          await supabase
            .from("zahlungen")
            .delete()
            .in("id", insertedPayments.map((p) => p.id));
        }
        throw new Error(`Fehler beim Aktualisieren: ${deleteError.message}`);
      }

      toast({
        title: editMode ? "Aufteilung gespeichert" : "Erfolgreich aufgeteilt",
        description: `Zahlung in ${splits.length} Teilzahlungen aufgeteilt.`,
      });

      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["zahlungen-detail", vertragId] }),
        queryClient.invalidateQueries({ queryKey: ["mietvertrag-details", vertragId] }),
        queryClient.invalidateQueries({ queryKey: ["mietforderungen", vertragId] }),
        queryClient.invalidateQueries({ queryKey: ["zahlungen"] }),
      ]);

      onClose();
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Unbekannter Fehler.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetSplits = () => {
    setSplits(buildInitialSplits(payment, editMode, existingSplitPayments));
  };

  if (!payment || !payment.id) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fehler</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <p className="text-destructive">Ungültige Zahlungsdaten. Bitte versuchen Sie es erneut.</p>
            <Button onClick={onClose} className="mt-4 w-full">Schließen</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            {editMode ? <Pencil className="h-5 w-5" /> : <ArrowRightLeft className="h-5 w-5" />}
            <span>{editMode ? "Aufteilung bearbeiten" : "Zahlung aufteilen"}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Original Payment Info */}
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold">
                    {editMode ? "Aufgeteilte Zahlung" : "Ursprüngliche Zahlung"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {payment?.buchungsdatum
                      ? new Date(payment.buchungsdatum).toLocaleDateString("de-DE")
                      : "—"}{" "}
                    • {payment?.kategorie}
                  </p>
                </div>
                <p className="text-2xl font-bold text-primary">{formatBetrag(originalAmount)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Balance Indicator */}
          <div className="flex items-center justify-center space-x-8 p-4 bg-muted/20 rounded-lg">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Gesamt aufgeteilt</p>
              <p className="text-lg font-semibold">{formatBetrag(totalSplitAmount)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Verbleibt</p>
              <p className={`text-lg font-semibold ${isBalanced ? "text-green-600" : "text-red-600"}`}>
                {formatBetrag(remainingAmount)}
              </p>
            </div>
          </div>

          {/* Warning: incomplete split group in edit mode */}
          {editMode && existingSplitPayments.length <= 1 && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Es wurde nur {existingSplitPayments.length === 0 ? "keine" : "eine"} Teilzahlung dieser Gruppe gefunden. Eine weitere Teilzahlung fehlt möglicherweise oder wurde gelöscht. Bitte prüfen Sie die Zahlungsdaten.
            </div>
          )}

          {/* Split Configuration */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Teilzahlungen ({splits.length})</h3>
              <div className="flex gap-2">
                {editMode && (
                  <Button onClick={resetSplits} variant="outline" size="sm">
                    Zurücksetzen
                  </Button>
                )}
                <Button onClick={addSplit} size="sm" disabled={splits.length >= 20}>
                  <Plus className="h-4 w-4 mr-1" />
                  Weitere Teilung
                </Button>
              </div>
            </div>

            {splits.map((split, index) => (
              <Card key={split.id} className="relative">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="outline">Teilzahlung {index + 1}</Badge>
                    {splits.length > 1 && (
                      <Button
                        onClick={() => removeSplit(split.id)}
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 h-7 w-7 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Betrag</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={split.betrag}
                        onChange={(e) => updateSplit(split.id, "betrag", parseFloat(e.target.value) || 0)}
                        className="text-right h-8 text-sm"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Kategorie</Label>
                      <Select
                        value={split.kategorie}
                        onValueChange={(v) => updateSplit(split.id, "kategorie", v)}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Monat</Label>
                      {monthOptions.length > 0 ? (
                        <Select
                          value={split.zugeordneter_monat}
                          onValueChange={(v) => updateSplit(split.id, "zugeordneter_monat", v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Monat wählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {monthOptions.map((m) => (
                              <SelectItem key={m} value={m}>
                                {formatMonthLabel(m)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type="month"
                          value={split.zugeordneter_monat}
                          onChange={(e) => updateSplit(split.id, "zugeordneter_monat", e.target.value)}
                          className="h-8 text-sm"
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Verwendungszweck (optional)</Label>
                      <Input
                        value={split.verwendungszweck}
                        onChange={(e) => updateSplit(split.id, "verwendungszweck", e.target.value)}
                        placeholder="Beschreibung"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button onClick={onClose} variant="outline">
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isBalanced || splits.length <= 1 || isLoading}
              className="min-w-[140px]"
            >
              {isLoading
                ? "Wird gespeichert..."
                : editMode
                ? "Änderungen speichern"
                : "Zahlung aufteilen"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
