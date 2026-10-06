import { AlertTriangle, Hand, Moon, MousePointerClick, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ObjektModell } from "@/utils/ansicht3d/objektModell";
import type { Platz } from "@/utils/ansicht3d/quartier";
import { Anker, type Ankerregister } from "./Beschriftungen3D";
import type { Zeigerziel } from "./Szene3D";
import { legendenfarbe, type Tageszeit } from "./szene3dHilfen";
import { STATUS_TEXT, type ObjektAnsicht, type Partei } from "./ansicht3dTypen";
import { Belegungsbalken, StatusChip } from "./Bausteine3D";
import { einheitTitel, etageText, geld, mieterText, zustandText } from "./ansicht3dText";

const KEIN_ZIEL: Zeigerziel = { immobilieId: null, einheitId: null };

/** Namensschilder über den Häusern in der Übersicht — echte Knöpfe, per Tastatur erreichbar. */
export function ObjektSchilder({
  objekte,
  register,
  hover,
  onFokus,
  onHover,
}: {
  objekte: ObjektAnsicht[];
  register: Ankerregister;
  hover: Zeigerziel;
  onFokus: (id: string) => void;
  onHover: (ziel: Zeigerziel) => void;
}) {
  return (
    <>
      {objekte.map((o) => {
        const k = o.kennzahlen;
        const aktiv = hover.immobilieId === o.immobilie.id;
        const ziel = { immobilieId: o.immobilie.id, einheitId: null };
        return (
          <Anker
            key={o.immobilie.id}
            register={register}
            id={`objekt-${o.immobilie.id}`}
            x={o.platz.x + o.modell.anker.x}
            y={o.modell.anker.y + 0.2}
            z={o.platz.z + o.modell.anker.z}
            entzerren
            prioritaet={aktiv ? 1 : 0}
          >
            <button
              type="button"
              onClick={() => onFokus(o.immobilie.id)}
              onMouseEnter={() => onHover(ziel)}
              onMouseLeave={() => onHover(KEIN_ZIEL)}
              onFocus={() => onHover(ziel)}
              onBlur={() => onHover(KEIN_ZIEL)}
              aria-label={`${o.immobilie.name}: ${k.vermietet + k.gekuendigt} von ${k.einheiten} Einheiten vermietet. Heranfliegen.`}
              className={cn(
                "pointer-events-auto mb-1 flex flex-col gap-1 rounded-lg border border-border/70 bg-card/90 px-2.5 py-1 text-left shadow-md backdrop-blur-md transition-[opacity,transform,box-shadow] duration-200",
                "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "group-data-[verdeckt=true]:pointer-events-none group-data-[verdeckt=true]:opacity-0",
                aktiv && "-translate-y-0.5 border-primary/60 ring-2 ring-primary/40"
              )}
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-xs font-semibold text-foreground">{o.immobilie.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {k.vermietet + k.gekuendigt}/{k.einheiten}
                </span>
                {o.rueckstand.anzahl > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />}
              </span>
              <Belegungsbalken k={k} className="h-1" />
            </button>
            {/* Kleiner Stiel vom Schild zum Dach. */}
            <span className="mx-auto block h-3 w-px bg-foreground/30 transition-opacity group-data-[verdeckt=true]:opacity-0" aria-hidden="true" />
          </Anker>
        );
      })}
    </>
  );
}

/** Wo die Nummer einer Partei am Haus sitzt: Mitte ihrer sichtbarsten Fläche. */
function markenpunkt(partei: Partei, modell: ObjektModell, platz: Platz): { x: number; y: number; z: number; normale: [number, number, number] } | null {
  const teile = modell.bausteine.filter((b) => b.einheitId === partei.einheit.id);
  if (teile.length === 0) return null;
  const b = [...teile].sort((a, c) => c.z + c.tiefe / 2 - (a.z + a.tiefe / 2) || c.y - a.y)[0];
  const x = platz.x + b.x;
  if (b.form === "dach" && b.dachschnitt) {
    const zm = (b.dachschnitt.z0 + b.dachschnitt.z1) / 2;
    const y = b.y + b.hoehe * (1 - Math.abs(zm) / (b.tiefe / 2));
    return { x, y: y + 0.08, z: platz.z + b.z + zm, normale: [0, 1, zm >= 0 ? 0.7 : -0.7] };
  }
  if (b.form === "stellplatz") return { x, y: 0.5, z: platz.z + b.z, normale: [0, 1, 0] };
  if (b.form === "werbetafel") return { x, y: b.y + 1.4, z: platz.z + b.z + 0.08, normale: [0, 0, 1] };
  const vorne = b.fenster.vorne || !b.fenster.hinten;
  return { x, y: b.y + b.hoehe * 0.5, z: platz.z + b.z + (vorne ? b.tiefe / 2 + 0.03 : -b.tiefe / 2 - 0.03), normale: [0, 0, vorne ? 1 : -1] };
}

