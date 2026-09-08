import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, UIEvent } from "react";
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
} from "@/utils/zahlungenAnsicht";

/**
 * Die Buchungstabelle der Zahlungsübersicht — gefenstert.
 *
 * Bis zum 07.09.2026 war jede Zahlung eine Karte in einem aufklappbaren
 * Monat (rund 100 px hoch, sechs bis sieben Buchungen je Bildschirm). Die
 * erste Tabellenfassung vom selben Tag zeichnete alle 3500 Zeilen auf einmal:
 * gemessen 37.000 DOM-Knoten, 7,9 s bis zur Anzeige und 5,8 s je Sortierung
 * auf einem vierfach gedrosselten Rechner. Deshalb liegen jetzt nur die
 * sichtbaren Zeilen plus Vorlauf im DOM; alle Zeilen sind 36 px hoch, damit
 * sich Scrollposition und Zeilenindex ohne Messen ineinander umrechnen.
 *
 * Erhalten bleiben Monatsgruppen mit haftender Kopfzeile, Tastaturbedienung,
 * Sprung zu einer Buchung per ID und die Auswahlmarkierung.
 */

/** Höhe jeder Zeile in Pixeln — Buchung wie Monatskopf. Grundlage der Fensterung. */
export const ZEILENHOEHE = 36;
const KOPFHOEHE = 36;
const VORLAUF = 10;

interface ZahlungenTabelleProps {
  /** Bei Sortierung nach Datum gruppiert nach Monat, sonst null. */
  gruppen: MonatsGruppe[] | null;
  /** Flache, sortierte Liste — Grundlage ohne Gruppen. */
  zeilen: ZahlungZeile[];
  sortierung: Sortierung;
  onSortierung: (feld: SortierFeld) => void;
  ausgewaehltId: string | null;
  onAuswahl: (id: string) => void;
  /** Enter oder Doppelklick: Zuordnung öffnen. */
  onOeffnen: (zahlung: ZahlungZeile) => void;
  eingeklappt: ReadonlySet<string>;
  onMonatToggle: (monatKey: string) => void;
  /** Zu dieser Buchung scrollen; `nonce` löst denselben Sprung erneut aus. */
  sprung?: { id: string; nonce: number } | null;
  onSprungErgebnis?: (gefunden: boolean) => void;
}

