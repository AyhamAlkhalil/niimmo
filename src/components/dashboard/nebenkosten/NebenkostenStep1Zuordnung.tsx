import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Wrench,
  GripVertical,
  Calendar,
  CreditCard,
  FileText,
  Check,
  X,
  Split,
  Sparkles,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { NebenkostenSplitDialog } from "./NebenkostenSplitDialog";
import {
  BETRKV_KATEGORIEN,
  NICHT_UMLAGEFAEHIGE_KATEGORIEN,
  findeKategorieNachName,
  kategorieAusKiVorschlag,
  pseudoKategorieFuerArt,
  type NebenkostenKategorie,
} from "./nebenkostenKategorien";
import {
  useKostenpositionen,
  useNebenkostenarten,
  useInvalidateNebenkosten,
  findeOderErstelleNebenkostenart,
  positionenImZeitraum,
  verteilteBetraegeProZahlung,
  istZuordenbareZahlung,
  type KostenpositionMitArt,
} from "@/hooks/useNebenkostenDaten";

interface NebenkostenStep1ZuordnungProps {
  immobilieId: string;
  selectedYear: number;
}

interface Zahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  kategorie: string | null;
}

export function NebenkostenStep1Zuordnung({
  immobilieId,
  selectedYear,
}: NebenkostenStep1ZuordnungProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateNebenkosten(immobilieId);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [draggedPayment, setDraggedPayment] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [monthsInitialized, setMonthsInitialized] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitDialogZahlung, setSplitDialogZahlung] = useState<Zahlung | null>(null);
  const [splitVorschlag, setSplitVorschlag] = useState<string | undefined>(undefined);

  const yearStart = parseISO(`${selectedYear}-01-01`);
  const yearEnd = parseISO(`${selectedYear}-12-31`);

  // Nur Ausgaben — Einnahmen sind keine Betriebskosten.
  const { data: zahlungen } = useQuery({
    queryKey: ["immobilie-nebenkosten-zahlungen", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zahlungen")
        .select("id, betrag, buchungsdatum, verwendungszweck, empfaengername, iban, kategorie")
        .eq("immobilie_id", immobilieId)
        .lt("betrag", 0)
        .order("buchungsdatum", { ascending: false });
      if (error) throw error;
      return (data || []) as Zahlung[];
    },
  });

  const { data: kostenpositionen } = useKostenpositionen(immobilieId);
  const { data: nebenkostenarten } = useNebenkostenarten(immobilieId);

  // KI-Vorklassifizierung als Zuordnungsvorschlag nutzbar machen.
  const { data: klassifizierungen } = useQuery({
    queryKey: ["nebenkosten-klassifizierungen", immobilieId],
    queryFn: async () => {
      const zahlungIds = zahlungen?.map((z) => z.id) || [];
      if (zahlungIds.length === 0) return [];
      const { data, error } = await supabase
        .from("nebenkosten_klassifizierungen")
        .select("zahlung_id, category, confidence")
        .in("zahlung_id", zahlungIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!zahlungen && zahlungen.length > 0,
  });

  const vorschlagProZahlung = useMemo(() => {
    const map = new Map<string, { kategorieId: string; name: string; confidence: string }>();
    klassifizierungen?.forEach((k) => {
      const kategorie = kategorieAusKiVorschlag(k.category);
      if (kategorie) {
        map.set(k.zahlung_id, {
          kategorieId: kategorie.id,
          name: kategorie.name,
          confidence: k.confidence,
        });
      }
    });
    return map;
  }, [klassifizierungen]);

  // Verteilte Beträge über ALLE Jahre. Eine 2024 verplante Zahlung darf 2025
  // nicht erneut als offen erscheinen — sonst werden dieselben Kosten doppelt umgelegt.
  const verteiltProZahlung = useMemo(
    () => verteilteBetraegeProZahlung(kostenpositionen),
    [kostenpositionen]
  );

  const positionenDesJahres = useMemo(
    () => positionenImZeitraum(kostenpositionen, yearStart, yearEnd),
    [kostenpositionen, yearStart, yearEnd]
  );

  const positionenProZahlung = useMemo(() => {
    const map = new Map<string, KostenpositionMitArt[]>();
    kostenpositionen?.forEach((kp) => {
      if (!kp.zahlung_id) return;
      const list = map.get(kp.zahlung_id) || [];
      list.push(kp);
      map.set(kp.zahlung_id, list);
    });
    return map;
  }, [kostenpositionen]);

  const createKostenpositionMutation = useMutation({
    mutationFn: async ({
      zahlungId,
      kategorieId,
      betrag,
      bezeichnung,
    }: {
      zahlungId: string;
      kategorieId: string;
      betrag: number;
      bezeichnung: string;
    }) => {
      const kategorie = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find(
        (k) => k.id === kategorieId
      );
      if (!kategorie) throw new Error("Unbekannte Kategorie");

      const nebenkostenartId = await findeOderErstelleNebenkostenart(
        immobilieId,
        kategorieId,
        nebenkostenarten
      );

      const { error } = await supabase.from("kostenpositionen").insert({
        immobilie_id: immobilieId,
        zahlung_id: zahlungId,
        nebenkostenart_id: nebenkostenartId,
        gesamtbetrag: Math.abs(betrag),
        zeitraum_von: `${selectedYear}-01-01`,
        zeitraum_bis: `${selectedYear}-12-31`,
        bezeichnung,
        ist_umlagefaehig: kategorie.umlagefaehig,
        quelle: "zahlung",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "✓ Zugeordnet", description: "Zahlung wurde der Kategorie zugeordnet." });
      invalidate();
    },
    onError: (error: Error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  const deletePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const { error } = await supabase.from("kostenpositionen").delete().eq("id", positionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Entfernt", description: "Zuordnung wurde gelöscht." });
      invalidate();
    },
    onError: (error: Error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  // Offene Zahlungen: Abrechnungsjahr und Vorjahr, da Rechnungen häufig erst im
  // Folgejahr beglichen werden.
  const unassignedZahlungen = useMemo(() => {
    return (zahlungen || []).filter((z) => {
      if (!istZuordenbareZahlung(z)) return false;

      const jahr = new Date(z.buchungsdatum).getFullYear();
      if (jahr !== selectedYear && jahr !== selectedYear - 1) return false;

      const verteilt = verteiltProZahlung.get(z.id) || 0;
      return verteilt < Math.abs(z.betrag) - 0.01;
    });
  }, [zahlungen, selectedYear, verteiltProZahlung]);

  const zahlungenByMonth = useMemo(() => {
    const groups: Record<string, { label: string; payments: Zahlung[] }> = {};

    unassignedZahlungen.forEach((zahlung) => {
      const date = new Date(zahlung.buchungsdatum);
      const monthKey = format(date, "yyyy-MM");
      const monthLabel = format(date, "MMMM yyyy", { locale: de });
      if (!groups[monthKey]) groups[monthKey] = { label: monthLabel, payments: [] };
      groups[monthKey].payments.push(zahlung);
    });

    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({
        monthKey: key,
        label: groups[key].label,
        payments: groups[key].payments,
        total: groups[key].payments.reduce((sum, z) => sum + z.betrag, 0),
      }));
  }, [unassignedZahlungen]);

  // Monate initial zuklappen — einmalig, danach entscheidet der Nutzer.
  useEffect(() => {
    if (!monthsInitialized && zahlungenByMonth.length > 0) {
      setCollapsedMonths(new Set(zahlungenByMonth.map((m) => m.monthKey)));
      setMonthsInitialized(true);
    }
  }, [zahlungenByMonth, monthsInitialized]);

  const toggleMonth = (monthKey: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const kostenProKategorie = useMemo(() => {
    const map = new Map<string, KostenpositionMitArt[]>();
    positionenDesJahres.forEach((kp) => {
      const kategorie =
        findeKategorieNachName(kp.nebenkostenart?.name) ??
        pseudoKategorieFuerArt(kp.nebenkostenart);
      if (!kategorie) return;
      const existing = map.get(kategorie.id) || [];
      existing.push(kp);
      map.set(kategorie.id, existing);
    });
    return map;
  }, [positionenDesJahres]);

  // Kostenarten aus dem Bestand, die keiner BetrKV-Position entsprechen. Sie
  // gehören sichtbar gemacht, statt unter "2.17 Sonstige" zu verschwinden.
  const sonstigeArten = useMemo(() => {
    const bekannt = new Set([...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].map((k) => k.id));
    const map = new Map<string, NebenkostenKategorie>();
    positionenDesJahres.forEach((kp) => {
      if (findeKategorieNachName(kp.nebenkostenart?.name)) return;
      const pseudo = pseudoKategorieFuerArt(kp.nebenkostenart);
      if (pseudo && !bekannt.has(pseudo.id)) map.set(pseudo.id, pseudo);
    });
    return Array.from(map.values());
  }, [positionenDesJahres]);

  const handleDragStart = (e: React.DragEvent, zahlungId: string) => {
    e.dataTransfer.setData("zahlungId", zahlungId);
    setDraggedPayment(zahlungId);
  };

  const handleDragEnd = () => setDraggedPayment(null);

  const handleDrop = (e: React.DragEvent, kategorieId: string) => {
    e.preventDefault();
    const zahlungId = e.dataTransfer.getData("zahlungId");
    if (!zahlungId) return;

    const zahlung = zahlungen?.find((z) => z.id === zahlungId);
    if (!zahlung) return;

    const kategorie = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find(
      (k) => k.id === kategorieId
    );

    createKostenpositionMutation.mutate({
      zahlungId,
      kategorieId,
      betrag: zahlung.betrag,
      bezeichnung: zahlung.verwendungszweck || zahlung.empfaengername || kategorie?.name || "Kostenposition",
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

  const openSplitDialog = (zahlung: Zahlung | null, vorschlagKategorieId?: string) => {
    setSplitDialogZahlung(zahlung);
    setSplitVorschlag(vorschlagKategorieId);
    setSplitDialogOpen(true);
  };

  const renderKategorieCard = (kategorie: NebenkostenKategorie, umlagefaehig: boolean) => {
    const positionen = kostenProKategorie.get(kategorie.id) || [];
    const Icon = kategorie.icon;
    const isExpanded = expandedCategories.has(kategorie.id);
    const chevronKlasse = cn("h-4 w-4", umlagefaehig ? "text-green-600" : "text-amber-600");
    // Pseudo-Kategorien aus Bestandsdaten sind kein gültiges Ziel — für sie
    // existiert keine BetrKV-Kategorie, aus der eine Nebenkostenart entstehen könnte.
    const istDropZiel = !kategorie.id.startsWith("custom_");

    return (
      <div
        key={kategorie.id}
        onDrop={istDropZiel ? (e) => handleDrop(e, kategorie.id) : undefined}
        onDragOver={istDropZiel ? handleDragOver : undefined}
        className={cn(
          "border-2 rounded-xl transition-all",
          istDropZiel ? "border-dashed" : "border-solid",
          draggedPayment && istDropZiel
            ? umlagefaehig
              ? "border-green-400 bg-green-50"
              : "border-amber-400 bg-amber-50"
            : positionen.length > 0
            ? umlagefaehig
              ? "border-green-300 bg-green-50/50"
              : "border-amber-300 bg-amber-50/50"
            : "border-slate-200 hover:border-slate-300"
        )}
      >
        <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(kategorie.id)}>
          <CollapsibleTrigger className="w-full p-3 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className={chevronKlasse} />
                ) : (
                  <ChevronRight className={chevronKlasse} />
                )}
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    umlagefaehig ? "bg-green-100" : "bg-amber-100"
                  )}
                >
                  <Icon
                    className={cn("h-4 w-4", umlagefaehig ? "text-green-600" : "text-amber-600")}
                  />
                </div>
                <div>
                  <p className="font-medium text-sm flex items-center gap-1.5">
                    {kategorie.betrkvNummer && (
                      <span className="text-xs font-mono text-green-700 bg-green-100 px-1 rounded shrink-0">
                        {kategorie.betrkvNummer}
                      </span>
                    )}
                    {kategorie.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{kategorie.beschreibung}</p>
                </div>
              </div>
              {positionen.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold">
                    {positionen.reduce((s, p) => s + p.gesamtbetrag, 0).toFixed(2)} €
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {positionen.length}
                  </Badge>
                </div>
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
                      {format(parseISO(pos.zeitraum_von), "dd.MM.yyyy", { locale: de })} –{" "}
                      {format(parseISO(pos.zeitraum_bis), "dd.MM.yyyy", { locale: de })}
                      {pos.quelle === "manuell" && " · manuell"}
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
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 h-full">
        {/* Linke Spalte: offene Zahlungen */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Euro className="h-5 w-5 text-primary" />
                <span>
                  Ausgaben {selectedYear - 1}/{selectedYear}
                </span>
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
                <Button
                  variant="outline"
                  className="w-full gap-2 border-dashed"
                  onClick={() => openSplitDialog(null)}
                >
                  <Plus className="h-4 w-4" />
                  Kostenposition ohne Bankbewegung anlegen
                </Button>

                {unassignedZahlungen.length === 0 ? (
                  <div className="text-center py-12">
                    <Check className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="text-lg font-medium text-green-700">Alle Ausgaben zugeordnet!</p>
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
                              <span className="font-semibold text-sm capitalize">
                                {monthGroup.label}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {monthGroup.payments.length} offen
                              </Badge>
                            </div>
                            <span className="text-sm font-bold text-destructive">
                              {(monthGroup.total ?? 0).toFixed(2)} €
                            </span>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-3 pl-2">
                            {monthGroup.payments.map((zahlung) => {
                              const isExpanded = expandedPayment === zahlung.id;
                              const verteilt = verteiltProZahlung.get(zahlung.id) || 0;
                              const vorschlag = vorschlagProZahlung.get(zahlung.id);
                              const istVorjahr =
                                new Date(zahlung.buchungsdatum).getFullYear() === selectedYear - 1;

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
                                  <div
                                    className="p-4 cursor-pointer"
                                    onClick={() =>
                                      setExpandedPayment(isExpanded ? null : zahlung.id)
                                    }
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
                                          <span className="text-lg font-bold whitespace-nowrap text-red-600">
                                            {(zahlung.betrag ?? 0).toFixed(2)} €
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                          {verteilt > 0.01 && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs border-primary/50 text-primary"
                                            >
                                              {verteilt.toFixed(2)} € verteilt – Rest:{" "}
                                              {(Math.abs(zahlung.betrag) - verteilt).toFixed(2)} €
                                            </Badge>
                                          )}
                                          {istVorjahr && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs border-blue-300 text-blue-700"
                                            >
                                              Buchung {selectedYear - 1}
                                            </Badge>
                                          )}
                                          {vorschlag && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs border-violet-300 text-violet-700 gap-1"
                                            >
                                              <Sparkles className="h-3 w-3" />
                                              {vorschlag.name}
                                            </Badge>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                          <span className="flex items-center gap-1">
                                            <Calendar className="h-3.5 w-3.5" />
                                            {format(
                                              new Date(zahlung.buchungsdatum),
                                              "dd. MMMM yyyy",
                                              { locale: de }
                                            )}
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

                                  {isExpanded && (
                                    <div className="px-4 pb-4 border-t bg-muted/30">
                                      <div className="pt-4 space-y-3">
                                        <div className="flex items-start gap-2">
                                          <FileText className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <p className="text-xs font-medium text-muted-foreground">
                                              Verwendungszweck
                                            </p>
                                            <p className="text-sm break-words">
                                              {zahlung.verwendungszweck || "-"}
                                            </p>
                                          </div>
                                        </div>

                                        {zahlung.iban && (
                                          <div className="flex items-start gap-2">
                                            <CreditCard className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                              <p className="text-xs font-medium text-muted-foreground">
                                                IBAN
                                              </p>
                                              <p className="text-sm font-mono">{zahlung.iban}</p>
                                            </div>
                                          </div>
                                        )}

                                        <div className="pt-3 border-t flex flex-col gap-3">
                                          <Button
                                            size="sm"
                                            className="w-full gap-2"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openSplitDialog(zahlung, vorschlag?.kategorieId);
                                            }}
                                          >
                                            <Split className="h-4 w-4" />
                                            Aufteilen / Zuordnen
                                          </Button>

                                          {vorschlag && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="w-full gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                createKostenpositionMutation.mutate({
                                                  zahlungId: zahlung.id,
                                                  kategorieId: vorschlag.kategorieId,
                                                  betrag: zahlung.betrag,
                                                  bezeichnung:
                                                    zahlung.verwendungszweck ||
                                                    zahlung.empfaengername ||
                                                    vorschlag.name,
                                                });
                                              }}
                                            >
                                              <Sparkles className="h-4 w-4" />
                                              KI-Vorschlag übernehmen: {vorschlag.name}
                                            </Button>
                                          )}

                                          <p className="text-xs font-medium text-muted-foreground">
                                            Schnellzuordnung (voller Betrag, Zeitraum {selectedYear}
                                            ):
                                          </p>
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
                                                    createKostenpositionMutation.mutate({
                                                      zahlungId: zahlung.id,
                                                      kategorieId: kat.id,
                                                      betrag: zahlung.betrag,
                                                      bezeichnung:
                                                        zahlung.verwendungszweck ||
                                                        zahlung.empfaengername ||
                                                        kat.name,
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
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-green-700 flex items-center gap-2 sticky top-0 bg-background py-2">
                    <Check className="h-4 w-4" />
                    Umlagefähig ({BETRKV_KATEGORIEN.length} Kategorien)
                  </h3>
                  {BETRKV_KATEGORIEN.map((kategorie) => renderKategorieCard(kategorie, true))}
                </div>

                <div className="space-y-2 pt-4 border-t">
                  <h3 className="text-sm font-semibold text-amber-700 flex items-center gap-2 sticky top-0 bg-background py-2">
                    <Wrench className="h-4 w-4" />
                    Nicht umlagefähig
                  </h3>
                  {NICHT_UMLAGEFAEHIGE_KATEGORIEN.map((kategorie) =>
                    renderKategorieCard(kategorie, false)
                  )}
                </div>

                {sonstigeArten.length > 0 && (
                  <div className="space-y-2 pt-4 border-t">
                    <h3 className="text-sm font-semibold text-slate-600 flex items-center gap-2 sticky top-0 bg-background py-2">
                      <MoreHorizontal className="h-4 w-4" />
                      Ohne BetrKV-Zuordnung
                    </h3>
                    <p className="text-xs text-muted-foreground -mt-1">
                      Frei benannte Kostenarten aus dem Bestand. Sie werden abgerechnet, erhalten im
                      PDF aber keine BetrKV-Nummer — zum Vereinheitlichen die Positionen einer
                      Kategorie oben zuordnen.
                    </p>
                    {sonstigeArten.map((kategorie) =>
                      renderKategorieCard(kategorie, kategorie.umlagefaehig)
                    )}
                  </div>
                )}
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
        bestehendePositionen={
          splitDialogZahlung ? positionenProZahlung.get(splitDialogZahlung.id) : undefined
        }
        vorschlagKategorieId={splitVorschlag}
      />
    </>
  );
}
