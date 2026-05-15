import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Loader2,
  Building2,
  Droplets,
  Flame,
  Zap,
  ThermometerSun,
  Save,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Gauge
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ZaehlerHistorie } from "@/components/dashboard/ZaehlerHistorie";

interface MeterReading {
  einheitId: string;
  type: 'kaltwasser' | 'warmwasser' | 'strom' | 'gas';
  zaehlerNummer: string;
  stand: string;
  datum: string;
}

interface PropertyMeterReading {
  immobilieId: string;
  type: 'wasser' | 'strom' | 'gas' | 'versorger_strom' | 'versorger_gas' | 'versorger_wasser';
  zaehlerNummer?: string;
  stand?: string;
  datum?: string;
  name?: string;
  email?: string;
}

interface ZaehlerVerwaltungProps {
  onBack: () => void;
}

export const ZaehlerVerwaltung = ({ onBack }: ZaehlerVerwaltungProps) => {
  const queryClient = useQueryClient();
  const [expandedImmobilien, setExpandedImmobilien] = useState<Set<string>>(new Set());
  const [editedReadings, setEditedReadings] = useState<Record<string, MeterReading>>({});
  const [editedPropertyReadings, setEditedPropertyReadings] = useState<Record<string, PropertyMeterReading>>({});
  const [savingUnits, setSavingUnits] = useState<Set<string>>(new Set());
  const [savingProperties, setSavingProperties] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch all properties with their units
  const { data: immobilien, isLoading } = useQuery({
    queryKey: ['zaehler-verwaltung-immobilien'],
    queryFn: async () => {
      const { data: props, error: propsError } = await supabase
        .from('immobilien')
        .select(`
          id, name, adresse, hat_strom, hat_gas, hat_wasser,
          versorger_strom_name, versorger_strom_email,
          versorger_gas_name, versorger_gas_email,
          versorger_wasser_name, versorger_wasser_email,
          allgemein_wasser_zaehler, allgemein_wasser_stand, allgemein_wasser_datum,
          allgemein_strom_zaehler, allgemein_strom_stand, allgemein_strom_datum,
          allgemein_gas_zaehler, allgemein_gas_stand, allgemein_gas_datum,
          allgemein_strom_zaehler_2, allgemein_strom_stand_2, allgemein_strom_datum_2,
          allgemein_gas_zaehler_2, allgemein_gas_stand_2, allgemein_gas_datum_2,
          allgemein_wasser_zaehler_2, allgemein_wasser_stand_2, allgemein_wasser_datum_2
        `);

      if (propsError) throw propsError;

      const sortedProps = [...(props || [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'de', { numeric: true })
      );

      const propsWithUnits = await Promise.all(
        sortedProps.map(async (prop) => {
          const { data: units, error: unitsError } = await supabase
            .from('einheiten')
            .select(`
              id, zaehler, etage, qm, einheitentyp,
              kaltwasser_zaehler, warmwasser_zaehler, strom_zaehler, gas_zaehler,
              kaltwasser_stand_aktuell, kaltwasser_stand_datum,
              warmwasser_stand_aktuell, warmwasser_stand_datum,
              strom_stand_aktuell, strom_stand_datum,
              gas_stand_aktuell, gas_stand_datum
            `)
            .eq('immobilie_id', prop.id)
            .order('zaehler');

          if (unitsError) throw unitsError;

          const unitIds = units?.map(u => u.id) || [];
          let contracts: any[] = [];
          if (unitIds.length > 0) {
            const { data: contractData } = await supabase
              .from('mietvertrag')
              .select(`
                id, einheit_id, status,
                mietvertrag_mieter!inner(mieter:mieter_id(vorname, nachname))
              `)
              .in('einheit_id', unitIds)
              .eq('status', 'aktiv');
            contracts = contractData || [];
          }

          const contractMap = new Map(
            contracts.map(c => [c.einheit_id, c])
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
      queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] });
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
      queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] });
    }
  });

  const toggleImmobilie = (id: string) => {
    setExpandedImmobilien(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (!immobilien) return;
    setExpandedImmobilien(new Set(immobilien.map(i => i.id)));
  };

  const collapseAll = () => {
    setExpandedImmobilien(new Set());
  };

  // Unit meter input handling
  const handleInputChange = (einheitId: string, type: string, field: 'zaehler' | 'stand' | 'datum', value: string) => {
    const key = `${einheitId}-${type}`;
    const fieldMap = { zaehler: 'zaehlerNummer', stand: 'stand', datum: 'datum' } as const;
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

  // Property meter input handling
  const handlePropertyInputChange = (immobilieId: string, type: string, field: 'zaehler' | 'stand' | 'datum' | 'name' | 'email', value: string) => {
    const key = `${immobilieId}-${type}`;
    const fieldMap = { zaehler: 'zaehlerNummer', stand: 'stand', datum: 'datum', name: 'name', email: 'email' } as const;
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

  const getEditedPropertyValue = (immobilieId: string, type: string, field: 'zaehler' | 'stand' | 'datum' | 'name' | 'email') => {
    const key = `${immobilieId}-${type}`;
    const edited = editedPropertyReadings[key];
    if (!edited) return undefined;
    if (field === 'zaehler') return edited.zaehlerNummer;
    if (field === 'stand') return edited.stand;
    if (field === 'name') return edited.name;
    if (field === 'email') return edited.email;
    return edited.datum;
  };

  const hasUnsavedPropertyChanges = (immobilieId: string) =>
    Object.keys(editedPropertyReadings).some(key => key.startsWith(`${immobilieId}-`));

  const hasUnsavedChanges = (einheitId: string) =>
    Object.keys(editedReadings).some(key => key.startsWith(`${einheitId}-`));

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
        // Handle versorger fields
        if (change.type.startsWith('versorger_')) {
          const utilityType = change.type.replace('versorger_', '');
          if (change.name !== undefined) {
            updates[`versorger_${utilityType}_name`] = change.name || null;
          }
          if (change.email !== undefined) {
            updates[`versorger_${utilityType}_email`] = change.email || null;
          }
          continue;
        }
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

      // Insert history entries for meter readings
      for (const change of propChanges) {
        if (change.type.startsWith('versorger_')) continue;
        if (change.stand === undefined) continue;
        const standValue = change.stand ? parseFloat(change.stand) : null;
        if (standValue === null) continue;
        const baseType = change.type.replace('_2', '');
        const suffix = change.type.endsWith('_2') ? '_2' : '';
        const zaehlerKey = `allgemein_${baseType}_zaehler${suffix}` as keyof typeof updates;
        const datumKey = `allgemein_${baseType}_datum${suffix}` as keyof typeof updates;
        const zaehlerNr = (updates[zaehlerKey] as string) ?? change.zaehlerNummer ?? null;
        const datum = (updates[datumKey] as string) ?? format(new Date(), 'yyyy-MM-dd');
        await supabase.from('zaehlerstand_historie').insert({
          immobilie_id: immobilieId,
          zaehler_typ: change.type,
          zaehler_nummer: zaehlerNr,
          stand: standValue,
          datum,
          quelle: 'manuell',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });

      setEditedPropertyReadings(prev => {
        const next = { ...prev };
        Object.keys(next).filter(key => key.startsWith(`${immobilieId}-`)).forEach(key => delete next[key]);
        return next;
      });

      toast.success("Hausanschlusszähler gespeichert");
    } catch (error) {
      toast.error("Fehler beim Speichern der Hausanschlusszähler");
    } finally {
      setSavingProperties(prev => {
        const next = new Set(prev);
        next.delete(immobilieId);
        return next;
      });
    }
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
          if (standValue !== null && change.datum === undefined) {
            updates[`${change.type}_stand_datum`] = today;
          }
        }
        if (change.datum !== undefined) {
          updates[`${change.type}_stand_datum`] = change.datum || null;
        }
      }

      await updateMeterMutation.mutateAsync({ einheitId, updates });

      // Insert history entries for meter readings
      for (const change of unitChanges) {
        if (change.stand === undefined) continue;
        const standValue = change.stand ? parseFloat(change.stand) : null;
        if (standValue === null) continue;
        const zaehlerNr = (updates[`${change.type}_zaehler`] as string) ?? change.zaehlerNummer ?? null;
        const datum = (updates[`${change.type}_stand_datum`] as string) ?? format(new Date(), 'yyyy-MM-dd');
        await supabase.from('zaehlerstand_historie').insert({
          einheit_id: einheitId,
          zaehler_typ: change.type,
          zaehler_nummer: zaehlerNr,
          stand: standValue,
          datum,
          quelle: 'manuell',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });

      setEditedReadings(prev => {
        const next = { ...prev };
        Object.keys(next).filter(key => key.startsWith(`${einheitId}-`)).forEach(key => delete next[key]);
        return next;
      });

      toast.success("Zählerstände gespeichert");
    } catch (error) {
      toast.error("Fehler beim Speichern der Zählerstände");
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

  // Total unsaved changes count
  const totalUnsaved = Object.keys(editedReadings).length + Object.keys(editedPropertyReadings).length;

  // Filtered immobilien
  const filteredImmobilien = immobilien?.filter(i => {
    if (!searchTerm) return true;
    const normalize = (v: string) => v.toLowerCase().replace(/\s+/g, '');
    const s = normalize(searchTerm);
    if (normalize(i.name).includes(s) || normalize(i.adresse).includes(s)) return true;
    // Search in meter numbers
    return i.einheiten?.some((e: any) =>
      (e.kaltwasser_zaehler && normalize(e.kaltwasser_zaehler).includes(s)) ||
      (e.warmwasser_zaehler && normalize(e.warmwasser_zaehler).includes(s)) ||
      (e.strom_zaehler && normalize(e.strom_zaehler).includes(s)) ||
      (e.gas_zaehler && normalize(e.gas_zaehler).includes(s)) ||
      normalize(String(e.zaehler || '')).includes(s)
    );
  });

  const getPropertyMeterTypes = (immobilie: any) => {
    const types: Array<'wasser' | 'strom' | 'gas'> = [];
    if (immobilie.hat_strom !== false) types.push('strom');
    if (immobilie.hat_gas !== false) types.push('gas');
    if (immobilie.hat_wasser !== false) types.push('wasser');
    return types;
  };

  const getUnitMeterTypes = (immobilie: any) => {
    const types: Array<'kaltwasser' | 'warmwasser' | 'strom' | 'gas'> = [];
    if (immobilie.hat_wasser !== false) { types.push('kaltwasser'); types.push('warmwasser'); }
    if (immobilie.hat_strom !== false) types.push('strom');
    if (immobilie.hat_gas !== false) types.push('gas');
    return types;
  };

  const toggleUtilityConfig = async (immobilieId: string, field: 'hat_strom' | 'hat_gas' | 'hat_wasser', value: boolean) => {
    try {
      const { error } = await supabase
        .from('immobilien')
        .update({ [field]: value })
        .eq('id', immobilieId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] });
      toast.success('Versorgungskonfiguration gespeichert');
    } catch (error) {
      toast.error('Fehler beim Speichern');
    }
  };

  const meterTypes = ['kaltwasser', 'warmwasser', 'strom', 'gas'] as const;

  if (isLoading) {
    return (
      <div className="min-h-screen modern-dashboard-bg flex items-center justify-center">
        <div className="glass-card p-8 rounded-2xl">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-700 font-medium">Zähler werden geladen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-3 py-3 sm:p-4 lg:p-6">
        {/* Header */}
        <div className="glass-card p-3 sm:p-4 rounded-xl mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="h-8 w-8 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Gauge className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-800">Zählerverwaltung</h1>
                <p className="text-xs text-gray-500 hidden sm:block">
                  {immobilien?.length || 0} Immobilien · {immobilien?.reduce((sum, i) => sum + (i.einheiten?.length || 0), 0) || 0} Einheiten
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {totalUnsaved > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {totalUnsaved} ungespeichert
                </Badge>
              )}
            </div>
          </div>

          {/* Search & controls */}
          <div className="flex items-center gap-2 mt-3">
            <Input
              placeholder="Suche nach Objekt, Adresse oder Zähler-Nr..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            <Button variant="outline" size="sm" onClick={expandAll} className="h-8 text-xs whitespace-nowrap">
              Alle öffnen
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll} className="h-8 text-xs whitespace-nowrap">
              Alle schließen
            </Button>
          </div>
        </div>

        {/* Properties List */}
        <div className="space-y-3">
          {filteredImmobilien?.map((immobilie) => (
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
                    <div className="flex items-center gap-2">
                      {hasUnsavedPropertyChanges(immobilie.id) && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          geändert
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {immobilie.einheiten?.length || 0} Einheiten
                      </Badge>
                    </div>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="border-t">
                    {/* Hausanschlusszähler Section */}
                    <div className="bg-muted/30 p-2 sm:p-3 border-b">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Hausanschlusszähler
                        </span>
                        <div className="flex items-center gap-3">
                          {/* Utility config checkboxes */}
                          <div className="flex items-center gap-3 mr-2">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={immobilie.hat_strom !== false}
                                onCheckedChange={(checked) => toggleUtilityConfig(immobilie.id, 'hat_strom', !!checked)}
                              />
                              <Zap className="h-3 w-3 text-yellow-600" />
                              <span className="text-xs">Strom</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={immobilie.hat_gas !== false}
                                onCheckedChange={(checked) => toggleUtilityConfig(immobilie.id, 'hat_gas', !!checked)}
                              />
                              <Flame className="h-3 w-3 text-red-500" />
                              <span className="text-xs">Gas</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={immobilie.hat_wasser !== false}
                                onCheckedChange={(checked) => toggleUtilityConfig(immobilie.id, 'hat_wasser', !!checked)}
                              />
                              <Droplets className="h-3 w-3 text-blue-500" />
                              <span className="text-xs">Wasser</span>
                            </label>
                          </div>
                          {hasUnsavedPropertyChanges(immobilie.id) && (
                            <Button
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); savePropertyChanges(immobilie.id); }}
                              disabled={savingProperties.has(immobilie.id)}
                              className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
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
                      </div>
                      {/* Versorger-Details pro Versorgungsart */}
                      {getPropertyMeterTypes(immobilie).length > 0 && (
                        <div className={`grid gap-2 mb-2`} style={{ gridTemplateColumns: `repeat(${getPropertyMeterTypes(immobilie).length || 1}, 1fr)` }}>
                          {getPropertyMeterTypes(immobilie).map((type) => {
                            const nameKey = `versorger_${type}_name` as keyof typeof immobilie;
                            const emailKey = `versorger_${type}_email` as keyof typeof immobilie;
                            return (
                              <div key={`versorger-${type}`} className="bg-background rounded p-1.5 sm:p-2">
                                <div className="flex items-center gap-1 mb-1">
                                  {type === 'strom' && <Zap className="h-3 w-3 text-yellow-600" />}
                                  {type === 'gas' && <Flame className="h-3 w-3 text-red-500" />}
                                  {type === 'wasser' && <Droplets className="h-3 w-3 text-blue-500" />}
                                  <span className="text-xs font-medium">Versorger {getMeterLabel(type)}</span>
                                </div>
                                <div className="space-y-0.5">
                                  <Input
                                    placeholder="Versorger-Name"
                                    value={getEditedPropertyValue(immobilie.id, `versorger_${type}` as any, 'name') ?? (immobilie[nameKey] as string | null) ?? ''}
                                    onChange={(e) => handlePropertyInputChange(immobilie.id, `versorger_${type}` as any, 'name', e.target.value)}
                                    className="h-6 text-xs px-1.5"
                                  />
                                  <Input
                                    type="email"
                                    placeholder="E-Mail"
                                    value={getEditedPropertyValue(immobilie.id, `versorger_${type}` as any, 'email') ?? (immobilie[emailKey] as string | null) ?? ''}
                                    onChange={(e) => handlePropertyInputChange(immobilie.id, `versorger_${type}` as any, 'email', e.target.value)}
                                    className="h-6 text-xs px-1.5"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${getPropertyMeterTypes(immobilie).length || 1}, 1fr)` }}>
                        {getPropertyMeterTypes(immobilie).map((type) => {
                          const zaehlerKey = `allgemein_${type}_zaehler` as keyof typeof immobilie;
                          const standKey = `allgemein_${type}_stand` as keyof typeof immobilie;
                          const datumKey = `allgemein_${type}_datum` as keyof typeof immobilie;

                          const currentZaehler = immobilie[zaehlerKey] as string | null;
                          const currentStand = immobilie[standKey] as number | null;
                          const standDatum = immobilie[datumKey] as string | null;

                          const editedZaehler = getEditedPropertyValue(immobilie.id, type, 'zaehler');
                          const editedStand = getEditedPropertyValue(immobilie.id, type, 'stand');

                          return (
                            <div key={type} className="bg-background rounded p-1.5 sm:p-2">
                              <div className="flex items-center gap-1 mb-1">
                                {getPropertyMeterIcon(type, "h-3 w-3")}
                                <span className="text-xs font-medium">{getMeterLabel(type)}</span>
                                {standDatum && (
                                  <span className="text-[10px] text-muted-foreground ml-auto">
                                    {formatStandDatum(standDatum)}
                                  </span>
                                )}
                              </div>
                              <div className="space-y-0.5">
                                <Input
                                  placeholder="Zähler-Nr."
                                  value={editedZaehler ?? currentZaehler ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'zaehler', e.target.value)}
                                  className="h-6 text-xs px-1.5"
                                />
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="Stand"
                                  value={editedStand ?? currentStand ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'stand', e.target.value)}
                                  className="h-6 text-xs px-1.5"
                                />
                                <Input
                                  type="date"
                                  placeholder="Datum"
                                  value={getEditedPropertyValue(immobilie.id, type, 'datum') ?? standDatum ?? ''}
                                  onChange={(e) => handlePropertyInputChange(immobilie.id, type, 'datum', e.target.value)}
                                  className="h-6 text-xs px-1.5"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Zweiter Satz Hausanschlusszähler (Sonderfall z.B. Gehrden, Schellerten) */}
                      {(immobilie.allgemein_strom_zaehler_2 != null || immobilie.allgemein_gas_zaehler_2 != null || immobilie.allgemein_wasser_zaehler_2 != null ||
                        immobilie.allgemein_strom_stand_2 || immobilie.allgemein_gas_stand_2 || immobilie.allgemein_wasser_stand_2) && (
                        <>
                          <div className="mt-2 mb-1">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Hausanschlusszähler 2</span>
                          </div>
                          <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${getPropertyMeterTypes(immobilie).length || 1}, 1fr)` }}>
                            {getPropertyMeterTypes(immobilie).map((type) => {
                              const type2 = `${type}_2` as const;
                              const zaehlerKey = `allgemein_${type}_zaehler_2` as keyof typeof immobilie;
                              const standKey = `allgemein_${type}_stand_2` as keyof typeof immobilie;
                              const datumKey = `allgemein_${type}_datum_2` as keyof typeof immobilie;

                              const currentZaehler = immobilie[zaehlerKey] as string | null;
                              const currentStand = immobilie[standKey] as number | null;
                              const standDatum = immobilie[datumKey] as string | null;

                              const editedZaehler = getEditedPropertyValue(immobilie.id, type2, 'zaehler');
                              const editedStand = getEditedPropertyValue(immobilie.id, type2, 'stand');

                              return (
                                <div key={type2} className="bg-background rounded p-1.5 sm:p-2">
                                  <div className="flex items-center gap-1 mb-1">
                                    {getPropertyMeterIcon(type, "h-3 w-3")}
                                    <span className="text-xs font-medium">{getMeterLabel(type)} (2)</span>
                                    {standDatum && (
                                      <span className="text-[10px] text-muted-foreground ml-auto">
                                        {formatStandDatum(standDatum)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="space-y-0.5">
                                    <Input
                                      placeholder="Zähler-Nr."
                                      value={editedZaehler ?? currentZaehler ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type2, 'zaehler', e.target.value)}
                                      className="h-6 text-xs px-1.5"
                                    />
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder="Stand"
                                      value={editedStand ?? currentStand ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type2, 'stand', e.target.value)}
                                      className="h-6 text-xs px-1.5"
                                    />
                                    <Input
                                      type="date"
                                      placeholder="Datum"
                                      value={getEditedPropertyValue(immobilie.id, type2, 'datum') ?? standDatum ?? ''}
                                      onChange={(e) => handlePropertyInputChange(immobilie.id, type2, 'datum', e.target.value)}
                                      className="h-6 text-xs px-1.5"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <div className="mt-2">
                        <ZaehlerHistorie immobilieId={immobilie.id} label="Hausanschluss-Historie" />
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead className="w-[80px] py-2">Einheit</TableHead>
                            <TableHead className="w-[120px] py-2 hidden sm:table-cell">Mieter</TableHead>
                            {getUnitMeterTypes(immobilie).map(type => (
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
                          {immobilie.einheiten?.map((einheit: any) => {
                            const tenantName = einheit.vertrag?.mietvertrag_mieter?.[0]?.mieter
                              ? `${einheit.vertrag.mietvertrag_mieter[0].mieter.vorname} ${einheit.vertrag.mietvertrag_mieter[0].mieter.nachname?.[0] || ''}.`
                              : '-';

                            return (
                              <React.Fragment key={einheit.id}>
                                <TableRow className="text-xs">
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
                                  {getUnitMeterTypes(immobilie).map((type) => {
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
                                <TableRow className="border-0 hover:bg-transparent">
                                  <TableCell colSpan={getUnitMeterTypes(immobilie).length + 3} className="py-0 px-2">
                                    <ZaehlerHistorie einheitId={einheit.id} />
                                  </TableCell>
                                </TableRow>
                              </React.Fragment>
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

        {filteredImmobilien?.length === 0 && (
          <div className="text-center py-12">
            <div className="glass-card p-8 max-w-sm mx-auto rounded-2xl">
              <Gauge className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                {searchTerm ? "Keine Treffer" : "Keine Immobilien"}
              </h3>
              <p className="text-gray-500 text-sm">
                {searchTerm ? "Versuchen Sie einen anderen Suchbegriff." : "Es sind noch keine Immobilien verfügbar."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
