import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Euro,
  Calculator,
  ChevronDown,
  ChevronRight,
  Users,
  Ruler,
  Equal,
  Save,
  FileText,
  AlertCircle,
  CheckCircle2,
  Home,
  Calendar,
  Building2,
  User,
} from "lucide-react";
import { format, parseISO, differenceInDays, isWithinInterval } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BETRKV_KATEGORIEN, NICHT_UMLAGEFAEHIGE_KATEGORIEN } from "./NebenkostenStep1Zuordnung";

interface NebenkostenStep2VerteilungProps {
  immobilieId: string;
  selectedYear: number;
}

interface EinheitWithMietvertraege {
  id: string;
  zaehler: number | null;
  qm: number | null;
  anzahl_personen: number | null;
  einheitentyp: string | null;
  mietvertraege: {
    id: string;
    start_datum: string | null;
    ende_datum: string | null;
    status: string | null;
    mieter: { vorname: string; nachname: string | null }[];
    personenzahl_override?: number;
  }[];
}

interface VerteilungData {
  einheitId: string;
  mietvertragId: string;
  anteilProzent: number;
  anteilBetrag: number;
  personenzahl: number;
  qm: number;
  zeitanteilFaktor: number;
  zeitraumVon: string;
  zeitraumBis: string;
  mieterName: string;
}

