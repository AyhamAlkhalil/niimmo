import { useMemo, type ReactNode } from "react";
import { ArrowLeft, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Zeigerziel } from "./Szene3D";
import type { ObjektAnsicht, Partei } from "./ansicht3dTypen";
import { etageText, mieterText } from "./ansicht3dText";

export interface Seitenleiste3DProps {
  objekte: ObjektAnsicht[];
  fokus: ObjektAnsicht | null;
  auswahlId: string | null;
  hover: Zeigerziel;
  kompakt: boolean;
  offen: boolean;
  onOffen: (offen: boolean) => void;
  onZurueck: () => void;
  onFokus: (immobilieId: string | null) => void;
  onHover: (ziel: Zeigerziel) => void;
  onPartei: (einheitId: string) => void;
  onObjektseite: (immobilieId: string) => void;
}

const KEIN_ZIEL: Zeigerziel = { immobilieId: null, einheitId: null };

const ZEILE =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Übersicht: die Objekte als Liste — dieselbe Navigation wie ein Klick ins Quartier. */
function ObjektListe({ objekte, hover, onFokus, onHover }: Pick<Seitenleiste3DProps, "objekte" | "hover" | "onFokus" | "onHover">) {
  return (
    <ul className="space-y-0.5 p-2" aria-label="Objekte">
      {objekte.map((o) => {
        const ziel = { immobilieId: o.immobilie.id, einheitId: null };
        return (
          <li key={o.immobilie.id}>
            <button
              type="button"
              onClick={() => onFokus(o.immobilie.id)}
              onMouseEnter={() => onHover(ziel)}
              onMouseLeave={() => onHover(KEIN_ZIEL)}
              onFocus={() => onHover(ziel)}
              onBlur={() => onHover(KEIN_ZIEL)}
              className={cn(ZEILE, hover.immobilieId === o.immobilie.id && "bg-accent")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{o.immobilie.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{o.immobilie.ort || o.immobilie.adresse}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Fokus: die Parteien eines Objekts, nach Geschoss gruppiert. Ein Klick öffnet die Detailansicht. */
function ParteiListe({ fokus, auswahlId, hover, onHover, onPartei }: { fokus: ObjektAnsicht } & Pick<Seitenleiste3DProps, "auswahlId" | "hover" | "onHover" | "onPartei">) {
  const gruppen = useMemo(() => {
    const karte = new Map<string, Partei[]>();
    for (const p of fokus.parteien) karte.set(p.bereich, [...(karte.get(p.bereich) ?? []), p]);
    return [...karte.entries()];
  }, [fokus]);

  if (fokus.parteien.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Für dieses Objekt sind keine Einheiten angelegt.</p>;
  }
  return (
    <div className="pb-3">
      {gruppen.map(([bereich, parteien]) => (
        <section key={bereich} aria-label={bereich}>
          <h3 className="sticky top-0 z-[1] bg-card/95 px-5 pb-1 pt-3 text-xs font-medium text-muted-foreground backdrop-blur">{bereich}</h3>
          <ul className="space-y-0.5 px-2">
            {parteien.map((p) => {
              const ziel = { immobilieId: p.immobilieId, einheitId: p.einheit.id };
              const ausgewaehlt = auswahlId === p.einheit.id;
              return (
                <li key={p.einheit.id}>
                  <button
                    type="button"
                    onClick={() => onPartei(p.einheit.id)}
                    onMouseEnter={() => onHover(ziel)}
                    onMouseLeave={() => onHover(KEIN_ZIEL)}
                    onFocus={() => onHover(ziel)}
                    onBlur={() => onHover(KEIN_ZIEL)}
                    aria-haspopup="dialog"
                    className={cn(ZEILE, hover.einheitId === p.einheit.id && "bg-accent", ausgewaehlt && "bg-primary/10 hover:bg-primary/15")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-medium", p.zustand.status === "leer" ? "text-muted-foreground" : "text-foreground")}>
                        {mieterText(p)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{etageText(p)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Seitenleiste3D(props: Seitenleiste3DProps) {
  const { objekte, fokus, kompakt, offen } = props;

  const kopf: ReactNode = fokus ? (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground" onClick={() => props.onFokus(null)}>
        <ChevronLeft className="mr-1 h-4 w-4" />
        Alle Objekte
      </Button>
      <h2 className="mt-1 text-lg font-semibold leading-tight text-foreground">{fokus.immobilie.name}</h2>
      <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{fokus.immobilie.adresse}</span>
      </p>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground" onClick={props.onZurueck}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        Zur Übersicht
      </Button>
      <h2 className="mt-1 text-lg font-semibold leading-tight text-foreground">Immobilien in 3D</h2>
    </>
  );

  const objektseite = fokus && (
    <Button size="sm" variant="outline" className="w-full" onClick={() => props.onObjektseite(fokus.immobilie.id)}>
      <Building2 className="mr-1.5 h-4 w-4" />
      Objektseite öffnen
    </Button>
  );

  const inhalt = fokus ? (
    <ParteiListe fokus={fokus} auswahlId={props.auswahlId} hover={props.hover} onHover={props.onHover} onPartei={props.onPartei} />
  ) : (
    <ObjektListe objekte={objekte} hover={props.hover} onFokus={props.onFokus} onHover={props.onHover} />
  );

  if (kompakt) {
    return (
      <aside className="pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex max-h-[48vh] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur-xl" aria-label="Objekte und Parteien">
        <div className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1">{kopf}</div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => props.onOffen(!offen)} aria-label={offen ? "Liste einklappen" : "Liste ausklappen"} aria-expanded={offen}>
            {offen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
        {offen && (
          // Unten Platz für die schwebenden Knöpfe (Chat, Problem melden).
          <div className="min-h-0 flex-1 overflow-y-auto pb-20">
            {objektseite && <div className="px-3 pt-3">{objektseite}</div>}
            {inhalt}
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="pointer-events-auto absolute bottom-4 left-4 top-4 z-20 flex w-[336px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-2xl backdrop-blur-xl" aria-label="Objekte und Parteien">
      <div className="border-b border-border/60 px-4 pb-4 pt-3">
        {kopf}
        {objektseite && <div className="mt-3">{objektseite}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{inhalt}</div>
    </aside>
  );
}
