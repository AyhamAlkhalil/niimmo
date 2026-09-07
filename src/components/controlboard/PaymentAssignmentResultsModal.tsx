import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Edit2, Loader2, Search, SkipForward, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getVertragsende } from "@/utils/contractUtils";
import { ZAHLUNG_KATEGORIEN, kategorieLabel } from "@/utils/zahlungKategorie";
import { formatEuro, formatIsoDatum } from "@/utils/zahlungenAnsicht";
import {
  ImmobilieOption,
  KEINE_KORREKTUREN,
  KONFIDENZ_UNSICHER,
  Korrekturen,
  VertragOption,
  VorschlagSicht,
  VorschlagStatus,
  Zuordnungsvorschlag,
  effektiveImmobilieId,
  effektiveKategorie,
  effektiveVertragId,
  filtereVorschlaege,
  naechsterPruefFall,
  standardAuswahl,
  vorschlagStatus,
  wendeKorrekturenAn,
  zaehleStatus,
} from "@/utils/zuordnungsvorschlaege";
import { KategorieBadge } from "./KategorieBadge";
import { ZuordnungsAuswahl } from "./ZuordnungsAuswahl";

/**
 * Prüfmaske nach dem CSV-Import: Vorschläge der Edge Function durchsehen,
 * korrigieren, abwählen, übernehmen.
 *
 * Bis zum 07.09.2026 war das ein 1400 px breites Fenster mit sechs
 * Kennzahlkacheln und einer Tabelle, deren Verwendungszweck-Spalte auf
 * 200 px umbrach — bei im Median 98 Zeichen wurde jede Zeile drei bis sieben
 * Zeilen hoch, und die Korrektur öffnete ein zweites Fenster darüber. Jetzt:
 * Vollbild, eine Zeile je Buchung, Filter nach Prüfstatus, und die Korrektur
 * sitzt in der Detailspalte rechts.
 */

interface DuplicatePayment {
  buchungsdatum: string;
  betrag: number;
  iban: string;
  verwendungszweck: string;
  empfaengername?: string;
  existingId: string;
}

interface Stats {
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

interface PaymentAssignmentResultsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: Zuordnungsvorschlag[];
  duplicates: DuplicatePayment[];
  stats: Stats;
  dateiname?: string;
  /** Liefert zurueck, wie viele Zeilen tatsaechlich gespeichert wurden. */
  onApply: (selectedResults: Zuordnungsvorschlag[]) => Promise<
    { gesamt: number; gespeichert: number; fehler: Array<{ zeile: string; grund: string }> } | void
  >;
}

/** Rohform der Vertragsabfrage — nur die Felder, die die Auswahl braucht. */
interface VertragRoh {
  id: string;
  kaltmiete: number | null;
  betriebskosten: number | null;
  status: string | null;
  start_datum: string | null;
  ende_datum: string | null;
  kuendigungsdatum: string | null;
  einheiten: { etage: string | null; einheitentyp: string | null; immobilien: { name: string | null; adresse: string | null } | null } | null;
  mietvertrag_mieter: Array<{ mieter: { vorname: string | null; nachname: string | null } | null }> | null;
}

const STATUS_ANZEIGE: Record<VorschlagStatus, { label: string; Icon: typeof CheckCircle2; klasse: string; zeile: string }> = {
  zugeordnet: { label: "Zugeordnet", Icon: CheckCircle2, klasse: "text-success", zeile: "" },
  offen: { label: "Offen", Icon: AlertTriangle, klasse: "text-warning", zeile: "bg-warning/5" },
  unsicher: { label: "Unsicher", Icon: AlertTriangle, klasse: "text-destructive", zeile: "bg-destructive/5" },
  geaendert: { label: "Geändert", Icon: Edit2, klasse: "text-primary", zeile: "bg-primary/5" },
};

function KonfidenzBadge({ wert }: { wert: number }) {
  const klasse =
    wert >= 80
      ? "border-success/30 bg-success/10 text-success"
      : wert >= KONFIDENZ_UNSICHER
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-destructive/30 bg-destructive/10 text-destructive";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums leading-4", klasse)}>
      {wert} %
    </span>
  );
}

