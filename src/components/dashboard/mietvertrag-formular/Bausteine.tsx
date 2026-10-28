/**
 * Kleine Bausteine für die Vertragsformulare: Zahlenfeld, Herkunftshinweis,
 * Prüfhinweise, Vorschau.
 *
 * Genutzt vom Generator für bestehende Verträge (`MietvertragErstellungModal`)
 * und vom Vertragsentwurf (`mietvertrag-entwurf/`).
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Befund } from '@/utils/mietvertrag/pflichtpruefung';
import { cn } from '@/lib/utils';
import { EURO_BETRAG_HINWEIS, leseEuroBetrag } from '@/utils/euroBetrag';
import { herkunftText, type Herkunft } from '@/utils/mietvertrag/entwurf';
import type { MietvertragDaten } from '@/utils/mietvertrag/typen';

/** Gemeinsame Schnittstelle der Formularabschnitte. */
export interface AbschnittProps {
  entwurf: MietvertragDaten;
  setEntwurf: (aenderung: (d: MietvertragDaten) => MietvertragDaten) => void;
  /** Kennzeichnung eines Feldes (z. B. „aus Vorvertrag"); ohne sie erscheint nichts. */
  markierung?: (feld: string) => ReactNode;
  /** Meldet ein von Hand geändertes Feld, damit seine Kennzeichnung entfällt. */
  geaendert?: (feld: string) => void;
  /** Kennzeichnet einen Wert, den der Abschnitt selbst vorschlägt (z. B. Index aus den Marktdaten). */
  setzeHerkunft?: (feld: string, quelle: Herkunft) => void;
}

/** Beschriftung mit optionaler Herkunftsmarke. */
export function Feldname({ htmlFor, children, marke }: { htmlFor?: string; children: ReactNode; marke?: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="flex flex-wrap items-center gap-y-1">
      {children}
      {marke}
    </Label>
  );
}

function anzeige(wert: number | null): string {
  return wert === null || wert === undefined || Number.isNaN(wert) ? '' : String(wert);
}

/**
 * Meldet ungültige Zahlenfelder an den umgebenden Dialog, damit er Weiter und Speichern sperrt
 * (28.10.2026). Ohne Anbieter zeigt das Feld den Fehler nur an.
 */
export const UngueltigeZahlFelder = createContext<((schluessel: string, ungueltig: boolean) => void) | null>(null);

/**
 * Zahlenfeld mit eigenem Textzustand: „68," oder „1." bleiben beim Tippen
 * stehen. `Input type="number"` macht aus dem Komma einen Punkt (ui/input.tsx).
 *
 * `art="betrag"` liest Euro-Beträge über `leseEuroBetrag`: Bis zum 28.10.2026 wurde „1.200" als
 * 1,20 € übernommen, weil ui/input einen einzelnen Punkt als Dezimaltrenner stehen lässt. Jetzt
 * ist so ein Wert ungültig — das Feld wird rot, meldet sich beim Dialog und gibt `null` weiter,
 * damit nicht der Zwischenstand „1.20" stehen bleibt. Negative Beträge ebenso.
 * `art="zahl"` (Vorgabe) behält das bisherige Lesen: Flächen mit drei Nachkommastellen
 * („60,125 m²“ kommt aus ui/input als „60.125“), Prozente, Indexwerte, Anzahlen.
 */
