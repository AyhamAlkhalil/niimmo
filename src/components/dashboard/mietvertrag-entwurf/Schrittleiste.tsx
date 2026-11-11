/**
 * Schrittleiste der Vermietung: Mieter → Miete & Laufzeit → Abschließen. Jeder Schritt ist direkt anwählbar — der
 * Ablauf führt, sperrt aber nicht. Bis zum 11.11.2026 standen dahinter fünf Vertragsschritte mit einer Trennlinie
 * „Mietvertrag“; das PDF entsteht seitdem getrennt am laufenden Vertrag.
 *
 * Handy (10.11.2026): Unter `sm` stehen nur die Kreise in der Leiste, der Titel des aktuellen Schritts darunter.
 */
import { AlertCircle, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { schrittTitel, type SchrittId, type SchrittZustand } from '@/utils/mietvertrag/entwurfProzess';

interface Props {
  schritte: SchrittId[];
  aktuell: SchrittId;
  zustaende: Record<SchrittId, SchrittZustand>;
  /** Erst nach dem Besuch zeigt ein Schritt Haken oder Ausrufezeichen. */
  besucht: Set<SchrittId>;
  onWaehle: (schritt: SchrittId) => void;
}

export function Schrittleiste({ schritte, aktuell, zustaende, besucht, onWaehle }: Props) {
  const index = schritte.indexOf(aktuell);

  return (
    <nav aria-label="Schritte" className="border-b bg-muted/30 px-3 py-2 sm:px-4">
      <ol className="flex min-w-0 items-center gap-0.5 sm:gap-1">
        {schritte.map((s, i) => {
          const istAktuell = s === aktuell;
          const zustand = zustaende[s];
          const zeigeZustand = besucht.has(s) && !istAktuell;
          return (
            <li key={s} className="flex shrink-0 items-center">
              {i > 0 && <span className="mx-0.5 h-px w-3 bg-border sm:mx-1 sm:w-6" aria-hidden />}
              <button
                type="button"
                onClick={() => onWaehle(s)}
                aria-current={istAktuell ? 'step' : undefined}
                aria-label={`${i + 1}. ${schrittTitel(s)}${zeigeZustand && zustand === 'fehlt' ? ', Angaben fehlen' : ''}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2',
                  istAktuell && 'bg-background font-medium shadow-sm'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                    istAktuell && 'border-primary bg-primary text-primary-foreground',
                    zeigeZustand && zustand === 'ok' && 'border-success bg-success/10 text-success',
                    zeigeZustand && zustand === 'fehlt' && 'border-warning bg-warning/10 text-warning',
                    !istAktuell && !zeigeZustand && 'border-border text-muted-foreground'
                  )}
                >
                  {zeigeZustand && zustand === 'fehlt' ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : zeigeZustand ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="hidden whitespace-nowrap sm:inline">{schrittTitel(s)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-sm sm:hidden">
        <span className="text-muted-foreground">
          Schritt {index + 1} von {schritte.length} ·{' '}
        </span>
        <span className="font-medium">{schrittTitel(aktuell)}</span>
      </p>
    </nav>
  );
}
