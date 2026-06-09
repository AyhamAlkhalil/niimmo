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
  Gauge,
  Pencil,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ZaehlerHistorie } from "@/components/dashboard/ZaehlerHistorie";

interface ZaehlerVerwaltungProps {
  onBack: () => void;
}

const UNIT_TYPES = ['kaltwasser', 'warmwasser', 'strom', 'gas'] as const;
type UnitType = typeof UNIT_TYPES[number];

export const ZaehlerVerwaltung = ({ onBack }: ZaehlerVerwaltungProps) => {
  const queryClient = useQueryClient();
  const [expandedImmobilien, setExpandedImmobilien] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  // Edit-Modus: eine Einheit oder eine Immobilie gleichzeitig
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDraft, setUnitDraft] = useState<Record<string, string>>({});
  const [savingUnit, setSavingUnit] = useState(false);

  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [propertyDraft, setPropertyDraft] = useState<Record<string, string>>({});
  const [savingProperty, setSavingProperty] = useState(false);

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
              .select(`id, einheit_id, status, mietvertrag_mieter!inner(mieter:mieter_id(vorname, nachname))`)
              .in('einheit_id', unitIds)
              .eq('status', 'aktiv');
            contracts = contractData || [];
          }
          const contractMap = new Map(contracts.map(c => [c.einheit_id, c]));
          return {
            ...prop,
            einheiten: units?.map(u => ({ ...u, vertrag: contractMap.get(u.id) })) || [],
          };
        })
      );
      return propsWithUnits;
    },
  });

  const updateUnitMutation = useMutation({
    mutationFn: async ({ einheitId, updates }: { einheitId: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase.from('einheiten').update(updates).eq('id', einheitId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] }),
  });

  const updatePropertyMutation = useMutation({
    mutationFn: async ({ immobilieId, updates }: { immobilieId: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase.from('immobilien').update(updates).eq('id', immobilieId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] }),
  });

  // ── Einheit Edit-Modus ──────────────────────────────────────────────────────

  const startEditUnit = (einheit: any) => {
    // Gleichzeitig nur eine Einheit bearbeiten — anderen abbrechen
    if (editingPropertyId) cancelEditProperty();
    const draft: Record<string, string> = {};
    for (const t of UNIT_TYPES) {
      draft[`${t}_zaehler`] = einheit[`${t}_zaehler`] ?? '';
      draft[`${t}_stand`]   = einheit[`${t}_stand_aktuell`]?.toString() ?? '';
      draft[`${t}_datum`]   = einheit[`${t}_stand_datum`] ?? '';
    }
    setUnitDraft(draft);
    setEditingUnitId(einheit.id);
  };

  const cancelEditUnit = () => {
    setEditingUnitId(null);
    setUnitDraft({});
  };

  const saveUnitDraft = async (einheit: any) => {
    setSavingUnit(true);
    try {
      const updates: Record<string, unknown> = {};
      const today = format(new Date(), 'yyyy-MM-dd');
      const historyInserts: any[] = [];

      for (const t of UNIT_TYPES) {
        const origZaehler = einheit[`${t}_zaehler`] ?? '';
        const origStand   = einheit[`${t}_stand_aktuell`]?.toString() ?? '';
        const origDatum   = einheit[`${t}_stand_datum`] ?? '';
        const newZaehler  = unitDraft[`${t}_zaehler`] ?? '';
        const newStand    = unitDraft[`${t}_stand`] ?? '';
        const newDatum    = unitDraft[`${t}_datum`] || '';

        if (newZaehler !== origZaehler) {
          updates[`${t}_zaehler`] = newZaehler || null;
        }

        if (newStand !== origStand) {
          const standValue = newStand ? parseFloat(newStand) : null;
          const effectiveDatum = newDatum || today;
          // Datum-Guard: aktuellen Stand nur überschreiben wenn neues Datum nicht älter
          const isNewerOrSame = !newDatum || !origDatum || new Date(effectiveDatum) >= new Date(origDatum);
          if (isNewerOrSame) {
            updates[`${t}_stand_aktuell`] = standValue;
            updates[`${t}_stand_datum`]   = effectiveDatum;
          }
          if (standValue !== null) {
            historyInserts.push({
              einheit_id: einheit.id,
              zaehler_typ: t,
              zaehler_nummer: (updates[`${t}_zaehler`] as string ?? newZaehler) || null,
              stand: standValue,
              datum: newDatum || today,
              quelle: 'manuell',
            });
          }
        } else if (newDatum !== origDatum && newDatum) {
          const isNewerOrSame = !origDatum || new Date(newDatum) >= new Date(origDatum);
          if (isNewerOrSame) updates[`${t}_stand_datum`] = newDatum;
        }
      }

      if (Object.keys(updates).length === 0 && historyInserts.length === 0) {
        cancelEditUnit();
        return;
      }

      if (Object.keys(updates).length > 0) {
        await updateUnitMutation.mutateAsync({ einheitId: einheit.id, updates });
      }
      for (const entry of historyInserts) {
        await supabase.from('zaehlerstand_historie').insert(entry);
      }
      if (historyInserts.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
      }

      cancelEditUnit();
      toast.success('Zählerstände gespeichert');
    } catch {
      toast.error('Fehler beim Speichern');
    } finally {
      setSavingUnit(false);
    }
  };

  // ── Hausanschluss Edit-Modus ────────────────────────────────────────────────

  const startEditProperty = (immobilie: any) => {
    if (editingUnitId) cancelEditUnit();
    const draft: Record<string, string> = {};
    for (const t of ['wasser', 'strom', 'gas'] as const) {
      draft[`${t}_zaehler`]   = immobilie[`allgemein_${t}_zaehler`] ?? '';
      draft[`${t}_stand`]     = immobilie[`allgemein_${t}_stand`]?.toString() ?? '';
      draft[`${t}_datum`]     = immobilie[`allgemein_${t}_datum`] ?? '';
      draft[`${t}_2_zaehler`] = immobilie[`allgemein_${t}_zaehler_2`] ?? '';
      draft[`${t}_2_stand`]   = immobilie[`allgemein_${t}_stand_2`]?.toString() ?? '';
      draft[`${t}_2_datum`]   = immobilie[`allgemein_${t}_datum_2`] ?? '';
      draft[`versorger_${t}_name`]  = immobilie[`versorger_${t}_name`] ?? '';
      draft[`versorger_${t}_email`] = immobilie[`versorger_${t}_email`] ?? '';
    }
    setPropertyDraft(draft);
    setEditingPropertyId(immobilie.id);
  };

  const cancelEditProperty = () => {
    setEditingPropertyId(null);
    setPropertyDraft({});
  };

  const savePropertyDraft = async (immobilie: any) => {
    setSavingProperty(true);
    try {
      const updates: Record<string, unknown> = {};
      const today = format(new Date(), 'yyyy-MM-dd');
      const historyInserts: any[] = [];

      for (const t of ['wasser', 'strom', 'gas'] as const) {
        for (const suffix of ['', '_2'] as const) {
          const key = suffix ? `${t}_2` : t;
          const dbBase = `allgemein_${t}`;
          const origZaehler = immobilie[`${dbBase}_zaehler${suffix}`] ?? '';
          const origStand   = immobilie[`${dbBase}_stand${suffix}`]?.toString() ?? '';
          const origDatum   = immobilie[`${dbBase}_datum${suffix}`] ?? '';
          const newZaehler  = propertyDraft[`${key}_zaehler`] ?? '';
          const newStand    = propertyDraft[`${key}_stand`] ?? '';
          const newDatum    = propertyDraft[`${key}_datum`] || '';

          if (newZaehler !== origZaehler) {
            updates[`${dbBase}_zaehler${suffix}`] = newZaehler || null;
          }
          if (newStand !== origStand) {
            const standValue = newStand ? parseFloat(newStand) : null;
            const effectiveDatum = newDatum || today;
            const isNewerOrSame = !newDatum || !origDatum || new Date(effectiveDatum) >= new Date(origDatum);
            if (isNewerOrSame) {
              updates[`${dbBase}_stand${suffix}`] = standValue;
              updates[`${dbBase}_datum${suffix}`] = effectiveDatum;
            }
            if (standValue !== null) {
              historyInserts.push({
                immobilie_id: immobilie.id,
                zaehler_typ: key,
                zaehler_nummer: (updates[`${dbBase}_zaehler${suffix}`] as string ?? newZaehler) || null,
                stand: standValue,
                datum: newDatum || today,
                quelle: 'manuell',
              });
            }
          } else if (newDatum !== origDatum && newDatum) {
            const isNewerOrSame = !origDatum || new Date(newDatum) >= new Date(origDatum);
            if (isNewerOrSame) updates[`${dbBase}_datum${suffix}`] = newDatum;
          }
        }

        // Versorger
        const origName  = immobilie[`versorger_${t}_name`] ?? '';
        const origEmail = immobilie[`versorger_${t}_email`] ?? '';
        if (propertyDraft[`versorger_${t}_name`] !== origName)
          updates[`versorger_${t}_name`] = propertyDraft[`versorger_${t}_name`] || null;
        if (propertyDraft[`versorger_${t}_email`] !== origEmail)
          updates[`versorger_${t}_email`] = propertyDraft[`versorger_${t}_email`] || null;
      }

      if (Object.keys(updates).length === 0 && historyInserts.length === 0) {
        cancelEditProperty();
        return;
      }

      if (Object.keys(updates).length > 0) {
        await updatePropertyMutation.mutateAsync({ immobilieId: immobilie.id, updates });
      }
      for (const entry of historyInserts) {
        await supabase.from('zaehlerstand_historie').insert(entry);
      }
      if (historyInserts.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
      }

      cancelEditProperty();
      toast.success('Hausanschlusszähler gespeichert');
    } catch {
      toast.error('Fehler beim Speichern');
    } finally {
      setSavingProperty(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const toggleUtilityConfig = async (immobilieId: string, field: 'hat_strom' | 'hat_gas' | 'hat_wasser', value: boolean) => {
    try {
      const { error } = await supabase.from('immobilien').update({ [field]: value }).eq('id', immobilieId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['zaehler-verwaltung-immobilien'] });
      toast.success('Versorgungskonfiguration gespeichert');
    } catch {
      toast.error('Fehler beim Speichern');
    }
  };

  const toggleImmobilie = (id: string) => {
    setExpandedImmobilien(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll  = () => { if (immobilien) setExpandedImmobilien(new Set(immobilien.map(i => i.id))); };
  const collapseAll = () => setExpandedImmobilien(new Set());

  const getMeterIcon = (type: string, className = "h-3.5 w-3.5") => {
    switch (type) {
      case 'kaltwasser': return <Droplets className={`${className} text-blue-500`} />;
      case 'warmwasser': return <ThermometerSun className={`${className} text-orange-500`} />;
      case 'strom':      return <Zap className={`${className} text-yellow-600`} />;
      case 'gas':        return <Flame className={`${className} text-red-500`} />;
      default:           return null;
    }
  };

  const getMeterLabel = (type: string) => {
    const labels: Record<string, string> = {
      kaltwasser: 'KW', warmwasser: 'WW', strom: 'Strom', gas: 'Gas', wasser: 'Wasser',
    };
    return labels[type] || type;
  };

  const getPropertyMeterIcon = (type: string, className = "h-3.5 w-3.5") => {
    switch (type) {
      case 'wasser': return <Droplets className={`${className} text-blue-600`} />;
      case 'strom':  return <Zap className={`${className} text-yellow-600`} />;
      case 'gas':    return <Flame className={`${className} text-red-500`} />;
      default:       return null;
    }
  };

  const formatStandDatum = (datum: string | null) =>
    datum ? format(new Date(datum), 'dd.MM.yy', { locale: de }) : '-';

  const getPropertyMeterTypes = (immobilie: any) => {
    const types: Array<'wasser' | 'strom' | 'gas'> = [];
    if (immobilie.hat_wasser !== false) types.push('wasser');
    if (immobilie.hat_strom  !== false) types.push('strom');
    if (immobilie.hat_gas    !== false) types.push('gas');
    return types;
  };

  const getUnitMeterTypes = (immobilie: any) => {
    const types: Array<UnitType> = [];
    if (immobilie.hat_wasser !== false) { types.push('kaltwasser'); types.push('warmwasser'); }
    if (immobilie.hat_strom  !== false) types.push('strom');
    if (immobilie.hat_gas    !== false) types.push('gas');
    return types;
  };

  const hasSecondSet = (immobilie: any) =>
    immobilie.allgemein_strom_zaehler_2 != null || immobilie.allgemein_gas_zaehler_2 != null ||
    immobilie.allgemein_wasser_zaehler_2 != null || immobilie.allgemein_strom_stand_2 ||
    immobilie.allgemein_gas_stand_2 || immobilie.allgemein_wasser_stand_2;

  const matchesSearch = (value: string | null | undefined) => {
    if (!searchTerm || !value) return false;
    return value.toLowerCase().replace(/\s+/g, '').includes(searchTerm.toLowerCase().replace(/\s+/g, ''));
  };

  const filteredImmobilien = immobilien?.filter(i => {
    if (!searchTerm) return true;
    const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '');
    const s = norm(searchTerm);
    const match = (v: string | null | undefined) => !!v && norm(v).includes(s);
    if (match(i.name) || match(i.adresse)) return true;
    if (match(i.allgemein_strom_zaehler) || match(i.allgemein_gas_zaehler) || match(i.allgemein_wasser_zaehler) ||
        match(i.allgemein_strom_zaehler_2) || match(i.allgemein_gas_zaehler_2) || match(i.allgemein_wasser_zaehler_2))
      return true;
    return i.einheiten?.some((e: any) =>
      match(e.kaltwasser_zaehler) || match(e.warmwasser_zaehler) ||
      match(e.strom_zaehler) || match(e.gas_zaehler) || match(String(e.zaehler || ''))
    );
  });

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
              <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0">
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
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Input
              placeholder="Suche nach Objekt, Adresse oder Zähler-Nr..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            <Button variant="outline" size="sm" onClick={expandAll} className="h-8 text-xs whitespace-nowrap">Alle öffnen</Button>
            <Button variant="outline" size="sm" onClick={collapseAll} className="h-8 text-xs whitespace-nowrap">Alle schließen</Button>
          </div>
        </div>

        {/* Properties List */}
        <div className="space-y-3">
          {filteredImmobilien?.map((immobilie) => {
            const propTypes = getPropertyMeterTypes(immobilie);
            const isEditingProp = editingPropertyId === immobilie.id;

            return (
              <div key={immobilie.id} className="glass-card rounded-xl overflow-hidden">
                <Collapsible
                  open={expandedImmobilien.has(immobilie.id)}
                  onOpenChange={() => toggleImmobilie(immobilie.id)}
                >
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors cursor-pointer">
                      <div className="flex items-center gap-2">
                        {expandedImmobilien.has(immobilie.id)
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">{immobilie.name}</span>
                        <span className="text-xs text-muted-foreground hidden sm:inline">· {immobilie.adresse}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {immobilie.einheiten?.length || 0} Einheiten
                      </Badge>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t">
                      {/* ── Hausanschlusszähler ──────────────────────────────── */}
                      <div className="bg-muted/30 p-2 sm:p-3 border-b">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Hausanschlusszähler
                          </span>
                          <div className="flex items-center gap-3">
                            {/* Versorgungsart-Checkboxen */}
                            <div className="flex items-center gap-3 mr-2">
                              {[
                                { field: 'hat_strom' as const, icon: <Zap className="h-3 w-3 text-yellow-600" />, label: 'Strom' },
                                { field: 'hat_gas'   as const, icon: <Flame className="h-3 w-3 text-red-500" />,    label: 'Gas' },
                                { field: 'hat_wasser' as const, icon: <Droplets className="h-3 w-3 text-blue-500" />, label: 'Wasser' },
                              ].map(({ field, icon, label }) => (
                                <label key={field} className="flex items-center gap-1.5 cursor-pointer">
                                  <Checkbox
                                    checked={immobilie[field] !== false}
                                    onCheckedChange={(checked) => toggleUtilityConfig(immobilie.id, field, !!checked)}
                                  />
                                  {icon}
                                  <span className="text-xs">{label}</span>
                                </label>
                              ))}
                            </div>
                            {/* Bearbeiten / Speichern / Abbrechen */}
                            {isEditingProp ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); savePropertyDraft(immobilie); }}
                                  disabled={savingProperty}
                                  className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
                                >
                                  {savingProperty
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <><Save className="h-3 w-3 mr-1" />Speichern</>}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => { e.stopPropagation(); cancelEditProperty(); }}
                                  className="h-6 px-2 text-xs"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => { e.stopPropagation(); startEditProperty(immobilie); }}
                                className="h-6 px-2 text-xs"
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Bearbeiten
                              </Button>
                            )}
                          </div>
                        </div>

                        {propTypes.length > 0 && (
                          <>
                            {/* Versorger */}
                            <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: `repeat(${propTypes.length}, 1fr)` }}>
                              {propTypes.map((type) => (
                                <div key={`versorger-${type}`} className="bg-background rounded p-1.5 sm:p-2">
                                  <div className="flex items-center gap-1 mb-1">
                                    {type === 'strom'  && <Zap      className="h-3 w-3 text-yellow-600" />}
                                    {type === 'gas'    && <Flame    className="h-3 w-3 text-red-500" />}
                                    {type === 'wasser' && <Droplets className="h-3 w-3 text-blue-500" />}
                                    <span className="text-xs font-medium">Versorger {getMeterLabel(type)}</span>
                                  </div>
                                  {isEditingProp ? (
                                    <div className="space-y-0.5">
                                      <Input
                                        placeholder="Versorger-Name"
                                        value={propertyDraft[`versorger_${type}_name`] ?? ''}
                                        onChange={(e) => setPropertyDraft(prev => ({ ...prev, [`versorger_${type}_name`]: e.target.value }))}
                                        className="h-6 text-xs px-1.5"
                                      />
                                      <Input
                                        type="email"
                                        placeholder="E-Mail"
                                        value={propertyDraft[`versorger_${type}_email`] ?? ''}
                                        onChange={(e) => setPropertyDraft(prev => ({ ...prev, [`versorger_${type}_email`]: e.target.value }))}
                                        className="h-6 text-xs px-1.5"
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground space-y-0.5">
                                      <div>{(immobilie as any)[`versorger_${type}_name`] || <span className="italic">kein Name</span>}</div>
                                      <div>{(immobilie as any)[`versorger_${type}_email`] || <span className="italic">keine E-Mail</span>}</div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Zähler (Hauptsatz) */}
                            {[
                              { label: 'Hausanschlusszähler', suffix: '' as const },
                              ...(hasSecondSet(immobilie) ? [{ label: 'Hausanschlusszähler 2', suffix: '_2' as const }] : []),
                            ].map(({ label, suffix }) => (
                              <div key={suffix || 'main'} className={suffix ? 'mt-2' : ''}>
                                {suffix && <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>}
                                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${propTypes.length}, 1fr)` }}>
                                  {propTypes.map((type) => {
                                    const draftKey = suffix ? `${type}_2` : type;
                                    const dbZ = (immobilie as any)[`allgemein_${type}_zaehler${suffix}`] as string | null;
                                    const dbS = (immobilie as any)[`allgemein_${type}_stand${suffix}`]  as number | null;
                                    const dbD = (immobilie as any)[`allgemein_${type}_datum${suffix}`]  as string | null;
                                    return (
                                      <div key={draftKey} className="bg-background rounded p-1.5 sm:p-2">
                                        <div className="flex items-center gap-1 mb-1">
                                          {getPropertyMeterIcon(type, "h-3 w-3")}
                                          <span className="text-xs font-medium">{getMeterLabel(type)}{suffix ? ' (2)' : ''}</span>
                                          {dbD && !isEditingProp && (
                                            <span className="text-[10px] text-muted-foreground ml-auto">{formatStandDatum(dbD)}</span>
                                          )}
                                        </div>
                                        {isEditingProp ? (
                                          <div className="space-y-0.5">
                                            <Input
                                              placeholder="Zähler-Nr."
                                              value={propertyDraft[`${draftKey}_zaehler`] ?? ''}
                                              onChange={(e) => setPropertyDraft(prev => ({ ...prev, [`${draftKey}_zaehler`]: e.target.value }))}
                                              className={`h-6 text-xs px-1.5${matchesSearch(dbZ) ? ' ring-2 ring-red-500' : ''}`}
                                            />
                                            <Input
                                              type="number" step="0.01" placeholder="Stand"
                                              value={propertyDraft[`${draftKey}_stand`] ?? ''}
                                              onChange={(e) => setPropertyDraft(prev => ({ ...prev, [`${draftKey}_stand`]: e.target.value }))}
                                              className="h-6 text-xs px-1.5"
                                            />
                                            <Input
                                              type="date"
                                              value={propertyDraft[`${draftKey}_datum`] ?? ''}
                                              onChange={(e) => setPropertyDraft(prev => ({ ...prev, [`${draftKey}_datum`]: e.target.value }))}
                                              className="h-6 text-xs px-1.5"
                                            />
                                          </div>
                                        ) : (
                                          <div className="text-xs space-y-0.5">
                                            <div className={`font-mono text-muted-foreground text-[10px]${matchesSearch(dbZ) ? ' text-red-600 font-bold' : ''}`}>
                                              {dbZ || <span className="italic">kein Zähler</span>}
                                            </div>
                                            <div className="font-medium">
                                              {dbS != null ? dbS.toLocaleString('de-DE') : <span className="text-muted-foreground">—</span>}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </>
                        )}

                        <div className="mt-2">
                          <ZaehlerHistorie immobilieId={immobilie.id} label="Hausanschluss-Historie" />
                        </div>
                      </div>

                      {/* ── Einheiten-Tabelle ─────────────────────────────────── */}
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
                              const isEditingUnit = editingUnitId === einheit.id;

                              return (
                                <React.Fragment key={einheit.id}>
                                  <TableRow className={`text-xs${isEditingUnit ? ' bg-muted/20' : ''}`}>
                                    <TableCell className="py-1.5 font-medium">
                                      <div>
                                        <span>{einheit.zaehler}</span>
                                        {einheit.etage && <span className="text-muted-foreground ml-1">({einheit.etage})</span>}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-1.5 text-muted-foreground hidden sm:table-cell truncate max-w-[120px]">
                                      {tenantName}
                                    </TableCell>

                                    {getUnitMeterTypes(immobilie).map((type) => {
                                      const currentZaehler = einheit[`${type}_zaehler`] as string | null;
                                      const currentStand   = einheit[`${type}_stand_aktuell`] as number | null;
                                      const standDatum     = einheit[`${type}_stand_datum`] as string | null;

                                      return (
                                        <TableCell key={type} className="py-1.5">
                                          {isEditingUnit ? (
                                            <div className="flex flex-col gap-0.5">
                                              <Input
                                                placeholder="Nr."
                                                value={unitDraft[`${type}_zaehler`] ?? ''}
                                                onChange={(e) => setUnitDraft(prev => ({ ...prev, [`${type}_zaehler`]: e.target.value }))}
                                                className={`h-6 text-xs px-1.5${matchesSearch(currentZaehler) ? ' ring-2 ring-red-500' : ''}`}
                                              />
                                              <Input
                                                type="number" step="0.01" placeholder="Stand"
                                                value={unitDraft[`${type}_stand`] ?? ''}
                                                onChange={(e) => setUnitDraft(prev => ({ ...prev, [`${type}_stand`]: e.target.value }))}
                                                className="h-6 text-xs px-1.5"
                                              />
                                              <Input
                                                type="date"
                                                value={unitDraft[`${type}_datum`] ?? ''}
                                                onChange={(e) => setUnitDraft(prev => ({ ...prev, [`${type}_datum`]: e.target.value }))}
                                                className="h-6 text-xs px-1.5"
                                              />
                                            </div>
                                          ) : (
                                            <div className="text-xs leading-tight">
                                              <div className={`text-[10px] font-mono text-muted-foreground${matchesSearch(currentZaehler) ? ' text-red-600 font-bold' : ''}`}>
                                                {currentZaehler || <span className="italic">—</span>}
                                              </div>
                                              <div className="font-medium tabular-nums">
                                                {currentStand != null ? currentStand.toLocaleString('de-DE') : <span className="text-muted-foreground">—</span>}
                                              </div>
                                              {standDatum && (
                                                <div className="text-[10px] text-muted-foreground">{formatStandDatum(standDatum)}</div>
                                              )}
                                            </div>
                                          )}
                                        </TableCell>
                                      );
                                    })}

                                    <TableCell className="py-1.5">
                                      {isEditingUnit ? (
                                        <div className="flex flex-col gap-1">
                                          <Button
                                            size="sm"
                                            onClick={() => saveUnitDraft(einheit)}
                                            disabled={savingUnit}
                                            className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
                                          >
                                            {savingUnit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={cancelEditUnit}
                                            className="h-6 w-6 p-0"
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => startEditUnit(einheit)}
                                          className="h-6 w-6 p-0 opacity-40 hover:opacity-100"
                                          title="Zählerstände bearbeiten"
                                        >
                                          <Pencil className="h-3 w-3" />
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
                        <p className="text-muted-foreground text-center py-4 text-sm">Keine Einheiten vorhanden</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>

        {filteredImmobilien?.length === 0 && (
          <div className="text-center py-12">
            <div className="glass-card p-8 max-w-sm mx-auto rounded-2xl">
              <Gauge className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                {searchTerm ? 'Keine Treffer' : 'Keine Immobilien'}
              </h3>
              <p className="text-gray-500 text-sm">
                {searchTerm ? 'Versuchen Sie einen anderen Suchbegriff.' : 'Es sind noch keine Immobilien verfügbar.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
