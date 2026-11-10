/**
 * Offene Mietvertragsentwürfe einer Einheit auf der Einheitskarte, mit ihrem
 * Stand im Ablauf. Ein Entwurf belegt die Einheit nicht — er steht hier, bis
 * er aktiviert oder verworfen wird. Seit dem 10.11.2026 lassen sich seine
 * Mitmieter hier auch ohne Vertrag anlegen („Mieter anlegen“) und beim
 * Verwerfen wieder löschen (EntwurfVerwerfen.tsx).
 */
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, PenLine, Trash2, UserPlus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useMietvertragEntwuerfe } from '@/hooks/useMietvertragEntwurf';
import { entwurfDateiLink, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { anzulegendePersonen, hatNamen } from '@/utils/mietvertrag/entwurf';
import { istSchrittId, schrittTitel, type SchrittId } from '@/utils/mietvertrag/entwurfProzess';

import { EntwurfVerwerfen } from './EntwurfVerwerfen';
import { useMieterAnlegen } from './MieterAnlegen';

interface Props {
  einheitId: string;
  /** Wohnung/Haus: Es gibt eine Vorlage und damit ein PDF. */
  wohnraum: boolean;
  /** Öffnet den Ablauf; ohne Schritt dort, wo zuletzt gespeichert wurde. */
  onOeffnen: (entwurfId: string, schritt?: SchrittId) => void;
}

function namen(e: EntwurfZeile): string {
  const liste = e.personen
    .filter(p => p.rolle === 'mitmieter')
    .map(p => (p.istUnternehmen ? p.firmenname : `${p.vorname} ${p.nachname}`.trim()))
    .filter(Boolean);
  return liste.length > 0 ? liste.join(', ') : 'noch ohne Mieter';
}

function stand(e: EntwurfZeile, wohnraum: boolean): string {
  if (e.dateien.some(d => d.art === 'entwurf_pdf')) return 'PDF erstellt · wartet auf Unterschrift';
  return istSchrittId(e.schritt) ? `in Bearbeitung · ${schrittTitel(e.schritt, wohnraum)}` : 'in Bearbeitung';
}

/** Haben alle Mitmieter schon einen Mieterdatensatz (angelegt oder aus dem Bestand gewählt)? */
function mieterImBestand(e: EntwurfZeile): boolean {
  return e.personen.some(p => p.rolle === 'mitmieter' && hatNamen(p)) && anzulegendePersonen(e.personen).length === 0;
}

export function EntwuerfeAnEinheit({ einheitId, wohnraum, onOeffnen }: Props) {
  const { toast } = useToast();
  const { data, error } = useMietvertragEntwuerfe();
  const [verwerfen, setVerwerfen] = useState<EntwurfZeile | null>(null);
  const mieterAnlegen = useMieterAnlegen();

  const entwuerfe = (data ?? []).filter(e => e.einheitId === einheitId);
  // Ein Ladefehler darf nicht wie „keine Entwürfe" aussehen — sonst entsteht ein zweiter
  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive" onClick={e => e.stopPropagation()}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Offene Mietvertragsentwürfe konnten nicht geladen werden ({error.message}).
      </p>
    );
  }
  if (entwuerfe.length === 0) return null;

  async function pdfOeffnen(e: EntwurfZeile) {
    const pdf = e.dateien.find(d => d.art === 'entwurf_pdf');
    if (!pdf) return;
    // Fenster vorab öffnen, sonst blockt der Browser es nach dem await
    const fenster = window.open('', '_blank');
    try {
      const link = await entwurfDateiLink(pdf.pfad);
      if (fenster) fenster.location.href = link;
      else window.open(link, '_blank');
    } catch (err) {
      fenster?.close();
      toast({ title: 'PDF nicht abrufbar', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-2" onClick={e => e.stopPropagation()}>
      {entwuerfe.map(e => {
        const hatPdf = e.dateien.some(d => d.art === 'entwurf_pdf');
        const offen = anzulegendePersonen(e.personen).length;
        return (
          <div key={e.id} className="space-y-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-2.5">
            <div className="min-w-0 text-xs">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-primary/50 px-1.5 py-0 text-xs text-primary">
                  Entwurf
                </Badge>
                <span className="truncate font-medium">{namen(e)}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">
                ab {e.daten.mietbeginn ? new Date(`${e.daten.mietbeginn}T12:00:00`).toLocaleDateString('de-DE') : '—'} ·{' '}
                {e.daten.kaltmiete.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € kalt
              </p>
              <p className="text-muted-foreground">{stand(e, wohnraum)}</p>
              {mieterImBestand(e) && <p className="text-muted-foreground">Mieter angelegt · Mietvertrag noch offen</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOeffnen(e.id)}>
                <PenLine className="h-3 w-3" />
                Fortsetzen
              </Button>
              {hatPdf && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void pdfOeffnen(e)}>
                  <FileText className="h-3 w-3" />
                  PDF
                </Button>
              )}
              {offen > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={mieterAnlegen.beschaeftigt}
                  title="Den Mieter schon jetzt in den Bestand übernehmen — der Mietvertrag kann warten"
                  onClick={() => void mieterAnlegen.fragen({ entwurfId: e.id, personen: e.personen })}
                >
                  <UserPlus className="h-3 w-3" />
                  Mieter anlegen
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs" onClick={() => onOeffnen(e.id, 'start')}>
                <CheckCircle2 className="h-3 w-3" />
                Unterschrift &amp; Start
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive"
                aria-label="Entwurf verwerfen"
                onClick={() => setVerwerfen(e)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}

      <EntwurfVerwerfen entwurf={verwerfen} namen={verwerfen ? namen(verwerfen) : ''} onSchliessen={() => setVerwerfen(null)} />
      {mieterAnlegen.dialog}
    </div>
  );
}
