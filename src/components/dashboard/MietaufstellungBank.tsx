import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Printer, Pencil, Check, Loader2 } from "lucide-react";
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
  kaltmiete: number | null;
  betriebskosten: number | null;
  startDatum: string | null;
  endeDatum: string | null;
  mieterNames: string[];
  isVacant: boolean;
  isGekuendigt: boolean;
  lastEndDate: string | null;
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
      const [einheitenRes, darlehenRes] = await Promise.all([
        supabase.from("einheiten").select(`
          id, etage, qm, einheitentyp, soll_miete,
          immobilien!inner( id, name, adresse ),
          mietvertrag(
            id, status, kaltmiete, betriebskosten, start_datum, ende_datum,
            mietvertrag_mieter( mieter( vorname, nachname ) )
          )
        `),
        supabase.from("darlehen_immobilien").select(`
          immobilie_id,
          darlehen( monatliche_rate )
        `),
      ]);
      if (einheitenRes.error) throw einheitenRes.error;

      // Variante C: jede Immobilie trägt die volle Rate jedes verknüpften Darlehens
      const annMap = new Map<string, number>();
      for (const di of darlehenRes.data ?? []) {
        const rate = (di.darlehen as any)?.monatliche_rate ?? 0;
        if (di.immobilie_id && rate > 0)
          annMap.set(di.immobilie_id, (annMap.get(di.immobilie_id) ?? 0) + rate);
      }

      return (einheitenRes.data ?? []).map((e): UnitRow => {
        const imm = e.immobilien as any;
        const contracts = (e.mietvertrag ?? []) as any[];
        const currentContract = getCurrentContract(contracts);

        const isVacant = !currentContract || currentContract.status === "beendet";
        const isGekuendigt = !isVacant && currentContract?.status === "gekuendigt";
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
          immobilieAnnuitaet: annMap.get(imm.id) ?? null,
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

  // SOLL-Miete speichern (einheiten.soll_miete)
  const handleSave = useCallback(
    async (einheitId: string, valueStr: string) => {
      const trimmed = valueStr.trim();
      const value = trimmed === "" ? null : parseFloat(trimmed.replace(",", "."));
      setEditing((prev) => { const next = { ...prev }; delete next[einheitId]; return next; });
      if (value !== null && (isNaN(value) || value < 0)) return;
      const { error } = await supabase.from("einheiten").update({ soll_miete: value }).eq("id", einheitId);
      if (error) {
        toast({ title: "Fehler", description: "SOLL-Miete konnte nicht gespeichert werden.", variant: "destructive" });
      } else {
        queryClient.setQueryData(["mietaufstellung-bank"], (old: UnitRow[] | undefined) =>
          (old ?? []).map((row) => row.einheitId === einheitId ? { ...row, sollMiete: value } : row)
        );
        queryClient.invalidateQueries({ queryKey: ["miet-overview"] });
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
    let vacantCount = 0, gekuendigtCount = 0;
    const annuitaetMap = new Map<string, number>();

    for (const row of rows) {
      qm += row.qm ?? 0;
      if (!row.isVacant) {
        km += row.kaltmiete ?? 0;
        bkv += row.betriebskosten ?? 0;
      } else {
        vacantCount++;
      }
      if (row.isGekuendigt) gekuendigtCount++;
      soll += row.sollMiete ?? (row.isVacant ? 0 : (row.kaltmiete ?? 0));
      if (row.immobilieAnnuitaet != null) annuitaetMap.set(row.immobilieId, row.immobilieAnnuitaet);
    }

    const annuitaet = Array.from(annuitaetMap.values()).reduce((s, v) => s + v, 0);
    const ist = km; // IST = nur Kaltmiete, BKV wird ignoriert
    return { qm, km, bkv, ist, soll, annuitaet, vacantCount, gekuendigtCount };
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
    <div className="min-h-screen modern-dashboard-bg mietaufstellung-print-root">
      <style>{`
        @media print {
          /* Alles ausblenden – nur unseren Print-Container zeigen */
          html, body { background: white !important; }
          body { visibility: hidden !important; }
          .mietaufstellung-print-root { visibility: visible !important; }
          .mietaufstellung-print-root * { visibility: visible !important; }
          /* Bedienelemente innerhalb des Containers trotzdem verstecken */
          .no-print,
          .no-print * { visibility: hidden !important; display: none !important; }
          @page { size: A3 landscape; margin: 6mm; }
          .print-table { font-size: 6pt !important; width: 100% !important; }
          .print-table th, .print-table td { padding: 1.5px 3px !important; white-space: nowrap !important; }
          .glass-card { background: white !important; box-shadow: none !important; border: none !important; border-radius: 0 !important; }
          .modern-dashboard-bg { background: white !important; }
          .print-title { display: block !important; }
          .print-title * { color: #000 !important; }
          .print-summary { display: flex !important; }
          .print-summary * { color: #000 !important; }
        }
        .print-title { display: none; }
        .print-summary { display: none; }
      `}</style>

      <div className="px-4 py-6">

        {/* Header */}
        <div className="glass-card p-4 sm:p-6 rounded-2xl mb-4 no-print">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Button onClick={onBack} variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Zurück
              </Button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold font-sans text-gradient-red">Mietaufstellung</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  Stand: {format(new Date(), "dd.MM.yyyy")} · SOLL-Miete direkt editierbar · Annuität aus Darlehen
                </p>
              </div>
            </div>
            <Button onClick={() => window.print()} className="bg-red-600 hover:bg-red-700 text-white">
              <Printer className="h-4 w-4 mr-2" />
              Als PDF drucken
            </Button>
          </div>
        </div>

        {/* Print-only Titel + Kennzahlen */}
        <div className="print-title mb-3">
          <h1 className="text-xl font-bold">Mietaufstellung der Nimo Wohnungsbaugesellschaft MBH</h1>
          <p className="text-xs">Stand: {format(new Date(), "dd.MM.yyyy")}</p>
        </div>
        <div className="print-summary gap-6 mb-4 text-xs border border-gray-400 rounded p-3">
          <div><span>Überschuss p.m.:</span> <b>{fmtEuro(grandTotals.ist - grandTotals.annuitaet)}</b></div>
          <div><span>Überschuss p.a.:</span> <b>{fmtEuro((grandTotals.ist - grandTotals.annuitaet) * 12)}</b></div>
          <div><span>IST p.m.:</span>         <b>{fmtEuro(grandTotals.ist)}</b></div>
          <div><span>IST p.a.:</span>         <b>{fmtEuro(grandTotals.ist * 12)}</b></div>
          <div><span>SOLL p.m.:</span>        <b>{fmtEuro(grandTotals.soll)}</b></div>
          <div><span>SOLL p.a.:</span>        <b>{fmtEuro(grandTotals.soll * 12)}</b></div>
          <div><span>Annuität p.m.:</span>    <b>{fmtEuro(grandTotals.annuitaet)}</b></div>
          <div><span>Leerstand:</span>        <b>{grandTotals.vacantCount} Einh.</b></div>
        </div>

        {/* Kennzahlen-Karten */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4 no-print">
          {[
            { label: "Überschuss p.m.", value: fmtEuro(grandTotals.ist - grandTotals.annuitaet), negative: (grandTotals.ist - grandTotals.annuitaet) < 0 },
            { label: "Überschuss p.a.", value: fmtEuro((grandTotals.ist - grandTotals.annuitaet) * 12), negative: (grandTotals.ist - grandTotals.annuitaet) < 0 },
            { label: "IST p.m.", value: fmtEuro(grandTotals.ist) },
            { label: "IST p.a.", value: fmtEuro(grandTotals.ist * 12) },
            { label: "SOLL p.m.", value: fmtEuro(grandTotals.soll) },
            { label: "SOLL p.a.", value: fmtEuro(grandTotals.soll * 12) },
            { label: "Annuität p.m.", value: fmtEuro(grandTotals.annuitaet) },
            { label: "Leerstand", value: `${grandTotals.vacantCount} Einh.` },
          ].map(({ label, value, negative }) => (
            <div key={label} className="glass-card rounded-xl p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className={cn("font-bold text-sm font-mono", negative && "text-red-600")}>{value}</div>
            </div>
          ))}
        </div>

        {/* Haupt-Tabelle */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <table className="w-full text-[11px] border-collapse print-table">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="px-1.5 py-1.5 text-center font-semibold whitespace-nowrap w-7">Nr.</th>
                <th className="px-1.5 py-1.5 text-left font-semibold whitespace-nowrap">Lage</th>
                <th className="px-1.5 py-1.5 text-left font-semibold whitespace-nowrap">Nutzung</th>
                <th className="px-1.5 py-1.5 text-left font-semibold">Mieter</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">m²</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">€/m²</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">KM</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">BKV</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Gesamt</th>
                <th className="px-1.5 py-1.5 text-left font-semibold whitespace-nowrap">Laufzeit</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">IST p.m.</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">IST p.a.</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">SOLL p.m.</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">SOLL p.a.</th>
                <th className="px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Diff.</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let nr = 0;
                return grouped.flatMap((imm) => {
                  const immKm   = imm.units.reduce((s, u) => s + (u.kaltmiete ?? 0), 0);
                  const immBkv  = imm.units.reduce((s, u) => s + (u.betriebskosten ?? 0), 0);
                  const immIst  = immKm; // IST = nur Kaltmiete
                  const immSoll = imm.units.reduce((s, u) => {
                    return s + (u.sollMiete ?? (u.isVacant ? 0 : (u.kaltmiete ?? 0)));
                  }, 0);
                  const immQm      = imm.units.reduce((s, u) => s + (u.qm ?? 0), 0);
                  const immVacant  = imm.units.filter(u => u.isVacant).length;
                  const ueberschussIst  = (immIst  - (imm.annuitaet ?? 0)) * 12;
                  const ueberschussSoll = (immSoll - (imm.annuitaet ?? 0)) * 12;

                  const headerRow = (
                    <tr key={`h-${imm.id}`} className="bg-gray-100 border-t-2 border-b border-gray-300">
                      <td colSpan={2} className="px-1.5 py-1.5 font-bold text-gray-800 whitespace-nowrap">
                        {imm.name}
                        {immVacant > 0 && (
                          <span className="ml-2 text-gray-400 font-normal text-[10px]">· {immVacant} leer</span>
                        )}
                      </td>
                      <td colSpan={2} className="px-1.5 py-1.5 text-gray-500 text-[10px]">
                        {imm.adresse}
                      </td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">
                        {fmt(immQm, 0)} m²
                      </td>
                      <td className="px-1.5 py-1.5" />
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immKm)}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immBkv)}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immIst)}</td>

                      {/* Laufzeit-Spalte: Annuität (aus Darlehen, read-only) + Überschuss */}
                      <td className="px-1.5 py-1.5 text-[10px] text-gray-600 whitespace-nowrap">
                        <span>
                          Annuität:{" "}
                          <b className="tabular-nums">
                            {imm.annuitaet != null ? fmtEuro(imm.annuitaet) : <span className="text-gray-400 font-normal">—</span>}
                          </b>
                          {" p.m."}
                        </span>
                        <span className="mx-1 text-gray-300">|</span>
                        Überschuss IST:{" "}
                        <span className={cn("font-semibold tabular-nums", ueberschussIst < 0 ? "text-red-600" : "text-emerald-600")}>
                          {fmtEuro(ueberschussIst)}
                        </span>
                        {" / "}SOLL:{" "}
                        <span className={cn("font-semibold tabular-nums", ueberschussSoll < 0 ? "text-red-600" : "text-emerald-600")}>
                          {fmtEuro(ueberschussSoll)}
                        </span>
                      </td>

                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immIst)}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immIst * 12)}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immSoll)}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold text-gray-700 tabular-nums">{fmtEuro(immSoll * 12)}</td>
                      <td className="px-1.5 py-1.5" />
                    </tr>
                  );

                  const unitRows = imm.units.map((unit) => {
                    nr++;
                    const istPm   = unit.kaltmiete ?? 0; // IST = nur Kaltmiete
                    const sollPm  = unit.sollMiete ?? (unit.isVacant ? null : istPm);
                    const diffPm  = sollPm != null && !unit.isVacant ? (istPm - sollPm) : null;
                    const eurProQm = unit.kaltmiete && unit.qm ? unit.kaltmiete / unit.qm : null;
                    const isEditing = unit.einheitId in editing;

                    let laufzeit: string;
                    if (unit.isVacant) {
                      laufzeit = unit.lastEndDate ? `leer · bis ${fmtDate(unit.lastEndDate)}` : "—";
                    } else if (unit.endeDatum) {
                      laufzeit = `${fmtDate(unit.startDatum)} – ${fmtDate(unit.endeDatum)}${unit.isGekuendigt ? " (gek.)" : ""}`;
                    } else {
                      laufzeit = `seit ${fmtDate(unit.startDatum)}`;
                    }

                    return (
                      <tr
                        key={unit.einheitId}
                        className="border-b border-gray-100 hover:bg-gray-50/60 transition-colors"
                      >
                        <td className="px-1.5 py-1 text-center text-gray-300 tabular-nums">{nr}</td>
                        <td className="px-1.5 py-1 text-gray-600 whitespace-nowrap">{unit.etage ?? "—"}</td>
                        <td className="px-1.5 py-1 text-gray-600 whitespace-nowrap">{unit.einheitentyp ?? "—"}</td>

                        {/* Mieter */}
                        <td className="px-1.5 py-1 max-w-[140px]">
                          {unit.isVacant ? (
                            <span className="text-gray-400 italic">Leerstand</span>
                          ) : (
                            <div>
                              <span className="block truncate text-gray-700" title={unit.mieterNames.join(", ")}>
                                {unit.mieterNames.join(", ") || "—"}
                              </span>
                              {unit.isGekuendigt && (
                                <span className="text-gray-400 text-[10px]">gek. bis {fmtDate(unit.endeDatum)}</span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600">
                          {unit.qm != null ? fmt(unit.qm, 0) : "—"}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-400">
                          {unit.isVacant ? "—" : eurProQm != null ? fmt(eurProQm, 2) : "—"}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600">
                          {unit.isVacant ? "—" : fmtEuro(unit.kaltmiete)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-400">
                          {unit.isVacant ? "—" : fmtEuro(unit.betriebskosten)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600 font-medium">
                          {unit.isVacant ? "—" : fmtEuro(istPm)}
                        </td>

                        <td className="px-1.5 py-1 text-gray-400 text-[10px] whitespace-nowrap">{laufzeit}</td>

                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600">
                          {unit.isVacant ? "—" : fmtEuro(istPm)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600">
                          {unit.isVacant ? "—" : fmtEuro(istPm * 12)}
                        </td>

                        {/* SOLL p.m. — editierbar */}
                        <td className="px-1 py-1">
                          {isEditing ? (
                            <div className="flex items-center gap-0.5 justify-end">
                              <Input
                                className="h-6 w-[4.5rem] text-[11px] text-right py-0 px-1"
                                value={editing[unit.einheitId]}
                                onChange={(e) => setEditing((prev) => ({ ...prev, [unit.einheitId]: e.target.value }))}
                                onBlur={() => handleSave(unit.einheitId, editing[unit.einheitId])}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSave(unit.einheitId, editing[unit.einheitId]);
                                  if (e.key === "Escape") setEditing((prev) => { const n = { ...prev }; delete n[unit.einheitId]; return n; });
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
                              className="text-right w-full rounded px-1 py-0.5 group flex items-center justify-end gap-0.5 hover:bg-gray-100"
                              onClick={() =>
                                setEditing((prev) => ({
                                  ...prev,
                                  [unit.einheitId]: String(unit.sollMiete ?? (unit.isVacant ? "" : istPm)),
                                }))
                              }
                              title="Klicken zum Bearbeiten"
                            >
                              <span className={cn(
                                "tabular-nums",
                                unit.sollMiete == null && !unit.isVacant && "text-gray-400 italic",
                                unit.sollMiete == null && unit.isVacant && "text-gray-300 italic",
                                unit.sollMiete != null && "text-gray-700",
                              )}>
                                {sollPm != null ? fmtEuro(sollPm) : "—"}
                              </span>
                              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-30 shrink-0 no-print" />
                            </button>
                          )}
                        </td>

                        <td className="px-1.5 py-1 text-right tabular-nums text-gray-600">
                          {unit.sollMiete != null ? fmtEuro(unit.sollMiete * 12) : "—"}
                        </td>

                        <td className={cn(
                          "px-1.5 py-1 text-right tabular-nums",
                          diffPm != null && diffPm > 0  && "text-amber-600 font-medium",
                          diffPm != null && diffPm < 0  && "text-emerald-600 font-medium",
                          (diffPm == null || diffPm === 0) && "text-gray-300"
                        )}>
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
                <td colSpan={4} className="px-1.5 py-1.5 font-bold">
                  Gesamt
                  {grandTotals.vacantCount > 0 && (
                    <span className="ml-2 text-gray-400 text-[10px] font-normal">
                      · {grandTotals.vacantCount} Einh. leer
                    </span>
                  )}
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmt(grandTotals.qm, 0)} m²</td>
                <td className="px-1.5 py-1.5" />
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.km)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.bkv)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist)}</td>
                <td className="px-1.5 py-1.5 text-[10px]">
                  Annuität ges.:{" "}
                  <span className="font-semibold tabular-nums">{fmtEuro(grandTotals.annuitaet)}</span>
                  <span className="mx-1.5 opacity-40">|</span>
                  Überschuss IST:{" "}
                  <span className={cn("font-semibold tabular-nums", (grandTotals.ist - grandTotals.annuitaet) < 0 ? "text-red-400" : "text-emerald-400")}>
                    {fmtEuro((grandTotals.ist - grandTotals.annuitaet) * 12)} p.a.
                  </span>
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.ist * 12)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.soll)}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{fmtEuro(grandTotals.soll * 12)}</td>
                <td className={cn(
                  "px-1.5 py-1.5 text-right tabular-nums font-bold",
                  (grandTotals.ist - grandTotals.soll) > 0 && "text-amber-300",
                  (grandTotals.ist - grandTotals.soll) < 0 && "text-emerald-300",
                )}>
                  {grandTotals.ist !== grandTotals.soll ? fmtEuro(grandTotals.ist - grandTotals.soll) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-gray-400 text-center no-print">
          SOLL-Miete direkt anklicken zum Bearbeiten · Leeres Feld speichern = SOLL löschen · Annuität wird aus hinterlegten Darlehen berechnet
        </p>
      </div>
    </div>
  );
};
