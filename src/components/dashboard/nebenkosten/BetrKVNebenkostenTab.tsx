import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Euro,
  Loader2,
  Calendar,
  CheckCircle2,
  Calculator,
  FileText,
  ClipboardList,
  ArrowRight,
} from "lucide-react";
import { NebenkostenStep1Zuordnung } from "./NebenkostenStep1Zuordnung";
import { NebenkostenStep2Verteilung } from "./NebenkostenStep2Verteilung";
import { NebenkostenStep3Abrechnung } from "./NebenkostenStep3Abrechnung";

interface BetrKVNebenkostenTabProps {
  immobilieId: string;
}

export function BetrKVNebenkostenTab({ immobilieId }: BetrKVNebenkostenTabProps) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [activeStep, setActiveStep] = useState<string>("step1");

  const { data: zahlungen, isLoading: zahlungenLoading } = useQuery({
    queryKey: ["immobilie-nebenkosten-zahlungen", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zahlungen")
        .select("buchungsdatum")
        .eq("immobilie_id", immobilieId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: kostenpositionen, isLoading: kostenLoading } = useQuery({
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

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    zahlungen?.forEach((z) => years.add(new Date(z.buchungsdatum).getFullYear()));
    years.add(currentYear);
    years.add(currentYear - 1);
    return Array.from(years).sort((a, b) => b - a);
  }, [zahlungen, currentYear]);

  const stats = useMemo(() => {
    const yearPayments = zahlungen?.filter(
      (z) => new Date(z.buchungsdatum).getFullYear() === selectedYear
    ) || [];

    const unassigned = yearPayments.filter((z) => {
      const positions = kostenpositionen?.filter((kp) => kp.zahlung_id === (z as any).id) || [];
      if (positions.length === 0) return true;
      const assignedTotal = positions.reduce((sum, kp) => sum + kp.gesamtbetrag, 0);
      return assignedTotal < Math.abs((z as any).betrag || 0) - 0.01;
    });

    const totalUmlagefaehig = kostenpositionen
      ?.filter((kp) => kp.ist_umlagefaehig)
      .reduce((s, kp) => s + kp.gesamtbetrag, 0) || 0;
    const totalNichtUmlagefaehig = kostenpositionen
      ?.filter((kp) => !kp.ist_umlagefaehig)
      .reduce((s, kp) => s + kp.gesamtbetrag, 0) || 0;

    return {
      unassignedCount: unassigned.length,
      assignedCount: kostenpositionen?.length || 0,
      totalUmlagefaehig,
      totalNichtUmlagefaehig,
    };
  }, [zahlungen, kostenpositionen, selectedYear]);

  if (zahlungenLoading || kostenLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Nebenkostenabrechnung</h2>
          <p className="text-muted-foreground">Nach BetrKV § 2 – Betriebskostenverordnung</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[160px] bg-background">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background border shadow-lg z-50">
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  Abrechnungsjahr {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Statistiken */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-3 pb-3 sm:pt-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                <ClipboardList className="h-4 w-4 sm:h-5 sm:w-5 text-blue-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-blue-700 font-medium truncate">Noch offen</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-800">{stats.unassignedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-3 pb-3 sm:pt-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-green-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-green-700 font-medium truncate">Zugeordnet</p>
                <p className="text-xl sm:text-2xl font-bold text-green-800">{stats.assignedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200">
          <CardContent className="pt-3 pb-3 sm:pt-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Euro className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-emerald-700 font-medium truncate">Umlagefähig</p>
                <p className="text-lg sm:text-2xl font-bold text-emerald-800">
                  {stats.totalUmlagefaehig.toFixed(2)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="pt-3 pb-3 sm:pt-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                <Euro className="h-4 w-4 sm:h-5 sm:w-5 text-amber-700" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-amber-700 font-medium truncate">Nicht umlagef.</p>
                <p className="text-lg sm:text-2xl font-bold text-amber-800">
                  {stats.totalNichtUmlagefaehig.toFixed(2)} €
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3-Schritte-Tabs */}
      <Tabs value={activeStep} onValueChange={setActiveStep} className="space-y-4 sm:space-y-6">
        <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted">
          {/* Schritt 1 */}
          <TabsTrigger
            value="step1"
            className="flex items-center gap-2 sm:gap-3 py-2.5 px-2 sm:py-4 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary/10 text-primary font-bold text-xs sm:text-sm shrink-0">
              1
            </div>
            <div className="text-left min-w-0 hidden sm:block">
              <p className="font-semibold text-xs sm:text-sm truncate">Zuordnen</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground hidden md:block">
                Zahlungen → Kategorien
              </p>
            </div>
            {stats.unassignedCount > 0 && (
              <Badge variant="secondary" className="ml-auto text-[10px] sm:text-xs shrink-0">
                {stats.unassignedCount}
              </Badge>
            )}
          </TabsTrigger>

          {/* Schritt 2 */}
          <TabsTrigger
            value="step2"
            className="flex items-center gap-2 sm:gap-3 py-2.5 px-2 sm:py-4 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary/10 text-primary font-bold text-xs sm:text-sm shrink-0">
              2
            </div>
            <div className="text-left min-w-0 hidden sm:block">
              <p className="font-semibold text-xs sm:text-sm truncate">Verteilen</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground hidden md:block">
                Kosten → Einheiten
              </p>
            </div>
            {stats.assignedCount > 0 && (
              <Badge variant="default" className="ml-auto bg-green-600 text-[10px] sm:text-xs shrink-0">
                {stats.assignedCount}
              </Badge>
            )}
          </TabsTrigger>

          {/* Schritt 3 */}
          <TabsTrigger
            value="step3"
            className="flex items-center gap-2 sm:gap-3 py-2.5 px-2 sm:py-4 sm:px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <div className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-primary/10 text-primary font-bold text-xs sm:text-sm shrink-0">
              3
            </div>
            <div className="text-left min-w-0 hidden sm:block">
              <p className="font-semibold text-xs sm:text-sm truncate">Abrechnung</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground hidden md:block">
                PDF + E-Mail versenden
              </p>
            </div>
          </TabsTrigger>
        </TabsList>

        {/* Schritt 1: Zuordnung */}
        <TabsContent value="step1" className="mt-6">
          <NebenkostenStep1Zuordnung
            immobilieId={immobilieId}
            selectedYear={selectedYear}
          />
          {stats.assignedCount > 0 && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="default"
                className="gap-2"
                onClick={() => setActiveStep("step2")}
              >
                Weiter zu Schritt 2: Kosten verteilen
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Schritt 2: Verteilung */}
        <TabsContent value="step2" className="mt-6">
          <NebenkostenStep2Verteilung
            immobilieId={immobilieId}
            selectedYear={selectedYear}
          />
          {stats.assignedCount > 0 && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="default"
                className="gap-2"
                onClick={() => setActiveStep("step3")}
              >
                Weiter zu Schritt 3: Abrechnung erstellen
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Schritt 3: Abrechnung + PDF */}
        <TabsContent value="step3" className="mt-6">
          <NebenkostenStep3Abrechnung
            immobilieId={immobilieId}
            selectedYear={selectedYear}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
