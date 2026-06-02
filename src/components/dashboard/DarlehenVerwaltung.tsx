import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowLeft, Plus, Pencil, Trash2, Building2, CreditCard,
  X, Percent, ChevronDown, ChevronUp, AlertCircle, Euro,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DarlehenVerwaltungProps {
  onBack: () => void;
}

interface Darlehen {
  id: string;
  bezeichnung: string;
  bank: string | null;
  kontonummer: string | null;
  darlehensbetrag: number;
  restschuld: number | null;
  zinssatz_prozent: number | null;
  tilgungssatz_prozent: number | null;
  monatliche_rate: number | null;
  start_datum: string | null;
  ende_datum: string | null;
  notizen: string | null;
  erstellt_am: string | null;
}

interface Immobilie {
  id: string;
  name: string;
}

interface Zahlung {
  id: string;
  betrag: number;
  buchungsdatum: string;
  empfaengername: string | null;
  iban: string | null;
  verwendungszweck: string | null;
  kategorie: string | null;
}

interface DarlehenImmobilie {
  id: string;
  darlehen_id: string;
  immobilie_id: string;
}

interface TilgungsplanEintrag {
  monat: string;
  datum: Date;
  rate: number;
  zinsanteil: number;
  tilgungsanteil: number;
  restschuld_danach: number;
}

interface DarlehenForm {
  bezeichnung: string;
  bank: string;
  kontonummer: string;
  darlehensbetrag: string;
  restschuld: string;
  zinssatz_prozent: string;
  tilgungssatz_prozent: string;
  monatliche_rate: string;
  start_datum: string;
  ende_datum: string;
  notizen: string;
  immobilien_ids: string[];
}

const FORM_EMPTY: DarlehenForm = {
  bezeichnung: "",
  bank: "",
  kontonummer: "",
  darlehensbetrag: "",
  restschuld: "",
  zinssatz_prozent: "",
  tilgungssatz_prozent: "",
  monatliche_rate: "",
  start_datum: "",
  ende_datum: "",
  notizen: "",
  immobilien_ids: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEuro(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function formatProzent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value.toFixed(2).replace(".", ",") + " %";
}

function formatIBAN(raw: string | null | undefined): string {
  if (!raw) return "–";
  const clean = raw.replace(/\s/g, "");
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function parseNum(s: string): number {
  const v = parseFloat(s.replace(",", "."));
  return isNaN(v) ? 0 : v;
}

function berechneTilgungsplan(
  restschuld: number,
  zinssatz: number,
  rate: number,
  endDatum: string | null,
): TilgungsplanEintrag[] {
  if (!rate || !zinssatz || !restschuld) return [];

  const plan: TilgungsplanEintrag[] = [];
  let rs = restschuld;
  const zinsMtl = zinssatz / 100 / 12;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let maxMonate = 360;
  if (endDatum) {
    const end = new Date(endDatum);
    const diffMs = end.getTime() - start.getTime();
    maxMonate = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30)));
  }

  for (let i = 0; i < maxMonate && rs > 0.01; i++) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const zinsanteil = rs * zinsMtl;
    const tilgungsanteil = Math.min(rate - zinsanteil, rs);
    if (tilgungsanteil <= 0) break;
    const rs_nach = Math.max(0, rs - tilgungsanteil);

    plan.push({
      monat: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      datum: date,
      rate: zinsanteil + tilgungsanteil,
      zinsanteil,
      tilgungsanteil,
      restschuld_danach: rs_nach,
    });

    rs = rs_nach;
  }

  return plan;
}

