/**
 * Mieter anlegen als erster Zwischenstand der Vermietung. Kundenwunsch vom 10.11.2026: „erst einmal die Mieter
 * anlegen … wenn wir Lust haben, einen Mietvertrag dazu“; präzisiert am 11.11.2026: „nicht durch den Button,
 * sondern das ist einfach ein Prozess oder ein Zwischenstand“. Deshalb kein eigener Knopf mehr — „Mieter
 * speichern“ im ersten Schritt legt die Mitmieter an.
 *
 * Nachgefragt wird nur, wenn die Person vielleicht schon im Bestand ist oder der Bestand sich nicht prüfen ließ.
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
  unvollstaendigeNamen,
  type EntwurfPerson,
  type MoeglicheDublette,
} from '@/utils/mietvertrag/entwurf';

export interface MieterAuftrag {
  entwurfId: string;
  personen: EntwurfPerson[];
  /** Schon geladener Mieterbestand: Die Prüfung läuft dann ohne Abfrage. */
  bestand?: MieterAbgleich[];
  /** Vor dem Anlegen den Entwurf speichern; `false` bricht ab. */
  vorher: () => Promise<boolean>;
  danach: (ergebnis: MieterAnlegenErgebnis) => void;
}

interface Frage extends MieterAuftrag {
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
  const [laeuft, setLaeuft] = useState(false);

  function fehler(titel: string, text: string) {
    toast({ title: titel, description: text, variant: 'destructive' });
  }

  async function anlegen(auftrag: MieterAuftrag): Promise<void> {
    setLaeuft(true);
    try {
      if (!(await auftrag.vorher())) return;
      const ergebnis = await legeMieterAusEntwurfAn(auftrag.entwurfId);
      logActivity('mieter_aus_entwurf_angelegt', 'mietvertrag_entwurf', auftrag.entwurfId, { anzahl: ergebnis.angelegt.length });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] });
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', auftrag.entwurfId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-mieterbestand'] });
      queryClient.invalidateQueries({ queryKey: ['all-tenants'] });
      auftrag.danach(ergebnis);
      if (ergebnis.angelegt.length > 0) {
        toast({
          title: `${aufzaehlung(ergebnis.angelegt)} ${ergebnis.angelegt.length > 1 ? 'sind' : 'ist'} als Mieter angelegt`,
          description: 'Als Nächstes Miete und Mietbeginn vormerken, dann die Vermietung abschließen.',
        });
      }
      setFrage(null);
    } catch (e) {
      fehler('Mieter nicht angelegt', e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setLaeuft(false);
    }
  }

  /**
   * „Mieter speichern“: prüft die Karten, fragt nur bei möglichen Dubletten nach und legt sonst direkt an.
   * Gibt `false` zurück, wenn nichts anzulegen ist — dann speichert der Aufrufer wie bisher.
   */
  async function starten(auftrag: MieterAuftrag): Promise<boolean> {
    const neu = anzulegendePersonen(auftrag.personen);
    if (neu.length === 0) return false;
    if (laeuft) return true;
    const unvollstaendig = unvollstaendigeNamen(auftrag.personen);
    if (unvollstaendig.length > 0) {
      fehler(
        'Vor- und Nachname fehlen',
        `${aufzaehlung(unvollstaendig)}: Ein angelegter Mieter behält seinen Namen — bitte zuerst Vor- und Nachname vollständig eintragen.`
      );
      return true;
    }
    const doppelt = doppeltAufKarten(auftrag.personen);
    if (doppelt.length > 0) {
      fehler(
        'Erst die doppelte Karte entfernen',
        `${aufzaehlung(doppelt)} steht doppelt im Entwurf — sonst entstünde der Mieter zweimal. Eine der beiden Karten entfernen.`
      );
      return true;
    }

    const namen = neu.map(personName);
    let dubletten: MoeglicheDublette[] = [];
    let abgleichFehler: string | null = null;
    if (auftrag.bestand) {
      dubletten = moeglicheDublettenIn(auftrag.personen, auftrag.bestand);
    } else {
      setLaeuft(true);
      try {
        dubletten = await moeglicheDubletten(auftrag.personen);
      } catch (e) {
        abgleichFehler = e instanceof Error ? e.message : String(e);
      } finally {
        setLaeuft(false);
      }
    }
    if (dubletten.length > 0 || abgleichFehler) {
      setFrage({ ...auftrag, namen, dubletten, abgleichFehler });
      return true;
    }
    await anlegen(auftrag);
    return true;
  }

  const dialog = (
    <AlertDialog open={!!frage} onOpenChange={o => !o && !laeuft && setFrage(null)}>
      <AlertDialogContent onClick={e => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {frage && frage.dubletten.length > 0 ? 'Vielleicht schon im Bestand' : 'Mieterbestand nicht geprüft'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {frage && frage.dubletten.length > 0 && (
                <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
                  {frage.dubletten.map(d => (
                    <p key={d.person} className="flex items-start gap-1.5 text-xs">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      <span>
                        {d.person} ähnelt: {d.vorhanden.join(', ')}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {frage?.abgleichFehler && (
                <p className="text-xs text-destructive">
                  Der Mieterbestand ließ sich nicht auf Dubletten prüfen ({frage.abgleichFehler}).
                </p>
              )}
              <p>
                Ist es dieselbe Person, zurück und mit „Bestehenden Mieter wählen“ übernehmen. Sonst wird{' '}
                {aufzaehlung(frage?.namen ?? [])} neu im Mieterbestand angelegt.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={laeuft}>Zurück</AlertDialogCancel>
          <AlertDialogAction
            disabled={laeuft}
            onClick={ev => {
              ev.preventDefault();
              if (frage) void anlegen(frage);
            }}
          >
            {laeuft && <Loader2 className="h-4 w-4 animate-spin" />}
            Trotzdem neu anlegen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { starten, beschaeftigt: laeuft, dialog };
}
