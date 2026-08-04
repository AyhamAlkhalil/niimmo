import { useState, useMemo, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Search, ChevronDown, ChevronRight, Save, X, ArrowLeft,
  TableProperties, Building2, Users, Banknote, Check, Pencil,
  FileDown, Printer, ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { sortPropertiesByName, getCurrentContract } from "@/utils/contractUtils";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

interface EditableMietUebersichtProps {
  onBack: () => void;
}

interface MieterInfo {
  id: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
}

interface ContractRow {
  contractId: string;
  objektId: string;
  objektName: string;
  objektAdresse: string;
  annuitaet: number | null;
  einheitId: string;
  mieterId: string;
  etage: string;
  qm: number;
  typ: string;
  status: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  mieter: MieterInfo[];
  kaltmiete: number;
  betriebskosten: number;
  mietbeginn: string;
  mietende: string;
  lastschrift: boolean;
  anzahlPersonen: number | null;
  verwendungszweck: string[] | null;
  bankkonto: string;
  kaution_betrag: number | null;
  kaution_status: string;
  sollMiete: number | null;
  isLeerstand: boolean;
}

// ── Formatierung ─────────────────────────────────────────────────────────────
const fmtEuro = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "";
  try { return format(new Date(s), "dd.MM.yyyy"); } catch { return s; }
};