/** Nummern der Parteien am Haus, wenn ein Objekt im Fokus ist. */
export function ParteiMarken({
  fokus,
  register,
  hover,
  auswahlId,
  onPartei,
  onHover,
}: {
  fokus: ObjektAnsicht;
  register: Ankerregister;
  hover: Zeigerziel;
  auswahlId: string | null;
  onPartei: (einheitId: string) => void;
  onHover: (ziel: Zeigerziel) => void;
}) {
  return (
    <>
      {fokus.parteien.map((p) => {
        const punkt = markenpunkt(p, fokus.modell, fokus.platz);
        if (!punkt) return null;
        const ausgewaehlt = auswahlId === p.einheit.id;
        const aktiv = hover.einheitId === p.einheit.id;
        const ziel = { immobilieId: p.immobilieId, einheitId: p.einheit.id };
        return (
          <Anker key={p.einheit.id} register={register} id={`partei-${p.einheit.id}`} {...punkt} ausrichtung="mitte" verdeckbar entzerren prioritaet={ausgewaehlt || aktiv ? 1 : 0}>
            <button
              type="button"
              onClick={() => onPartei(p.einheit.id)}
              onMouseEnter={() => onHover(ziel)}
              onMouseLeave={() => onHover(KEIN_ZIEL)}
              aria-label={`${einheitTitel(p)}, ${etageText(p)}: ${mieterText(p)}, ${STATUS_TEXT[p.zustand.status]}`}
              className={cn(
                "pointer-events-auto flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 text-xs font-semibold tabular-nums shadow-md transition-[transform,opacity] duration-150",
                "group-data-[verdeckt=true]:pointer-events-none group-data-[verdeckt=true]:opacity-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ausgewaehlt ? "scale-125 border-primary bg-primary text-primary-foreground" : "bg-card text-foreground",
                !ausgewaehlt && (aktiv ? "scale-125 border-primary" : "border-card"),
                p.rueckstand && !ausgewaehlt && "border-destructive"
              )}
            >
              {p.nummer}
            </button>
          </Anker>
        );
      })}
    </>
  );
}