function berechneAutoRate(darlehensbetrag: number, zinssatz: number, tilgungssatz: number): number {
  return (darlehensbetrag * (zinssatz + tilgungssatz)) / 100 / 12;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DarlehenVerwaltung({ onBack }: DarlehenVerwaltungProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("tilgungsplan");
  const [showAllMonate, setShowAllMonate] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<DarlehenForm>(FORM_EMPTY);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: darlehen = [], isLoading } = useQuery<Darlehen[]>({
    queryKey: ["darlehen"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("darlehen")
        .select("*")
        .order("bezeichnung");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: darlehenImmobilien = [] } = useQuery<DarlehenImmobilie[]>({
    queryKey: ["darlehen_immobilien"],
    queryFn: async () => {
      const { data, error } = await supabase.from("darlehen_immobilien").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: immobilien = [] } = useQuery<Immobilie[]>({
    queryKey: ["immobilien_mini"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immobilien")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedDarlehen = darlehen.find((d) => d.id === selectedId) ?? null;

  const { data: zahlungen = [] } = useQuery<Zahlung[]>({
    queryKey: ["darlehen_zahlungen_iban", selectedDarlehen?.kontonummer],
    queryFn: async () => {
      if (!selectedDarlehen?.kontonummer) return [];
      const clean = selectedDarlehen.kontonummer.replace(/\s/g, "");
      const { data, error } = await supabase
        .from("zahlungen")
        .select("id, betrag, buchungsdatum, empfaengername, iban, verwendungszweck, kategorie")
        .ilike("iban", `%${clean}%`)
        .order("buchungsdatum", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedDarlehen?.kontonummer,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string | null; data: DarlehenForm }) => {
      const payload = {
        bezeichnung: data.bezeichnung.trim(),
        bank: data.bank.trim() || null,
        kontonummer: data.kontonummer.trim().replace(/\s/g, "") || null,
        darlehensbetrag: parseNum(data.darlehensbetrag),
        restschuld: parseNum(data.restschuld),
        zinssatz_prozent: parseNum(data.zinssatz_prozent),
        tilgungssatz_prozent: parseNum(data.tilgungssatz_prozent),
        monatliche_rate: parseNum(data.monatliche_rate),
        start_datum: data.start_datum || null,
        ende_datum: data.ende_datum || null,
        notizen: data.notizen.trim() || null,
      };

      let darlehenId = id;

      if (id) {
        const { error } = await supabase.from("darlehen").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase
          .from("darlehen")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        darlehenId = created.id;
      }

      await supabase.from("darlehen_immobilien").delete().eq("darlehen_id", darlehenId!);
      if (data.immobilien_ids.length > 0) {
        await supabase.from("darlehen_immobilien").insert(
          data.immobilien_ids.map((immoId) => ({
            darlehen_id: darlehenId!,
            immobilie_id: immoId,
          })),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["darlehen"] });
      queryClient.invalidateQueries({ queryKey: ["darlehen_immobilien"] });
      closeDialog();
      toast.success(editId ? "Konto aktualisiert" : "Konto erstellt");
    },
    onError: (err: Error) => toast.error("Fehler: " + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("darlehen").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["darlehen"] });
      queryClient.invalidateQueries({ queryKey: ["darlehen_immobilien"] });
      if (selectedId === id) setSelectedId(null);
      setDeleteConfirmId(null);
      toast.success("Konto gelöscht");
    },
    onError: (err: Error) => toast.error("Fehler: " + err.message),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function openCreate() {
    setEditId(null);
    setForm(FORM_EMPTY);
    setShowDialog(true);
  }

  function openEdit(d: Darlehen) {
    const immoIds = darlehenImmobilien
      .filter((di) => di.darlehen_id === d.id)
      .map((di) => di.immobilie_id);
    setEditId(d.id);
    setForm({
      bezeichnung: d.bezeichnung,
      bank: d.bank ?? "",
      kontonummer: d.kontonummer ? formatIBAN(d.kontonummer) : "",
      darlehensbetrag: d.darlehensbetrag ? String(d.darlehensbetrag) : "",
      restschuld: d.restschuld ? String(d.restschuld) : "",
      zinssatz_prozent: d.zinssatz_prozent ? String(d.zinssatz_prozent) : "",
      tilgungssatz_prozent: d.tilgungssatz_prozent ? String(d.tilgungssatz_prozent) : "",
      monatliche_rate: d.monatliche_rate ? String(d.monatliche_rate) : "",
      start_datum: d.start_datum ?? "",
      ende_datum: d.ende_datum ?? "",
      notizen: d.notizen ?? "",
      immobilien_ids: immoIds,
    });
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    setEditId(null);
    setForm(FORM_EMPTY);
  }

  function handleSave() {
    if (!form.bezeichnung.trim()) {
      toast.error("Bitte Bezeichnung angeben");
      return;
    }
    saveMutation.mutate({ id: editId, data: form });
  }

  function handleAutoRate() {
    const db = parseNum(form.darlehensbetrag);
    const zins = parseNum(form.zinssatz_prozent);
    const tilg = parseNum(form.tilgungssatz_prozent);
    if (!db || !zins || !tilg) {
      toast.error("Darlehensbetrag, Zinssatz und Tilgungssatz erforderlich");
      return;
    }
    const rate = berechneAutoRate(db, zins, tilg);
    setForm((f) => ({ ...f, monatliche_rate: rate.toFixed(2) }));
  }

  function toggleImmo(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      immobilien_ids: checked
        ? [...f.immobilien_ids, id]
        : f.immobilien_ids.filter((x) => x !== id),
    }));
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  function getLinkedImmobilien(darlehenId: string): Immobilie[] {
    const ids = darlehenImmobilien
      .filter((di) => di.darlehen_id === darlehenId)
      .map((di) => di.immobilie_id);
    return immobilien.filter((i) => ids.includes(i.id));
  }

  const gesamtschuld = darlehen.reduce((sum, d) => sum + (d.restschuld ?? 0), 0);
  const gesamtrate = darlehen.reduce((sum, d) => sum + (d.monatliche_rate ?? 0), 0);
  const gesamtzins = darlehen.reduce((sum, d) => {
    if (!d.restschuld || !d.zinssatz_prozent) return sum;
    return sum + d.restschuld * (d.zinssatz_prozent / 100 / 12);
  }, 0);

  const tilgungsplan = useMemo(() => {
    if (!selectedDarlehen) return [];
    return berechneTilgungsplan(
      selectedDarlehen.restschuld ?? 0,
      selectedDarlehen.zinssatz_prozent ?? 0,
      selectedDarlehen.monatliche_rate ?? 0,
      selectedDarlehen.ende_datum,
    );
  }, [selectedDarlehen]);

  const angezeigterPlan = showAllMonate ? tilgungsplan : tilgungsplan.slice(0, 24);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-3 py-3 sm:p-4 lg:p-6">

        {/* Header */}
        <div className="glass-card p-3 sm:p-4 rounded-xl mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="h-8 w-8 p-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <CreditCard className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-800">Darlehenskonten</h1>
                <p className="text-xs text-gray-500 hidden sm:block">
                  {darlehen.length} Konten · {formatEuro(gesamtschuld)} Gesamtschuld
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={openCreate}
              className="accent-red h-8 text-xs text-white"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Neues Konto
            </Button>
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="metric-card rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Euro className="h-3.5 w-3.5 text-red-500" />
              <span className="text-xs text-gray-500 font-medium">Gesamtschuld</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-red-600 font-mono">
              {formatEuro(gesamtschuld)}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{darlehen.length} Konten</div>
          </div>
          <div className="metric-card rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Euro className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-xs text-gray-500 font-medium">Rate / Monat</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-orange-600 font-mono">
              {formatEuro(gesamtrate)}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">Annuität gesamt</div>
          </div>
          <div className="metric-card rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Percent className="h-3.5 w-3.5 text-yellow-600" />
              <span className="text-xs text-gray-500 font-medium">Zinsen / Monat</span>
            </div>
            <div className="text-base sm:text-lg font-bold text-yellow-700 font-mono">
              {formatEuro(gesamtzins)}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">aktuell</div>
          </div>
        </div>

        {/* Main content */}
        <div className={`flex flex-col md:flex-row gap-4 ${selectedId ? "md:items-start" : ""}`}>

          {/* Account list */}
          <div className={`${selectedId ? "w-full md:w-80 md:shrink-0" : "w-full"} space-y-2`}>
            {isLoading ? (
              <div className="glass-card rounded-xl p-8 text-center text-gray-400 text-sm">
                Lädt…
              </div>
            ) : darlehen.length === 0 ? (
              <div className="glass-card rounded-xl p-10 flex flex-col items-center gap-3 text-gray-400">
                <CreditCard className="h-10 w-10 opacity-30" />
                <div className="text-sm">Noch keine Darlehenskonten</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCreate}
                >
                  Erstes Konto anlegen
                </Button>
              </div>
            ) : (
              darlehen.map((d) => {
                const linked = getLinkedImmobilien(d.id);
                const isSelected = selectedId === d.id;
                const zinsProMonat =
                  d.restschuld && d.zinssatz_prozent
                    ? d.restschuld * (d.zinssatz_prozent / 100 / 12)
                    : null;
                const tilgungProMonat =
                  d.monatliche_rate && zinsProMonat
                    ? d.monatliche_rate - zinsProMonat
                    : null;

                return (
                  <div
                    key={d.id}
                    onClick={() => {
                      setSelectedId(isSelected ? null : d.id);
                      setShowAllMonate(false);
                    }}
                    className={`glass-card rounded-xl p-3 sm:p-4 cursor-pointer transition-all border-l-4 ${
                      isSelected
                        ? "border-l-primary shadow-md"
                        : "border-l-transparent hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Name */}
                        <div className="font-semibold text-sm text-gray-800 truncate mb-0.5">
                          {d.bezeichnung}
                        </div>

                        {/* Bank */}
                        {d.bank && (
                          <div className="text-xs text-gray-500 mb-1">{d.bank}</div>
                        )}

                        {/* Linked Immobilien */}
                        {linked.length > 0 && (
                          <div className="flex items-center gap-1 mb-1.5">
                            <Building2 className="h-3 w-3 text-gray-400 shrink-0" />
                            <span className="text-xs text-gray-500 truncate">
                              {linked.map((i) => i.name).join(", ")}
                            </span>
                          </div>
                        )}

                        {/* IBAN */}
                        {d.kontonummer && (
                          <div className="font-mono text-xs text-gray-400 mb-2 tracking-wider">
                            {formatIBAN(d.kontonummer)}
                          </div>
                        )}

                        {/* Restschuld + Rate */}
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="font-mono text-sm font-bold text-red-600">
                            {formatEuro(d.restschuld)}
                          </span>
                          {d.monatliche_rate && (
                            <>
                              <span className="text-gray-300 text-xs">·</span>
                              <span className="font-mono text-xs text-gray-500">
                                {formatEuro(d.monatliche_rate)}/Mon.
                              </span>
                            </>
                          )}
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {d.zinssatz_prozent !== null && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {formatProzent(d.zinssatz_prozent)} Zins
                            </Badge>
                          )}
                          {d.tilgungssatz_prozent !== null && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {formatProzent(d.tilgungssatz_prozent)} Tilgung
                            </Badge>
                          )}
                          {zinsProMonat !== null && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 border-yellow-200 text-yellow-700 bg-yellow-50"
                            >
                              {formatEuro(zinsProMonat)} Zinsen
                            </Badge>
                          )}
                          {tilgungProMonat !== null && tilgungProMonat > 0 && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 border-green-200 text-green-700 bg-green-50"
                            >
                              {formatEuro(tilgungProMonat)} Tilgung
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-gray-700"
                          onClick={() => openEdit(d)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-red-500"
                          onClick={() => setDeleteConfirmId(d.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail panel */}
          {selectedDarlehen && (
            <div className="flex-1 min-w-0">
              <div className="glass-card rounded-xl overflow-hidden">
                {/* Detail header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div>
                    <div className="font-semibold text-sm text-gray-800">
                      {selectedDarlehen.bezeichnung}
                    </div>
                    {selectedDarlehen.bank && (
                      <div className="text-xs text-gray-500">{selectedDarlehen.bank}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-gray-400 hover:text-gray-700"
                    onClick={() => setSelectedId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <Tabs
                  value={detailTab}
                  onValueChange={setDetailTab}
                  className="w-full"
                >
                  <div className="px-4 pt-3">
                    <TabsList className="bg-gray-100 h-8">
                      <TabsTrigger value="tilgungsplan" className="text-xs h-7">
                        Tilgungsplan
                      </TabsTrigger>
                      <TabsTrigger value="zahlungen" className="text-xs h-7">
                        Zahlungen
                      </TabsTrigger>
                      <TabsTrigger value="details" className="text-xs h-7">
                        Details
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* ── Tilgungsplan ── */}
                  <TabsContent value="tilgungsplan" className="px-4 pb-4 mt-3">
                    {!selectedDarlehen.restschuld ||
                    !selectedDarlehen.zinssatz_prozent ||
                    !selectedDarlehen.monatliche_rate ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                        <AlertCircle className="h-8 w-8 opacity-40" />
                        <div className="text-sm text-center">
                          Zinssatz, Rate und Restschuld hinterlegen,
                          <br />
                          um den Tilgungsplan zu berechnen.
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1"
                          onClick={() => openEdit(selectedDarlehen)}
                        >
                          Jetzt bearbeiten
                        </Button>
                      </div>
                    ) : tilgungsplan.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-amber-600">
                        <AlertCircle className="h-8 w-8 opacity-70" />
                        <div className="text-sm text-center font-medium">
                          Rate deckt die Zinsen nicht
                        </div>
                        <div className="text-xs text-gray-500 text-center max-w-xs">
                          Die monatliche Rate ({selectedDarlehen.monatliche_rate?.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €) ist niedriger als die monatlichen Zinsen. Das Darlehen kann so nicht getilgt werden. Bitte Rate erhöhen.
                        </div>
                        <Button variant="outline" size="sm" className="mt-1" onClick={() => openEdit(selectedDarlehen)}>
                          Rate anpassen
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs text-gray-500">
                            Ab {format(new Date(), "MMMM yyyy", { locale: de })} ·{" "}
                            {tilgungsplan.length} Raten
                            {selectedDarlehen.ende_datum &&
                              ` bis ${selectedDarlehen.ende_datum}`}
                          </div>
                          {tilgungsplan.length > 24 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2 text-gray-500"
                              onClick={() => setShowAllMonate((v) => !v)}
                            >
                              {showAllMonate ? (
                                <>
                                  <ChevronUp className="h-3 w-3 mr-1" />
                                  Weniger
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3 mr-1" />
                                  Alle {tilgungsplan.length}
                                </>
                              )}
                            </Button>
                          )}
                        </div>

                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-gray-100 hover:bg-transparent">
                                <TableHead className="text-xs text-gray-500 py-2 font-medium whitespace-nowrap">Monat</TableHead>
                                <TableHead className="text-xs text-gray-500 py-2 text-right font-medium whitespace-nowrap">Rate</TableHead>
                                <TableHead className="text-xs text-gray-500 py-2 text-right font-medium whitespace-nowrap">Zinsen</TableHead>
                                <TableHead className="text-xs text-gray-500 py-2 text-right font-medium whitespace-nowrap">Tilgung</TableHead>
                                <TableHead className="text-xs text-gray-500 py-2 text-right font-medium whitespace-nowrap">Restschuld</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {angezeigterPlan.map((e) => (
                                <TableRow
                                  key={e.monat}
                                  className="border-gray-50 hover:bg-gray-50/50"
                                >
                                  <TableCell className="text-xs text-gray-700 py-1.5 whitespace-nowrap">
                                    {format(e.datum, "MMM yyyy", { locale: de })}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-gray-800 py-1.5 text-right whitespace-nowrap">
                                    {formatEuro(e.rate)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-yellow-700 py-1.5 text-right whitespace-nowrap">
                                    {formatEuro(e.zinsanteil)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-green-700 py-1.5 text-right whitespace-nowrap">
                                    {formatEuro(e.tilgungsanteil)}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-red-600 py-1.5 text-right whitespace-nowrap">
                                    {formatEuro(e.restschuld_danach)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {!showAllMonate && tilgungsplan.length > 24 && (
                          <div className="text-center text-xs text-gray-400 py-3">
                            + {tilgungsplan.length - 24} weitere Monate
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>

                  {/* ── Zahlungen ── */}
                  <TabsContent value="zahlungen" className="px-4 pb-4 mt-3">
                    {!selectedDarlehen.kontonummer ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                        <AlertCircle className="h-8 w-8 opacity-40" />
                        <div className="text-sm">Keine IBAN hinterlegt.</div>
                      </div>
                    ) : zahlungen.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-10 text-gray-400">
                        <CreditCard className="h-8 w-8 opacity-40" />
                        <div className="text-sm text-center">
                          Keine Zahlungen mit IBAN
                          <br />
                          <span className="font-mono text-xs tracking-wider">
                            {formatIBAN(selectedDarlehen.kontonummer)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-gray-500 mb-3">
                          {zahlungen.length} Zahlungen ·{" "}
                          <span className="font-mono tracking-wider">
                            {formatIBAN(selectedDarlehen.kontonummer)}
                          </span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow className="border-gray-100 hover:bg-transparent">
                              <TableHead className="text-xs text-gray-500 py-2 font-medium">Datum</TableHead>
                              <TableHead className="text-xs text-gray-500 py-2 font-medium">Empfänger</TableHead>
                              <TableHead className="text-xs text-gray-500 py-2 font-medium">Verwendungszweck</TableHead>
                              <TableHead className="text-xs text-gray-500 py-2 text-right font-medium">Betrag</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {zahlungen.map((z) => (
                              <TableRow key={z.id} className="border-gray-50 hover:bg-gray-50/50">
                                <TableCell className="text-xs text-gray-700 py-1.5 whitespace-nowrap">
                                  {z.buchungsdatum}
                                </TableCell>
                                <TableCell className="text-xs text-gray-700 py-1.5 max-w-32 truncate">
                                  {z.empfaengername || "–"}
                                </TableCell>
                                <TableCell className="text-xs text-gray-400 py-1.5 max-w-48 truncate">
                                  {z.verwendungszweck || "–"}
                                </TableCell>
                                <TableCell
                                  className={`text-xs font-mono py-1.5 text-right ${
                                    z.betrag < 0 ? "text-red-600" : "text-green-700"
                                  }`}
                                >
                                  {formatEuro(z.betrag)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </TabsContent>

                  {/* ── Details ── */}
                  <TabsContent value="details" className="px-4 pb-4 mt-3">
                    <div className="max-w-sm divide-y divide-gray-100">
                      {(
                        [
                          ["Darlehensbetrag", formatEuro(selectedDarlehen.darlehensbetrag)],
                          ["Aktuelle Restschuld", formatEuro(selectedDarlehen.restschuld)],
                          ["Monatliche Rate", formatEuro(selectedDarlehen.monatliche_rate)],
                          ["Zinssatz p.a.", formatProzent(selectedDarlehen.zinssatz_prozent)],
                          ["Tilgungssatz p.a.", formatProzent(selectedDarlehen.tilgungssatz_prozent)],
                          [
                            "Zinsanteil / Monat",
                            selectedDarlehen.restschuld && selectedDarlehen.zinssatz_prozent
                              ? formatEuro(
                                  selectedDarlehen.restschuld *
                                    (selectedDarlehen.zinssatz_prozent / 100 / 12),
                                )
                              : "–",
                          ],
                          ["IBAN", formatIBAN(selectedDarlehen.kontonummer)],
                          ["Bank", selectedDarlehen.bank || "–"],
                          ["Laufzeit ab", selectedDarlehen.start_datum || "–"],
                          ["Laufzeit bis", selectedDarlehen.ende_datum || "–"],
                        ] as [string, string][]
                      ).map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between py-2.5">
                          <span className="text-xs text-gray-500">{label}</span>
                          <span className="text-xs font-mono text-gray-800">{value}</span>
                        </div>
                      ))}
                      {selectedDarlehen.notizen && (
                        <div className="py-2.5">
                          <div className="text-xs text-gray-500 mb-1">Notizen</div>
                          <div className="text-xs text-gray-700 leading-relaxed">
                            {selectedDarlehen.notizen}
                          </div>
                        </div>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => openEdit(selectedDarlehen)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Bearbeiten
                    </Button>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Create / Edit Dialog ──────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editId ? "Darlehenskonto bearbeiten" : "Neues Darlehenskonto"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Bezeichnung */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Bezeichnung *</Label>
              <Input
                value={form.bezeichnung}
                onChange={(e) => setForm((f) => ({ ...f, bezeichnung: e.target.value }))}
                placeholder="z. B. Obj. 01 AV MFH Saarstr."
              />
            </div>

            {/* Bank + IBAN */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600">Bank</Label>
                <Input
                  value={form.bank}
                  onChange={(e) => setForm((f) => ({ ...f, bank: e.target.value }))}
                  placeholder="z. B. Sparkasse"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600">IBAN</Label>
                <Input
                  value={form.kontonummer}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kontonummer: e.target.value.toUpperCase() }))
                  }
                  placeholder="DE81 2559 …"
                  className="font-mono text-sm tracking-wider"
                />
              </div>
            </div>

            {/* Immobilien */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Zugehörige Immobilie(n)</Label>
              <div className="max-h-28 overflow-y-auto space-y-1 rounded-md border p-2 bg-gray-50">
                {immobilien.map((immo) => (
                  <label
                    key={immo.id}
                    className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-white text-xs text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={form.immobilien_ids.includes(immo.id)}
                      onChange={(e) => toggleImmo(immo.id, e.target.checked)}
                      className="accent-red-500"
                    />
                    {immo.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Konditionen */}
            <div className="border-t pt-3">
              <div className="text-xs text-gray-500 font-semibold mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                <Percent className="h-3.5 w-3.5" />
                Konditionen
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Darlehensbetrag (€)</Label>
                  <Input
                    type="number"
                    value={form.darlehensbetrag}
                    onChange={(e) => setForm((f) => ({ ...f, darlehensbetrag: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Aktuelle Restschuld (€)</Label>
                  <Input
                    type="number"
                    value={form.restschuld}
                    onChange={(e) => setForm((f) => ({ ...f, restschuld: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Zinssatz (% p.a.)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.zinssatz_prozent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, zinssatz_prozent: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Tilgungssatz (% p.a.)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.tilgungssatz_prozent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, tilgungssatz_prozent: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Rate */}
              <div className="space-y-1.5 mt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-600">Monatliche Rate (€)</Label>
                  <button
                    type="button"
                    onClick={handleAutoRate}
                    className="text-xs text-primary hover:underline"
                  >
                    Auto-berechnen
                  </button>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={form.monatliche_rate}
                  onChange={(e) => setForm((f) => ({ ...f, monatliche_rate: e.target.value }))}
                />
                {parseNum(form.darlehensbetrag) > 0 &&
                  parseNum(form.zinssatz_prozent) > 0 &&
                  parseNum(form.tilgungssatz_prozent) > 0 && (
                    <div className="text-xs text-gray-400">
                      Berechnet:{" "}
                      {formatEuro(
                        berechneAutoRate(
                          parseNum(form.darlehensbetrag),
                          parseNum(form.zinssatz_prozent),
                          parseNum(form.tilgungssatz_prozent),
                        ),
                      )}
                    </div>
                  )}
              </div>
            </div>

            {/* Laufzeit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600">Laufzeit ab</Label>
                <Input
                  type="date"
                  value={form.start_datum}
                  onChange={(e) => setForm((f) => ({ ...f, start_datum: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-600">Laufzeit bis</Label>
                <Input
                  type="date"
                  value={form.ende_datum}
                  onChange={(e) => setForm((f) => ({ ...f, ende_datum: e.target.value }))}
                />
              </div>
            </div>

            {/* Notizen */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Notizen</Label>
              <Textarea
                value={form.notizen}
                onChange={(e) => setForm((f) => ({ ...f, notizen: e.target.value }))}
                className="resize-none"
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={closeDialog}>
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="accent-red text-white"
            >
              {saveMutation.isPending ? "Speichern…" : editId ? "Speichern" : "Erstellen"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Konto löschen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">
            Das Darlehenskonto und alle Zuordnungen werden unwiderruflich gelöscht.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Löschen…" : "Löschen"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DarlehenVerwaltung;
