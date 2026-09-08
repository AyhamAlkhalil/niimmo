import { useCallback, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, Building2, Euro, FileText, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { AssignPaymentDialog } from "./AssignPaymentDialog";
import { PaymentAssignmentResultsModal } from "./PaymentAssignmentResultsModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { NebenkostenZuordnungTab } from "./NebenkostenZuordnungTab";
import { LastUploadReviewModal } from "./LastUploadReviewModal";
import { ZahlungsAnomalienBanner } from "./ZahlungsAnomalienBanner";
import { PaymentKategorieEditor } from "./PaymentKategorieEditor";
import { SprungZiel, ZahlungenArbeitsplatz } from "./ZahlungenArbeitsplatz";
import { ZahlungZeile, formatEuro, formatIsoDatum } from "@/utils/zahlungenAnsicht";
import { Zuordnungsvorschlag, vorschlagsSchluessel } from "@/utils/zuordnungsvorschlaege";
import {
  BestehendeIndex,
  BestehendeZahlung,
  bestehendeIndexieren,
  bestehendeVormerken,
  buchungstageVon,
  findeBestehende,
  normalisiereWert,
  vertragsIdsMitIban,
} from "@/utils/zahlungenUebernahme";

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

interface PaymentManagementProps {
  onBack: () => void;
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

/** Eine Zeile aus der CSV, so wie sie an process-payments geht. */
interface CsvZahlung {
  buchungsdatum: string;
  wertstellungsdatum?: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername: string;
}

/** Rohform der Zahlungsabfrage mit den eingebetteten Bezügen. */
interface ZahlungRoh {
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
  immobilien: { name: string | null; adresse: string | null } | null;
  mietvertrag: {
    einheiten: {
      id: string;
      einheitentyp: string | null;
      etage: string | null;
      immobilien: { name: string | null; adresse: string | null } | null;
    } | null;
    mietvertrag_mieter: Array<{ mieter: { vorname: string | null; nachname: string | null } | null }> | null;
  } | null;
}

/** Eine offene Mietzahlung im Reiter „Nicht zugeordnet" — nur die Felder, die dort gezeigt werden. */
interface ZahlungOffen {
  id: string;
  betrag: number;
  buchungsdatum: string;
  verwendungszweck: string | null;
  empfaengername: string | null;
  iban: string | null;
  zugeordneter_monat: string | null;
  kategorie: string | null;
  immobilie_id: string | null;
}

interface Seite<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Liest eine wachsende Tabelle seitenweise. PostgREST liefert still höchstens
 * 1000 Zeilen; ohne Schleife rechnet die Ansicht mit einem Bruchteil der Daten
 * (docs/architektur.md §4).
 *
 * Die erste Seite bringt die Gesamtzahl mit (`count: 'exact'`), alle weiteren
 * Seiten laufen gleichzeitig. Bis zum 07.09.2026 liefen die vier Seiten der
 * Übersicht nacheinander — jede wartete auf die vorige.
 */
async function alleSeiten<T>(seite: (von: number, bis: number, mitZaehlung: boolean) => PromiseLike<Seite<T>>): Promise<T[]> {
  const groesse = 1000;
  const erste = await seite(0, groesse - 1, true);
  if (erste.error) throw erste.error;
  const alle: T[] = [...(erste.data ?? [])];
  if (alle.length < groesse) return alle;

  const gesamt = typeof erste.count === 'number' ? erste.count : null;
  if (gesamt === null) {
    // Ohne Gesamtzahl bleibt nur der Reihe nach.
    for (let von = groesse; ; von += groesse) {
      const { data, error } = await seite(von, von + groesse - 1, false);
      if (error) throw error;
      if (!data || data.length === 0) break;
      alle.push(...data);
      if (data.length < groesse) break;
    }
    return alle;
  }

  const weitere: Promise<Seite<T>>[] = [];
  for (let von = groesse; von < gesamt; von += groesse) {
    weitere.push(Promise.resolve(seite(von, von + groesse - 1, false)));
  }
  for (const antwort of await Promise.all(weitere)) {
    if (antwort.error) throw antwort.error;
    alle.push(...(antwort.data ?? []));
  }
  return alle;
}

/**
 * Wie lange die Zahlungsdaten als frisch gelten. Mit dem Standard (0) lud jeder
 * Fensterwechsel alle 3505 Zahlungen samt Bezügen neu. Änderungen aus dieser
 * Anwendung invalidieren die Abfragen ausdrücklich; die Realtime-Publikation
 * enthält zahlungen nicht (Stand 07.09.2026), sodass nur diese Invalidierungen
 * und dieser Zeitraum die Aktualität für andere Nutzer bestimmen.
 */
const CACHE_ZEIT = 2 * 60 * 1000;

/** Was der Zuordnungsdialog über eine bestehende Zahlung wissen muss. */
interface ZuordnungsZahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  empfaengername?: string;
  iban?: string;
  verwendungszweck?: string;
  kategorie?: string;
}

export function PaymentManagement({ onBack }: PaymentManagementProps) {
  const [activeTab, setActiveTab] = useState("upload");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<ZuordnungsZahlung | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  // AI Assignment Results State
  const [aiResults, setAiResults] = useState<Zuordnungsvorschlag[]>([]);
  const [aiDuplicates, setAiDuplicates] = useState<DuplicatePayment[]>([]);
  const [aiStats, setAiStats] = useState<AIAssignmentStats | null>(null);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [lastUploadReviewOpen, setLastUploadReviewOpen] = useState(false);
  const [sprungZiel, setSprungZiel] = useState<SprungZiel | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

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
  const { data: unassignedPayments, isLoading: unassignedLoading, isError: unassignedError } = useQuery({
    queryKey: ['unassigned-payments'],
    staleTime: CACHE_ZEIT,
    queryFn: () =>
      alleSeiten<ZahlungOffen>((von, bis, mitZaehlung) =>
        supabase
          .from('zahlungen')
          .select('id, betrag, buchungsdatum, verwendungszweck, empfaengername, iban, zugeordneter_monat, kategorie, immobilie_id', {
            count: mitZaehlung ? 'exact' : undefined,
          })
          .is('mietvertrag_id', null)
          .in('kategorie', ['Miete', 'Mietkaution', 'Rücklastschrift', 'Betriebskostenabrechnung'])
          .order('buchungsdatum', { ascending: false })
          .range(von, bis)
      ),
  });

  // Alle Zahlungen mit Vertrags- und Objektbezug, seitenweise (PostgREST liefert still nur 1000 Zeilen).
  const { data: allPayments, isLoading: allPaymentsLoading, isError: allPaymentsError } = useQuery({
    queryKey: ['zahlungen-overview'],
    staleTime: CACHE_ZEIT,
    queryFn: async (): Promise<ZahlungZeile[]> => {
      const allData = await alleSeiten<ZahlungRoh>((von, bis, mitZaehlung) =>
        supabase
          .from('zahlungen')
          .select(
            `
            id, betrag, buchungsdatum, verwendungszweck, empfaengername, iban, zugeordneter_monat, kategorie, mietvertrag_id, immobilie_id,
            immobilien:immobilie_id (name, adresse),
            mietvertrag:mietvertrag_id (
              einheiten:einheit_id (id, einheitentyp, etage, immobilien:immobilie_id (name, adresse)),
              mietvertrag_mieter (mieter:mieter_id (vorname, nachname))
            )
          `,
            { count: mitZaehlung ? 'exact' : undefined }
          )
          .order('buchungsdatum', { ascending: false })
          .range(von, bis)
          .then((antwort) => ({ data: antwort.data as unknown as ZahlungRoh[] | null, error: antwort.error, count: antwort.count }))
      );

      return allData.map((zahlung): ZahlungZeile => {
        const directImmo = zahlung.immobilien;
        const mv = zahlung.mietvertrag;
        const einheit = mv?.einheiten;
        const mvImmo = einheit?.immobilien;
        const mieterName = mv?.mietvertrag_mieter
          ?.map((mm) => `${mm.mieter?.vorname || ''} ${mm.mieter?.nachname || ''}`.trim())
          .filter(Boolean).join(', ') || null;
        return {
          id: zahlung.id,
          betrag: zahlung.betrag,
          buchungsdatum: zahlung.buchungsdatum,
          buchungsdatum_formatted: formatIsoDatum(zahlung.buchungsdatum),
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
          einheit_etage: einheit?.etage || null,
          mieter_name: mieterName,
        };
      });
    },
  });

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
      formatIsoDatum(payment.buchungsdatum).includes(search)
    );
  });

  // Springt vom Zahlungs-Anomalien-Banner zur betroffenen Zahlung im Reiter "Alle Zahlungen".
  const handleNavigateToZahlung = useCallback((zahlungId: string, buchungsdatum: string | null) => {
    setActiveTab('alle');
    setSprungZiel({ zahlungId, buchungsdatum, nonce: Date.now() });
  }, []);

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

  const parseCsvToPayments = async (file: File): Promise<CsvZahlung[]> => {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length < 2) return [];

    const headers = lines[0].split(';').map(h => h.trim().replace(/"/g, ''));
    const payments: CsvZahlung[] = [];

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

  const enrichResults = async (results: Zuordnungsvorschlag[]): Promise<Zuordnungsvorschlag[]> => {
    const contractIds = results.filter(r => r.mietvertrag_id).map(r => r.mietvertrag_id as string);
    if (contractIds.length === 0) return results;

    const { data: contracts } = await supabase
      .from('mietvertrag')
      .select(`id, einheiten!inner (etage, immobilien!inner (name)), mietvertrag_mieter (mieter (vorname, nachname))`)
      .in('id', contractIds);

    const contractMap = new Map<string, { mieter_name: string; immobilie_name: string }>();
    contracts?.forEach((c) => {
      const mieterNames = c.mietvertrag_mieter?.map((mm) =>
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

      toast({
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

      toast({
        title: "CSV verarbeitet",
        description: `${result.stats.neue} neue Zahlungen, ${result.stats.zugeordnet} zugeordnet.`,
        duration: 4000
      });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Die CSV-Datei konnte nicht verarbeitet werden.";
      toast({ title: "Fehler bei der Verarbeitung", description: message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleApplyAssignments = async (selectedResults?: Zuordnungsvorschlag[]) => {
    // Selected results now include all categories the user chose (Miete, Mietkaution, Rücklastschrift, etc.)
    const selectedToApply = selectedResults || aiResults.filter(r => r.kategorie !== "Nichtmiete");

    // Der Schluessel ist inhaltsbasiert (Tag, Betrag, IBAN, 50 Zeichen Verwendungszweck).
    // Zwei Buchungen mit gleichem Schluessel im selben Import: Bis zum 07.09.2026 galt
    // die zweite als "gewaehlt", sobald die erste gewaehlt war, und fiel beim
    // Uebernehmen stillschweigend weg. Deshalb wird je Schluessel gezaehlt.
    const gewaehltJeSchluessel = new Map<string, number>();
    for (const r of selectedToApply) {
      const schluessel = vorschlagsSchluessel(r);
      gewaehltJeSchluessel.set(schluessel, (gewaehltJeSchluessel.get(schluessel) ?? 0) + 1);
    }

    // Nichtmiete payments are always saved (not shown in modal selection)
    const nichtmieteResults = aiResults.filter(r => r.kategorie === "Nichtmiete");

    // Unselected non-Nichtmiete payments should ALSO be saved, but without mietvertrag_id
    const unselected = aiResults
      .filter(r => {
        if (r.kategorie === "Nichtmiete") return false;
        const schluessel = vorschlagsSchluessel(r);
        const offen = gewaehltJeSchluessel.get(schluessel) ?? 0;
        if (offen > 0) {
          gewaehltJeSchluessel.set(schluessel, offen - 1);
          return false;
        }
        return true;
      })
      .map(r => ({ ...r, mietvertrag_id: null }));

    // Combine ALL: selected (with assignment) + unselected (without) + Nichtmiete
    const allResultsToSave = [...selectedToApply, ...unselected, ...nichtmieteResults];

    // Bis zum 06.09.2026 wurde `error` an drei Stellen destrukturiert und nie
    // gelesen. Scheiterte eine Zeile an RLS oder einem Constraint, lief die
    // Schleife weiter, das Protokoll meldete "verarbeitet" und die Oberflaeche
    // Erfolg -- die Zahlung fehlte dauerhaft, der Rueckstand des Mieters war zu
    // hoch, und die Ursache war nicht mehr auffindbar.
    const fehler: Array<{ zeile: string; grund: string }> = [];
    const bezeichne = (r: Zuordnungsvorschlag) =>
      `${r.buchungsdatum ?? '?'} · ${r.betrag ?? '?'} € · ${(r.verwendungszweck ?? '').slice(0, 40) || 'ohne Verwendungszweck'}`;

    // Insert/update all payments
    //
    // Vorabfragen statt Einzelabfragen je Zeile (07.09.2026): Bestehende Buchungen
    // der betroffenen Tage und die Bankverbindungen der betroffenen Vertraege werden
    // einmal geladen; der Abgleich je Zeile laeuft mit denselben Regeln im Speicher
    // (utils/zahlungenUebernahme.ts). Entscheidung je Zeile und Reihenfolge der
    // Schreibvorgaenge sind unveraendert. Gemessen waren es vorher 150 ms je Buchung
    // bei vier Datenbankrunden, davon zwei reine Nachfragen.
    let bestehende: BestehendeIndex = new Map();
    let vorabfrageOk = true;
    try {
      const tage = buchungstageVon(allResultsToSave);
      const zeilen =
        tage.length === 0
          ? []
          : await alleSeiten<BestehendeZahlung>((von, bis, mitZaehlung) =>
              supabase
                .from('zahlungen')
                .select('id, kategorie, mietvertrag_id, buchungsdatum, betrag, iban, verwendungszweck', { count: mitZaehlung ? 'exact' : undefined })
                .in('buchungsdatum', tage)
                .range(von, bis)
            );
      bestehende = bestehendeIndexieren(zeilen);
    } catch (e: unknown) {
      // Ohne belastbare Duplikatpruefung darf nicht geschrieben werden --
      // sonst entstehen Doppelbuchungen.
      vorabfrageOk = false;
      const grund = e instanceof Error ? e.message : String(e);
      for (const result of allResultsToSave) {
        fehler.push({ zeile: bezeichne(result), grund: `Duplikatprüfung fehlgeschlagen: ${grund}` });
      }
    }

    // Bankverbindungen der Vertraege, die eine bekommen koennten. Liefert die
    // Abfrage nichts, unterbleibt der Nachtrag -- wie frueher bei leerer Einzelabfrage.
    const bankkonten = new Map<string, string | null>();
    if (vorabfrageOk) {
      const vertragsIds = vertragsIdsMitIban(allResultsToSave);
      if (vertragsIds.length > 0) {
        const { data: vertraege } = await supabase.from('mietvertrag').select('id, bankkonto_mieter').in('id', vertragsIds);
        vertraege?.forEach((v) => bankkonten.set(v.id, v.bankkonto_mieter));
      }
    }

    // Auto-fill IBAN on contract if empty
    const ibanNachtragen = async (mietvertragId: string, iban: string) => {
      if (!bankkonten.has(mietvertragId) || bankkonten.get(mietvertragId)) return;
      const { error } = await supabase
        .from('mietvertrag')
        .update({ bankkonto_mieter: iban })
        .eq('id', mietvertragId);
      if (!error) bankkonten.set(mietvertragId, iban);
    };

    for (const result of vorabfrageOk ? allResultsToSave : []) {
      // First, check if this payment already exists
      // Use buchungsdatum + betrag + iban + verwendungszweck for reliable matching
      const ibanValue = normalisiereWert(result.iban);
      const vzValue = normalisiereWert(result.verwendungszweck);
      const existing = findeBestehende(bestehende, {
        buchungsdatum: result.buchungsdatum,
        betrag: result.betrag,
        iban: ibanValue,
        verwendungszweck: vzValue,
      });

      if (existing) {
        // Payment exists - only update if not already manually categorized
        // Don't overwrite manually set categories like "Nebenkosten" unless user explicitly corrected
        const isManuallySet = existing.kategorie === 'Nebenkosten' && result.kategorie !== 'Nebenkosten';
        const hasExistingAssignment = existing.mietvertrag_id && !result.mietvertrag_id;

        if (isManuallySet || hasExistingAssignment) {
          continue;
        }

        // Build update payload - NEVER overwrite zugeordneter_monat (let DB trigger handle it)
        const updatePayload = {
          mietvertrag_id: result.mietvertrag_id,
          kategorie: result.kategorie as never,
          immobilie_id: result.immobilie_id || null,
        };

        const { error } = await supabase
          .from('zahlungen')
          .update(updatePayload)
          .eq('id', existing.id);

        if (error) {
          fehler.push({ zeile: bezeichne(result), grund: `Aktualisieren fehlgeschlagen: ${error.message}` });
          continue;
        }

        // Der Index spiegelt den Stand der Datenbank fuer spaetere gleiche Zeilen.
        existing.kategorie = result.kategorie ?? null;
        existing.mietvertrag_id = result.mietvertrag_id;

        if (result.mietvertrag_id && result.iban) {
          await ibanNachtragen(result.mietvertrag_id, result.iban);
        }
      } else {
        // Payment doesn't exist - insert it
        // zugeordneter_monat is NOT set here - the DB trigger set_zugeordneter_monat_trigger handles it automatically
        const { data: eingefuegt, error } = await supabase
          .from('zahlungen')
          .insert({
            buchungsdatum: result.buchungsdatum,
            betrag: result.betrag,
            iban: ibanValue,
            verwendungszweck: vzValue,
            empfaengername: result.empfaengername?.trim() || null,
            mietvertrag_id: result.mietvertrag_id || null,
            immobilie_id: result.immobilie_id || null,
            kategorie: (result.kategorie as never) || null,
          })
          .select('id')
          .single();

        if (error) {
          fehler.push({ zeile: bezeichne(result), grund: `Speichern fehlgeschlagen: ${error.message}` });
          continue;
        }

        // Eine spaetere gleiche Zeile desselben Imports findet diese Buchung
        // als bestehend -- wie frueher die Einzelabfrage die eben eingefuegte Zeile.
        bestehendeVormerken(bestehende, {
          id: eingefuegt.id,
          kategorie: result.kategorie ?? null,
          mietvertrag_id: result.mietvertrag_id || null,
          buchungsdatum: result.buchungsdatum,
          betrag: result.betrag,
          iban: ibanValue,
          verwendungszweck: vzValue,
        });

        if (result.mietvertrag_id && result.iban) {
          await ibanNachtragen(result.mietvertrag_id, result.iban);
        }
      }
    }

    const gespeichert = allResultsToSave.length - fehler.length;

    if (csvFile) {
      const buchungsdaten = allResultsToSave
        .map(r => r.buchungsdatum)
        .filter(Boolean)
        .sort();
      await supabase.from('csv_uploads').insert({
        dateiname: csvFile.name,
        dateigroe_bytes: csvFile.size,
        // Nur zaehlen, was wirklich in der Datenbank steht.
        anzahl_datensaetze: gespeichert,
        status: fehler.length > 0 ? 'teilweise_fehlgeschlagen' : 'verarbeitet',
        zeitraum_von: buchungsdaten[0] ?? null,
        zeitraum_bis: buchungsdaten.at(-1) ?? null,
      });
    }

    if (fehler.length > 0) {
      console.error('[CSV-Import] Nicht gespeicherte Zeilen:', fehler);
      toast({
        title: `${fehler.length} von ${allResultsToSave.length} Zahlungen nicht gespeichert`,
        description:
          `${gespeichert} Zahlungen wurden übernommen. Nicht gespeichert wurden: ` +
          fehler.slice(0, 3).map((f) => f.zeile).join(' · ') +
          (fehler.length > 3 ? ` und ${fehler.length - 3} weitere` : '') +
          '. Diese Zahlungen fehlen im Bestand — der Rückstand der betroffenen Mieter ist dadurch zu hoch.',
        variant: 'destructive',
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

    // Der Aufrufer meldete bisher unabhaengig vom Ergebnis Erfolg. Er braucht
    // die tatsaechlichen Zahlen.
    return { gesamt: allResultsToSave.length, gespeichert, fehler };
  };

  const oeffneZuordnung = useCallback((zahlung: ZahlungZeile | ZuordnungsZahlung) => {
    setSelectedPayment({
      id: zahlung.id,
      betrag: zahlung.betrag,
      buchungsdatum: zahlung.buchungsdatum,
      empfaengername: zahlung.empfaengername || undefined,
      iban: zahlung.iban || undefined,
      verwendungszweck: zahlung.verwendungszweck || undefined,
      kategorie: zahlung.kategorie || undefined,
    });
    setAssignDialogOpen(true);
  }, []);

  const tabKlasse = "flex items-center gap-1.5 px-2.5 text-xs sm:text-sm";

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-dvh flex-col bg-background">
      <header className="shrink-0 border-b bg-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 h-9">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Button>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">Zahlungsverwaltung</h1>
            <p className="hidden text-xs text-muted-foreground md:block">CSV-Import, Zuordnung und Übersicht aller Buchungen</p>
          </div>
          <TabsList className="ml-auto h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="upload" className={tabKlasse}>
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">CSV-Import</span>
              <span className="sm:hidden">Import</span>
            </TabsTrigger>
            <TabsTrigger value="alle" className={tabKlasse}>
              <Euro className="h-4 w-4" />
              <span className="hidden sm:inline">Alle Zahlungen</span>
              <span className="sm:hidden">Alle</span>
              {allPayments && <Badge variant="secondary" className="hidden px-1.5 tabular-nums sm:inline-flex">{allPayments.length.toLocaleString("de-DE")}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="unzugeordnet" className={tabKlasse}>
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">Nicht zugeordnet</span>
              <span className="sm:hidden">Offen</span>
              {unassignedPayments && unassignedPayments.length > 0 && (
                <Badge variant="destructive" className="px-1.5 tabular-nums">{unassignedPayments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="nebenkosten" className={tabKlasse}>
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Nebenkosten</span>
              <span className="sm:hidden">NK</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </header>

      <div className="shrink-0 px-3 pt-3 empty:hidden sm:px-4">
        <ZahlungsAnomalienBanner onNavigateToZahlung={handleNavigateToZahlung} />
      </div>

      {/* Reiter 1: CSV-Import */}
      <TabsContent value="upload" className="mt-0 min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4 text-primary" />
                Bankbewegungen importieren
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="csv-file">Kontoumsätze (CSV)</Label>
                <Input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={isUploading}
                  className="mt-2 cursor-pointer file:cursor-pointer"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {csvFile
                    ? `Ausgewählt: ${csvFile.name} (${(csvFile.size / 1024).toFixed(1)} KB)`
                    : "Die Datei wird geprüft und jede Buchung mit einem Zuordnungsvorschlag angezeigt, bevor etwas gespeichert wird."}
                </p>
              </div>

              <Button onClick={handleProcessCsv} disabled={!csvFile || isUploading} className="w-full">
                <Bot className={cn("h-4 w-4", isUploading && "animate-pulse")} />
                {isUploading ? "Zahlungen werden analysiert …" : "Zuordnungsvorschläge erstellen"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Import-Historie
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {uploadHistory && uploadHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9 text-xs">Datei</TableHead>
                        <TableHead className="h-9 text-xs">Zeitraum</TableHead>
                        <TableHead className="h-9 text-right text-xs">Buchungen</TableHead>
                        <TableHead className="h-9 text-xs">Status</TableHead>
                        <TableHead className="h-9 text-right text-xs">Hochgeladen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploadHistory.map((upload, idx) => (
                        <TableRow
                          key={upload.id}
                          className={cn("text-sm", idx === 0 && "cursor-pointer")}
                          onClick={idx === 0 ? () => setLastUploadReviewOpen(true) : undefined}
                          title={idx === 0 ? "Zuordnungsergebnis des letzten Imports anzeigen" : undefined}
                        >
                          <TableCell className="py-2 font-medium">
                            <span className="flex items-center gap-2">
                              <span className="max-w-[26rem] truncate" title={upload.dateiname}>{upload.dateiname}</span>
                              {idx === 0 && <span className="shrink-0 text-xs font-normal text-primary">Ergebnis ansehen</span>}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-muted-foreground tabular-nums">
                            {upload.zeitraum_von && upload.zeitraum_bis
                              ? `${formatIsoDatum(upload.zeitraum_von)} – ${formatIsoDatum(upload.zeitraum_bis)}`
                              : upload.zeitraum_von
                                ? formatIsoDatum(upload.zeitraum_von)
                                : '–'}
                          </TableCell>
                          <TableCell className="py-2 text-right text-muted-foreground tabular-nums">
                            {upload.anzahl_datensaetze ?? '–'}
                          </TableCell>
                          <TableCell className="py-2">
                            {upload.status === 'teilweise_fehlgeschlagen' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                                teilweise fehlgeschlagen
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">{upload.status ?? '–'}</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-right text-muted-foreground tabular-nums">
                            {upload.hochgeladen_am ? format(new Date(upload.hochgeladen_am), 'dd.MM.yyyy HH:mm') : '–'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="px-6 pb-6 text-sm text-muted-foreground">Noch kein Import durchgeführt.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* Reiter 2: Alle Zahlungen */}
      <TabsContent value="alle" className="mt-0 min-h-0 flex-1">
        <ZahlungenArbeitsplatz
          zahlungen={allPayments}
          laedt={allPaymentsLoading}
          fehler={allPaymentsError}
          onZuordnen={oeffneZuordnung}
          sprungZiel={sprungZiel}
        />
      </TabsContent>

      {/* Reiter 3: Nicht zugeordnete Mietzahlungen */}
      <TabsContent value="unzugeordnet" className="mt-0 min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Nicht zugeordnete Mietzahlungen
                  {unassignedPayments && (
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">({filteredUnassignedPayments?.length || 0})</span>
                  )}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Als Miete, Mietkaution, Rücklastschrift oder BKA erkannt, aber ohne Mietvertrag — der Rückstand der Mieter stimmt erst nach der Zuordnung.
                </p>
              </div>
              <div className="relative w-full shrink-0 sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Suchen …"
                  aria-label="Nicht zugeordnete Zahlungen durchsuchen"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {unassignedLoading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Lade Zahlungen …</p>
            ) : unassignedError ? (
              <div className="p-8 text-center">
                <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" aria-hidden="true" />
                <p className="font-medium text-destructive">Zahlungen konnten nicht geladen werden</p>
              </div>
            ) : filteredUnassignedPayments?.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {searchTerm ? "Keine Zahlung entspricht der Suche." : "Alle Mietzahlungen sind zugeordnet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 whitespace-nowrap text-xs">Datum</TableHead>
                      <TableHead className="h-9 whitespace-nowrap text-right text-xs">Betrag</TableHead>
                      <TableHead className="hidden h-9 text-xs sm:table-cell">IBAN</TableHead>
                      <TableHead className="h-9 text-xs">Von / An</TableHead>
                      <TableHead className="hidden h-9 text-xs md:table-cell">Verwendungszweck</TableHead>
                      <TableHead className="h-9 text-xs">Kategorie</TableHead>
                      <TableHead className="h-9 text-right text-xs">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnassignedPayments?.map((payment) => (
                      <TableRow key={payment.id} className="text-sm">
                        <TableCell className="whitespace-nowrap py-2 tabular-nums">{formatIsoDatum(payment.buchungsdatum)}</TableCell>
                        <TableCell className={cn("whitespace-nowrap py-2 text-right font-medium tabular-nums", payment.betrag < 0 ? "text-destructive" : "text-success")}>
                          {formatEuro(payment.betrag)}
                        </TableCell>
                        <TableCell className="hidden py-2 font-mono text-xs sm:table-cell">{payment.iban || '–'}</TableCell>
                        <TableCell className="max-w-[10rem] truncate py-2" title={payment.empfaengername ?? undefined}>{payment.empfaengername || '–'}</TableCell>
                        <TableCell className="hidden max-w-xs truncate py-2 text-muted-foreground md:table-cell" title={payment.verwendungszweck ?? undefined}>{payment.verwendungszweck || '–'}</TableCell>
                        <TableCell className="py-2">
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
                        <TableCell className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() =>
                              oeffneZuordnung({
                                id: payment.id,
                                betrag: payment.betrag,
                                buchungsdatum: payment.buchungsdatum,
                                empfaengername: payment.empfaengername ?? undefined,
                                iban: payment.iban ?? undefined,
                                verwendungszweck: payment.verwendungszweck ?? undefined,
                                kategorie: payment.kategorie ?? undefined,
                              })
                            }
                          >
                            Zuordnen
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Reiter 4: Nebenkosten (Nichtmiete-Zahlungen) */}
      <TabsContent value="nebenkosten" className="mt-0 min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <NebenkostenZuordnungTab />
          </CardContent>
        </Card>
      </TabsContent>

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
          dateiname={csvFile?.name}
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
    </Tabs>
  );
}
