import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, History, Droplets, Flame, Zap, ThermometerSun } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ZaehlerHistorieProps {
  einheitId?: string;
  immobilieId?: string;
  label?: string;
}

const getMeterIcon = (type: string) => {
  switch (type) {
    case 'kaltwasser': return <Droplets className="h-3 w-3 text-blue-500" />;
    case 'warmwasser': return <ThermometerSun className="h-3 w-3 text-orange-500" />;
    case 'strom': case 'strom_2': return <Zap className="h-3 w-3 text-yellow-600" />;
    case 'gas': case 'gas_2': return <Flame className="h-3 w-3 text-red-500" />;
    case 'wasser': case 'wasser_2': return <Droplets className="h-3 w-3 text-blue-600" />;
    default: return null;
  }
};

const getTypLabel = (type: string) => {
  const labels: Record<string, string> = {
    kaltwasser: 'KW', warmwasser: 'WW', strom: 'Strom', gas: 'Gas',
    wasser: 'Wasser', strom_2: 'Strom 2', gas_2: 'Gas 2', wasser_2: 'Wasser 2',
  };
  return labels[type] || type;
};

const getUnit = (type: string) => {
  if (type === 'strom' || type === 'strom_2') return 'kWh';
  return 'm³';
};

const getQuelleLabel = (quelle: string | null) => {
  switch (quelle) {
    case 'einzug': return <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-300 text-green-700">Einzug</Badge>;
    case 'auszug': return <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-700">Auszug</Badge>;
    default: return <Badge variant="outline" className="text-[9px] px-1 py-0">Manuell</Badge>;
  }
};

const computeVerbrauch = (
  entries: { id: string; zaehler_typ: string; zaehler_nummer: string | null; stand: number | null }[],
  index: number
): number | null => {
  const entry = entries[index];
  if (entry.stand == null) return null;
  for (let i = index + 1; i < entries.length; i++) {
    const prev = entries[i];
    if (prev.zaehler_typ !== entry.zaehler_typ) continue;
    if (prev.zaehler_nummer !== entry.zaehler_nummer) continue;
    if (prev.stand == null) return null;
    const delta = Number(entry.stand) - Number(prev.stand);
    return delta >= 0 ? delta : null;
  }
  return null;
};

export const ZaehlerHistorie = ({ einheitId, immobilieId, label }: ZaehlerHistorieProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const { data: historie, isLoading } = useQuery({
    queryKey: ['zaehlerstand-historie', einheitId, immobilieId],
    queryFn: async () => {
      let query = supabase
        .from('zaehlerstand_historie')
        .select('*')
        .order('datum', { ascending: false })
        .order('erstellt_am', { ascending: false })
        .limit(50);

      if (einheitId) query = query.eq('einheit_id', einheitId);
      if (immobilieId) query = query.eq('immobilie_id', immobilieId).is('einheit_id', null);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: isOpen,
  });

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground gap-1">
          <History className="h-3 w-3" />
          {label || "Historie"}
          {historie && historie.length > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">{historie.length}</Badge>
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded border bg-background/50">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          ) : !historie || historie.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-2">Keine Historie vorhanden</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="py-1 px-2 h-6">Datum</TableHead>
                  <TableHead className="py-1 px-2 h-6">Typ</TableHead>
                  <TableHead className="py-1 px-2 h-6">Zähler-Nr</TableHead>
                  <TableHead className="py-1 px-2 h-6 text-right">Stand</TableHead>
                  <TableHead className="py-1 px-2 h-6 text-right">Verbrauch</TableHead>
                  <TableHead className="py-1 px-2 h-6">Quelle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historie.map((entry, index) => {
                  const verbrauch = computeVerbrauch(historie, index);
                  return (
                  <TableRow key={entry.id} className="text-[10px]">
                    <TableCell className="py-0.5 px-2">
                      {format(new Date(entry.datum), 'dd.MM.yyyy', { locale: de })}
                    </TableCell>
                    <TableCell className="py-0.5 px-2">
                      <div className="flex items-center gap-1">
                        {getMeterIcon(entry.zaehler_typ)}
                        <span>{getTypLabel(entry.zaehler_typ)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-0.5 px-2 text-muted-foreground">
                      {entry.zaehler_nummer || '-'}
                    </TableCell>
                    <TableCell className="py-0.5 px-2 text-right font-mono">
                      {entry.stand != null ? Number(entry.stand).toLocaleString('de-DE', { minimumFractionDigits: 1 }) : '-'}
                    </TableCell>
                    <TableCell className="py-0.5 px-2 text-right font-mono">
                      {verbrauch != null ? (
                        <span className="text-emerald-600 font-medium">
                          +{verbrauch.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {getUnit(entry.zaehler_typ)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-0.5 px-2">
                      {getQuelleLabel(entry.quelle)}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
