import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Users,
  Ruler,
  Equal,
  Sparkles,
  ChevronRight,
  Home,
  Building2,
  Car,
  Store,
  Box,
  Calendar,
  Check,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface NebenkostenZahlungenVerteilerProps {
  immobilieId: string;
}

interface Einheit {
  id: string;
  zaehler: number | null;
  qm: number | null;
  anzahl_personen: number | null;
  einheitentyp: string | null;
}

interface Zahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
}

interface VerteilungAnimation {
  zahlungId: string;
  einheitAnteile: { einheitId: string; anteil: number; betrag: number }[];
  isAnimating: boolean;
}

type VerteilerschluesselArt = 'qm' | 'personen' | 'gleich';

const VERTEILERSCHLUESSEL_CONFIG = {
  qm: { label: 'Nach Quadratmeter', icon: Ruler, beschreibung: 'Kosten werden nach Wohnfläche verteilt' },
  personen: { label: 'Nach Personenzahl', icon: Users, beschreibung: 'Kosten werden nach Anzahl Bewohner verteilt' },
  gleich: { label: 'Gleichmäßig', icon: Equal, beschreibung: 'Kosten werden gleichmäßig auf alle Einheiten verteilt' },
};

const getEinheitIcon = (typ: string | null) => {
  switch (typ) {
    case 'Garage': return Car;
    case 'Stellplatz': return Car;
    case 'Gewerbe': return Store;
    case 'Lager': return Box;
    case 'Haus (Doppelhaushälfte, Reihenhaus)': return Building2;
    default: return Home;
  }
};

const getEinheitLabel = (einheit: Einheit): string => {
  if (einheit.zaehler) return `${einheit.zaehler}`;
  const digitsFromId = (einheit.id as string).replace(/\D/g, "");
  return digitsFromId.slice(-2) || "00";
};

