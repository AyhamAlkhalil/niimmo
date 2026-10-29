import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface KennzahlInfoProps {
  /** Name der Kennzahl, wie er daneben steht */
  titel: string;
  children: ReactNode;
  /** Warnzeichen statt Info-Symbol, z. B. „Noch keine Zahlungen erfasst“ */
  warnung?: boolean;
}

/**
 * Kleiner Info-Knopf an einer Kennzahl: Ein Klick zeigt kurz, was gezählt wird (Kundenwunsch 29.10.2026).
 * Klick statt Hover, damit es auch auf dem Handy geht.
 */
export function KennzahlInfo({ titel, children, warnung = false }: KennzahlInfoProps) {
  const Zeichen = warnung ? AlertTriangle : Info;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={warnung ? `Hinweis: ${titel}` : `Erklärung: ${titel}`}
          onClick={(e) => e.stopPropagation()}
          className={`-my-1 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${warnung ? 'text-warning hover:text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Zeichen className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm normal-case tracking-normal" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium text-foreground">{titel}</p>
        <div className="mt-1.5 space-y-1.5 leading-relaxed text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
