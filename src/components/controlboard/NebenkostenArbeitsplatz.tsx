import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Search, Sparkles, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useNavigationState } from "@/hooks/useNavigationState";
import { cn } from "@/lib/utils";
import { ZahlungenTabelle } from "./ZahlungenTabelle";
import { NebenkostenInspector } from "./NebenkostenInspector";
import { ZeitraumFilter } from "./ZeitraumFilter";
import { alleSeiten } from "@/utils/supabaseSeiten";
import type { ImmobilieOption } from "@/utils/zuordnungsvorschlaege";
import {
  LEERER_FILTER,
  STANDARD_SORTIERUNG,
  SortierFeld,
  Sortierung,
  ZahlungenFilter,
  effektivOffeneMonate,
  filtereZahlungen,
  formatEuro,
  gruppiereNachMonat,
  sortiereZahlungen,
  summeBetraege,
} from "@/utils/zahlungenAnsicht";
import {
  KiVorschlag,
  NebenkostenKategorie,
  NebenkostenSicht,
  NebenkostenZahlungRoh,
  alsZahlungZeile,
  anzahlJeObjekt,
  filtereNachSicht,
  sichtVon,
  vorschlagHinweise,
  vorschlaegeNachZahlung,
  zaehleSichten,
} from "@/utils/nebenkostenZuordnung";

/**
 * Der Reiter „Nebenkosten" der Zahlungsverwaltung als Arbeitsplatz — dieselbe
 * gefensterte Tabelle wie „Alle Zahlungen", rechts die Detailspalte mit
 * KI-Vorschlag, Objektliste und Kategorie-Aktionen.
 *
 * Bis zum 10.09.2026 war das eine zweispaltige Kartenansicht (Zahlung ziehen,
 * auf Objektkachel ablegen) mit „Weitere laden" ab 30 Karten; die beiden
 * Abfragen liefen ohne range() und hätten ab 1000 Zeilen still gekappt. Die
 * KI-Klassifizierung war implementiert, aber an keinen Knopf gebunden.
 */

const CACHE_ZEIT = 60 * 1000;
const LEER: ReadonlySet<string> = new Set();

const STANDARD_RICHTUNG: Record<SortierFeld, Sortierung["richtung"]> = {
  datum: "desc",
  betrag: "desc",
  kategorie: "asc",
  zuordnung: "asc",
};

const ZAHLUNGSFELDER = "id, betrag, buchungsdatum, verwendungszweck, empfaengername, iban, kategorie, immobilie_id";

interface KlassifizierungRoh {
  zahlung_id: string;
  confidence: string;
  category: string;
  suggested_immobilie_id: string | null;
  reasoning: string | null;
  immobilie: { id: string; name: string | null } | null;
}

