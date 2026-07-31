import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Building2, User, Calendar, MapPin, Clock, Link2 } from "lucide-react";
import { format, addDays, differenceInDays } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ContractWithDetails {
  id: string;
  status: string;
  start_datum: string | null;
  ende_datum: string | null;
  kuendigungsdatum: string | null;
  kaltmiete: number | null;
  betriebskosten: number | null;
  strom_einzug: number | null;
  gas_einzug: number | null;
  kaltwasser_einzug: number | null;
  warmwasser_einzug: number | null;
  einheit: {
    id: string;
    etage: string | null;
    zaehler: number | null;
    immobilie: {
      id: string;
      name: string;
      adresse: string;
    };
  };
  mieter: Array<{
    id: string;
    vorname: string;
    nachname: string;
  }>;
}

interface ContractGroup {
  contracts: ContractWithDetails[];
  isLinked: boolean;
  hasDifferentEndDates: boolean;
  mieterIds: string[];
  priority: number;
  priorityLabel?: string;
}

interface UebergabeContractListProps {
  contracts: ContractWithDetails[];
  uebergabeType: "einzug" | "auszug";
  searchQuery: string;
  onContractClick: (group: ContractGroup) => void;
}

export const UebergabeContractList = ({
  contracts,
  uebergabeType,
  searchQuery,
  onContractClick,
}: UebergabeContractListProps) => {
  const today = new Date();

  // Das tatsächliche Auszugsdatum ist das spätere von Kündigungs- und Ende-Datum:
  // Verträge können ein früheres ende_datum tragen, obwohl bis zum kuendigungsdatum gewohnt wird.
  const getAuszugsDatum = (contract: ContractWithDetails): Date | null => {
    const dates = [contract.kuendigungsdatum, contract.ende_datum]
      .filter((d): d is string => !!d)
      .map(d => new Date(d));
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  };

  const getPriority = (contract: ContractWithDetails): { priority: number; label?: string } => {
    if (uebergabeType === "einzug") {
      if (contract.start_datum && contract.status === "aktiv") {
        const daysAgo = differenceInDays(today, new Date(contract.start_datum));
        if (daysAgo >= 0 && daysAgo <= 7) {
          return { priority: 1, label: `vor ${daysAgo} Tag${daysAgo !== 1 ? 'en' : ''} eingezogen` };
        }
        if (daysAgo >= 0 && daysAgo <= 30) {
          return { priority: 2, label: "diesen Monat eingezogen" };
        }
      }
      return { priority: 10 };
    } else {
      const auszugsDatum = getAuszugsDatum(contract);
      if (auszugsDatum) {
        const daysUntil = differenceInDays(auszugsDatum, today);
        // Übergaben finden oft erst einige Tage nach dem Auszugsdatum statt —
        // deshalb bleibt der Vertrag auch rückwirkend 30 Tage lang ein Vorschlag.
        if (daysUntil === 0) {
          return { priority: 1, label: "heute" };
        }
        if (daysUntil > 0 && daysUntil <= 7) {
          return { priority: 1, label: `in ${daysUntil} Tag${daysUntil !== 1 ? 'en' : ''}` };
        }
        if (daysUntil < 0 && daysUntil >= -30) {
          const daysAgo = Math.abs(daysUntil);
          return { priority: 1, label: `vor ${daysAgo} Tag${daysAgo !== 1 ? 'en' : ''} ausgezogen` };
        }
        if (daysUntil > 7 && daysUntil <= 30) {
          return { priority: 2, label: "diesen Monat" };
        }
      }
      if (contract.status === "gekuendigt") {
        return { priority: 3, label: "gekündigt" };
      }
      return { priority: 10 };
    }
  };

  const groupedContracts = useMemo(() => {
    // Alle Verträge sind auffindbar — auch beendete. Ein Vertrag gilt oft schon als
    // 'beendet', während die Übergabe noch aussteht; ihn auszublenden machte sie unmöglich.
    let filtered = contracts;

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => {
        const mieterNames = c.mieter.map(m => `${m.vorname} ${m.nachname}`.toLowerCase()).join(" ");
        const immobilieName = c.einheit.immobilie.name.toLowerCase();
        const adresse = c.einheit.immobilie.adresse.toLowerCase();
        const etage = c.einheit.etage?.toLowerCase() || "";
        return mieterNames.includes(query) || immobilieName.includes(query) || 
               adresse.includes(query) || etage.includes(query);
      });
    }

    const groups: ContractGroup[] = filtered.map(contract => {
      const { priority, label } = getPriority(contract);
      return {
        contracts: [contract],
        isLinked: false,
        hasDifferentEndDates: false,
        mieterIds: contract.mieter.map(m => m.id),
        priority,
        priorityLabel: label,
      };
    });

    return groups.sort((a, b) => a.priority - b.priority);
  }, [contracts, uebergabeType, searchQuery]);

  const highPriorityGroups = groupedContracts.filter(g => g.priority <= 2);
  const standardGroups = groupedContracts.filter(g => g.priority > 2);

  const renderContractRow = (group: ContractGroup) => {
    const mainContract = group.contracts[0];
    const mieterName = mainContract.mieter.map(m => `${m.vorname} ${m.nachname}`).join(", ");
    const totalMiete = (mainContract.kaltmiete || 0) + (mainContract.betriebskosten || 0);

    return (
      <button
        key={mainContract.id}
        onClick={() => onContractClick(group)}
        className="w-full text-left p-3 sm:p-4 rounded-xl border bg-white border-gray-200 transition-all duration-200 hover:shadow-md hover:border-primary/30"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <span className="font-semibold text-gray-900 truncate">
                {mieterName || "Kein Mieter"}
              </span>
              {group.priorityLabel && group.priority <= 2 && (
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "text-xs",
                    group.priority === 1 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
                  )}
                >
                  <Clock className="h-3 w-3 mr-1" />
                  {group.priorityLabel}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {mainContract.einheit.immobilie.name}
                {mainContract.einheit.etage && ` – ${mainContract.einheit.etage}`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{mainContract.einheit.immobilie.adresse}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                mainContract.status === "aktiv" && "border-green-300 bg-green-50 text-green-700",
                mainContract.status === "gekuendigt" && "border-orange-300 bg-orange-50 text-orange-700",
                mainContract.status === "beendet" && "border-gray-300 bg-gray-100 text-gray-600"
              )}
            >
              {mainContract.status === "aktiv"
                ? "Aktiv"
                : mainContract.status === "gekuendigt"
                  ? "Gekündigt"
                  : "Beendet"}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Calendar className="h-3 w-3" />
              <span>
                {mainContract.start_datum 
                  ? format(new Date(mainContract.start_datum), "dd.MM.yyyy", { locale: de })
                  : "–"
                }
                {mainContract.kuendigungsdatum && (
                  <> → {format(new Date(mainContract.kuendigungsdatum), "dd.MM.yyyy", { locale: de })}</>
                )}
                {!mainContract.kuendigungsdatum && mainContract.ende_datum && (
                  <> → {format(new Date(mainContract.ende_datum), "dd.MM.yyyy", { locale: de })}</>
                )}
                {!mainContract.kuendigungsdatum && !mainContract.ende_datum && " → unbefristet"}
              </span>
            </div>
            {totalMiete > 0 && (
              <span className="text-xs font-medium text-gray-600">
                {totalMiete.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}/Monat
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {highPriorityGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-red-100">
              <Clock className="h-4 w-4 text-red-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">Vorschläge</h3>
            <span className="text-xs text-gray-500">({highPriorityGroups.length})</span>
          </div>
          <div className="space-y-2">
            {highPriorityGroups.map(group => renderContractRow(group))}
          </div>
        </div>
      )}

      {standardGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-gray-100">
              <Building2 className="h-4 w-4 text-gray-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">Alle Verträge</h3>
            <span className="text-xs text-gray-500">({standardGroups.length})</span>
          </div>
          <div className="space-y-2">
            {standardGroups.map(group => renderContractRow(group))}
          </div>
        </div>
      )}

      {groupedContracts.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            {searchQuery ? "Keine Suchergebnisse" : "Keine Verträge gefunden"}
          </h3>
          <p className="text-gray-500 text-sm">
            {searchQuery
              ? "Versuchen Sie einen anderen Suchbegriff."
              : "Es sind keine Mietverträge vorhanden."}
          </p>
        </div>
      )}
    </div>
  );
};
