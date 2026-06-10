import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Euro,
  ChevronDown,
  ChevronRight,
  Building2,
  Droplets,
  Flame,
  Zap,
  Trash2,
  TreePine,
  Shield,
  User,
  Tv,
  WashingMachine,
  MoreHorizontal,
  Wrench,
  Home,
  GripVertical,
  Calendar,
  CreditCard,
  FileText,
  Check,
  X,
  Split,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { NebenkostenSplitDialog } from "./NebenkostenSplitDialog";

interface NebenkostenStep1ZuordnungProps {
  immobilieId: string;
  selectedYear: number;
}

// Re-export from shared file
export { BETRKV_KATEGORIEN, NICHT_UMLAGEFAEHIGE_KATEGORIEN } from "./nebenkostenKategorien";
import { BETRKV_KATEGORIEN, NICHT_UMLAGEFAEHIGE_KATEGORIEN } from "./nebenkostenKategorien";

export function NebenkostenStep1Zuordnung({ immobilieId, selectedYear }: NebenkostenStep1ZuordnungProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [draggedPayment, setDraggedPayment] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitDialogZahlung, setSplitDialogZahlung] = useState<any | null>(null);

  // Fetch zahlungen für diese Immobilie
  const { data: zahlungen } = useQuery({
    queryKey: ["immobilie-nebenkosten-zahlungen", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zahlungen")
        .select("*")
        .eq("immobilie_id", immobilieId)
        .order("buchungsdatum", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch kostenpositionen
  const { data: kostenpositionen } = useQuery({
    queryKey: ["kostenpositionen-betrkv", immobilieId, selectedYear],
    queryFn: async () => {
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear}-12-31`;

      const { data, error } = await supabase
        .from("kostenpositionen")
        .select("*")
        .eq("immobilie_id", immobilieId)
        .gte("zeitraum_von", yearStart)
        .lte("zeitraum_bis", yearEnd);

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch nebenkostenarten
  const { data: nebenkostenarten } = useQuery({
    queryKey: ["nebenkostenarten-betrkv", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nebenkostenarten")
        .select("*")
        .eq("immobilie_id", immobilieId);

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation für Kostenposition erstellen
  const createKostenpositionMutation = useMutation({
    mutationFn: async ({
      zahlungId,
      kategorieId,
      betrag,
      bezeichnung,
      istUmlagefaehig,
      verteilerschluessel,
    }: {
      zahlungId: string;
      kategorieId: string;
      betrag: number;
      bezeichnung: string;
      istUmlagefaehig: boolean;
      verteilerschluessel: string;
    }) => {
      // Finde oder erstelle die Nebenkostenart
      let nebenkostenartId = nebenkostenarten?.find(
        (n) => n.name.toLowerCase().replace(/[^a-z]/g, '') === kategorieId.replace(/_/g, '')
      )?.id;

      if (!nebenkostenartId) {
        const kategorie = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find(
          (k) => k.id === kategorieId
        );
        if (kategorie) {
          const { data: newArt, error: artError } = await supabase
            .from("nebenkostenarten")
            .insert({
              immobilie_id: immobilieId,
              name: kategorie.name,
              ist_umlagefaehig: kategorie.umlagefaehig,
              verteilerschluessel_art: verteilerschluessel,
            })
            .select()
            .single();

          if (artError) throw artError;
          nebenkostenartId = newArt.id;
        }
      }

      const { error } = await supabase.from("kostenpositionen").insert({
        immobilie_id: immobilieId,
        zahlung_id: zahlungId,
        nebenkostenart_id: nebenkostenartId,
        gesamtbetrag: Math.abs(betrag),
        zeitraum_von: `${selectedYear}-01-01`,
        zeitraum_bis: `${selectedYear}-12-31`,
        bezeichnung,
        ist_umlagefaehig: istUmlagefaehig,
        quelle: "zahlung",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "✓ Zugeordnet", description: "Zahlung wurde der Kategorie zugeordnet." });
      queryClient.invalidateQueries({ queryKey: ["kostenpositionen-betrkv", immobilieId, selectedYear] });
      queryClient.invalidateQueries({ queryKey: ["nebenkostenarten-betrkv", immobilieId] });
    },
    onError: (error: any) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  // Mutation zum Löschen
  const deletePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const { error } = await supabase.from("kostenpositionen").delete().eq("id", positionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Entfernt", description: "Zuordnung wurde gelöscht." });
      queryClient.invalidateQueries({ queryKey: ["kostenpositionen-betrkv", immobilieId, selectedYear] });
    },
  });

  // Zahlungen nach Jahr filtern und unzugeordnete/teilzugeordnete finden
  const unassignedZahlungen = useMemo(() => {
    // Vorjahr UND aktuelles Jahr anzeigen, da Betriebskosten häufig jahresübergreifend anfallen
    const yearPayments = zahlungen?.filter((z) => {
      const year = new Date(z.buchungsdatum).getFullYear();
      return year === selectedYear || year === selectedYear - 1;
    }) || [];
    
    return yearPayments.filter((z) => {
      // Find all kostenpositionen for this zahlung
      const positions = kostenpositionen?.filter((kp) => kp.zahlung_id === z.id) || [];
      if (positions.length === 0) return true; // fully unassigned
      
      // Check if total assigned < payment amount (partial assignment)
      const assignedTotal = positions.reduce((sum, kp) => sum + kp.gesamtbetrag, 0);
      return assignedTotal < Math.abs(z.betrag) - 0.01; // still has rest
    });
  }, [zahlungen, selectedYear, kostenpositionen]);

  // Gruppiere unzugeordnete Zahlungen nach Monat
  const zahlungenByMonth = useMemo(() => {
    const groups: { [key: string]: { label: string; payments: typeof unassignedZahlungen } } = {};
    
    unassignedZahlungen.forEach((zahlung) => {
      const date = new Date(zahlung.buchungsdatum);
      const monthKey = format(date, 'yyyy-MM');
      const monthLabel = format(date, 'MMMM', { locale: de });
      
      if (!groups[monthKey]) {
        groups[monthKey] = { label: monthLabel, payments: [] };
      }
      groups[monthKey].payments.push(zahlung);
    });
    
    // Sort by month key (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    
    return sortedKeys.map(key => ({
      monthKey: key,
      label: groups[key].label,
      payments: groups[key].payments,
      total: groups[key].payments.reduce((sum, z) => sum + z.betrag, 0)
    }));
  }, [unassignedZahlungen]);

  // Initialize all months as collapsed by default
  const allMonthKeysString = zahlungenByMonth.map(m => m.monthKey).join(',');
  useMemo(() => {
    if (allMonthKeysString && collapsedMonths.size === 0) {
      const allMonthKeys = allMonthKeysString.split(',').filter(Boolean);
      setCollapsedMonths(new Set(allMonthKeys));
    }
  }, [allMonthKeysString]);

  const toggleMonth = (monthKey: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Kostenpositionen pro Kategorie
  const kostenProKategorie = useMemo(() => {
    const map = new Map<string, any[]>();
    
    kostenpositionen?.forEach((kp) => {
      const art = nebenkostenarten?.find((n) => n.id === kp.nebenkostenart_id);
      let kategorieId = "sonstige_betriebskosten";
      
      if (art) {
        const found = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find((k) =>
          art.name.toLowerCase().replace(/[^a-zäöü]/g, '') === k.name.toLowerCase().replace(/[^a-zäöü]/g, '')
        );
        if (found) kategorieId = found.id;
      }

      const existing = map.get(kategorieId) || [];
      existing.push(kp);
      map.set(kategorieId, existing);
    });

    return map;
  }, [kostenpositionen, nebenkostenarten]);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, zahlungId: string) => {
    e.dataTransfer.setData("zahlungId", zahlungId);
    setDraggedPayment(zahlungId);
  };

  const handleDragEnd = () => setDraggedPayment(null);

  const handleDrop = (e: React.DragEvent, kategorieId: string, istUmlagefaehig: boolean, schluessel: string) => {
    e.preventDefault();
    const zahlungId = e.dataTransfer.getData("zahlungId");
    if (!zahlungId) return;

    const zahlung = zahlungen?.find((z) => z.id === zahlungId);
    if (!zahlung) return;

    const kategorie = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find((k) => k.id === kategorieId);

    createKostenpositionMutation.mutate({
      zahlungId,
      kategorieId,
      betrag: zahlung.betrag,
      bezeichnung: zahlung.verwendungszweck || zahlung.empfaengername || kategorie?.name || "Kostenposition",
      istUmlagefaehig,
      verteilerschluessel: schluessel,
    });
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Helper: get already assigned amount for a zahlung
  const getAssignedAmount = (zahlungId: string) => {
    const positions = kostenpositionen?.filter((kp) => kp.zahlung_id === zahlungId) || [];
    return positions.reduce((sum, kp) => sum + kp.gesamtbetrag, 0);
  };

  const openSplitDialog = (zahlung: any) => {
    setSplitDialogZahlung(zahlung);
    setSplitDialogOpen(true);
  };

  return (
    <>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 h-full">
      {/* Linke Spalte: Unzugeordnete Zahlungen */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Euro className="h-5 w-5 text-primary" />
              <span>Zahlungen {selectedYear - 1}/{selectedYear}</span>
            </div>
            <Badge variant="secondary" className="text-base px-3 py-1">
              {unassignedZahlungen.length} offen
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Klicken Sie auf eine Zahlung für Details, oder ziehen Sie sie in eine Kategorie
          </p>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[400px] sm:h-[calc(100vh-400px)]">
            <div className="p-4 space-y-3">
              {unassignedZahlungen.length === 0 ? (
                <div className="text-center py-12">
                  <Check className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <p className="text-lg font-medium text-green-700">Alle Zahlungen zugeordnet!</p>
                  <p className="text-sm text-muted-foreground">
                    Wechseln Sie zu Schritt 2 für die Verteilung
                  </p>
                </div>
              ) : (
                zahlungenByMonth.map((monthGroup) => {
                  const isCollapsed = collapsedMonths.has(monthGroup.monthKey);
                  return (
                    <Collapsible 
                      key={monthGroup.monthKey}
                      open={!isCollapsed}
                      onOpenChange={() => toggleMonth(monthGroup.monthKey)}
                    >
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between bg-muted/60 hover:bg-muted rounded-lg px-3 py-2.5 cursor-pointer transition-colors mb-2">
                          <div className="flex items-center gap-2">
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="font-semibold text-sm capitalize">{monthGroup.label}</span>
                            <Badge variant="secondary" className="text-xs">
                              {monthGroup.payments.length} offen
                            </Badge>
                          </div>
                          <span className={cn(
                            "text-sm font-bold",
                            monthGroup.total >= 0 ? "text-green-600" : "text-destructive"
                          )}>
                            {(monthGroup.total ?? 0) >= 0 ? "+" : ""}{(monthGroup.total ?? 0).toFixed(2)} €
                          </span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-3 pl-2">
                          {monthGroup.payments.map((zahlung) => {
                            const isExpanded = expandedPayment === zahlung.id;
                            return (
                              <div
                                key={zahlung.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, zahlung.id)}
                                onDragEnd={handleDragEnd}
                                className={cn(
                                  "border-2 rounded-xl bg-card transition-all cursor-grab active:cursor-grabbing",
                                  draggedPayment === zahlung.id
                                    ? "opacity-50 ring-2 ring-primary scale-[0.98]"
                                    : "hover:border-primary/50 hover:shadow-md",
                                  isExpanded && "border-primary shadow-lg"
                                )}
                              >
                                {/* Header - immer sichtbar */}
                                <div
                                  className="p-4 cursor-pointer"
                                  onClick={() => setExpandedPayment(isExpanded ? null : zahlung.id)}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="mt-1">
                                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-4">
                                        <p className="font-semibold text-base truncate">
                                          {zahlung.empfaengername || "Unbekannter Empfänger"}
                                        </p>
                                        <span className={cn(
                                          "text-lg font-bold whitespace-nowrap",
                                          zahlung.betrag >= 0 ? "text-green-600" : "text-red-600"
                                        )}>
                                          {(zahlung.betrag ?? 0) >= 0 ? "+" : ""}{(zahlung.betrag ?? 0).toFixed(2)} €
                                        </span>
                                      </div>
                                      {/* Show partial assignment badge */}
                                      {(() => {
                                        const assigned = getAssignedAmount(zahlung.id);
                                        if (assigned > 0.01) {
                                          return (
                                            <Badge variant="outline" className="text-xs mt-1 border-primary/50 text-primary">
                                              {assigned.toFixed(2)} € verteilt – Rest: {(Math.abs(zahlung.betrag) - assigned).toFixed(2)} €
                                            </Badge>
                                          );
                                        }
                                        return null;
                                      })()}
                                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                          <Calendar className="h-3.5 w-3.5" />
                                          {format(new Date(zahlung.buchungsdatum), "dd. MMMM yyyy", { locale: de })}
                                        </span>
                                        {isExpanded ? (
                                          <ChevronDown className="h-4 w-4 ml-auto" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 ml-auto" />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                  <div className="px-4 pb-4 border-t bg-muted/30">
                                    <div className="pt-4 space-y-3">
                                      {/* Verwendungszweck */}
                                      <div className="flex items-start gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                          <p className="text-xs font-medium text-muted-foreground">Verwendungszweck</p>
                                          <p className="text-sm break-words">
                                            {zahlung.verwendungszweck || "-"}
                                          </p>
                                        </div>
                                      </div>

                                      {/* IBAN */}
                                      {zahlung.iban && (
                                        <div className="flex items-start gap-2">
                                          <CreditCard className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <p className="text-xs font-medium text-muted-foreground">IBAN</p>
                                            <p className="text-sm font-mono">{zahlung.iban}</p>
                                          </div>
                                        </div>
                                      )}

                                      {/* Schnellzuordnung + Aufteilen */}
                                      <div className="pt-3 border-t flex flex-col gap-3">
                                        <Button
                                          size="sm"
                                          className="w-full gap-2"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openSplitDialog(zahlung);
                                          }}
                                        >
                                          <Split className="h-4 w-4" />
                                          Aufteilen / Zuordnen
                                        </Button>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Schnellzuordnung (1:1):</p>
                                        <div className="flex flex-wrap gap-2">
                                          {BETRKV_KATEGORIEN.slice(0, 8).map((kat) => {
                                            const Icon = kat.icon;
                                            return (
                                              <Button
                                                key={kat.id}
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs gap-1.5"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  // Quick assign creates a single kostenposition with full amount
                                                  createKostenpositionMutation.mutate({
                                                    zahlungId: zahlung.id,
                                                    kategorieId: kat.id,
                                                    betrag: zahlung.betrag,
                                                    bezeichnung: zahlung.verwendungszweck || zahlung.empfaengername || kat.name,
                                                    istUmlagefaehig: kat.umlagefaehig,
                                                    verteilerschluessel: kat.schluessel,
                                                  });
                                                }}
                                              >
                                                <Icon className="h-3.5 w-3.5" />
                                                {kat.name.split(" ")[0]}
                                              </Button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Rechte Spalte: Kategorien */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span>Nebenkostenarten (BetrKV § 2)</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ziehen Sie Zahlungen in die entsprechende Kategorie
          </p>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[400px] sm:h-[calc(100vh-400px)]">
            <div className="p-4 space-y-3">
              {/* Umlagefähige Kategorien */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-green-700 flex items-center gap-2 sticky top-0 bg-background py-2">
                  <Check className="h-4 w-4" />
                  Umlagefähig ({BETRKV_KATEGORIEN.length} Kategorien)
                </h3>
                {BETRKV_KATEGORIEN.map((kategorie) => {
                  const positionen = kostenProKategorie.get(kategorie.id) || [];
                  const total = positionen.reduce((sum, p) => sum + p.gesamtbetrag, 0);
                  const Icon = kategorie.icon;
                  const isExpanded = expandedCategories.has(kategorie.id);

                  return (
                    <div
                      key={kategorie.id}
                      onDrop={(e) => handleDrop(e, kategorie.id, true, kategorie.schluessel)}
                      onDragOver={handleDragOver}
                      className={cn(
                        "border-2 border-dashed rounded-xl transition-all",
                        draggedPayment
                          ? "border-green-400 bg-green-50"
                          : positionen.length > 0
                          ? "border-green-300 bg-green-50/50"
                          : "border-slate-200 hover:border-green-300 hover:bg-green-50/30"
                      )}
                    >
                      <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(kategorie.id)}>
                        <CollapsibleTrigger className="w-full p-3 text-left">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-green-600" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-green-600" />
                              )}
                              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                                <Icon className="h-4 w-4 text-green-600" />
                              </div>
                              <div>
                                <p className="font-medium text-sm flex items-center gap-1.5">
                                  <span className="text-xs font-mono text-green-700 bg-green-100 px-1 rounded shrink-0">
                                    {kategorie.betrkvNummer}
                                  </span>
                                  {kategorie.name}
                                </p>
                                <p className="text-xs text-muted-foreground">{kategorie.beschreibung}</p>
                              </div>
                            </div>
                            {positionen.length > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {positionen.length}
                              </Badge>
                            )}
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 space-y-2">
                            {positionen.map((pos) => (
                              <div
                                key={pos.id}
                                className="flex items-center justify-between p-2 bg-white rounded-lg border text-sm"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="truncate font-medium">{pos.bezeichnung}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(pos.zeitraum_von), "dd.MM.yyyy", { locale: de })}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{(pos.gesamtbetrag ?? 0).toFixed(2)} €</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => deletePositionMutation.mutate(pos.id)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {positionen.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-3">
                                Keine Zahlungen zugeordnet
                              </p>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  );
                })}
              </div>

              {/* Nicht umlagefähige Kategorien */}
              <div className="space-y-2 pt-4 border-t">
                <h3 className="text-sm font-semibold text-amber-700 flex items-center gap-2 sticky top-0 bg-background py-2">
                  <Wrench className="h-4 w-4" />
                  Nicht umlagefähig
                </h3>
                {NICHT_UMLAGEFAEHIGE_KATEGORIEN.map((kategorie) => {
                  const positionen = kostenProKategorie.get(kategorie.id) || [];
                  const total = positionen.reduce((sum, p) => sum + p.gesamtbetrag, 0);
                  const Icon = kategorie.icon;
                  const isExpanded = expandedCategories.has(kategorie.id);

                  return (
                    <div
                      key={kategorie.id}
                      onDrop={(e) => handleDrop(e, kategorie.id, false, kategorie.schluessel)}
                      onDragOver={handleDragOver}
                      className={cn(
                        "border-2 border-dashed rounded-xl transition-all",
                        draggedPayment
                          ? "border-amber-400 bg-amber-50"
                          : positionen.length > 0
                          ? "border-amber-300 bg-amber-50/50"
                          : "border-slate-200 hover:border-amber-300 hover:bg-amber-50/30"
                      )}
                    >
                      <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(kategorie.id)}>
                        <CollapsibleTrigger className="w-full p-3 text-left">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-amber-600" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-amber-600" />
                              )}
                              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                                <Icon className="h-4 w-4 text-amber-600" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{kategorie.name}</p>
                                <p className="text-xs text-muted-foreground">{kategorie.beschreibung}</p>
                              </div>
                            </div>
                            {positionen.length > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {positionen.length}
                              </Badge>
                            )}
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="px-3 pb-3 space-y-2">
                            {positionen.map((pos) => (
                              <div
                                key={pos.id}
                                className="flex items-center justify-between p-2 bg-white rounded-lg border text-sm"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="truncate font-medium">{pos.bezeichnung}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(pos.zeitraum_von), "dd.MM.yyyy", { locale: de })}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{(pos.gesamtbetrag ?? 0).toFixed(2)} €</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => deletePositionMutation.mutate(pos.id)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {positionen.length === 0 && (
                              <p className="text-xs text-muted-foreground text-center py-3">
                                Keine Zahlungen zugeordnet
                              </p>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>

    <NebenkostenSplitDialog
      open={splitDialogOpen}
      onOpenChange={setSplitDialogOpen}
      zahlung={splitDialogZahlung}
      immobilieId={immobilieId}
      selectedYear={selectedYear}
    />
    </>
  );
}
