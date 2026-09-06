import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, ArrowRight, Loader2, Copy, CheckCheck, Square, Edit2, Pencil } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PaymentCorrectionDialog } from "./PaymentCorrectionDialog";

interface ProcessedPayment {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  mietvertrag_id: string | null;
  immobilie_id?: string | null;
  kategorie: string;
  zuordnungsgrund: string;
  confidence: number;
  mieter_name?: string;
  immobilie_name?: string;
  selected?: boolean;
}

interface ImmobilieOption {
  id: string;
  name: string;
  adresse: string;
}

interface DuplicatePayment {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  existingId: string;
}

interface Stats {
  total: number;
  neue: number;
  duplikate: number;
  zugeordnet: number;
  nicht_zugeordnet: number;
  nach_kategorie: {
    miete: number;
    mietkaution: number;
    ruecklastschrift: number;
    nichtmiete: number;
    betriebskostenabrechnung: number;
  };
  durchschnittliche_konfidenz: number;
}

interface ContractOption {
  id: string;
  mieter: string;
  immobilie: string;
  adresse?: string;
  gesamtmiete: number;
  start_datum?: string;
  ende_datum?: string;
  status?: string;
}

interface PaymentAssignmentResultsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ProcessedPayment[];
  duplicates: DuplicatePayment[];
  stats: Stats;
  /** Liefert zurueck, wie viele Zeilen tatsaechlich gespeichert wurden. */
  onApply: (selectedResults: ProcessedPayment[]) => Promise<
    { gesamt: number; gespeichert: number; fehler: Array<{ zeile: string; grund: string }> } | void
  >;
}

