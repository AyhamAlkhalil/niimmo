import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar as CalendarIcon, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Search, X } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { ZahlungenTabelle } from "./ZahlungenTabelle";
import { ZahlungInspector } from "./ZahlungInspector";
import { OHNE_KATEGORIE_LABEL, ZAHLUNG_KATEGORIEN } from "@/utils/zahlungKategorie";
import {
  LEERER_FILTER,
  OHNE_KATEGORIE,
  STANDARD_SORTIERUNG,
  SortierFeld,
  Sortierung,
  ZEITRAUM_VORGABEN,
  ZahlungZeile,
  ZahlungenFilter,
  ZuordnungsSicht,
  filtereZahlungen,
  formatEuro,
  gruppiereNachMonat,
  hatAktivenFilter,
  sortiereZahlungen,
  summeBetraege,
  zeitraumVoreinstellung,
} from "@/utils/zahlungenAnsicht";

/**
 * Der Arbeitsplatz „Alle Zahlungen": Werkzeugleiste, Buchungstabelle in
 * voller Breite und eine schmale Detailspalte rechts.
 *
 * Bis zum 07.09.2026 teilten sich Liste und Details den Platz halbe-halbe;
 * die Liste war eine Kartenspalte mit sechs Buchungen je Bildschirm, die
 * rechte Hälfte meist leer. Jetzt hat die Tabelle Vorrang, die Details
 * nehmen nur so viel Platz, wie sie brauchen, und lassen sich ausblenden.
 */

export interface SprungZiel {
  zahlungId: string;
  buchungsdatum: string | null;
  /** Ändert sich bei jedem Sprung, damit derselbe Sprung zweimal auslöst. */
  nonce: number;
}

interface ZahlungenArbeitsplatzProps {
  zahlungen: ZahlungZeile[] | undefined;
  laedt: boolean;
  fehler: boolean;
  onZuordnen: (zahlung: ZahlungZeile) => void;
  sprungZiel: SprungZiel | null;
}

/** Erste Sortierrichtung beim Klick auf eine neue Spalte. */
const STANDARD_RICHTUNG: Record<SortierFeld, Sortierung["richtung"]> = {
  datum: "desc",
  betrag: "desc",
  kategorie: "asc",
  zuordnung: "asc",
};

