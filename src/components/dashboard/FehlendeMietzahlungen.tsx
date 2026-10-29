
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Euro, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Filter, Search, X } from "lucide-react";
import { useRueckstaende } from "@/hooks/useRueckstaende";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FehlendeMietzahlungenStatusGroup } from "./FehlendeMietzahlungenStatusGroup";
import { KennzahlInfo } from "./KennzahlInfo";

interface FehlendeMietzahlungenProps {
  onMietvertragClick?: (mietvertragId: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type SortOption = 'object' | 'amount' | 'mahnstufe' | 'tenant';
type SortDirection = 'asc' | 'desc';
type AmountFilter = 'all' | 'debt' | 'credit';
type MinAmountFilter = 'all' | 'over100';
type StatusFilter = 'all' | 'aktiv' | 'gekuendigt' | 'beendet';

export const FehlendeMietzahlungen = ({ onMietvertragClick, open, defaultOpen, onOpenChange }: FehlendeMietzahlungenProps) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;
  const [sortBy, setSortBy] = useState<SortOption>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [amountFilter, setAmountFilter] = useState<AmountFilter>('all');
  const [minAmountFilter, setMinAmountFilter] = useState<MinAmountFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState("");
  const { data, isLoading, error } = useRueckstaende();
  const fehlendeMietzahlungen = data?.eintraege;
  const bkaHinweise = data?.bkaOhneForderung ?? [];

  const { rueckstaende, guthaben, sortedFehlendeMietzahlungen, statusCounts } = useMemo(() => {
    if (!fehlendeMietzahlungen) return { rueckstaende: { aktiv: [], gekuendigt: [], beendet: [] }, guthaben: { aktiv: [], gekuendigt: [], beendet: [] }, sortedFehlendeMietzahlungen: [], statusCounts: { aktiv: 0, gekuendigt: 0, beendet: 0 } };
    
    // 1. Filter out zero amounts and very small amounts (< 0.01 EUR) first
    let filtered = fehlendeMietzahlungen.filter(item => Math.abs(item.fehlend_betrag) >= 0.01);

    // 1b. Apply search filter
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(item => 
        item.immobilie_name.toLowerCase().includes(search) ||
        item.immobilie_adresse.toLowerCase().includes(search) ||
        item.mieter_name.toLowerCase().includes(search) ||
        item.einheit_etage.toLowerCase().includes(search) ||
        item.einheit_typ.toLowerCase().includes(search) ||
        (item.einheit_nummer && item.einheit_nummer.includes(search))
      );
    }
    
    // Count status before other filters
    const statusCounts = {
      aktiv: filtered.filter(item => item.mietvertrag_status === 'Aktiv').length,
      gekuendigt: filtered.filter(item => item.mietvertrag_status === 'Gekündigt').length,
      beendet: filtered.filter(item => item.mietvertrag_status === 'Beendet').length
    };
    
    // 2. Apply status filter
    if (statusFilter !== 'all') {
      const statusMap: Record<StatusFilter, string> = {
        all: '',
        aktiv: 'Aktiv',
        gekuendigt: 'Gekündigt',
        beendet: 'Beendet'
      };
      filtered = filtered.filter(item => item.mietvertrag_status === statusMap[statusFilter]);
    }
    
    // 3. Apply amount type filter (debt/credit)
    if (amountFilter === 'debt') {
      filtered = filtered.filter(item => !item.ist_guthaben);
    } else if (amountFilter === 'credit') {
      filtered = filtered.filter(item => item.ist_guthaben);
    }
    
    // 4. Apply minimum amount filter (>100€)
    if (minAmountFilter === 'over100') {
      filtered = filtered.filter(item => item.fehlend_betrag > 100);
    }
    
    // 5. Sort the filtered results
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'object':
          comparison = a.immobilie_name.localeCompare(b.immobilie_name, undefined, {
            numeric: true,
            sensitivity: 'base'
          });
          break;
        case 'amount':
          comparison = a.fehlend_betrag - b.fehlend_betrag;
          break;
        case 'mahnstufe':
          comparison = (a.mahnstufe || 0) - (b.mahnstufe || 0);
          break;
        case 'tenant':
          comparison = a.mieter_name.localeCompare(b.mieter_name);
          break;
        default:
          return 0;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    // 6. Split into Rückstände and Guthaben, grouped by status
    const rueckstaendeList = sorted.filter(item => !item.ist_guthaben);
    const guthabenList = sorted.filter(item => item.ist_guthaben);
    
    const groupByStatus = (list: typeof sorted) => ({
      aktiv: list.filter(item => item.mietvertrag_status === 'Aktiv'),
      gekuendigt: list.filter(item => item.mietvertrag_status === 'Gekündigt'),
      beendet: list.filter(item => item.mietvertrag_status === 'Beendet')
    });
    
    return {
      rueckstaende: groupByStatus(rueckstaendeList),
      guthaben: groupByStatus(guthabenList),
      sortedFehlendeMietzahlungen: sorted,
      statusCounts
    };
  }, [fehlendeMietzahlungen, sortBy, sortDirection, amountFilter, minAmountFilter, statusFilter, searchTerm]);

