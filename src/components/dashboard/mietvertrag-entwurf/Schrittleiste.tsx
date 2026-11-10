/**
 * Schrittleiste des Ablaufs „Neuer Mietvertrag". Jeder Schritt ist direkt
 * anwählbar — der Ablauf führt, sperrt aber nicht. Eine Linie trennt den
 * Mieter vom Vertrag (03.11.2026).
 *
 * Handy (10.11.2026): Acht Schritte mit Titel passten nicht in 390 px — die Leiste lief seitlich aus dem
 * Bild, der aktuelle Schritt war abgeschnitten. Unter `sm` stehen deshalb nur die Kreise in der Leiste,
 * der Titel des aktuellen Schritts darunter („Schritt 3 von 8 · Miete & Laufzeit“); das Wort „Mietvertrag“
 * am Trennstrich erst ab lg, sonst reicht der Platz neben „PDF ansehen“ auf dem Tablet nicht.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { schrittTitel, teilVon, type SchrittId, type SchrittZustand } from '@/utils/mietvertrag/entwurfProzess';

interface Props {
  schritte: SchrittId[];
  aktuell: SchrittId;
  zustaende: Record<SchrittId, SchrittZustand>;
  /** Erst nach dem Besuch zeigt ein Schritt Haken oder Ausrufezeichen. */
  besucht: Set<SchrittId>;
  wohnraum: boolean;
  onWaehle: (schritt: SchrittId) => void;
  /** Nur ohne Vorschau-Spalte (unter lg) — etwa „PDF ansehen“. Tablet: neben den Schritten, Handy: darunter. */
  aktionSchmal?: ReactNode;
}

export function Schrittleiste({ schritte, aktuell, zustaende, besucht, wohnraum, onWaehle, aktionSchmal }: Props) {
  const leiste = useRef<HTMLOListElement>(null);
  const index = schritte.indexOf(aktuell);
  // Bleibt die Leiste breiter als der Bildschirm, den aktuellen Schritt ins Bild holen — nur die Leiste
  // waagerecht verschieben; scrollIntoView könnte bei offener iOS-Tastatur die Seite mitbewegen (Review)
  useEffect(() => {
    const ol = leiste.current;
    const knopf = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (ol && knopf && ol.scrollWidth > ol.clientWidth) {
      ol.scrollTo?.({ left: Math.max(0, knopf.offsetLeft - (ol.clientWidth - knopf.offsetWidth) / 2) });
    }
  }, [aktuell]);

  return (
    <nav aria-label="Schritte" className="border-b bg-muted/30 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2">
        <ol ref={leiste} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
          {schritte.map((s, i) => {
            const istAktuell = s === aktuell;
            const zustand = zustaende[s];
            const zeigeZustand = besucht.has(s) && !istAktuell;
            const neuerTeil = i > 0 && teilVon(schritte[i - 1]) !== teilVon(s);
            return (
              <li key={s} className="flex shrink-0 items-center">
                {neuerTeil ? (
                  <span className="ml-1 mr-0.5 flex items-center gap-2 sm:ml-2 sm:mr-1">
                    <span className="h-6 w-px bg-border" aria-hidden />
                    <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground lg:inline">Mietvertrag</span>
                  </span>
                ) : (
                  i > 0 && <span className="mx-0.5 h-px w-2 bg-border sm:mx-1 sm:w-4" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => onWaehle(s)}
                  aria-current={istAktuell ? 'step' : undefined}
                  // Unter xl steht oft nur die Nummer — der Name für Screenreader
                  aria-label={`${i + 1}. ${schrittTitel(s, wohnraum)}${zeigeZustand && zustand === 'fehlt' ? ', Angaben fehlen' : ''}`}
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
                  <span className={cn('whitespace-nowrap', istAktuell ? 'hidden sm:inline' : 'hidden xl:inline')}>
                    {schrittTitel(s, wohnraum)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {aktionSchmal && <div className="hidden shrink-0 sm:block lg:hidden">{aktionSchmal}</div>}
      </div>
      <div className="mt-1.5 flex min-h-8 items-center justify-between gap-2 sm:hidden">
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">
            Schritt {index + 1} von {schritte.length} ·{' '}
          </span>
          <span className="font-medium">{schrittTitel(aktuell, wohnraum)}</span>
        </p>
        {aktionSchmal}
      </div>
    </nav>
  );
}
