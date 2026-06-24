import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Edit2, 
  Check, 
  X, 
  Trash2, 
  Calendar, 
  ArrowRightLeft, 
  AlertCircle,
  Split,
  Eye,
  EyeOff,
  FileText,
  Wallet,
  GripVertical,
  Clock,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { PaymentSplitModal } from "../PaymentSplitModal";


interface MietvertragTimelineViewProps {
  forderungen: any[];
  zahlungen: any[];
  allMietvertraege?: any[];
  vertragId: string;
  vertrag?: any;
  formatDatum: (datum: string) => string;
  formatBetrag: (betrag: number) => string;
}

const KATEGORIE_LABEL: Record<string, string> = { Betriebskostenabrechnung: "BKA (Mieter)" };

export function MietvertragTimelineView({
  forderungen,
  zahlungen,
  allMietvertraege,
  vertragId,
  vertrag,
  formatDatum,
  formatBetrag
}: MietvertragTimelineViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [editingPayment, setEditingPayment] = useState<{ zahlungId: string, field: 'kategorie' | 'monat' | 'mietvertrag' | 'gebuehr' } | null>(null);
  const [editPaymentValue, setEditPaymentValue] = useState<string>("");
  const [mietvertragSearchTerm, setMietvertragSearchTerm] = useState<string>("");
  const [editingForderung, setEditingForderung] = useState<{ forderungId: string, field: 'betrag' | 'monat' } | null>(null);
  const [editForderungValue, setEditForderungValue] = useState<string>("");
  const [draggedPayment, setDraggedPayment] = useState<string | null>(null);
  const [splittingPayment, setSplittingPayment] = useState<any | null>(null);
  const [splitEditMode, setSplitEditMode] = useState(false);
  const [splitEditPayments, setSplitEditPayments] = useState<any[]>([]);
  const [showIgnoredPayments, setShowIgnoredPayments] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Drag and drop handlers
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, zahlungId: string) => {
    setDraggedPayment(zahlungId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', zahlungId);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>, targetMonth: string) => {
    event.preventDefault();
    const zahlungId = event.dataTransfer.getData('text/plain');

    if (!zahlungId || !targetMonth) return;

    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({ zugeordneter_monat: targetMonth })
        .eq('id', zahlungId);

      if (error) throw error;

      toast({
        title: "Zahlung verschoben",
        description: `Zahlung wurde zu ${new Date(targetMonth + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} verschoben.`,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
      ]);

    } catch (error) {
      toast({
        title: "Fehler",
        description: "Zahlung konnte nicht verschoben werden.",
        variant: "destructive",
      });
    }

    setDraggedPayment(null);
  };

  const handleDragEnd = () => {
    setDraggedPayment(null);
  };

  const handleDeleteForderung = async (forderungId: string) => {
    try {
      const { error } = await supabase
        .from('mietforderungen')
        .delete()
        .eq('id', forderungId);

      if (error) throw error;

      toast({
        title: "Gelöscht",
        description: "Forderung wurde erfolgreich gelöscht.",
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] }),
      ]);

    } catch (error) {
      toast({
        title: "Fehler",
        description: "Forderung konnte nicht gelöscht werden.",
        variant: "destructive",
      });
    }
  };

  const handleEditForderung = (forderungId: string, field: 'betrag' | 'monat', currentValue: string) => {
    setEditingForderung({ forderungId, field });
    setEditForderungValue(currentValue);
  };

  const handleSaveForderung = async (newValue: string) => {
    if (!editingForderung) return;

    try {
      const updateData: any = {};
      if (editingForderung.field === 'betrag') {
        updateData.sollbetrag = parseFloat(newValue) || 0;
      }

      const { error } = await supabase
        .from('mietforderungen')
        .update(updateData)
        .eq('id', editingForderung.forderungId);

      if (error) throw error;

      toast({
        title: "Erfolg",
        description: "Forderung wurde erfolgreich aktualisiert.",
        duration: 3000,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] }),
      ]);

      setEditingForderung(null);
      setEditForderungValue("");
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Forderung konnte nicht aktualisiert werden.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const handleCancelForderungEdit = () => {
    setEditingForderung(null);
    setEditForderungValue("");
  };

  const handleEditPaymentField = (zahlungId: string, field: 'kategorie' | 'monat' | 'mietvertrag' | 'gebuehr', currentValue: string) => {
    const zahlung = zahlungen?.find(z => z.id === zahlungId);

    setEditingPayment({ zahlungId, field });
    if (field === 'mietvertrag') {
      setEditPaymentValue(zahlung?.mietvertrag_id || '');
    } else if (field === 'monat') {
      // Normalize to "YYYY-MM" — stored values may have "-DD" suffix from old split bug
      const monthValue = (zahlung?.zugeordneter_monat || zahlung?.buchungsdatum || '').slice(0, 7);
      setEditPaymentValue(monthValue);
    } else {
      setEditPaymentValue(currentValue || '');
    }
  };

  const handleSavePaymentField = async (customValue?: string) => {
    if (!editingPayment) return;

    const valueToSave = customValue !== undefined ? customValue : editPaymentValue;

    try {
      let updateData: any = {};

      if (editingPayment.field === 'kategorie') {
        updateData.kategorie = valueToSave as any;
      } else if (editingPayment.field === 'monat') {
        updateData.zugeordneter_monat = valueToSave;
      } else if (editingPayment.field === 'mietvertrag') {
        updateData.mietvertrag_id = valueToSave;
      }

      const { error } = await supabase
        .from('zahlungen')
        .update(updateData)
        .eq('id', editingPayment.zahlungId);

      if (error) throw error;

      toast({
        title: "Aktualisiert",
        description: `${editingPayment.field === 'kategorie' ? 'Kategorie' :
          editingPayment.field === 'monat' ? 'Zugeordneter Monat' :
          editingPayment.field === 'gebuehr' ? 'Gebühr' :
            'Mietvertrag'} wurde erfolgreich aktualisiert.`,
      });

      setEditingPayment(null);
      setEditPaymentValue('');

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-details', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
      ]);

    } catch (error) {
      toast({
        title: "Fehler",
        description: `${editingPayment.field === 'kategorie' ? 'Kategorie' :
          editingPayment.field === 'monat' ? 'Zugeordneter Monat' :
          editingPayment.field === 'gebuehr' ? 'Gebühr' :
            'Mietvertrag'} konnte nicht aktualisiert werden.`,
        variant: "destructive",
      });
    }
  };

  const handleCancelPaymentEdit = () => {
    setEditingPayment(null);
    setEditPaymentValue('');
    setMietvertragSearchTerm('');
  };

  // Helper function to check if payment is from a split
  const isSplitPayment = (zahlung: any) => {
    const verwendungszweck = zahlung.verwendungszweck || '';
    return verwendungszweck.includes('SPLIT_GROUP_');
  };

  // Helper function to get split group payments
  const getSplitGroupPayments = (zahlung: any) => {
    if (!isSplitPayment(zahlung)) return [];
    
    const verwendungszweck = zahlung.verwendungszweck || '';
    const splitMatch = verwendungszweck.match(/SPLIT_GROUP_(\d+)_/);
    if (!splitMatch) return [];
    
    const splitTimestamp = splitMatch[1];
    return zahlungen.filter(z => {
      const zVerwendungszweck = z.verwendungszweck || '';
      return zVerwendungszweck.includes(`SPLIT_GROUP_${splitTimestamp}_`);
    });
  };
  // Lastschrift pending is no longer used - all payments count immediately

  // Group data by months for timeline display
  const monthlyData = new Map();

  // Add ALL months with Forderungen
  if (forderungen) {
    forderungen.forEach(forderung => {
      const month = forderung.sollmonat?.slice(0, 7);
      if (!month) return;
      if (!monthlyData.has(month)) {
        monthlyData.set(month, { forderungen: [], zahlungen: [] });
      }
      monthlyData.get(month).forderungen.push(forderung);
    });
  }

  // Add ALL payments and create months for them if they don't exist
  zahlungen.forEach(zahlung => {
    // Normalize zugeordneter_monat to "YYYY-MM" (may be stored as "YYYY-MM-DD" from split bug)
    const assignedMonth = (zahlung.zugeordneter_monat || zahlung.buchungsdatum || '').slice(0, 7) || null;

    if (assignedMonth) {
      if (!monthlyData.has(assignedMonth)) {
        monthlyData.set(assignedMonth, { forderungen: [], zahlungen: [] });
      }
      monthlyData.get(assignedMonth).zahlungen.push(zahlung);
    }
  });

  // Sort months chronologically (newest first)
  const allSortedMonths = Array.from(monthlyData.keys()).sort().reverse();
  
  // Extract available years for navigation
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    allSortedMonths.forEach(month => {
      const year = parseInt(month.split('-')[0]);
      years.add(year);
    });
    return Array.from(years).sort().reverse();
  }, [allSortedMonths]);

  const availableMonthsForSplit = useMemo(() => {
    const months = new Set<string>();
    forderungen?.forEach(f => { if (f.sollmonat) months.add(f.sollmonat.slice(0, 7)); });
    zahlungen.forEach(z => {
      if (z.zugeordneter_monat) months.add(z.zugeordneter_monat.slice(0, 7));
      if (z.buchungsdatum) months.add(z.buchungsdatum.slice(0, 7));
    });
    return Array.from(months).sort().reverse();
  }, [forderungen, zahlungen]);

  // Filter months by selected year (or show all if no year selected)
  const sortedMonths = useMemo(() => {
    if (selectedYear === null) return allSortedMonths;
    return allSortedMonths.filter(month => month.startsWith(`${selectedYear}-`));
  }, [allSortedMonths, selectedYear]);

  if (allSortedMonths.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground text-lg">Keine Zahlungen oder Forderungen gefunden</p>
      </div>
    );
  }

  const hasIgnoredPayments = zahlungen.some(z => z.kategorie === 'Ignorieren');

  // Render a Forderung Card
  const renderForderungCard = (forderung: any, index: number, total: number) => (
    <div 
      key={forderung.id} 
      className="group relative bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/30 dark:to-red-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl p-3 sm:p-4 shadow-sm hover:shadow-md transition-all duration-200"
    >
      {/* Delete button */}
      <Button
        onClick={() => handleDeleteForderung(forderung.id)}
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-100"
        title="Forderung löschen"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
      
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-rose-100 dark:bg-rose-900/50">
          <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-600 dark:text-rose-400" />
        </div>
        <span className="text-xs sm:text-sm font-medium text-rose-700 dark:text-rose-300">
          Forderung {total > 1 ? `${index + 1}/${total}` : ''}
        </span>
      </div>
      
      {/* Amount */}
      {editingForderung?.forderungId === forderung.id && editingForderung?.field === 'betrag' ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={editForderungValue}
            onChange={(e) => setEditForderungValue(e.target.value)}
            className="w-24 h-8 text-center text-sm"
            step="0.01"
          />
          <Button onClick={() => handleSaveForderung(editForderungValue)} size="sm" className="h-7 w-7 p-0 bg-rose-600 hover:bg-rose-700">
            <Check className="h-3 w-3" />
          </Button>
          <Button onClick={handleCancelForderungEdit} size="sm" variant="outline" className="h-7 w-7 p-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <p 
          className="text-lg sm:text-xl font-bold text-rose-700 dark:text-rose-300 cursor-pointer hover:bg-rose-100/50 dark:hover:bg-rose-900/30 px-2 py-1 rounded-lg inline-block transition-colors"
          onClick={() => handleEditForderung(forderung.id, 'betrag', forderung.sollbetrag.toString())}
        >
          {formatBetrag(Number(forderung.sollbetrag))}
        </p>
      )}
    </div>
  );

  // Render a Zahlung Card
  const renderZahlungCard = (zahlung: any) => {
    const isIgnored = zahlung.kategorie === 'Ignorieren';
    const isKaution = zahlung.kategorie === 'Mietkaution';
    const isBKA = zahlung.kategorie === 'Betriebskostenabrechnung';

    const bgColor = isIgnored
      ? 'from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30'
      : isKaution
        ? 'from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30'
        : isBKA
          ? 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30'
          : 'from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30';

    const borderColor = isIgnored
      ? 'border-gray-200 dark:border-gray-800/50 border-dashed'
      : isKaution
        ? 'border-blue-200 dark:border-blue-800/50'
        : isBKA
          ? 'border-amber-200 dark:border-amber-800/50'
          : 'border-emerald-200 dark:border-emerald-800/50';
    const iconBg = isIgnored
      ? 'bg-gray-100 dark:bg-gray-900/50'
      : isKaution
        ? 'bg-blue-100 dark:bg-blue-900/50'
        : isBKA
          ? 'bg-amber-100 dark:bg-amber-900/50'
          : 'bg-emerald-100 dark:bg-emerald-900/50';

    const iconColor = isIgnored
      ? 'text-gray-400'
      : isKaution
        ? 'text-blue-600 dark:text-blue-400'
        : isBKA
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-emerald-600 dark:text-emerald-400';

    const textColor = isIgnored
      ? 'text-gray-400'
      : isKaution
        ? 'text-blue-700 dark:text-blue-300'
        : isBKA
          ? 'text-amber-700 dark:text-amber-300'
          : 'text-emerald-700 dark:text-emerald-300';

    return (
      <div
        key={zahlung.id}
        className={`group relative bg-gradient-to-br ${bgColor} border ${borderColor} rounded-xl p-3 sm:p-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-move ${
          isIgnored ? 'opacity-50 hover:opacity-80' : ''
        }`}
        draggable
        onDragStart={(e) => handleDragStart(e, zahlung.id)}
        onDragEnd={handleDragEnd}
      >
        {/* Drag handle */}
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-50 transition-opacity">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Lastschrift Pending Badge with remaining days */}

        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full ${iconBg}`}>
            <Wallet className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${iconColor}`} />
          </div>
          <span className={`text-xs sm:text-sm font-medium ${textColor}`}>
            Zahlung
          </span>
        </div>

        {/* Amount */}
        <p className={`text-lg sm:text-xl font-bold ${textColor} mb-1`}>
          {formatBetrag(Number(zahlung.betrag))}
        </p>

        {/* Date */}
        <p className="text-xs sm:text-sm text-muted-foreground mb-1">
          {zahlung.buchungsdatum ? formatDatum(zahlung.buchungsdatum) : '—'}
        </p>

        {/* Empfänger / Auftraggeber */}
        {zahlung.empfaengername && (
          <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">
            <span className="font-medium">Von/An:</span> {zahlung.empfaengername}
          </p>
        )}

        {/* Verwendungszweck */}
        {zahlung.verwendungszweck && !zahlung.verwendungszweck.startsWith('SPLIT_GROUP_') && (
          <p className="text-[10px] sm:text-xs text-muted-foreground mb-2 line-clamp-2">
            {zahlung.verwendungszweck.split(' | SPLIT_GROUP_')[0]}
          </p>
        )}

        {/* Action Badges */}
        <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-2">
          {/* Kategorie */}
          {editingPayment?.zahlungId === zahlung.id && editingPayment.field === 'kategorie' ? (
            <div className="flex items-center gap-1 flex-wrap">
              <Select value={editPaymentValue} onValueChange={setEditPaymentValue}>
                <SelectTrigger className="w-24 sm:w-28 h-6 sm:h-7 text-[10px] sm:text-xs">
                  <SelectValue placeholder="Kategorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Miete">Miete</SelectItem>
                  <SelectItem value="Mietkaution">Mietkaution</SelectItem>
                  <SelectItem value="Betriebskostenabrechnung">BKA (Mieter)</SelectItem>
                  <SelectItem value="Rücklastschrift">Rücklastschrift</SelectItem>
                  <SelectItem value="Ignorieren">Ignorieren</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => handleSavePaymentField()} size="sm" className="h-6 w-6 p-0">
                <Check className="h-3 w-3" />
              </Button>
              <Button onClick={handleCancelPaymentEdit} size="sm" variant="outline" className="h-6 w-6 p-0">
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Badge 
                variant={isIgnored ? 'secondary' : 'outline'} 
                className={`text-[10px] sm:text-xs ${isIgnored ? 'bg-gray-100 text-gray-400' : ''}`}
              >
                {KATEGORIE_LABEL[zahlung.kategorie] ?? zahlung.kategorie ?? 'Sonstige'}
              </Badge>
              <Button
                onClick={() => handleEditPaymentField(zahlung.id, 'kategorie', zahlung.kategorie || '')}
                size="sm"
                variant="ghost"
                className="h-5 w-5 sm:h-6 sm:w-6 p-0 opacity-60 hover:opacity-100"
              >
                <Edit2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              </Button>
              {!isSplitPayment(zahlung) ? (
                <Button
                  onClick={() => { setSplitEditMode(false); setSplitEditPayments([]); setSplittingPayment(zahlung); }}
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 sm:h-6 sm:w-6 p-0 opacity-60 hover:opacity-100 text-blue-600 hover:text-blue-800"
                  title="Zahlung aufteilen"
                >
                  <Split className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const groupPayments = getSplitGroupPayments(zahlung);
                    setSplitEditMode(true);
                    setSplitEditPayments(groupPayments);
                    setSplittingPayment(zahlung);
                  }}
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 sm:h-6 sm:w-6 p-0 opacity-60 hover:opacity-100 text-amber-600 hover:text-amber-800"
                  title="Aufteilung bearbeiten"
                >
                  <Split className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Month Edit */}
        <div className="mt-2">
          {editingPayment?.zahlungId === zahlung.id && editingPayment.field === 'monat' ? (
            <div className="flex items-center gap-1 flex-wrap">
              <Select value={editPaymentValue} onValueChange={(value) => setEditPaymentValue(value)}>
                <SelectTrigger className="w-28 sm:w-32 h-6 sm:h-7 text-[10px] sm:text-xs">
                  <SelectValue placeholder="Monat wählen" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const availableMonths = new Set<string>();
                    (forderungen || []).forEach(forderung => {
                      if (forderung.sollmonat) availableMonths.add(forderung.sollmonat.slice(0, 7));
                    });
                    const now = new Date();
                    for (let i = -6; i <= 12; i++) {
                      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
                      const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                      availableMonths.add(monthStr);
                    }
                    return Array.from(availableMonths).sort().map(month => {
                      const [year, monthNum] = month.split('-');
                      const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleDateString('de-DE', { 
                        year: 'numeric', 
                        month: 'long' 
                      });
                      return <SelectItem key={month} value={month}>{monthName}</SelectItem>;
                    });
                  })()}
                </SelectContent>
              </Select>
              <Button onClick={() => handleSavePaymentField()} size="sm" className="h-6 w-6 p-0">
                <Check className="h-3 w-3" />
              </Button>
              <Button onClick={handleCancelPaymentEdit} size="sm" variant="outline" className="h-6 w-6 p-0">
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="text-[10px] sm:text-xs">
                {(() => {
                  const raw = (zahlung.zugeordneter_monat || zahlung.buchungsdatum || '').slice(0, 7);
                  if (!raw) return 'Unzugeordnet';
                  const [y, m] = raw.split('-');
                  return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('de-DE', { year: 'numeric', month: 'long' });
                })()}
              </Badge>
              {(() => {
                const buchDatum = zahlung.buchungsdatum;
                const zahlungsJahr = buchDatum ? new Date(buchDatum).getFullYear() : 0;
                const hatForderungen = (forderungen || []).length > 0;
                const canEditMonth = zahlungsJahr >= 2025 && hatForderungen;
                return canEditMonth ? (
                  <Button
                    onClick={() => handleEditPaymentField(zahlung.id, 'monat', zahlung.zugeordneter_monat || '')}
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 sm:h-6 sm:w-6 p-0 opacity-60 hover:opacity-100"
                  >
                    <Calendar className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                  </Button>
                ) : null;
              })()}
            </div>
          )}
        </div>

        {/* Mietvertrag Edit */}
        <div className="mt-2">
          {editingPayment?.zahlungId === zahlung.id && editingPayment.field === 'mietvertrag' ? (
            <div className="space-y-2">
              <Input
                placeholder="Suche Mietvertrag..."
                value={mietvertragSearchTerm}
                onChange={(e) => setMietvertragSearchTerm(e.target.value)}
                className="w-full h-7 text-xs"
              />
              <div className="max-h-28 overflow-y-auto space-y-1">
                {allMietvertraege?.filter(mv => {
                  if (!mietvertragSearchTerm) return true;
                  const searchTerm = mietvertragSearchTerm.toLowerCase();
                  const mieterNames = mv.mietvertrag_mieter?.map((mm: any) => `${mm.mieter?.vorname} ${mm.mieter?.nachname}`).join(', ') || '';
                  const immobilieName = mv.einheiten?.immobilien?.name || '';
                  const adresse = mv.einheiten?.immobilien?.adresse || '';
                  const einheitId = mv.einheit_id || '';
                  return mieterNames.toLowerCase().includes(searchTerm) ||
                         immobilieName.toLowerCase().includes(searchTerm) ||
                         adresse.toLowerCase().includes(searchTerm) ||
                         einheitId.toLowerCase().includes(searchTerm);
                }).map(mv => {
                  const mieterNames = mv.mietvertrag_mieter?.map((mm: any) => `${mm.mieter?.vorname} ${mm.mieter?.nachname}`).join(', ') || 'Keine Mieter';
                  const einheitId = mv.einheit_id?.slice(-2) || 'XX';
                  return (
                    <button
                      key={mv.id}
                      onClick={() => handleSavePaymentField(mv.id)}
                      className="w-full text-left p-2 text-xs bg-background hover:bg-muted rounded-lg transition-colors"
                    >
                      <div className="font-medium">{mv.einheiten?.immobilien?.name} - Einheit {einheitId}</div>
                      <div className="text-muted-foreground">{mv.einheiten?.immobilien?.adresse}</div>
                      <div className="text-primary mt-1">{mieterNames}</div>
                    </button>
                  );
                })}
              </div>
              <Button onClick={handleCancelPaymentEdit} size="sm" variant="outline" className="h-6 text-xs">
                Abbrechen
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] sm:text-xs">
                <ArrowRightLeft className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-1" />
                Objekt
              </Badge>
              <Button
                onClick={() => handleEditPaymentField(zahlung.id, 'mietvertrag', zahlung.mietvertrag_id || '')}
                size="sm"
                variant="ghost"
                className="h-5 w-5 sm:h-6 sm:w-6 p-0 opacity-60 hover:opacity-100"
              >
                <Edit2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="relative px-2 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8">
      {/* Year Navigation & Controls */}
      <div className="mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* Year Filter */}
        {availableYears.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">Jahr:</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const currentIndex = selectedYear === null ? -1 : availableYears.indexOf(selectedYear);
                  const nextIndex = currentIndex + 1;
                  if (nextIndex < availableYears.length) {
                    setSelectedYear(availableYears[nextIndex]);
                  }
                }}
                disabled={selectedYear === availableYears[availableYears.length - 1]}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <Select 
                value={selectedYear?.toString() || 'alle'} 
                onValueChange={(v) => setSelectedYear(v === 'alle' ? null : parseInt(v))}
              >
                <SelectTrigger className="w-24 h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">Alle</SelectItem>
                  {availableYears.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const currentIndex = selectedYear === null ? availableYears.length : availableYears.indexOf(selectedYear);
                  const prevIndex = currentIndex - 1;
                  if (prevIndex >= 0) {
                    setSelectedYear(availableYears[prevIndex]);
                  } else if (selectedYear !== null) {
                    setSelectedYear(null);
                  }
                }}
                disabled={selectedYear === null}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            {selectedYear !== null && (
              <Badge variant="secondary" className="text-xs">
                {sortedMonths.length} Monate
              </Badge>
            )}
          </div>
        )}
        
        {/* Toggle for ignored payments */}
        {hasIgnoredPayments && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIgnoredPayments(!showIgnoredPayments)}
            className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground"
          >
            {showIgnoredPayments ? (
              <>
                <EyeOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Ignorierte ausblenden</span>
                <span className="sm:hidden">Ausblenden</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Ignorierte anzeigen</span>
                <span className="sm:hidden">Anzeigen</span>
              </>
            )}
          </Button>
        )}
      </div>
      
      {/* Timeline */}
      <div className="relative">
        {/* Central Timeline Line - Hidden on mobile */}
        <div className="hidden md:block absolute left-1/2 top-0 w-0.5 bg-gradient-to-b from-primary/60 via-primary/40 to-primary/20 h-full transform -translate-x-0.5 z-0" />

        {sortedMonths.map((month) => {
          if (!month || month === 'undefined') return null;
          const data = monthlyData.get(month);
          if (!data) return null;
          const monthDate = new Date(month + '-01');
          const forderungenData = data.forderungen;
          const zahlungenData = data.zahlungen.filter((zahlung: any) => {
            if (zahlung.kategorie === 'Nebenkosten') return false;
            if (zahlung.kategorie === 'Ignorieren' && !showIgnoredPayments) return false;
            return true;
          });

          // Skip months with no visible data
          if (forderungenData.length === 0 && zahlungenData.length === 0) return null;

          return (
            <div
              key={month}
              className="relative mb-6 sm:mb-10 md:mb-16 animate-fade-in"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, month)}
            >
              {/* Month marker */}
              <div className="flex items-center justify-center mb-4 sm:mb-6">
                {/* Timeline dot - Hidden on mobile */}
                <div className="hidden md:block absolute left-1/2 w-4 h-4 bg-primary rounded-full border-2 border-background shadow-md transform -translate-x-1/2 z-10" />
                
                {/* Month badge */}
                <div className="bg-background shadow-md rounded-full px-3 sm:px-4 py-1.5 sm:py-2 border border-border z-20">
                  <span className="text-xs sm:text-sm font-semibold text-primary">
                    {monthDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* Content Grid - Stacked on mobile, side-by-side on desktop */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-8">
                {/* Left side - Forderungen */}
                <div className="md:pr-6 lg:pr-10 order-1">
                  {forderungenData.length > 0 && (
                    <div className="space-y-2 sm:space-y-3">
                      {forderungenData.map((forderung: any, index: number) => 
                        renderForderungCard(forderung, index, forderungenData.length)
                      )}
                    </div>
                  )}
                </div>

                {/* Right side - Zahlungen */}
                <div className="md:pl-6 lg:pl-10 order-2">
                  {zahlungenData.length > 0 && (
                    <div className="space-y-2 sm:space-y-3">
                      {zahlungenData.map((zahlung: any) => renderZahlungCard(zahlung))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <PaymentSplitModal
        isOpen={!!splittingPayment}
        onClose={() => { setSplittingPayment(null); setSplitEditMode(false); setSplitEditPayments([]); }}
        payment={splittingPayment}
        vertragId={vertragId}
        formatBetrag={formatBetrag}
        availableMonths={availableMonthsForSplit}
        editMode={splitEditMode}
        existingSplitPayments={splitEditPayments}
      />
    </div>
  );
}