  const allRueckstaende = [...rueckstaende.aktiv, ...rueckstaende.gekuendigt, ...rueckstaende.beendet];
  const allGuthaben = [...guthaben.aktiv, ...guthaben.gekuendigt, ...guthaben.beendet];

  // Beendete Verträge NICHT in Gesamtsummen einrechnen
  const activeRueckstaende = [...rueckstaende.aktiv, ...rueckstaende.gekuendigt];
  const activeGuthaben = [...guthaben.aktiv, ...guthaben.gekuendigt];

  const gesamtRueckstandBetrag = activeRueckstaende.reduce((sum, item) => sum + item.fehlend_betrag, 0);
  const gesamtGuthabenBetrag = activeGuthaben.reduce((sum, item) => sum + item.fehlend_betrag, 0);

  // Der Kopf zeigt den Bestand, nicht die Auswahl: Bis zum 28.10.2026 standen dort die Summen nach
  // Suche und Filter, auch eingeklappt — mit Filter „Guthaben“ verschwand die Rückstandssumme ganz.
  const nichtBeendet = (fehlendeMietzahlungen ?? []).filter(item => item.mietvertrag_status !== 'Beendet');
  const kopfRueckstand = nichtBeendet.filter(item => !item.ist_guthaben).reduce((sum, item) => sum + item.fehlend_betrag, 0);
  const kopfGuthaben = nichtBeendet.filter(item => item.ist_guthaben).reduce((sum, item) => sum + item.fehlend_betrag, 0);

  const formatBetrag = (betrag: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(betrag);
  };

  const handleMietvertragClick = (mietvertragId: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    onMietvertragClick?.(mietvertragId);
  };

