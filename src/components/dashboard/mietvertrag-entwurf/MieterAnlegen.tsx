/**
 * „Mieter anlegen“, ohne Mietvertrag. Kundenwunsch vom 10.11.2026: „dass wir erst einmal die Mieter
 * anlegen. Und dann daraus resultierend … ich möchte auch einen Mietvertrag dazu haben.“ Bis dahin
 * entstand ein Mieter nur beim Aktivieren mit unterschriebenem Vertrag, und wer nur die Person
 * erfassen wollte, kam aus dem Ablauf nicht heraus.
 *
 * Fragt vorher nach und warnt vor möglichen Dubletten. Der Entwurf bleibt an der Einheit: Dort lässt
 * sich der Mietvertrag später fortsetzen, oder der Entwurf wird verworfen — der Mieter bleibt.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import type { MieterAbgleich } from '@/hooks/useMietvertragEntwurf';
import { legeMieterAusEntwurfAn, moeglicheDubletten, type MieterAnlegenErgebnis } from '@/services/mietvertragEntwurfService';
import {
  anzulegendePersonen,
  doppeltAufKarten,
  moeglicheDublettenIn,
  personName,
  type EntwurfPerson,
  type MoeglicheDublette,
} from '@/utils/mietvertrag/entwurf';

interface Auftrag {
  entwurfId: string;
  personen: EntwurfPerson[];
  /**
   * Schon geladener Mieterbestand (im Dialog): Die Rückfrage erscheint dann ohne Abfrage sofort — es bleibt
   * keine Lücke, in der noch getippt wird, während `vorher` den Stand von vor dem Klick speichert.
   */
  bestand?: MieterAbgleich[];
  /** Vor dem Anlegen, etwa den Entwurf speichern; `false` bricht ab. */
  vorher?: () => Promise<boolean>;
  danach?: (ergebnis: MieterAnlegenErgebnis) => void;
}

interface Frage extends Auftrag {
  namen: string[];
  dubletten: MoeglicheDublette[];
  /** Der Bestand ließ sich nicht abgleichen — dann sagen wir es, statt still „keine Dubletten“ zu melden. */
  abgleichFehler: string | null;
}

function aufzaehlung(namen: string[]): string {
  return namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

export function useMieterAnlegen() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const [frage, setFrage] = useState<Frage | null>(null);
  const [prueft, setPrueft] = useState(false);
  const [legtAn, setLegtAn] = useState(false);

  async function fragen(auftrag: Auftrag) {
    const namen = anzulegendePersonen(auftrag.personen).map(personName);
    if (namen.length === 0 || prueft || legtAn) return;
    const doppelt = doppeltAufKarten(auftrag.personen);
    if (doppelt.length > 0) {
      toast({
        title: 'Erst die doppelte Karte entfernen',
        description: `${doppelt.join(', ')} steht doppelt im Entwurf — sonst entstünde der Mieter zweimal. Im Schritt „Mieter“ eine der beiden Karten entfernen.`,
        variant: 'destructive',
      });
      return;
    }
    if (auftrag.bestand) {
      setFrage({ ...auftrag, namen, dubletten: moeglicheDublettenIn(auftrag.personen, auftrag.bestand), abgleichFehler: null });
      return;
    }
    setPrueft(true);
    try {
      const dubletten = await moeglicheDubletten(auftrag.personen);
      setFrage({ ...auftrag, namen, dubletten, abgleichFehler: null });
    } catch (e) {
      setFrage({ ...auftrag, namen, dubletten: [], abgleichFehler: e instanceof Error ? e.message : String(e) });
    } finally {
      setPrueft(false);
    }
  }

  async function anlegen() {
    if (!frage) return;
    setLegtAn(true);
    try {
      if (frage.vorher && !(await frage.vorher())) return;
      const ergebnis = await legeMieterAusEntwurfAn(frage.entwurfId);
      logActivity('mieter_aus_entwurf_angelegt', 'mietvertrag_entwurf', frage.entwurfId, { anzahl: ergebnis.angelegt.length });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] });
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', frage.entwurfId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-mieterbestand'] });
      queryClient.invalidateQueries({ queryKey: ['all-tenants'] });
      frage.danach?.(ergebnis);
      toast(
        ergebnis.angelegt.length > 0
          ? {
              title: ergebnis.angelegt.length > 1 ? 'Mieter angelegt' : `${ergebnis.angelegt[0]} ist angelegt`,
              description:
                'Der Mietvertrag bleibt als Entwurf an der Einheit — fortsetzen, wenn er gebraucht wird, oder den Entwurf verwerfen. Der Mieter bleibt in beiden Fällen.',
            }
          : { title: 'Schon angelegt', description: 'Alle Mitmieter dieses Entwurfs haben bereits einen Mieterdatensatz.' }
      );
      setFrage(null);
    } catch (e) {
      toast({
        title: 'Mieter nicht angelegt',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setLegtAn(false);
    }
  }

  const dialog = (
    <AlertDialog open={!!frage} onOpenChange={o => !o && !legtAn && setFrage(null)}>
      <AlertDialogContent onClick={e => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {frage && frage.namen.length > 1 ? 'Mieter anlegen?' : `${frage?.namen[0] ?? ''} als Mieter anlegen?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {aufzaehlung(frage?.namen ?? [])} {frage && frage.namen.length > 1 ? 'kommen' : 'kommt'} jetzt in den
                Mieterbestand, ohne Mietvertrag. Der Entwurf bleibt an der Einheit: Den Mietvertrag kannst du später
                fortsetzen oder den Entwurf verwerfen.
              </p>
              {frage && frage.dubletten.length > 0 && (
                <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                    Vielleicht schon im Bestand
                  </p>
                  {frage.dubletten.map(d => (
                    <p key={d.person} className="text-xs">
                      {d.person}: {d.vorhanden.join(', ')}
                    </p>
                  ))}
                  <p className="text-xs">
                    Ist es dieselbe Person, im Schritt „Mieter“ mit „Bestehenden Mieter wählen“ übernehmen, statt neu
                    anzulegen.
                  </p>
                </div>
              )}
              {frage?.abgleichFehler && (
                <p className="text-xs text-destructive">
                  Der Mieterbestand ließ sich nicht auf Dubletten prüfen ({frage.abgleichFehler}).
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={legtAn}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={legtAn}
            onClick={ev => {
              ev.preventDefault();
              void anlegen();
            }}
          >
            {legtAn && <Loader2 className="h-4 w-4 animate-spin" />}
            {frage && (frage.dubletten.length > 0 || frage.abgleichFehler) ? 'Trotzdem neu anlegen' : 'Mieter anlegen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { fragen, beschaeftigt: prueft || legtAn, dialog };
}
