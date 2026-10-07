import { AlertTriangle, Hand, Moon, MousePointerClick, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Anker, type Ankerregister } from "./Beschriftungen3D";
import type { Zeigerziel } from "./Szene3D";
import type { ObjektAnsicht } from "./ansicht3dTypen";
import { etageText, mieterText } from "./ansicht3dText";

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
            prioritaet={aktiv ? 1 : 0}
          >
            <button
              type="button"
              onClick={() => onFokus(o.immobilie.id)}
              onMouseEnter={() => onHover(ziel)}
              onMouseLeave={() => onHover(KEIN_ZIEL)}
              onFocus={() => onHover(ziel)}
              onBlur={() => onHover(KEIN_ZIEL)}
              aria-label={`${o.immobilie.name} – heranfliegen`}
              className={cn(
                "pointer-events-auto mb-1 whitespace-nowrap rounded-full border border-border/70 bg-card/90 px-3 py-1 text-xs font-semibold text-foreground shadow-md backdrop-blur-md transition-[opacity,transform,box-shadow] duration-200",
                "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "group-data-[verdeckt=true]:pointer-events-none group-data-[verdeckt=true]:opacity-0",
                aktiv && "-translate-y-0.5 border-primary/60 ring-2 ring-primary/40"
              )}
            >
              {o.immobilie.name}
            </button>
            {/* Kleiner Stiel vom Schild zum Dach. */}
            <span className="mx-auto block h-3 w-px bg-foreground/30 transition-opacity group-data-[verdeckt=true]:opacity-0" aria-hidden="true" />
          </Anker>
        );
      })}
    </>
  );
}

/** Kurzer Hinweis am Zeiger: welches Objekt bzw. welche Partei gemeint ist. */
export function Zeigerinfo({ ziel, objekte, fokusId }: { ziel: Zeigerziel; objekte: ObjektAnsicht[]; fokusId: string | null }) {
  const objekt = objekte.find((o) => o.immobilie.id === ziel.immobilieId);
  if (!objekt) return null;
  const partei = fokusId === objekt.immobilie.id && ziel.einheitId ? objekt.parteien.find((p) => p.einheit.id === ziel.einheitId) : undefined;
  const [titel, unterzeile] = partei ? [mieterText(partei), etageText(partei)] : [objekt.immobilie.name, objekt.immobilie.adresse];
  return (
    <div className="max-w-xs rounded-lg border border-border/70 bg-popover/95 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-md">
      <p className="text-sm font-semibold leading-snug">{titel}</p>
      {unterzeile && <p className="text-xs text-muted-foreground">{unterzeile}</p>}
    </div>
  );
}

export function Werkzeuge3D({ tageszeit, onTageszeit, onZuruecksetzen }: { tageszeit: "tag" | "abend"; onTageszeit: () => void; onZuruecksetzen: () => void }) {
  const abend = tageszeit === "abend";
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border/60 bg-card/85 p-1 shadow-lg backdrop-blur-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onTageszeit} aria-label={abend ? "Tageslicht" : "Abendstimmung"}>
            {abend ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{abend ? "Tageslicht" : "Abendstimmung"}</TooltipContent>
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