type Eintrag =
  | { art: "gruppe"; key: string; gruppe: MonatsGruppe; offen: boolean }
  | { art: "zahlung"; key: string; zahlung: ZahlungZeile; gruppenIndex: number | null };

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
      style={{ height: ZEILENHOEHE }}
      className={cn(
        "cursor-pointer border-b border-border/70 text-sm transition-colors",
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

const GruppenZeile = memo(function GruppenZeile({
  gruppe,
  offen,
  onToggle,
}: {
  gruppe: MonatsGruppe;
  offen: boolean;
  onToggle: (monatKey: string) => void;
}) {
  return (
    <tr className="text-sm" style={{ height: ZEILENHOEHE }}>
      <td colSpan={SPALTEN} className="sticky top-9 z-10 border-b bg-muted/95 p-0 backdrop-blur-sm">
        <div className="flex h-9 items-center gap-2 px-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 font-semibold"
            aria-expanded={offen}
            aria-label={`${gruppe.label} ${offen ? "einklappen" : "ausklappen"}`}
            onClick={() => onToggle(gruppe.monatKey)}
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
});

function Abstand({ hoehe }: { hoehe: number }) {
  if (hoehe <= 0) return null;
  return (
    <tr aria-hidden="true" style={{ height: hoehe }}>
      <td colSpan={SPALTEN} className="p-0" />
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
  sprung,
  onSprungErgebnis,
}: ZahlungenTabelleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [hoehe, setHoehe] = useState(600);
  const frameRef = useRef<number | null>(null);

  // Flache Liste aus Monatsköpfen und Buchungen; jede Position ist ZEILENHOEHE hoch.
  const eintraege = useMemo<Eintrag[]>(() => {
    if (!gruppen) return zeilen.map((z) => ({ art: "zahlung", key: z.id, zahlung: z, gruppenIndex: null }));
    const liste: Eintrag[] = [];
    for (const gruppe of gruppen) {
      const offen = !eingeklappt.has(gruppe.monatKey);
      const gruppenIndex = liste.length;
      liste.push({ art: "gruppe", key: `g-${gruppe.monatKey}`, gruppe, offen });
      if (offen) for (const z of gruppe.zahlungen) liste.push({ art: "zahlung", key: z.id, zahlung: z, gruppenIndex });
    }
    return liste;
  }, [gruppen, zeilen, eingeklappt]);

  // Reihenfolge, in der ↑/↓ blättern: nur sichtbare (ausgeklappte) Buchungen.
  const sichtbar = useMemo(() => eintraege.flatMap((e) => (e.art === "zahlung" ? [e.zahlung] : [])), [eintraege]);
  const indexNachId = useMemo(() => {
    const map = new Map<string, number>();
    eintraege.forEach((e, i) => {
      if (e.art === "zahlung") map.set(e.zahlung.id, i);
    });
    return map;
  }, [eintraege]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const messen = () => setHoehe(el.clientHeight || 600);
    messen();
    if (typeof ResizeObserver === "undefined") return;
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, []);

  // Wenn die Liste kürzer wird (Filter), darf die Scrollposition nicht ins Leere zeigen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const maxTop = Math.max(0, KOPFHOEHE + eintraege.length * ZEILENHOEHE - el.clientHeight);
    if (el.scrollTop > maxTop) {
      el.scrollTop = maxTop;
      setScrollTop(maxTop);
    }
  }, [eintraege.length]);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setScrollTop(top);
    });
  }, []);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  /** Bringt die Position `index` in den sichtbaren Bereich unter Tabellenkopf und Monatskopf. */
  const scrolleZuIndex = useCallback(
    (index: number, mitte = false) => {
      const el = containerRef.current;
      if (!el) return;
      const oben = KOPFHOEHE + index * ZEILENHOEHE;
      const unten = oben + ZEILENHOEHE;
      const deckel = KOPFHOEHE + (gruppen ? ZEILENHOEHE : 0);
      let ziel = el.scrollTop;
      if (mitte) ziel = oben - Math.max(0, (el.clientHeight - ZEILENHOEHE) / 2);
      else if (oben - deckel < el.scrollTop) ziel = oben - deckel;
      else if (unten > el.scrollTop + el.clientHeight) ziel = unten - el.clientHeight;
      ziel = Math.max(0, ziel);
      if (ziel !== el.scrollTop) {
        el.scrollTop = ziel;
        setScrollTop(ziel);
      }
    },
    [gruppen]
  );

  useEffect(() => {
    if (!sprung) return;
    const index = indexNachId.get(sprung.id);
    if (index === undefined) {
      onSprungErgebnis?.(false);
      return;
    }
    scrolleZuIndex(index, true);
    onSprungErgebnis?.(true);
    // Der Sprung soll genau einmal je nonce laufen, nicht bei jeder Listenänderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprung?.nonce]);

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
        case "PageDown":
        case "PageUp": {
          const schritt = Math.max(1, Math.floor(hoehe / ZEILENHOEHE) - 2);
          const neu = e.key === "PageDown" ? Math.min(pos + schritt, sichtbar.length - 1) : Math.max(pos - schritt, 0);
          ziel = sichtbar[neu];
          break;
        }
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
        const index = indexNachId.get(ziel.id);
        if (index !== undefined) scrolleZuIndex(index);
      }
    },
    [sichtbar, ausgewaehltId, onAuswahl, onOeffnen, indexNachId, scrolleZuIndex, hoehe]
  );

  // Sichtbares Fenster
  const gesamt = eintraege.length;
  const ersteSichtbare = Math.max(0, Math.floor((scrollTop - KOPFHOEHE) / ZEILENHOEHE));
  const start = Math.max(0, ersteSichtbare - VORLAUF);
  const ende = Math.min(gesamt, Math.ceil((scrollTop - KOPFHOEHE + hoehe) / ZEILENHOEHE) + VORLAUF);
  const fenster = eintraege.slice(start, ende);

  // Monatskopf der ersten sichtbaren Buchung, falls er selbst schon aus dem Fenster gescrollt ist:
  // eine Kopie haftet oben. Sie ersetzt 36 px des Abstands, damit die Positionen stimmen.
  let angeheftet: Extract<Eintrag, { art: "gruppe" }> | null = null;
  const ersterEintrag = eintraege[Math.min(Math.max(ersteSichtbare, 0), Math.max(gesamt - 1, 0))];
  if (gruppen && ersterEintrag && ersterEintrag.art === "zahlung" && ersterEintrag.gruppenIndex !== null && ersterEintrag.gruppenIndex < start) {
    const kopf = eintraege[ersterEintrag.gruppenIndex];
    if (kopf.art === "gruppe") angeheftet = kopf;
  }
  const abstandOben = start * ZEILENHOEHE - (angeheftet ? ZEILENHOEHE : 0);
  const abstandUnten = (gesamt - ende) * ZEILENHOEHE;

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full w-full overflow-auto bg-card">
      <table
        role="grid"
        tabIndex={0}
        aria-label="Buchungen. Mit Pfeiltasten blättern, Enter ordnet die gewählte Buchung zu."
        aria-rowcount={gesamt}
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
        <thead>
          <tr style={{ height: KOPFHOEHE }}>
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
        <tbody>
          <Abstand hoehe={abstandOben} />
          {angeheftet && <GruppenZeile key={`pin-${angeheftet.key}`} gruppe={angeheftet.gruppe} offen={angeheftet.offen} onToggle={onMonatToggle} />}
          {fenster.map((e) =>
            e.art === "gruppe" ? (
              <GruppenZeile key={e.key} gruppe={e.gruppe} offen={e.offen} onToggle={onMonatToggle} />
            ) : (
              <Zeile key={e.key} z={e.zahlung} aktiv={e.zahlung.id === ausgewaehltId} onAuswahl={onAuswahl} onOeffnen={onOeffnen} />
            )
          )}
          <Abstand hoehe={abstandUnten} />
        </tbody>
      </table>
    </div>
  );
}
