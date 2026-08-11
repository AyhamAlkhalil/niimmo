import { useState, useMemo } from "react";
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
  FileText,
  AlertCircle,
  CheckCircle2,
  Building2,
  User,
  Loader2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  findeKategorieNachName,
  pseudoKategorieFuerArt,
  istBerechenbarerSchluessel,
  type NebenkostenKategorie,
} from "./nebenkostenKategorien";
import {
  useKostenpositionen,
  useNebenkostenarten,
  useInvalidateNebenkosten,
  positionenImZeitraum,
} from "@/hooks/useNebenkostenDaten";
import {
  berechneAnteil,
  berechneBezugsgroessen,
  bezugsgroesseFuerSchluessel,
  ermittlePerioden,
  kostenAnteilImZeitraum,
  tageInZeitraum,
  type Nutzungsperiode,
  type VerteilerSchluessel,
} from "@/utils/nebenkostenBerechnung";

interface NebenkostenStep2VerteilungProps {
  immobilieId: string;
  selectedYear: number;
}

interface KategorieMitKosten {
  kategorie: NebenkostenKategorie;
  /** Zeitanteilig auf den Abrechnungszeitraum heruntergerechnet. */
  total: number;
  anzahlPositionen: number;
  /** ID der Nebenkostenart — nur dann ist der Schlüssel speicherbar. */
  nebenkostenartId: string | null;
  schluessel: VerteilerSchluessel;
}

