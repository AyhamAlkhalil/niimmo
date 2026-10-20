/**
 * Schrittleiste des Ablaufs „Neuer Mietvertrag". Jeder Schritt ist direkt
 * anwählbar — der Ablauf führt, sperrt aber nicht.
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
  wohnraum: boolean;
  onWaehle: (schritt: SchrittId) => void;
}

export function Schrittleiste({ schritte, aktuell, zustaende, besucht, wohnraum, onWaehle }: Props) {
  return (
    <nav aria-label="Schritte" className="border-b bg-muted/30 px-4 py-2">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {schritte.map((s, i) => {
          const istAktuell = s === aktuell;
          const zustand = zustaende[s];
          const zeigeZustand = besucht.has(s) && !istAktuell;
          return (
            <li key={s} className="flex shrink-0 items-center">
              {i > 0 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
              <button
                type="button"
                onClick={() => onWaehle(s)}
                aria-current={istAktuell ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  istAktuell && 'bg-background font-medium shadow-sm'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                    istAktuell && 'border-primary bg-primary text-primary-foreground',
                    zeigeZustand && zustand === 'ok' && 'border-success bg-success/10 text-success',
                    zeigeZustand && zustand === 'hinweis' && 'border-success bg-success/10 text-success',
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
                <span className={cn('whitespace-nowrap', !istAktuell && 'hidden xl:inline')}>{schrittTitel(s, wohnraum)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
