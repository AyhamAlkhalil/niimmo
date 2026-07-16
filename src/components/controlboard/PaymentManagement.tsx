import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Upload, Search, FileText, Calendar, Bot, Euro, Building2, Home, User, Edit2, X, AlertTriangle, ChevronDown, ChevronRight, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { AssignPaymentDialog } from "./AssignPaymentDialog";
import { PaymentAssignmentResultsModal } from "./PaymentAssignmentResultsModal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { NebenkostenZuordnungTab } from "./NebenkostenZuordnungTab";
import { LastUploadReviewModal } from "./LastUploadReviewModal";
import { ZahlungsAnomalienBanner } from "./ZahlungsAnomalienBanner";

/**
 * Robuster Betragsparser für deutsche und englische Formate:
 * "1.250,00" → 1250.00  (DE mit Tausender)
 * "1,250.00" → 1250.00  (EN mit Tausender)
 * "1250,50"  → 1250.50  (DE ohne Tausender)
 * "5000 00"  → 5000.00  (Leerzeichen als Dezimal)
 * "-1.250,00"→ -1250.00 (Negativ vorne)
 * "1.250,00-"→ -1250.00 (Negativ hinten)
 */
function parseAmountRobust(raw: string | number): number {
  if (typeof raw === "number") return raw;
  if (!raw || typeof raw !== "string") return 0;

  let s = raw.trim();

  // Vorzeichen erkennen (vorne oder hinten)
  let negative = false;
  if (s.startsWith("-")) { negative = true; s = s.substring(1).trim(); }
  else if (s.endsWith("-")) { negative = true; s = s.slice(0, -1).trim(); }

  // Leerzeichen als Dezimaltrenner: "5000 00" → "5000.00"
  const spaceDecimalMatch = s.match(/^(\d+)\s(\d{2})$/);
  if (spaceDecimalMatch) {
    const val = parseFloat(`${spaceDecimalMatch[1]}.${spaceDecimalMatch[2]}`);
    return negative ? -val : val;
  }

  // Alle Leerzeichen entfernen
  s = s.replace(/\s/g, "");

  // Bestimme ob Komma oder Punkt der Dezimaltrenner ist
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Komma ist Dezimaltrenner (DE): "1.250,00"
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // Punkt ist Dezimaltrenner (EN): "1,250.00"
    s = s.replace(/,/g, "");
  } else {
    // Nur eines vorhanden
    s = s.replace(",", ".");
  }

  const val = parseFloat(s);
  if (isNaN(val)) return 0;
  return negative ? -val : val;
}
import { PaymentKategorieEditor } from "./PaymentKategorieEditor";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface PaymentManagementProps {
  onBack: () => void;
}

interface ProcessedPayment {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  mietvertrag_id: string | null;
  immobilie_id?: string | null;
  kategorie: string;
  zuordnungsgrund: string;
  confidence: number;
  mieter_name?: string;
  immobilie_name?: string;
}

interface AIAssignmentStats {
  total: number;
  neue: number;
  duplikate: number;
  zugeordnet: number;
  nicht_zugeordnet: number;
  nach_kategorie: {
    miete: number;
    mietkaution: number;
    ruecklastschrift: number;
    nichtmiete: number;
    betriebskostenabrechnung: number;
  };
  durchschnittliche_konfidenz: number;
}

interface DuplicatePayment {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  existingId: string;
}

