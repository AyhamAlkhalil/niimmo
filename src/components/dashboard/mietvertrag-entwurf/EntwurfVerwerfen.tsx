/**
 * Rückfrage „Entwurf verwerfen?“ an der Einheitskarte. Seit dem 10.11.2026 lassen sich Mieter vor dem Vertrag
 * anlegen; wird der Entwurf verworfen, weil der Interessent abgesprungen ist, blieben sie sonst ohne Zweck im
 * Bestand. Deshalb bietet die Rückfrage an, Mieter ohne Mietvertrag mitzulöschen — abgewählt, denn ohne Vertrag
 * kann auch gewollt sein („den Mietvertrag später oder gar nicht“). Wer bleibt, lässt sich über die Suche löschen.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { verwirfEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { ladeMieterOhneVertrag, loescheMieterOhneVertrag } from '@/services/mieterOhneVertragService';
import { entwurfsMieterIds, loeschErgebnisText, namensAufzaehlung } from '@/utils/mieterOhneVertrag';

interface Props {
  entwurf: EntwurfZeile | null;
  /** Name(n) der Mieter für den Text, wie auf der Karte. */
  namen: string;
  onSchliessen: () => void;
}

export function EntwurfVerwerfen({ entwurf, namen, onSchliessen }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const [verwirft, setVerwirft] = useState(false);
  const [mieterLoeschen, setMieterLoeschen] = useState(false);

  const ids = entwurf ? entwurfsMieterIds(entwurf.personen) : [];
  // Bei jedem Öffnen neu: Ein Haken von vorhin gilt nicht für einen anderen Entwurf
  useEffect(() => setMieterLoeschen(false), [entwurf?.id]);

  const kandidaten = useQuery({
    queryKey: ['mieter-ohne-vertrag', ids],
    enabled: !!entwurf && ids.length > 0,
    staleTime: 0,
    queryFn: () => ladeMieterOhneVertrag(ids),
  });
  const ohneVertrag = ids.length > 0 ? (kandidaten.data ?? []) : [];
  // isFetching: Beim erneuten Öffnen stünde sonst kurz die Liste von vorhin (Review 10.11.2026)
  const prueft = ids.length > 0 && kandidaten.isFetching;

  async function bestaetigt() {
    if (!entwurf) return;
    setVerwirft(true);
    try {
      await verwirfEntwurf(entwurf);
    } catch (err) {
      toast({ title: 'Verwerfen fehlgeschlagen', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
      setVerwirft(false);
      return;
    }
    logActivity('mietvertrag_entwurf_verworfen', 'mietvertrag_entwurf', entwurf.id);

    const saetze = ['Entwurf, PDF und Selbstauskunft sind gelöscht.'];
    let warnung = false;
    if (mieterLoeschen && ohneVertrag.length > 0) {
      try {
        const ergebnis = await loescheMieterOhneVertrag(ohneVertrag.map(m => m.id));
        // Nur die ID ins Protokoll: Der Name soll mit dem Mieter verschwinden
        for (const m of ergebnis.geloescht) logActivity('mieter_ohne_vertrag_geloescht', 'mieter', m.id, { anlass: 'entwurf_verworfen' });
        saetze.push(loeschErgebnisText(ergebnis));
        warnung = ergebnis.behalten.length > 0;
      } catch (err) {
        saetze.push(
          `Der Mieter wurde nicht gelöscht (${err instanceof Error ? err.message : String(err)}). Er steht in der Suche unter „Mieter ohne Mietvertrag“ und lässt sich dort löschen.`
        );
        warnung = true;
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwuerfe'] }),
      queryClient.invalidateQueries({ queryKey: ['search'] }),
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-mieterbestand'] }),
      queryClient.invalidateQueries({ queryKey: ['all-tenants'] }),
    ]);
    toast({
      title: warnung ? 'Entwurf verworfen, nicht alle Mieter gelöscht' : 'Entwurf verworfen',
      description: saetze.join(' '),
      variant: warnung ? 'destructive' : undefined,
    });
    setVerwirft(false);
    onSchliessen();
  }

  return (
    <AlertDialog open={!!entwurf} onOpenChange={o => !o && !verwirft && onSchliessen()}>
      <AlertDialogContent onClick={e => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>{namen} — Entwurf, Entwurfs-PDF und Selbstauskunft werden gelöscht.</p>
              {ids.length === 0 ? (
                <p>Für diesen Entwurf wurde noch kein Mieter angelegt.</p>
              ) : prueft ? (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Angelegte Mieter werden geprüft …
                </p>
              ) : kandidaten.error ? (
                <p className="text-destructive">
                  Ob die angelegten Mieter einen Mietvertrag haben, ließ sich nicht prüfen ({kandidaten.error.message}). Sie
                  bleiben im Bestand.
                </p>
              ) : ohneVertrag.length === 0 ? (
                <p>Mieter, die schon im Bestand sind, bleiben dort.</p>
              ) : (
                <div className="space-y-2 rounded-md border p-3 text-foreground">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="mieter-mitloeschen"
                      checked={mieterLoeschen}
                      disabled={verwirft}
                      onCheckedChange={c => setMieterLoeschen(c === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor="mieter-mitloeschen" className="text-sm font-normal leading-snug">
                      {namensAufzaehlung(ohneVertrag.map(m => m.name))} auch aus dem Mieterbestand löschen
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Schon als Mieter angelegt, ohne Mietvertrag. Ohne Haken
                    {ohneVertrag.length > 1 ? ' bleiben sie' : ' bleibt der Mieter'} im Bestand — etwa wenn der Vertrag
                    später doch kommt. Löschen geht dann noch über die Suche.
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={verwirft}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={verwirft || prueft}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={ev => {
              ev.preventDefault();
              void bestaetigt();
            }}
          >
            {verwirft && <Loader2 className="h-4 w-4 animate-spin" />}
            {mieterLoeschen && ohneVertrag.length > 0 ? 'Verwerfen und Mieter löschen' : 'Verwerfen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