export function NebenkostenStep2Verteilung({ immobilieId, selectedYear }: NebenkostenStep2VerteilungProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [manualPersonenzahl, setManualPersonenzahl] = useState<Record<string, number>>({});
  const [verteilungsSchluessel, setVerteilungsSchluessel] = useState<Record<string, string>>({});

  const abrechnungsZeitraum = useMemo(() => ({
    von: `${selectedYear}-01-01`,
    bis: `${selectedYear}-12-31`,
  }), [selectedYear]);

  // Fetch Einheiten mit Mietverträgen und Mietern
  const { data: einheitenMitVertraegen, isLoading: einheitenLoading } = useQuery({
    queryKey: ["einheiten-mit-vertraegen", immobilieId, selectedYear],
    queryFn: async () => {
      // Fetch Einheiten
      const { data: einheiten, error: eError } = await supabase
        .from("einheiten")
        .select("id, zaehler, qm, anzahl_personen, einheitentyp")
        .eq("immobilie_id", immobilieId);

      if (eError) throw eError;

      // Fetch Mietverträge für alle Einheiten
      const einheitIds = einheiten?.map((e) => e.id) || [];
      const { data: vertraege, error: vError } = await supabase
        .from("mietvertrag")
        .select(`
          id,
          einheit_id,
          start_datum,
          ende_datum,
          status,
          mietvertrag_mieter(
            mieter:mieter_id(vorname, nachname)
          )
        `)
        .in("einheit_id", einheitIds);

      if (vError) throw vError;

      // Kombiniere Daten
      return einheiten?.map((einheit) => {
        const einheitVertraege = vertraege
          ?.filter((v) => v.einheit_id === einheit.id)
          .filter((v) => {
            // Nur Verträge die im Abrechnungszeitraum aktiv waren
            const start = v.start_datum ? parseISO(v.start_datum) : new Date(0);
            const ende = v.ende_datum ? parseISO(v.ende_datum) : new Date(9999, 11, 31);
            const abrStart = parseISO(abrechnungsZeitraum.von);
            const abrEnde = parseISO(abrechnungsZeitraum.bis);
            
            return start <= abrEnde && ende >= abrStart;
          })
          .map((v) => ({
            id: v.id,
            start_datum: v.start_datum,
            ende_datum: v.ende_datum,
            status: v.status,
            mieter: (v.mietvertrag_mieter || []).map((mm: any) => ({
              vorname: mm.mieter?.vorname || "",
              nachname: mm.mieter?.nachname || "",
            })),
          })) || [];

        return {
          ...einheit,
          mietvertraege: einheitVertraege,
        } as EinheitWithMietvertraege;
      }) || [];
    },
  });

  // Fetch Kostenpositionen
  const { data: kostenpositionen } = useQuery({
    queryKey: ["kostenpositionen-betrkv", immobilieId, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kostenpositionen")
        .select("*, nebenkostenart:nebenkostenart_id(*)")
        .eq("immobilie_id", immobilieId)
        .gte("zeitraum_von", abrechnungsZeitraum.von)
        .lte("zeitraum_bis", abrechnungsZeitraum.bis);

      if (error) throw error;
      return data || [];
    },
  });

  // Kostenpositionen nach Kategorie gruppieren
  const kostenProKategorie = useMemo(() => {
    const map = new Map<string, { positionen: any[]; total: number; kategorie: any }>();

    [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].forEach((kat) => {
      map.set(kat.id, { positionen: [], total: 0, kategorie: kat });
    });

    kostenpositionen?.forEach((kp) => {
      const artName = kp.nebenkostenart?.name?.toLowerCase().replace(/[^a-zäöü]/g, "") || "";
      let kategorieId = "sonstige_betriebskosten";

      const found = [...BETRKV_KATEGORIEN, ...NICHT_UMLAGEFAEHIGE_KATEGORIEN].find(
        (k) => k.name.toLowerCase().replace(/[^a-zäöü]/g, "") === artName
      );
      if (found) kategorieId = found.id;

      const entry = map.get(kategorieId);
      if (entry) {
        entry.positionen.push(kp);
        entry.total += kp.gesamtbetrag;
      }
    });

    return map;
  }, [kostenpositionen]);

  // Berechne Bezugsgrößen
  const bezugsgroessen = useMemo(() => {
    if (!einheitenMitVertraegen) return { qm: 0, personen: 0, einheiten: 0 };

    return {
      qm: einheitenMitVertraegen.reduce((sum, e) => sum + (e.qm || 0), 0),
      personen: einheitenMitVertraegen.reduce((sum, e) => {
        // Prüfe manuelle Eingabe für jeden Mietvertrag
        let personenSum = 0;
        e.mietvertraege.forEach((mv) => {
          const override = manualPersonenzahl[mv.id];
          personenSum += override !== undefined ? override : (e.anzahl_personen || 0);
        });
        return sum + (personenSum > 0 ? personenSum : (e.anzahl_personen || 1));
      }, 0),
      einheiten: einheitenMitVertraegen.length,
    };
  }, [einheitenMitVertraegen, manualPersonenzahl]);

  // Berechne Verteilung für eine Kategorie
  const berechneVerteilung = (kategorieId: string, total: number): VerteilungData[] => {
    if (!einheitenMitVertraegen || total === 0) return [];

    const schluessel = verteilungsSchluessel[kategorieId] || 
      kostenProKategorie.get(kategorieId)?.kategorie.schluessel || "qm";

    const result: VerteilungData[] = [];
    const abrStart = parseISO(abrechnungsZeitraum.von);
    const abrEnde = parseISO(abrechnungsZeitraum.bis);
    const gesamtTage = differenceInDays(abrEnde, abrStart) + 1;

    einheitenMitVertraegen.forEach((einheit) => {
      einheit.mietvertraege.forEach((mv) => {
        const vertragStart = mv.start_datum ? parseISO(mv.start_datum) : abrStart;
        const vertragEnde = mv.ende_datum ? parseISO(mv.ende_datum) : abrEnde;

        // Überschneidung mit Abrechnungszeitraum
        const overlapStart = vertragStart > abrStart ? vertragStart : abrStart;
        const overlapEnde = vertragEnde < abrEnde ? vertragEnde : abrEnde;

        if (overlapStart > overlapEnde) return; // Keine Überschneidung

        const belegteTage = differenceInDays(overlapEnde, overlapStart) + 1;
        const zeitanteilFaktor = belegteTage / gesamtTage;

        // Personenzahl ermitteln
        const personenzahl = manualPersonenzahl[mv.id] !== undefined
          ? manualPersonenzahl[mv.id]
          : (einheit.anzahl_personen || 0);

        let basisAnteil = 0;
        switch (schluessel) {
          case "qm":
            basisAnteil = bezugsgroessen.qm > 0 ? (einheit.qm || 0) / bezugsgroessen.qm : 0;
            break;
          case "personen":
            basisAnteil = bezugsgroessen.personen > 0 ? personenzahl / bezugsgroessen.personen : 0;
            break;
          case "gleich":
            basisAnteil = bezugsgroessen.einheiten > 0 ? 1 / bezugsgroessen.einheiten : 0;
            break;
        }

        const anteilProzent = basisAnteil * zeitanteilFaktor * 100;
        const anteilBetrag = total * basisAnteil * zeitanteilFaktor;

        const mieterName = mv.mieter.map((m) => `${m.vorname} ${m.nachname || ""}`.trim()).join(", ") || "Kein Mieter";

        result.push({
          einheitId: einheit.id,
          mietvertragId: mv.id,
          anteilProzent,
          anteilBetrag,
          personenzahl,
          qm: einheit.qm || 0,
          zeitanteilFaktor,
          zeitraumVon: format(overlapStart, "dd.MM.yyyy"),
          zeitraumBis: format(overlapEnde, "dd.MM.yyyy"),
          mieterName,
        });
      });
    });

    return result;
  };

  // Prüfe ob Personenzahl fehlt
  const fehlendePersonenzahl = useMemo(() => {
    const fehlend: { mietvertragId: string; einheitId: string; mieterName: string }[] = [];

    einheitenMitVertraegen?.forEach((einheit) => {
      if (einheit.anzahl_personen === null || einheit.anzahl_personen === 0) {
        einheit.mietvertraege.forEach((mv) => {
          if (manualPersonenzahl[mv.id] === undefined) {
            const mieterName = mv.mieter.map((m) => `${m.vorname} ${m.nachname || ""}`.trim()).join(", ") || "Kein Mieter";
            fehlend.push({ mietvertragId: mv.id, einheitId: einheit.id, mieterName });
          }
        });
      }
    });

    return fehlend;
  }, [einheitenMitVertraegen, manualPersonenzahl]);

  // Toggle Kategorie
  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Gesamtsummen berechnen
  const gesamtUmlagefaehig = useMemo(() => {
    return Array.from(kostenProKategorie.entries())
      .filter(([_, v]) => v.kategorie.umlagefaehig)
      .reduce((sum, [_, v]) => sum + v.total, 0);
  }, [kostenProKategorie]);

  const kategorienMitKosten = useMemo(() => {
    return Array.from(kostenProKategorie.entries())
      .filter(([_, v]) => v.total > 0)
      .sort((a, b) => b[1].total - a[1].total);
  }, [kostenProKategorie]);

  return (
    <div className="space-y-6">
      {/* Übersicht */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Euro className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <p className="text-sm text-green-700 font-medium">Umlagefähige Kosten</p>
                <p className="text-2xl font-bold text-green-800">{gesamtUmlagefaehig.toFixed(2)} €</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <p className="text-sm text-blue-700 font-medium">Einheiten / Verträge</p>
                <p className="text-2xl font-bold text-blue-800">
                  {einheitenMitVertraegen?.length || 0} / {einheitenMitVertraegen?.reduce((s, e) => s + e.mietvertraege.length, 0) || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(
          "border-2",
          fehlendePersonenzahl.length > 0
            ? "bg-gradient-to-br from-amber-50 to-amber-100 border-amber-300"
            : "bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200"
        )}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                fehlendePersonenzahl.length > 0 ? "bg-amber-500/20" : "bg-slate-500/20"
              )}>
                {fehlendePersonenzahl.length > 0 ? (
                  <AlertCircle className="h-5 w-5 text-amber-700" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-700" />
                )}
              </div>
              <div>
                <p className={cn(
                  "text-sm font-medium",
                  fehlendePersonenzahl.length > 0 ? "text-amber-700" : "text-slate-700"
                )}>
                  Fehlende Personenzahlen
                </p>
                <p className={cn(
                  "text-2xl font-bold",
                  fehlendePersonenzahl.length > 0 ? "text-amber-800" : "text-green-800"
                )}>
                  {fehlendePersonenzahl.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fehlende Personenzahlen eingeben */}
      {fehlendePersonenzahl.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertCircle className="h-5 w-5" />
              Personenzahl erforderlich
            </CardTitle>
            <p className="text-sm text-amber-700">
              Für eine korrekte Verteilung nach Personenzahl müssen Sie diese Angaben ergänzen:
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {fehlendePersonenzahl.map(({ mietvertragId, mieterName }) => (
                <div key={mietvertragId} className="flex items-center gap-3 p-3 bg-white rounded-lg border">
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{mieterName}</p>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    placeholder="Pers."
                    className="w-20 h-8 text-sm"
                    value={manualPersonenzahl[mietvertragId] || ""}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setManualPersonenzahl((prev) => ({
                        ...prev,
                        [mietvertragId]: isNaN(val) ? 0 : val,
                      }));
                    }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kategorien mit Verteilung */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Kostenverteilung auf Mietverträge
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Klicken Sie auf eine Kategorie, um die Verteilung zu sehen und anzupassen
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[400px] sm:h-[calc(100vh-500px)]">
            <div className="p-4 space-y-3">
              {kategorienMitKosten.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-lg font-medium">Keine Kostenpositionen vorhanden</p>
                  <p className="text-sm text-muted-foreground">
                    Ordnen Sie zuerst in Schritt 1 Zahlungen den Kategorien zu
                  </p>
                </div>
              ) : (
                kategorienMitKosten.map(([kategorieId, { positionen, total, kategorie }]) => {
                  const isExpanded = expandedCategories.has(kategorieId);
                  const Icon = kategorie.icon;
                  const verteilung = berechneVerteilung(kategorieId, total);
                  const currentSchluessel = verteilungsSchluessel[kategorieId] || kategorie.schluessel;

                  return (
                    <Collapsible
                      key={kategorieId}
                      open={isExpanded}
                      onOpenChange={() => toggleCategory(kategorieId)}
                    >
                      <div className={cn(
                        "border rounded-xl transition-all",
                        kategorie.umlagefaehig
                          ? "border-green-200 bg-green-50/50"
                          : "border-amber-200 bg-amber-50/50"
                      )}>
                        <CollapsibleTrigger className="w-full p-3 sm:p-4 text-left hover:bg-white/50 rounded-t-xl transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2 sm:gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                              )}
                              <div className={cn(
                                "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0",
                                kategorie.umlagefaehig ? "bg-green-100" : "bg-amber-100"
                              )}>
                                <Icon className={cn(
                                  "h-4 w-4 sm:h-5 sm:w-5",
                                  kategorie.umlagefaehig ? "text-green-600" : "text-amber-600"
                                )} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm sm:text-base flex items-center gap-1.5 flex-wrap">
                                  {'betrkvNummer' in kategorie && (
                                    <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                      {(kategorie as any).betrkvNummer}
                                    </span>
                                  )}
                                  <span className="truncate">{kategorie.name}</span>
                                </p>
                                <p className="text-xs sm:text-sm text-muted-foreground">
                                  {positionen.length} Position(en)
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 ml-10 sm:ml-0">
                              <Badge variant={kategorie.umlagefaehig ? "default" : "secondary"} className="text-[10px] sm:text-xs">
                                {kategorie.umlagefaehig ? "Umlagefähig" : "Nicht umlagef."}
                              </Badge>
                              <span className={cn(
                                "text-base sm:text-xl font-bold whitespace-nowrap",
                                kategorie.umlagefaehig ? "text-green-700" : "text-amber-700"
                              )}>
                                {total.toFixed(2)} €
                              </span>
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-4 pb-4 space-y-4 border-t">
                            {/* Verteilungsschlüssel wählen */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 gap-2">
                              <p className="text-sm font-medium">Verteilungsschlüssel:</p>
                              <Select
                                value={currentSchluessel}
                                onValueChange={(v) => setVerteilungsSchluessel((prev) => ({
                                  ...prev,
                                  [kategorieId]: v,
                                }))}
                              >
                                <SelectTrigger className="w-full sm:w-[200px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-background border shadow-lg z-50">
                                  <SelectItem value="qm">
                                    <div className="flex items-center gap-2">
                                      <Ruler className="h-4 w-4" />
                                      Nach Quadratmeter
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="personen">
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      Nach Personenzahl
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="gleich">
                                    <div className="flex items-center gap-2">
                                      <Equal className="h-4 w-4" />
                                      Gleichmäßig
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Verteilungstabelle */}
                            <div className="rounded-lg border bg-white overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead>Mieter</TableHead>
                                    <TableHead className="text-center">Zeitraum</TableHead>
                                    <TableHead className="text-center">
                                      {currentSchluessel === "qm" ? "m²" : currentSchluessel === "personen" ? "Personen" : "Anteil"}
                                    </TableHead>
                                    <TableHead className="text-center">Zeitanteil</TableHead>
                                    <TableHead className="text-right">Betrag</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {verteilung.map((v, idx) => (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                          <User className="h-4 w-4 text-muted-foreground" />
                                          {v.mieterName}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center text-sm text-muted-foreground">
                                        {v.zeitraumVon} - {v.zeitraumBis}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {currentSchluessel === "qm" 
                                          ? `${v.qm.toFixed(1)} m²`
                                          : currentSchluessel === "personen"
                                          ? `${v.personenzahl} Pers.`
                                          : "1 Einheit"
                                        }
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Badge variant="outline">
                                          {(v.zeitanteilFaktor * 100).toFixed(1)}%
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-bold text-primary">
                                        {v.anteilBetrag.toFixed(2)} €
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                  {verteilung.length === 0 && (
                                    <TableRow>
                                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                        Keine Mietverträge im Abrechnungszeitraum
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </div>

                            {/* Summe */}
                            <div className="flex justify-end pt-2">
                              <div className="bg-muted/50 rounded-lg px-4 py-2">
                                <span className="text-sm text-muted-foreground mr-3">Summe Verteilung:</span>
                                <span className="font-bold text-lg">
                                  {verteilung.reduce((s, v) => s + v.anteilBetrag, 0).toFixed(2)} €
                                </span>
                              </div>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
