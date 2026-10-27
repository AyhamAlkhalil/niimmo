import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TrendingUp, ChevronRight } from "lucide-react";
import { RentIncreaseModal } from "./RentIncreaseModal";

export interface RentIncreaseEligibility {
  mietvertrag_id: string;
  current_kaltmiete: number;
  current_betriebskosten: number;
  letzte_mieterhoehung_am: string | null;
  start_datum: string;
  is_eligible: boolean;
  months_since_last_increase: number;
  months_since_start: number;
  reason: string;
  einheit_id?: string;
  immobilie_id?: string;
  immobilie_name?: string;
  immobilie_adresse?: string;
  mieter?: Array<{
    vorname: string;
    nachname: string;
    hauptmail: string | null;
    telnr: string | null;
  }>;
}

interface RentIncreaseListProps {
  onContractClick?: (contractId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function formatCurrencyEUR(value: number) {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE").format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function RentIncreaseList({ onContractClick, open, onOpenChange }: RentIncreaseListProps) {
  const [internalOpen, setInternalOpen] = useState(() => {
    const saved = localStorage.getItem('rentIncreaseListOpen');
    return saved === 'true';
  });
  
  const isOpen = typeof open === 'boolean' ? open : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  
  const [selectedContract, setSelectedContract] = useState<RentIncreaseEligibility | null>(null);
  const [showRentIncreaseModal, setShowRentIncreaseModal] = useState(false);
  
  const handleToggle = () => {
    const newState = !isOpen;
    setOpen(newState);
    localStorage.setItem('rentIncreaseListOpen', String(newState));
  };
  
  const { data, isLoading, error, refetch, isFetching } = useQuery<{ eligible_contracts?: RentIncreaseEligibility[] | null}>({
    queryKey: ["rent-increase-eligibility"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("check-rent-increase-eligibility");
      if (error) throw error;
      return data ?? { eligible_contracts: [] };
    },
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  // Sortierte Liste nach Immobilie und Einheitennummer
  const eligible = useMemo(() => {
    const contracts = data?.eligible_contracts ?? [];
    return [...contracts].sort((a, b) => {
      // Primär: Nach Immobilienname sortieren (alphabetisch)
      const nameA = a.immobilie_name || '';
      const nameB = b.immobilie_name || '';
      const nameCompare = nameA.localeCompare(nameB, 'de', { numeric: true });
      if (nameCompare !== 0) return nameCompare;

      // Sekundär: Nach Einheitennummer sortieren (letzte 2 Ziffern numerisch)
      const getUnitNumber = (einheitId: string | undefined) => {
        if (!einheitId) return 0;
        const lastTwo = einheitId.slice(-2);
        const num = parseInt(lastTwo, 10);
        return isNaN(num) ? 0 : num;
      };

      return getUnitNumber(a.einheit_id) - getUnitNumber(b.einheit_id);
    });
  }, [data?.eligible_contracts]);

  return (
    // Zeile unter „Handlungsbedarf“ auf der Startseite (27.10.2026): Haarlinie statt Karte
    <div id="rentincrease-section" className="group/zeile relative border-b border-border">
      {/* HEADER ALS BUTTON */}
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!isOpen);
          }
        }}
        aria-expanded={isOpen}
        aria-controls="rent-increase-content"
        className="relative z-10 flex w-full cursor-pointer select-none items-center justify-between gap-4 rounded-sm py-5 pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:py-6"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-muted sm:h-11 sm:w-11">
            <TrendingUp className="h-4 w-4 text-foreground/70 sm:h-5 sm:w-5" />
          </div>
          <span className="text-left text-xl font-normal leading-tight text-foreground transition-colors group-hover/zeile:text-brand sm:text-2xl">Mögliche Mieterhöhungen</span>
          {isOpen && eligible.length > 0 && (
            <span className="ml-1 bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-foreground/80">
              {eligible.length}
            </span>
          )}
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors group-hover/zeile:border-foreground group-hover/zeile:text-foreground" aria-hidden="true">
          <ChevronRight className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`} />
        </span>
      </button>

      {/* INHALT mit einfacher Auf/Zu-Animation */}
      <div
        id="rent-increase-content"
        className="relative z-0 overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: isOpen ? '500px' : '0', opacity: isOpen ? 1 : 0 }}
      >
        <div className="pb-6 space-y-3 max-h-[500px] overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Wird geprüft…</p>
          ) : error ? (
            <p className="text-sm text-destructive">Fehler: {(error as Error).message}</p>
          ) : eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aktuell sind keine Mieterhöhungen möglich.</p>
          ) : (
            <div className="space-y-2">
              {eligible.map((row) => {
                const einheitDisplay = row.einheit_id ? row.einheit_id.slice(-2) : 'N/A';
                const immobilieDisplay = row.immobilie_id ? row.immobilie_id.slice(-2) : 'N/A';
                
                return (
                  <div 
                    key={row.mietvertrag_id}
                    id={`rentincrease-${row.mietvertrag_id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-neutral-50/60 p-3.5 transition-colors hover:border-neutral-300 hover:bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-foreground">Objekt {immobilieDisplay}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">Einheit {einheitDisplay}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">Kaltmiete {formatCurrencyEUR(row.current_kaltmiete)}</span>
                      </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {row.immobilie_adresse}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Letzte Erhöhung: {formatDate(row.letzte_mieterhoehung_am)} • Vertragsstart: {formatDate(row.start_datum)}
                    </div>
                    {row.reason && (
                      <div className="text-xs text-muted-foreground mt-1" title={row.reason}>
                        {row.reason}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button 
                      size="sm" 
                      variant="default" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedContract(row);
                        setShowRentIncreaseModal(true);
                      }}
                    >
                      Mieterhöhung erstellen
                    </Button>
                    {onContractClick && (
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          onContractClick(row.mietvertrag_id);
                        }}
                      >
                        Öffnen
                      </Button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rent Increase Modal */}
      <RentIncreaseModal
        isOpen={showRentIncreaseModal}
        onClose={() => {
          setShowRentIncreaseModal(false);
          setSelectedContract(null);
        }}
        contractData={selectedContract ? {
          mietvertrag_id: selectedContract.mietvertrag_id,
          current_kaltmiete: selectedContract.current_kaltmiete,
          current_betriebskosten: selectedContract.current_betriebskosten || 0,
          letzte_mieterhoehung_am: selectedContract.letzte_mieterhoehung_am,
          start_datum: selectedContract.start_datum,
          months_since_last_increase: selectedContract.months_since_last_increase,
          months_since_start: selectedContract.months_since_start,
          einheit_id: selectedContract.einheit_id,
          immobilie_id: selectedContract.immobilie_id,
          immobilie_name: selectedContract.immobilie_name,
          immobilie_adresse: selectedContract.immobilie_adresse,
          mieter: selectedContract.mieter
        } : null}
      />
    </div>
  );
}

export default RentIncreaseList;
