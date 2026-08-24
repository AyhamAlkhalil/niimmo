import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Undo2, AlertTriangle, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface PaymentUndoSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  splitPayments: any[];
  vertragId: string;
  formatBetrag: (betrag: number) => string;
}

export function PaymentUndoSplitModal({
  isOpen,
  onClose,
  splitPayments,
  vertragId,
  formatBetrag
}: PaymentUndoSplitModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  // Extract original payment data from the first split payment
  const extractOriginalPayment = () => {
    if (splitPayments.length === 0) return null;
    
    const firstPayment = splitPayments[0];
    const verwendungszweck = firstPayment.verwendungszweck || '';
    
    // Check if this is a split payment with embedded original data
    const splitMatch = verwendungszweck.match(/SPLIT_GROUP_(\d+)_ORIGINAL_(.+)/);
    if (!splitMatch) return null;
    
    try {
      const originalData = JSON.parse(decodeURIComponent(splitMatch[2]));
      return {
        ...originalData,
        splitTimestamp: splitMatch[1]
      };
    } catch (error) {
      return null;
    }
  };

  const originalPayment = extractOriginalPayment();
  const totalSplitAmount = splitPayments.reduce((sum, payment) => sum + Number(payment.betrag), 0);

  const handleUndoSplit = async () => {
    if (!originalPayment) {
      toast({
        title: "Fehler",
        description: "Ursprüngliche Zahlungsdaten konnten nicht gefunden werden.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // First, restore the original payment
      const restoredPayment = {
        buchungsdatum: originalPayment.buchungsdatum,
        mietvertrag_id: originalPayment.mietvertrag_id,
        empfaengername: originalPayment.empfaengername,
        kategorie: originalPayment.kategorie,
        betrag: parseFloat(originalPayment.betrag.toFixed(2)),
        verwendungszweck: originalPayment.verwendungszweck || '',
        iban: originalPayment.iban,
        zugeordneter_monat: originalPayment.zugeordneter_monat,
        import_datum: originalPayment.import_datum || new Date().toISOString()
      };

      const { data: restoredPaymentData, error: restoreError } = await supabase
        .from('zahlungen')
        .insert([restoredPayment])
        .select();

      if (restoreError) {
        throw new Error(`Fehler beim Wiederherstellen der ursprünglichen Zahlung: ${restoreError.message}`);
      }

      // Then delete the split payments
      const splitPaymentIds = splitPayments.map(p => p.id);

      const { error: deleteError } = await supabase
        .from('zahlungen')
        .delete()
        .in('id', splitPaymentIds);

      if (deleteError) {
        // Try to rollback by deleting the restored payment
        if (restoredPaymentData && restoredPaymentData.length > 0) {
          await supabase
            .from('zahlungen')
            .delete()
            .eq('id', restoredPaymentData[0].id);
        }
        
        throw new Error(`Fehler beim Löschen der aufgeteilten Zahlungen: ${deleteError.message}`);
      }

      toast({
        title: "Aufteilen rückgängig gemacht",
        description: `Die ursprüngliche Zahlung von ${formatBetrag(Number(originalPayment.betrag))} wurde wiederhergestellt.`,
      });

      // Refresh queries
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] }),
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-details', vertragId] }),
          queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
          queryClient.invalidateQueries({ queryKey: ['zahlungen'] }),
        ]);
      } catch (refreshError) {
        // Split wurde rueckgaengig gemacht, nur die Anzeige ist evtl. veraltet
        console.warn('Aktualisierung der Ansicht nach dem Split-Undo fehlgeschlagen:', refreshError);
      }

      onClose();

    } catch (error: any) {
      const errorMessage = error.message || 'Unbekannter Fehler beim Rückgängigmachen der Aufteilung.';
      toast({
        title: "Fehler beim Rückgängigmachen",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!originalPayment) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fehler</DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <p className="text-destructive">Diese Zahlungen können nicht rückgängig gemacht werden, da keine ursprünglichen Zahlungsdaten gefunden wurden.</p>
            <Button onClick={onClose} className="mt-4 w-full">
              Schließen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Undo2 className="h-5 w-5" />
            <span>Zahlung-Aufteilung rückgängig machen</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Warning */}
          <div className="flex items-start space-x-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800">Achtung</p>
              <p className="text-sm text-yellow-700">
                Diese Aktion löscht alle {splitPayments.length} aufgeteilten Zahlungen und stellt die ursprüngliche Zahlung wieder her.
              </p>
            </div>
          </div>

          {/* Current Split Payments */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Aktuelle aufgeteilte Zahlungen ({splitPayments.length})</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {splitPayments.map((payment, index) => (
                <Card key={payment.id} className="bg-red-50 border-red-200">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <Badge variant="outline" className="text-xs mb-1">
                          Teilzahlung {index + 1}
                        </Badge>
                        <p className="font-semibold text-red-700">{formatBetrag(Number(payment.betrag))}</p>
                        <p className="text-sm text-muted-foreground">{payment.kategorie}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        {new Date(payment.buchungsdatum).toLocaleDateString('de-DE')}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-2 text-right">
              <p className="text-sm text-muted-foreground">
                Gesamtsumme: <span className="font-semibold">{formatBetrag(totalSplitAmount)}</span>
              </p>
            </div>
          </div>

          {/* Original Payment Preview */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Ursprüngliche Zahlung (wird wiederhergestellt)
            </h3>
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-2xl font-bold text-green-700 mb-1">
                      {formatBetrag(Number(originalPayment.betrag))}
                    </p>
                    <p className="text-sm text-muted-foreground mb-1">
                      {new Date(originalPayment.buchungsdatum).toLocaleDateString('de-DE')}
                    </p>
                    <Badge variant="outline" className="text-sm">
                      {originalPayment.kategorie}
                    </Badge>
                    {originalPayment.verwendungszweck && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {originalPayment.verwendungszweck}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button onClick={onClose} variant="outline">
              Abbrechen
            </Button>
            <Button 
              onClick={handleUndoSplit}
              disabled={isLoading}
              variant="destructive"
              className="min-w-[140px]"
            >
              {isLoading ? 'Wird rückgängig gemacht...' : 'Rückgängig machen'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}