export function NebenkostenArbeitsplatz() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { updateNav } = useNavigationState();
  const istDesktop = useMediaQuery("(min-width: 1024px)");

  const objekte = useQuery({
    queryKey: ["nebenkosten-objekte"],
    queryFn: async (): Promise<ImmobilieOption[]> => {
      const { data, error } = await supabase.from("immobilien").select("id, name, adresse").order("name");
      if (error) throw error;
      return (data ?? []).map((i) => ({ id: i.id, name: i.name ?? "", adresse: i.adresse ?? "" }));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Zwei Abfragen statt einer: Andere Stellen (Kategorie-Editor, Zuordnungsdialog,
  // Übernahme) invalidieren genau diese beiden Schlüssel.
  const offene = useQuery({
    queryKey: ["unzugeordnete-nebenkosten"],
    staleTime: CACHE_ZEIT,
    queryFn: () =>
      alleSeiten<NebenkostenZahlungRoh>((von, bis, mitZaehlung) =>
        supabase
          .from("zahlungen")
          .select(ZAHLUNGSFELDER, { count: mitZaehlung ? "exact" : undefined })
          .in("kategorie", ["Nichtmiete", "Nebenkosten"])
          .is("immobilie_id", null)
          .order("buchungsdatum", { ascending: false })
          .range(von, bis)
      ),
  });

  const zugeordnete = useQuery({
    queryKey: ["zugeordnete-nebenkosten"],
    staleTime: CACHE_ZEIT,
    queryFn: () =>
      alleSeiten<NebenkostenZahlungRoh>((von, bis, mitZaehlung) =>
        supabase
          .from("zahlungen")
          .select(`${ZAHLUNGSFELDER}, immobilie:immobilie_id (id, name, adresse)`, { count: mitZaehlung ? "exact" : undefined })
          .in("kategorie", ["Nichtmiete", "Nebenkosten"])
          .not("immobilie_id", "is", null)
          .order("buchungsdatum", { ascending: false })
          .range(von, bis)
          .then((antwort) => ({ data: antwort.data as unknown as NebenkostenZahlungRoh[] | null, error: antwort.error, count: antwort.count }))
      ),
  });

  const vorschlaege = useQuery({
    queryKey: ["nebenkosten-klassifizierungen-cached"],
    staleTime: CACHE_ZEIT,
    queryFn: async (): Promise<KiVorschlag[]> => {
      const { data, error } = await supabase
        .from("nebenkosten_klassifizierungen")
        .select("zahlung_id, confidence, category, suggested_immobilie_id, reasoning, immobilie:suggested_immobilie_id (id, name)")
        .eq("is_betriebskosten", true)
        .eq("bestaetigt", false)
        .eq("uebersprungen", false);
      if (error) throw error;
      return ((data ?? []) as unknown as KlassifizierungRoh[]).map((c) => ({
        zahlung_id: c.zahlung_id,
        confidence: (c.confidence === "high" || c.confidence === "medium" ? c.confidence : "low") as KiVorschlag["confidence"],
        category: c.category,
        suggested_immobilie_id: c.suggested_immobilie_id,
        suggested_immobilie_name: c.immobilie?.name ?? null,
        reasoning: c.reasoning ?? "",
      }));
    },
  });

  const ausgeblendetQuery = useQuery({
    queryKey: ["nebenkosten-klassifizierungen-skipped"],
    staleTime: CACHE_ZEIT,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from("nebenkosten_klassifizierungen").select("zahlung_id").eq("uebersprungen", true);
      if (error) throw error;
      return new Set((data ?? []).map((c) => c.zahlung_id));
    },
  });
  const ausgeblendet = ausgeblendetQuery.data ?? LEER;

  const [sicht, setSicht] = useState<NebenkostenSicht>("offen");
  const [kategorie, setKategorie] = useState<NebenkostenKategorie>("alle");
  const [filter, setFilter] = useState<ZahlungenFilter>(LEERER_FILTER);
  const [sortierung, setSortierung] = useState<Sortierung>(STANDARD_SORTIERUNG);
  const [ausgeklappt, setAusgeklappt] = useState<Set<string>>(() => new Set());
  const [ausgewaehltId, setAusgewaehltId] = useState<string | null>(null);
  const [detailsOffen, setDetailsOffen] = useState(true);
  const [vollbild, setVollbild] = useState(false);
  const [klassifiziert, setKlassifiziert] = useState(false);

  const suche = useDeferredValue(filter.suche);

  const alleZeilen = useMemo(
    () => [...(offene.data ?? []), ...(zugeordnete.data ?? [])].map(alsZahlungZeile),
    [offene.data, zugeordnete.data]
  );
  const zaehler = useMemo(() => zaehleSichten(alleZeilen, ausgeblendet), [alleZeilen, ausgeblendet]);
  const gefiltert = useMemo(
    () => filtereZahlungen(filtereNachSicht(alleZeilen, sicht, kategorie, ausgeblendet), { ...filter, suche }),
    [alleZeilen, sicht, kategorie, ausgeblendet, filter, suche]
  );
  const sortiert = useMemo(() => sortiereZahlungen(gefiltert, sortierung), [gefiltert, sortierung]);
  const gruppen = useMemo(
    () => (sortierung.feld === "datum" ? gruppiereNachMonat(sortiert, sortierung.richtung) : null),
    [sortiert, sortierung]
  );
  const summe = useMemo(() => summeBetraege(gefiltert), [gefiltert]);
  const hinweise = useMemo(() => vorschlagHinweise(vorschlaege.data ?? [], alleZeilen), [vorschlaege.data, alleZeilen]);
  const vorschlagNachId = useMemo(() => vorschlaegeNachZahlung(vorschlaege.data ?? []), [vorschlaege.data]);
  const objektAnzahl = useMemo(() => anzahlJeObjekt(alleZeilen), [alleZeilen]);
  const nachId = useMemo(() => new Map(alleZeilen.map((z) => [z.id, z])), [alleZeilen]);
  const ausgewaehlt = ausgewaehltId ? nachId.get(ausgewaehltId) : undefined;

  const sucheAktiv = suche.trim().length > 0;
  const offeneMonate = useMemo(
    () => (gruppen ? effektivOffeneMonate(gruppen, ausgeklappt, sucheAktiv) : ausgeklappt),
    [gruppen, ausgeklappt, sucheAktiv]
  );
  const alleMonateOffen = Boolean(gruppen && gruppen.every((g) => offeneMonate.has(g.monatKey)));

  // Sichtbare Reihenfolge, um nach einer Aktion die nächste Zeile zu wählen.
  const sichtbareReihe = useMemo(
    () => (gruppen ? gruppen.flatMap((g) => (offeneMonate.has(g.monatKey) ? g.zahlungen : [])) : sortiert),
    [gruppen, offeneMonate, sortiert]
  );
  const waehleNaechste = useCallback(
    (aktuelleId: string) => {
      const pos = sichtbareReihe.findIndex((z) => z.id === aktuelleId);
      const naechste = pos >= 0 ? (sichtbareReihe[pos + 1] ?? sichtbareReihe[pos - 1]) : undefined;
      setAusgewaehltId(naechste?.id ?? null);
    },
    [sichtbareReihe]
  );

  const filterAktiv = Boolean(filter.suche.trim() || filter.von || filter.bis || kategorie !== "alle");

  const sortiereNach = useCallback((feld: SortierFeld) => {
    setSortierung((s) =>
      s.feld === feld ? { feld, richtung: s.richtung === "asc" ? "desc" : "asc" } : { feld, richtung: STANDARD_RICHTUNG[feld] }
    );
  }, []);
  const monatUmschalten = useCallback((monatKey: string) => {
    setAusgeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(monatKey)) next.delete(monatKey);
      else next.add(monatKey);
      return next;
    });
  }, []);
  const alleMonateUmschalten = useCallback(() => {
    setAusgeklappt(alleMonateOffen ? new Set() : new Set((gruppen ?? []).map((g) => g.monatKey)));
  }, [alleMonateOffen, gruppen]);

  // ── Schreibvorgänge — Semantik wie im früheren Reiter ──
  const invalidieren = useCallback(() => {
    for (const key of [
      ["unzugeordnete-nebenkosten"],
      ["zugeordnete-nebenkosten"],
      ["nebenkosten-klassifizierungen-cached"],
      ["nebenkosten-klassifizierungen-skipped"],
      ["zahlungen-overview"],
      ["immobilie-nebenkosten-zahlungen"],
    ]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient]);

  const fehlerMelden = useCallback(
    (titel: string) => (e: unknown) => {
      console.error(`[Nebenkosten] ${titel}`, e);
      toast({ title: titel, description: "Die Änderung wurde nicht gespeichert. Bitte erneut versuchen.", variant: "destructive" });
    },
    [toast]
  );

  const zuordnen = useMutation({
    mutationFn: async ({ zahlungId, immobilieId }: { zahlungId: string; immobilieId: string }) => {
      const { error } = await supabase.from("zahlungen").update({ immobilie_id: immobilieId }).eq("id", zahlungId);
      if (error) throw error;
      await supabase.from("nebenkosten_klassifizierungen").update({ bestaetigt: true, bestaetigt_am: new Date().toISOString() }).eq("zahlung_id", zahlungId);
    },
    onSuccess: (_, { zahlungId }) => {
      invalidieren();
      if (sicht !== "zugeordnet") waehleNaechste(zahlungId);
      toast({ title: "Ausgabe dem Objekt zugeordnet" });
    },
    onError: fehlerMelden("Zuordnung fehlgeschlagen"),
  });

  const aufheben = useMutation({
    mutationFn: async (zahlungId: string) => {
      const { error } = await supabase.from("zahlungen").update({ immobilie_id: null }).eq("id", zahlungId);
      if (error) throw error;
    },
    onSuccess: (_, zahlungId) => {
      invalidieren();
      if (sicht === "zugeordnet") waehleNaechste(zahlungId);
      toast({ title: "Objektbezug aufgehoben" });
    },
    onError: fehlerMelden("Aufheben fehlgeschlagen"),
  });

  const alsNichtmiete = useMutation({
    mutationFn: async (zahlungId: string) => {
      const { error } = await supabase.from("zahlungen").update({ kategorie: "Nichtmiete", immobilie_id: null }).eq("id", zahlungId);
      if (error) throw error;
      await supabase.from("nebenkosten_klassifizierungen").update({ uebersprungen: true }).eq("zahlung_id", zahlungId);
    },
    onSuccess: (_, zahlungId) => {
      invalidieren();
      waehleNaechste(zahlungId);
      toast({ title: "Als Nichtmiete markiert und ausgeblendet" });
    },
    onError: fehlerMelden("Umkategorisieren fehlgeschlagen"),
  });

  const alsNebenkosten = useMutation({
    mutationFn: async (zahlungId: string) => {
      const { error } = await supabase.from("zahlungen").update({ kategorie: "Nebenkosten" as never }).eq("id", zahlungId);
      if (error) throw error;
      const { data: vorhanden } = await supabase.from("nebenkosten_klassifizierungen").select("id").eq("zahlung_id", zahlungId).maybeSingle();
      if (vorhanden) {
        await supabase.from("nebenkosten_klassifizierungen").update({ uebersprungen: false, is_betriebskosten: true }).eq("zahlung_id", zahlungId);
      }
    },
    onSuccess: () => {
      invalidieren();
      toast({ title: "Als Nebenkosten markiert" });
    },
    onError: fehlerMelden("Umkategorisieren fehlgeschlagen"),
  });

  const ausblenden = useMutation({
    mutationFn: async (zahlungId: string) => {
      const { data: vorhanden } = await supabase.from("nebenkosten_klassifizierungen").select("id").eq("zahlung_id", zahlungId).maybeSingle();
      if (vorhanden) {
        const { error } = await supabase.from("nebenkosten_klassifizierungen").update({ uebersprungen: true }).eq("zahlung_id", zahlungId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("nebenkosten_klassifizierungen").insert({
          zahlung_id: zahlungId,
          is_betriebskosten: false,
          confidence: "high",
          category: "Nichtmiete",
          uebersprungen: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, zahlungId) => {
      invalidieren();
      waehleNaechste(zahlungId);
      toast({ title: "Ausgabe ausgeblendet" });
    },
    onError: fehlerMelden("Ausblenden fehlgeschlagen"),
  });

  const einblenden = useMutation({
    mutationFn: async (zahlungId: string) => {
      const { error } = await supabase.from("nebenkosten_klassifizierungen").update({ uebersprungen: false }).eq("zahlung_id", zahlungId);
      if (error) throw error;
    },
    onSuccess: (_, zahlungId) => {
      invalidieren();
      waehleNaechste(zahlungId);
      toast({ title: "Ausgabe wieder eingeblendet" });
    },
    onError: fehlerMelden("Einblenden fehlgeschlagen"),
  });

  const klassifizieren = async () => {
    setKlassifiziert(true);
    try {
      const { data, error } = await supabase.functions.invoke("classify-nebenkosten", { body: { force: false } });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["nebenkosten-klassifizierungen-cached"] });
      const neu = Number(data?.ai_classified ?? 0);
      toast(
        neu > 0
          ? { title: `${neu} ${neu === 1 ? "Ausgabe" : "Ausgaben"} neu vorgeschlagen` }
          : { title: "Keine neuen Vorschläge", description: "Alle Ausgaben sind bereits klassifiziert." }
      );
    } catch (e: unknown) {
      console.error("[Nebenkosten] KI-Vorschläge", e);
      toast({ title: "KI-Vorschläge konnten nicht erzeugt werden", variant: "destructive" });
    } finally {
      setKlassifiziert(false);
    }
  };

  const zumObjekt = useCallback(
    (immobilieId: string) => {
      updateNav({
        selectedImmobilie: immobilieId,
        selectedEinheit: null,
        selectedMietvertrag: null,
        showControlboard: false,
        navigationSource: "immobilie",
        selectedTab: "zahlungen",
      });
    },
    [updateNav]
  );

  const beschaeftigt = zuordnen.isPending || aufheben.isPending || alsNichtmiete.isPending || alsNebenkosten.isPending || ausblenden.isPending || einblenden.isPending;
  const laedt = (offene.isLoading || zugeordnete.isLoading) && alleZeilen.length === 0;
  const fehler = offene.isError || zugeordnete.isError;

  const inspector = (schliessen?: () => void) => (
    <NebenkostenInspector
      zahlung={ausgewaehlt}
      sicht={ausgewaehlt ? sichtVon(ausgewaehlt, ausgeblendet) : null}
      vorschlag={ausgewaehlt ? vorschlagNachId.get(ausgewaehlt.id) : undefined}
      immobilien={objekte.data ?? []}
      immobilienLaden={objekte.isLoading}
      immobilienFehler={objekte.isError}
      anzahlJeObjekt={objektAnzahl}
      beschaeftigt={beschaeftigt}
      onZuordnen={(zahlungId, immobilieId) => zuordnen.mutate({ zahlungId, immobilieId })}
      onAufheben={(id) => aufheben.mutate(id)}
      onAlsNichtmiete={(id) => alsNichtmiete.mutate(id)}
      onAlsNebenkosten={(id) => alsNebenkosten.mutate(id)}
      onAusblenden={(id) => ausblenden.mutate(id)}
      onEinblenden={(id) => einblenden.mutate(id)}
      onZumObjekt={zumObjekt}
      onSchliessen={schliessen}
    />
  );

  const inhalt = laedt ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">Ausgaben werden geladen …</p>
    </div>
  ) : fehler ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="font-medium text-destructive">Ausgaben konnten nicht geladen werden</p>
      <p className="text-sm text-muted-foreground">Bitte die Seite neu laden oder die Verbindung prüfen.</p>
    </div>
  ) : gefiltert.length === 0 ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium">
        {filterAktiv ? "Keine Ausgabe entspricht den Filtern" : sicht === "offen" ? "Alle Ausgaben sind einem Objekt zugeordnet" : sicht === "zugeordnet" ? "Noch keine Ausgabe zugeordnet" : "Nichts ausgeblendet"}
      </p>
      {filterAktiv && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFilter(LEERER_FILTER);
            setKategorie("alle");
          }}
        >
          Filter zurücksetzen
        </Button>
      )}
    </div>
  ) : (
    <ZahlungenTabelle
      gruppen={gruppen}
      zeilen={sortiert}
      sortierung={sortierung}
      onSortierung={sortiereNach}
      ausgewaehltId={ausgewaehltId}
      onAuswahl={setAusgewaehltId}
      onOeffnen={() => setDetailsOffen(true)}
      ausgeklappt={offeneMonate}
      onMonatToggle={monatUmschalten}
      hinweise={hinweise}
    />
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", vollbild && "fixed inset-0 z-50")}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="relative min-w-[12rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
            placeholder="Suchen: Empfänger, Verwendungszweck, IBAN, Betrag"
            aria-label="Ausgaben durchsuchen"
            className="h-9 bg-background pl-8 pr-8"
          />
          {filter.suche && (
            <Button variant="ghost" size="icon" className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2" aria-label="Suche leeren" onClick={() => setFilter((f) => ({ ...f, suche: "" }))}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <ToggleGroup
          type="single"
          value={sicht}
          onValueChange={(v) => v && setSicht(v as NebenkostenSicht)}
          aria-label="Sicht"
          className="h-9 gap-0 overflow-hidden rounded-md border border-input bg-background"
        >
          {(
            [
              ["offen", "Ohne Objekt", zaehler.offen],
              ["zugeordnet", "Zugeordnet", zaehler.zugeordnet],
              ["ausgeblendet", "Ausgeblendet", zaehler.ausgeblendet],
            ] as const
          ).map(([wert, label, anzahl]) => (
            <ToggleGroupItem key={wert} value={wert} className="h-full gap-1.5 rounded-none border-r px-3 text-xs last:border-r-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
              {label}
              <span className="rounded bg-muted px-1 tabular-nums text-muted-foreground">{anzahl}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={kategorie}
          onValueChange={(v) => v && setKategorie(v as NebenkostenKategorie)}
          aria-label="Kategorie"
          className="h-9 gap-0 overflow-hidden rounded-md border border-input bg-background"
        >
          {(
            [
              ["alle", "Alle"],
              ["Nebenkosten", "Nebenkosten"],
              ["Nichtmiete", "Nichtmiete"],
            ] as const
          ).map(([wert, label]) => (
            <ToggleGroupItem key={wert} value={wert} className="h-full rounded-none border-r px-3 text-xs last:border-r-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ZeitraumFilter von={filter.von} bis={filter.bis} onChange={(von, bis) => setFilter((f) => ({ ...f, von, bis }))} />

        {filterAktiv && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setFilter(LEERER_FILTER);
              setKategorie("alle");
            }}
          >
            <X className="h-3.5 w-3.5" />
            Filter zurücksetzen
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {laedt || fehler ? "–" : `${gefiltert.length.toLocaleString("de-DE")} ${gefiltert.length === 1 ? "Ausgabe" : "Ausgaben"}`}
            {!laedt && !fehler && gefiltert.length > 0 && (
              <>
                {" · Summe "}
                <span className={cn("font-medium", summe < 0 ? "text-destructive" : "text-foreground")}>{formatEuro(summe)}</span>
              </>
            )}
          </p>
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={klassifizieren} disabled={klassifiziert} aria-busy={klassifiziert}>
            {klassifiziert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {klassifiziert ? "Analysiert …" : "KI-Vorschläge"}
          </Button>
          {gruppen && gruppen.length > 1 && !sucheAktiv && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={alleMonateOffen ? "Alle Monate zuklappen" : "Alle Monate aufklappen"}
              aria-pressed={alleMonateOffen}
              onClick={alleMonateUmschalten}
            >
              {alleMonateOffen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="hidden h-9 w-9 lg:inline-flex"
            aria-label={detailsOffen ? "Detailspalte ausblenden" : "Detailspalte einblenden"}
            aria-pressed={detailsOffen}
            onClick={() => setDetailsOffen((v) => !v)}
          >
            {detailsOffen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label={vollbild ? "Vollbild beenden" : "Vollbild"} aria-pressed={vollbild} onClick={() => setVollbild((v) => !v)}>
            {vollbild ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{inhalt}</div>
        {istDesktop && detailsOffen && (
          <aside className="w-[22rem] shrink-0 border-l bg-card xl:w-[24rem]" aria-label="Details zur gewählten Ausgabe">
            {inspector()}
          </aside>
        )}
      </div>

      {!istDesktop && (
        <Sheet open={Boolean(ausgewaehlt)} onOpenChange={(offen) => !offen && setAusgewaehltId(null)}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Details zur Ausgabe</SheetTitle>
            {inspector(() => setAusgewaehltId(null))}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
