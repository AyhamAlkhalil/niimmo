import { cn } from "@/lib/utils";
import type { Kennzahlen, ParteiStatus } from "@/utils/ansicht3d/parteiStatus";
import { STATUS_TEXT } from "./ansicht3dTypen";
import { STATUS_KLASSEN } from "./ansicht3dText";

export function StatusChip({ status, className }: { status: ParteiStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_KLASSEN[status].chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_KLASSEN[status].punkt)} aria-hidden="true" />
      {STATUS_TEXT[status]}
    </span>
  );
}

/** Belegung als gestapelter Balken; vermietet bleibt neutral wie in der Szene. */
export function Belegungsbalken({ k, className }: { k: Kennzahlen; className?: string }) {
  const teile: { status: ParteiStatus; anzahl: number }[] = [
    { status: "vermietet", anzahl: k.vermietet },
    { status: "gekuendigt", anzahl: k.gekuendigt },
    { status: "kommend", anzahl: k.kommend },
    { status: "leer", anzahl: k.leer },
  ];
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden="true">
      {k.einheiten > 0 &&
        teile
          .filter((t) => t.anzahl > 0)
          .map((t) => <div key={t.status} className={STATUS_KLASSEN[t.status].balken} style={{ width: `${(t.anzahl / k.einheiten) * 100}%` }} />)}
    </div>
  );
}

export function Kennzahl({ titel, wert, zusatz, ton }: { titel: string; wert: string; zusatz?: string; ton?: "warnung" | "fehler" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{titel}</p>
      <p className={cn("text-lg font-semibold tabular-nums leading-tight text-foreground", ton === "warnung" && "text-warning", ton === "fehler" && "text-destructive")}>{wert}</p>
      {zusatz && <p className="text-xs text-muted-foreground tabular-nums">{zusatz}</p>}
    </div>
  );
}
