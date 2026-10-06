import { useMemo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Building2, ChevronDown, ChevronLeft, ChevronUp, ExternalLink, FilePlus2, FileText, History, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { kennzahlen as kennzahlenAus, vermietungsquote, type Kennzahlen } from "@/utils/ansicht3d/parteiStatus";
import type { Zeigerziel } from "./Szene3D";
import type { ObjektAnsicht, Partei } from "./ansicht3dTypen";
import { Belegungsbalken, Kennzahl, StatusChip } from "./Bausteine3D";
import { einheitTitel, etageText, geld, mieterText, zustandText } from "./ansicht3dText";

export interface Seitenleiste3DProps {
  objekte: ObjektAnsicht[];
  fokus: ObjektAnsicht | null;
  auswahl: Partei | null;
  hover: Zeigerziel;
  istAdmin: boolean;
  rueckstandFehler: boolean;
  /** Rückstände werden noch berechnet — dann nie „keine" zeigen. */
  rueckstandLaedt: boolean;
  kompakt: boolean;
  offen: boolean;
  onOffen: (offen: boolean) => void;
  onZurueck: () => void;
  onFokus: (immobilieId: string | null) => void;
  onHover: (ziel: Zeigerziel) => void;
  onPartei: (einheitId: string) => void;
  onAuswahlAufheben: () => void;
  onVertragOeffnen: (partei: Partei) => void;
  onVerlauf: (partei: Partei) => void;
  onNeuerVertrag: (partei: Partei) => void;
  onObjektseite: (immobilieId: string, einheitId?: string) => void;
}

function quote(k: Kennzahlen): string {
  return `${Math.round(vermietungsquote(k) * 100)} %`;
}

function Kennzahlenraster({
  k,
  rueckstand,
  istAdmin,
  rueckstandFehler,
  rueckstandLaedt,
}: {
  k: Kennzahlen;
  rueckstand: { summe: number; anzahl: number };
  istAdmin: boolean;
  rueckstandFehler: boolean;
  rueckstandLaedt: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Kennzahl titel="Vermietet" wert={quote(k)} zusatz={`${k.vermietet + k.gekuendigt} von ${k.einheiten} Einheiten`} />
      <Kennzahl titel="Leerstand" wert={String(k.leer)} zusatz={k.kommend > 0 ? `${k.kommend} neu vermietet` : "Einheiten"} ton={k.leer > 0 ? "fehler" : undefined} />
      <Kennzahl titel="Kaltmiete / Monat" wert={geld(k.kaltmiete)} zusatz={`warm ${geld(k.warmmiete)}`} />
      {istAdmin ? (
        rueckstandFehler ? (
          <div className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Rückstände konnten nicht geladen werden
          </div>
        ) : rueckstandLaedt ? (
          <Kennzahl titel="Rückstände" wert="…" zusatz="werden berechnet" />
        ) : (
          <Kennzahl
            titel="Rückstände"
            wert={rueckstand.anzahl > 0 ? geld(rueckstand.summe) : "keine"}
            zusatz={rueckstand.anzahl > 0 ? `${rueckstand.anzahl} Vertr${rueckstand.anzahl === 1 ? "ag" : "äge"}` : undefined}
            ton={rueckstand.anzahl > 0 ? "fehler" : undefined}
          />
        )
      ) : (
        <Kennzahl titel="Gekündigt" wert={String(k.gekuendigt)} zusatz="laufen noch" ton={k.gekuendigt > 0 ? "warnung" : undefined} />
      )}
    </div>
  );
}

function ObjektListe({ objekte, hover, onFokus, onHover }: Pick<Seitenleiste3DProps, "objekte" | "hover" | "onFokus" | "onHover">) {
  return (
    <ul className="space-y-1 p-2" aria-label="Objekte">
      {objekte.map((o) => {
        const k = o.kennzahlen;
        const aktiv = hover.immobilieId === o.immobilie.id;
        return (
          <li key={o.immobilie.id}>
            <button
              type="button"
              onClick={() => onFokus(o.immobilie.id)}
              onMouseEnter={() => onHover({ immobilieId: o.immobilie.id, einheitId: null })}
              onMouseLeave={() => onHover({ immobilieId: null, einheitId: null })}
              onFocus={() => onHover({ immobilieId: o.immobilie.id, einheitId: null })}
              onBlur={() => onHover({ immobilieId: null, einheitId: null })}
              className={cn(
                "w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                aktiv && "bg-accent"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{o.immobilie.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.immobilie.ort || o.immobilie.adresse}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums text-foreground">
                    {k.vermietet + k.gekuendigt}/{k.einheiten}
                  </p>
                  {o.rueckstand.anzahl > 0 && <p className="text-xs tabular-nums text-destructive">{geld(o.rueckstand.summe)} offen</p>}
                </div>
              </div>
              <Belegungsbalken k={k} className="mt-2" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ParteiKarte({ partei, ...h }: { partei: Partei } & Pick<Seitenleiste3DProps, "onAuswahlAufheben" | "onVertragOeffnen" | "onVerlauf" | "onNeuerVertrag" | "onObjektseite">) {
  const { status, oeffnen, vertrag } = partei.zustand;
  const kalt = Number(vertrag?.kaltmiete ?? 0);
  const warm = kalt + Number(vertrag?.betriebskosten ?? 0);
  return (
    <div className="mx-3 mt-3 rounded-xl border border-primary/30 bg-background/85 p-3 shadow-sm" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {einheitTitel(partei)} · {partei.einheit.einheitentyp ?? "Einheit"}
          </p>
          <p className="truncate font-semibold text-foreground">{mieterText(partei)}</p>
          <p className="truncate text-xs text-muted-foreground">{etageText(partei)}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Auswahl aufheben" onClick={h.onAuswahlAufheben}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusChip status={status} />
        <span className="text-xs text-muted-foreground">{zustandText(partei)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Fläche</dt>
          <dd className="font-medium tabular-nums text-foreground">{partei.einheit.qm ? `${Number(partei.einheit.qm).toLocaleString("de-DE")} m²` : "–"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Kaltmiete</dt>
          <dd className="font-medium tabular-nums text-foreground">{vertrag ? geld(kalt) : "–"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Warmmiete</dt>
          <dd className="font-medium tabular-nums text-foreground">{vertrag ? geld(warm) : "–"}</dd>
        </div>
      </dl>
      {partei.rueckstand && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
          Rückstand {geld(partei.rueckstand.betrag)}
          {partei.rueckstand.mahnstufe > 0 ? ` · Mahnstufe ${partei.rueckstand.mahnstufe}` : ""}
        </p>
      )}
      {partei.rueckstandFrueher > 0 && (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">Offen aus früheren Verträgen: {geld(partei.rueckstandFrueher)}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {oeffnen && (
          <Button size="sm" onClick={() => h.onVertragOeffnen(partei)}>
            <FileText className="mr-1.5 h-4 w-4" />
            {status === "leer" ? "Letzten Vertrag öffnen" : "Mietvertrag öffnen"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => h.onVerlauf(partei)}>
          <History className="mr-1.5 h-4 w-4" />
          Verlauf
        </Button>
        {(status === "leer" || status === "gekuendigt") && (
          <Button size="sm" variant="outline" onClick={() => h.onNeuerVertrag(partei)}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            Neuer Mietvertrag
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => h.onObjektseite(partei.immobilieId, partei.einheit.id)}>
          <ExternalLink className="mr-1.5 h-4 w-4" />
          Auf der Objektseite
        </Button>
      </div>
    </div>
  );
}

function ParteiListe({ fokus, auswahl, hover, onHover, onPartei }: { fokus: ObjektAnsicht } & Pick<Seitenleiste3DProps, "auswahl" | "hover" | "onHover" | "onPartei">) {
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
          <h3 className="sticky top-0 z-[1] bg-card/95 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{bereich}</h3>
          <ul className="space-y-0.5 px-2">
            {parteien.map((p) => {
              const ausgewaehlt = auswahl?.einheit.id === p.einheit.id;
              const aktiv = hover.einheitId === p.einheit.id;
              const ziel = { immobilieId: p.immobilieId, einheitId: p.einheit.id };
              const aus = { immobilieId: null, einheitId: null };
              return (
                <li key={p.einheit.id}>
                  <button
                    type="button"
                    onClick={() => onPartei(p.einheit.id)}
                    onMouseEnter={() => onHover(ziel)}
                    onMouseLeave={() => onHover(aus)}
                    onFocus={() => onHover(ziel)}
                    onBlur={() => onHover(aus)}
                    aria-pressed={ausgewaehlt}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      aktiv && "bg-accent",
                      ausgewaehlt && "bg-primary/10 hover:bg-primary/15"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                        ausgewaehlt ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground"
                      )}
                    >
                      {p.nummer}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{mieterText(p)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {etageText(p)}
                        {p.einheit.qm ? ` · ${Number(p.einheit.qm).toLocaleString("de-DE")} m²` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <StatusChip status={p.zustand.status} />
                      {p.rueckstand && <span className="text-xs tabular-nums text-destructive">{geld(p.rueckstand.betrag)} offen</span>}
                    </span>
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
  const { objekte, fokus, auswahl, istAdmin, kompakt, offen } = props;

  const gesamt = useMemo(() => {
    const k = kennzahlenAus(objekte.flatMap((o) => o.parteien.map((p) => p.zustand)));
    const rueckstand = objekte.reduce((s, o) => ({ summe: s.summe + o.rueckstand.summe, anzahl: s.anzahl + o.rueckstand.anzahl }), { summe: 0, anzahl: 0 });
    return { k, rueckstand };
  }, [objekte]);

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
      {(fokus.immobilie.objekttyp || fokus.immobilie.baujahr) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {[fokus.immobilie.objekttyp, fokus.immobilie.baujahr ? `Baujahr ${fokus.immobilie.baujahr}` : null].filter(Boolean).join(" · ")}
        </p>
      )}
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-muted-foreground" onClick={props.onZurueck}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        Zur Übersicht
      </Button>
      <h2 className="mt-1 text-lg font-semibold leading-tight text-foreground">Immobilien in 3D</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {objekte.length} Objekte · {gesamt.k.einheiten} Einheiten
      </p>
    </>
  );

  const inhalt = fokus ? (
    <>
      {auswahl && <ParteiKarte partei={auswahl} {...props} />}
      <ParteiListe fokus={fokus} {...props} />
    </>
  ) : (
    <ObjektListe {...props} />
  );

  const k = fokus ? fokus.kennzahlen : gesamt.k;
  const rueckstand = fokus ? fokus.rueckstand : gesamt.rueckstand;

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
            <div className="px-3 pt-3">
              <Kennzahlenraster k={k} rueckstand={rueckstand} istAdmin={istAdmin} rueckstandFehler={props.rueckstandFehler} rueckstandLaedt={props.rueckstandLaedt} />
            </div>
            {fokus && (
              <div className="px-3 pt-3">
                <Button size="sm" variant="outline" className="w-full" onClick={() => props.onObjektseite(fokus.immobilie.id)}>
                  <Building2 className="mr-1.5 h-4 w-4" />
                  Objektseite öffnen
                </Button>
              </div>
            )}
            {inhalt}
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="pointer-events-auto absolute bottom-4 left-4 top-4 z-20 flex w-[400px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-2xl backdrop-blur-xl" aria-label="Objekte und Parteien">
      <div className="border-b border-border/60 px-4 pb-4 pt-3">
        {kopf}
        <div className="mt-3">
          <Kennzahlenraster k={k} rueckstand={rueckstand} istAdmin={istAdmin} rueckstandFehler={props.rueckstandFehler} rueckstandLaedt={props.rueckstandLaedt} />
        </div>
        {fokus && (
          <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => props.onObjektseite(fokus.immobilie.id)}>
            <Building2 className="mr-1.5 h-4 w-4" />
            Objektseite öffnen
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{inhalt}</div>
    </aside>
  );
}
