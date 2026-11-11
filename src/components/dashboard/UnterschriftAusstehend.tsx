/**
 * Hinweis an der Einheit für einen Vertrag, der ohne unterschriebene Fassung aktiviert wurde (seit 11.11.2026,
 * Kundenwunsch: „erst jemanden anlegen und das ist dann auch aktiviert … und dann sagen, wir erstellen jetzt einen
 * Mietvertrag“). Von hier aus geht es weiter: Mietvertrag erstellen (Generator für bestehende Verträge) und die
 * unterschriebene Fassung nachreichen — erst dann verschwindet der Hinweis.
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSignature, FileUp, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { reicheUnterschriftNach } from '@/services/mietvertragEntwurfService';

import MietvertragErstellungModal from './MietvertragErstellungModal';

interface Props {
  vertragId: string;
}

export function UnterschriftAusstehend({ vertragId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [zeigeErstellung, setZeigeErstellung] = useState(false);
  const [laedtHoch, setLaedtHoch] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);

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

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs" onClick={e => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <FileSignature className="h-3.5 w-3.5 shrink-0 text-warning" />
        Unterschrift ausstehend
      </p>
      <p className="text-muted-foreground">
        Das Mietverhältnis läuft. Mietvertrag erstellen, unterschreiben lassen und die unterschriebene Fassung hier hochladen.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-8 text-xs sm:h-7" onClick={() => setZeigeErstellung(true)}>
          <FileSignature className="h-3 w-3" />
          Mietvertrag erstellen
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs sm:h-7" disabled={laedtHoch} onClick={() => eingabe.current?.click()}>
          {laedtHoch ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
          Unterschriebene Fassung hochladen
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
      <MietvertragErstellungModal isOpen={zeigeErstellung} onClose={() => setZeigeErstellung(false)} vertragId={vertragId} />
    </div>
  );
}
