import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "./UserMenu";
import { VersionBadge } from "./ChangelogDialog";
import { toast } from "sonner";
import { 
  Loader2, 
  Building2, 
  Droplets, 
  Flame, 
  Zap, 
  ThermometerSun,
  Save,
  Wrench,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MeterReading {
  einheitId: string;
  type: 'kaltwasser' | 'warmwasser' | 'strom' | 'gas';
  zaehlerNummer: string;
  stand: string;
  datum: string;
}

interface PropertyMeterReading {
  immobilieId: string;
  type: 'wasser' | 'strom' | 'gas';
  zaehlerNummer: string;
  stand: string;
  datum: string;
}

export const HausmeisterDashboard = () => {
  const queryClient = useQueryClient();
  const [expandedImmobilien, setExpandedImmobilien] = useState<Set<string>>(new Set());
  const [editedReadings, setEditedReadings] = useState<Record<string, MeterReading>>({});
  const [editedPropertyReadings, setEditedPropertyReadings] = useState<Record<string, PropertyMeterReading>>({});
  const [savingUnits, setSavingUnits] = useState<Set<string>>(new Set());
  const [savingProperties, setSavingProperties] = useState<Set<string>>(new Set());

  // Fetch all properties with their units
  const { data: immobilien, isLoading } = useQuery({
    queryKey: ['hausmeister-immobilien'],
    queryFn: async () => {
      const { data: props, error: propsError } = await supabase
        .from('immobilien')
        .select(`
          id, name, adresse,
          allgemein_wasser_zaehler, allgemein_wasser_stand, allgemein_wasser_datum,
          allgemein_strom_zaehler, allgemein_strom_stand, allgemein_strom_datum,
          allgemein_gas_zaehler, allgemein_gas_stand, allgemein_gas_datum,
          allgemein_strom_zaehler_2, allgemein_strom_stand_2, allgemein_strom_datum_2,
          allgemein_gas_zaehler_2, allgemein_gas_stand_2, allgemein_gas_datum_2,
          allgemein_wasser_zaehler_2, allgemein_wasser_stand_2, allgemein_wasser_datum_2
        `);
      
      if (propsError) throw propsError;

      // Natural sort: "Objekt 01" comes before "Objekt 10"
      const sortedProps = [...(props || [])].sort((a, b) => {
        return a.name.localeCompare(b.name, 'de', { numeric: true });
      });
      
      const propsWithUnits = await Promise.all(
        sortedProps.map(async (prop) => {
          const { data: units, error: unitsError } = await supabase
            .from('einheiten')
            .select(`
              id, 
              zaehler,
              etage,
              qm,
              einheitentyp,
              kaltwasser_zaehler,
              warmwasser_zaehler,
              strom_zaehler,
              gas_zaehler,
              kaltwasser_stand_aktuell,
              kaltwasser_stand_datum,
              warmwasser_stand_aktuell,
              warmwasser_stand_datum,
              strom_stand_aktuell,
              strom_stand_datum,
              gas_stand_aktuell,
              gas_stand_datum
            `)
            .eq('immobilie_id', prop.id)
            .order('zaehler');
          
          if (unitsError) throw unitsError;

          const unitIds = units?.map(u => u.id) || [];
          const { data: contracts } = await supabase
            .from('mietvertrag')
            .select(`
              id,
              einheit_id,
              status,
              mietvertrag_mieter!inner(mieter:mieter_id(vorname, nachname))
            `)
            .in('einheit_id', unitIds)
            .eq('status', 'aktiv');

          const contractMap = new Map(
            contracts?.map(c => [c.einheit_id, c]) || []
          );

          return {
            ...prop,
            einheiten: units?.map(u => ({
              ...u,
              vertrag: contractMap.get(u.id)
            })) || []
          };
        })
      );
      
      return propsWithUnits;
    }
  });

  const updateMeterMutation = useMutation({
    mutationFn: async ({ einheitId, updates }: { einheitId: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase
        .from('einheiten')
        .update(updates)
        .eq('id', einheitId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hausmeister-immobilien'] });
    }
  });

  const updatePropertyMeterMutation = useMutation({
    mutationFn: async ({ immobilieId, updates }: { immobilieId: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase
        .from('immobilien')
        .update(updates)
        .eq('id', immobilieId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hausmeister-immobilien'] });
    }
  });

  const toggleImmobilie = (id: string) => {
    setExpandedImmobilien(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleInputChange = (einheitId: string, type: string, field: 'zaehler' | 'stand' | 'datum', value: string) => {
    const key = `${einheitId}-${type}`;
    const fieldMap = { zaehler: 'zaehlerNummer', stand: 'stand', datum: 'datum' };
    setEditedReadings(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        einheitId,
        type: type as MeterReading['type'],
        [fieldMap[field]]: value
      }
    }));
  };

  const getEditedValue = (einheitId: string, type: string, field: 'zaehler' | 'stand' | 'datum') => {
    const key = `${einheitId}-${type}`;
    const edited = editedReadings[key];
    if (!edited) return undefined;
    if (field === 'zaehler') return edited.zaehlerNummer;
    if (field === 'stand') return edited.stand;
    return edited.datum;
  };

  const handlePropertyInputChange = (immobilieId: string, type: string, field: 'zaehler' | 'stand' | 'datum', value: string) => {
    const key = `${immobilieId}-${type}`;
    const fieldMap = { zaehler: 'zaehlerNummer', stand: 'stand', datum: 'datum' };
    setEditedPropertyReadings(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        immobilieId,
        type: type as PropertyMeterReading['type'],
        [fieldMap[field]]: value
      }
    }));
  };

  const getEditedPropertyValue = (immobilieId: string, type: string, field: 'zaehler' | 'stand' | 'datum') => {
    const key = `${immobilieId}-${type}`;
    const edited = editedPropertyReadings[key];
    if (!edited) return undefined;
    if (field === 'zaehler') return edited.zaehlerNummer;
    if (field === 'stand') return edited.stand;
    return edited.datum;
  };

  const hasUnsavedPropertyChanges = (immobilieId: string) => {
    return Object.keys(editedPropertyReadings).some(key => key.startsWith(`${immobilieId}-`));
  };

  const savePropertyChanges = async (immobilieId: string) => {
    const propChanges = Object.entries(editedPropertyReadings)
      .filter(([key]) => key.startsWith(`${immobilieId}-`))
      .map(([, reading]) => reading);

    if (propChanges.length === 0) return;

    setSavingProperties(prev => new Set(prev).add(immobilieId));

    try {
      const updates: Record<string, unknown> = {};
      const today = format(new Date(), 'yyyy-MM-dd');

      for (const change of propChanges) {
        const baseType = change.type.replace('_2', '');
        const suffix = change.type.endsWith('_2') ? '_2' : '';
        if (change.zaehlerNummer !== undefined) {
          updates[`allgemein_${baseType}_zaehler${suffix}`] = change.zaehlerNummer || null;
        }
        if (change.stand !== undefined) {
          const standValue = change.stand ? parseFloat(change.stand) : null;
          updates[`allgemein_${baseType}_stand${suffix}`] = standValue;
          if (standValue !== null && change.datum === undefined) {
            updates[`allgemein_${baseType}_datum${suffix}`] = today;
          }
        }
        if (change.datum !== undefined) {
          updates[`allgemein_${baseType}_datum${suffix}`] = change.datum || null;
        }
      }

      await updatePropertyMeterMutation.mutateAsync({ immobilieId, updates });

      setEditedPropertyReadings(prev => {
        const next = { ...prev };
        Object.keys(next)
          .filter(key => key.startsWith(`${immobilieId}-`))
          .forEach(key => delete next[key]);
        return next;
      });

      toast.success("Hausanschlusszähler gespeichert");
    } catch (error) {
      toast.error("Fehler beim Speichern");
    } finally {
      setSavingProperties(prev => {
        const next = new Set(prev);
        next.delete(immobilieId);
        return next;
      });
    }
  };

  const hasUnsavedChanges = (einheitId: string) => {
    return Object.keys(editedReadings).some(key => key.startsWith(`${einheitId}-`));
  };

  const saveUnitChanges = async (einheitId: string) => {
    const unitChanges = Object.entries(editedReadings)
      .filter(([key]) => key.startsWith(`${einheitId}-`))
      .map(([, reading]) => reading);

    if (unitChanges.length === 0) return;

    setSavingUnits(prev => new Set(prev).add(einheitId));

    try {
      const updates: Record<string, unknown> = {};
      const today = format(new Date(), 'yyyy-MM-dd');

      for (const change of unitChanges) {
        if (change.zaehlerNummer !== undefined) {
          updates[`${change.type}_zaehler`] = change.zaehlerNummer || null;
        }
        if (change.stand !== undefined) {
          const standValue = change.stand ? parseFloat(change.stand) : null;
          updates[`${change.type}_stand_aktuell`] = standValue;
          // Only auto-set datum if no explicit datum was provided and stand was changed
          if (standValue !== null && change.datum === undefined) {
            updates[`${change.type}_stand_datum`] = today;
          }
        }
        if (change.datum !== undefined) {
          updates[`${change.type}_stand_datum`] = change.datum || null;
        }
      }

      await updateMeterMutation.mutateAsync({ einheitId, updates });

      setEditedReadings(prev => {
        const next = { ...prev };
        Object.keys(next)
          .filter(key => key.startsWith(`${einheitId}-`))
          .forEach(key => delete next[key]);
        return next;
      });

      toast.success("Zählerstände gespeichert");
    } catch (error) {
      toast.error("Fehler beim Speichern");
    } finally {
      setSavingUnits(prev => {
        const next = new Set(prev);
        next.delete(einheitId);
        return next;
      });
    }
  };

  const getMeterIcon = (type: string, className = "h-3.5 w-3.5") => {
    switch (type) {
      case 'kaltwasser': return <Droplets className={`${className} text-blue-500`} />;
      case 'warmwasser': return <ThermometerSun className={`${className} text-orange-500`} />;
      case 'strom': return <Zap className={`${className} text-yellow-600`} />;
      case 'gas': return <Flame className={`${className} text-red-500`} />;
      default: return null;
    }
  };

  const getMeterLabel = (type: string) => {
    switch (type) {
      case 'kaltwasser': return 'KW';
      case 'warmwasser': return 'WW';
      case 'strom': return 'Strom';
      case 'gas': return 'Gas';
      case 'wasser': return 'Wasser';
      default: return type;
    }
  };

  const getPropertyMeterIcon = (type: string, className = "h-3.5 w-3.5") => {
    switch (type) {
      case 'wasser': return <Droplets className={`${className} text-blue-600`} />;
      case 'strom': return <Zap className={`${className} text-yellow-600`} />;
      case 'gas': return <Flame className={`${className} text-red-500`} />;
      default: return null;
    }
  };

  const formatStandDatum = (datum: string | null) => {
    if (!datum) return '-';
    return format(new Date(datum), 'dd.MM.yy', { locale: de });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen modern-dashboard-bg flex items-center justify-center">
        <div className="glass-card p-8 rounded-2xl">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Laden...</p>
        </div>
      </div>
    );
  }

  const meterTypes = ['kaltwasser', 'warmwasser', 'strom', 'gas'] as const;

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-3 py-3 sm:p-4 lg:p-6">
        {/* Compact Header */}
        <div className="glass-card p-3 sm:p-4 rounded-xl mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="Logo" className="h-7 sm:h-9 w-auto" />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-bold text-gradient-red">NiImmo</h1>
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 text-xs py-0">
                    <Wrench className="h-3 w-3 mr-1" />
                    Hausmeister
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <VersionBadge className="hidden sm:flex" />
              <UserMenu />
            </div>
          </div>
        </div>

        {/* Properties List */}
        <div className="space-y-3">
          {immobilien?.map((immobilie) => (
            <div key={immobilie.id} className="glass-card rounded-xl overflow-hidden">
              <Collapsible 
                open={expandedImmobilien.has(immobilie.id)}
                onOpenChange={() => toggleImmobilie(immobilie.id)}
              >
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2">
                      {expandedImmobilien.has(immobilie.id) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Building2 className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{immobilie.name}</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">· {immobilie.adresse}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {immobilie.einheiten?.length || 0}
                    </Badge>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="border-t">
                    {/* Hausanschlusszähler Section */}
                    <div className="bg-muted/30 p-2 border-b">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hausanschlusszähler</span>
                        {hasUnsavedPropertyChanges(immobilie.id) && (
                          <Button
                            size="sm"
                            onClick={() => savePropertyChanges(immobilie.id)}
                            disabled={savingProperties.has(immobilie.id)}
                            className="h-5 px-2 text-xs bg-green-600 hover:bg-green-700"
                          >
                            {savingProperties.has(immobilie.id) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Save className="h-3 w-3 mr-1" />
                                Speichern
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(['wasser', 'strom', 'gas'] as const).map((type) => {
                          const zaehlerKey = `allgemein_${type}_zaehler` as keyof typeof immobilie;
                          const standKey = `allgemein_${type}_stand` as keyof typeof immobilie;
                          const datumKey = `allgemein_${type}_datum` as keyof typeof immobilie;
                          
                          const currentZaehler = immobilie[zaehlerKey] as string | null;
                          const currentStand = immobilie[standKey] as number | null;
                          const standDatum = immobilie[datumKey] as string | null;

                          const editedZaehler = getEditedPropertyValue(immobilie.id, type, 'zaehler');
                          const editedStand = getEditedPropertyValue(immobilie.id, type, 'stand');

                          return (
                            <div key={type} className="bg-background rounded p-1.5">
                              <div className="flex items-center gap-1 mb-1">
                                {getPropertyMeterIcon(type, "h-3 w-3")}
                                <span className="text-xs font-medium">{getMeterLabel(type)}</span>
                              </div>
                              <div className="space-y-0.5">
                                <Input
                                  placeholder="Zähler-Nr."
                                  value={editedZaehler ?? currentZaehler ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'zaehler', e.target.value)}
                                  className="h-5 text-xs px-1.5"
                                />
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="Stand"
                                  value={editedStand ?? currentStand ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'stand', e.target.value)}
                                  className="h-5 text-xs px-1.5"
                                />
                                <Input
                                  type="date"
                                  placeholder="Datum"
                                  value={getEditedPropertyValue(immobilie.id, type, 'datum') ?? standDatum ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'datum', e.target.value)}
                                  className="h-5 text-xs px-1.5"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Zweiter Satz Hausanschlusszähler (Sonderfall) */}
                      {(immobilie.allgemein_strom_zaehler_2 != null || immobilie.allgemein_gas_zaehler_2 != null || immobilie.allgemein_wasser_zaehler_2 != null ||
                        immobilie.allgemein_strom_stand_2 || immobilie.allgemein_gas_stand_2 || immobilie.allgemein_wasser_stand_2) && (
                        <>
                          <div className="mt-2 mb-1">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Hausanschlusszähler 2</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {(['wasser_2', 'strom_2', 'gas_2'] as const).map((type) => {
                              const baseType = type.replace('_2', '');
                              const zaehlerKey = `allgemein_${baseType}_zaehler_2` as keyof typeof immobilie;
                              const standKey = `allgemein_${baseType}_stand_2` as keyof typeof immobilie;
                              const datumKey = `allgemein_${baseType}_datum_2` as keyof typeof immobilie;

                              const currentZaehler = immobilie[zaehlerKey] as string | null;
                              const currentStand = immobilie[standKey] as number | null;
                              const standDatum = immobilie[datumKey] as string | null;

                              const editedZaehler = getEditedPropertyValue(immobilie.id, type, 'zaehler');
                              const editedStand = getEditedPropertyValue(immobilie.id, type, 'stand');

                              return (
                                <div key={type} className="bg-background rounded p-1.5">
                                  <div className="flex items-center gap-1 mb-1">
                                    {getPropertyMeterIcon(baseType, "h-3 w-3")}
                                    <span className="text-xs font-medium">{getMeterLabel(baseType)} (2)</span>
                                  </div>
                                  <div className="space-y-0.5">
                                    <Input
                                      placeholder="Zähler-Nr."
                                      value={editedZaehler ?? currentZaehler ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'zaehler', e.target.value)}
                                      className="h-5 text-xs px-1.5"
                                    />
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="Stand"
                                      value={editedStand ?? currentStand ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'stand', e.target.value)}
                                      className="h-5 text-xs px-1.5"
                                    />
                                    <Input
                                      type="date"
                                      placeholder="Datum"
                                      value={getEditedPropertyValue(immobilie.id, type, 'datum') ?? standDatum ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'datum', e.target.value)}
                                      className="h-5 text-xs px-1.5"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Einheiten Table */}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead className="w-[80px] py-2">Einheit</TableHead>
                            <TableHead className="w-[120px] py-2 hidden sm:table-cell">Mieter</TableHead>
                            {meterTypes.map(type => (
                              <TableHead key={type} className="py-2 text-center min-w-[100px]">
                                <div className="flex items-center justify-center gap-1">
                                  {getMeterIcon(type)}
                                  <span>{getMeterLabel(type)}</span>
                                </div>
                              </TableHead>
                            ))}
                            <TableHead className="w-[70px] py-2"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {immobilie.einheiten?.map((einheit) => {
                            const tenantName = einheit.vertrag?.mietvertrag_mieter?.[0]?.mieter
                              ? `${einheit.vertrag.mietvertrag_mieter[0].mieter.vorname} ${einheit.vertrag.mietvertrag_mieter[0].mieter.nachname?.[0] || ''}.`
                              : '-';

                            return (
                              <TableRow key={einheit.id} className="text-xs">
                                <TableCell className="py-1.5 font-medium">
                                  <div>
                                    <span>{einheit.zaehler}</span>
                                    {einheit.etage && (
                                      <span className="text-muted-foreground ml-1">({einheit.etage})</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="py-1.5 text-muted-foreground hidden sm:table-cell truncate max-w-[120px]">
                                  {tenantName}
                                </TableCell>
                                {meterTypes.map((type) => {
                                  const zaehlerKey = `${type}_zaehler` as keyof typeof einheit;
                                  const standKey = `${type}_stand_aktuell` as keyof typeof einheit;
                                  const datumKey = `${type}_stand_datum` as keyof typeof einheit;
                                  
                                  const currentZaehler = einheit[zaehlerKey] as string | null;
                                  const currentStand = einheit[standKey] as number | null;
                                  const standDatum = einheit[datumKey] as string | null;

                                  const editedZaehler = getEditedValue(einheit.id, type, 'zaehler');
                                  const editedStand = getEditedValue(einheit.id, type, 'stand');

                                  return (
                                    <TableCell key={type} className="py-1.5">
                                      <div className="flex flex-col gap-0.5">
                                        <Input
                                          placeholder="Nr."
                                          value={editedZaehler ?? currentZaehler ?? ''}
                                          onChange={(e) => handleInputChange(einheit.id, type, 'zaehler', e.target.value)}
                                          className="h-6 text-xs px-1.5"
                                        />
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder="Stand"
                                          value={editedStand ?? currentStand ?? ''}
                                          onChange={(e) => handleInputChange(einheit.id, type, 'stand', e.target.value)}
                                          className="h-6 text-xs px-1.5"
                                        />
                                        <Input
                                          type="date"
                                          placeholder="Datum"
                                          value={getEditedValue(einheit.id, type, 'datum') ?? standDatum ?? ''}
                                          onChange={(e) => handleInputChange(einheit.id, type, 'datum', e.target.value)}
                                          className="h-6 text-xs px-1.5"
                                        />
                                      </div>
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="py-1.5">
                                  {hasUnsavedChanges(einheit.id) && (
                                    <Button
                                      size="sm"
                                      onClick={() => saveUnitChanges(einheit.id)}
                                      disabled={savingUnits.has(einheit.id)}
                                      className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
                                    >
                                      {savingUnits.has(einheit.id) ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Save className="h-3 w-3" />
                                      )}
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {immobilie.einheiten?.length === 0 && (
                      <p className="text-muted-foreground text-center py-4 text-sm">
                        Keine Einheiten vorhanden
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ))}
        </div>

        {immobilien?.length === 0 && (
          <div className="text-center py-12">
            <div className="glass-card p-8 max-w-sm mx-auto rounded-2xl">
              <Building2 className="h-12 w-12 text-amber-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Keine Immobilien
              </h3>
              <p className="text-gray-500 text-sm">
                Es sind noch keine Immobilien verfügbar.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};