import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Loader2, History, Droplets, Flame, Zap, ThermometerSun,
  Pencil, Trash2, Check, X
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface ZaehlerHistorieProps {
  einheitId?: string;
  immobilieId?: string;
  label?: string;
}

type HistorieEntry = {
  id: string;
  zaehler_typ: string;
  zaehler_nummer: string | null;
  stand: number | null;
  datum: string;
  quelle: string | null;
  erstellt_am: string | null;
  einheit_id: string | null;
  immobilie_id: string | null;
};

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
  entries: HistorieEntry[],
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStand, setEditStand] = useState('');
  const [editDatum, setEditDatum] = useState('');
  const [editZaehlerNr, setEditZaehlerNr] = useState('');
  const [deletePopoverOpen, setDeletePopoverOpen] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const queryKey = ['zaehlerstand-historie', einheitId, immobilieId];

  const { data: historie, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let query = supabase
        .from('zaehlerstand_historie')
        .select('*')
        .order('datum', { ascending: false })
        .order('erstellt_am', { ascending: false })
        .limit(100);

      if (einheitId) query = query.eq('einheit_id', einheitId);
      if (immobilieId) query = query.eq('immobilie_id', immobilieId).is('einheit_id', null);

      const { data, error } = await query;
      if (error) throw error;
      return data as HistorieEntry[];
    },
    enabled: isOpen,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, stand, datum, zaehlerNummer }: {
      id: string; stand: number; datum: string; zaehlerNummer: string;
    }) => {
      const { error } = await supabase
        .from('zaehlerstand_historie')
        .update({ stand, datum, zaehler_nummer: zaehlerNummer || null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
      toast.success('Eintrag aktualisiert');
    },
    onError: () => toast.error('Fehler beim Aktualisieren'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('zaehlerstand_historie')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDeletePopoverOpen(null);
      toast.success('Eintrag gelöscht');
    },
    onError: () => toast.error('Fehler beim Löschen'),
  });

  const startEdit = (entry: HistorieEntry) => {
    setEditingId(entry.id);
    setEditStand(entry.stand?.toString() ?? '');
    setEditDatum(entry.datum);
    setEditZaehlerNr(entry.zaehler_nummer ?? '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = () => {
    const standNum = parseFloat(editStand);
    if (isNaN(standNum)) {
      toast.error('Ungültiger Stand');
      return;
    }
    if (!editDatum) {
      toast.error('Datum fehlt');
      return;
    }
    updateMutation.mutate({ id: editingId!, stand: standNum, datum: editDatum, zaehlerNummer: editZaehlerNr });
  };

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
                  <TableHead className="py-1 px-2 h-6 w-[52px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historie.map((entry, index) => {
                  const isEditing = editingId === entry.id;
                  const verbrauch = isEditing ? null : computeVerbrauch(historie, index);

                  if (isEditing) {
                    return (
                      <TableRow key={entry.id} className="text-[10px] bg-muted/30">
                        <TableCell className="py-0.5 px-2">
                          <Input
                            type="date"
                            value={editDatum}
                            onChange={(e) => setEditDatum(e.target.value)}
                            className="h-5 text-[10px] px-1 w-28"
                          />
                        </TableCell>
                        <TableCell className="py-0.5 px-2">
                          <div className="flex items-center gap-1">
                            {getMeterIcon(entry.zaehler_typ)}
                            <span>{getTypLabel(entry.zaehler_typ)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-0.5 px-2">
                          <Input
                            value={editZaehlerNr}
                            onChange={(e) => setEditZaehlerNr(e.target.value)}
                            placeholder="Nr."
                            className="h-5 text-[10px] px-1 w-20"
                          />
                        </TableCell>
                        <TableCell className="py-0.5 px-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={editStand}
                            onChange={(e) => setEditStand(e.target.value)}
                            className="h-5 text-[10px] px-1 w-20 text-right ml-auto"
                          />
                        </TableCell>
                        <TableCell className="py-0.5 px-2 text-right text-muted-foreground">—</TableCell>
                        <TableCell className="py-0.5 px-2">{getQuelleLabel(entry.quelle)}</TableCell>
                        <TableCell className="py-0.5 px-1">
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0"
                              onClick={saveEdit}
                              disabled={updateMutation.isPending}
                            >
                              {updateMutation.isPending
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Check className="h-3 w-3 text-green-600" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={cancelEdit}>
                              <X className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={entry.id} className="text-[10px] group">
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
                        {entry.stand != null
                          ? Number(entry.stand).toLocaleString('de-DE', { minimumFractionDigits: 1 })
                          : '-'}
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
                      <TableCell className="py-0.5 px-2">{getQuelleLabel(entry.quelle)}</TableCell>
                      <TableCell className="py-0.5 px-1">
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0"
                            onClick={() => startEdit(entry)}
                            title="Bearbeiten"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </Button>
                          <Popover
                            open={deletePopoverOpen === entry.id}
                            onOpenChange={(open) => setDeletePopoverOpen(open ? entry.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                title="Löschen"
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-48 p-3" side="left">
                              <p className="text-xs font-medium mb-2">Eintrag löschen?</p>
                              <p className="text-[10px] text-muted-foreground mb-3">
                                {format(new Date(entry.datum), 'dd.MM.yyyy', { locale: de })} · {getTypLabel(entry.zaehler_typ)} · {entry.stand != null ? Number(entry.stand).toLocaleString('de-DE', { minimumFractionDigits: 1 }) : '–'}
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-6 text-xs flex-1"
                                  onClick={() => deleteMutation.mutate(entry.id)}
                                  disabled={deleteMutation.isPending}
                                >
                                  {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Löschen'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs"
                                  onClick={() => setDeletePopoverOpen(null)}
                                >
                                  Abbrechen
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
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
