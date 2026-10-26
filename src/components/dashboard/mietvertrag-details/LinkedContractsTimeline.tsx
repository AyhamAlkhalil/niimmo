import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeftRight, 
  Building2, 
  Home, 
  Car,
  X,
  GripVertical,
  AlertTriangle
} from "lucide-react";

interface LinkedContract {
  id: string;
  einheit_id: string;
  kaltmiete: number;
  betriebskosten: number;
  status: string;
  start_datum: string;
  ende_datum: string | null;
  einheit?: {
    id: string;
    etage: string;
    qm: number;
    immobilie?: {
      id: string;
      name: string;
      adresse: string;
    };
  };
}

interface LinkedContractsTimelineProps {
  currentContractId: string;
  currentContractLabel: string;
  linkedContract: LinkedContract;
  formatBetrag: (betrag: number) => string;
  formatDatum: (datum: string) => string;
  onClose: () => void;
}

interface TimelineEntry {
  id: string;
  type: 'forderung' | 'zahlung';
  month: string;
  amount: number;
  date: string;
  kategorie?: string;
  verwendungszweck?: string;
  contractId: string;
}

export function LinkedContractsTimeline({
  currentContractId,
  currentContractLabel,
  linkedContract,
  formatBetrag,
  formatDatum,
  onClose
}: LinkedContractsTimelineProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draggedPayment, setDraggedPayment] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<'current' | 'linked' | null>(null);

  // Fetch forderungen for current contract
  const { data: currentForderungen = [] } = useQuery({
    queryKey: ['mietforderungen', currentContractId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietforderungen')
        .select('*')
        .eq('mietvertrag_id', currentContractId)
        .order('sollmonat', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch zahlungen for current contract
  const { data: currentZahlungen = [] } = useQuery({
    queryKey: ['zahlungen-detail', currentContractId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .eq('mietvertrag_id', currentContractId)
        .order('buchungsdatum', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch forderungen for linked contract
  const { data: linkedForderungen = [] } = useQuery({
    queryKey: ['mietforderungen', linkedContract.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietforderungen')
        .select('*')
        .eq('mietvertrag_id', linkedContract.id)
        .order('sollmonat', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch zahlungen for linked contract
  const { data: linkedZahlungen = [] } = useQuery({
    queryKey: ['zahlungen-detail', linkedContract.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .eq('mietvertrag_id', linkedContract.id)
        .order('buchungsdatum', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Determine icon based on unit type (simple heuristic)
  const getUnitIcon = (einheit: any) => {
    if (!einheit) return <Home className="h-4 w-4" />;
    const qm = einheit.qm || 0;
    if (qm < 20) return <Car className="h-4 w-4" />; // Likely parking/garage
    return <Home className="h-4 w-4" />;
  };

  const getLinkedContractLabel = () => {
    const einheit = linkedContract.einheit;
    if (!einheit) return `Vertrag ${linkedContract.id.slice(-4)}`;
    const immobilie = einheit.immobilie?.name || 'Unbekannt';
    return `${immobilie} - ${einheit.etage || 'EG'}`;
  };

  // Group entries by month
  const groupByMonth = (forderungen: any[], zahlungen: any[]) => {
    const monthlyData = new Map<string, { forderungen: any[], zahlungen: any[] }>();
    
    forderungen.forEach(f => {
      if (!f.sollmonat) return;
      // sollmonat ist DATE ('YYYY-MM-DD'), normalisieren auf 'YYYY-MM' für Map-Key-Konsistenz mit zugeordneter_monat
      const monat = f.sollmonat.slice(0, 7);
      if (!monthlyData.has(monat)) {
        monthlyData.set(monat, { forderungen: [], zahlungen: [] });
      }
      monthlyData.get(monat)!.forderungen.push(f);
    });

    zahlungen.forEach(z => {
      const month = z.zugeordneter_monat || z.buchungsdatum?.slice(0, 7);
      if (!month) return;
      if (!monthlyData.has(month)) {
        monthlyData.set(month, { forderungen: [], zahlungen: [] });
      }
      monthlyData.get(month)!.zahlungen.push(z);
    });

    return monthlyData;
  };

  const currentMonthlyData = groupByMonth(currentForderungen, currentZahlungen);
  const linkedMonthlyData = groupByMonth(linkedForderungen, linkedZahlungen);

  // Get all unique months from both contracts
  const allMonths = new Set([
    ...Array.from(currentMonthlyData.keys()),
    ...Array.from(linkedMonthlyData.keys())
  ]);
  const sortedMonths = Array.from(allMonths).sort().reverse();

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, paymentId: string, sourceContract: 'current' | 'linked') => {
    setDraggedPayment(paymentId);
    e.dataTransfer.setData('paymentId', paymentId);
    e.dataTransfer.setData('sourceContract', sourceContract);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, targetContract: 'current' | 'linked') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingOver(targetContract);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(null);
  };

  const handleDrop = async (e: React.DragEvent, targetContract: 'current' | 'linked') => {
    e.preventDefault();
    setIsDraggingOver(null);
    setDraggedPayment(null);

    const paymentId = e.dataTransfer.getData('paymentId');
    const sourceContract = e.dataTransfer.getData('sourceContract');

    if (!paymentId || sourceContract === targetContract) return;

    const targetContractId = targetContract === 'current' ? currentContractId : linkedContract.id;

    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({ mietvertrag_id: targetContractId })
        .eq('id', paymentId);

      if (error) throw error;

      toast({
        title: "Zahlung verschoben",
        description: `Zahlung wurde zum anderen Vertrag verschoben.`,
      });

      // Invalidate both contracts' queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', currentContractId] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen-detail', linkedContract.id] }),
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', currentContractId] }),
        queryClient.invalidateQueries({ queryKey: ['mietforderungen', linkedContract.id] }),
        queryClient.invalidateQueries({ queryKey: ['rueckstaende'] }),
      ]);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Zahlung konnte nicht verschoben werden.",
        variant: "destructive",
      });
    }
  };

  const handleDragEnd = () => {
    setDraggedPayment(null);
    setIsDraggingOver(null);
  };

  // Render a single contract column
  const renderContractColumn = (
    label: string,
    monthlyData: Map<string, { forderungen: any[], zahlungen: any[] }>,
    contractType: 'current' | 'linked',
    icon: React.ReactNode
  ) => (
    <div 
      className={`flex-1 min-w-0 transition-all duration-200 ${
        isDraggingOver === contractType 
          ? 'bg-primary/5 ring-2 ring-primary/20 rounded-lg' 
          : ''
      }`}
      onDragOver={(e) => handleDragOver(e, contractType)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, contractType)}
    >
      <div className="flex items-center gap-2 mb-4 pb-2 border-b">
        <div className="p-2 bg-primary/10 rounded-lg">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm truncate">{label}</h4>
          <p className="text-xs text-muted-foreground">
            {contractType === 'current' ? 'Aktueller Vertrag' : 'Verbundener Vertrag'}
          </p>
        </div>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
        {sortedMonths.map(month => {
          const data = monthlyData.get(month);
          if (!data) return null;
          
          const { forderungen, zahlungen } = data;
          if (forderungen.length === 0 && zahlungen.length === 0) return null;

          const monthDate = new Date(month + '-01');
          const monthLabel = monthDate.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });

          return (
            <div key={month} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                {monthLabel}
              </div>
              
              {/* Forderungen */}
              {forderungen.map((f: any) => (
                <div 
                  key={f.id} 
                  className="p-2 bg-red-50 border border-red-200 rounded text-sm"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-red-700">Forderung</span>
                    <span className="font-semibold text-red-800">{formatBetrag(Number(f.sollbetrag))}</span>
                  </div>
                </div>
              ))}

              {/* Zahlungen */}
              {zahlungen.filter((z: any) => z.kategorie !== 'Ignorieren' && z.kategorie !== 'Nebenkosten').map((z: any) => (
                <div 
                  key={z.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, z.id, contractType)}
                  onDragEnd={handleDragEnd}
                  className={`p-2 bg-green-50 border border-green-200 rounded text-sm cursor-grab active:cursor-grabbing transition-all ${
                    draggedPayment === z.id ? 'opacity-50 scale-95' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-green-700">Zahlung</span>
                        <span className="font-semibold text-green-800">{formatBetrag(Number(z.betrag))}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-1">
                        {formatDatum(z.buchungsdatum)}
                      </div>
                      {z.kategorie && (
                        <Badge variant="outline" className="text-xs mt-1">
                          {z.kategorie}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Card className="border-border bg-neutral-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Verbundene Verträge - Zahlungszuordnung</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Ziehen Sie Zahlungen zwischen den Verträgen hin und her
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex items-center gap-2 mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-800">
            Die Mieter haben mehrere Verträge. Zahlungen können per Drag & Drop zwischen den Verträgen verschoben werden.
          </p>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="flex gap-6">
          {renderContractColumn(
            currentContractLabel,
            currentMonthlyData,
            'current',
            <Building2 className="h-4 w-4 text-primary" />
          )}
          
          <div className="w-px bg-border" />
          
          {renderContractColumn(
            getLinkedContractLabel(),
            linkedMonthlyData,
            'linked',
            getUnitIcon(linkedContract.einheit)
          )}
        </div>
      </CardContent>
    </Card>
  );
}