interface ZeileProps {
  idx: number;
  v: Zuordnungsvorschlag;
  status: VorschlagStatus;
  kategorie: string;
  ziel: { haupt: string; neben?: string } | null;
  gewaehlt: boolean;
  inspiziert: boolean;
  onToggle: (idx: number) => void;
  onInspizieren: (idx: number) => void;
  onKategorie: (idx: number, wert: string) => void;
}

const VorschlagZeile = memo(function VorschlagZeile({ idx, v, status, kategorie, ziel, gewaehlt, inspiziert, onToggle, onInspizieren, onKategorie }: ZeileProps) {
  const anzeige = STATUS_ANZEIGE[status];
  return (
    <tr
      id={`vorschlag-${idx}`}
      data-vorschlag-idx={idx}
      aria-selected={inspiziert}
      onClick={() => onInspizieren(idx)}
      className={cn(
        "h-9 cursor-pointer border-b border-border/70 text-sm transition-colors",
        inspiziert ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]" : cn("hover:bg-muted/60", anzeige.zeile),
        !gewaehlt && "text-muted-foreground"
      )}
    >
      <td className="px-2 text-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={gewaehlt} onCheckedChange={() => onToggle(idx)} aria-label={gewaehlt ? "Buchung abwählen" : "Buchung übernehmen"} />
      </td>
      <td className="px-1 text-center">
        <anzeige.Icon className={cn("inline h-4 w-4", anzeige.klasse)} aria-label={anzeige.label} />
      </td>
      <td className="whitespace-nowrap px-2 tabular-nums">{formatIsoDatum(v.buchungsdatum) || "–"}</td>
      <td className={cn("whitespace-nowrap px-2 text-right font-medium tabular-nums", v.betrag < 0 ? "text-destructive" : "text-success")}>
        {formatEuro(v.betrag)}
      </td>
      <td className="truncate px-2" title={v.empfaengername || undefined}>
        {v.empfaengername || "–"}
      </td>
      <td className="truncate px-2 text-muted-foreground" title={v.verwendungszweck || undefined}>
        {v.verwendungszweck || "–"}
      </td>
      <td className="px-2" onClick={(e) => e.stopPropagation()}>
        <Select value={kategorie} onValueChange={(wert) => onKategorie(idx, wert)}>
          <SelectTrigger className="h-7 w-full bg-background px-2 text-xs text-foreground" aria-label="Kategorie">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZAHLUNG_KATEGORIEN.map((k) => (
              <SelectItem key={k.wert} value={k.wert} className="text-xs">
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="truncate px-2">
        {ziel ? (
          <span className="block truncate">
            <span className="font-medium">{ziel.haupt}</span>
            {ziel.neben && <span className="text-muted-foreground"> · {ziel.neben}</span>}
          </span>
        ) : (
          <span className="text-warning">{kategorie === "Nebenkosten" ? "Kein Objekt" : "Nicht zugeordnet"}</span>
        )}
      </td>
      <td className="px-2 text-right">
        <KonfidenzBadge wert={v.confidence} />
      </td>
    </tr>
  );
});

export function PaymentAssignmentResultsModal({ open, onOpenChange, results, duplicates, stats, dateiname, onApply }: PaymentAssignmentResultsModalProps) {
  const { toast } = useToast();
  const [isApplying, setIsApplying] = useState(false);
  const tabelleRef = useRef<HTMLDivElement>(null);

  // Eigener Query-Key: AssignPaymentDialog führt unter 'contracts-for-assignment'
  // eine andere Datenform. Bis zum 07.09.2026 teilten sich beide den Key, und
  // welche Liste erschien, hing davon ab, wer zuerst geladen hatte.
  const { data: vertraege = [], isLoading: vertraegeLaden, isError: vertraegeFehler } = useQuery({
    queryKey: ["zuordnung-vertraege-auswahl"],
    queryFn: async (): Promise<VertragOption[]> => {
      const { data, error } = await supabase
        .from("mietvertrag")
        .select(
          `id, kaltmiete, betriebskosten, status, start_datum, ende_datum, kuendigungsdatum,
           einheiten!inner (etage, einheitentyp, immobilien!inner (name, adresse)),
           mietvertrag_mieter (mieter (vorname, nachname))`
        )
        .in("status", ["aktiv", "gekuendigt", "beendet"]);
      if (error) throw error;
      return ((data ?? []) as unknown as VertragRoh[]).map((c) => {
        const mieter =
          c.mietvertrag_mieter
            ?.map((mm) => `${mm.mieter?.vorname ?? ""} ${mm.mieter?.nachname ?? ""}`.trim())
            .filter(Boolean)
            .join(", ") || "Unbekannt";
        const immobilie = c.einheiten?.immobilien;
        return {
          id: c.id,
          mieter,
          objekt: [immobilie?.name, c.einheiten?.etage].filter(Boolean).join(" · ") || "Unbekannt",
          adresse: immobilie?.adresse ?? "",
          gesamtmiete: (c.kaltmiete ?? 0) + (c.betriebskosten ?? 0),
          beginn: c.start_datum,
          ende: getVertragsende(c),
          status: c.status ?? undefined,
        };
      });
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  const { data: immobilien = [], isLoading: immobilienLaden, isError: immobilienFehler } = useQuery({
    queryKey: ["immobilien-for-assignment"],
    queryFn: async (): Promise<ImmobilieOption[]> => {
      const { data, error } = await supabase.from("immobilien").select("id, name, adresse").order("name");
      if (error) throw error;
      return (data ?? []).map((i) => ({ id: i.id, name: i.name ?? "", adresse: i.adresse ?? "" }));
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  // Nichtmiete wird ohne Prüfung gespeichert und erscheint hier nicht.
  const mietResults = useMemo(() => results.filter((r) => r.kategorie !== "Nichtmiete"), [results]);
  const nichtmieteAnzahl = results.length - mietResults.length;

  const [korrekturen, setKorrekturen] = useState<Korrekturen>(KEINE_KORREKTUREN);
  const [auswahl, setAuswahl] = useState<Set<number>>(() => standardAuswahl(mietResults));
  const [inspiziert, setInspiziert] = useState<number | null>(null);
  const [sicht, setSicht] = useState<VorschlagSicht>("alle");
  const [suche, setSuche] = useState("");

  useEffect(() => {
    setKorrekturen(KEINE_KORREKTUREN);
    setAuswahl(standardAuswahl(mietResults));
    setInspiziert(null);
    setSicht("alle");
    setSuche("");
  }, [mietResults]);

  const sichtbar = useMemo(
    () => filtereVorschlaege(mietResults, korrekturen, sicht, suche, vertraege, immobilien),
    [mietResults, korrekturen, sicht, suche, vertraege, immobilien]
  );
  const zaehler = useMemo(() => zaehleStatus(mietResults, korrekturen), [mietResults, korrekturen]);
  const finale = useMemo(
    () => wendeKorrekturenAn(mietResults, korrekturen, auswahl, vertraege, immobilien),
    [mietResults, korrekturen, auswahl, vertraege, immobilien]
  );
  const mitZuordnung = finale.filter((r) => r.mietvertrag_id || r.immobilie_id).length;
  const kannUebernehmen = auswahl.size > 0 || nichtmieteAnzahl > 0;
  const alleSichtbarenGewaehlt = sichtbar.length > 0 && sichtbar.every((idx) => auswahl.has(idx));
  const einigeSichtbareGewaehlt = sichtbar.some((idx) => auswahl.has(idx));

  const vertraegeNachId = useMemo(() => new Map(vertraege.map((v) => [v.id, v])), [vertraege]);
  const immobilienNachId = useMemo(() => new Map(immobilien.map((i) => [i.id, i])), [immobilien]);

  const zielVon = useCallback(
    (idx: number, v: Zuordnungsvorschlag): { haupt: string; neben?: string } | null => {
      if (effektiveKategorie(idx, v, korrekturen) === "Nebenkosten") {
        const id = effektiveImmobilieId(idx, v, korrekturen);
        if (!id) return null;
        const imm = immobilienNachId.get(id);
        return { haupt: imm?.name || v.immobilie_name || "Objekt", neben: imm?.adresse || undefined };
      }
      const id = effektiveVertragId(idx, v, korrekturen);
      if (!id) return null;
      const vt = vertraegeNachId.get(id);
      return { haupt: vt?.mieter || v.mieter_name || "Vertrag", neben: vt?.objekt || v.immobilie_name || undefined };
    },
    [korrekturen, vertraegeNachId, immobilienNachId]
  );

  const toggleAuswahl = useCallback((idx: number) => {
    setAuswahl((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const sichtbareWaehlen = (waehlen: boolean) => {
    setAuswahl((prev) => {
      const next = new Set(prev);
      sichtbar.forEach((idx) => (waehlen ? next.add(idx) : next.delete(idx)));
      return next;
    });
  };

  // Jede Korrektur wählt die Zeile: Abgewählte Zeilen werden mit dem
  // ursprünglichen Vorschlag und ohne Zuordnung gespeichert, eine Korrektur
  // an ihnen verpuffte bis zum 07.09.2026 unbemerkt.
  const setzeKategorie = useCallback(
    (idx: number, wert: string) => {
      const original = mietResults[idx]?.kategorie;
      setKorrekturen((k) => {
        const kategorie = { ...k.kategorie };
        if (wert === original) delete kategorie[idx];
        else kategorie[idx] = wert;
        return { ...k, kategorie };
      });
      if (wert !== original) setAuswahl((prev) => new Set(prev).add(idx));
    },
    [mietResults]
  );

  const setzeZiel = useCallback(
    (idx: number, id: string | null) => {
      const nebenkosten = effektiveKategorie(idx, mietResults[idx], korrekturen) === "Nebenkosten";
      setKorrekturen((k) => (nebenkosten ? { ...k, immobilie: { ...k.immobilie, [idx]: id } } : { ...k, vertrag: { ...k.vertrag, [idx]: id } }));
      if (id) setAuswahl((prev) => new Set(prev).add(idx));
    },
    [mietResults, korrekturen]
  );

  const scrolleZu = useCallback((idx: number) => {
    requestAnimationFrame(() => {
      tabelleRef.current?.querySelector<HTMLElement>(`[data-vorschlag-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const inspiziere = useCallback(
    (idx: number | null) => {
      setInspiziert(idx);
      if (idx !== null) scrolleZu(idx);
    },
    [scrolleZu]
  );

  const naechsterFall = () => inspiziere(naechsterPruefFall(mietResults, korrekturen, sichtbar, inspiziert));

  const blaettern = (schritt: 1 | -1) => {
    if (sichtbar.length === 0) return;
    const pos = inspiziert === null ? -1 : sichtbar.indexOf(inspiziert);
    const neu = pos === -1 ? (schritt === 1 ? 0 : sichtbar.length - 1) : Math.min(Math.max(pos + schritt, 0), sichtbar.length - 1);
    inspiziere(sichtbar[neu]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      blaettern(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      blaettern(-1);
    } else if (e.key === " " && inspiziert !== null) {
      e.preventDefault();
      toggleAuswahl(inspiziert);
    }
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const ergebnis = (await onApply(finale)) || undefined;
      // onApply meldet Fehlschlaege bereits selbst. Hier darf deshalb nur dann
      // Erfolg stehen, wenn wirklich alles gespeichert wurde.
      const fehlgeschlagen = ergebnis && "fehler" in ergebnis ? ergebnis.fehler.length : 0;
      if (fehlgeschlagen === 0) {
        toast({
          title: "Zuordnungen übernommen",
          description: `${ergebnis && "gespeichert" in ergebnis ? ergebnis.gespeichert : mitZuordnung} Zahlungen wurden gespeichert.`,
        });
      }
      onOpenChange(false);
    } catch {
      toast({
        title: "Fehler",
        description: "Die Zuordnungen konnten nicht übernommen werden.",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  const aktuell = inspiziert !== null ? mietResults[inspiziert] : undefined;
  const aktuellKategorie = aktuell && inspiziert !== null ? effektiveKategorie(inspiziert, aktuell, korrekturen) : null;
  const aktuellStatus = aktuell && inspiziert !== null ? vorschlagStatus(inspiziert, aktuell, korrekturen) : null;
  const aktuellZiel = aktuell && inspiziert !== null ? zielVon(inspiziert, aktuell) : null;
  const aktuellZielId =
    aktuell && inspiziert !== null
      ? aktuellKategorie === "Nebenkosten"
        ? effektiveImmobilieId(inspiziert, aktuell, korrekturen)
        : effektiveVertragId(inspiziert, aktuell, korrekturen)
      : null;
  const pruefFaelle = zaehler.offen + zaehler.unsicher;

  const sichten: Array<{ wert: VorschlagSicht; label: string; anzahl: number }> = [
    { wert: "alle", label: "Alle", anzahl: mietResults.length },
    { wert: "offen", label: "Offen", anzahl: zaehler.offen },
    { wert: "unsicher", label: "Unsicher", anzahl: zaehler.unsicher },
    { wert: "geaendert", label: "Geändert", anzahl: zaehler.geaendert },
    { wert: "zugeordnet", label: "Zugeordnet", anzahl: zaehler.zugeordnet },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="vollbild" aria-describedby={undefined}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base font-semibold">Zuordnungsvorschläge prüfen</DialogTitle>
          {dateiname && <span className="truncate text-xs text-muted-foreground">{dateiname}</span>}
          <p className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
            <span>
              <span className="font-medium text-foreground">{stats.total}</span> in der Datei
            </span>
            <span>
              <span className="font-medium text-foreground">{stats.neue}</span> neu
            </span>
            <span>
              <span className="font-medium text-foreground">{stats.duplikate}</span> Duplikate
            </span>
            <span>
              <span className="font-medium text-success">{stats.zugeordnet}</span> zugeordnet
            </span>
            <span>
              <span className={cn("font-medium", stats.nicht_zugeordnet > 0 ? "text-warning" : "text-foreground")}>{stats.nicht_zugeordnet}</span> offen
            </span>
            <span>Ø {stats.durchschnittliche_konfidenz} %</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
          <ToggleGroup
            type="single"
            value={sicht}
            onValueChange={(v) => v && setSicht(v as VorschlagSicht)}
            aria-label="Nach Prüfstatus filtern"
            className="h-9 gap-0 overflow-hidden rounded-md border border-input bg-background"
          >
            {sichten.map((s) => (
              <ToggleGroupItem
                key={s.wert}
                value={s.wert}
                className="h-full gap-1.5 rounded-none border-r px-3 text-xs last:border-r-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
              >
                {s.label}
                <span className="rounded bg-muted px-1 tabular-nums text-muted-foreground">{s.anzahl}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative min-w-[12rem] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen: Name, Verwendungszweck, Betrag, Mieter" aria-label="Vorschläge durchsuchen" className="h-9 bg-background pl-8" />
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{auswahl.size}</span> von {mietResults.length} gewählt
              {mitZuordnung > 0 && <> · {mitZuordnung} mit Ziel</>}
            </span>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sichtbareWaehlen(true)} disabled={sichtbar.length === 0}>
              Sichtbare wählen
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => sichtbareWaehlen(false)} disabled={!einigeSichtbareGewaehlt}>
              Sichtbare abwählen
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={naechsterFall} disabled={pruefFaelle === 0}>
              <SkipForward className="h-3.5 w-3.5" />
              Nächster Prüffall
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div ref={tabelleRef} className="min-w-0 flex-1 overflow-auto">
            {sichtbar.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm font-medium">{mietResults.length === 0 ? "Keine prüfbaren Buchungen" : "Nichts entspricht Sicht und Suche"}</p>
                {mietResults.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSicht("alle");
                      setSuche("");
                    }}
                  >
                    Alle anzeigen
                  </Button>
                )}
              </div>
            ) : (
              <table
                role="grid"
                tabIndex={0}
                aria-label="Vorschläge. Mit Pfeiltasten blättern, Leertaste wählt die Buchung ab oder an."
                aria-activedescendant={inspiziert !== null ? `vorschlag-${inspiziert}` : undefined}
                onKeyDown={handleKeyDown}
                className="w-full min-w-[64rem] table-fixed border-separate border-spacing-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <colgroup>
                  <col className="w-9" />
                  <col className="w-8" />
                  <col className="w-[5.75rem]" />
                  <col className="w-[7rem]" />
                  <col className="w-[16%]" />
                  <col />
                  <col className="w-[9.5rem]" />
                  <col className="w-[21%]" />
                  <col className="w-[4.5rem]" />
                </colgroup>
                <thead>
                  <tr className="text-xs font-medium text-muted-foreground">
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-center shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <Checkbox
                        checked={alleSichtbarenGewaehlt ? true : einigeSichtbareGewaehlt ? "indeterminate" : false}
                        onCheckedChange={(c) => sichtbareWaehlen(c === true)}
                        aria-label="Alle sichtbaren Buchungen wählen"
                      />
                    </th>
                    <th className="sticky top-0 z-20 h-9 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <span className="sr-only">Status</span>
                    </th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">Datum</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-right shadow-[inset_0_-1px_0_hsl(var(--border))]">Betrag</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">Von / An</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">Verwendungszweck</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">Kategorie</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">Zuordnung</th>
                    <th className="sticky top-0 z-20 h-9 bg-card px-2 text-right shadow-[inset_0_-1px_0_hsl(var(--border))]">Konf.</th>
                  </tr>
                </thead>
                <tbody>
                  {sichtbar.map((idx) => {
                    const v = mietResults[idx];
                    return (
                      <VorschlagZeile
                        key={idx}
                        idx={idx}
                        v={v}
                        status={vorschlagStatus(idx, v, korrekturen)}
                        kategorie={effektiveKategorie(idx, v, korrekturen)}
                        ziel={zielVon(idx, v)}
                        gewaehlt={auswahl.has(idx)}
                        inspiziert={inspiziert === idx}
                        onToggle={toggleAuswahl}
                        onInspizieren={inspiziere}
                        onKategorie={setzeKategorie}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <aside className="hidden w-[24rem] shrink-0 flex-col border-l bg-card lg:flex" aria-label="Details zur gewählten Buchung">
            {aktuell && inspiziert !== null && aktuellStatus && aktuellKategorie ? (
              <>
                <div className="shrink-0 border-b px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={cn("text-2xl font-semibold tabular-nums leading-tight", aktuell.betrag < 0 ? "text-destructive" : "text-success")}>
                        {formatEuro(aktuell.betrag)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatIsoDatum(aktuell.buchungsdatum)}
                        {aktuell.empfaengername && (
                          <>
                            {" · "}
                            {aktuell.betrag < 0 ? "an" : "von"} <span className="text-foreground">{aktuell.empfaengername}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", STATUS_ANZEIGE[aktuellStatus].klasse)}>
                      {(() => {
                        const Icon = STATUS_ANZEIGE[aktuellStatus].Icon;
                        return <Icon className="h-3.5 w-3.5" aria-hidden="true" />;
                      })()}
                      {STATUS_ANZEIGE[aktuellStatus].label}
                    </span>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={auswahl.has(inspiziert)} onCheckedChange={() => toggleAuswahl(inspiziert)} />
                    Diese Buchung übernehmen
                  </label>
                  {!auswahl.has(inspiziert) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Abgewählt wird die Buchung ohne Zuordnung und ohne Ihre Korrekturen gespeichert.
                    </p>
                  )}
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-4 px-4 py-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Verwendungszweck</p>
                      <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-2 py-1.5 text-sm leading-snug">{aktuell.verwendungszweck || "–"}</p>
                      {aktuell.iban && <p className="font-mono text-xs text-muted-foreground">{aktuell.iban}</p>}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Vorschlag des Systems</p>
                      <div className="flex items-start gap-2">
                        <KonfidenzBadge wert={aktuell.confidence} />
                        <p className="text-xs leading-snug">{aktuell.zuordnungsgrund}</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Kategorie</p>
                      <Select value={aktuellKategorie} onValueChange={(wert) => setzeKategorie(inspiziert, wert)}>
                        <SelectTrigger className="h-9" aria-label="Kategorie">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ZAHLUNG_KATEGORIEN.map((k) => (
                            <SelectItem key={k.wert} value={k.wert}>
                              {k.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {aktuellKategorie !== aktuell.kategorie && (
                        <p className="text-xs text-muted-foreground">
                          Vorschlag war <KategorieBadge kategorie={aktuell.kategorie} className="align-middle" />
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{aktuellKategorie === "Nebenkosten" ? "Objekt" : "Mietvertrag"}</p>
                      <div className={cn("rounded-md border px-3 py-2 text-sm", aktuellZiel ? "bg-card" : "border-warning/40 bg-warning/5 text-warning")}>
                        {aktuellZiel ? (
                          <>
                            <span className="block font-medium">{aktuellZiel.haupt}</span>
                            {aktuellZiel.neben && <span className="block text-xs text-muted-foreground">{aktuellZiel.neben}</span>}
                          </>
                        ) : aktuellKategorie === "Nebenkosten" ? (
                          "Kein Objekt gewählt"
                        ) : (
                          "Kein Mietvertrag gewählt"
                        )}
                      </div>
                      <ZuordnungsAuswahl
                        modus={aktuellKategorie === "Nebenkosten" ? "immobilie" : "mietvertrag"}
                        vertraege={vertraege}
                        immobilien={immobilien}
                        aktuelleId={aktuellZielId}
                        onAuswahl={(id) => setzeZiel(inspiziert, id)}
                        laedt={aktuellKategorie === "Nebenkosten" ? immobilienLaden : vertraegeLaden}
                        fehler={aktuellKategorie === "Nebenkosten" ? immobilienFehler : vertraegeFehler}
                      />
                    </div>
                  </div>
                </ScrollArea>
                <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2">
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => blaettern(-1)} disabled={sichtbar.length === 0}>
                    <ChevronLeft className="h-4 w-4" />
                    Vorherige
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => blaettern(1)} disabled={sichtbar.length === 0}>
                    Nächste
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm font-medium">Keine Buchung gewählt</p>
                <p className="text-xs text-muted-foreground">Eine Zeile anklicken oder mit ↑ ↓ blättern. Leertaste wählt ab oder an.</p>
                {pruefFaelle > 0 && (
                  <Button variant="outline" size="sm" onClick={naechsterFall}>
                    <SkipForward className="h-3.5 w-3.5" />
                    {pruefFaelle === 1 ? "Den offenen Fall öffnen" : `Ersten von ${pruefFaelle} Prüffällen öffnen`}
                  </Button>
                )}
              </div>
            )}
          </aside>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {nichtmieteAnzahl > 0 && (
              <span>
                <span className="font-medium text-foreground">{nichtmieteAnzahl}</span> Nichtmiete-Buchungen werden ohne Prüfung gespeichert
              </span>
            )}
            {duplicates.length > 0 && (
              <span>
                <span className="font-medium text-foreground">{duplicates.length}</span> Duplikate übersprungen
              </span>
            )}
            {zaehler.unsicher > 0 && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {zaehler.unsicher} {zaehler.unsicher === 1 ? "Vorschlag beruht" : "Vorschläge beruhen"} nur auf dem Betrag — bitte prüfen
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
              <X className="h-4 w-4" />
              Abbrechen
            </Button>
            <Button onClick={handleApply} disabled={isApplying || !kannUebernehmen}>
              {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {isApplying
                ? "Wird übernommen …"
                : auswahl.size > 0
                  ? `${auswahl.size} ${auswahl.size === 1 ? "Buchung" : "Buchungen"}${nichtmieteAnzahl > 0 ? ` + ${nichtmieteAnzahl} Nichtmiete` : ""} übernehmen`
                  : `${nichtmieteAnzahl} Nichtmiete übernehmen`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
