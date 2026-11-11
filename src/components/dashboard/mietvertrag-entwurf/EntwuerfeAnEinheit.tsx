/**
 * Laufende Vermietungen einer Einheit auf der Einheitskarte. Seit dem 11.11.2026 ein Prozess mit Zwischenständen
 * (Kundenwunsch: „eine Miete anlegen, ohne direkt den Mietvertrag komplett anzulegen … ein Prozess oder ein
 * Zwischenstand“): Mieter angelegt → Miete vorgemerkt → Mietvertrag → Unterschrift & Start. „Weiter“ steigt in
 * der ersten offenen Stufe ein. Der Vorgang belegt die Einheit nicht und erzeugt keine Forderungen; er steht
 * hier, bis er aktiviert oder verworfen wird (Verwerfen samt Löschen angelegter Mieter: EntwurfVerwerfen.tsx).
 */
import { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, FileText, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useMietvertragEntwuerfe } from '@/hooks/useMietvertragEntwurf';
import { entwurfDateiLink, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { naechsteStufe, vermietungsStufen, type SchrittId } from '@/utils/mietvertrag/entwurfProzess';
import { cn } from '@/lib/utils';

import { EntwurfVerwerfen } from './EntwurfVerwerfen';

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

function eckdaten(e: EntwurfZeile): string {
  const ab = e.daten.mietbeginn ? new Date(`${e.daten.mietbeginn}T12:00:00`).toLocaleDateString('de-DE') : '—';
  return `ab ${ab} · ${e.daten.kaltmiete.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € kalt`;
}

export function EntwuerfeAnEinheit({ einheitId, wohnraum, onOeffnen }: Props) {
  const { toast } = useToast();
  const { data, error } = useMietvertragEntwuerfe();
  const [verwerfen, setVerwerfen] = useState<EntwurfZeile | null>(null);

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
        const stufen = vermietungsStufen(e, wohnraum);
        const naechste = naechsteStufe(stufen);
        const mieteVorgemerkt = stufen[1].erledigt;
        return (
          <div key={e.id} className="space-y-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-2.5">
            <div className="min-w-0 text-xs">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="border-primary/50 px-1.5 py-0 text-xs text-primary">
                  In Vermietung
                </Badge>
                <span className="truncate font-medium">{namen(e)}</span>
              </div>
              {/* Die Eckdaten erst, wenn sie vorgemerkt sind — vorher stünden die Werte des Vorvertrags da */}
              <p className="mt-0.5 text-muted-foreground">{mieteVorgemerkt ? eckdaten(e) : 'Miete noch nicht vorgemerkt'}</p>
              <ol className="mt-1.5 space-y-0.5" aria-label="Stand der Vermietung">
                {stufen.map(s => (
                  <li key={s.titel} className={cn('flex items-center gap-1.5', s.erledigt ? 'text-foreground' : 'text-muted-foreground')}>
                    {s.erledigt ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span>
                      {s.titel}
                      <span className="sr-only">{s.erledigt ? ' – erledigt' : ' – offen'}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-8 text-xs sm:h-7" onClick={() => onOeffnen(e.id, naechste.schritt)}>
                <ArrowRight className="h-3 w-3" />
                Weiter: {naechste.kurz}
              </Button>
              {hatPdf && (
                <Button size="sm" variant="outline" className="h-8 text-xs sm:h-7" onClick={() => void pdfOeffnen(e)}>
                  <FileText className="h-3 w-3" />
                  PDF
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-destructive sm:h-7"
                aria-label="Vermietung verwerfen"
                onClick={() => setVerwerfen(e)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}

      <EntwurfVerwerfen entwurf={verwerfen} namen={verwerfen ? namen(verwerfen) : ''} onSchliessen={() => setVerwerfen(null)} />
    </div>
  );
}
