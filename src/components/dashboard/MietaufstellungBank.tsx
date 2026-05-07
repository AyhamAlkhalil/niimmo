import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Printer, Pencil, Check, Loader2, AlertTriangle } from "lucide-react";
import { getCurrentContract } from "@/utils/contractUtils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MietaufstellungBankProps {
  onBack: () => void;
}

interface UnitRow {
  einheitId: string;
  immobilieId: string;
  immobilieName: string;
  immobilieAdresse: string;
  immobilieAnnuitaet: number | null;
  etage: string | null;
  einheitentyp: string | null;
  qm: number | null;
  sollMiete: number | null;
  // IST-Daten: nur bei aktiv/gekuendigt befüllt, bei Leerstand/beendet null
  kaltmiete: number | null;
  betriebskosten: number | null;
  startDatum: string | null;
  endeDatum: string | null;
  mieterNames: string[];
  isVacant: boolean;      // true für: kein Vertrag ODER beendeter Vertrag
  isGekuendigt: boolean;  // true wenn Mieter noch zahlt, aber Vertrag läuft aus
  lastEndDate: string | null; // letztes Ende-Datum bei beendeten Verträgen
}

const fmt = (val: number | null | undefined, decimals = 2): string => {
  if (val == null || !isFinite(val)) return "—";
  return val.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const fmtEuro = (val: number | null | undefined): string => {
  if (val == null || !isFinite(val)) return "—";
  return val.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
};

const fmtDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "";
  try { return format(new Date(dateStr), "dd.MM.yyyy"); } catch { return dateStr; }
};