export function ZahlFeld({
  id,
  wert,
  onWert,
  placeholder,
  className,
  disabled,
  art = 'zahl',
}: {
  id?: string;
  wert: number | null;
  onWert: (n: number | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  art?: 'betrag' | 'zahl';
}) {
  const [text, setText] = useState(anzeige(wert));
  const [ungueltig, setUngueltig] = useState(false);
  const fokus = useRef(false);
  const melde = useContext(UngueltigeZahlFelder);
  const schluessel = useId();

  useEffect(() => {
    // Ein gesperrtes Feld (z. B. Position nicht umgelegt) kann niemand korrigieren — es darf nicht blockieren
    if (!fokus.current || disabled) {
      setText(anzeige(wert));
      setUngueltig(false);
    }
  }, [wert, disabled]);

  useEffect(() => {
    if (!melde || !ungueltig) return;
    melde(schluessel, true);
    return () => melde(schluessel, false);
  }, [melde, schluessel, ungueltig]);

  return (
    <Input
      id={id}
      type="number"
      className={cn(className, ungueltig && 'border-destructive focus-visible:border-destructive')}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      aria-invalid={ungueltig || undefined}
      title={ungueltig ? EURO_BETRAG_HINWEIS : undefined}
      onFocus={() => {
        fokus.current = true;
      }}
      onBlur={() => {
        fokus.current = false;
        // Ein abgelehnter Betrag bleibt sichtbar stehen, statt still zu verschwinden
        if (!ungueltig) setText(anzeige(wert));
      }}
      onChange={e => {
        setText(e.target.value);
        const roh = e.target.value.trim();
        if (art === 'betrag') {
          const betrag = leseEuroBetrag(roh);
          setUngueltig(betrag === undefined);
          onWert(betrag ?? null);
          return;
        }
        const n = roh === '' || roh === '-' ? null : Number(roh);
        onWert(n !== null && Number.isFinite(n) ? n : null);
      }}
    />
  );
}

export function HerkunftHinweis({ quelle, vorvertragBeginn }: { quelle?: Herkunft; vorvertragBeginn?: string | null }) {
  if (!quelle) return null;
  return (
    <Badge
      variant="outline"
      className={
        quelle === 'vorvertrag'
          ? 'ml-2 h-3.5 border-primary/40 bg-primary/5 px-1.5 py-0 text-xs font-normal leading-none text-primary'
          : 'ml-2 h-3.5 px-1.5 py-0 text-xs font-normal leading-none text-muted-foreground'
      }
    >
      {herkunftText(quelle, vorvertragBeginn ?? null)}
    </Badge>
  );
}

export function PruefungsHinweise({
  befunde,
  onVermieterOeffnen,
}: {
  befunde: Befund[];
  onVermieterOeffnen?: () => void;
}) {
  const blocker = befunde.filter(f => f.schwere === 'blocker');
  const warnungen = befunde.filter(f => f.schwere === 'warnung');

  return (
    <>
      {blocker.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p className="mb-2 font-medium">
              {blocker.length === 1 ? 'Eine Angabe fehlt noch:' : `${blocker.length} Angaben fehlen noch:`}
            </p>
            <ul className="space-y-2">
              {blocker.map((f, i) => (
                <li key={i} className="text-xs">
                  <span className="block">{f.text}</span>
                  <span className="block opacity-80">→ {f.loesung}</span>
                </li>
              ))}
            </ul>
            {onVermieterOeffnen && blocker.some(f => f.feld.startsWith('vermieter')) && (
              <Button size="sm" variant="outline" className="mt-3" onClick={onVermieterOeffnen}>
                Vermieter-Stammdaten öffnen
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {warnungen.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p className="mb-2 font-medium">Hinweise</p>
            <ul className="space-y-2">
              {warnungen.map((f, i) => (
                <li key={i} className="text-xs">
                  <span className="block">{f.text}</span>
                  <span className="block opacity-80">→ {f.loesung}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function VertragsVorschau({
  gesperrt,
  pdfUrl,
  erzeugt,
  gesperrtText,
}: {
  gesperrt: boolean;
  pdfUrl: string | null;
  erzeugt: boolean;
  gesperrtText?: ReactNode;
}) {
  return (
    <div className="relative flex-1">
      {gesperrt ? (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-md space-y-2 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Vorschau gesperrt</p>
            <p className="text-sm text-muted-foreground">
              {gesperrtText ??
                'Solange Pflichtangaben fehlen, wird kein Vertrag erzeugt. Ein Vertrag darf nichts behaupten, was nicht erfasst ist.'}
            </p>
          </div>
        </div>
      ) : pdfUrl ? (
        <iframe src={pdfUrl} className="h-full w-full" title="Vertragsvorschau" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Vorschau wird erzeugt …</span>
        </div>
      )}
      {erzeugt && pdfUrl && !gesperrt && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded bg-background/90 px-2 py-1 text-xs shadow">
          <Loader2 className="h-3 w-3 animate-spin" />
          aktualisiert
        </div>
      )}
    </div>
  );
}
