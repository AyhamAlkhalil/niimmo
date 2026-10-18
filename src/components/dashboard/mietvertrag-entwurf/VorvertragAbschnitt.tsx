/**
 * Der Vorvertrag derselben Einheit als Vorlage: Werte aus der Datenbank sind
 * schon übernommen; was nur im alten Dokument steht (Räume, Kostenaufstellung,
 * Heizkostenanteil), liest die KI aus der Word- oder PDF-Datei.
 */
import { CheckCircle2, FileSearch, History, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { VorvertragDokument } from '@/hooks/useMietvertragEntwurf';
import type { Tables } from '@/integrations/supabase/types';
import { getVertragsende } from '@/utils/contractUtils';

export type AusleseStatus =
  | { art: 'bereit' }
  | { art: 'laeuft' }
  | { art: 'fertig'; text: string }
  | { art: 'fehler'; text: string };

interface Props {
  vorvertrag: Tables<'mietvertrag'> | null;
  mieter: string[];
  dokumente: VorvertragDokument[];
  gewaehlt: string | null;
  setGewaehlt: (pfad: string) => void;
  status: AusleseStatus;
  onAuslesen: () => void;
}

function datumDe(iso: string | null | undefined): string {
  return iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE') : '…';
}

export function VorvertragAbschnitt({ vorvertrag, mieter, dokumente, gewaehlt, setGewaehlt, status, onAuslesen }: Props) {
  if (!vorvertrag) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Für diese Einheit gibt es keinen Vorvertrag. Miete, Nebenkosten und Räume bitte von Hand erfassen.
      </div>
    );
  }

  const ende = getVertragsende(vorvertrag);
  const ausDatenbank =
    Array.isArray(vorvertrag.betriebskosten_positionen) && vorvertrag.betriebskosten_positionen.length > 0;

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 text-xs">
          <p className="font-medium">
            Vorvertrag {datumDe(vorvertrag.start_datum)} – {ende ? datumDe(ende) : 'laufend'}
            {mieter.length > 0 && <span className="font-normal text-muted-foreground"> · {mieter.join(', ')}</span>}
          </p>
          <p className="text-muted-foreground">
            {Number(vorvertrag.kaltmiete ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })} € kalt ·{' '}
            {Number(vorvertrag.betriebskosten ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })} € Nebenkosten.
            Übernommene Werte sind gekennzeichnet, bis du sie änderst.
          </p>
        </div>
      </div>

      {ausDatenbank ? (
        <p className="text-xs text-muted-foreground">
          Der Vorvertrag wurde mit dem Generator erzeugt — Räume und Kostenaufstellung kommen direkt aus der Datenbank.
        </p>
      ) : dokumente.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Zum Vorvertrag ist kein Vertragsdokument abgelegt. Räume und Kostenaufstellung bitte von Hand erfassen.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={gewaehlt ?? ''} onValueChange={setGewaehlt}>
            <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
              <SelectValue placeholder="Vertragsdokument wählen" />
            </SelectTrigger>
            <SelectContent>
              {dokumente.map(d => (
                <SelectItem key={d.id} value={d.pfad} className="text-xs">
                  {d.titel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={!gewaehlt || status.art === 'laeuft'}
            onClick={onAuslesen}
          >
            {status.art === 'laeuft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
            Aus Dokument lesen
          </Button>
        </div>
      )}

      {status.art === 'laeuft' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Der alte Vertrag wird gelesen — Räume, Lage, Kostenaufstellung, Heizkosten.
        </p>
      )}
      {status.art === 'fertig' && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3 w-3" />
          {status.text}
        </p>
      )}
      {status.art === 'fehler' && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="h-3 w-3" />
          {status.text}
        </p>
      )}
    </div>
  );
}