interface ZahlungWithDetails {
  id: string;
  betrag: number;
  buchungsdatum: string;
  buchungsdatum_formatted: string; // vorberechnet: "dd.MM.yyyy"
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

// Einmal instanziieren statt bei jedem Render neu
const EUR_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function PaymentManagement({ onBack }: PaymentManagementProps) {
  const [activeTab, setActiveTab] = useState("upload");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  
  // AI Assignment Results State
  const [aiResults, setAiResults] = useState<ProcessedPayment[]>([]);
  const [aiDuplicates, setAiDuplicates] = useState<DuplicatePayment[]>([]);
  const [aiStats, setAiStats] = useState<AIAssignmentStats | null>(null);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [lastUploadReviewOpen, setLastUploadReviewOpen] = useState(false);
  // Zahlungsübersicht State
  const [selectedZahlungId, setSelectedZahlungId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'datum-desc' | 'datum-asc' | 'betrag-desc' | 'betrag-asc' | 'status' | 'kategorie'>('datum-desc');
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null);
  const [showOnlyZugeordnet, setShowOnlyZugeordnet] = useState(false);
  const [showOnlyNichtZugeordnet, setShowOnlyNichtZugeordnet] = useState(false);
  const [allPaymentsSearchTerm, setAllPaymentsSearchTerm] = useState("");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Removed progress bar - using simple toast instead

  // Fetch CSV upload history (last 10)
  const { data: uploadHistory } = useQuery({
    queryKey: ['csv-upload-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('csv_uploads')
        .select('*')
        .order('hochgeladen_am', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data ?? [];
    },
  });

  const lastUpload = uploadHistory?.[0] ?? null;

  // Fetch unassigned payments (for the "Nicht zugeordnete" tab)
  const { data: unassignedPayments, isLoading: unassignedLoading } = useQuery({
    queryKey: ['unassigned-payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .is('mietvertrag_id', null)
        .in('kategorie', ['Miete', 'Mietkaution', 'Rücklastschrift', 'Betriebskostenabrechnung'])
        .order('buchungsdatum', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch ALL payments - lightweight, no joins (for the "Alle Zahlungen" tab)
  const { data: allPayments, isLoading: allPaymentsLoading, isError: allPaymentsError } = useQuery({
    queryKey: ['zahlungen-overview'],
    queryFn: async () => {
      let allData: any[] = [];
      let from = 0;
      const pageSize = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('zahlungen')
          .select(`
            *,
            immobilien:immobilie_id (name, adresse),
            mietvertrag:mietvertrag_id (
              einheiten:einheit_id (id, einheitentyp, immobilien:immobilie_id (name, adresse)),
              mietvertrag_mieter (mieter:mieter_id (vorname, nachname))
            )
          `)
          .order('buchungsdatum', { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return allData.map((zahlung: any): ZahlungWithDetails => {
        const directImmo = zahlung.immobilien;
        const mv = zahlung.mietvertrag;
        const einheit = mv?.einheiten;
        const mvImmo = einheit?.immobilien;
        const mieterName = mv?.mietvertrag_mieter
          ?.map((mm: any) => `${mm.mieter?.vorname || ''} ${mm.mieter?.nachname || ''}`.trim())
          .filter(Boolean).join(', ') || null;
        // ISO "yyyy-MM-dd" → "dd.MM.yyyy" ohne Date-Objekt
        const [y, m, d] = (zahlung.buchungsdatum || '').split('-');
        return {
          id: zahlung.id,
          betrag: zahlung.betrag,
          buchungsdatum: zahlung.buchungsdatum,
          buchungsdatum_formatted: d && m && y ? `${d}.${m}.${y}` : zahlung.buchungsdatum,
          verwendungszweck: zahlung.verwendungszweck,
          empfaengername: zahlung.empfaengername,
          iban: zahlung.iban,
          zugeordneter_monat: zahlung.zugeordneter_monat,
          kategorie: zahlung.kategorie,
          mietvertrag_id: zahlung.mietvertrag_id,
          immobilie_id: zahlung.immobilie_id,
          immobilie_name: mvImmo?.name || directImmo?.name || null,
          immobilie_adresse: mvImmo?.adresse || directImmo?.adresse || null,
          einheit_id: einheit?.id || null,
          einheit_typ: einheit?.einheitentyp || null,
          mieter_name: mieterName,
        };
      });
    },
  });

  // Server-side search for tenant/property names (not available in lazy-loaded local data)
  const [serverSearchIds, setServerSearchIds] = useState<Set<string> | null>(null);
  const [isServerSearching, setIsServerSearching] = useState(false);
  const searchSeqRef = useRef(0);

  const performServerSearch = useCallback(async (term: string) => {
    if (!term || term.length < 2) {
      setServerSearchIds(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    setIsServerSearching(true);
    try {
      // Search by tenant name via mietvertrag_mieter join
      const { data: mieterMatches } = await supabase
        .from('mieter')
        .select('id, vorname, nachname')
        .or(`vorname.ilike.%${term}%,nachname.ilike.%${term}%`);

      const contractPaymentIds = new Set<string>();
      if (mieterMatches && mieterMatches.length > 0) {
        const mieterIds = mieterMatches.map(m => m.id);
        const { data: mmLinks } = await supabase
          .from('mietvertrag_mieter')
          .select('mietvertrag_id')
          .in('mieter_id', mieterIds);

        if (mmLinks && mmLinks.length > 0) {
          const contractIds = mmLinks.map(l => l.mietvertrag_id);
          const { data: zahlungen } = await supabase
            .from('zahlungen')
            .select('id')
            .in('mietvertrag_id', contractIds);
          zahlungen?.forEach(z => contractPaymentIds.add(z.id));
        }
      }

      // Search by property name/address
      const { data: immobilienMatches } = await supabase
        .from('immobilien')
        .select('id')
        .or(`name.ilike.%${term}%,adresse.ilike.%${term}%`);

      if (immobilienMatches && immobilienMatches.length > 0) {
        const immIds = immobilienMatches.map(i => i.id);
        const { data: zahlungen } = await supabase
          .from('zahlungen')
          .select('id')
          .in('immobilie_id', immIds);
        zahlungen?.forEach(z => contractPaymentIds.add(z.id));
      }

      // Veraltete Antwort verwerfen (Race Condition)
      if (seq !== searchSeqRef.current) return;
      setServerSearchIds(contractPaymentIds);
    } catch (err) {
      if (seq === searchSeqRef.current) setServerSearchIds(null);
    } finally {
      if (seq === searchSeqRef.current) setIsServerSearching(false);
    }
  }, []);

  // Debounced server search
  useEffect(() => {
    const term = allPaymentsSearchTerm.trim().toLowerCase();
    if (!term || term.length < 2) {
      setServerSearchIds(null);
      return;
    }
    const timer = setTimeout(() => performServerSearch(term), 300);
    return () => clearTimeout(timer);
  }, [allPaymentsSearchTerm, performServerSearch]);

  // Filter for unassigned payments (simple table)
  const filteredUnassignedPayments = unassignedPayments?.filter(payment => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase().trim();
    
    return (
      payment.iban?.toLowerCase().includes(search) ||
      payment.empfaengername?.toLowerCase().includes(search) ||
      payment.verwendungszweck?.toLowerCase().includes(search) ||
      payment.kategorie?.toLowerCase().includes(search) ||
      payment.zugeordneter_monat?.toLowerCase().includes(search) ||
      payment.betrag?.toString().includes(search) ||
      format(new Date(payment.buchungsdatum), 'dd.MM.yyyy').includes(search)
    );
  });

  // Filtering and sorting for all payments
  const uniqueKategorien = useMemo(
    () => allPayments
      ? Array.from(new Set(allPayments.map(z => z.kategorie || 'Keine Kategorie'))).sort()
      : [],
    [allPayments]
  );

  const filteredAllPayments = useMemo(() => {
    if (!allPayments) return [];
    
    return allPayments.filter((zahlung) => {
      // Search filter
      if (allPaymentsSearchTerm) {
        const search = allPaymentsSearchTerm.toLowerCase().trim();
        
        // If server search has completed, use ONLY server results for tenant/property matching
        // This prevents partial string matches on unrelated fields from polluting results
        if (serverSearchIds !== null) {
          // Server search done: match if server found this payment OR if direct payment fields match exactly
          const serverMatch = serverSearchIds.has(zahlung.id);
          const directFieldMatch = (
            zahlung.verwendungszweck?.toLowerCase().includes(search) ||
            zahlung.empfaengername?.toLowerCase().includes(search) ||
            zahlung.iban?.toLowerCase().includes(search) ||
            zahlung.kategorie?.toLowerCase().includes(search) ||
            zahlung.immobilie_name?.toLowerCase().includes(search) ||
            zahlung.immobilie_adresse?.toLowerCase().includes(search)
          );
          const betragMatch = zahlung.betrag?.toString().includes(search);
          const dateMatch = zahlung.buchungsdatum_formatted.includes(search);

          if (!serverMatch && !directFieldMatch && !betragMatch && !dateMatch) return false;
        } else {
          // Server search not yet done or term too short: use local fields only
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
          const betragMatch = zahlung.betrag?.toString().includes(search);
          const dateMatch = zahlung.buchungsdatum_formatted.includes(search);

          if (!textMatch && !betragMatch && !dateMatch) return false;
        }
      }
      
      if (selectedKategorie) {
        const zahlungKategorie = zahlung.kategorie || 'Keine Kategorie';
        if (zahlungKategorie !== selectedKategorie) return false;
      }

      if (showOnlyZugeordnet && !zahlung.mietvertrag_id && !zahlung.immobilie_id) return false;
      if (showOnlyNichtZugeordnet && (zahlung.mietvertrag_id || zahlung.immobilie_id)) return false;

      if (!dateRange.from && !dateRange.to) return true;

      // ISO "yyyy-MM-dd" lokal konstruieren (new Date("yyyy-MM-dd") parst als UTC → Timezone-Bug)
      const [zy, zm, zd] = zahlung.buchungsdatum.split('-').map(Number);
      const zahlungTime = new Date(zy, zm - 1, zd).getTime();

      if (dateRange.from && dateRange.to) {
        const df = dateRange.from;
        const dt = dateRange.to;
        const fromTime = new Date(df.getFullYear(), df.getMonth(), df.getDate()).getTime();
        const toTime = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
        return zahlungTime >= fromTime && zahlungTime <= toTime;
      }

      if (dateRange.from) {
        const df = dateRange.from;
        const fromTime = new Date(df.getFullYear(), df.getMonth(), df.getDate()).getTime();
        return zahlungTime >= fromTime;
      }

      if (dateRange.to) {
        const dt = dateRange.to;
        const toTime = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).getTime();
        return zahlungTime <= toTime;
      }

      return true;
    });
  }, [allPayments, allPaymentsSearchTerm, selectedKategorie, showOnlyZugeordnet, showOnlyNichtZugeordnet, dateRange, serverSearchIds]);

  const sortedAllPayments = useMemo(() => {
    return [...filteredAllPayments].sort((a, b) => {
      switch (sortBy) {
        case 'datum-desc':
          return b.buchungsdatum.localeCompare(a.buchungsdatum);
        case 'datum-asc':
          return a.buchungsdatum.localeCompare(b.buchungsdatum);
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
    });
  }, [filteredAllPayments, sortBy]);

  // Group payments by year and month for better overview
  const paymentsByYearMonth = useMemo(() => {
    const yearGroups: { [year: string]: { months: { monthKey: string; label: string; payments: ZahlungWithDetails[]; total: number }[] } } = {};
    
    sortedAllPayments.forEach((zahlung) => {
      // ISO "yyyy-MM-dd" direkt aufsplitten — kein Date-Objekt nötig
      const [year, monthNum] = zahlung.buchungsdatum.split('-');
      const monthKey = `${year}-${monthNum}`;
      const monthLabel = format(new Date(parseInt(year, 10), parseInt(monthNum, 10) - 1, 1), 'MMMM', { locale: de });
      
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
  }, [sortedAllPayments, sortBy]);

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

  // Alle Monate beim ersten Laden einklappen (nur einmalig)
  const collapsedInitializedRef = useRef(false);
  const allMonthKeysString = useMemo(
    () => paymentsByYearMonth.flatMap(y => y.months.map(m => m.monthKey)).join(','),
    [paymentsByYearMonth]
  );
  useEffect(() => {
    if (!collapsedInitializedRef.current && allMonthKeysString) {
      collapsedInitializedRef.current = true;
      setCollapsedMonths(new Set(allMonthKeysString.split(',').filter(Boolean)));
    }
  }, [allMonthKeysString]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  const allPaymentsById = useMemo(
    () => new Map(allPayments?.map(z => [z.id, z])),
    [allPayments]
  );
  const selectedZahlung = selectedZahlungId ? allPaymentsById.get(selectedZahlungId) : undefined;

  const formatBetrag = useCallback((betrag: number) => EUR_FORMATTER.format(betrag), []);

  const formatDatum = useCallback((datum: string) => {
    const [y, m, d] = datum.split('-');
    return d && m && y ? `${d}.${m}.${y}` : datum;
  }, []);

  const getEinheitNr = (einheitId: string | null) => {
    if (!einheitId) return 'N/A';
    return einheitId.slice(-2);
  };

  const getDateRangeDuration = () => {
    if (!dateRange.from || !dateRange.to) return null;
    const diffTime = Math.abs(dateRange.to.getTime() - dateRange.from.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        toast({ title: "Ungültiger Dateityp", description: "Bitte laden Sie eine CSV-Datei hoch.", variant: "destructive" });
        return;
      }
      setCsvFile(file);
    }
  };

  const parseCsvToPayments = async (file: File): Promise<any[]> => {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(';').map(h => h.trim().replace(/"/g, ''));
    const payments: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';').map(v => v.trim().replace(/"/g, ''));
      if (values.length < headers.length) continue;
      
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      
      const buchungsdatumRaw = row["Buchungstag"] || row["Buchungsdatum"] || row["Datum"];
      const wertstellungsdatumRaw = row["Wertstellung"] || row["Wertstellungstag"] || row["Valuta"] || row["Valutadatum"];
      const betrag = row["Betrag"] || row["Umsatz"];
      const iban = row["Kontonummer/IBAN"] || row["IBAN des Absenders"] || row["IBAN"] || row["Auftraggeber-Konto"] || row["Auftragskonto"];
      const verwendungszweck = row["Verwendungszweck"] || row["Buchungstext"];
      const empfaengername = row["Empfaenger"] || row["Beguenstigter/Zahlungspflichtiger"] || row["Name"] || row["Empfänger"] || row["Begünstigter/Zahlungspflichtiger"] || row["Auftraggeber/Begünstigter"] || row["Beguenstigter"] || row["Begünstigter"] || row["AbweichenderEmpfaenger"] || row["Absender"] || row["Auftraggeber"] || row["Zahlungspflichtiger"] || row["Name des Absenders"] || row["Absender/Empfänger"];

      if (!buchungsdatumRaw || !betrag) continue;

      const toIsoDate = (d: string) => {
        if (!d) return d;
        if (d.includes('.')) {
          const [day, month, year] = d.split('.');
          return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return d;
      };

      const buchungsdatum = toIsoDate(buchungsdatumRaw);
      const wertstellungsdatum = wertstellungsdatumRaw ? toIsoDate(wertstellungsdatumRaw) : undefined;
      const betragNum = parseAmountRobust(betrag);

      payments.push({ buchungsdatum, wertstellungsdatum, betrag: betragNum, iban, verwendungszweck, empfaengername });
    }
    return payments;
  };

  const enrichResults = async (results: ProcessedPayment[]): Promise<ProcessedPayment[]> => {
    const contractIds = results.filter(r => r.mietvertrag_id).map(r => r.mietvertrag_id as string);
    if (contractIds.length === 0) return results;
    
    const { data: contracts } = await supabase
      .from('mietvertrag')
      .select(`id, einheiten!inner (etage, immobilien!inner (name)), mietvertrag_mieter (mieter (vorname, nachname))`)
      .in('id', contractIds);
    
    const contractMap = new Map();
    contracts?.forEach((c: any) => {
      const mieterNames = c.mietvertrag_mieter?.map((mm: any) => 
        `${mm.mieter?.vorname || ''} ${mm.mieter?.nachname || ''}`.trim()
      ).filter(Boolean).join(', ');
      
      contractMap.set(c.id, {
        mieter_name: mieterNames || 'Unbekannt',
        immobilie_name: `${c.einheiten?.immobilien?.name || ''} ${c.einheiten?.etage || ''}`.trim()
      });
    });
    
    return results.map(r => ({
      ...r,
      mieter_name: r.mietvertrag_id ? contractMap.get(r.mietvertrag_id)?.mieter_name : undefined,
      immobilie_name: r.mietvertrag_id ? contractMap.get(r.mietvertrag_id)?.immobilie_name : undefined,
    }));
  };

  const handleProcessCsv = async () => {
    if (!csvFile) {
      toast({ title: "Keine Datei ausgewählt", description: "Bitte wählen Sie eine CSV-Datei aus.", variant: "destructive" });
      return;
    }

    if (isUploading) {
      toast({ title: "Verarbeitung läuft bereits", description: "Bitte warten Sie, bis die aktuelle Verarbeitung abgeschlossen ist.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    
    try {
      const payments = await parseCsvToPayments(csvFile);
      
      if (payments.length === 0) {
        throw new Error("Keine gültigen Zahlungen in der CSV gefunden");
      }
      
      // Single toast for loading state
      const loadingToastId = toast({ 
        title: "CSV wird verarbeitet...", 
        description: `${payments.length} Zahlungen werden analysiert.`,
        duration: 60000 // Keep visible during processing
      });
      
      const { data: result, error } = await supabase.functions.invoke('process-payments', {
        body: { payments, dryRun: true }
      });
      
      if (error) throw error;
      
      if (!result.success) {
        throw new Error(result.error || "AI-Verarbeitung fehlgeschlagen");
      }
      
      const enrichedResults = await enrichResults(result.results);
      
      setAiResults(enrichedResults);
      setAiDuplicates(result.duplicates || []);
      setAiStats(result.stats);
      setResultsModalOpen(true);
      
      // Success toast replaces loading toast
      toast({ 
        title: "✓ CSV erfolgreich verarbeitet", 
        description: `${result.stats.neue} neue Zahlungen, ${result.stats.zugeordnet} zugeordnet.`,
        duration: 4000
      });
      
    } catch (error: any) {
      toast({ title: "Fehler bei der Verarbeitung", description: error.message || "Die CSV-Datei konnte nicht verarbeitet werden.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleApplyAssignments = async (selectedResults?: any[]) => {
    // Selected results now include all categories the user chose (Miete, Mietkaution, Rücklastschrift, etc.)
    const selectedToApply = selectedResults || aiResults.filter(r => r.kategorie !== "Nichtmiete");
    const selectedIds = new Set(selectedToApply.map((r: any) => `${r.buchungsdatum}_${r.betrag}_${r.iban || ''}_${(r.verwendungszweck || '').slice(0, 50)}`));
    
    // Nichtmiete payments are always saved (not shown in modal selection)
    const nichtmieteResults = aiResults.filter(r => r.kategorie === "Nichtmiete");
    
    // Unselected non-Nichtmiete payments should ALSO be saved, but without mietvertrag_id
    const unselected = aiResults
      .filter(r => r.kategorie !== "Nichtmiete" && !selectedIds.has(`${r.buchungsdatum}_${r.betrag}_${r.iban || ''}_${(r.verwendungszweck || '').slice(0, 50)}`))
      .map(r => ({ ...r, mietvertrag_id: null }));
    
    // Combine ALL: selected (with assignment) + unselected (without) + Nichtmiete
    const allResultsToSave = [...selectedToApply, ...unselected, ...nichtmieteResults];
    
    // Insert/update all payments
    for (const result of allResultsToSave) {
      // First, check if this payment already exists
      // Use buchungsdatum + betrag + iban + verwendungszweck for reliable matching
      const ibanValue = result.iban?.trim() || null;
      const vzValue = result.verwendungszweck?.trim() || null;
      
      let query = supabase
        .from('zahlungen')
        .select('id, kategorie, mietvertrag_id')
        .eq('buchungsdatum', result.buchungsdatum)
        .eq('betrag', result.betrag);
      
      if (ibanValue) {
        query = query.eq('iban', ibanValue);
      } else {
        query = query.is('iban', null);
      }
      
      if (vzValue) {
        query = query.eq('verwendungszweck', vzValue);
      } else {
        query = query.is('verwendungszweck', null);
      }
      
      const { data: existingRows } = await query.limit(1);
      const existing = existingRows?.[0] || null;
      
      if (existing) {
        // Payment exists - only update if not already manually categorized
        // Don't overwrite manually set categories like "Nebenkosten" unless user explicitly corrected
        const isManuallySet = existing.kategorie === 'Nebenkosten' && result.kategorie !== 'Nebenkosten';
        const hasExistingAssignment = existing.mietvertrag_id && !result.mietvertrag_id;
        
        if (isManuallySet || hasExistingAssignment) {
          continue;
        }
        
        // Build update payload - NEVER overwrite zugeordneter_monat (let DB trigger handle it)
        const updatePayload: Record<string, any> = {
          mietvertrag_id: result.mietvertrag_id,
          kategorie: result.kategorie as any,
          immobilie_id: result.immobilie_id || null,
        };
        
        const { error } = await supabase
          .from('zahlungen')
          .update(updatePayload)
          .eq('id', existing.id);
        
        
        // Auto-fill IBAN on contract if empty
        if (result.mietvertrag_id && result.iban) {
          const { data: contract } = await supabase
            .from('mietvertrag')
            .select('bankkonto_mieter')
            .eq('id', result.mietvertrag_id)
            .maybeSingle();

          if (contract && !contract.bankkonto_mieter) {
            await supabase
              .from('mietvertrag')
              .update({ bankkonto_mieter: result.iban })
              .eq('id', result.mietvertrag_id);
          }
        }
      } else {
        // Payment doesn't exist - insert it
        // zugeordneter_monat is NOT set here - the DB trigger set_zugeordneter_monat_trigger handles it automatically
        const { error } = await supabase
          .from('zahlungen')
          .insert({
            buchungsdatum: result.buchungsdatum,
            betrag: result.betrag,
            iban: ibanValue,
            verwendungszweck: vzValue,
            empfaengername: result.empfaengername?.trim() || null,
            mietvertrag_id: result.mietvertrag_id || null,
            immobilie_id: result.immobilie_id || null,
            kategorie: result.kategorie as any || null,
          });
        
        
        // Auto-fill IBAN on contract if empty
        if (result.mietvertrag_id && result.iban) {
          const { data: contract } = await supabase
            .from('mietvertrag')
            .select('bankkonto_mieter')
            .eq('id', result.mietvertrag_id)
            .maybeSingle();

          if (contract && !contract.bankkonto_mieter) {
            await supabase
              .from('mietvertrag')
              .update({ bankkonto_mieter: result.iban })
              .eq('id', result.mietvertrag_id);
          }
        }
      }
    }
    
    if (csvFile) {
      const buchungsdaten = allResultsToSave
        .map(r => r.buchungsdatum)
        .filter(Boolean)
        .sort();
      await supabase.from('csv_uploads').insert({
        dateiname: csvFile.name,
        dateigroe_bytes: csvFile.size,
        anzahl_datensaetze: allResultsToSave.length,
        status: 'verarbeitet',
        zeitraum_von: buchungsdaten[0] ?? null,
        zeitraum_bis: buchungsdaten.at(-1) ?? null,
      });
    }

    setCsvFile(null);
    setAiResults([]);
    setAiDuplicates([]);
    setAiStats(null);

    // Refresh queries
    queryClient.invalidateQueries({ queryKey: ['csv-upload-history'] });
    queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
    queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
    queryClient.invalidateQueries({ queryKey: ['zahlungen'] });
    queryClient.invalidateQueries({ queryKey: ['unzugeordnete-nebenkosten'] });
    queryClient.invalidateQueries({ queryKey: ['zugeordnete-nebenkosten'] });
    queryClient.invalidateQueries({ queryKey: ['nebenkosten-klassifizierungen-cached'] });
  };

  const handleAssignPayment = (payment: any) => {
    setSelectedPayment(payment);
    setAssignDialogOpen(true);
  };

  const handleAssignFromDetails = () => {
    if (selectedZahlung) {
      setSelectedPayment({
        id: selectedZahlung.id,
        betrag: selectedZahlung.betrag,
        buchungsdatum: selectedZahlung.buchungsdatum,
        empfaengername: selectedZahlung.empfaengername || undefined,
        iban: selectedZahlung.iban || undefined,
        verwendungszweck: selectedZahlung.verwendungszweck || undefined,
        kategorie: selectedZahlung.kategorie || undefined,
      });
      setAssignDialogOpen(true);
    }
  };

  return (
    <div className="min-h-screen modern-dashboard-bg relative z-0">
      <div className="container mx-auto px-4 py-4 sm:p-8 relative z-10">
        {/* Header */}
        <div className="mb-6">
          <Button variant="outline" onClick={onBack} className="mb-4 bg-white/50 hover:bg-white/70">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zurück zum Dashboard
          </Button>

          <div className="glass-card p-6 rounded-2xl">
            <h1 className="text-3xl font-sans font-bold text-gradient-red mb-2">
              Zahlungsverwaltung
            </h1>
            <p className="text-gray-600 font-sans">
              CSV-Upload, Zuordnung und Übersicht aller Zahlungen
            </p>
          </div>
        </div>

        <ZahlungsAnomalienBanner />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-white/80">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">CSV-Upload</span>
              <span className="sm:hidden">Upload</span>
            </TabsTrigger>
            <TabsTrigger value="alle" className="flex items-center gap-2">
              <Euro className="h-4 w-4" />
              <span className="hidden sm:inline">Alle Zahlungen</span>
              <span className="sm:hidden">Alle</span>
              {allPayments && <Badge variant="secondary" className="ml-1 hidden sm:inline-flex">{allPayments.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="unzugeordnet" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">Nicht zugeordnet</span>
              <span className="sm:hidden">N. zugeordnet</span>
              {unassignedPayments && unassignedPayments.length > 0 && (
                <Badge variant="destructive" className="ml-1">{unassignedPayments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="nebenkosten" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Nebenkosten</span>
              <span className="sm:hidden">NK</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: CSV Upload */}
          <TabsContent value="upload">
            <Card className="p-6 bg-white">
              <div className="flex items-center gap-3 mb-4">
                <Upload className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">CSV-Upload</h2>
              </div>

              <div className="space-y-4">
                {uploadHistory && uploadHistory.length > 0 && (
                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full group">
                      <FileText className="h-4 w-4" />
                      <span>Upload-Historie</span>
                      <ChevronDown className="h-3.5 w-3.5 ml-auto group-data-[state=open]:rotate-180 transition-transform" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                              <TableHead className="text-xs py-2">Datei</TableHead>
                              <TableHead className="text-xs py-2">Zeitraum</TableHead>
                              <TableHead className="text-xs py-2 text-right">Anz.</TableHead>
                              <TableHead className="text-xs py-2 text-right">Hochgeladen</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {uploadHistory.map((upload, idx) => (
                              <TableRow
                                key={upload.id}
                                className={`text-xs ${idx === 0 ? 'cursor-pointer hover:bg-primary/5' : ''}`}
                                onClick={idx === 0 ? () => setLastUploadReviewOpen(true) : undefined}
                                title={idx === 0 ? 'Klicken um Zuordnungsergebnisse des letzten Uploads anzuzeigen' : undefined}
                              >
                                <TableCell className="py-2 font-medium max-w-[160px] truncate" title={upload.dateiname}>
                                  {idx === 0 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 mb-0.5" />}
                                  {upload.dateiname}
                                </TableCell>
                                <TableCell className="py-2 text-muted-foreground">
                                  {upload.zeitraum_von && upload.zeitraum_bis
                                    ? `${format(new Date(upload.zeitraum_von), 'dd.MM.yy')} – ${format(new Date(upload.zeitraum_bis), 'dd.MM.yy')}`
                                    : upload.zeitraum_von
                                      ? format(new Date(upload.zeitraum_von), 'dd.MM.yy')
                                      : '–'}
                                </TableCell>
                                <TableCell className="py-2 text-right text-muted-foreground">
                                  {upload.anzahl_datensaetze ?? '–'}
                                </TableCell>
                                <TableCell className="py-2 text-right text-muted-foreground">
                                  {upload.hochgeladen_am
                                    ? format(new Date(upload.hochgeladen_am), 'dd.MM.yy HH:mm')
                                    : '–'}
                                  {idx === 0 && (
                                    <span className="ml-1.5 text-primary font-medium">→</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                <div>
                  <Label htmlFor="csv-file">Bankbewegungen (CSV)</Label>
                  <Input
                    id="csv-file"
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    disabled={isUploading}
                    className="mt-2 cursor-pointer file:cursor-pointer"
                  />
                  {csvFile && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Ausgewählt: {csvFile.name} ({(csvFile.size / 1024).toFixed(2)} KB)
                    </p>
                  )}
                </div>

                <Button onClick={handleProcessCsv} disabled={!csvFile || isUploading} className="w-full">
                  {isUploading ? (
                    <>
                      <Bot className="mr-2 h-4 w-4 animate-pulse" />
                      AI analysiert Zahlungen...
                    </>
                  ) : (
                    <>
                      <Bot className="mr-2 h-4 w-4" />
                      Mit AI zuordnen
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </TabsContent>

          {/* Tab 2: Alle Zahlungen */}
          <TabsContent value="alle">
            <div className={cn(isFullscreen && "fixed inset-0 z-[100] bg-background flex flex-col")}>
              {isFullscreen && (
                <div className="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Euro className="h-5 w-5 text-green-600" />
                    <span className="font-semibold text-lg">Alle Zahlungen</span>
                    {allPayments && <Badge variant="secondary">{allPayments.length}</Badge>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)} className="gap-1.5">
                    <Minimize2 className="h-4 w-4" />
                    Verkleinern
                  </Button>
                </div>
              )}
              <div className={cn("grid grid-cols-1 xl:grid-cols-2 gap-6", isFullscreen && "flex-1 p-4 overflow-hidden")}>
              {/* Left: Zahlungsliste */}
              <Card className={cn("flex flex-col overflow-hidden", isFullscreen ? "h-full" : "h-[calc(100vh-280px)] min-h-[400px]")}>
                <CardHeader className="pb-3 shrink-0">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Euro className="h-5 w-5 text-green-600" />
                          Zahlungen
                        </CardTitle>
                        <p className="text-sm text-gray-600">
                          {sortedAllPayments?.length || 0} von {allPayments?.length || 0} Zahlungen
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                          <SelectTrigger className="bg-white w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white z-50">
                            <SelectItem value="datum-desc">Datum ↓</SelectItem>
                            <SelectItem value="datum-asc">Datum ↑</SelectItem>
                            <SelectItem value="betrag-desc">Betrag ↓</SelectItem>
                            <SelectItem value="betrag-asc">Betrag ↑</SelectItem>
                            <SelectItem value="status">Zuordnung</SelectItem>
                            <SelectItem value="kategorie">Kategorie</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant={filtersCollapsed ? "secondary" : "ghost"}
                          size="icon"
                          className="shrink-0 h-8 w-8"
                          onClick={() => setFiltersCollapsed(v => !v)}
                          title={filtersCollapsed ? "Filter einblenden" : "Filter ausblenden"}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="shrink-0 h-9 w-9"
                          onClick={() => setIsFullscreen(v => !v)}
                          title={isFullscreen ? "Vollansicht beenden" : "Vollansicht öffnen"}
                        >
                          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    {!filtersCollapsed && (
                      <>
                        {/* Search */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Suchen (Name, IBAN, Verwendungszweck, Betrag...)"
                            value={allPaymentsSearchTerm}
                            onChange={(e) => setAllPaymentsSearchTerm(e.target.value)}
                            className="pl-9 bg-white w-full"
                          />
                          {isServerSearching && (
                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                              <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                            </div>
                          )}
                        </div>

                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={selectedKategorie || 'alle'} onValueChange={(v) => setSelectedKategorie(v === 'alle' ? null : v)}>
                            <SelectTrigger className="bg-white w-40">
                              <SelectValue placeholder="Kategorie" />
                            </SelectTrigger>
                            <SelectContent className="bg-white z-50">
                              <SelectItem value="alle">Alle Kategorien</SelectItem>
                              <SelectItem value="Miete">Miete</SelectItem>
                              <SelectItem value="Nebenkosten">Nebenkosten</SelectItem>
                              <SelectItem value="Nichtmiete">Nichtmiete</SelectItem>
                              <SelectItem value="Mietkaution">Mietkaution</SelectItem>
                              <SelectItem value="Rücklastschrift">Rücklastschrift</SelectItem>
                              <SelectItem value="Ignorieren">Ignorieren</SelectItem>
                            </SelectContent>
                          </Select>

                          <div className="flex items-center gap-2">
                            <Checkbox id="zugeordnet" checked={showOnlyZugeordnet} onCheckedChange={(c) => { setShowOnlyZugeordnet(!!c); if (c) setShowOnlyNichtZugeordnet(false); }} />
                            <label htmlFor="zugeordnet" className="text-xs cursor-pointer">Zugeordnet</label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox id="nicht-zugeordnet" checked={showOnlyNichtZugeordnet} onCheckedChange={(c) => { setShowOnlyNichtZugeordnet(!!c); if (c) setShowOnlyZugeordnet(false); }} />
                            <label htmlFor="nicht-zugeordnet" className="text-xs cursor-pointer">Nicht zugeordnet</label>
                          </div>

                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className={cn("text-xs", dateRange.from && "bg-blue-50")}>
                                <Calendar className="h-3 w-3 mr-1" />
                                {dateRange.from && dateRange.to
                                  ? `${format(dateRange.from, "dd.MM", { locale: de })} – ${format(dateRange.to, "dd.MM", { locale: de })}`
                                  : "Zeitraum"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-white" align="start">
                              <CalendarComponent
                                mode="range"
                                selected={{ from: dateRange.from, to: dateRange.to }}
                                onSelect={(range: any) => setDateRange({ from: range?.from, to: range?.to })}
                                numberOfMonths={2}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          {(dateRange.from || selectedKategorie || showOnlyZugeordnet || showOnlyNichtZugeordnet || allPaymentsSearchTerm) && (
                            <Button variant="ghost" size="sm" title="Alle Filter zurücksetzen" onClick={() => {
                              setDateRange({ from: undefined, to: undefined });
                              setSelectedKategorie(null);
                              setShowOnlyZugeordnet(false);
                              setShowOnlyNichtZugeordnet(false);
                              setAllPaymentsSearchTerm('');
                            }}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden">
                  {allPaymentsLoading ? (
                    <div className="text-center py-12"><p className="text-muted-foreground">Lade Zahlungen...</p></div>
                  ) : allPaymentsError ? (
                    <div className="text-center py-12">
                      <AlertTriangle className="h-10 w-10 text-destructive/40 mx-auto mb-3" />
                      <p className="text-destructive font-medium">Zahlungen konnten nicht geladen werden</p>
                      <p className="text-sm text-muted-foreground mt-1">Bitte Seite neu laden oder Verbindung prüfen.</p>
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
                                      </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="space-y-2 pt-2 pl-6">
                                        {monthGroup.payments.map((zahlung) => {
                                          return (
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
                                            <CardContent className="p-3">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs text-muted-foreground">{formatDatum(zahlung.buchungsdatum)}</span>
                                                  </div>
                                                  <p className="text-sm font-medium truncate">
                                                    {zahlung.empfaengername
                                                      ? `${zahlung.betrag < 0 ? 'An' : 'Von'}: ${zahlung.empfaengername}`
                                                      : <span className="text-muted-foreground italic">Kein Empfänger/Absender</span>
                                                    }
                                                  </p>
                                                  <p className={cn(
                                                    "text-lg font-bold",
                                                    zahlung.betrag < 0 ? 'text-destructive' : 'text-green-600'
                                                  )}>
                                                    {formatBetrag(zahlung.betrag)}
                                                  </p>
                                                  {zahlung.verwendungszweck && (
                                                    <p className="text-xs text-muted-foreground truncate mt-1">{zahlung.verwendungszweck}</p>
                                                  )}
                                                </div>
                                                <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                                                  <PaymentKategorieEditor
                                                    paymentId={zahlung.id}
                                                    currentKategorie={zahlung.kategorie}
                                                    currentImmobilieId={zahlung.immobilie_id}
                                                    compact
                                                  />
                                                  {(zahlung.mietvertrag_id || zahlung.immobilie_id) && (
                                                    <Badge className="bg-green-600 text-xs">✓ Zugeordnet</Badge>
                                                  )}
                                                </div>
                                              </div>
                                            </CardContent>
                                          </Card>
                                          );
                                        })}
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

              {/* Right: Details */}
              <Card className={cn("flex flex-col overflow-hidden", isFullscreen ? "h-full" : "h-[calc(100vh-280px)]")}>
                <CardHeader className="pb-3 shrink-0">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    Details & Zuordnung
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  {selectedZahlung ? (
                    <ScrollArea className="h-full">
                      <div className="space-y-6">
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-3">Zahlungsdetails</h3>
                          <div className="space-y-3 bg-gray-50 rounded-lg p-4">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Buchungsdatum:</span>
                              <span className="text-sm font-medium">{formatDatum(selectedZahlung.buchungsdatum)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Betrag:</span>
                              <span className={`text-sm font-bold ${selectedZahlung.betrag < 0 ? 'text-destructive' : 'text-green-600'}`}>
                                {formatBetrag(selectedZahlung.betrag)}
                              </span>
                            </div>
                            {selectedZahlung.zugeordneter_monat && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Monat:</span>
                                <span className="text-sm font-medium">{(() => {
                                  const raw = (selectedZahlung.zugeordneter_monat || '').slice(0, 7);
                                  if (!raw || raw.length < 7) return selectedZahlung.zugeordneter_monat;
                                  const [y, m] = raw.split('-');
                                  return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('de-DE', { year: 'numeric', month: 'long' });
                                })()}</span>
                              </div>
                            )}
                            {selectedZahlung.kategorie && (
                              <div className="flex justify-between items-start">
                                <span className="text-sm text-gray-600">Kategorie:</span>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <PaymentKategorieEditor
                                    paymentId={selectedZahlung.id}
                                    currentKategorie={selectedZahlung.kategorie}
                                    currentImmobilieId={selectedZahlung.immobilie_id}
                                    compact
                                  />
                                </div>
                              </div>
                            )}
                            {selectedZahlung.empfaengername && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Empfänger:</span>
                                <span className="text-sm font-medium">{selectedZahlung.empfaengername}</span>
                              </div>
                            )}
                            {selectedZahlung.iban && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">IBAN:</span>
                                <span className="text-xs font-mono">{selectedZahlung.iban}</span>
                              </div>
                            )}
                            {selectedZahlung.verwendungszweck && (
                              <div>
                                <span className="text-sm text-gray-600 block mb-1">Verwendungszweck:</span>
                                <p className="text-sm font-medium bg-white p-2 rounded border">{selectedZahlung.verwendungszweck}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        <Separator />

                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-gray-900">Zuordnung</h3>
                            <Button onClick={handleAssignFromDetails} size="sm" variant="outline" className="gap-2">
                              <Edit2 className="h-4 w-4" />
                              {selectedZahlung.mietvertrag_id || selectedZahlung.immobilie_id ? 'Ändern' : 'Zuordnen'}
                            </Button>
                          </div>

                          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                            {selectedZahlung.mietvertrag_id ? (
                              <div className="space-y-3">
                                <Badge variant="secondary" className="text-xs">Mietvertrag</Badge>
                                <div className="flex items-start gap-3">
                                  <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                                  <div>
                                    <p className="font-semibold">{selectedZahlung.immobilie_name}</p>
                                    <p className="text-sm text-gray-600">{selectedZahlung.immobilie_adresse}</p>
                                  </div>
                                </div>
                                {selectedZahlung.einheit_typ && (
                                  <div className="flex items-center gap-3">
                                    <Home className="h-5 w-5 text-blue-600" />
                                    <p className="font-medium">{selectedZahlung.einheit_typ} - {getEinheitNr(selectedZahlung.einheit_id)}</p>
                                  </div>
                                )}
                                {selectedZahlung.mieter_name && (
                                  <div className="flex items-center gap-3">
                                    <User className="h-5 w-5 text-blue-600" />
                                    <p className="font-medium">{selectedZahlung.mieter_name}</p>
                                  </div>
                                )}
                              </div>
                            ) : selectedZahlung.immobilie_id ? (
                              <div className="space-y-3">
                                <Badge variant="secondary" className="text-xs">Immobilie</Badge>
                                <div className="flex items-start gap-3">
                                  <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
                                  <div>
                                    <p className="font-semibold">{selectedZahlung.immobilie_name}</p>
                                    <p className="text-sm text-gray-600">{selectedZahlung.immobilie_adresse}</p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4">
                                <Home className="h-12 w-12 text-orange-300 mx-auto mb-2" />
                                <p className="text-orange-700 font-medium mb-1">Nicht zugeordnet</p>
                                <p className="text-sm text-orange-600">Klicken Sie auf "Zuordnen" um diese Zahlung zuzuweisen</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="text-center py-12">
                      <Building2 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-600 font-medium mb-1">Keine Zahlung ausgewählt</p>
                      <p className="text-sm text-gray-500">Wählen Sie eine Zahlung aus der Liste</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </div>
          </TabsContent>

          {/* Tab 3: Nicht zugeordnete Mietzahlungen */}
          <TabsContent value="unzugeordnet">
            <Card className="p-4 sm:p-6 bg-white">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
                  <h2 className="text-base sm:text-xl font-semibold truncate">
                    Nicht zugeordnete Mietzahlungen
                    {unassignedPayments && (
                      <span className="ml-2 text-sm text-muted-foreground">({filteredUnassignedPayments?.length || 0})</span>
                    )}
                  </h2>
                </div>
                <div className="relative w-full sm:w-80 shrink-0">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Suchen..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Diese Zahlungen wurden als Miete, Mietkaution oder Rücklastschrift erkannt, konnten aber keinem Mietvertrag zugeordnet werden.
              </p>

              <ScrollArea className="h-[500px]">
                {unassignedLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Lade Zahlungen...</div>
                ) : filteredUnassignedPayments?.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <AlertTriangle className="h-12 w-12 text-green-300 mx-auto mb-3" />
                    <p className="text-green-700 font-medium">Alle Mietzahlungen sind zugeordnet!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Buchungsdatum</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Betrag</TableHead>
                          <TableHead className="hidden sm:table-cell">IBAN</TableHead>
                          <TableHead>Empfänger</TableHead>
                          <TableHead className="hidden md:table-cell">Verwendungszweck</TableHead>
                          <TableHead>Kategorie</TableHead>
                          <TableHead className="text-right">Aktion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUnassignedPayments?.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="whitespace-nowrap">{format(new Date(payment.buchungsdatum), 'dd.MM.yyyy')}</TableCell>
                            <TableCell className={`text-right font-semibold whitespace-nowrap ${payment.betrag < 0 ? 'text-destructive' : 'text-green-600'}`}>
                              {payment.betrag.toFixed(2)} €
                            </TableCell>
                            <TableCell className="font-mono text-xs hidden sm:table-cell">{payment.iban || '-'}</TableCell>
                            <TableCell className="max-w-[120px] truncate">{payment.empfaengername || '-'}</TableCell>
                            <TableCell className="max-w-xs truncate hidden md:table-cell">{payment.verwendungszweck || '-'}</TableCell>
                            <TableCell>
                              <PaymentKategorieEditor
                                paymentId={payment.id}
                                currentKategorie={payment.kategorie}
                                currentImmobilieId={payment.immobilie_id}
                                onUpdate={() => {
                                  queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
                                  queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
                                }}
                                compact
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => handleAssignPayment(payment)}>
                                Zuweisen
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </ScrollArea>
            </Card>
          </TabsContent>

          {/* Tab 4: Nebenkosten (Nichtmiete-Zahlungen) */}
          <TabsContent value="nebenkosten">
            <Card className="p-6 bg-white">
              <NebenkostenZuordnungTab />
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Assign Payment Dialog */}
      <AssignPaymentDialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) {
            queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
            queryClient.invalidateQueries({ queryKey: ['zahlungen-overview'] });
          }
        }}
        payment={selectedPayment}
      />

      {/* AI Assignment Results Modal */}
      {aiStats && (
        <PaymentAssignmentResultsModal
          open={resultsModalOpen}
          onOpenChange={setResultsModalOpen}
          results={aiResults}
          duplicates={aiDuplicates}
          stats={aiStats}
          onApply={handleApplyAssignments}
        />
      )}

      {/* Last Upload Review Modal */}
      {lastUpload && (
        <LastUploadReviewModal
          open={lastUploadReviewOpen}
          onOpenChange={setLastUploadReviewOpen}
          upload={lastUpload}
        />
      )}
    </div>
  );
}
