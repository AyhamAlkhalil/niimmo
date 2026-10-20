/**
 * Schritt „Prüfen & PDF": alle Platzhalter der Vorlage mit Wert und Quelle,
 * dazu was für das PDF noch fehlt — jeweils mit Sprung in den Schritt, in dem
 * es sich ändern lässt.
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Pencil } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Befund } from '@/utils/mietvertrag/pflichtpruefung';
import {
  quellenZaehlung,
  quelleText,
  SCHRITT_TITEL,
  schrittFuerFeld,
  type PlatzhalterGruppe,
  type PlatzhalterQuelle,
  type SchrittId,
} from '@/utils/mietvertrag/entwurfProzess';

interface Props {
  gruppen: PlatzhalterGruppe[];
  befunde: Befund[];
  /** Was der Entwurf selbst braucht (Mitmieter, Mietbeginn, Kaltmiete). */
  luecken: { feld: string; text: string }[];
  wohnraum: boolean;
  /** Schritte dieses Ablaufs — ohne Vorlage fehlen einige, dorthin gibt es keinen Sprung. */
  schritte: SchrittId[];
  vorvertragBeginn: string | null;
  onGeheZu: (schritt: SchrittId) => void;
  onVermieterOeffnen: () => void;
}

export function QuelleMarke({ quelle, vorvertragBeginn }: { quelle: PlatzhalterQuelle; vorvertragBeginn: string | null }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap px-1.5 py-0 text-[10px] font-normal',
        quelle === 'vorvertrag' && 'border-primary/40 bg-primary/5 text-primary',
        quelle === 'eingabe' && 'border-foreground/30 text-foreground',
        quelle !== 'vorvertrag' && quelle !== 'eingabe' && 'text-muted-foreground'
      )}
    >
      {quelleText(quelle, vorvertragBeginn)}
    </Badge>
  );
}

export function PruefenSchritt({ gruppen, befunde, luecken, wohnraum, schritte, vorvertragBeginn, onGeheZu, onVermieterOeffnen }: Props) {
  const [zeigeHinweise, setZeigeHinweise] = useState(false);
  const blocker = befunde.filter(f => f.schwere === 'blocker');
  const warnungen = befunde.filter(f => f.schwere === 'warnung');
  const blockerFelder = new Set(blocker.map(b => b.feld));
  const offen = [
    // Was die Pflichtprüfung mit Lösung meldet, steht nicht noch einmal als Lücke da
    ...luecken
      .filter(l => !blockerFelder.has(l.feld))
      .map(l => ({ text: l.text, loesung: '', schritt: schrittFuerFeld(l.feld), feld: l.feld })),
    ...blocker.map(b => ({ text: b.text, loesung: b.loesung, schritt: schrittFuerFeld(b.feld), feld: b.feld })),
  ];
  const zaehlung = quellenZaehlung(gruppen);
  const aenderbar = (feld: string, schritt: SchrittId) => feld.startsWith('vermieter') || schritte.includes(schritt);

  return (
    <div className="space-y-5">
      {offen.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="mb-2 font-medium">
              {wohnraum ? 'Für das PDF fehlt noch' : 'Für den Vertrag fehlt noch'} ({offen.length}):
            </p>
            <ul className="space-y-1.5">
              {offen.map((o, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    {o.text}
                    {o.loesung && <span className="block opacity-80">→ {o.loesung}</span>}
                  </span>
                  {o.feld.startsWith('vermieter') ? (
                    <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={onVermieterOeffnen}>
                      Stammdaten
                    </Button>
                  ) : (
                    aenderbar(o.feld, o.schritt) && (
                      <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => onGeheZu(o.schritt)}>
                        {SCHRITT_TITEL[o.schritt]}
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-success/40 bg-success/5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription className="text-sm">
            {wohnraum
              ? 'Alle Pflichtangaben sind erfasst. „PDF erstellen" erzeugt den Vertrag und legt ihn am Entwurf ab.'
              : 'Alle Angaben sind erfasst. Den unterschriebenen Vertrag lädst du im nächsten Schritt hoch.'}
          </AlertDescription>
        </Alert>
      )}

      {warnungen.length > 0 && (
        <div className="rounded-md border">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
            onClick={() => setZeigeHinweise(z => !z)}
          >
            <span className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              {warnungen.length} {warnungen.length === 1 ? 'Hinweis' : 'Hinweise'} zur Vorlage (sperren nicht)
            </span>
            {zeigeHinweise ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {zeigeHinweise && (
            <ul className="space-y-2 border-t px-3 py-2">
              {warnungen.map((w, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    {w.text}
                    <span className="block text-muted-foreground">→ {w.loesung}</span>
                  </span>
                  {aenderbar(w.feld, schrittFuerFeld(w.feld)) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => (w.feld.startsWith('vermieter') ? onVermieterOeffnen() : onGeheZu(schrittFuerFeld(w.feld)))}
                    >
                      ändern
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-semibold">Platzhalter der Vorlage</p>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {zaehlung.map(z => (
            <span key={z.quelle} className="flex items-center gap-1">
              {z.anzahl} <QuelleMarke quelle={z.quelle} vorvertragBeginn={vorvertragBeginn} />
            </span>
          ))}
        </div>
      </div>

      {gruppen.map(gruppe => (
        <div key={gruppe.titel} className="overflow-hidden rounded-md border">
          <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {gruppe.titel}
          </p>
          <ul className="divide-y">
            {gruppe.zeilen.map(z => (
              <li key={z.feld} className="grid grid-cols-[minmax(110px,32%)_1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">{z.label}</span>
                <span className={cn('min-w-0 break-words', z.fehlt && 'font-medium text-destructive')}>
                  {z.wert || (z.fehlt ? 'fehlt' : '—')}
                  {z.wert && z.fehlt && <span className="ml-1">(unvollständig)</span>}
                </span>
                <span>{z.quelle && <QuelleMarke quelle={z.quelle} vorvertragBeginn={vorvertragBeginn} />}</span>
                {aenderbar(z.feld, z.schritt) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label={`${z.label} ändern`}
                    title={z.feld.startsWith('vermieter') ? 'In den Vermieterstammdaten ändern' : `In „${SCHRITT_TITEL[z.schritt]}" ändern`}
                    onClick={() => (z.feld.startsWith('vermieter') ? onVermieterOeffnen() : onGeheZu(z.schritt))}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                ) : (
                  // Kommt aus der Einheit und wird dort gepflegt
                  <span className="w-6" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