export const MietaufstellungBank = ({ onBack }: MietaufstellungBankProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["mietaufstellung-bank"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("einheiten")
        .select(`
          id, etage, qm, einheitentyp, soll_miete,
          immobilien!inner( id, name, adresse, "Annuität" ),
          mietvertrag(
            id, status, kaltmiete, betriebskosten, start_datum, ende_datum,
            mietvertrag_mieter( mieter( vorname, nachname ) )
          )
        `);
      if (error) throw error;

      return (data ?? []).map((e): UnitRow => {
        const imm = e.immobilien as any;
        const contracts = (e.mietvertrag ?? []) as any[];
        const currentContract = getCurrentContract(contracts);

        // KORREKTUR: beendete Verträge = Leerstand, kein IST-Beitrag
        const isVacant = !currentContract || currentContract.status === "beendet";
        const isGekuendigt = !isVacant && currentContract?.status === "gekuendigt";

        // IST-Daten nur aus laufenden Verträgen (aktiv / gekuendigt)
        const activeContract = isVacant ? null : currentContract;

        const mieterNames = activeContract
          ? (activeContract.mietvertrag_mieter ?? [])
              .map((mm: any) => mm.mieter)
              .filter(Boolean)
              .map((m: any) => `${m.vorname ?? ""} ${m.nachname ?? ""}`.trim())
          : [];

        return {
          einheitId: e.id,
          immobilieId: imm.id,
          immobilieName: imm.name,
          immobilieAdresse: imm.adresse,
          immobilieAnnuitaet: imm["Annuität"],
          etage: e.etage,
          einheitentyp: e.einheitentyp,
          qm: e.qm,
          sollMiete: e.soll_miete,
          kaltmiete: activeContract?.kaltmiete ?? null,
          betriebskosten: activeContract?.betriebskosten ?? null,
          startDatum: activeContract?.start_datum ?? null,
          endeDatum: activeContract?.ende_datum ?? null,
          mieterNames,
          isVacant,
          isGekuendigt,
          lastEndDate:
            isVacant && currentContract?.status === "beendet"
              ? currentContract.ende_datum
              : null,
        };
      });
    },
  });

  const handleSave = useCallback(
    async (einheitId: string, valueStr: string) => {
      const trimmed = valueStr.trim();
      // Leeres Feld → null (SOLL löschen); sonst Zahl parsen
      const value = trimmed === "" ? null : parseFloat(trimmed.replace(",", "."));
      setEditing((prev) => { const next = { ...prev }; delete next[einheitId]; return next; });
      // Ungültige Zahl (aber nicht null) → abbrechen ohne Speichern
      if (value !== null && (isNaN(value) || value < 0)) return;
      const { error } = await supabase
        .from("einheiten")
        .update({ soll_miete: value })
        .eq("id", einheitId);
      if (error) {
        toast({ title: "Fehler", description: "SOLL-Miete konnte nicht gespeichert werden.", variant: "destructive" });
      } else {
        // Lokalen Cache direkt updaten – kein Refetch, keine Umsortierung
        queryClient.setQueryData(["mietaufstellung-bank"], (old: UnitRow[] | undefined) =>
          (old ?? []).map((row) => row.einheitId === einheitId ? { ...row, sollMiete: value } : row)
        );
      }
    },
    [toast, queryClient]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; adresse: string; annuitaet: number | null; units: UnitRow[] }>();
    for (const row of rows) {
      if (!map.has(row.immobilieId)) {
        map.set(row.immobilieId, { name: row.immobilieName, adresse: row.immobilieAdresse, annuitaet: row.immobilieAnnuitaet, units: [] });
      }
      map.get(row.immobilieId)!.units.push(row);
    }
    return Array.from(map.entries())
      .map(([id, val]) => ({ id, ...val }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [rows]);

  const grandTotals = useMemo(() => {
    let qm = 0, km = 0, bkv = 0, soll = 0;
    let vacantCount = 0, missingSollCount = 0, gekuendigtCount = 0;
    const annuitaetMap = new Map<string, number>();

    for (const row of rows) {
      qm += row.qm ?? 0;

      if (!row.isVacant) {
        // IST: nur tatsächlich laufende Verträge
        km += row.kaltmiete ?? 0;
        bkv += row.betriebskosten ?? 0;
      } else {
        vacantCount++;
        if (row.sollMiete == null) missingSollCount++;
      }

      if (row.isGekuendigt) gekuendigtCount++;

      // SOLL: soll_miete wo gesetzt; bei Leerstand ohne soll_miete = 0 (ehrlich)
      const istPm = (row.kaltmiete ?? 0) + (row.betriebskosten ?? 0);
      soll += row.sollMiete ?? (row.isVacant ? 0 : istPm);

      if (row.immobilieAnnuitaet != null) annuitaetMap.set(row.immobilieId, row.immobilieAnnuitaet);
    }

    const annuitaet = Array.from(annuitaetMap.values()).reduce((s, v) => s + v, 0);
    const ist = km + bkv;
    return { qm, km, bkv, ist, soll, annuitaet, vacantCount, missingSollCount, gekuendigtCount };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="min-h-screen modern-dashboard-bg flex items-center justify-center">
        <div className="glass-card p-12 rounded-3xl flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-red-500" />
          <p className="text-gray-600 font-sans">Lade Mietaufstellung...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <style>{`
        @media print {
          body, html { background: white !important; }
          .no-print { display: none !important; }
          @page { size: A3 landscape; margin: 8mm; }
          .print-table { font-size: 6.5pt !important; }
          .print-table th, .print-table td { padding: 2px 3px !important; }
          .glass-card { background: white !important; box-shadow: none !important; border: 1px solid #e5e7eb !important; border-radius: 4px !important; }
          .modern-dashboard-bg { background: white !important; }
          .print-title { display: block !important; }
          .print-summary { display: flex !important; }
          .print-warning { display: block !important; }
          tr.row-gekuendigt td { background: #fff7ed !important; }
          tr.row-vacant td { background: #fefce8 !important; }
        }
        .print-title { display: none; }
        .print-summary { display: none; }
        .print-warning { display: none; }
      `}</style>

      <div className="container mx-auto px-4 py-6">

        {/* Screen header */}
        <div className="glass-card p-4 sm:p-6 rounded-2xl mb-4 no-print">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Button onClick={onBack} variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Zurück
              </Button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-sans text-gradient-red">Mietaufstellung für Bank</h1>
                <p className="text-xs text-gray-500 mt-0.5">Stand: {format(new Date(), "dd.MM.yyyy")} · SOLL-Wert anklicken zum Bearbeiten</p>
              </div>
            </div>
            <Button onClick={() => window.print()} className="bg-red-600 hover:bg-red-700 text-white">
              <Printer className="h-4 w-4 mr-2" />
              Als PDF drucken
            </Button>
          </div>
        </div>

        {/* Print-only title + summary */}
        <div className="print-title mb-3">
          <h1 className="text-xl font-bold">Mietaufstellung für Bank</h1>
          <p className="text-xs text-gray-500">Stand: {format(new Date(), "dd.MM.yyyy")}</p>
        </div>
        <div className="print-summary gap-6 mb-4 text-xs border border-gray-300 rounded p-3">
          <div><span className="text-gray-500">Gesamtfläche:</span> <b>{fmt(grandTotals.qm, 0)} m²</b></div>
          <div><span className="text-gray-500">IST p.m.:</span> <b>{fmtEuro(grandTotals.ist)}</b></div>
          <div><span className="text-gray-500">IST p.a.:</span> <b>{fmtEuro(grandTotals.ist * 12)}</b></div>
          <div><span className="text-gray-500">SOLL p.m.:</span> <b>{fmtEuro(grandTotals.soll)}</b></div>
          <div><span className="text-gray-500">Annuität p.m.:</span> <b>{fmtEuro(grandTotals.annuitaet)}</b></div>
          <div><span className="text-gray-500">Leerstand:</span> <b>{grandTotals.vacantCount} Einh.</b></div>
        </div>

        {/* Warning-Banner: fehlende SOLL-Mieten */}
        {grandTotals.missingSollCount > 0 && (
          <div className="no-print mb-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <b>{grandTotals.missingSollCount} Leerstand-Einheit{grandTotals.missingSollCount > 1 ? "en" : ""}</b> ohne SOLL-Miete —
              die SOLL-Gesamtsumme ist dadurch unvollständig. Bitte direkt in der Tabelle eintragen.
            </p>
          </div>
        )}

        {/* Summary-Karten */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4 no-print">
          {[
            { label: "Gesamtfläche", value: `${fmt(grandTotals.qm, 0)} m²` },
            { label: "IST-Miete p.m.", value: fmtEuro(grandTotals.ist) },
            { label: "IST-Miete p.a.", value: fmtEuro(grandTotals.ist * 12) },
            { label: "SOLL-Miete p.m.", value: fmtEuro(grandTotals.soll), note: grandTotals.missingSollCount > 0 ? `${grandTotals.missingSollCount} fehlen` : undefined, noteColor: "text-amber-600" },
            { label: "Annuität p.m.", value: fmtEuro(grandTotals.annuitaet) },
            {
              label: "Leerstand",
              value: `${grandTotals.vacantCount} Einh.`,
              note: grandTotals.gekuendigtCount > 0 ? `+ ${grandTotals.gekuendigtCount} läuft aus` : undefined,
              noteColor: "text-orange-500",
              negative: grandTotals.vacantCount > 0,
            },
            {
              label: "Überschuss IST p.a.",
              value: fmtEuro((grandTotals.ist - grandTotals.annuitaet) * 12),
              negative: (grandTotals.ist - grandTotals.annuitaet) < 0,
            },
          ].map(({ label, value, note, noteColor, negative }) => (
            <div key={label} className="glass-card rounded-xl p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className={cn("font-bold text-sm font-mono", negative && "text-red-600")}>{value}</div>
              {note && <div className={cn("text-[10px] mt-0.5", noteColor)}>{note}</div>}
            </div>
          ))}
        </div>

        {/* Haupt-Tabelle */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse print-table">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">Nr.</th>
                  <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Lage</th>
                  <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Nutzung</th>
                  <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Mieter / Status</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Fläche m²</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">€/m²</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">KM</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">BKV</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Gesamt-<br />miete</th>
                  <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Laufzeit</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">IST<br />p.m.</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">IST<br />p.a.</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">SOLL<br />p.m.</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">SOLL<br />p.a.</th>
                  <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Diff.<br />p.m.</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let nr = 0;
                  return grouped.flatMap((imm) => {
                    // IST: nur nicht-leere Einheiten
                    const immKm  = imm.units.reduce((s, u) => s + (u.kaltmiete ?? 0), 0);
                    const immBkv = imm.units.reduce((s, u) => s + (u.betriebskosten ?? 0), 0);
                    const immIst = immKm + immBkv;
                    const immSoll = imm.units.reduce((s, u) => {
                      const istPm = (u.kaltmiete ?? 0) + (u.betriebskosten ?? 0);
                      return s + (u.sollMiete ?? (u.isVacant ? 0 : istPm));
                    }, 0);
                    const immQm  = imm.units.reduce((s, u) => s + (u.qm ?? 0), 0);
                    const immVacant = imm.units.filter(u => u.isVacant).length;
                    const immGekuendigt = imm.units.filter(u => u.isGekuendigt).length;
                    const ueberschussIst  = (immIst  - (imm.annuitaet ?? 0)) * 12;
                    const ueberschussSoll = (immSoll - (imm.annuitaet ?? 0)) * 12;

                    const headerRow = (
                      <tr key={`h-${imm.id}`} className="bg-orange-100 border-t-2 border-b border-orange-300">
                        <td colSpan={2} className="px-2 py-2 font-bold text-orange-900 whitespace-nowrap">
                          {imm.name}
                        </td>
                        <td colSpan={2} className="px-2 py-2 text-orange-700 text-xs">
                          {imm.adresse}
                          {immVacant > 0 && (
                            <span className="ml-2 text-yellow-700 font-semibold">· {immVacant}× Leerstand</span>
                          )}
                          {immGekuendigt > 0 && (
                            <span className="ml-2 text-orange-600 font-semibold">· {immGekuendigt}× läuft aus</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">
                          {fmt(immQm, 0)} m²
                        </td>
                        <td className="px-2 py-2" />
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immKm)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immBkv)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immIst)}</td>
                        <td className="px-2 py-2 text-xs text-orange-800">
                          Annuität: <span className="font-semibold tabular-nums">{fmtEuro(imm.annuitaet)}</span>
                          <span className="mx-1.5 text-orange-400">|</span>
                          Überschuss IST:{" "}
                          <span className={cn("font-semibold tabular-nums", ueberschussIst < 0 ? "text-red-600" : "text-green-700")}>
                            {fmtEuro(ueberschussIst)}
                          </span>
                          {" / "}SOLL:{" "}
                          <span className={cn("font-semibold tabular-nums", ueberschussSoll < 0 ? "text-red-600" : "text-green-700")}>
                            {fmtEuro(ueberschussSoll)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immIst)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immIst * 12)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immSoll)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-900 tabular-nums">{fmtEuro(immSoll * 12)}</td>
                        <td className="px-2 py-2" />
                      </tr>
                    );

                    const unitRows = imm.units.map((unit) => {
                      nr++;
                      const istPm  = (unit.kaltmiete ?? 0) + (unit.betriebskosten ?? 0);
                      const sollPm = unit.sollMiete ?? (unit.isVacant ? null : istPm);
                      const diffPm = sollPm != null ? (istPm - sollPm) : null;
                      const eurProQm = unit.kaltmiete && unit.qm ? unit.kaltmiete / unit.qm : null;
                      const sollNotSet = unit.sollMiete == null;
                      const isEditing = unit.einheitId in editing;

                      // Laufzeit-Text je nach Status
                      let laufzeit: string;
                      if (unit.isVacant) {
                        laufzeit = unit.lastEndDate
                          ? `Leerstand · bis ${fmtDate(unit.lastEndDate)}`
                          : "LEERSTAND";
                      } else if (unit.endeDatum) {
                        laufzeit = `${fmtDate(unit.startDatum)} – ${fmtDate(unit.endeDatum)}${unit.isGekuendigt ? " (gek.)" : ""}`;
                      } else {
                        laufzeit = `seit ${fmtDate(unit.startDatum)}`;
                      }

                      return (
                        <tr
                          key={unit.einheitId}
                          className={cn(
                            "border-b border-gray-100 transition-colors",
                            unit.isVacant && "row-vacant bg-yellow-50/70",
                            unit.isGekuendigt && "row-gekuendigt bg-orange-50/50",
                            !unit.isVacant && !unit.isGekuendigt && "hover:bg-gray-50"
                          )}
                        >
                          <td className="px-2 py-1.5 text-center text-gray-400 tabular-nums">{nr}</td>
                          <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{unit.etage ?? "—"}</td>
                          <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{unit.einheitentyp ?? "—"}</td>

                          {/* Mieter / Status */}
                          <td className="px-2 py-1.5 max-w-[160px]">
                            {unit.isVacant ? (
                              <span className="text-yellow-700 font-medium">LEERSTAND</span>
                            ) : unit.isGekuendigt ? (
                              <div>
                                <span className="block truncate" title={unit.mieterNames.join(", ")}>
                                  {unit.mieterNames.join(", ") || "—"}
                                </span>
                                <span className="text-orange-600 text-[10px] font-medium">⚠ Vertrag gekündigt</span>
                              </div>
                            ) : (
                              <span className="block truncate" title={unit.mieterNames.join(", ")}>
                                {unit.mieterNames.join(", ") || "—"}
                              </span>
                            )}
                          </td>

                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                            {unit.qm != null ? fmt(unit.qm, 0) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                            {unit.isVacant ? "—" : eurProQm != null ? fmt(eurProQm, 2) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                            {unit.isVacant ? <span className="text-gray-400">0,00 €</span> : fmtEuro(unit.kaltmiete)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                            {unit.isVacant ? <span className="text-gray-400">0,00 €</span> : fmtEuro(unit.betriebskosten)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-gray-700">
                            {unit.isVacant ? <span className="text-gray-400">0,00 €</span> : fmtEuro(istPm)}
                          </td>

                          {/* Laufzeit */}
                          <td className={cn(
                            "px-2 py-1.5 text-xs whitespace-nowrap",
                            unit.isVacant && "text-yellow-700",
                            unit.isGekuendigt && "text-orange-600",
                            !unit.isVacant && !unit.isGekuendigt && "text-gray-500"
                          )}>
                            {laufzeit}
                          </td>

                          {/* IST p.m. */}
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {unit.isVacant
                              ? <span className="text-gray-400">0,00 €</span>
                              : <span className="text-gray-700">{fmtEuro(istPm)}</span>}
                          </td>
                          {/* IST p.a. */}
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {unit.isVacant
                              ? <span className="text-gray-400">0,00 €</span>
                              : <span className="text-gray-700">{fmtEuro(istPm * 12)}</span>}
                          </td>

                          {/* SOLL p.m. — editierbar, auch für Leerstand */}
                          <td className="px-1 py-1">
                            {isEditing ? (
                              <div className="flex items-center gap-0.5 justify-end">
                                <Input
                                  className="h-6 w-[4.5rem] text-xs text-right py-0 px-1"
                                  value={editing[unit.einheitId]}
                                  onChange={(e) =>
                                    setEditing((prev) => ({ ...prev, [unit.einheitId]: e.target.value }))
                                  }
                                  onBlur={() => handleSave(unit.einheitId, editing[unit.einheitId])}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSave(unit.einheitId, editing[unit.einheitId]);
                                    if (e.key === "Escape")
                                      setEditing((prev) => { const n = { ...prev }; delete n[unit.einheitId]; return n; });
                                  }}
                                  autoFocus
                                />
                                <button
                                  className="text-green-600 shrink-0"
                                  onMouseDown={(e) => { e.preventDefault(); handleSave(unit.einheitId, editing[unit.einheitId]); }}
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                className={cn(
                                  "text-right w-full rounded px-1 py-0.5 group flex items-center justify-end gap-0.5",
                                  "hover:bg-blue-50 cursor-pointer no-print-cursor"
                                )}
                                onClick={() =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [unit.einheitId]: String(unit.sollMiete ?? (unit.isVacant ? "" : istPm)),
                                  }))
                                }
                                title="Klicken zum Bearbeiten"
                              >
                                {sollNotSet && unit.isVacant ? (
                                  <span className="text-red-500 font-medium flex items-center gap-0.5 text-[10px]">
                                    <AlertTriangle className="h-2.5 w-2.5 no-print" />
                                    Nicht gesetzt
                                  </span>
                                ) : (
                                  <span className={cn(
                                    "tabular-nums",
                                    sollNotSet && !unit.isVacant && "text-gray-400 italic"
                                  )}>
                                    {sollPm != null ? fmtEuro(sollPm) : "—"}
                                  </span>
                                )}
                                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-40 shrink-0 no-print" />
                              </button>
                            )}
                          </td>

                          {/* SOLL p.a. */}
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                            {unit.sollMiete != null ? fmtEuro(unit.sollMiete * 12) : "—"}
                          </td>

                          {/* Diff. p.m. (IST – SOLL) */}
                          <td
                            className={cn(
                              "px-2 py-1.5 text-right tabular-nums",
                              diffPm != null && diffPm > 0 && "text-orange-600 font-medium",
                              diffPm != null && diffPm < 0 && "text-green-600 font-medium",
                              (diffPm == null || diffPm === 0) && "text-gray-300"
                            )}
                          >
                            {diffPm != null && diffPm !== 0 ? fmtEuro(diffPm) : "—"}
                          </td>
                        </tr>
                      );
                    });

                    return [headerRow, ...unitRows];
                  });
                })()}

                {/* Gesamt-Zeile */}
                <tr className="bg-gray-800 text-white border-t-2 border-gray-600">
                  <td colSpan={4} className="px-2 py-2 font-bold">
                    Gesamt
                    {grandTotals.missingSollCount > 0 && (
                      <span className="ml-2 text-amber-400 text-[10px] font-normal">
                        ({grandTotals.missingSollCount} Leerstand ohne SOLL)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmt(grandTotals.qm, 0)} m²</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.km)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.bkv)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist)}</td>
                  <td className="px-2 py-2 text-xs">
                    Annuität ges.:{" "}
                    <span className="font-semibold tabular-nums">{fmtEuro(grandTotals.annuitaet)}</span>
                    <span className="mx-1.5 opacity-40">|</span>
                    Überschuss IST:{" "}
                    <span className={cn("font-semibold tabular-nums", (grandTotals.ist - grandTotals.annuitaet) < 0 ? "text-red-400" : "text-green-400")}>
                      {fmtEuro((grandTotals.ist - grandTotals.annuitaet) * 12)} p.a.
                    </span>
                    {grandTotals.vacantCount > 0 && (
                      <>
                        <span className="mx-1.5 opacity-40">|</span>
                        <span className="text-yellow-400">{grandTotals.vacantCount} Leerstand</span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist * 12)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.soll)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{fmtEuro(grandTotals.soll * 12)}</td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums font-bold",
                      (grandTotals.ist - grandTotals.soll) > 0 && "text-orange-300",
                      (grandTotals.ist - grandTotals.soll) < 0 && "text-green-300",
                    )}
                  >
                    {grandTotals.ist !== grandTotals.soll ? fmtEuro(grandTotals.ist - grandTotals.soll) : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-400 text-center no-print">
          SOLL-Wert anklicken zum Bearbeiten (Enter = speichern, Esc = abbrechen) ·
          Kursiv/grau = kein SOLL gesetzt (Fallback auf IST) ·
          <span className="text-red-400"> Rot = Leerstand ohne SOLL (bitte eintragen)</span>
        </p>
      </div>
    </div>
  );
};
