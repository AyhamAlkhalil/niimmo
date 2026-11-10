/**
 * „Löschen“ an einem Mieter ohne Mietvertrag in der Suche (10.11.2026). Gedacht für Interessenten, die über
 * „Mieter anlegen“ in den Bestand kamen und abgesprungen sind, und für Reste gelöschter Verträge. Ob der Mieter
 * wirklich an nichts hängt, prüft die Datenbankfunktion; sie behält ihn sonst und nennt den Grund.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';

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
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { loescheMieterOhneVertrag } from '@/services/mieterOhneVertragService';
import { loeschErgebnisText } from '@/utils/mieterOhneVertrag';

interface Props {
  mieter: { id: string; name: string };
}

export function MieterOhneVertragLoeschen({ mieter }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const [offen, setOffen] = useState(false);
  const [loescht, setLoescht] = useState(false);

  async function loeschen() {
    setLoescht(true);
    try {
      const ergebnis = await loescheMieterOhneVertrag([mieter.id]);
      // Nur die ID ins Protokoll: Der Name soll mit dem Mieter verschwinden
      for (const m of ergebnis.geloescht) logActivity('mieter_ohne_vertrag_geloescht', 'mieter', m.id, { anlass: 'suche' });
      toast({
        title: ergebnis.behalten.length > 0 ? 'Nicht gelöscht' : 'Mieter gelöscht',
        description: loeschErgebnisText(ergebnis),
        variant: ergebnis.behalten.length > 0 ? 'destructive' : undefined,
      });
      setOffen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['search'] }),
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-entwurf-mieterbestand'] }),
        queryClient.invalidateQueries({ queryKey: ['all-tenants'] }),
      ]);
    } catch (e) {
      toast({ title: 'Nicht gelöscht', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setLoescht(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 text-destructive hover:text-destructive"
        onClick={e => {
          e.stopPropagation();
          setOffen(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Löschen
      </Button>
      <AlertDialog open={offen} onOpenChange={o => !o && !loescht && setOffen(false)}>
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{mieter.name} löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {mieter.name} hat keinen Mietvertrag und steht in keinem offenen Entwurf. Name, Kontaktdaten, Geburtsdatum
              und Anschrift werden endgültig aus dem Mieterbestand gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loescht}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={loescht}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={ev => {
                ev.preventDefault();
                void loeschen();
              }}
            >
              {loescht && <Loader2 className="h-4 w-4 animate-spin" />}
              Endgültig löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
