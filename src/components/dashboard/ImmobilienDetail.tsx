import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EinheitCard } from "./EinheitCard";
import { ArrowLeft, Building, MapPin, Calendar, Info, Loader2, Pencil, Check, X, Droplets, Zap, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { sortUnitsByNumber, getCurrentContract, filterActiveAndTerminatedContracts } from "@/utils/contractUtils";
import { useEditableField } from "@/hooks/useEditableField";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";
import { ImmobilienDocumentsTab } from "./ImmobilienDocumentsTab";
import { ImmobilienNebenkostenTabNew } from "./nebenkosten/ImmobilienNebenkostenTabNew";
import { ImmobilienVersicherungenTab } from "./ImmobilienVersicherungenTab";

interface ImmobilienDetailProps {
  immobilieId: string;
  onBack: () => void;
  filters: {
    mietstatus: string;
    zahlungsstatus: string;
    vertragsart: string;
  };
  scrollToEinheitId?: string | null;
  openMietvertragId?: string | null;
  onContractModalClose?: () => void;
  isHausmeister?: boolean;
  initialTab?: string | null;
}
export const ImmobilienDetail = ({
  immobilieId,
  onBack,
  scrollToEinheitId,
  openMietvertragId,
  onContractModalClose,
  isHausmeister = false,
  initialTab,
}: ImmobilienDetailProps) => {
  const queryClient = useQueryClient();
  const einheitRefs = useRef<{
    [key: string]: HTMLDivElement | null;
  }>({});
  const [activeTab, setActiveTab] = useState(initialTab ?? "einheiten");

  // State for editable meter fields
  const [editingMeter, setEditingMeter] = useState<string | null>(null);
  const [meterValues, setMeterValues] = useState<Record<string, string>>({});
  
  const {
    startEditing,
    updateValue,
    cancelEdit,
    getEditingValue,
    isFieldEditing,
    saveSingleField
  } = useEditableField();
  const {
    data: immobilie,
    isLoading: immobilieLoading
  } = useQuery({
    queryKey: ['immobilie', immobilieId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from('immobilien').select('*').eq('id', immobilieId).single();
      if (error) throw error;
      return data;
    }
  });
  const {
    data: einheiten,
    isLoading: einheitenLoading
  } = useQuery({
    queryKey: ['einheiten', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('*')
        .eq('immobilie_id', immobilieId);
      
      if (error) throw error;
      
      // Group units by their ID's last 2 digits and keep only the newest
      const unitsByLastDigits = (data || []).reduce((acc, unit: any) => {
        const lastTwoDigits = unit.id.slice(-2);
        if (!acc[lastTwoDigits] || new Date(unit.erstellt_am) > new Date(acc[lastTwoDigits].erstellt_am)) {
          acc[lastTwoDigits] = unit;
        }
        return acc;
      }, {} as Record<string, any>);
      
      const uniqueUnits = Object.values(unitsByLastDigits);
      
      // Use centralized sorting utility
      return sortUnitsByNumber(uniqueUnits);
    }
  });
  const {
    data: mietvertraege
  } = useQuery({
    queryKey: ['mietvertrag-detail', immobilieId, einheiten?.map(e => e.id).join(',')],
    queryFn: async () => {
      const einheitIds = einheiten?.map(e => e.id) || [];
      if (einheitIds.length === 0) return [];
      
      const { data: vertraege, error: vertraegeError } = await supabase
        .from('mietvertrag')
        .select('*')
        .in('einheit_id', einheitIds);

      if (vertraegeError) throw vertraegeError;
      
      const vertragIds = vertraege?.map(v => v.id) || [];
      if (vertragIds.length === 0) return vertraege;
      
      const { data: mietvertragMieter, error: mmError } = await supabase
        .from('mietvertrag_mieter')
        .select(`mietvertrag_id, mieter_id`)
        .in('mietvertrag_id', vertragIds);
      
      if (mmError) throw mmError;
      
      const mieterIds = mietvertragMieter?.map(mm => mm.mieter_id) || [];
      if (mieterIds.length === 0) return vertraege;
      
      const { data: mieter, error: mieterError } = await supabase
        .from('mieter')
        .select('id, vorname, nachname, hauptmail, telnr')
        .in('id', mieterIds);
      
      if (mieterError) throw mieterError;
      
      return vertraege?.map(vertrag => {
        const allMieterForVertrag = mietvertragMieter?.filter(mm => mm.mietvertrag_id === vertrag.id) || [];
        const mieterData = allMieterForVertrag.map(mvMieter => {
          const mieterInfo = mieter?.find(m => m.id === mvMieter.mieter_id);
          return mieterInfo;
        }).filter(Boolean);
        
        return { ...vertrag, mieter: mieterData };
      }) || [];
    },
    enabled: !!einheiten
  });

  // Query für alle aktiven und gekündigten Mietverträge für Finanzberechnungen
  const {
    data: alleMietvertraege
  } = useQuery({
    queryKey: ['alle-mietvertrag-immobilie', immobilieId],
    queryFn: async () => {
      const einheitIds = einheiten?.map(e => e.id) || [];
      if (einheitIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('mietvertrag')
        .select('kaltmiete, betriebskosten, status')
        .in('einheit_id', einheitIds)
        .in('status', ['aktiv', 'gekuendigt', 'beendet']); // Include all contract types
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!einheiten
  });

  // Query für Dokumente dieser Immobilie
  const { data: immobilienDokumente } = useQuery({
    queryKey: ['immobilien-dokumente', immobilieId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dokumente')
        .select('*')
        .eq('immobilie_id', immobilieId)
        .eq('geloescht', false)
        .order('hochgeladen_am', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Berechne Gesamtwerte (nur aktive und gekündigte Verträge)
  const aktiveMietvertraege = alleMietvertraege?.filter(v => v.status === 'aktiv' || v.status === 'gekuendigt') || [];
  const gesamtKaltmiete = aktiveMietvertraege.reduce((sum, vertrag) => sum + (vertrag.kaltmiete || 0), 0);
  const gesamtBetriebskosten = aktiveMietvertraege.reduce((sum, vertrag) => sum + (vertrag.betriebskosten || 0), 0);
  const gesamtWarmmiete = gesamtKaltmiete + gesamtBetriebskosten;
  // Exclude non-residential unit types (Garage, Stellplatz, Lager, Sonstiges) from total QM calculation
  const wohnflaechenEinheiten = einheiten?.filter(e => 
    !['Garage', 'Stellplatz', 'Lager', 'Sonstiges'].includes(e.einheitentyp || '')
  ) || [];
  const gesamtQm = wohnflaechenEinheiten.reduce((sum, einheit) => sum + (einheit.qm || 0), 0);

  // Scroll to specific unit if scrollToEinheitId is provided with enhanced highlighting
  useEffect(() => {
    if (scrollToEinheitId && einheiten && !einheitenLoading) {
      const timer = setTimeout(() => {
        const targetElement = einheitRefs.current[scrollToEinheitId];
        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
          
          // Apply search highlight animation class
          targetElement.classList.add('animate-search-highlight');
          targetElement.style.border = '3px solid #ef4444';
          targetElement.style.borderRadius = '12px';
          targetElement.style.zIndex = '10';
          targetElement.style.position = 'relative';
          
          // Reset after enhanced duration
          setTimeout(() => {
            targetElement.classList.remove('animate-search-highlight');
            targetElement.style.border = '';
            targetElement.style.borderRadius = '';
            targetElement.style.zIndex = '';
            targetElement.style.position = '';
          }, 4000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToEinheitId, einheiten, einheitenLoading]);
  const handleBackClick = () => {
    onBack();
  };
  if (immobilieLoading || einheitenLoading) {
    return <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>;
  }
  return <div className="min-h-screen px-3 py-4 sm:p-6 modern-dashboard-bg">
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="mb-6">
          <Button variant="ghost" onClick={handleBackClick} className="mb-4 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Übersicht
          </Button>
          
          {/* Immobilien Header */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row items-start gap-3 justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
                    <Building className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-xl sm:text-2xl font-bold text-foreground mb-0.5">
                      {immobilie?.name}
                    </CardTitle>
                    <div className="flex items-center text-muted-foreground text-sm">
                      <MapPin className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                      <span>{immobilie?.adresse}</span>
                    </div>
                  </div>
                </div>

                <div className="text-left sm:text-right space-y-2 shrink-0">
                  <Badge variant="outline" className="text-sm px-3 py-1">
                    {einheiten?.length || 0} von {immobilie?.einheiten_anzahl} Einheiten
                  </Badge>
                  {immobilie?.objekttyp && <div className="text-xs text-muted-foreground">
                      {immobilie.objekttyp}
                    </div>}
                  <div
                    className="flex items-center gap-2 justify-end cursor-pointer group"
                    title="Kappungsgrenze: 15% in 36 Monaten (angespannt) vs. 20% (normal)"
                    onClick={async () => {
                      const neuerWert = !(immobilie as any)?.ist_angespannt;
                      await (supabase as any).from('immobilien').update({ ist_angespannt: neuerWert }).eq('id', immobilieId);
                      queryClient.invalidateQueries({ queryKey: ['immobilie', immobilieId] });
                    }}
                  >
                    <span className={`text-xs font-medium ${(immobilie as any)?.ist_angespannt ? 'text-orange-600' : 'text-muted-foreground'}`}>
                      Angespannter Markt
                    </span>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${(immobilie as any)?.ist_angespannt ? 'bg-orange-500 border-orange-500' : 'border-gray-300 group-hover:border-orange-400'}`}>
                      {(immobilie as any)?.ist_angespannt && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="pt-0 space-y-4">
              {/* Compact financial metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Fläche</p>
                  <p className="text-lg font-bold text-foreground">{gesamtQm.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">m²</span></p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Kaltmiete</p>
                  <p className="text-lg font-bold text-foreground">€{gesamtKaltmiete.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Betriebskosten</p>
                  <p className="text-lg font-bold text-foreground">€{gesamtBetriebskosten.toLocaleString()}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Warmmiete</p>
                  <p className="text-lg font-bold text-foreground">€{gesamtWarmmiete.toLocaleString()}</p>
                </div>
              </div>

              {/* Allgemeine Zähler (Hausanschluss) - editable */}
              {(() => {
                const meterTypes = [
                  { key: 'wasser', label: 'Wasser', icon: Droplets, zaehlerField: 'allgemein_wasser_zaehler' as const, standField: 'allgemein_wasser_stand' as const, datumField: 'allgemein_wasser_datum' as const },
                  { key: 'strom', label: 'Strom', icon: Zap, zaehlerField: 'allgemein_strom_zaehler' as const, standField: 'allgemein_strom_stand' as const, datumField: 'allgemein_strom_datum' as const },
                  { key: 'gas', label: 'Gas', icon: Flame, zaehlerField: 'allgemein_gas_zaehler' as const, standField: 'allgemein_gas_stand' as const, datumField: 'allgemein_gas_datum' as const },
                ];
                
                // Also check for second set (_2)
                const meterTypes2 = [
                  { key: 'wasser_2', label: 'Wasser 2', icon: Droplets, zaehlerField: 'allgemein_wasser_zaehler_2' as const, standField: 'allgemein_wasser_stand_2' as const, datumField: 'allgemein_wasser_datum_2' as const },
                  { key: 'strom_2', label: 'Strom 2', icon: Zap, zaehlerField: 'allgemein_strom_zaehler_2' as const, standField: 'allgemein_strom_stand_2' as const, datumField: 'allgemein_strom_datum_2' as const },
                  { key: 'gas_2', label: 'Gas 2', icon: Flame, zaehlerField: 'allgemein_gas_zaehler_2' as const, standField: 'allgemein_gas_stand_2' as const, datumField: 'allgemein_gas_datum_2' as const },
                ];
                
                const hasSecondSet = immobilie && (
                  immobilie.allgemein_wasser_zaehler_2 != null || immobilie.allgemein_strom_zaehler_2 != null || immobilie.allgemein_gas_zaehler_2 != null ||
                  immobilie.allgemein_wasser_stand_2 || immobilie.allgemein_strom_stand_2 || immobilie.allgemein_gas_stand_2
                );
                
                const renderMeterRow = (meters: Array<{ key: string; label: string; icon: any; zaehlerField: string; standField: string; datumField: string }>, title?: string) => (
                  <>
                    {title && <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {meters.map(({ key, label, icon: Icon, zaehlerField, standField, datumField }) => {
                        const zaehlerVal = (immobilie as any)?.[zaehlerField] || '';
                        const standVal = (immobilie as any)?.[standField];
                        const datumVal = (immobilie as any)?.[datumField] || '';
                        const isEditing = editingMeter === key;
                        
                        return (
                          <div key={key} className="flex items-center gap-2 bg-background rounded-lg p-2 border border-border/50">
                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                            {isEditing ? (
                              <div className="flex-1 flex flex-col gap-1">
                                <Input
                                  placeholder="Zählernr."
                                  defaultValue={meterValues[`${key}_zaehler`] ?? zaehlerVal}
                                  onChange={(e) => setMeterValues(prev => ({ ...prev, [`${key}_zaehler`]: e.target.value }))}
                                  className="h-7 text-xs"
                                />
                                <div className="flex gap-1">
                                  <Input
                                    type="number"
                                    placeholder="Stand"
                                    defaultValue={meterValues[`${key}_stand`] ?? (standVal ?? '')}
                                    onChange={(e) => setMeterValues(prev => ({ ...prev, [`${key}_stand`]: e.target.value }))}
                                    className="h-7 text-xs flex-1"
                                  />
                                  <Input
                                    type="date"
                                    defaultValue={meterValues[`${key}_datum`] ?? datumVal}
                                    onChange={(e) => setMeterValues(prev => ({ ...prev, [`${key}_datum`]: e.target.value }))}
                                    className="h-7 text-xs flex-1"
                                  />
                                </div>
                                <div className="flex gap-1 justify-end">
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={async () => {
                                    const zVal = meterValues[`${key}_zaehler`] ?? zaehlerVal;
                                    const sVal = meterValues[`${key}_stand`] ?? String(standVal ?? '');
                                    const dVal = meterValues[`${key}_datum`] ?? datumVal;
                                    const updates: Record<string, unknown> = {
                                      [zaehlerField]: zVal || null,
                                      [standField]: sVal ? parseFloat(sVal) : null,
                                      [datumField]: dVal || null,
                                    };
                                    const { error } = await supabase.from('immobilien').update(updates).eq('id', immobilieId);
                                    if (error) {
                                      toast.error('Fehler beim Speichern');
                                    } else {
                                      toast.success('Gespeichert');
                                      queryClient.invalidateQueries({ queryKey: ['immobilie', immobilieId] });
                                      const standNum = updates[standField] as number | null;
                                      if (standNum != null) {
                                        await supabase.from('zaehlerstand_historie').insert({
                                          immobilie_id: immobilieId,
                                          zaehler_typ: key,
                                          zaehler_nummer: (updates[zaehlerField] as string | null) ?? null,
                                          stand: standNum,
                                          datum: (updates[datumField] as string | null) ?? format(new Date(), 'yyyy-MM-dd'),
                                          quelle: 'manuell',
                                        });
                                        queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
                                      }
                                    }
                                    setEditingMeter(null);
                                  }}>
                                    <Check className="h-3 w-3 text-green-600" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingMeter(null)}>
                                    <X className="h-3 w-3 text-destructive" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1 min-w-0 cursor-pointer group" onClick={() => {
                                setMeterValues({
                                  [`${key}_zaehler`]: zaehlerVal,
                                  [`${key}_stand`]: String(standVal ?? ''),
                                  [`${key}_datum`]: datumVal,
                                });
                                setEditingMeter(key);
                              }}>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-foreground">{label}</span>
                                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {zaehlerVal ? `Nr. ${zaehlerVal}` : 'Kein Zähler'} 
                                  {standVal != null ? ` · ${standVal}` : ''}
                                  {datumVal ? ` · ${new Date(datumVal).toLocaleDateString('de-DE')}` : ''}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
                
                return (
                  <div className="bg-muted/30 rounded-lg p-3 border border-border/30">
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      Hausanschlusszähler
                    </h4>
                    {renderMeterRow(meterTypes)}
                    {hasSecondSet && (
                      <div className="mt-3">
                        {renderMeterRow(meterTypes2, 'Hausanschlusszähler 2')}
                      </div>
                    )}
                    {immobilie?.baujahr && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Baujahr: <strong className="text-foreground">{immobilie.baujahr}</strong></span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* Tabs für Einheiten, Dokumente und Zahlungen */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="einheiten" className="text-xs sm:text-sm">Einheiten</TabsTrigger>
            <TabsTrigger value="dokumente" className="text-xs sm:text-sm">Dokumente</TabsTrigger>
            <TabsTrigger value="versicherungen" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Versicherungen</span>
              <span className="sm:hidden">Versich.</span>
            </TabsTrigger>
            <TabsTrigger value="zahlungen" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Nebenkosten</span>
              <span className="sm:hidden">NK</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="einheiten">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {einheiten?.map((einheit, index) => {
                // Find all rental contracts for this unit
                const vertraegeForEinheit = mietvertraege?.filter(v => v.einheit_id === einheit.id) || [];
                
                // Default to the most current contract
                let vertrag = getCurrentContract(vertraegeForEinheit);
                
                // If a specific contract is requested (e.g., via search), prefer that one
                if (openMietvertragId) {
                  const targeted = vertraegeForEinheit.find(v => v.id === openMietvertragId);
                  if (targeted) {
                    vertrag = targeted;
                  }
                }
                
                return (
                  <div 
                    key={einheit.id} 
                    ref={el => einheitRefs.current[einheit.id] = el} 
                    className="transition-transform duration-300"
                  >
                    <EinheitCard 
                      einheit={einheit} 
                      vertrag={vertrag} 
                      immobilie={immobilie} 
                      openMietvertragId={openMietvertragId}
                      einheitIndex={index + 1}
                      onContractModalClose={onContractModalClose}
                    />
                  </div>
                );
              })}
            </div>
            
            {(!einheiten || einheiten.length === 0) && (
              <div className="text-center py-12">
                <div className="glass-card p-8 max-w-md mx-auto rounded-2xl">
                  <p className="text-gray-500">
                    Keine Einheiten für diese Immobilie gefunden
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="dokumente">
            <ImmobilienDocumentsTab 
              immobilieId={immobilieId}
              dokumente={immobilienDokumente || []}
            />
          </TabsContent>

          <TabsContent value="versicherungen">
            <ImmobilienVersicherungenTab immobilieId={immobilieId} />
          </TabsContent>

          <TabsContent value="zahlungen">
            <ImmobilienNebenkostenTabNew immobilieId={immobilieId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>;
};