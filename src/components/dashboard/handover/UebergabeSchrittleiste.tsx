import { AlertCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCHRITT_TITEL, type SchrittZustand, type UebergabeSchritt } from "@/utils/uebergabeAblauf";

interface UebergabeSchrittleisteProps {
  schritte: readonly UebergabeSchritt[];
  aktuell: UebergabeSchritt;
  zustaende: Record<UebergabeSchritt, SchrittZustand>;
  /** Haken und Warnzeichen erst nach dem Besuch — vorher wäre jeder leere Schritt rot */
  besucht: Set<UebergabeSchritt>;
  onWaehle: (schritt: UebergabeSchritt) => void;
  /** Auf dem Handy nur Nummern, der aktuelle Titel steht darunter */
  kompakt?: boolean;
}

/**
 * Schrittleiste der Übergabe im Stil des Ablaufs „Neuer Mietvertrag": Jeder
 * Schritt ist direkt anwählbar — der Ablauf führt, sperrt aber nicht.
 */
export const UebergabeSchrittleiste = ({ schritte, aktuell, zustaende, besucht, onWaehle, kompakt }: UebergabeSchrittleisteProps) => {
  const index = schritte.indexOf(aktuell);
  return (
    // quer (Handy waagerecht): eine Zeile, der Schritttitel steht rechts neben den Nummern
    <nav aria-label="Schritte der Übergabe" className="border-b bg-muted/30 px-4 py-2 quer:flex quer:items-center quer:gap-4 quer:py-0.5">
      <ol className={cn("flex items-center gap-1 quer:flex-1", kompakt ? "justify-between" : "overflow-x-auto")}>
        {schritte.map((s, i) => {
          const istAktuell = s === aktuell;
          const zustand = zustaende[s];
          const zeigeZustand = besucht.has(s) && !istAktuell && s !== "pruefen";
          return (
            <li key={s} className={cn("flex items-center", kompakt ? "flex-1 last:flex-none" : "shrink-0")}>
              {i > 0 && !kompakt && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
              <button
                type="button"
                onClick={() => onWaehle(s)}
                aria-current={istAktuell ? "step" : undefined}
                aria-label={`Schritt ${i + 1}: ${SCHRITT_TITEL[s]}${
                  zeigeZustand ? (zustand === "ok" ? " (erledigt)" : zustand === "hinweis" ? " (mit Hinweis)" : " (mit Fehler)") : ""
                }`}
                className={cn(
                  "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-1.5 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring quer:min-h-9 quer:min-w-9",
                  istAktuell && !kompakt && "bg-background font-medium shadow-sm"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    istAktuell && "border-primary bg-primary text-primary-foreground",
                    zeigeZustand && zustand === "ok" && "border-success bg-success/10 text-success",
                    zeigeZustand && zustand === "hinweis" && "border-warning bg-warning/10 text-warning",
                    zeigeZustand && zustand === "fehler" && "border-destructive bg-destructive/10 text-destructive",
                    !istAktuell && !zeigeZustand && "border-border bg-background text-muted-foreground"
                  )}
                >
                  {zeigeZustand && zustand === "fehler" ? (
                    <X className="h-3.5 w-3.5" />
                  ) : zeigeZustand && zustand === "hinweis" ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : zeigeZustand ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                {!kompakt && <span className={cn("whitespace-nowrap", !istAktuell && "hidden lg:inline")}>{SCHRITT_TITEL[s]}</span>}
              </button>
              {kompakt && i < schritte.length - 1 && (
                <span className={cn("mx-1 h-px flex-1", i < index ? "bg-primary/40" : "bg-border")} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      {kompakt && (
        <p className="mt-1 text-sm font-medium quer:mt-0 quer:shrink-0" aria-live="polite">
          {index + 1}/{schritte.length} · {SCHRITT_TITEL[aktuell]}
        </p>
      )}
    </nav>
  );
};
