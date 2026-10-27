import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Building2, Calendar, ChevronRight, Clock, FileCheck2, History, MapPin, User } from "lucide-react";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getVertragsende } from "@/utils/contractUtils";
import { mieterName as namenText } from "@/utils/benutzerName";

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
  /** Vertrag → Zeitpunkt des angefangenen Entwurfs dieser Art auf diesem Gerät */
  entwuerfe?: Map<string, string>;
  /** Vertrag → Zeitpunkt des jüngsten gespeicherten Protokolls dieser Art */
  protokolle?: Map<string, string>;
}

export const UebergabeContractList = ({
  contracts,
  uebergabeType,
  searchQuery,
  onContractClick,
  entwuerfe,
  protokolle,
}: UebergabeContractListProps) => {
  const today = new Date();

  // Auszug = Mietende aus getVertragsende(), wie auf der Einheiten-Karte und im Detailfenster.
  const getAuszugsDatum = (contract: ContractWithDetails): Date | null => {
    const ende = getVertragsende(contract);
    return ende ? parseISO(ende.slice(0, 10)) : null;
  };

  const getPriority = (contract: ContractWithDetails): { priority: number; label?: string } => {
    // Angefangen auf diesem Gerät — ganz nach oben, dort sucht man zuerst
    const entwurf = entwuerfe?.get(contract.id);
    if (entwurf) return { priority: 0, label: `Entwurf vom ${format(new Date(entwurf), "dd.MM., HH:mm", { locale: de })} Uhr` };
    if (uebergabeType === "einzug") {
      if (contract.start_datum && contract.status === "aktiv") {
        // Kalendertage in Ortszeit: new Date("yyyy-MM-dd") ist Mitternacht UTC, und
        // differenceInDays schnitt angefangene Tage ab — „morgen“ hieß dann „heute“
        const daysAgo = differenceInCalendarDays(today, parseISO(contract.start_datum.slice(0, 10)));
        if (daysAgo >= 0 && daysAgo <= 7) {
          return { priority: 1, label: `vor ${daysAgo} Tag${daysAgo !== 1 ? 'en' : ''} eingezogen` };
        }
        if (daysAgo >= 0 && daysAgo <= 30) {
          return { priority: 2, label: "in den letzten 30 Tagen eingezogen" };
        }
      }
      return { priority: 10 };
    } else {
      const auszugsDatum = getAuszugsDatum(contract);
      if (auszugsDatum) {
        const daysUntil = differenceInCalendarDays(auszugsDatum, today);
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
          return { priority: 2, label: "in den nächsten 30 Tagen" };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, uebergabeType, searchQuery, entwuerfe]);

  const angefangen = groupedContracts.filter(g => g.priority === 0);
  const highPriorityGroups = groupedContracts.filter(g => g.priority >= 1 && g.priority <= 2);
  const standardGroups = groupedContracts.filter(g => g.priority > 2);

  const renderContractRow = (group: ContractGroup) => {
    const mainContract = group.contracts[0];
    const mieterName = mainContract.mieter.map(m => namenText(m)).filter(Boolean).join(", ");
    const totalMiete = (mainContract.kaltmiete || 0) + (mainContract.betriebskosten || 0);
    const protokoll = protokolle?.get(mainContract.id);

    return (
      <button
        key={mainContract.id}
        onClick={() => onContractClick(group)}
        className="w-full rounded-xl border bg-card p-3 text-left transition-all duration-200 hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="truncate font-semibold">{mieterName || "Kein Mieter"}</span>
                {group.priorityLabel && group.priority <= 2 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-normal",
                      group.priority === 0 && "border-primary/30 bg-primary/10 text-primary",
                      group.priority === 1 && "border-destructive/30 bg-destructive/10 text-destructive",
                      group.priority === 2 && "border-warning/30 bg-warning/10 text-warning"
                    )}
                  >
                    {group.priority === 0 ? <History className="mr-1 h-3 w-3" /> : <Clock className="mr-1 h-3 w-3" />}
                    {group.priorityLabel}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {mainContract.einheit.immobilie.name}
                  {mainContract.einheit.etage && ` – ${mainContract.einheit.etage}`}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{mainContract.einheit.immobilie.adresse}</span>
              </div>
              {protokoll && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-success">
                  <FileCheck2 className="h-3.5 w-3.5 flex-shrink-0" />
                  {uebergabeType === "einzug" ? "Einzugsprotokoll" : "Auszugsprotokoll"} vom {format(parseISO(protokoll), "dd.MM.yyyy", { locale: de })} vorhanden
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-normal",
                  mainContract.status === "aktiv" && "border-success/30 bg-success/10 text-success",
                  mainContract.status === "gekuendigt" && "border-warning/30 bg-warning/10 text-warning",
                  mainContract.status === "beendet" && "bg-muted text-muted-foreground"
                )}
              >
                {mainContract.status === "aktiv"
                  ? "Aktiv"
                  : mainContract.status === "gekuendigt"
                    ? "Gekündigt"
                    : "Beendet"}
              </Badge>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>
                  {mainContract.start_datum
                    ? format(new Date(mainContract.start_datum), "dd.MM.yyyy", { locale: de })
                    : "–"
                  }
                  {getVertragsende(mainContract)
                    ? <> → {format(new Date(getVertragsende(mainContract)!), "dd.MM.yyyy", { locale: de })}</>
                    : " → unbefristet"}
                </span>
              </div>
              {totalMiete > 0 && (
                <span className="text-xs font-medium text-muted-foreground">
                  {totalMiete.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}/Monat
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        </div>
      </button>
    );
  };

  const abschnitt = (titel: string, gruppen: ContractGroup[], symbol: React.ReactNode) =>
    gruppen.length > 0 && (
      <section>
        <div className="mb-3 flex items-center gap-2">
          {symbol}
          <h3 className="text-sm font-semibold">{titel}</h3>
          <span className="text-xs text-muted-foreground">({gruppen.length})</span>
        </div>
        <div className="space-y-2">{gruppen.map(group => renderContractRow(group))}</div>
      </section>
    );

  return (
    <div className="space-y-6">
      {abschnitt("Angefangen auf diesem Gerät", angefangen, <History className="h-4 w-4 text-primary" />)}
      {abschnitt("Vorschläge", highPriorityGroups, <Clock className="h-4 w-4 text-destructive" />)}
      {abschnitt("Alle Verträge", standardGroups, <Building2 className="h-4 w-4 text-muted-foreground" />)}

      {groupedContracts.length === 0 && (
        <div className="py-12 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="mb-2 text-lg font-semibold">
            {searchQuery ? "Keine Suchergebnisse" : "Keine Verträge gefunden"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? "Versuchen Sie einen anderen Suchbegriff."
              : "Es sind keine Mietverträge vorhanden."}
          </p>
        </div>
      )}
    </div>
  );
};
