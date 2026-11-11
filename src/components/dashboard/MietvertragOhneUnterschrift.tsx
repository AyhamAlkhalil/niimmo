/**
 * An der Einheit für ein Mietverhältnis, zu dem noch kein unterschriebener Mietvertrag hinterlegt ist
 * (`mietvertrag.unterschrift_ausstehend`, seit 11.11.2026). Kein Warnhinweis: Der Mietvertrag ist optional
 * (Nutzer: „die Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt werden“).
 *
 * Von hier aus: Mietvertrag als PDF erstellen (Generator für laufende Verträge; nur Wohnraum hat eine Vorlage),
 * die unterschriebene Fassung hochladen — dann verschwindet die Zeile — und, solange nichts darauf aufbaut, die
 * Vermietung zurücknehmen (`vermietung_zuruecknehmen`), etwa wenn der Mieter vor der Unterschrift abspringt.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, FileUp, Loader2, Undo2 } from 'lucide-react';

import {
  AlertDialog,
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
import { nimmVermietungZurueck, reicheUnterschriftNach } from '@/services/mietvertragEntwurfService';

import MietvertragErstellungModal from './MietvertragErstellungModal';

interface Props {
  vertragId: string;
  /** Wohnung/Haus: Nur dafür gibt es eine Vorlage und damit ein PDF. */
  wohnraum: boolean;
  /** Mietbeginn — genannt, wenn die Karte gerade einen anderen Vertrag zeigt (etwa den gekündigten Vormieter). */
  beginn?: string | null;
}

function datumDe(iso: string | null | undefined): string {
  return iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE') : '';
}

export function MietvertragOhneUnterschrift({ vertragId, wohnraum, beginn }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const [zeigeErstellung, setZeigeErstellung] = useState(false);
  const [laedtHoch, setLaedtHoch] = useState(false);
  const [frageZuruecknehmen, setFrageZuruecknehmen] = useState(false);
  const [nimmtZurueck, setNimmtZurueck] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);
  const beschaeftigt = laedtHoch || nimmtZurueck;

  async function hochladen(datei: File) {
    setLaedtHoch(true);
    try {
      await reicheUnterschriftNach(vertragId, datei);
      toast({ title: 'Unterschriebene Fassung abgelegt', description: 'Sie steht in den Dokumenten des Vertrags.' });
      // Einheit, Vertrag und Dokumente hängen daran
      void queryClient.invalidateQueries();
    } catch (e) {
      // Etwa „schon nachgereicht“ aus einem anderen Tab: Die Einheit soll den aktuellen Stand zeigen
      void queryClient.invalidateQueries();
      toast({
        title: 'Nicht abgelegt',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setLaedtHoch(false);
      if (eingabe.current) eingabe.current.value = '';
    }
  }

  async function zuruecknehmen() {
    setNimmtZurueck(true);
    try {
      const ergebnis = await nimmVermietungZurueck(vertragId);
      logActivity('vermietung_zurueckgenommen', 'mietvertrag', vertragId, { forderungen: ergebnis.forderungen });
      setFrageZuruecknehmen(false);
      toast({
        title: 'Vermietung zurückgenommen',
        description: [
          ergebnis.forderungen > 0 ? `${ergebnis.forderungen} Monatsforderung(en) entfernt.` : '',
          'Die Mieter bleiben im Bestand.',
          ...ergebnis.hinweise,
        ]
          .filter(Boolean)
          .join(' '),
        variant: ergebnis.hinweise.length > 0 ? 'destructive' : undefined,
      });
    } catch (e) {
      setFrageZuruecknehmen(false);
      toast({
        title: 'Nicht zurückgenommen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setNimmtZurueck(false);
      // Einheit, Forderungen und Übersichten hängen daran — auch nach einem Fehler den aktuellen Stand zeigen
      void queryClient.invalidateQueries();
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/70 p-2.5 text-xs" onClick={e => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        Mietvertrag{beginn ? ` zum Mietverhältnis ab ${datumDe(beginn)}` : ''}
      </p>
      <p className="text-muted-foreground">
        Noch kein unterschriebener hinterlegt.{' '}
        {wohnraum
          ? 'Bei Bedarf als PDF erstellen und die unterschriebene Fassung hier hochladen.'
          : 'Bei Bedarf die unterschriebene Fassung hier hochladen.'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {wohnraum && (
          <Button size="sm" variant="outline" className="h-8 text-xs sm:h-7" disabled={beschaeftigt} onClick={() => setZeigeErstellung(true)}>
            <FileText className="h-3 w-3" />
            Mietvertrag erstellen
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs sm:h-7" disabled={beschaeftigt} onClick={() => eingabe.current?.click()}>
          {laedtHoch ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
          Unterschriebene Fassung hochladen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground sm:h-7"
          disabled={beschaeftigt}
          onClick={() => setFrageZuruecknehmen(true)}
        >
          <Undo2 className="h-3 w-3" />
          Zurücknehmen
        </Button>
        <input
          ref={eingabe}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          aria-label="Unterschriebene Fassung des Mietvertrags"
          onChange={e => {
            const datei = e.target.files?.[0];
            if (datei) void hochladen(datei);
          }}
        />
      </div>

      {zeigeErstellung && (
        <MietvertragErstellungModal isOpen ersteFassung onClose={() => setZeigeErstellung(false)} vertragId={vertragId} />
      )}

      <AlertDialog open={frageZuruecknehmen} onOpenChange={o => !o && !nimmtZurueck && setFrageZuruecknehmen(false)}>
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Vermietung zurücknehmen?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Mietverhältnis{beginn ? ` ab ${datumDe(beginn)}` : ''} wird gelöscht — mit seinen Forderungen und den
              abgelegten Dokumenten (etwa PDF und Selbstauskunft). Die Mieter bleiben im Bestand; ohne Mietvertrag lassen
              sie sich über die Suche löschen. Das geht nur, solange keine Zahlung, Kaution, Mahnung oder Abrechnung daran
              hängt — sonst bleibt nur die Kündigung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={nimmtZurueck}>Abbrechen</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void zuruecknehmen()} disabled={nimmtZurueck}>
              {nimmtZurueck && <Loader2 className="h-4 w-4 animate-spin" />}
              Zurücknehmen
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