export function PaymentAssignmentResultsModal({
  open,
  onOpenChange,
  results,
  duplicates,
  stats,
  onApply,
}: PaymentAssignmentResultsModalProps) {
  const [isApplying, setIsApplying] = useState(false);
  
  // Fetch all contracts for manual correction dropdown
  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id,
          kaltmiete,
          betriebskosten,
          status,
          start_datum,
          ende_datum,
          einheiten!inner (
            etage,
            immobilien!inner (
              name,
              adresse
            )
          ),
          mietvertrag_mieter (
            mieter (
              vorname,
              nachname
            )
          )
        `)
        .in('status', ['aktiv', 'gekuendigt']);
      
      if (error) throw error;
      
      return (data || []).map((c: any) => {
        const mieterNames = c.mietvertrag_mieter?.map((mm: any) => 
          `${mm.mieter?.vorname || ''} ${mm.mieter?.nachname || ''}`.trim()
        ).filter(Boolean).join(', ') || 'Unbekannt';
        
        const immobilie = c.einheiten?.immobilien;
        const gesamtmiete = (c.kaltmiete || 0) + (c.betriebskosten || 0);
        
        return {
          id: c.id,
          mieter: mieterNames,
          immobilie: immobilie ? `${immobilie.name} - ${c.einheiten?.etage || ''}` : 'Unbekannt',
          adresse: immobilie?.adresse || '',
          gesamtmiete,
          start_datum: c.start_datum,
          ende_datum: c.ende_datum,
          status: c.status
        } as ContractOption;
      });
    },
    enabled: open
  });

  // Fetch immobilien for Nebenkosten assignment
  const { data: immobilien = [] } = useQuery<ImmobilieOption[]>({
    queryKey: ['immobilien-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('id, name, adresse')
        .order('name');
      if (error) throw error;
      return (data || []) as ImmobilieOption[];
    },
    enabled: open
  });
  
  // Show all payment results (Miete, Mietkaution, Rücklastschrift, etc.)
  // Only exclude "Nichtmiete" which is handled separately
  const mietResults = useMemo(() => 
    results.filter(r => r.kategorie !== "Nichtmiete"), 
    [results]
  );
  
  // Count Nichtmiete payments that will be saved anyway
  const nichtmieteCount = useMemo(() => 
    results.filter(r => r.kategorie === "Nichtmiete").length,
    [results]
  );
  
  // Track manual corrections
  const [manualCorrections, setManualCorrections] = useState<Record<number, string | null>>({});
  const [immobilieCorrections, setImmobilieCorrections] = useState<Record<number, string | null>>({});
  const [categoryCorrections, setCategoryCorrections] = useState<Record<number, string>>({});

  const KATEGORIE_OPTIONS = ["Miete", "Nichtmiete", "Mietkaution", "Rücklastschrift", "Nebenkosten", "Ignorieren", "Betriebskostenabrechnung"] as const;
  const KATEGORIE_LABEL: Record<string, string> = { Betriebskostenabrechnung: "BKA (Mieter)" };
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    // Default: select all Miete results with mietvertrag_id
    const defaultSelected = new Set<string>();
    mietResults.forEach((r, idx) => {
      if (r.mietvertrag_id && r.selected !== false) {
        defaultSelected.add(`${idx}`);
      }
    });
    return defaultSelected;
  });
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for correction dialog
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [selectedPaymentIdx, setSelectedPaymentIdx] = useState<number | null>(null);

  // Recalculate selected when mietResults change
  useEffect(() => {
    const newSelected = new Set<string>();
    mietResults.forEach((r, idx) => {
      if (r.selected !== false && r.mietvertrag_id) {
        newSelected.add(`${idx}`);
      }
    });
    setSelectedIds(newSelected);
    setManualCorrections({});
    setImmobilieCorrections({});
    setCategoryCorrections({});
  }, [mietResults]);

  const toggleSelection = (idx: number) => {
    const key = `${idx}`;
    const newSet = new Set(selectedIds);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    const newSet = new Set<string>();
    mietResults.forEach((_, idx) => newSet.add(`${idx}`));
    setSelectedIds(newSet);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Apply manual corrections to get final results
  const getFinalResults = () => {
    return mietResults
      .map((result, originalIdx) => {
        let updated = { ...result };
        
        // Apply category corrections
        const correctedCategory = categoryCorrections[originalIdx];
        if (correctedCategory) {
          updated.kategorie = correctedCategory;
        }

        const effectiveKategorie = updated.kategorie;

        // For Nebenkosten: apply immobilie corrections, clear mietvertrag
        if (effectiveKategorie === 'Nebenkosten') {
          const correctedImmobilieId = immobilieCorrections[originalIdx];
          if (correctedImmobilieId !== undefined) {
            const imm = immobilien.find(i => i.id === correctedImmobilieId);
            updated.immobilie_id = correctedImmobilieId;
            updated.immobilie_name = imm?.name || result.immobilie_name;
            updated.zuordnungsgrund = correctedImmobilieId
              ? `Manuell zugeordnet: ${imm?.name}`
              : 'Manuell entfernt';
          }
          // Nebenkosten should not have mietvertrag_id
          updated.mietvertrag_id = null;
        } else {
          // Apply contract corrections for non-Nebenkosten
          const correctedContractId = manualCorrections[originalIdx];
          if (correctedContractId !== undefined) {
            const correctedContract = contracts.find(c => c.id === correctedContractId);
            updated = {
              ...updated,
              mietvertrag_id: correctedContractId,
              immobilie_id: null,
              mieter_name: correctedContract?.mieter || result.mieter_name,
              immobilie_name: correctedContract?.immobilie || result.immobilie_name,
              zuordnungsgrund: correctedContractId 
                ? `Manuell korrigiert: ${correctedContract?.mieter}`
                : 'Manuell entfernt'
            };
          }
        }
        return updated;
      })
      .filter((_, originalIdx) => selectedIds.has(`${originalIdx}`));
  };

  const selectedResults = getFinalResults();
  const selectedWithAssignment = selectedResults.filter(r => r.mietvertrag_id || r.immobilie_id);
  
  // Check if import is possible (either Miete selected OR Nichtmiete present)
  const canImport = selectedIds.size > 0 || nichtmieteCount > 0;

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const ergebnis = (await onApply(selectedResults)) || undefined;
      // onApply meldet Fehlschlaege bereits selbst. Hier darf deshalb nur dann
      // Erfolg stehen, wenn wirklich alles gespeichert wurde.
      const fehlgeschlagen = ergebnis && 'fehler' in ergebnis ? ergebnis.fehler.length : 0;
      if (fehlgeschlagen === 0) {
        toast({
          title: "Zuordnungen übernommen",
          description: `${ergebnis && 'gespeichert' in ergebnis ? ergebnis.gespeichert : selectedWithAssignment.length} Zahlungen wurden gespeichert.`,
        });
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
      await queryClient.invalidateQueries({ queryKey: ['zahlungen'] });
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Die Zuordnungen konnten nicht übernommen werden.",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handleContractChange = (idx: number, value: string) => {
    setManualCorrections(prev => ({
      ...prev,
      [idx]: value === 'none' ? null : value
    }));
    // Auto-select when user makes a correction
    if (value !== 'none') {
      setSelectedIds(prev => new Set([...prev, `${idx}`]));
    }
  };

  const openCorrectionDialog = (idx: number) => {
    setSelectedPaymentIdx(idx);
    setCorrectionDialogOpen(true);
  };

  const handleCorrectionSelect = (contractId: string | null) => {
    if (selectedPaymentIdx !== null) {
      handleContractChange(selectedPaymentIdx, contractId || 'none');
    }
  };

  const handleImmobilieCorrectionSelect = (immobilieId: string | null) => {
    if (selectedPaymentIdx !== null) {
      setImmobilieCorrections(prev => ({
        ...prev,
        [selectedPaymentIdx]: immobilieId
      }));
      if (immobilieId) {
        setSelectedIds(prev => new Set([...prev, `${selectedPaymentIdx}`]));
      }
    }
  };

  const getEffectiveKategorie = (idx: number, result: ProcessedPayment) => {
    return categoryCorrections[idx] || result.kategorie;
  };

  const getSelectedPayment = () => {
    if (selectedPaymentIdx === null) return null;
    return mietResults[selectedPaymentIdx];
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 80) {
      return <Badge className="bg-green-100 text-green-800 border-green-200">{confidence}%</Badge>;
    } else if (confidence >= 50) {
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{confidence}%</Badge>;
    }
    return <Badge className="bg-red-100 text-red-800 border-red-200">{confidence}%</Badge>;
  };

  const getKategorieBadge = (kategorie: string) => {
    const colors: Record<string, string> = {
      Miete: "bg-blue-100 text-blue-800 border-blue-200",
      Mietkaution: "bg-purple-100 text-purple-800 border-purple-200",
      Rücklastschrift: "bg-red-100 text-red-800 border-red-200",
      Nichtmiete: "bg-gray-100 text-gray-800 border-gray-200",
      Ignorieren: "bg-gray-100 text-gray-500 border-gray-200",
      Betriebskostenabrechnung: "bg-amber-100 text-amber-800 border-amber-200",
    };
    return <Badge className={colors[kategorie] || "bg-gray-100"}>{KATEGORIE_LABEL[kategorie] ?? kategorie}</Badge>;
  };

  const getCurrentContractId = (idx: number, result: ProcessedPayment) => {
    return manualCorrections[idx] !== undefined 
      ? manualCorrections[idx] 
      : result.mietvertrag_id;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <TrendingUp className="h-5 w-5 text-primary" />
            AI-Zuordnungsergebnisse
            <Badge variant="outline" className="ml-2 bg-amber-50 text-amber-700">
              <Edit2 className="h-3 w-3 mr-1" />
              Korrektur möglich
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Stats Summary */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 py-3 border-b flex-shrink-0">
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">CSV Gesamt</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-orange-700">{stats.duplikate}</div>
            <div className="text-xs text-orange-600">Duplikate</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-blue-700">{stats.neue}</div>
            <div className="text-xs text-blue-600">Neue</div>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-green-700">{stats.zugeordnet}</div>
            <div className="text-xs text-green-600">Zugeordnet</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-amber-700">{stats.nicht_zugeordnet}</div>
            <div className="text-xs text-amber-600">Nicht zugeordnet</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-2 text-center">
            <div className="text-xl font-bold text-purple-700">{stats.durchschnittliche_konfidenz}%</div>
            <div className="text-xs text-purple-600">Ø Konfidenz</div>
          </div>
        </div>

        {/* Selection Controls */}
        <div className="flex items-center justify-between py-2 border-b flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} von {mietResults.length} ausgewählt
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs">
                <CheckCheck className="h-3 w-3 mr-1" />
                Alle
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll} className="h-7 text-xs">
                <Square className="h-3 w-3 mr-1" />
                Keine
              </Button>
            </div>
          </div>
          {selectedWithAssignment.length > 0 && (
            <Badge variant="outline" className="bg-green-50 text-green-700">
              {selectedWithAssignment.length} mit Zuordnung
            </Badge>
          )}
        </div>

        {/* Duplicates Info */}
        {duplicates.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 text-sm flex-shrink-0">
            <div className="flex items-center gap-2 text-orange-800 font-medium">
              <Copy className="h-4 w-4" />
              {duplicates.length} Duplikate übersprungen
            </div>
          </div>
        )}

        {/* Low confidence warning */}
        {mietResults.some(r => r.confidence < 50) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-sm flex-shrink-0">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Achtung:</span> Einige Zuordnungen haben niedrige Konfidenz. Bitte prüfen und ggf. korrigieren!
            </div>
          </div>
        )}

        {/* Results Table - Scrollable */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <Table className="min-w-[1050px]">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox 
                      checked={selectedIds.size === mietResults.length && mietResults.length > 0}
                      onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
                    />
                  </TableHead>
                  <TableHead className="w-[40px]">Status</TableHead>
                  <TableHead className="w-[80px]">Datum</TableHead>
                  <TableHead className="text-right w-[80px]">Betrag</TableHead>
                  <TableHead className="w-[130px]">Empfänger/Absender</TableHead>
                  <TableHead className="min-w-[180px]">Verwendungszweck</TableHead>
                  <TableHead className="w-[70px]">Kat.</TableHead>
                  <TableHead className="w-[180px]">Zuordnung</TableHead>
                  <TableHead className="w-[120px]">AI-Grund</TableHead>
                  <TableHead className="w-[50px]">%</TableHead>
                  <TableHead className="w-[70px] text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mietResults.map((result, idx) => {
                  const isSelected = selectedIds.has(`${idx}`);
                  const currentContractId = getCurrentContractId(idx, result);
                  const effectiveKategorie = getEffectiveKategorie(idx, result);
                  const isNebenkosten = effectiveKategorie === 'Nebenkosten';
                  const currentImmobilieId = immobilieCorrections[idx] !== undefined 
                    ? immobilieCorrections[idx] 
                    : result.immobilie_id || null;
                  const isManuallyChanged = manualCorrections[idx] !== undefined || immobilieCorrections[idx] !== undefined;
                  const needsAttention = result.confidence < 50;
                  const hasAssignment = isNebenkosten ? !!currentImmobilieId : !!currentContractId;
                  
                  return (
                    <TableRow 
                      key={idx} 
                      className={`
                        ${needsAttention ? "bg-red-50/50" : hasAssignment ? "" : "bg-amber-50/50"} 
                        ${!isSelected ? "opacity-50" : ""}
                        ${isManuallyChanged ? "bg-blue-50/50" : ""}
                      `}
                    >
                      <TableCell className="py-2">
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(idx)}
                        />
                      </TableCell>
                      <TableCell className="py-2">
                        {isManuallyChanged ? (
                          <Edit2 className="h-4 w-4 text-blue-600" />
                        ) : hasAssignment ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-sm">
                        {result.buchungsdatum && isValid(parseISO(result.buchungsdatum)) 
                          ? format(parseISO(result.buchungsdatum), "dd.MM.yy")
                          : "-"}
                      </TableCell>
                      <TableCell className={`text-right font-medium whitespace-nowrap py-2 text-sm ${
                        result.betrag < 0 ? "text-destructive" : "text-green-600"
                      }`}>
                        {result.betrag.toFixed(2)} €
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="text-xs font-medium text-foreground max-w-[150px] truncate" title={result.empfaengername || "-"}>
                          {result.empfaengername || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="text-xs whitespace-pre-wrap break-words leading-relaxed max-w-[200px]">
                          {result.verwendungszweck || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Select
                          value={categoryCorrections[idx] || result.kategorie}
                          onValueChange={(value) => setCategoryCorrections(prev => ({ ...prev, [idx]: value }))}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {KATEGORIE_OPTIONS.map(kat => (
                              <SelectItem key={kat} value={kat} className="text-xs">{KATEGORIE_LABEL[kat] ?? kat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-2">
                        {isNebenkosten ? (
                          /* Nebenkosten: show Immobilie */
                          currentImmobilieId ? (
                            <div className="text-xs">
                              <div className="font-medium truncate max-w-[200px]" title={
                                immobilien.find(i => i.id === currentImmobilieId)?.name || ''
                              }>
                                {immobilien.find(i => i.id === currentImmobilieId)?.name || result.immobilie_name || "Zugeordnet"}
                              </div>
                              <div className="text-muted-foreground truncate max-w-[200px]">
                                {immobilien.find(i => i.id === currentImmobilieId)?.adresse || ''}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600">Keine Immobilie</span>
                          )
                        ) : (
                          /* Non-Nebenkosten: show Mietvertrag */
                          currentContractId ? (
                            <div className="text-xs">
                              <div className="font-medium truncate max-w-[200px]" title={
                                contracts.find(c => c.id === currentContractId)?.mieter || result.mieter_name
                              }>
                                {contracts.find(c => c.id === currentContractId)?.mieter || result.mieter_name || "Zugeordnet"}
                              </div>
                              <div className="text-muted-foreground truncate max-w-[200px]" title={
                                contracts.find(c => c.id === currentContractId)?.immobilie || result.immobilie_name
                              }>
                                {contracts.find(c => c.id === currentContractId)?.immobilie || result.immobilie_name}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600">Nicht zugeordnet</span>
                          )
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="text-xs text-muted-foreground max-w-[150px] truncate" title={result.zuordnungsgrund}>
                          {result.zuordnungsgrund}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">{getConfidenceBadge(result.confidence)}</TableCell>
                      <TableCell className="py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openCorrectionDialog(idx)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Ändern
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {/* Info about Nichtmiete payments */}
        {nichtmieteCount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm flex-shrink-0">
            <div className="text-blue-800">
              <span className="font-medium">{nichtmieteCount} Nichtmiete-Zahlungen</span> werden automatisch für die Nebenkosten-Zuordnung gespeichert.
            </div>
          </div>
        )}

        <DialogFooter className="pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleApply} disabled={isApplying || !canImport}>
            {isApplying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Wird übernommen...
              </>
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" />
                 {selectedIds.size > 0 
                   ? `${selectedIds.size} Zahlungen${nichtmieteCount > 0 ? ` + ${nichtmieteCount} Nichtmiete` : ''} übernehmen`
                   : `${nichtmieteCount} Nichtmiete übernehmen`
                }
              </>
            )}
          </Button>
        </DialogFooter>

        {/* Correction Dialog */}
        <PaymentCorrectionDialog
          open={correctionDialogOpen}
          onOpenChange={setCorrectionDialogOpen}
          payment={getSelectedPayment()}
          mode={selectedPaymentIdx !== null && getEffectiveKategorie(selectedPaymentIdx, mietResults[selectedPaymentIdx]) === 'Nebenkosten' ? 'immobilie' : 'mietvertrag'}
          contracts={contracts}
          currentContractId={selectedPaymentIdx !== null ? getCurrentContractId(selectedPaymentIdx, mietResults[selectedPaymentIdx]) : null}
          onSelectContract={handleCorrectionSelect}
          immobilien={immobilien}
          currentImmobilieId={selectedPaymentIdx !== null ? (immobilieCorrections[selectedPaymentIdx] !== undefined ? immobilieCorrections[selectedPaymentIdx] : mietResults[selectedPaymentIdx]?.immobilie_id || null) : null}
          onSelectImmobilie={handleImmobilieCorrectionSelect}
        />
      </DialogContent>
    </Dialog>
  );
}