/** Inhalt des Zeigerhinweises: Objekt in der Übersicht, Partei im Fokus. */
export function Zeigerinfo({ ziel, objekte, fokusId, istAdmin }: { ziel: Zeigerziel; objekte: ObjektAnsicht[]; fokusId: string | null; istAdmin: boolean }) {
  const objekt = objekte.find((o) => o.immobilie.id === ziel.immobilieId);
  if (!objekt) return null;
  const partei = fokusId === objekt.immobilie.id && ziel.einheitId ? objekt.parteien.find((p) => p.einheit.id === ziel.einheitId) : undefined;

  if (partei) {
    const vertrag = partei.zustand.vertrag;
    return (
      <div className="w-72 rounded-xl border border-border/70 bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md">
        <p className="text-xs text-muted-foreground">
          {einheitTitel(partei)} · {etageText(partei)}
        </p>
        <p className="mt-0.5 font-semibold leading-snug">{mieterText(partei)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip status={partei.zustand.status} />
          <span className="text-xs text-muted-foreground">{zustandText(partei)}</span>
        </div>
        <p className="mt-2 text-xs tabular-nums text-muted-foreground">
          {[partei.einheit.qm ? `${Number(partei.einheit.qm).toLocaleString("de-DE")} m²` : null, vertrag ? `Kaltmiete ${geld(Number(vertrag.kaltmiete ?? 0))}` : null]
            .filter(Boolean)
            .join(" · ") || partei.einheit.einheitentyp}
        </p>
        {istAdmin && partei.rueckstand && <p className="mt-1 text-xs font-medium tabular-nums text-destructive">Rückstand {geld(partei.rueckstand.betrag)}</p>}
        <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {partei.zustand.status === "leer" ? "Klicken für Verlauf und neuen Vertrag" : "Klicken öffnet den Mietvertrag"}
        </p>
      </div>
    );
  }

  const k = objekt.kennzahlen;
  return (
    <div className="w-64 rounded-xl border border-border/70 bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="font-semibold leading-snug">{objekt.immobilie.name}</p>
      <p className="text-xs text-muted-foreground">{objekt.immobilie.adresse}</p>
      <Belegungsbalken k={k} className="mt-2" />
      <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
        {k.vermietet + k.gekuendigt} von {k.einheiten} vermietet
        {k.leer > 0 ? ` · ${k.leer} leer` : ""}
        {k.gekuendigt > 0 ? ` · ${k.gekuendigt} gekündigt` : ""}
      </p>
      {istAdmin && objekt.rueckstand.anzahl > 0 && <p className="mt-1 text-xs font-medium tabular-nums text-destructive">Rückstände {geld(objekt.rueckstand.summe)}</p>}
      <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">{fokusId ? "Klicken wechselt zu diesem Objekt" : "Klicken fliegt heran"}</p>
    </div>
  );
}

const LEGENDE = ["vermietet", "gekuendigt", "kommend", "leer"] as const;

export function Legende3D({ tageszeit, mitRueckstand, className }: { tageszeit: Tageszeit; mitRueckstand: boolean; className?: string }) {
  return (
    <div className={cn("pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/60 bg-card/85 px-3 py-2 shadow-lg backdrop-blur-md", className)} role="list" aria-label="Legende">
      {LEGENDE.map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs text-foreground" role="listitem">
          <span className={cn("h-3 w-3 rounded-[3px] border border-foreground/15", status === "vermietet" && "ring-1 ring-inset ring-foreground/5")} style={{ backgroundColor: legendenfarbe(status) }} aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      ))}
      {mitRueckstand && (
        <span className="flex items-center gap-1.5 text-xs text-foreground" role="listitem">
          <span className="h-3 w-3 rounded-full bg-destructive" aria-hidden="true" />
          Rückstand
        </span>
      )}
      {tageszeit === "abend" && <span className="text-xs text-muted-foreground">Licht an = bewohnt</span>}
    </div>
  );
}

export function Werkzeuge3D({ tageszeit, onTageszeit, onZuruecksetzen }: { tageszeit: Tageszeit; onTageszeit: () => void; onZuruecksetzen: () => void }) {
  const abend = tageszeit === "abend";
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border/60 bg-card/85 p-1 shadow-lg backdrop-blur-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onTageszeit} aria-label={abend ? "Tageslicht" : "Abendstimmung"}>
            {abend ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{abend ? "Tageslicht" : "Abendstimmung – bewohnte Einheiten leuchten"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onZuruecksetzen} aria-label="Ansicht zurücksetzen">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ansicht zurücksetzen</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function Bedienhinweis({ onSchliessen }: { onSchliessen: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-card/90 py-1.5 pl-4 pr-1.5 text-xs text-foreground shadow-lg backdrop-blur-md animate-fade-in">
      <span className="flex items-center gap-1.5">
        <Hand className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        Ziehen dreht, Rad zoomt, rechte Taste verschiebt
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">
        <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        Haus anklicken
      </span>
      <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={onSchliessen}>
        Verstanden
      </Button>
    </div>
  );
}

export function Kontextverlust({ onNeuLaden }: { onNeuLaden: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-warning/40 bg-card/95 px-4 py-3 text-sm text-foreground shadow-lg">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      Die 3D-Darstellung wurde vom Browser unterbrochen.
      <Button size="sm" onClick={onNeuLaden}>
        Neu aufbauen
      </Button>
    </div>
  );
}

/** Daten stehen, aber die letzte Aktualisierung scheiterte — der Stand kann veraltet sein. */
export function Aktualisierungsfehler({ onWiederholen }: { onWiederholen: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-warning/40 bg-card/95 px-4 py-2.5 text-sm text-foreground shadow-lg" role="alert">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      Aktualisierung fehlgeschlagen – angezeigt wird der letzte geladene Stand.
      <Button size="sm" variant="outline" onClick={onWiederholen}>
        Erneut laden
      </Button>
    </div>
  );
}
