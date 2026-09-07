import { memo, useCallback, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KategorieBadge } from "./KategorieBadge";
import {
  MonatsGruppe,
  SortierFeld,
  Sortierung,
  ZahlungZeile,
  brauchtZuordnung,
  formatEuro,
  istZugeordnet,
} from "@/utils/zahlungenAnsicht";

/**
 * Die Buchungstabelle der Zahlungsübersicht.
 *
 * Bis zum 07.09.2026 war jede Zahlung eine Karte in einem aufklappbaren
 * Monat (rund 100 px hoch, sechs bis sieben Buchungen je Bildschirm). Die
 * Buchhaltung arbeitet hier mit tausenden Zeilen; docs/architektur.md §5
 * verlangt dafür eine Tabelle mit ausgerichteten Beträgen, sortierbaren
 * Kopfzeilen und Tastaturbedienung. Eine Zeile ist 36 px hoch — auf einem
 * 1080p-Bildschirm sind das rund 25 Buchungen auf einen Blick.
 *
 * Bewusst ohne Virtualisierung: Die Zeilen sind flach und memoisiert; der
 * Sprung vom Anomalien-Banner sucht die Zeile per data-zahlung-id im DOM,
 * was mit Fensterung nicht mehr ginge.
 */

interface ZahlungenTabelleProps {
  /** Bei Sortierung nach Datum gruppiert nach Monat, sonst null. */
  gruppen: MonatsGruppe[] | null;
  /** Flache, sortierte Liste — Grundlage für die Tastaturnavigation. */
  zeilen: ZahlungZeile[];
  sortierung: Sortierung;
  onSortierung: (feld: SortierFeld) => void;
  ausgewaehltId: string | null;
  onAuswahl: (id: string) => void;
  /** Enter oder Doppelklick: Zuordnung öffnen. */
  onOeffnen: (zahlung: ZahlungZeile) => void;
  eingeklappt: ReadonlySet<string>;
  onMonatToggle: (monatKey: string) => void;
}

const SPALTEN = 6;

function KopfZelle({
  feld,
  label,
  sortierung,
  onSortierung,
  className,
}: {
  feld: SortierFeld;
  label: string;
  sortierung: Sortierung;
  onSortierung: (feld: SortierFeld) => void;
  className?: string;
}) {
  const aktiv = sortierung.feld === feld;
  const Icon = !aktiv ? ChevronsUpDown : sortierung.richtung === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={aktiv ? (sortierung.richtung === "asc" ? "ascending" : "descending") : "none"}
      className={cn("sticky top-0 z-20 h-9 bg-card px-0 text-left text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]", className)}
    >
      <button
        type="button"
        onClick={() => onSortierung(feld)}
        className={cn(
          "flex h-9 w-full items-center gap-1 px-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          className?.includes("text-right") && "justify-end",
          aktiv && "text-foreground"
        )}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
    </th>
  );
}

function ZuordnungZelle({ z }: { z: ZahlungZeile }) {
  if (z.mietvertrag_id) {
    const objekt = [z.immobilie_name, z.einheit_etage].filter(Boolean).join(" · ");
    return (
      <span className="block truncate">
        <span className="font-medium">{z.mieter_name || "Vertrag ohne Mieter"}</span>
        {objekt && <span className="text-muted-foreground"> · {objekt}</span>}
      </span>
    );
  }
  if (z.immobilie_id) {
    return (
      <span className="block truncate">
        <span className="font-medium">{z.immobilie_name || "Objekt"}</span>
        <span className="text-muted-foreground"> · Objekt</span>
      </span>
    );
  }
  if (brauchtZuordnung(z)) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Offen
      </span>
    );
  }
  return <span className="text-muted-foreground">–</span>;
}

interface ZeileProps {
  z: ZahlungZeile;
  aktiv: boolean;
  onAuswahl: (id: string) => void;
  onOeffnen: (zahlung: ZahlungZeile) => void;
}

const Zeile = memo(function Zeile({ z, aktiv, onAuswahl, onOeffnen }: ZeileProps) {
  return (
    <tr
      id={`zahlung-${z.id}`}
      data-zahlung-id={z.id}
      aria-selected={aktiv}
      onClick={() => onAuswahl(z.id)}
      onDoubleClick={() => onOeffnen(z)}
      className={cn(
        "h-9 cursor-pointer border-b border-border/70 text-sm transition-colors",
        aktiv ? "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-muted/60",
        !aktiv && brauchtZuordnung(z) && "bg-warning/5"
      )}
    >
      <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">{z.buchungsdatum_formatted}</td>
      <td className={cn("whitespace-nowrap px-3 text-right font-medium tabular-nums", z.betrag < 0 ? "text-destructive" : "text-success")}>
        {formatEuro(z.betrag)}
      </td>
      <td className="truncate px-3" title={z.empfaengername ?? undefined}>
        {z.empfaengername || <span className="text-muted-foreground">–</span>}
      </td>
      <td className="truncate px-3 text-muted-foreground" title={z.verwendungszweck ?? undefined}>
        {z.verwendungszweck || "–"}
      </td>
      <td className="px-3">
        <KategorieBadge kategorie={z.kategorie} />
      </td>
      <td className="truncate px-3">
        <ZuordnungZelle z={z} />
      </td>
    </tr>
  );
});

