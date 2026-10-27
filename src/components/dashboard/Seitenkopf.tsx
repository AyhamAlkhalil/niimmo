import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Einheitlicher Kopf der Unterseiten unter der Menüleiste (27.10.2026, Richtung „Exposé“).
 * Pfadzeile mit Rückweg und Bereich, darunter ein großer, leichter Titel, rechts die
 * Aktionen der Seite, unten eine Haarlinie. `kompakt` ist für Arbeitsflächen in voller
 * Höhe (Zahlungen, Mails, Stammdaten), wo jeder Pixel für die Tabelle zählt.
 */
interface SeitenkopfProps {
  /** Überzeile, meist der Menübereich („Finanzen“) */
  bereich?: ReactNode;
  titel: ReactNode;
  beschreibung?: ReactNode;
  onZurueck?: () => void;
  zurueckLabel?: string;
  aktionen?: ReactNode;
  kompakt?: boolean;
  /** Zusätzliches unter dem Titel, z. B. Reiter oder Kennzahlen */
  children?: ReactNode;
  className?: string;
}

export function Seitenkopf({
  bereich,
  titel,
  beschreibung,
  onZurueck,
  zurueckLabel = "Übersicht",
  aktionen,
  kompakt = false,
  children,
  className,
}: SeitenkopfProps) {
  return (
    <header className={cn("border-b border-border", kompakt ? "py-3 sm:py-4" : "pb-6 pt-6 sm:pb-8 sm:pt-10", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          {(onZurueck || bereich) && (
            <div className="flex items-center gap-2.5">
              {onZurueck && (
                <button
                  type="button"
                  onClick={onZurueck}
                  className="-ml-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  {zurueckLabel}
                </button>
              )}
              {onZurueck && bereich && <span className="h-3 w-px bg-border" aria-hidden="true" />}
              {bereich && <span className="eyebrow">{bereich}</span>}
            </div>
          )}
          <h1
            className={cn(
              "font-light leading-[1.08] tracking-[-0.02em] text-foreground",
              kompakt ? "mt-1 text-2xl sm:text-[1.75rem]" : "mt-3 text-[2rem] sm:text-4xl lg:text-[2.75rem]",
            )}
          >
            {titel}
          </h1>
          {beschreibung && (
            <p className={cn("max-w-2xl text-muted-foreground", kompakt ? "mt-1 text-xs sm:text-sm" : "mt-2.5 text-sm sm:text-base")}>
              {beschreibung}
            </p>
          )}
        </div>
        {aktionen && <div className="flex flex-wrap items-center gap-2">{aktionen}</div>}
      </div>
      {children}
    </header>
  );
}