export function NebenkostenZahlungenVerteiler({ immobilieId }: NebenkostenZahlungenVerteilerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [verteilerschluessel, setVerteilerschluessel] = useState<VerteilerschluesselArt>('qm');
  const [animations, setAnimations] = useState<VerteilungAnimation[]>([]);
  const [verteilteZahlungen, setVerteilteZahlungen] = useState<Set<string>>(new Set());
  // Per-Zahlung Verteilerschlüssel-Override (pre-filled aus nebenkostenart)
  const [zahlungSchluessel, setZahlungSchluessel] = useState<Map<string, VerteilerschluesselArt>>(new Map());

  // Fetch Einheiten
  const { data: einheiten, isLoading: einheitenLoading } = useQuery({
    queryKey: ['einheiten-verteiler', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('id, zaehler, qm, anzahl_personen, einheitentyp')
        .eq('immobilie_id', immobilieId)
        .order('zaehler');
      if (error) throw error;
      return (data || []) as Einheit[];
    },
  });

  // Fetch zugeordnete Zahlungen für das Jahr
  const { data: zahlungen, isLoading: zahlungenLoading } = useQuery({
    queryKey: ['zahlungen-immobilie', immobilieId, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('id, betrag, buchungsdatum, verwendungszweck, empfaengername')
        .eq('immobilie_id', immobilieId)
        .eq('kategorie', 'Nichtmiete')
        .gte('buchungsdatum', `${selectedYear}-01-01`)
        .lte('buchungsdatum', `${selectedYear}-12-31`)
        .order('buchungsdatum', { ascending: false });
      if (error) throw error;
      return (data || []) as Zahlung[];
    },
  });

  // Fetch bereits verteilte Kostenpositionen + Schlüssel aus nebenkostenart
  const { data: kostenpositionen } = useQuery({
    queryKey: ['kostenpositionen-verteiler', immobilieId, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kostenpositionen')
        .select('zahlung_id, nebenkostenarten(verteilerschluessel_art)')
        .eq('immobilie_id', immobilieId)
        .not('zahlung_id', 'is', null);
      if (error) throw error;
      const verteiltSet = new Set<string>();
      const schluesselMap = new Map<string, VerteilerschluesselArt>();
      (data || []).forEach((k: any) => {
        if (k.zahlung_id) {
          verteiltSet.add(k.zahlung_id);
          const art = k.nebenkostenarten?.verteilerschluessel_art as VerteilerschluesselArt | undefined;
          if (art && ['qm', 'personen', 'gleich'].includes(art)) {
            schluesselMap.set(k.zahlung_id, art);
          }
        }
      });
      return { verteilt: verteiltSet, schluessel: schluesselMap };
    },
  });

  // Schlüssel aus kostenpositionen in State übernehmen (nur wenn noch kein Override)
  useEffect(() => {
    if (!kostenpositionen?.schluessel) return;
    setZahlungSchluessel(prev => {
      const merged = new Map(prev);
      kostenpositionen.schluessel.forEach((v: VerteilerschluesselArt, k: string) => {
        if (!merged.has(k)) merged.set(k, v);
      });
      return merged;
    });
  }, [kostenpositionen]);

  // Berechne Bezugsgrößen
  const bezugsgroessen = useMemo(() => {
    if (!einheiten) return { qm: 0, personen: 0, einheiten: 0 };
    return {
      qm: einheiten.reduce((sum, e) => sum + (e.qm || 0), 0),
      personen: einheiten.reduce((sum, e) => sum + (e.anzahl_personen || 1), 0),
      einheiten: einheiten.length,
    };
  }, [einheiten]);

  // Berechne Anteile für jede Einheit
  const einheitenAnteile = useMemo(() => {
    if (!einheiten) return new Map<string, number>();
    
    const anteile = new Map<string, number>();
    
    einheiten.forEach(einheit => {
      let anteil = 0;
      switch (verteilerschluessel) {
        case 'qm':
          anteil = bezugsgroessen.qm > 0 ? (einheit.qm || 0) / bezugsgroessen.qm : 0;
          break;
        case 'personen':
          anteil = bezugsgroessen.personen > 0 ? (einheit.anzahl_personen || 1) / bezugsgroessen.personen : 0;
          break;
        case 'gleich':
          anteil = bezugsgroessen.einheiten > 0 ? 1 / bezugsgroessen.einheiten : 0;
          break;
      }
      anteile.set(einheit.id, anteil);
    });
    
    return anteile;
  }, [einheiten, verteilerschluessel, bezugsgroessen]);

  // Jahre für Dropdown
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  // Gruppiere Zahlungen nach Monat
  const zahlungenNachMonat = useMemo(() => {
    if (!zahlungen) return new Map<string, Zahlung[]>();
    
    const grouped = new Map<string, Zahlung[]>();
    zahlungen.forEach(z => {
      const monat = format(new Date(z.buchungsdatum), 'MMMM yyyy', { locale: de });
      const existing = grouped.get(monat) || [];
      existing.push(z);
      grouped.set(monat, existing);
    });
    
    return grouped;
  }, [zahlungen]);

  // Berechne Anteile für einen spezifischen Schlüssel
  const berechneAnteile = useCallback((schluessel: VerteilerschluesselArt) => {
    if (!einheiten) return new Map<string, number>();
    const anteile = new Map<string, number>();
    einheiten.forEach(einheit => {
      let anteil = 0;
      switch (schluessel) {
        case 'qm':
          anteil = bezugsgroessen.qm > 0 ? (einheit.qm || 0) / bezugsgroessen.qm : 0;
          break;
        case 'personen':
          anteil = bezugsgroessen.personen > 0 ? (einheit.anzahl_personen || 1) / bezugsgroessen.personen : 0;
          break;
        case 'gleich':
          anteil = bezugsgroessen.einheiten > 0 ? 1 / bezugsgroessen.einheiten : 0;
          break;
      }
      anteile.set(einheit.id, anteil);
    });
    return anteile;
  }, [einheiten, bezugsgroessen]);

  // Trigger Verteilungs-Animation
  const handleVerteilen = useCallback(async (zahlung: Zahlung) => {
    if (!einheiten || verteilteZahlungen.has(zahlung.id)) return;

    // Per-Zahlung-Schlüssel oder globaler Default
    const schluessel = zahlungSchluessel.get(zahlung.id) || verteilerschluessel;
    const anteileMap = berechneAnteile(schluessel);

    // Berechne Anteile für Animation
    const anteile = einheiten.map(einheit => ({
      einheitId: einheit.id,
      anteil: anteileMap.get(einheit.id) || 0,
      betrag: Math.abs(zahlung.betrag) * (anteileMap.get(einheit.id) || 0),
    }));

    // Starte Animation
    setAnimations(prev => [...prev, {
      zahlungId: zahlung.id,
      einheitAnteile: anteile,
      isAnimating: true,
    }]);

    // Warte auf Animation
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      // Erstelle Kostenposition
      const { error: kpError } = await supabase
        .from('kostenpositionen')
        .insert({
          immobilie_id: immobilieId,
          zahlung_id: zahlung.id,
          gesamtbetrag: Math.abs(zahlung.betrag),
          zeitraum_von: zahlung.buchungsdatum,
          zeitraum_bis: zahlung.buchungsdatum,
          bezeichnung: zahlung.empfaengername || zahlung.verwendungszweck?.slice(0, 100) || 'Nebenkosten',
          ist_umlagefaehig: true,
          quelle: 'zahlung',
        });

      if (kpError) throw kpError;

      setVerteilteZahlungen(prev => new Set([...prev, zahlung.id]));
      
      toast({
        title: "Zahlung verteilt",
        description: `${Math.abs(zahlung.betrag).toFixed(2)} € wurden auf ${einheiten.length} Einheiten verteilt.`,
      });

      queryClient.invalidateQueries({ queryKey: ['kostenpositionen-abrechnung', immobilieId] });
      queryClient.invalidateQueries({ queryKey: ['kostenpositionen-verteiler', immobilieId] });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message || "Die Zahlung konnte nicht verteilt werden.",
        variant: "destructive",
      });
    }

    // Animation beenden
    setAnimations(prev => prev.filter(a => a.zahlungId !== zahlung.id));
  }, [einheiten, berechneAnteile, zahlungSchluessel, verteilerschluessel, immobilieId, verteilteZahlungen, toast, queryClient]);

  // Alle unverteilten auf einmal verteilen
  const handleAlleVerteilen = useCallback(async () => {
    if (!zahlungen) return;
    
    const unverteilt = zahlungen.filter(z => 
      !verteilteZahlungen.has(z.id) && !kostenpositionen?.verteilt.has(z.id)
    );

    for (const zahlung of unverteilt) {
      await handleVerteilen(zahlung);
      await new Promise(r => setTimeout(r, 300)); // Kurze Pause zwischen Animationen
    }
  }, [zahlungen, verteilteZahlungen, kostenpositionen, handleVerteilen]);

  const isLoading = einheitenLoading || zahlungenLoading;
  const unverteilteAnzahl = zahlungen?.filter(z => 
    !verteilteZahlungen.has(z.id) && !kostenpositionen?.verteilt.has(z.id)
  ).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Zahlungen auf Einheiten verteilen</h2>
                <p className="text-sm text-muted-foreground">
                  Zugeordnete Nebenkosten-Zahlungen auf die Einheiten aufteilen
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={selectedYear.toString()} onValueChange={v => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-[100px]">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={verteilerschluessel} onValueChange={v => setVerteilerschluessel(v as VerteilerschluesselArt)}>
                <SelectTrigger className="w-[180px]">
                  {(() => {
                    const Icon = VERTEILERSCHLUESSEL_CONFIG[verteilerschluessel].icon;
                    return <Icon className="h-4 w-4 mr-2" />;
                  })()}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VERTEILERSCHLUESSEL_CONFIG).map(([key, config]) => {
                    const Icon = config.icon;
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {config.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {unverteilteAnzahl > 0 && (
                <Button onClick={handleAlleVerteilen} className="gap-2">
                  <Zap className="h-4 w-4" />
                  Alle verteilen ({unverteilteAnzahl})
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Linke Spalte: Zahlungen */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Euro className="h-5 w-5" />
                Zugeordnete Zahlungen {selectedYear}
                <Badge variant="secondary" className="ml-auto">
                  {zahlungen?.length || 0} Zahlungen
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!zahlungen || zahlungen.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Euro className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Keine Nebenkosten-Zahlungen für {selectedYear} zugeordnet.</p>
                  <p className="text-sm mt-1">Zahlungen können unter Zahlungen zugeordnet werden.</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px] sm:h-[600px]">
                  <div className="space-y-6">
                    {Array.from(zahlungenNachMonat.entries()).map(([monat, monatZahlungen]) => (
                      <div key={monat}>
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 sticky top-0 bg-background py-1">
                          {monat}
                        </h3>
                        <div className="space-y-2">
                          {monatZahlungen.map(zahlung => {
                            const isVerteilt = verteilteZahlungen.has(zahlung.id) || kostenpositionen?.verteilt.has(zahlung.id);
                            const animation = animations.find(a => a.zahlungId === zahlung.id);
                            
                            return (
                              <div
                                key={zahlung.id}
                                className={cn(
                                  "p-4 rounded-lg border-2 transition-all duration-500 relative overflow-hidden",
                                  isVerteilt 
                                    ? "bg-primary/5 border-primary/30" 
                                    : "bg-card border-border hover:border-primary/50",
                                  animation?.isAnimating && "scale-[0.98] opacity-70"
                                )}
                              >
                                {/* Animation Overlay */}
                                {animation?.isAnimating && (
                                  <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/40 to-transparent animate-pulse" />
                                )}

                                <div className="flex items-start justify-between gap-3 relative z-10">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(zahlung.buchungsdatum), 'dd.MM.yyyy', { locale: de })}
                                      </span>
                                      {isVerteilt && (
                                        <Badge className="bg-primary/20 text-primary text-xs gap-1">
                                          <Check className="h-3 w-3" />
                                          Verteilt
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="font-medium text-sm truncate">
                                      {zahlung.empfaengername || 'Unbekannter Empfänger'}
                                    </p>
                                    {zahlung.verwendungszweck && (
                                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                                        {zahlung.verwendungszweck}
                                      </p>
                                    )}

                                    {/* Per-Zahlung Verteilerschlüssel */}
                                    {!isVerteilt && (
                                      <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground">Schlüssel:</span>
                                        <Select
                                          value={zahlungSchluessel.get(zahlung.id) || verteilerschluessel}
                                          onValueChange={(v) =>
                                            setZahlungSchluessel(prev => new Map(prev).set(zahlung.id, v as VerteilerschluesselArt))
                                          }
                                        >
                                          <SelectTrigger className="h-7 w-[160px] text-xs px-2 py-0">
                                            {(() => {
                                              const sk = zahlungSchluessel.get(zahlung.id) || verteilerschluessel;
                                              const Ico = VERTEILERSCHLUESSEL_CONFIG[sk].icon;
                                              return (
                                                <span className="flex items-center gap-1.5">
                                                  <Ico className="h-3 w-3 shrink-0" />
                                                  {VERTEILERSCHLUESSEL_CONFIG[sk].label}
                                                </span>
                                              );
                                            })()}
                                          </SelectTrigger>
                                          <SelectContent>
                                            {Object.entries(VERTEILERSCHLUESSEL_CONFIG).map(([key, config]) => {
                                              const Ico = config.icon;
                                              return (
                                                <SelectItem key={key} value={key}>
                                                  <span className="flex items-center gap-2 text-xs">
                                                    <Ico className="h-3.5 w-3.5" />
                                                    {config.label}
                                                  </span>
                                                </SelectItem>
                                              );
                                            })}
                                          </SelectContent>
                                        </Select>
                                        {kostenpositionen?.schluessel.has(zahlung.id) && (
                                          <Badge variant="outline" className="text-xs border-green-300 text-green-700 px-1.5 py-0 h-5">
                                            Vorschlag
                                          </Badge>
                                        )}
                                      </div>
                                    )}
                                    {isVerteilt && kostenpositionen?.schluessel.has(zahlung.id) && (
                                      <div className="mt-1 flex items-center gap-1.5">
                                        {(() => {
                                          const sk = kostenpositionen.schluessel.get(zahlung.id)!;
                                          const Ico = VERTEILERSCHLUESSEL_CONFIG[sk].icon;
                                          return (
                                            <Badge variant="outline" className="text-xs gap-1 h-5">
                                              <Ico className="h-3 w-3" />
                                              {VERTEILERSCHLUESSEL_CONFIG[sk].label}
                                            </Badge>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className={cn(
                                      "font-bold",
                                      zahlung.betrag < 0 ? "text-destructive" : "text-primary"
                                    )}>
                                      {zahlung.betrag.toFixed(2)} €
                                    </span>

                                    {!isVerteilt && !animation?.isAnimating && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="gap-1 hover:bg-primary hover:text-primary-foreground"
                                        onClick={() => handleVerteilen(zahlung)}
                                      >
                                        Verteilen
                                        <ChevronRight className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Verteilungs-Animation */}
                                {animation?.isAnimating && (
                                  <div className="mt-4 pt-4 border-t border-dashed">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      {animation.einheitAnteile.map((anteil, idx) => (
                                        <div
                                          key={anteil.einheitId}
                                          className="flex items-center gap-1 text-xs animate-fade-in"
                                          style={{ animationDelay: `${idx * 100}ms` }}
                                        >
                                          <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
                                            <Home className="h-3 w-3 text-primary" />
                                          </div>
                                          <span className="font-medium text-primary">
                                            {anteil.betrag.toFixed(0)}€
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Rechte Spalte: Einheiten-Übersicht */}
        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Verteilung auf Einheiten
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {VERTEILERSCHLUESSEL_CONFIG[verteilerschluessel].beschreibung}
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {einheiten?.map(einheit => {
                  const anteil = einheitenAnteile.get(einheit.id) || 0;
                  const Icon = getEinheitIcon(einheit.einheitentyp);
                  
                  // Aktive Animation für diese Einheit
                  const activeAnimation = animations.find(a => a.isAnimating);
                  const animatingAnteil = activeAnimation?.einheitAnteile.find(
                    ea => ea.einheitId === einheit.id
                  );
                  
                  return (
                    <div
                      key={einheit.id}
                      className={cn(
                        "p-3 rounded-lg border transition-all duration-300 relative overflow-hidden",
                        animatingAnteil ? "border-primary bg-primary/10 scale-[1.02]" : "border-border bg-card"
                      )}
                    >
                      {/* Animierter Balken */}
                      {animatingAnteil && (
                        <div 
                          className="absolute bottom-0 left-0 h-1 bg-primary animate-[grow_1s_ease-out_forwards]"
                          style={{ 
                            width: `${anteil * 100}%`,
                            animation: 'grow 1s ease-out forwards'
                          }}
                        />
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                            animatingAnteil ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              Einheit {getEinheitLabel(einheit)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {einheit.qm || 0} m² • {einheit.anzahl_personen || 1} Pers.
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "font-bold text-lg transition-colors",
                            animatingAnteil ? "text-primary" : ""
                          )}>
                            {(anteil * 100).toFixed(1)}%
                          </p>
                          {animatingAnteil && (
                            <p className="text-xs text-primary animate-fade-in">
                              +{animatingAnteil.betrag.toFixed(2)} €
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Zusammenfassung */}
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gesamt</span>
                  <span className="font-bold">100%</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Bezugsgröße</span>
                  <span className="font-medium">
                    {verteilerschluessel === 'qm' && `${bezugsgroessen.qm.toFixed(0)} m²`}
                    {verteilerschluessel === 'personen' && `${bezugsgroessen.personen} Personen`}
                    {verteilerschluessel === 'gleich' && `${bezugsgroessen.einheiten} Einheiten`}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <style>{`
        @keyframes grow {
          from { width: 0%; }
          to { width: var(--target-width, 100%); }
        }
      `}</style>
    </div>
  );
}