// ── Bank-Report HTML-Generator ────────────────────────────────────────────────
function buildBankHtml(
  grouped: Array<{ objektId: string; objektName: string; objektAdresse: string; annuitaet: number | null; contracts: ContractRow[] }>
): string {
  const today = format(new Date(), "dd.MM.yyyy");
  let nr = 0;
  let grandKm = 0, grandBkv = 0, grandSoll = 0;
  const annMap = new Map<string, number>();

  const rows = grouped.map((g) => {
    let gKm = 0, gBkv = 0, gSoll = 0, gQm = 0;
    const unitRows = g.contracts.map((r) => {
      nr++;
      const istPm = r.kaltmiete + r.betriebskosten;
      const sollPm = r.sollMiete ?? istPm;
      const eurQm = r.kaltmiete && r.qm ? r.kaltmiete / r.qm : null;
      const diffPm = istPm - sollPm;
      const laufzeit = r.isLeerstand
        ? "LEERSTAND"
        : r.mietende
        ? `${fmtDate(r.mietbeginn)} – ${fmtDate(r.mietende)}`
        : `${fmtDate(r.mietbeginn)} – unbefristet`;

      gKm += r.kaltmiete;
      gBkv += r.betriebskosten;
      gSoll += sollPm;
      gQm += r.qm;

      const leerCls = r.isLeerstand ? ' class="leerstand"' : "";
      const negCls = (v: number) => v < 0 ? ' class="neg"' : v > 0 ? ' class="pos"' : "";

      return `<tr${leerCls}>
        <td class="ctr">${nr}</td>
        <td>${r.etage || "—"}</td>
        <td>${r.typ || "—"}</td>
        <td>${r.isLeerstand ? "<b>LEERSTAND</b>" : r.mieter.map(m => `${m.vorname} ${m.nachname}`).join(", ") || "—"}</td>
        <td class="num">${fmtNum(r.qm, 0)}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtNum(eurQm, 2)}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtEuro(r.kaltmiete)}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtEuro(r.betriebskosten)}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtEuro(istPm)}</td>
        <td>${laufzeit}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtEuro(istPm)}</td>
        <td class="num">${r.isLeerstand ? "—" : fmtEuro(istPm * 12)}</td>
        <td class="num${r.sollMiete == null ? " muted" : ""}">${fmtEuro(sollPm)}</td>
        <td class="num">${r.sollMiete != null ? fmtEuro(r.sollMiete * 12) : "—"}</td>
        <td class="num${negCls(diffPm)}">${diffPm !== 0 ? fmtEuro(diffPm) : "—"}</td>
      </tr>`;
    });

    grandKm += gKm; grandBkv += gBkv; grandSoll += gSoll;
    if (g.annuitaet != null) annMap.set(g.objektId, g.annuitaet);

    const gIst = gKm + gBkv;
    const uIst = (gIst - (g.annuitaet ?? 0)) * 12;
    const uSoll = (gSoll - (g.annuitaet ?? 0)) * 12;

    const headerRow = `<tr class="obj-row">
      <td colspan="2"><b>${g.objektName}</b></td>
      <td colspan="2" style="font-weight:normal;font-size:8pt">${g.objektAdresse}</td>
      <td class="num"><b>${fmtNum(gQm, 0)} m²</b></td>
      <td></td>
      <td class="num"><b>${fmtEuro(gKm)}</b></td>
      <td class="num"><b>${fmtEuro(gBkv)}</b></td>
      <td class="num"><b>${fmtEuro(gIst)}</b></td>
      <td style="font-size:7pt">
        Annuität: <b>${fmtEuro(g.annuitaet)}</b> p.m.
        &nbsp;|&nbsp; Überschuss IST: <b style="color:${uIst < 0 ? '#dc2626' : '#16a34a'}">${fmtEuro(uIst)}</b> p.a.
        &nbsp;/&nbsp; SOLL: <b style="color:${uSoll < 0 ? '#dc2626' : '#16a34a'}">${fmtEuro(uSoll)}</b> p.a.
      </td>
      <td class="num"><b>${fmtEuro(gIst)}</b></td>
      <td class="num"><b>${fmtEuro(gIst * 12)}</b></td>
      <td class="num"><b>${fmtEuro(gSoll)}</b></td>
      <td class="num"><b>${fmtEuro(gSoll * 12)}</b></td>
      <td></td>
    </tr>`;

    return headerRow + unitRows.join("");
  });

  const grandIst = grandKm + grandBkv;
  const grandAnn = Array.from(annMap.values()).reduce((s, v) => s + v, 0);
  const grandUeberschuss = (grandIst - grandAnn) * 12;
  const negCol = grandUeberschuss < 0 ? "#dc2626" : "#16a34a";

  const totalRow = `<tr class="total-row">
    <td colspan="4"><b>Gesamt</b></td>
    <td class="num"><b>—</b></td>
    <td></td>
    <td class="num"><b>${fmtEuro(grandKm)}</b></td>
    <td class="num"><b>${fmtEuro(grandBkv)}</b></td>
    <td class="num"><b>${fmtEuro(grandIst)}</b></td>
    <td style="font-size:7pt">Annuität ges.: <b>${fmtEuro(grandAnn)}</b> p.m. &nbsp;|&nbsp; Überschuss IST: <b style="color:${negCol}">${fmtEuro(grandUeberschuss)}</b> p.a.</td>
    <td class="num"><b>${fmtEuro(grandIst)}</b></td>
    <td class="num"><b>${fmtEuro(grandIst * 12)}</b></td>
    <td class="num"><b>${fmtEuro(grandSoll)}</b></td>
    <td class="num"><b>${fmtEuro(grandSoll * 12)}</b></td>
    <td></td>
  </tr>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Mietaufstellung ${today}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }
  h2 { margin: 0 0 4px; font-size: 12pt; }
  p  { margin: 0 0 10px; font-size: 8pt; color: #555; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 0.5px solid #d1d5db; padding: 2px 5px; white-space: nowrap; }
  th { background: #1f2937; color: #fff; font-size: 7.5pt; text-align: center; }
  td.num { text-align: right; }
  td.ctr { text-align: center; color: #6b7280; }
  td.muted { color: #9ca3af; font-style: italic; }
  td.neg { color: #dc2626; font-weight: 600; }
  td.pos { color: #16a34a; font-weight: 600; }
  .obj-row td { background: #fff7ed; color: #9a3412; border-top: 2px solid #fb923c; }
  .leerstand td { background: #fefce8; }
  .total-row td { background: #1f2937; color: #fff; border-top: 2px solid #6b7280; }
  @page { size: A3 landscape; margin: 8mm; }
</style>
</head>
<body>
<h2>Mietaufstellung</h2>
<p>Stand: ${today} &nbsp;·&nbsp; SOLL-Miete kursiv = IST-Wert als Vorschlag (kein SOLL gesetzt)</p>
<table>
  <thead>
    <tr>
      <th>Nr.</th><th>Lage</th><th>Nutzung</th><th>Mieter</th>
      <th>Fläche m²</th><th>€/m²</th><th>KM</th><th>BKV</th><th>Gesamtmiete</th>
      <th>Laufzeit</th>
      <th>IST p.m.</th><th>IST p.a.</th>
      <th>SOLL p.m.</th><th>SOLL p.a.</th>
      <th>Diff. p.m.</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join("")}
    ${totalRow}
  </tbody>
</table>
</body>
</html>`;
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export const EditableMietUebersicht = ({ onBack }: EditableMietUebersichtProps) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ id: string; field: string; value: unknown } | null>(null);
  const [pendingKaltmiete, setPendingKaltmiete] = useState<{ contractId: string; oldValue: number; newValue: number } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["miet-overview"],
    queryFn: async () => {
      const { data: einheitenData, error: einheitenError } = await supabase
        .from("einheiten")
        .select(`
          id, etage, qm, einheitentyp, zaehler, soll_miete,
          immobilien!inner( id, name, adresse, "Annuität" ),
          mietvertrag(
            id, status, kaltmiete, betriebskosten, start_datum, ende_datum,
            lastschrift, anzahl_personen, verwendungszweck, bankkonto_mieter,
            kaution_betrag, kaution_status,
            mietvertrag_mieter( mieter( id, vorname, nachname, hauptmail, telnr ) )
          )
        `);
      if (einheitenError) throw einheitenError;

      const results: ContractRow[] = [];
      einheitenData?.forEach((einheit) => {
        const contracts = (einheit.mietvertrag || []) as any[];
        const currentContract = getCurrentContract(contracts);
        const isLeerstand = !currentContract;

        const allMieter: MieterInfo[] = isLeerstand
          ? []
          : (currentContract.mietvertrag_mieter || [])
              .map((mm: any) => mm.mieter)
              .filter(Boolean)
              .map((m: any) => ({
                id: m.id || "",
                vorname: m.vorname || "",
                nachname: m.nachname || "",
                email: m.hauptmail || "",
                telefon: m.telnr || "",
              }));

        const hauptmieter = allMieter[0];
        const imm = einheit.immobilien as any;

        results.push({
          contractId: currentContract?.id || "",
          objektId: imm.id,
          objektName: imm.name,
          objektAdresse: imm.adresse || "",
          annuitaet: imm["Annuität"] ?? null,
          einheitId: einheit.id,
          mieterId: hauptmieter?.id || "",
          etage: einheit.etage || "",
          qm: einheit.qm || 0,
          typ: einheit.einheitentyp || "Wohnung",
          status: currentContract?.status || "leerstand",
          vorname: hauptmieter?.vorname || "",
          nachname: hauptmieter?.nachname || "",
          email: hauptmieter?.email || "",
          telefon: hauptmieter?.telefon || "",
          mieter: allMieter,
          kaltmiete: currentContract?.kaltmiete || 0,
          betriebskosten: currentContract?.betriebskosten || 0,
          mietbeginn: currentContract?.start_datum || "",
          mietende: currentContract?.ende_datum || "",
          lastschrift: currentContract?.lastschrift || false,
          anzahlPersonen: currentContract?.anzahl_personen ?? null,
          verwendungszweck: currentContract?.verwendungszweck ?? null,
          bankkonto: currentContract?.bankkonto_mieter || "",
          kaution_betrag: currentContract?.kaution_betrag ?? null,
          kaution_status: currentContract?.kaution_status || "offen",
          sollMiete: (einheit as any).soll_miete ?? null,
          isLeerstand,
        });
      });
      return results;
    },
  });

  // ── Filterung + Gruppierung ───────────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!rows) return [];
    const filtered = rows.filter((r) => {
      if (statusFilter === "leerstand") return r.isLeerstand;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          r.objektName.toLowerCase().includes(s) ||
          `${r.vorname} ${r.nachname}`.toLowerCase().includes(s) ||
          r.email.toLowerCase().includes(s) ||
          r.etage.toLowerCase().includes(s)
        );
      }
      return true;
    });

    const groups: Record<string, ContractRow[]> = {};
    filtered.forEach((r) => {
      if (!groups[r.objektId]) groups[r.objektId] = [];
      groups[r.objektId].push(r);
    });

    const arr = Object.entries(groups).map(([id, contracts]) => ({
      objektId: id,
      objektName: contracts[0].objektName,
      objektAdresse: contracts[0].objektAdresse,
      annuitaet: contracts[0].annuitaet,
      contracts,
    }));
    return sortPropertiesByName(arr.map((g) => ({ name: g.objektName, ...g }))).map(
      ({ name, ...rest }) => rest
    );
  }, [rows, search, statusFilter]);

  // ── Speichern ─────────────────────────────────────────────────────────────
  const saveField = useCallback(
    async (table: string, id: string, field: string, value: unknown, extraUpdate?: Record<string, unknown>) => {
      if (!id || id.trim() === "") {
        toast({ title: "Fehler", description: "Kein gültiger Datensatz gefunden", variant: "destructive" });
        setEditing(null);
        return;
      }
      try {
        const { error } = await supabase.from(table as any).update({ [field]: value, ...extraUpdate }).eq("id", id);
        if (error) throw error;
        setEditing(null);
        queryClient.invalidateQueries({ queryKey: ["miet-overview"] });
        queryClient.invalidateQueries({ queryKey: ["mietaufstellung-bank"] });
        queryClient.invalidateQueries({ queryKey: ["einheiten"] });
        queryClient.invalidateQueries({ queryKey: ["mietvertrag"] });
        queryClient.invalidateQueries({ queryKey: ["mieter"] });
        queryClient.invalidateQueries({ queryKey: ["immobilie-detail"] });
        queryClient.invalidateQueries({ queryKey: ["all-mietvertraege"] });
        queryClient.invalidateQueries({ queryKey: ["mietvertrag-mit-details"] });
        queryClient.invalidateQueries({ queryKey: ["mietvertrag-detail"] });
        toast({ title: extraUpdate?.letzte_mieterhoehung_am ? "✓ Mieterhöhung dokumentiert" : "✓ Gespeichert" });
      } catch (err: unknown) {
        toast({ title: "Fehler", description: (err as Error).message, variant: "destructive" });
      }
    },
    [queryClient, toast]
  );

  const handleSaveField = useCallback(
    (table: string, id: string, field: string, value: unknown) => {
      if (field === "kaltmiete") {
        const row = rows?.find((r) => r.contractId === id);
        const oldValue = row?.kaltmiete ?? 0;
        const newValue = typeof value === "number" ? value : parseFloat(String(value)) || 0;
        if (newValue !== oldValue) {
          setPendingKaltmiete({ contractId: id, oldValue, newValue });
          return;
        }
      }
      saveField(table, id, field, value);
    },
    [rows, saveField]
  );

  // ── Export ────────────────────────────────────────────────────────────────
  const exportToPDF = useCallback(() => {
    const html = buildBankHtml(grouped);
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 400);
    }
  }, [grouped]);

  const exportToExcel = useCallback(() => {
    const html = buildBankHtml(grouped);
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mietaufstellung_${format(new Date(), "yyyy-MM-dd")}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [grouped]);

  // ── EditCell ──────────────────────────────────────────────────────────────
  const EditCell = ({ rowId, table, field, value, type = "text", className = "" }: any) => {
    const editKey = `${rowId}-${field}`;
    const isEditingCell = editing?.id === editKey;
    const displayValue = isEditingCell ? editing!.value : value;

    if (isEditingCell) {
      return (
        <div className="flex gap-0.5 items-center">
          {type === "select-status" ? (
            <Select value={displayValue as string} onValueChange={(v) => setEditing({ ...editing!, value: v })}>
              <SelectTrigger className="h-7 text-xs w-[90px] border-primary"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aktiv">Aktiv</SelectItem>
                <SelectItem value="gekuendigt">Gekündigt</SelectItem>
                <SelectItem value="beendet">Beendet</SelectItem>
              </SelectContent>
            </Select>
          ) : type === "select-typ" ? (
            <Select value={displayValue as string} onValueChange={(v) => setEditing({ ...editing!, value: v })}>
              <SelectTrigger className="h-7 text-xs w-[90px] border-primary"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Wohnung">Wohnung</SelectItem>
                <SelectItem value="Gewerbe">Gewerbe</SelectItem>
                <SelectItem value="Stellplatz">Stellplatz</SelectItem>
                <SelectItem value="Garage">Garage</SelectItem>
                <SelectItem value="Lager">Lager</SelectItem>
                <SelectItem value="Sonstiges">Sonstiges</SelectItem>
              </SelectContent>
            </Select>
          ) : type === "personen" ? (
            <Input type="number" step="1" min="1" value={(displayValue as number) ?? ""} onChange={(e) => setEditing({ ...editing!, value: e.target.value ? parseInt(e.target.value) : null })} className="h-7 text-xs w-14 border-primary" autoFocus onKeyDown={(e) => e.key === "Enter" && handleSaveField(table, rowId, field, editing!.value)} />
          ) : type === "number" || type === "qm" ? (
            <DecimalInput step="0.01" value={displayValue as number} onValueChange={(wert) => setEditing({ ...editing!, value: wert ?? 0 })} className="h-7 text-xs w-20 border-primary" autoFocus onKeyDown={(e) => e.key === "Enter" && handleSaveField(table, rowId, field, editing!.value)} />
          ) : type === "date" ? (
            <Input type="date" value={(displayValue as string)?.slice(0, 10) || ""} onChange={(e) => setEditing({ ...editing!, value: e.target.value })} className="h-7 text-xs w-[120px] border-primary" autoFocus onKeyDown={(e) => e.key === "Enter" && handleSaveField(table, rowId, field, editing!.value)} />
          ) : (
            <Input value={displayValue as string} onChange={(e) => setEditing({ ...editing!, value: e.target.value })} className="h-7 text-xs w-full min-w-[80px] border-primary" autoFocus onKeyDown={(e) => e.key === "Enter" && handleSaveField(table, rowId, field, editing!.value)} />
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => handleSaveField(table, rowId, field, editing!.value)}>
            <Check className="h-3 w-3 text-green-600" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={() => setEditing(null)}>
            <X className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      );
    }

    let formatted: string;
    if (type === "number") formatted = `${Number(value || 0).toFixed(2)} €`;
    else if (type === "qm") formatted = `${Number(value || 0).toFixed(1)} m²`;
    else if (type === "personen") formatted = value != null ? String(value) : "-";
    else if (type === "date") formatted = (value as string)?.slice(0, 10) || "-";
    else formatted = (value as string) || "-";

    return (
      <div className={`group/cell cursor-pointer hover:bg-primary/5 px-1.5 py-0.5 rounded text-xs transition-colors flex items-center gap-1 ${className}`} onClick={() => setEditing({ id: editKey, field, value })}>
        <span className="truncate">{formatted}</span>
        <Pencil className="h-2.5 w-2.5 text-muted-foreground/0 group-hover/cell:text-muted-foreground/60 shrink-0 transition-opacity" />
      </div>
    );
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = rows || [];
    return {
      total: all.length,
      aktiv: all.filter((r) => r.status === "aktiv").length,
      leerstand: all.filter((r) => r.isLeerstand).length,
      gekuendigt: all.filter((r) => r.status === "gekuendigt").length,
      kaltmiete: all.filter((r) => !r.isLeerstand).reduce((s, r) => s + r.kaltmiete, 0),
      warmmiete: all.filter((r) => !r.isLeerstand).reduce((s, r) => s + r.kaltmiete + r.betriebskosten, 0),
      properties: new Set(all.map((r) => r.objektId)).size,
    };
  }, [rows]);

  const toggleAll = useCallback(() => {
    if (expanded.size === grouped.length) setExpanded(new Set());
    else setExpanded(new Set(grouped.map((g) => g.objektId)));
  }, [expanded.size, grouped]);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const statusBadge = (row: ContractRow) => {
    if (row.isLeerstand) return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px] px-1.5 py-0">Leerstand</Badge>;
    if (row.status === "aktiv") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">Aktiv</Badge>;
    if (row.status === "gekuendigt") return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">Gekündigt</Badge>;
    return <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[10px] px-1.5 py-0">Beendet</Badge>;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Stammdaten werden geladen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 z-30 bg-background border-b shadow-sm">
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Button variant="ghost" size="sm" onClick={onBack} className="h-8 w-8 p-0 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <TableProperties className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold truncate">Stammdaten</h1>
                <p className="text-[11px] text-muted-foreground hidden sm:block">Einheiten, Mieter & Verträge bearbeiten</p>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden md:flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-semibold">{stats.properties}</span>
                <span className="text-muted-foreground">Objekte</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-semibold">{stats.aktiv}</span>
                <span className="text-muted-foreground">aktiv</span>
                {stats.leerstand > 0 && <span className="text-yellow-600">· {stats.leerstand} LS</span>}
                {stats.gekuendigt > 0 && <span className="text-amber-600">· {stats.gekuendigt} gek.</span>}
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-semibold">
                  {stats.warmmiete.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                </span>
                <span className="text-muted-foreground">Warmmiete</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input placeholder="Suchen..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs pl-8 w-[140px] sm:w-[200px]" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="aktiv">Aktiv</SelectItem>
                  <SelectItem value="leerstand">Leerstand</SelectItem>
                  <SelectItem value="gekuendigt">Gekündigt</SelectItem>
                  <SelectItem value="beendet">Beendet</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8 text-xs hidden sm:flex" onClick={toggleAll}>
                {expanded.size === grouped.length ? "Alle zuklappen" : "Alle aufklappen"}
              </Button>

              {/* Export-Button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5">
                    <FileDown className="h-3.5 w-3.5" />
                    Exportieren
                    <ChevronDownIcon className="h-3 w-3 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportToPDF} className="gap-2 cursor-pointer">
                    <Printer className="h-3.5 w-3.5" />
                    Als PDF drucken
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportToExcel} className="gap-2 cursor-pointer">
                    <FileDown className="h-3.5 w-3.5" />
                    Als Excel exportieren (.xls)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[1200px]">
          <table className="w-full caption-bottom text-sm">
            <thead className="sticky top-0 z-20 [&_tr]:border-b">
              <tr className="bg-muted border-b-2">
                <th className="w-8 text-[10px] font-bold py-2 px-2 h-12 text-left align-middle text-muted-foreground" />
                <th className="text-[10px] font-bold py-2 px-2 w-[50px] h-12 text-left align-middle text-muted-foreground">Einheit</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[50px] h-12 text-left align-middle text-muted-foreground">Etage</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[55px] h-12 text-left align-middle text-muted-foreground">m²</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[75px] h-12 text-left align-middle text-muted-foreground">Typ</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[75px] h-12 text-left align-middle text-muted-foreground">Status</th>
                <th className="text-[10px] font-bold py-2 px-2 h-12 text-left align-middle text-muted-foreground">Mieter</th>
                <th className="text-[10px] font-bold py-2 px-2 h-12 text-left align-middle text-muted-foreground">E-Mail</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[100px] h-12 text-left align-middle text-muted-foreground">Telefon</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[80px] text-right h-12 align-middle text-muted-foreground">Kaltmiete</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[60px] text-right h-12 align-middle text-muted-foreground">NK</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[80px] text-right h-12 align-middle text-muted-foreground">Warmmiete</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[80px] text-right h-12 align-middle text-muted-foreground">SOLL p.m.</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[40px] text-center h-12 align-middle text-muted-foreground">Pers.</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[85px] h-12 text-left align-middle text-muted-foreground">Beginn</th>
                <th className="text-[10px] font-bold py-2 px-2 w-[85px] h-12 text-left align-middle text-muted-foreground">Ende</th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {grouped.length === 0 && (
                <TableRow>
                  <TableCell colSpan={16} className="text-center py-12 text-muted-foreground">
                    {search ? "Keine Ergebnisse für diese Suche" : "Keine Daten vorhanden"}
                  </TableCell>
                </TableRow>
              )}
              {grouped.map((group) => {
                const isExpanded = expanded.has(group.objektId);
                const groupKm = group.contracts.filter((r) => !r.isLeerstand).reduce((s, r) => s + r.kaltmiete, 0);
                const groupWarm = group.contracts.filter((r) => !r.isLeerstand).reduce((s, r) => s + r.kaltmiete + r.betriebskosten, 0);
                const leerstandCount = group.contracts.filter((r) => r.isLeerstand).length;

                return (
                  <>
                    {/* Property header */}
                    <TableRow
                      key={group.objektId}
                      className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-t-2 border-border/50"
                      onClick={() => toggleGroup(group.objektId)}
                    >
                      <TableCell className="py-2 px-2">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </TableCell>
                      <TableCell colSpan={8} className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="font-semibold text-sm">{group.objektName}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                            {group.contracts.length} Einh.
                          </Badge>
                          {leerstandCount > 0 && (
                            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px] h-4 px-1.5">
                              {leerstandCount}× Leerstand
                            </Badge>
                          )}
                          {group.annuitaet != null && (
                            <span className="text-[10px] text-muted-foreground ml-1">
                              Annuität: <b>{fmtEuro(group.annuitaet)}/Mon.</b>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 px-2 text-right text-xs font-medium text-muted-foreground">
                        {groupKm.toFixed(0)} €
                      </TableCell>
                      <TableCell className="py-2 px-2" />
                      <TableCell className="py-2 px-2 text-right text-xs font-medium">
                        {groupWarm.toFixed(0)} €
                      </TableCell>
                      <TableCell colSpan={4} className="py-2 px-2" />
                    </TableRow>

                    {/* Unit rows */}
                    {isExpanded &&
                      [...group.contracts]
                        .sort((a, b) => {
                          if (a.isLeerstand && !b.isLeerstand) return 1;
                          if (!a.isLeerstand && b.isLeerstand) return -1;
                          return a.etage.localeCompare(b.etage, undefined, { numeric: true });
                        })
                        .map((row, idx) => (
                          <TableRow
                            key={row.isLeerstand ? `ls-${row.einheitId}` : row.contractId}
                            className={`hover:bg-accent/30 border-b border-border/30 ${row.isLeerstand ? "bg-yellow-50/60" : ""}`}
                          >
                            <TableCell className="py-1 px-2 text-center text-[10px] text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="py-1 px-2">
                              <span className="text-xs font-mono text-muted-foreground">{row.einheitId.slice(-4)}</span>
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <EditCell rowId={row.einheitId} table="einheiten" field="etage" value={row.etage} />
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <EditCell rowId={row.einheitId} table="einheiten" field="qm" value={row.qm} type="qm" />
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <EditCell rowId={row.einheitId} table="einheiten" field="einheitentyp" value={row.typ} type="select-typ" />
                            </TableCell>
                            <TableCell className="py-1 px-2">{statusBadge(row)}</TableCell>
                            <TableCell className="py-1 px-2">
                              {row.isLeerstand ? (
                                <span className="text-xs text-yellow-700 font-medium italic">— leer —</span>
                              ) : (
                                <div className="space-y-0.5">
                                  {(row.mieter || []).map((m, mi) => (
                                    <div key={m.id || mi} className="flex gap-0.5">
                                      <EditCell rowId={m.id} table="mieter" field="vorname" value={m.vorname} />
                                      <EditCell rowId={m.id} table="mieter" field="nachname" value={m.nachname} />
                                    </div>
                                  ))}
                                  {(!row.mieter || row.mieter.length === 0) && <span className="text-xs text-muted-foreground">-</span>}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              {!row.isLeerstand && (
                                <div className="space-y-0.5">
                                  {(row.mieter || []).map((m, mi) => (
                                    <EditCell key={m.id || mi} rowId={m.id} table="mieter" field="hauptmail" value={m.email} />
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              {!row.isLeerstand && (
                                <div className="space-y-0.5">
                                  {(row.mieter || []).map((m, mi) => (
                                    <EditCell key={m.id || mi} rowId={m.id} table="mieter" field="telnr" value={m.telefon} />
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2 text-right">
                              {row.isLeerstand ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <EditCell rowId={row.contractId} table="mietvertrag" field="kaltmiete" value={row.kaltmiete} type="number" />
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2 text-right">
                              {row.isLeerstand ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <EditCell rowId={row.contractId} table="mietvertrag" field="betriebskosten" value={row.betriebskosten} type="number" />
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2 text-right">
                              {row.isLeerstand ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span className="text-xs font-medium text-muted-foreground">
                                  {(row.kaltmiete + row.betriebskosten).toFixed(2)} €
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2 text-right">
                              <EditCell rowId={row.einheitId} table="einheiten" field="soll_miete" value={row.sollMiete} type="number" />
                            </TableCell>
                            <TableCell className="py-1 px-2 text-center">
                              {!row.isLeerstand && (
                                <EditCell rowId={row.contractId} table="mietvertrag" field="anzahl_personen" value={row.anzahlPersonen} type="personen" />
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              {!row.isLeerstand && (
                                <EditCell rowId={row.contractId} table="mietvertrag" field="start_datum" value={row.mietbeginn} type="date" />
                              )}
                            </TableCell>
                            <TableCell className="py-1 px-2 text-xs text-muted-foreground">
                              {!row.isLeerstand && (row.mietende ? fmtDate(row.mietende) : "unbefristet")}
                            </TableCell>
                          </TableRow>
                        ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Kaltmiete-Bestätigung */}
      <AlertDialog open={!!pendingKaltmiete} onOpenChange={(open) => { if (!open) { setPendingKaltmiete(null); setEditing(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mietänderung bestätigen</AlertDialogTitle>
            <AlertDialogDescription>
              Sie haben die Kaltmiete von {pendingKaltmiete?.oldValue.toFixed(2)} € auf {pendingKaltmiete?.newValue.toFixed(2)} € geändert.
              Handelt es sich um eine offizielle Mieterhöhung?
              <br /><br />
              <strong>Ja:</strong> Das Datum der letzten Mieterhöhung wird automatisch auf heute gesetzt.
              <br />
              <strong>Nein:</strong> Die Miete wird nur korrigiert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPendingKaltmiete(null); setEditing(null); }}>Abbrechen</AlertDialogCancel>
            <Button variant="outline" onClick={() => { if (pendingKaltmiete) { saveField("mietvertrag", pendingKaltmiete.contractId, "kaltmiete", pendingKaltmiete.newValue); setPendingKaltmiete(null); } }}>
              Nein, nur Korrektur
            </Button>
            <AlertDialogAction onClick={() => { if (pendingKaltmiete) { saveField("mietvertrag", pendingKaltmiete.contractId, "kaltmiete", pendingKaltmiete.newValue, { letzte_mieterhoehung_am: new Date().toISOString().split("T")[0] }); setPendingKaltmiete(null); } }}>
              Ja, offizielle Mieterhöhung
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