  const handleSort = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSortBy);
      setSortDirection(newSortBy === 'amount' || newSortBy === 'mahnstufe' ? 'desc' : 'asc');
    }
  };

  const getSortIcon = (option: SortOption) => {
    if (sortBy !== option) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {/* Zeile unter „Handlungsbedarf“ auf der Startseite (27.10.2026): Haarlinie statt Karte */}
      <div id="rueckstaende-section" className="group/zeile relative border-b border-border">
        {/* Kopf: Titel und Pfeil klappen auf; die Summen tragen eigene Info-Knöpfe (29.10.2026).
            Bis dahin lag die ganze Zeile in einem Knopf, ein Info-Knopf darin wäre Knopf in Knopf. */}
        <div className="flex items-center justify-between gap-4 py-5 sm:py-6">
          <div className="flex min-w-0 items-center gap-1.5">
            <CollapsibleTrigger className="flex min-w-0 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:gap-4">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center bg-brand-soft sm:h-11 sm:w-11">
                <AlertTriangle className="h-4 w-4 text-brand sm:h-5 sm:w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xl font-normal leading-tight text-foreground transition-colors group-hover/zeile:text-brand sm:text-2xl">Rückstände & Guthaben</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground sm:text-sm">
                  {error
                    ? 'nicht geladen'
                    : isLoading
                    ? 'wird geladen …'
                    : `${fehlendeMietzahlungen?.length || 0} ${(fehlendeMietzahlungen?.length || 0) === 1 ? 'Vertrag' : 'Verträge'}${bkaHinweise.length > 0 ? ` · ${bkaHinweise.length} zu prüfen` : ''}`}
                </span>
              </span>
            </CollapsibleTrigger>
            <span className="mt-1 self-start sm:mt-1.5">
              <KennzahlInfo titel="Rückstände & Guthaben">
                <p>Stand des Mietkontos je Vertrag über alle Monate: fällige Forderungen gegen alle Zahlungen.</p>
                <p>Eine Monatsmiete zählt ab ihrer Fälligkeit am 8. Was vorher für die kommende Miete eingeht, ist Vorauszahlung und kein Guthaben.</p>
                <p>Beendete Verträge stehen in der Liste, zählen aber nicht in den Summen.</p>
              </KennzahlInfo>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {(kopfRueckstand > 0 || kopfGuthaben > 0) && (
              <div className="mr-2 hidden gap-4 text-right xs:flex sm:mr-5 sm:gap-7">
                {kopfRueckstand > 0 && (
                  <div>
                    <p className="eyebrow flex items-center justify-end gap-1">
                      Rückstände
                      <KennzahlInfo titel="Rückstände">
                        <p>Fällige, unbezahlte Beträge der aktiven und gekündigten Verträge: Monatsmieten ab dem 8., Betriebskostennachzahlungen ab Fälligkeit, Rücklastschriftgebühren.</p>
                        <p>Zahlungen werden mit der ältesten Schuld zuerst verrechnet. Ab dem 8. ist das oben „Noch offen“ plus ältere Rückstände.</p>
                      </KennzahlInfo>
                    </p>
                    <p className="mt-1 whitespace-nowrap text-xl font-light leading-none tabular-nums text-brand sm:text-3xl">
                      {formatBetrag(kopfRueckstand)}
                    </p>
                  </div>
                )}
                {kopfGuthaben > 0 && (
                  <div>
                    <p className="eyebrow flex items-center justify-end gap-1">
                      Guthaben
                      <KennzahlInfo titel="Guthaben">
                        <p>Überzahlungen der aktiven und gekündigten Verträge, auch BKA-Guthaben.</p>
                        <p>Eine Vorauszahlung auf die kommende Miete zählt nicht dazu. Ein Guthaben bleibt stehen, bis es mit einer fälligen Miete verrechnet oder ausgezahlt ist.</p>
                      </KennzahlInfo>
                    </p>
                    <p className="mt-1 whitespace-nowrap text-xl font-light leading-none tabular-nums text-success sm:text-3xl">
                      {formatBetrag(kopfGuthaben)}
                    </p>
                  </div>
                )}
              </div>
            )}
            <CollapsibleTrigger
              className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover/zeile:border-foreground group-hover/zeile:text-foreground"
              aria-label={isOpen ? 'Rückstände zuklappen' : 'Rückstände aufklappen'}
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="pb-6">
          {/* Mobile Summary - Shows on small screens */}
          {(kopfRueckstand > 0 || kopfGuthaben > 0) && (
            <div className="mb-3 flex gap-3 border border-border bg-muted/60 p-2 xs:hidden">
              {kopfRueckstand > 0 && (
                <div className="flex-1 text-center">
                  <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    Rückstände
                    <KennzahlInfo titel="Rückstände">
                      <p>Fällige, unbezahlte Beträge der aktiven und gekündigten Verträge: Monatsmieten ab dem 8., Betriebskostennachzahlungen ab Fälligkeit, Rücklastschriftgebühren.</p>
                      <p>Zahlungen werden mit der ältesten Schuld zuerst verrechnet. Ab dem 8. ist das oben „Noch offen“ plus ältere Rückstände.</p>
                    </KennzahlInfo>
                  </p>
                  <p className="text-sm font-bold text-brand">{formatBetrag(kopfRueckstand)}</p>
                </div>
              )}
              {kopfGuthaben > 0 && (
                <div className="flex-1 text-center">
                  <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    Guthaben
                    <KennzahlInfo titel="Guthaben">
                      <p>Überzahlungen der aktiven und gekündigten Verträge, auch BKA-Guthaben.</p>
                      <p>Eine Vorauszahlung auf die kommende Miete zählt nicht dazu. Ein Guthaben bleibt stehen, bis es mit einer fälligen Miete verrechnet oder ausgezahlt ist.</p>
                    </KennzahlInfo>
                  </p>
                  <p className="text-sm font-bold text-success">{formatBetrag(kopfGuthaben)}</p>
                </div>
              )}
            </div>
          )}
          
          {/* BKA-Zahlungen ohne BKA-Forderung, auch bei ausgeglichenem Saldo (Sonderfall, 29.10.2026) */}
          {bkaHinweise.length > 0 && (
            <div className="mb-4 border border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                Zu prüfen: BKA-Zahlungen ohne BKA-Forderung
                <KennzahlInfo titel="BKA-Zahlung ohne BKA-Forderung">
                  <p>Eine Zahlung ist als Betriebskostenabrechnung gebucht, aber die Abrechnung ist nicht als Forderung (Typ BKA) angelegt — oder die Zahlung geht über sie hinaus.</p>
                  <p>Solche Zahlungen tilgen keine Miete und stehen nicht im Rückstand oder Guthaben. Bitte die Abrechnung im Vertrag als Forderung anlegen.</p>
                </KennzahlInfo>
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {bkaHinweise.map((h) => (
                  <li key={h.mietvertrag_id}>
                    <button
                      type="button"
                      onClick={(e) => handleMietvertragClick(h.mietvertrag_id, e)}
                      className="flex w-full flex-wrap items-baseline justify-between gap-x-3 rounded-sm text-left hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                    >
                      <span>{h.immobilie_name}{h.einheit ? ` · ${h.einheit}` : ''} · {h.mieter_name}</span>
                      <span className="tabular-nums text-muted-foreground">{h.betrag > 0 ? 'Zahlung' : 'Auszahlung'} {formatBetrag(Math.abs(h.betrag))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-3">
            <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Mieter, Objekt oder Einheit suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                aria-label="Suche leeren"
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Sorting Controls */}
          {fehlendeMietzahlungen && fehlendeMietzahlungen.length > 0 && (
            <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between border-b border-border/80 pb-3 sm:pb-4">
              {/* Sort Buttons - Horizontal scroll on mobile */}
              <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
                <Button
                  variant={sortBy === 'object' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSort('object')}
                  className="gap-1 text-xs sm:text-sm whitespace-nowrap flex-shrink-0"
                >
                  Objekt {getSortIcon('object')}
                </Button>
                <Button
                  variant={sortBy === 'amount' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSort('amount')}
                  className="gap-1 text-xs sm:text-sm whitespace-nowrap flex-shrink-0"
                >
                  Betrag {getSortIcon('amount')}
                </Button>
                <Button
                  variant={sortBy === 'mahnstufe' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSort('mahnstufe')}
                  className="gap-1 text-xs sm:text-sm whitespace-nowrap flex-shrink-0"
                >
                  Mahnstufe {getSortIcon('mahnstufe')}
                </Button>
                <Button
                  variant={sortBy === 'tenant' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSort('tenant')}
                  className="gap-1 text-xs sm:text-sm whitespace-nowrap flex-shrink-0"
                >
                  Mieter {getSortIcon('tenant')}
                </Button>
              </div>
              
              {/* Filter Controls */}
              <div className="flex gap-2 items-center overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
                <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground flex-shrink-0">
                  <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
                </div>
                
                <Select value={amountFilter} onValueChange={(value: AmountFilter) => setAmountFilter(value)}>
                  <SelectTrigger className="w-24 sm:w-32 h-8 text-xs sm:text-sm flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle</SelectItem>
                    <SelectItem value="debt">Rückstände</SelectItem>
                    <SelectItem value="credit">Guthaben</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={statusFilter} onValueChange={(value: StatusFilter) => setStatusFilter(value)}>
                  <SelectTrigger className="w-28 sm:w-36 h-8 text-xs sm:text-sm flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Status ({statusCounts.aktiv + statusCounts.gekuendigt + statusCounts.beendet})</SelectItem>
                    <SelectItem value="aktiv">Aktiv ({statusCounts.aktiv})</SelectItem>
                    <SelectItem value="gekuendigt">Gekündigt ({statusCounts.gekuendigt})</SelectItem>
                    <SelectItem value="beendet">Beendet ({statusCounts.beendet})</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={minAmountFilter} onValueChange={(value: MinAmountFilter) => setMinAmountFilter(value)}>
                  <SelectTrigger className="w-24 sm:w-36 h-8 text-xs sm:text-sm flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle €</SelectItem>
                    <SelectItem value="over100">&gt;100€</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex justify-between items-center mt-2">
                <div className="text-xs text-muted-foreground">
                  {sortedFehlendeMietzahlungen.length} Einträge {amountFilter !== 'all' || minAmountFilter !== 'all' || statusFilter !== 'all' || searchTerm ? '(gefiltert) ' : ''}sortiert nach{' '}
                  {sortBy === 'object' && 'Objekt'}
                  {sortBy === 'amount' && 'Betrag'}
                  {sortBy === 'mahnstufe' && 'Mahnstufe'}
                  {sortBy === 'tenant' && 'Mieter'}
                  {' '}({sortDirection === 'asc' ? 'aufsteigend' : 'absteigend'})
                </div>
                
                {/* Reset Filter Button */}
                {(amountFilter !== 'all' || minAmountFilter !== 'all' || statusFilter !== 'all' || searchTerm) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAmountFilter('all');
                      setMinAmountFilter('all');
                      setStatusFilter('all');
                      setSearchTerm("");
                    }}
                    className="text-xs"
                  >
                    Filter zurücksetzen
                  </Button>
                )}
              </div>
            </div>
          )}
          
          {/* Contract List - Grouped by Rückstände and Guthaben, then by Status */}
          {sortedFehlendeMietzahlungen && sortedFehlendeMietzahlungen.length > 0 ? (
            <div className="space-y-6 animate-fade-in">
              {/* Rückstände Section */}
              {allRueckstaende.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border border-brand/30 bg-brand-soft p-2 sm:p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-brand" aria-hidden="true" />
                      <h3 className="font-semibold text-foreground text-sm sm:text-base">Rückstände</h3>
                      <Badge variant="destructive" className="text-xs">
                        {allRueckstaende.length} {allRueckstaende.length === 1 ? 'Vertrag' : 'Verträge'}
                      </Badge>
                    </div>
                    <p className="font-bold text-brand text-sm sm:text-base">
                      {formatBetrag(gesamtRueckstandBetrag)}
                    </p>
                  </div>
                  
                  {/* Grouped by status */}
                  <div className="space-y-4">
                    <FehlendeMietzahlungenStatusGroup
                      status="aktiv"
                      items={rueckstaende.aktiv}
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                    <FehlendeMietzahlungenStatusGroup
                      status="gekuendigt"
                      items={rueckstaende.gekuendigt}
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                    <FehlendeMietzahlungenStatusGroup
                      status="beendet"
                      items={rueckstaende.beendet}
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                  </div>
                </div>
              )}

              {/* Guthaben Section */}
              {allGuthaben.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border border-success/30 bg-success/10 p-2 sm:p-3">
                    <div className="flex items-center gap-2">
                      <Euro className="h-4 w-4 sm:h-5 sm:w-5 text-success" aria-hidden="true" />
                      <h3 className="font-semibold text-foreground text-sm sm:text-base">Guthaben</h3>
                      <Badge className="text-xs bg-success text-success-foreground">
                        {allGuthaben.length} {allGuthaben.length === 1 ? 'Vertrag' : 'Verträge'}
                      </Badge>
                    </div>
                    <p className="font-bold text-success text-sm sm:text-base">
                      {formatBetrag(gesamtGuthabenBetrag)}
                    </p>
                  </div>
                  
                  {/* Grouped by status */}
                  <div className="space-y-4">
                    <FehlendeMietzahlungenStatusGroup
                      status="aktiv"
                      items={guthaben.aktiv}
                      isGuthaben
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                    <FehlendeMietzahlungenStatusGroup
                      status="gekuendigt"
                      items={guthaben.gekuendigt}
                      isGuthaben
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                    <FehlendeMietzahlungenStatusGroup
                      status="beendet"
                      items={guthaben.beendet}
                      isGuthaben
                      onMietvertragClick={handleMietvertragClick}
                      formatBetrag={formatBetrag}
                    />
                  </div>
                </div>
              )}
              
              {/* Summary Footer */}
              <div className="pt-4 border-t border-border">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    {sortedFehlendeMietzahlungen.length} {sortedFehlendeMietzahlungen.length === 1 ? 'Mietvertrag' : 'Mietverträge'} mit Rückständen oder Guthaben
                  </p>
                  <div className="flex flex-wrap gap-2 sm:gap-4">
                    {allRueckstaende.length > 0 && (
                      <p className="font-semibold text-brand text-xs sm:text-sm">
                        Rückstände: {formatBetrag(gesamtRueckstandBetrag)}
                      </p>
                    )}
                    {allGuthaben.length > 0 && (
                      <p className="font-semibold text-success text-xs sm:text-sm">
                        Guthaben: {formatBetrag(gesamtGuthabenBetrag)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : error ? (
            /* Bis zum 06.09.2026 zeigte diese Ansicht bei jedem Abfragefehler
               den gruenen Erfolgszustand "Alle Mietvertraege sind ausgeglichen".
               isLoading und error wurden zwar entnommen, aber nie gerendert --
               ein Ausfall sah damit aus wie Entwarnung. */
            <div className="text-center py-8">
              <div className="p-6 bg-destructive/10 rounded-lg border border-destructive/30 inline-block max-w-md">
                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 bg-destructive/15 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                  </div>
                  <p className="text-destructive font-medium text-lg">Rückstände konnten nicht geladen werden</p>
                  <p className="text-destructive/80 text-sm">
                    Die Zahlen unten fehlen — nicht, weil alles ausgeglichen ist, sondern weil die Abfrage
                    fehlgeschlagen ist. Bitte die Seite neu laden.
                  </p>
                </div>
              </div>
            </div>
          ) : isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Rückstände werden geladen …</p>
            </div>
          ) : (fehlendeMietzahlungen?.length ?? 0) > 0 ? (
            /* Suche oder Filter ohne Treffer: bis zum 29.10.2026 stand hier „Alle Mietverträge sind ausgeglichen“ */
            <p className="py-8 text-center text-sm text-muted-foreground">Keine Treffer für Suche oder Filter.</p>
          ) : (
            <div className="text-center py-8 animate-fade-in">
              <div className="inline-block border border-success/30 bg-success/10 p-6">
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-full bg-success/15 p-3">
                    <Euro className="h-6 w-6 text-success" aria-hidden="true" />
                  </div>
                  <p className="text-lg font-medium text-success">Keine Rückstände oder Guthaben</p>
                  <p className="text-sm text-muted-foreground">Alle Mietverträge sind ausgeglichen</p>
                </div>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
