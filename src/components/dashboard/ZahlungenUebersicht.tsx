import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Euro, Calendar, Building2, Home, User, Check, Edit2, X, CalendarIcon, Search, ChevronDown, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { AssignPaymentDialog } from "@/components/controlboard/AssignPaymentDialog";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PaymentKategorieEditor } from "@/components/controlboard/PaymentKategorieEditor";

interface ZahlungenUebersichtProps {
  onBack?: () => void;
}

interface ZahlungWithDetails {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  zugeordneter_monat: string | null;
  kategorie: string | null;
  mietvertrag_id: string | null;
  immobilie_id: string | null;
  immobilie_name: string | null;
  immobilie_adresse: string | null;
  einheit_id: string | null;
  einheit_typ: string | null;
  mieter_name: string | null;
}

export const ZahlungenUebersicht = ({ onBack }: ZahlungenUebersichtProps = {}) => {
  const [selectedZahlungId, setSelectedZahlungId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'datum-desc' | 'datum-asc' | 'betrag-desc' | 'betrag-asc' | 'status' | 'kategorie'>('datum-desc');
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null);
  const [showOnlyZugeordnet, setShowOnlyZugeordnet] = useState(false);
  const [showOnlyNichtZugeordnet, setShowOnlyNichtZugeordnet] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const queryClient = useQueryClient();
  const { data: zahlungen, isLoading } = useQuery({
    queryKey: ['zahlungen-overview'],
    queryFn: async () => {
      // Fetch all payments in one query
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('zahlungen')
        .select('*')
        .order('buchungsdatum', { ascending: false });

      if (paymentsError) throw paymentsError;
      if (!paymentsData?.length) return [];

      // Collect unique IDs for bulk fetching
      const mietvertragIds = [...new Set(paymentsData.filter(z => z.mietvertrag_id).map(z => z.mietvertrag_id!))];
      const immobilieIds = [...new Set(paymentsData.filter(z => z.immobilie_id && !z.mietvertrag_id).map(z => z.immobilie_id!))];

      // Bulk fetch contracts with nested joins
      const contractMap = new Map<string, { einheit_id: string | null; einheit_typ: string | null; immobilie_name: string | null; immobilie_adresse: string | null }>();
      if (mietvertragIds.length > 0) {
        const { data: contracts } = await supabase
          .from('mietvertrag')
          .select('id, einheit_id, einheiten:einheit_id (id, einheitentyp, immobilie_id, immobilien:immobilie_id (name, adresse))')
          .in('id', mietvertragIds);
        
        (contracts || []).forEach((c: any) => {
          const einheit = c.einheiten;
          const immo = einheit?.immobilien;
          contractMap.set(c.id, {
            einheit_id: einheit?.id || null,
            einheit_typ: einheit?.einheitentyp || null,
            immobilie_name: immo?.name || null,
            immobilie_adresse: immo?.adresse || null,
          });
        });
      }

      // Bulk fetch tenant names
      const mieterMap = new Map<string, string>();
      if (mietvertragIds.length > 0) {
        const { data: mieterLinks } = await supabase
          .from('mietvertrag_mieter')
          .select('mietvertrag_id, mieter:mieter_id (vorname, nachname)')
          .in('mietvertrag_id', mietvertragIds);

        const seen = new Set<string>();
        (mieterLinks || []).forEach((link: any) => {
          if (!seen.has(link.mietvertrag_id) && link.mieter) {
            seen.add(link.mietvertrag_id);
            mieterMap.set(link.mietvertrag_id, `${link.mieter.vorname} ${link.mieter.nachname}`);
          }
        });
      }

      // Bulk fetch properties for payments without contract
      const propertyMap = new Map<string, { name: string; adresse: string }>();
      if (immobilieIds.length > 0) {
        const { data: properties } = await supabase
          .from('immobilien')
          .select('id, name, adresse')
          .in('id', immobilieIds);

        (properties || []).forEach((p: any) => {
          propertyMap.set(p.id, { name: p.name, adresse: p.adresse });
        });
      }

      // Map everything in memory
      return paymentsData.map((zahlung: any): ZahlungWithDetails => {
        const contract = zahlung.mietvertrag_id ? contractMap.get(zahlung.mietvertrag_id) : null;
        const directProperty = zahlung.immobilie_id && !zahlung.mietvertrag_id ? propertyMap.get(zahlung.immobilie_id) : null;

        return {
          id: zahlung.id,
          betrag: zahlung.betrag,
          buchungsdatum: zahlung.buchungsdatum,
          verwendungszweck: zahlung.verwendungszweck,
          empfaengername: zahlung.empfaengername,
          iban: zahlung.iban,
          zugeordneter_monat: zahlung.zugeordneter_monat,
          kategorie: zahlung.kategorie,
          mietvertrag_id: zahlung.mietvertrag_id,
          immobilie_id: zahlung.immobilie_id,
          immobilie_name: contract?.immobilie_name || directProperty?.name || null,
          immobilie_adresse: contract?.immobilie_adresse || directProperty?.adresse || null,
          einheit_id: contract?.einheit_id || null,
          einheit_typ: contract?.einheit_typ || null,
          mieter_name: zahlung.mietvertrag_id ? mieterMap.get(zahlung.mietvertrag_id) || null : null,
        };
      });
    },
  });


  const formatBetrag = (betrag: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(betrag);
  };

  const formatDatum = (datum: string) => {
    return new Date(datum).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getEinheitNr = (einheitId: string | null) => {
    if (!einheitId) return 'N/A';
    return einheitId.slice(-2);
  };

  // Get unique categories
  const uniqueKategorien = zahlungen 
    ? Array.from(new Set(zahlungen.map(z => z.kategorie || 'Keine Kategorie')))
        .sort()
    : [];

  // Calculate date range duration
  const getDateRangeDuration = () => {
    if (!dateRange.from || !dateRange.to) return null;
    const diffTime = Math.abs(dateRange.to.getTime() - dateRange.from.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
    return diffDays;
  };

  // Filter payments by date range, category, assignment status, and search term
  const filteredZahlungen = zahlungen ? zahlungen.filter((zahlung) => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase().trim();
      
      // Text-based fields
      const textMatch = (
        zahlung.verwendungszweck?.toLowerCase().includes(search) ||
        zahlung.empfaengername?.toLowerCase().includes(search) ||
        zahlung.iban?.toLowerCase().includes(search) ||
        zahlung.mieter_name?.toLowerCase().includes(search) ||
        zahlung.immobilie_name?.toLowerCase().includes(search) ||
        zahlung.immobilie_adresse?.toLowerCase().includes(search) ||
        zahlung.kategorie?.toLowerCase().includes(search) ||
        zahlung.zugeordneter_monat?.toLowerCase().includes(search)
      );
      
      // Amount search (both as string and formatted)
      const betragString = zahlung.betrag?.toString();
      const betragMatch = betragString?.includes(search) || 
                         Math.abs(zahlung.betrag || 0).toFixed(2).includes(search);
      
      // Date search (formatted dd.MM.yyyy)
      const dateString = formatDatum(zahlung.buchungsdatum);
      const dateMatch = dateString.includes(search);
      
      if (!textMatch && !betragMatch && !dateMatch) return false;
    }
    
    // Category filter
    if (selectedKategorie) {
      const zahlungKategorie = zahlung.kategorie || 'Keine Kategorie';
      if (zahlungKategorie !== selectedKategorie) return false;
    }

    // Assignment status filter
    if (showOnlyZugeordnet && !zahlung.mietvertrag_id && !zahlung.immobilie_id) return false;
    if (showOnlyNichtZugeordnet && (zahlung.mietvertrag_id || zahlung.immobilie_id)) return false;

    // Date filter
    if (!dateRange.from && !dateRange.to) return true;
    
    const zahlungDate = new Date(zahlung.buchungsdatum);
    zahlungDate.setHours(0, 0, 0, 0);
    
    if (dateRange.from && dateRange.to) {
      const from = new Date(dateRange.from);
      from.setHours(0, 0, 0, 0);
      const to = new Date(dateRange.to);
      to.setHours(23, 59, 59, 999);
      return zahlungDate >= from && zahlungDate <= to;
    }
    
    if (dateRange.from) {
      const from = new Date(dateRange.from);
      from.setHours(0, 0, 0, 0);
      return zahlungDate >= from;
    }
    
    if (dateRange.to) {
      const to = new Date(dateRange.to);
      to.setHours(23, 59, 59, 999);
      return zahlungDate <= to;
    }
    
    return true;
  }) : [];

  // Sort payments
  const sortedZahlungen = filteredZahlungen ? [...filteredZahlungen].sort((a, b) => {
    switch (sortBy) {
      case 'datum-desc':
        return new Date(b.buchungsdatum).getTime() - new Date(a.buchungsdatum).getTime();
      case 'datum-asc':
        return new Date(a.buchungsdatum).getTime() - new Date(b.buchungsdatum).getTime();
      case 'betrag-desc':
        return b.betrag - a.betrag;
      case 'betrag-asc':
        return a.betrag - b.betrag;
      case 'status':
        const aAssigned = a.mietvertrag_id || a.immobilie_id ? 1 : 0;
        const bAssigned = b.mietvertrag_id || b.immobilie_id ? 1 : 0;
        return bAssigned - aAssigned;
      case 'kategorie':
        const katA = a.kategorie || 'Keine Kategorie';
        const katB = b.kategorie || 'Keine Kategorie';
        return katA.localeCompare(katB);
      default:
        return 0;
    }
  }) : [];

  // Group payments by year and month
  const paymentsByYearMonth = useMemo(() => {
    const yearGroups: { [year: string]: { months: { monthKey: string; label: string; payments: ZahlungWithDetails[]; total: number }[] } } = {};
    
    sortedZahlungen.forEach((zahlung) => {
      const date = new Date(zahlung.buchungsdatum);
      const year = format(date, 'yyyy');
      const monthKey = format(date, 'yyyy-MM');
      const monthLabel = format(date, 'MMMM', { locale: de });
      
      if (!yearGroups[year]) {
        yearGroups[year] = { months: [] };
      }
      
      let monthGroup = yearGroups[year].months.find(m => m.monthKey === monthKey);
      if (!monthGroup) {
        monthGroup = { monthKey, label: monthLabel, payments: [], total: 0 };
        yearGroups[year].months.push(monthGroup);
      }
      monthGroup.payments.push(zahlung);
      monthGroup.total += zahlung.betrag;
    });
    
    // Sort years and months
    const sortedYears = Object.keys(yearGroups).sort((a, b) => 
      sortBy === 'datum-asc' ? a.localeCompare(b) : b.localeCompare(a)
    );
    
    return sortedYears.map(year => {
      const months = yearGroups[year].months.sort((a, b) => 
        sortBy === 'datum-asc' ? a.monthKey.localeCompare(b.monthKey) : b.monthKey.localeCompare(a.monthKey)
      );
      return {
        year,
        months,
        total: months.reduce((sum, m) => sum + m.total, 0),
        count: months.reduce((sum, m) => sum + m.payments.length, 0)
      };
    });
  }, [sortedZahlungen, sortBy]);

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

  // Initialize all months as collapsed on first render
  useMemo(() => {
    if (paymentsByYearMonth.length > 0 && collapsedMonths.size === 0) {
      const allMonthKeys = paymentsByYearMonth.flatMap(y => y.months.map(m => m.monthKey));
      setCollapsedMonths(new Set(allMonthKeys));
    }
  }, [paymentsByYearMonth.length]);

  const selectedZahlung = sortedZahlungen?.find(z => z.id === selectedZahlungId);

  const handleAssignClick = () => {
    setAssignDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          {onBack && (
            <Button
              onClick={onBack}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Zurück
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Zahlungsübersicht</h1>
            <p className="text-gray-600 mt-1">
              Verwalten Sie Zahlungen und deren Zuordnung zu Mietverträgen
            </p>
          </div>
        </div>

        {/* Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Zahlungsliste */}
          <Card className="flex flex-col h-[calc(100vh-200px)]">
            <CardHeader className={cn("pb-3 shrink-0", !filtersExpanded && "pb-2")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 w-full">
                      <Euro className="h-5 w-5 text-green-600" />
                      Zahlungen
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto shrink-0 h-7 gap-1.5 text-xs"
                        onClick={() => setFiltersExpanded(v => !v)}
                      >
                        {filtersExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        {filtersExpanded ? "Filter ausblenden" : "Filter einblenden"}
                      </Button>
                    </CardTitle>
                    <p className="text-sm text-gray-600">
                      {sortedZahlungen?.length || 0} von {zahlungen?.length || 0} Zahlung{(zahlungen?.length || 0) !== 1 ? 'en' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-48">
                      <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white z-50">
                          <SelectItem value="datum-desc">Datum (neueste)</SelectItem>
                          <SelectItem value="datum-asc">Datum (älteste)</SelectItem>
                          <SelectItem value="betrag-desc">Betrag (höchste)</SelectItem>
                          <SelectItem value="betrag-asc">Betrag (niedrigste)</SelectItem>
                          <SelectItem value="status">Zuordnung</SelectItem>
                          <SelectItem value="kategorie">Kategorie</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 shrink-0"
                      onClick={() => setFiltersExpanded(!filtersExpanded)}
                    >
                      {filtersExpanded ? (
                        <>
                          <Minimize2 className="h-3.5 w-3.5" />
                          <span className="text-xs">Ausblenden</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="h-3.5 w-3.5" />
                          <span className="text-xs">Filter</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Search - always visible */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Suchen nach Mieter, Verwendungszweck, IBAN, Betrag, Datum..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-full bg-white"
                  />
                </div>

                {filtersExpanded && (
                  <div className="space-y-3">
                    {/* Category Filter */}
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Kategorie:</label>
                      <Select 
                        value={selectedKategorie || 'alle'} 
                        onValueChange={(value) => setSelectedKategorie(value === 'alle' ? null : value)}
                      >
                        <SelectTrigger className="bg-white w-48">
                          <SelectValue placeholder="Alle Kategorien" />
                        </SelectTrigger>
                        <SelectContent className="bg-white z-50">
                          <SelectItem value="alle">Alle Kategorien</SelectItem>
                          {uniqueKategorien.map((kategorie) => (
                            <SelectItem key={kategorie} value={kategorie}>
                              {kategorie}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedKategorie && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedKategorie(null)}
                          className="h-8 px-2"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Assignment Status Filter */}
                    <div className="flex items-center gap-4">
                      <label className="text-sm font-medium text-gray-700">Zuordnung:</label>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id="zugeordnet"
                            checked={showOnlyZugeordnet}
                            onCheckedChange={(checked) => {
                              setShowOnlyZugeordnet(!!checked);
                              if (checked) setShowOnlyNichtZugeordnet(false);
                            }}
                          />
                          <label htmlFor="zugeordnet" className="text-sm text-gray-700 cursor-pointer">
                            Nur zugeordnete
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id="nicht-zugeordnet"
                            checked={showOnlyNichtZugeordnet}
                            onCheckedChange={(checked) => {
                              setShowOnlyNichtZugeordnet(!!checked);
                              if (checked) setShowOnlyZugeordnet(false);
                            }}
                          />
                          <label htmlFor="nicht-zugeordnet" className="text-sm text-gray-700 cursor-pointer">
                            Nur nicht zugeordnete
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Date Range Filter */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !dateRange.from && !dateRange.to && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange.from && dateRange.to ? (
                            <span>
                              {format(dateRange.from, "dd.MM.yyyy", { locale: de })} – {format(dateRange.to, "dd.MM.yyyy", { locale: de })}
                            </span>
                          ) : dateRange.from ? (
                            <span>{format(dateRange.from, "dd.MM.yyyy", { locale: de })} – Enddatum wählen</span>
                          ) : (
                            <span>Zeitraum auswählen</span>
                          )}
                          {(dateRange.from || dateRange.to) && (
                            <X 
                              className="ml-auto h-4 w-4 hover:bg-gray-200 rounded" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setDateRange({ from: undefined, to: undefined });
                              }}
                            />
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 bg-white" align="start">
                        <CalendarComponent
                          mode="range"
                          selected={{ from: dateRange.from, to: dateRange.to }}
                          onSelect={(range: any) => {
                            if (range) {
                              setDateRange({ from: range.from, to: range.to });
                            } else {
                              setDateRange({ from: undefined, to: undefined });
                            }
                          }}
                          numberOfMonths={2}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    
                    {dateRange.from && dateRange.to && (
                      <div className="text-sm text-gray-600 px-2">
                        <span className="font-medium">Zeitraum:</span> {getDateRangeDuration()} Tag{getDateRangeDuration() !== 1 ? 'e' : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden">
              {isLoading ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Lade Zahlungen...</p>
                </div>
              ) : paymentsByYearMonth && paymentsByYearMonth.length > 0 ? (
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-4">
                    {paymentsByYearMonth.map((yearGroup) => (
                      <div key={yearGroup.year} className="space-y-2">
                        {/* Year Header */}
                        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-5 w-5 text-primary" />
                              <span className="font-bold text-lg">{yearGroup.year}</span>
                              <Badge variant="outline" className="text-xs">
                                {yearGroup.count} Zahlungen
                              </Badge>
                            </div>
                            <span className={cn(
                              "text-base font-bold",
                              yearGroup.total < 0 ? "text-destructive" : "text-green-600"
                            )}>
                              {formatBetrag(yearGroup.total)}
                            </span>
                          </div>
                        </div>
                        
                        {/* Months in this year */}
                        <div className="space-y-2 pl-2">
                          {yearGroup.months.map((monthGroup) => {
                            const isCollapsed = collapsedMonths.has(monthGroup.monthKey);
                            return (
                              <Collapsible 
                                key={monthGroup.monthKey} 
                                open={!isCollapsed}
                                onOpenChange={() => toggleMonth(monthGroup.monthKey)}
                              >
                                <CollapsibleTrigger className="w-full">
                                  <div className="flex items-center justify-between bg-muted/60 hover:bg-muted rounded-lg px-3 py-2 cursor-pointer transition-colors">
                                    <div className="flex items-center gap-2">
                                      {isCollapsed ? (
                                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                      )}
                                      <span className="font-semibold text-sm capitalize">{monthGroup.label}</span>
                                      <Badge variant="secondary" className="text-xs">
                                        {monthGroup.payments.length}
                                      </Badge>
                                    </div>
                                    <span className={cn(
                                      "text-sm font-bold",
                                      monthGroup.total < 0 ? "text-destructive" : "text-green-600"
                                    )}>
                                      {formatBetrag(monthGroup.total)}
                                    </span>
                                  </div>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="space-y-2 pt-2 pl-4">
                                    {monthGroup.payments.map((zahlung) => (
                                      <Card
                                        key={zahlung.id}
                                        className={cn(
                                          "cursor-pointer transition-all hover:shadow-md",
                                          selectedZahlungId === zahlung.id
                                            ? 'ring-2 ring-primary bg-primary/5'
                                            : 'hover:bg-muted/50'
                                        )}
                                        onClick={() => setSelectedZahlungId(zahlung.id)}
                                      >
                                        <CardContent className="p-4">
                                          <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1">
                                              <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-medium text-muted-foreground">
                                                  {formatDatum(zahlung.buchungsdatum)}
                                                </span>
                                                {zahlung.zugeordneter_monat && (
                                                  <Badge variant="outline" className="text-xs">
                                                    {zahlung.zugeordneter_monat}
                                                  </Badge>
                                                )}
                                              </div>
                                              <p className={cn(
                                                "text-lg font-bold",
                                                zahlung.betrag < 0 ? 'text-destructive' : 'text-green-600'
                                              )}>
                                                {formatBetrag(zahlung.betrag)}
                                              </p>
                                            </div>
                                            <div>
                                              {zahlung.mietvertrag_id || zahlung.immobilie_id ? (
                                                <Badge className="bg-green-600">Zugeordnet</Badge>
                                              ) : (
                                                <Badge variant="outline" className="text-orange-600 border-orange-600">
                                                  Nicht zugeordnet
                                                </Badge>
                                              )}
                                            </div>
                                          </div>
                                          
                                          {zahlung.verwendungszweck && (
                                            <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                                              {zahlung.verwendungszweck}
                                            </p>
                                          )}
                                          
                                          {zahlung.empfaengername && (
                                            <p className="text-xs text-muted-foreground">
                                              {zahlung.betrag < 0 ? 'An: ' : 'Von: '}{zahlung.empfaengername}
                                            </p>
                                          )}
                                          
                                          {zahlung.kategorie && (
                                            <Badge variant="secondary" className="mt-2 text-xs">
                                              {zahlung.kategorie}
                                            </Badge>
                                          )}
                                        </CardContent>
                                      </Card>
                                    ))}
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center py-12">
                  <Euro className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">Keine Zahlungen gefunden</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: Details und Zuordnung */}
          <Card className="flex flex-col h-[calc(100vh-200px)]">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                Zuordnung & Details
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {selectedZahlung ? (
                <ScrollArea className="h-full">
                  <div className="space-y-6">
                    {/* Zahlungsdetails */}
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-3">Zahlungsdetails</h3>
                      <div className="space-y-3 bg-gray-50 rounded-lg p-4">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Datum:</span>
                          <span className="text-sm font-medium">
                            {formatDatum(selectedZahlung.buchungsdatum)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Betrag:</span>
                          <span className="text-sm font-bold text-green-600">
                            {formatBetrag(selectedZahlung.betrag)}
                          </span>
                        </div>
                        {selectedZahlung.zugeordneter_monat && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Monat:</span>
                            <span className="text-sm font-medium">
                              {selectedZahlung.zugeordneter_monat}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Kategorie:</span>
                          <PaymentKategorieEditor
                            key={selectedZahlung.id}
                            paymentId={selectedZahlung.id}
                            currentKategorie={selectedZahlung.kategorie}
                            currentImmobilieId={selectedZahlung.immobilie_id}
                            compact
                            onUpdate={() => {
                              queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
                            }}
                          />
                        </div>
                        {selectedZahlung.empfaengername && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Empfänger:</span>
                            <span className="text-sm font-medium">
                              {selectedZahlung.empfaengername}
                            </span>
                          </div>
                        )}
                        {selectedZahlung.verwendungszweck && (
                          <div>
                            <span className="text-sm text-gray-600 block mb-1">Verwendungszweck:</span>
                            <p className="text-sm font-medium bg-white p-2 rounded border">
                              {selectedZahlung.verwendungszweck}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Aktuelle Zuordnung */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-900">Zuordnung</h3>
                        <Button
                          onClick={handleAssignClick}
                          size="sm"
                          variant="outline"
                          className="gap-2"
                        >
                          <Edit2 className="h-4 w-4" />
                          {selectedZahlung.mietvertrag_id || selectedZahlung.immobilie_id 
                            ? 'Ändern' 
                            : selectedZahlung.kategorie === 'Nebenkosten' 
                              ? 'Immobilie zuordnen' 
                              : 'Zuordnen'}
                        </Button>
                      </div>

                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        {selectedZahlung.mietvertrag_id ? (
                          <div className="space-y-3">
                            <div className="mb-2">
                              <Badge variant="secondary" className="text-xs">Mietvertrag</Badge>
                            </div>
                            <div className="flex items-start gap-3">
                              <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-semibold text-gray-900">
                                  {selectedZahlung.immobilie_name}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {selectedZahlung.immobilie_adresse}
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <Home className="h-5 w-5 text-blue-600" />
                              <div>
                                <p className="font-medium text-gray-900">
                                  {selectedZahlung.einheit_typ} - {getEinheitNr(selectedZahlung.einheit_id)}
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <User className="h-5 w-5 text-blue-600" />
                              <div>
                                <p className="font-medium text-gray-900">
                                  {selectedZahlung.mieter_name}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : selectedZahlung.immobilie_id ? (
                          <div className="space-y-3">
                            <div className="mb-2">
                              <Badge variant="secondary" className="text-xs">Immobilie</Badge>
                            </div>
                            <div className="flex items-start gap-3">
                              <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-semibold text-gray-900">
                                  {selectedZahlung.immobilie_name}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {selectedZahlung.immobilie_adresse}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4">
                            <Home className="h-12 w-12 text-orange-300 mx-auto mb-2" />
                            <p className="text-orange-700 font-medium mb-1">
                              Nicht zugeordnet
                            </p>
                            <p className="text-sm text-orange-600">
                              Diese Zahlung ist weder einem Mietvertrag noch einer Immobilie zugeordnet
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center py-12">
                  <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium mb-1">
                    Keine Zahlung ausgewählt
                  </p>
                  <p className="text-sm text-gray-500">
                    Wählen Sie eine Zahlung aus der Liste aus
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Assign Payment Dialog */}
      <AssignPaymentDialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) {
            // Refresh data after closing
            queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
          }
        }}
        payment={selectedZahlung ? {
          id: selectedZahlung.id,
          betrag: selectedZahlung.betrag,
          buchungsdatum: selectedZahlung.buchungsdatum,
          empfaengername: selectedZahlung.empfaengername || undefined,
          iban: selectedZahlung.iban || undefined,
          verwendungszweck: selectedZahlung.verwendungszweck || undefined,
          kategorie: selectedZahlung.kategorie || undefined,
        } : null}
      />
    </div>
  );
};