function GruppenZeile({
  gruppe,
  offen,
  onToggle,
}: {
  gruppe: MonatsGruppe;
  offen: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="text-sm">
      <td colSpan={SPALTEN} className="sticky top-9 z-10 border-b bg-muted/95 p-0 backdrop-blur-sm">
        <div className="flex h-8 items-center gap-2 px-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 font-semibold"
            aria-expanded={offen}
            aria-label={`${gruppe.label} ${offen ? "einklappen" : "ausklappen"}`}
            onClick={onToggle}
          >
            {offen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {gruppe.label}
          </Button>
          <span className="text-xs text-muted-foreground">
            {gruppe.zahlungen.length} {gruppe.zahlungen.length === 1 ? "Buchung" : "Buchungen"}
          </span>
          <span className={cn("ml-auto pr-1 text-xs font-medium tabular-nums", gruppe.summe < 0 ? "text-destructive" : "text-foreground")}>
            {formatEuro(gruppe.summe)}
          </span>
        </div>
      </td>
    </tr>
  );
}

export function ZahlungenTabelle({
  gruppen,
  zeilen,
  sortierung,
  onSortierung,
  ausgewaehltId,
  onAuswahl,
  onOeffnen,
  eingeklappt,
  onMonatToggle,
}: ZahlungenTabelleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Reihenfolge, in der ↑/↓ blättern: nur sichtbare (ausgeklappte) Zeilen.
  const sichtbar = useMemo(() => {
    if (!gruppen) return zeilen;
    return gruppen.flatMap((g) => (eingeklappt.has(g.monatKey) ? [] : g.zahlungen));
  }, [gruppen, zeilen, eingeklappt]);

  const scrolleZu = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-zahlung-id="${id}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableElement>) => {
      if (sichtbar.length === 0) return;
      const pos = ausgewaehltId ? sichtbar.findIndex((z) => z.id === ausgewaehltId) : -1;
      let ziel: ZahlungZeile | undefined;
      switch (e.key) {
        case "ArrowDown":
          ziel = sichtbar[Math.min(pos + 1, sichtbar.length - 1)];
          break;
        case "ArrowUp":
          ziel = pos === -1 ? sichtbar[sichtbar.length - 1] : sichtbar[Math.max(pos - 1, 0)];
          break;
        case "Home":
          ziel = sichtbar[0];
          break;
        case "End":
          ziel = sichtbar[sichtbar.length - 1];
          break;
        case "Enter": {
          const aktuelle = pos >= 0 ? sichtbar[pos] : undefined;
          if (aktuelle) {
            e.preventDefault();
            onOeffnen(aktuelle);
          }
          return;
        }
        default:
          return;
      }
      e.preventDefault();
      if (ziel && ziel.id !== ausgewaehltId) {
        onAuswahl(ziel.id);
        scrolleZu(ziel.id);
      }
    },
    [sichtbar, ausgewaehltId, onAuswahl, onOeffnen, scrolleZu]
  );

  const kopf = (
    <thead>
      <tr>
        <KopfZelle feld="datum" label="Datum" sortierung={sortierung} onSortierung={onSortierung} />
        <KopfZelle feld="betrag" label="Betrag" sortierung={sortierung} onSortierung={onSortierung} className="text-right" />
        <th scope="col" className="sticky top-0 z-20 h-9 bg-card px-3 text-left text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
          Von / An
        </th>
        <th scope="col" className="sticky top-0 z-20 h-9 bg-card px-3 text-left text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
          Verwendungszweck
        </th>
        <KopfZelle feld="kategorie" label="Kategorie" sortierung={sortierung} onSortierung={onSortierung} />
        <KopfZelle feld="zuordnung" label="Zuordnung" sortierung={sortierung} onSortierung={onSortierung} />
      </tr>
    </thead>
  );

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto bg-card">
      <table
        role="grid"
        tabIndex={0}
        aria-label="Buchungen. Mit Pfeiltasten blättern, Enter ordnet die gewählte Buchung zu."
        aria-activedescendant={ausgewaehltId ? `zahlung-${ausgewaehltId}` : undefined}
        onKeyDown={handleKeyDown}
        className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <colgroup>
          <col className="w-[6.5rem]" />
          <col className="w-[8rem]" />
          <col className="w-[19%]" />
          <col />
          <col className="w-[9rem]" />
          <col className="w-[23%]" />
        </colgroup>
        {kopf}
        <tbody>
          {gruppen
            ? gruppen.map((gruppe) => {
                const offen = !eingeklappt.has(gruppe.monatKey);
                return [
                  <GruppenZeile key={`g-${gruppe.monatKey}`} gruppe={gruppe} offen={offen} onToggle={() => onMonatToggle(gruppe.monatKey)} />,
                  ...(offen
                    ? gruppe.zahlungen.map((z) => (
                        <Zeile key={z.id} z={z} aktiv={z.id === ausgewaehltId} onAuswahl={onAuswahl} onOeffnen={onOeffnen} />
                      ))
                    : []),
                ];
              })
            : zeilen.map((z) => <Zeile key={z.id} z={z} aktiv={z.id === ausgewaehltId} onAuswahl={onAuswahl} onOeffnen={onOeffnen} />)}
        </tbody>
      </table>
    </div>
  );
}