export function NebenkostenStep2Verteilung({
  immobilieId,
  selectedYear,
}: NebenkostenStep2VerteilungProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNebenkosten(immobilieId);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [personenEntwurf, setPersonenEntwurf] = useState<Record<string, string>>({});

  const abrStart = parseISO(`${selectedYear}-01-01`);
  const abrEnde = parseISO(`${selectedYear}-12-31`);
  const gesamtTage = tageInZeitraum(abrStart, abrEnde);

  const { data: einheiten } = useQuery({
    queryKey: ["einheiten-step2", immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("einheiten")
        .select("id, zaehler, qm, einheitentyp")
        .eq("immobilie_id", immobilieId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: mietvertraege } = useQuery({
    queryKey: ["mietvertraege-step2", immobilieId, selectedYear],
    queryFn: async () => {
      const einheitIds = einheiten?.map((e) => e.id) || [];
      if (einheitIds.length === 0) return [];
      const { data, error } = await supabase
        .from("mietvertrag")
        .select(`
          id,
          einheit_id,
          start_datum,
          ende_datum,
          kuendigungsdatum,
          anzahl_personen,
          status,
          mietvertrag_mieter(mieter:mieter_id(vorname, nachname))
        `)
        .in("einheit_id", einheitIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!einheiten && einheiten.length > 0,
  });

  const { data: alleKostenpositionen } = useKostenpositionen(immobilieId);
  const { data: nebenkostenarten } = useNebenkostenarten(immobilieId);

  const kostenpositionen = useMemo(
    () => positionenImZeitraum(alleKostenpositionen, abrStart, abrEnde),
    [alleKostenpositionen, abrStart, abrEnde]
  );

  // Perioden und Bezugsgrößen exakt wie in Schritt 3 — beide Schritte müssen
  // dieselben Zahlen zeigen.
  const { perioden, vertragsPerioden } = useMemo(() => {
    if (!einheiten || !mietvertraege) {
      return { perioden: [] as Nutzungsperiode[], vertragsPerioden: [] };
    }

    const alle: Nutzungsperiode[] = [];
    const vertraglich: (Nutzungsperiode & { mietvertragId: string })[] = [];

    einheiten.forEach((einheit) => {
      const ergebnis = ermittlePerioden(
        einheit,
        mietvertraege.filter((mv) => mv.einheit_id === einheit.id),
        abrStart,
        abrEnde
      );
      alle.push(...ergebnis.vertragsPerioden, ...ergebnis.leerstandsPerioden);
      vertraglich.push(...ergebnis.vertragsPerioden);
    });

    return { perioden: alle, vertragsPerioden: vertraglich };
  }, [einheiten, mietvertraege, abrStart, abrEnde]);

  const bezugsgroessen = useMemo(
    () => berechneBezugsgroessen(einheiten || [], perioden, gesamtTage),
    [einheiten, perioden, gesamtTage]
  );

  const kategorienMitKosten: KategorieMitKosten[] = useMemo(() => {
    const map = new Map<string, KategorieMitKosten>();

    kostenpositionen.forEach((kp) => {
      // Bestandsarten mit freiem Namen bleiben eigenständig, statt unter 2.17
      // einsortiert zu werden — sonst zeigt die Oberfläche eine andere Kostenart
      // an, als tatsächlich abgerechnet wird.
      const kategorie = findeKategorieNachName(kp.nebenkostenart?.name)
        ?? pseudoKategorieFuerArt(kp.nebenkostenart);
      if (!kategorie) return;

      const betrag = kostenAnteilImZeitraum(kp, abrStart, abrEnde);
      if (betrag <= 0) return;

      const vorhanden = map.get(kategorie.id);
      if (vorhanden) {
        vorhanden.total += betrag;
        vorhanden.anzahlPositionen += 1;
      } else {
        map.set(kategorie.id, {
          kategorie,
          total: betrag,
          anzahlPositionen: 1,
          nebenkostenartId: kp.nebenkostenart_id,
          schluessel: (kp.nebenkostenart?.verteilerschluessel_art ||
            kategorie.schluessel) as VerteilerSchluessel,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [kostenpositionen, abrStart, abrEnde]);

  const gesamtUmlagefaehig = kategorienMitKosten
    .filter((k) => k.kategorie.umlagefaehig)
    .reduce((sum, k) => sum + k.total, 0);

  // Verträge ohne gepflegte Personenzahl. Sie wird nicht ersetzt — fehlt sie,
  // ist die Umlage nach Personentagen für die ganze Immobilie nicht belegbar
  // und Schritt 3 sperrt die Abrechnung.
  const fehlendePersonenzahl = useMemo(() => {
    if (!mietvertraege) return [];
    const relevanteIds = new Set(vertragsPerioden.map((p) => p.mietvertragId));
    return mietvertraege
      .filter((mv) => relevanteIds.has(mv.id) && (mv.anzahl_personen ?? 0) <= 0)
      .map((mv) => ({
        id: mv.id,
        name:
          ((mv.mietvertrag_mieter as { mieter: { vorname: string | null; nachname: string | null } | null }[]) || [])
            .map((mm) => `${mm.mieter?.vorname || ""} ${mm.mieter?.nachname || ""}`.trim())
            .filter(Boolean)
            .join(", ") || "Unbekannter Mieter",
      }));
  }, [mietvertraege, vertragsPerioden]);

  const schluesselMutation = useMutation({
    mutationFn: async ({
      nebenkostenartId,
      schluessel,
    }: {
      nebenkostenartId: string;
      schluessel: VerteilerSchluessel;
    }) => {
      const { error } = await supabase
        .from("nebenkostenarten")
        .update({ verteilerschluessel_art: schluessel })
        .eq("id", nebenkostenartId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Verteilerschlüssel gespeichert",
        description: "Die Änderung wirkt sich sofort auf die Abrechnung aus.",
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  const personenMutation = useMutation({
    mutationFn: async ({ vertragId, personen }: { vertragId: string; personen: number }) => {
      const { error } = await supabase
        .from("mietvertrag")
        .update({ anzahl_personen: personen })
        .eq("id", vertragId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast({ title: "Personenzahl gespeichert" });
      setPersonenEntwurf((prev) => {
        const next = { ...prev };
        delete next[variables.vertragId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["mietvertraege-step2", immobilieId, selectedYear] });
      queryClient.invalidateQueries({ queryKey: ["mietvertraege-step3", immobilieId, selectedYear] });
    },
    onError: (err: Error) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  function berechneVerteilung(eintrag: KategorieMitKosten) {
    return perioden
      .map((periode) => {
        const anteil = berechneAnteil(periode, eintrag.schluessel, bezugsgroessen);
        const bezug = bezugsgroesseFuerSchluessel(eintrag.schluessel, periode, bezugsgroessen);
        const vertragsPeriode = vertragsPerioden.find(
          (vp) =>
            vp.einheitId === periode.einheitId &&
            vp.von.getTime() === periode.von.getTime() &&
            vp.bis.getTime() === periode.bis.getTime()
        );
        const vertrag = vertragsPeriode
          ? mietvertraege?.find((mv) => mv.id === vertragsPeriode.mietvertragId)
          : undefined;

        const mieterName = vertrag
          ? ((vertrag.mietvertrag_mieter as { mieter: { vorname: string | null; nachname: string | null } | null }[]) || [])
              .map((mm) => `${mm.mieter?.vorname || ""} ${mm.mieter?.nachname || ""}`.trim())
              .filter(Boolean)
              .join(", ") || "Unbekannter Mieter"
          : "Leerstand";

        return {
          periode,
          mieterName,
          istLeerstand: !vertragsPeriode,
          anteilProzent: anteil * 100,
          anteilBetrag: eintrag.total * anteil,
          bezugAnteilig: bezug.anteilig,
          zeitanteil: gesamtTage > 0 ? periode.tage / gesamtTage : 0,
        };
      })
      .filter((v) => v.anteilBetrag > 0.005)
      .sort((a, b) => a.periode.von.getTime() - b.periode.von.getTime());
  }

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
                <p className="text-2xl font-bold text-green-800">
                  {gesamtUmlagefaehig.toFixed(2)} €
                </p>
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
                <p className="text-sm text-blue-700 font-medium">Einheiten / Nutzungsperioden</p>
                <p className="text-2xl font-bold text-blue-800">
                  {einheiten?.length || 0} / {perioden.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-2",
            fehlendePersonenzahl.length > 0
              ? "bg-gradient-to-br from-amber-50 to-amber-100 border-amber-300"
              : "bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200"
          )}
        >
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  fehlendePersonenzahl.length > 0 ? "bg-amber-500/20" : "bg-slate-500/20"
                )}
              >
                {fehlendePersonenzahl.length > 0 ? (
                  <AlertCircle className="h-5 w-5 text-amber-700" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-700" />
                )}
              </div>
              <div>
                <p
                  className={cn(
                    "text-sm font-medium",
                    fehlendePersonenzahl.length > 0 ? "text-amber-700" : "text-slate-700"
                  )}
                >
                  Fehlende Personenzahlen
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold",
                    fehlendePersonenzahl.length > 0 ? "text-amber-800" : "text-green-800"
                  )}
                >
                  {fehlendePersonenzahl.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Personenzahl pflegen — schreibt in den Mietvertrag */}
      {fehlendePersonenzahl.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertCircle className="h-5 w-5" />
              Personenzahl erforderlich
            </CardTitle>
            <p className="text-sm text-amber-700">
              Die Personenzahl gehört zum Mietvertrag und wird nicht ersetzt. Solange sie fehlt,
              sperrt Schritt 3 die Abrechnung dieser Immobilie, sobald eine Kostenart nach
              Personentagen verteilt wird — die Bezugsgröße wäre sonst für alle Mieter falsch.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {fehlendePersonenzahl.map(({ id, name }) => (
                <div key={id} className="flex items-center gap-2 p-3 bg-white rounded-lg border">
                  <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                  </div>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    placeholder="Pers."
                    className="w-16 h-8 text-sm"
                    value={personenEntwurf[id] ?? ""}
                    onChange={(e) =>
                      setPersonenEntwurf((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={
                      personenMutation.isPending ||
                      !personenEntwurf[id] ||
                      parseInt(personenEntwurf[id], 10) < 1
                    }
                    onClick={() =>
                      personenMutation.mutate({
                        vertragId: id,
                        personen: parseInt(personenEntwurf[id], 10),
                      })
                    }
                  >
                    {personenMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "OK"
                    )}
                  </Button>
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
            Kostenverteilung auf Nutzungsperioden
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Der Verteilerschlüssel wird pro Kostenart gespeichert und gilt für die Abrechnung.
            Leerstandszeiten trägt der Eigentümer.
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
                kategorienMitKosten.map((eintrag) => {
                  const { kategorie } = eintrag;
                  const isExpanded = expandedCategories.has(kategorie.id);
                  const Icon = kategorie.icon;
                  const verteilung = isExpanded ? berechneVerteilung(eintrag) : [];
                  const summe = verteilung.reduce((s, v) => s + v.anteilBetrag, 0);

                  return (
                    <Collapsible
                      key={kategorie.id}
                      open={isExpanded}
                      onOpenChange={() => toggleCategory(kategorie.id)}
                    >
                      <div
                        className={cn(
                          "border rounded-xl transition-all",
                          kategorie.umlagefaehig
                            ? "border-green-200 bg-green-50/50"
                            : "border-amber-200 bg-amber-50/50"
                        )}
                      >
                        <CollapsibleTrigger className="w-full p-3 sm:p-4 text-left hover:bg-white/50 rounded-t-xl transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2 sm:gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                              )}
                              <div
                                className={cn(
                                  "w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0",
                                  kategorie.umlagefaehig ? "bg-green-100" : "bg-amber-100"
                                )}
                              >
                                <Icon
                                  className={cn(
                                    "h-4 w-4 sm:h-5 sm:w-5",
                                    kategorie.umlagefaehig ? "text-green-600" : "text-amber-600"
                                  )}
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm sm:text-base flex items-center gap-1.5 flex-wrap">
                                  {kategorie.betrkvNummer && (
                                    <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                      {kategorie.betrkvNummer}
                                    </span>
                                  )}
                                  <span className="truncate">{kategorie.name}</span>
                                </p>
                                <p className="text-xs sm:text-sm text-muted-foreground">
                                  {eintrag.anzahlPositionen} Position(en)
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 ml-10 sm:ml-0">
                              <Badge
                                variant={kategorie.umlagefaehig ? "default" : "secondary"}
                                className="text-[10px] sm:text-xs"
                              >
                                {kategorie.umlagefaehig ? "Umlagefähig" : "Nicht umlagef."}
                              </Badge>
                              <span
                                className={cn(
                                  "text-base sm:text-xl font-bold whitespace-nowrap",
                                  kategorie.umlagefaehig ? "text-green-700" : "text-amber-700"
                                )}
                              >
                                {eintrag.total.toFixed(2)} €
                              </span>
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-4 pb-4 space-y-4 border-t">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 gap-2">
                              <div>
                                <p className="text-sm font-medium">Verteilerschlüssel</p>
                                {!eintrag.nebenkostenartId && (
                                  <p className="text-xs text-amber-700">
                                    Nicht speicherbar — Kostenposition ohne Nebenkostenart.
                                  </p>
                                )}
                                {!istBerechenbarerSchluessel(eintrag.schluessel) && (
                                  <p className="text-xs text-amber-700">
                                    Hinterlegt ist „{eintrag.schluessel}" — dafür gibt es keine
                                    Berechnungsgrundlage. Es wird nach Wohnfläche verteilt, bis ein
                                    gültiger Schlüssel gewählt ist.
                                  </p>
                                )}
                              </div>
                              <Select
                                value={
                                  istBerechenbarerSchluessel(eintrag.schluessel)
                                    ? eintrag.schluessel
                                    : undefined
                                }
                                disabled={
                                  !eintrag.nebenkostenartId || schluesselMutation.isPending
                                }
                                onValueChange={(v) =>
                                  eintrag.nebenkostenartId &&
                                  schluesselMutation.mutate({
                                    nebenkostenartId: eintrag.nebenkostenartId,
                                    schluessel: v as VerteilerSchluessel,
                                  })
                                }
                              >
                                <SelectTrigger className="w-full sm:w-[220px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-background border shadow-lg z-50">
                                  <SelectItem value="qm">
                                    <div className="flex items-center gap-2">
                                      <Ruler className="h-4 w-4" />
                                      Nach Wohnfläche
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="personen">
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      Nach Personentagen
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="gleich">
                                    <div className="flex items-center gap-2">
                                      <Equal className="h-4 w-4" />
                                      Gleichmäßig je Einheit
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="rounded-lg border bg-white overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead>Nutzer</TableHead>
                                    <TableHead className="text-center">Zeitraum</TableHead>
                                    <TableHead className="text-center">
                                      {eintrag.schluessel === "qm"
                                        ? "m²"
                                        : eintrag.schluessel === "personen"
                                        ? "Personentage"
                                        : "Anteil"}
                                    </TableHead>
                                    <TableHead className="text-center">Zeitanteil</TableHead>
                                    <TableHead className="text-right">Betrag</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {verteilung.map((v, idx) => (
                                    <TableRow
                                      key={idx}
                                      className={cn(v.istLeerstand && "bg-slate-50")}
                                    >
                                      <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                          <User className="h-4 w-4 text-muted-foreground" />
                                          {v.mieterName}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-center text-sm text-muted-foreground">
                                        {format(v.periode.von, "dd.MM.yyyy")} –{" "}
                                        {format(v.periode.bis, "dd.MM.yyyy")}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {eintrag.schluessel === "qm"
                                          ? `${v.periode.qm.toFixed(1)} m²`
                                          : eintrag.schluessel === "personen"
                                          ? `${v.bezugAnteilig.toFixed(0)} (${v.periode.personen} P.)`
                                          : "1 Einheit"}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Badge variant="outline">
                                          {(v.zeitanteil * 100).toFixed(1)}%
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-bold text-primary">
                                        {v.anteilBetrag.toFixed(2)} €
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                  {verteilung.length === 0 && (
                                    <TableRow>
                                      <TableCell
                                        colSpan={5}
                                        className="text-center text-muted-foreground py-8"
                                      >
                                        Keine Nutzungsperioden im Abrechnungszeitraum
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </div>

                            <div className="flex justify-end pt-2">
                              <div className="bg-muted/50 rounded-lg px-4 py-2">
                                <span className="text-sm text-muted-foreground mr-3">
                                  Summe Verteilung:
                                </span>
                                <span className="font-bold text-lg">{summe.toFixed(2)} €</span>
                                {Math.abs(summe - eintrag.total) > 0.05 && (
                                  <span className="text-xs text-destructive ml-3">
                                    Abweichung: {(eintrag.total - summe).toFixed(2)} €
                                  </span>
                                )}
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