export function ZahlungenArbeitsplatz({ zahlungen, laedt, fehler, onZuordnen, sprungZiel }: ZahlungenArbeitsplatzProps) {
  const { toast } = useToast();
  const istDesktop = useMediaQuery("(min-width: 1024px)");

  const [filter, setFilter] = useState<ZahlungenFilter>(LEERER_FILTER);
  const [sortierung, setSortierung] = useState<Sortierung>(STANDARD_SORTIERUNG);
  const [eingeklappt, setEingeklappt] = useState<Set<string>>(() => new Set());
  const [ausgewaehltId, setAusgewaehltId] = useState<string | null>(null);
  const [detailsOffen, setDetailsOffen] = useState(true);
  const [vollbild, setVollbild] = useState(false);
  const [zeitraumOffen, setZeitraumOffen] = useState(false);

  // Tippen bleibt flüssig: Die Tabelle folgt dem Suchbegriff mit Verzögerung.
  const suche = useDeferredValue(filter.suche);

  const gefiltert = useMemo(
    () => (zahlungen ? filtereZahlungen(zahlungen, { ...filter, suche }) : []),
    [zahlungen, filter, suche]
  );
  const sortiert = useMemo(() => sortiereZahlungen(gefiltert, sortierung), [gefiltert, sortierung]);
  const gruppen = useMemo(
    () => (sortierung.feld === "datum" ? gruppiereNachMonat(sortiert, sortierung.richtung) : null),
    [sortiert, sortierung]
  );
  const summe = useMemo(() => summeBetraege(gefiltert), [gefiltert]);

  const nachId = useMemo(() => new Map((zahlungen ?? []).map((z) => [z.id, z])), [zahlungen]);
  const ausgewaehlt = ausgewaehltId ? nachId.get(ausgewaehltId) : undefined;

  const filterAktiv = hatAktivenFilter(filter);

  const aendereFilter = useCallback(<K extends keyof ZahlungenFilter>(schluessel: K, wert: ZahlungenFilter[K]) => {
    setFilter((f) => ({ ...f, [schluessel]: wert }));
  }, []);

  const filterZuruecksetzen = useCallback(() => setFilter(LEERER_FILTER), []);

  const sortiereNach = useCallback((feld: SortierFeld) => {
    setSortierung((s) =>
      s.feld === feld ? { feld, richtung: s.richtung === "asc" ? "desc" : "asc" } : { feld, richtung: STANDARD_RICHTUNG[feld] }
    );
  }, []);

  const monatUmschalten = useCallback((monatKey: string) => {
    setEingeklappt((prev) => {
      const next = new Set(prev);
      if (next.has(monatKey)) next.delete(monatKey);
      else next.add(monatKey);
      return next;
    });
  }, []);

  // Sprung vom Anomalien-Banner: Filter weg, Monat auf, Zeile markieren; die
  // Tabelle scrollt selbst hin (gefenstert — die Zeile steht erst dann im DOM).
  const [sprung, setSprung] = useState<{ id: string; nonce: number } | null>(null);
  useEffect(() => {
    if (!sprungZiel) return;
    setFilter(LEERER_FILTER);
    setSortierung(STANDARD_SORTIERUNG);
    if (sprungZiel.buchungsdatum) {
      const monatKey = sprungZiel.buchungsdatum.slice(0, 7);
      setEingeklappt((prev) => {
        if (!prev.has(monatKey)) return prev;
        const next = new Set(prev);
        next.delete(monatKey);
        return next;
      });
    } else {
      setEingeklappt(new Set());
    }
    setAusgewaehltId(sprungZiel.zahlungId);
    setSprung({ id: sprungZiel.zahlungId, nonce: sprungZiel.nonce });
  }, [sprungZiel]);

  const handleSprungErgebnis = useCallback(
    (gefunden: boolean) => {
      if (gefunden) return;
      toast({
        title: "Zahlung nicht gefunden",
        description: "Diese Zahlung ist in der aktuellen Liste nicht (mehr) auffindbar.",
        variant: "destructive",
      });
    },
    [toast]
  );

  useEffect(() => {
    if (!vollbild) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVollbild(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [vollbild]);

  const zeitraumText =
    filter.von && filter.bis
      ? `${format(filter.von, "dd.MM.yy", { locale: de })} – ${format(filter.bis, "dd.MM.yy", { locale: de })}`
      : filter.von
        ? `ab ${format(filter.von, "dd.MM.yy", { locale: de })}`
        : filter.bis
          ? `bis ${format(filter.bis, "dd.MM.yy", { locale: de })}`
          : "Zeitraum";

  const inhalt = laedt ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">Buchungen werden geladen …</p>
    </div>
  ) : fehler ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="font-medium text-destructive">Buchungen konnten nicht geladen werden</p>
      <p className="text-sm text-muted-foreground">Bitte die Seite neu laden oder die Verbindung prüfen.</p>
    </div>
  ) : gefiltert.length === 0 ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium">{filterAktiv ? "Keine Buchung entspricht den Filtern" : "Noch keine Buchungen"}</p>
      {filterAktiv ? (
        <Button variant="outline" size="sm" onClick={filterZuruecksetzen}>
          Filter zurücksetzen
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Über „CSV-Import" lassen sich Kontoumsätze einlesen.</p>
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
      onOeffnen={onZuordnen}
      eingeklappt={eingeklappt}
      onMonatToggle={monatUmschalten}
      sprung={sprung}
      onSprungErgebnis={handleSprungErgebnis}
    />
  );

  return (
    // Vollbild bleibt auf z-50 wie die Dialoge: Radix-Portale (Select, Popover, Sheet) liegen ebenfalls auf
    // z-50 und gewinnen durch ihre spätere Position im DOM. Ein höherer Wert würde sie verdecken.
    <div className={cn("flex h-full min-h-0 flex-col bg-background", vollbild && "fixed inset-0 z-50")}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="relative min-w-[12rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filter.suche}
            onChange={(e) => aendereFilter("suche", e.target.value)}
            placeholder="Suchen: Name, Verwendungszweck, IBAN, Betrag, Datum"
            aria-label="Buchungen durchsuchen"
            className="h-9 bg-background pl-8 pr-8"
          />
          {filter.suche && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
              aria-label="Suche leeren"
              onClick={() => aendereFilter("suche", "")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <Select value={filter.kategorie ?? "alle"} onValueChange={(v) => aendereFilter("kategorie", v === "alle" ? null : v)}>
          <SelectTrigger className="h-9 w-[10.5rem] bg-background" aria-label="Kategorie filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle Kategorien</SelectItem>
            {ZAHLUNG_KATEGORIEN.map((k) => (
              <SelectItem key={k.wert} value={k.wert}>
                {k.label}
              </SelectItem>
            ))}
            <SelectItem value={OHNE_KATEGORIE}>{OHNE_KATEGORIE_LABEL}</SelectItem>
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={filter.zuordnung}
          onValueChange={(v) => v && aendereFilter("zuordnung", v as ZuordnungsSicht)}
          aria-label="Nach Zuordnung filtern"
          className="h-9 gap-0 overflow-hidden rounded-md border border-input bg-background"
        >
          {(
            [
              ["alle", "Alle"],
              ["zugeordnet", "Zugeordnet"],
              ["nicht-zugeordnet", "Nicht zugeordnet"],
            ] as const
          ).map(([wert, label]) => (
            <ToggleGroupItem
              key={wert}
              value={wert}
              className="h-full rounded-none border-r px-3 text-xs last:border-r-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Popover open={zeitraumOffen} onOpenChange={setZeitraumOffen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-9 bg-background text-xs", (filter.von || filter.bis) && "border-primary/50 bg-primary/5")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {zeitraumText}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              <div className="flex flex-col gap-0.5 border-r p-2">
                {ZEITRAUM_VORGABEN.map((v) => (
                  <Button
                    key={v.wert}
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-start text-xs"
                    onClick={() => {
                      const { von, bis } = zeitraumVoreinstellung(v.wert);
                      setFilter((f) => ({ ...f, von, bis }));
                      setZeitraumOffen(false);
                    }}
                  >
                    {v.label}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start text-xs text-muted-foreground"
                  disabled={!filter.von && !filter.bis}
                  onClick={() => {
                    setFilter((f) => ({ ...f, von: undefined, bis: undefined }));
                    setZeitraumOffen(false);
                  }}
                >
                  Gesamter Zeitraum
                </Button>
              </div>
              <Calendar
                mode="range"
                selected={{ from: filter.von, to: filter.bis }}
                onSelect={(bereich) => setFilter((f) => ({ ...f, von: bereich?.from, bis: bereich?.to }))}
                numberOfMonths={2}
                locale={de}
                initialFocus
              />
            </div>
          </PopoverContent>
        </Popover>

        {filterAktiv && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={filterZuruecksetzen}>
            <X className="h-3.5 w-3.5" />
            Filter zurücksetzen
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {laedt || fehler ? "–" : `${gefiltert.length.toLocaleString("de-DE")} von ${(zahlungen?.length ?? 0).toLocaleString("de-DE")} Buchungen`}
            {!laedt && !fehler && gefiltert.length > 0 && (
              <>
                {" · Summe "}
                <span className={cn("font-medium", summe < 0 ? "text-destructive" : "text-foreground")}>{formatEuro(summe)}</span>
              </>
            )}
          </p>
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
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label={vollbild ? "Vollbild beenden" : "Vollbild"}
            aria-pressed={vollbild}
            onClick={() => setVollbild((v) => !v)}
          >
            {vollbild ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{inhalt}</div>
        {istDesktop && detailsOffen && (
          <aside className="w-[22rem] shrink-0 border-l bg-card xl:w-[24rem]" aria-label="Details zur gewählten Buchung">
            <ZahlungInspector zahlung={ausgewaehlt} onZuordnen={onZuordnen} />
          </aside>
        )}
      </div>

      {!istDesktop && (
        <Sheet open={Boolean(ausgewaehlt)} onOpenChange={(offen) => !offen && setAusgewaehltId(null)}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Details zur Buchung</SheetTitle>
            {/* Das Schließen-Kreuz bringt SheetContent selbst mit. */}
            <ZahlungInspector zahlung={ausgewaehlt} onZuordnen={onZuordnen} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
