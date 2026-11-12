/**
 * Der Mietvertrag als Schriftstück — überall derselbe Stand und dieselben Aktionen (12.11.2026, Nutzer: „die Lösung
 * muss ganzheitlich sein. An den relevanten Informationen soll man erstellen können, wieder ändern können …“).
 *
 * Getrennt vom Mietverhältnis im System und optional (11.11.2026). Gezeigt wird, ob eine unterschriebene Fassung
 * hinterlegt ist und ob ein erstelltes PDF noch auf die Unterschrift wartet (`fassungenStand`). Aktionen:
 *  - Mietvertrag erstellen bzw. eine neue Fassung — der Generator nimmt den gespeicherten Stand des Vertrags; geändert
 *    wird also am Vertrag (Bearbeiten) oder im Generator selbst, dann neu erstellt. Nur Wohnraum hat eine Vorlage.
 *  - Unterschriebene Fassung hochladen — bei ausstehender Unterschrift löscht das den Merker, sonst kommt eine weitere
 *    Fassung dazu (Änderung, Nachtrag).
 *  - Zurücknehmen — nur solange die Unterschrift aussteht und nichts darauf aufbaut (`vermietung_zuruecknehmen`).
 *
 * `karte`: an der Einheit, nur für Verträge ohne Unterschrift. `details`: als Abschnitt in der Vertragsansicht, immer.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Download, Eye, FileText, FileUp, Loader2, Undo2 } from 'lucide-react';

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useMietvertragFassungen } from '@/hooks/useMietvertragFassungen';
import { dokumentHerunterladen, dokumentOeffnen } from '@/lib/dokumentOeffnen';
import { cn } from '@/lib/utils';
import { legeUnterschriebeneFassungAb, nimmVermietungZurueck } from '@/services/mietvertragEntwurfService';
import { downloadDateiname } from '@/utils/dokumentDateiname';
import { fassungDatum, fassungenStand, type VertragsDokument } from '@/utils/mietvertrag/fassungen';

import MietvertragErstellungModal from './MietvertragErstellungModal';

interface Props {
  vertragId: string;
  /** Wohnung/Haus: Nur dafür gibt es eine Vorlage und damit ein PDF. */
  wohnraum: boolean;
  /** `mietvertrag.unterschrift_ausstehend` */
  ausstehend: boolean;
  /** Status des Vertrags — zurücknehmen lässt sich nur ein laufender. */
  status?: string | null;
  variante: 'karte' | 'details';
  /** Mietbeginn — an der Einheit genannt, wenn die Karte gerade einen anderen Vertrag zeigt (Vormieter). */
  beginn?: string | null;
  /** Aktionen gesperrt, mit Grund (etwa: Vertragsansicht im Bearbeiten-Modus). */
  gesperrt?: string | null;
  /** Nach dem Zurücknehmen gibt es den Vertrag nicht mehr — etwa die Vertragsansicht schließen. */
  onZurueckgenommen?: () => void;
}

function datumDe(iso: string | null | undefined): string {
  return iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE') : '';
}

function Zeile({ erledigt, children }: { erledigt: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', erledigt ? 'text-foreground' : 'text-muted-foreground')}>
      {erledigt ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      {children}
    </div>
  );
}

export function MietvertragDokument({
  vertragId,
  wohnraum,
  ausstehend,
  status,
  variante,
  beginn,
  gesperrt,
  onZurueckgenommen,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const fassungen = useMietvertragFassungen(vertragId);
  const [zeigeErstellung, setZeigeErstellung] = useState(false);
  const [laedtHoch, setLaedtHoch] = useState(false);
  const [frageZuruecknehmen, setFrageZuruecknehmen] = useState(false);
  const [nimmtZurueck, setNimmtZurueck] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);

  const stand = fassungenStand(fassungen.data ?? [], ausstehend);
  const zuruecknehmbar = ausstehend && status === 'aktiv';
  const beschaeftigt = laedtHoch || nimmtZurueck;
  const aus = beschaeftigt || !!gesperrt;
  const istKarte = variante === 'karte';
  const knopf = istKarte ? 'h-8 text-xs sm:h-7' : 'h-8 text-xs';
  const symbol = 'h-3 w-3';

  async function ansehen(d: VertragsDokument) {
    // dokumentOeffnen öffnet das Fenster noch im Klick (Safari)
    if (!d.pfad || !(await dokumentOeffnen(d.pfad))) {
      toast({
        title: 'Dokument nicht geöffnet',
        description: 'Es ließ sich nicht öffnen. Falls der Browser Pop-ups blockiert, bitte für diese Seite erlauben.',
        variant: 'destructive',
      });
    }
  }

  async function herunterladen(d: VertragsDokument) {
    // Der Titel trägt Mieter, Mietsache und Zeitpunkt (vertragsTitel) — so unterscheiden sich mehrere Fassungen
    if (!d.pfad || !(await dokumentHerunterladen(d.pfad, downloadDateiname(d.titel, d.pfad)))) {
      toast({ title: 'Nicht heruntergeladen', description: 'Die Datei ließ sich nicht laden. Bitte erneut versuchen.', variant: 'destructive' });
    }
  }

  async function hochladen(datei: File) {
    setLaedtHoch(true);
    try {
      await legeUnterschriebeneFassungAb(vertragId, datei, ausstehend);
      toast({ title: 'Unterschriebene Fassung abgelegt', description: 'Sie steht in den Dokumenten des Vertrags.' });
    } catch (e) {
      toast({ title: 'Nicht abgelegt', description: e instanceof Error ? e.message : 'Unbekannter Fehler', variant: 'destructive' });
    } finally {
      setLaedtHoch(false);
      if (eingabe.current) eingabe.current.value = '';
      // Einheit, Vertrag und Dokumente hängen daran — auch nach einem Fehler (etwa aus einem anderen Tab) den Stand zeigen
      void queryClient.invalidateQueries();
    }
  }

  async function zuruecknehmen() {
    setNimmtZurueck(true);
    let weg = false;
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
      weg = true;
      onZurueckgenommen?.();
    } catch (e) {
      setFrageZuruecknehmen(false);
      toast({ title: 'Nicht zurückgenommen', description: e instanceof Error ? e.message : 'Unbekannter Fehler', variant: 'destructive' });
    } finally {
      setNimmtZurueck(false);
      // Einheit, Forderungen und Übersichten hängen daran — auch nach einem Fehler den aktuellen Stand zeigen. Ist der
      // Vertrag weg, erst nach dem Schließen der Vertragsansicht: Sonst lüde sie den gelöschten Vertrag nach (Review 12.11.2026)
      if (weg) setTimeout(() => void queryClient.invalidateQueries(), 0);
      else void queryClient.invalidateQueries();
    }
  }

  const standZeilen = fassungen.isLoading ? (
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Vertragsdokumente werden geladen …
    </p>
  ) : fassungen.isError ? (
    // Ein Ladefehler darf nicht wie „kein Mietvertrag“ aussehen
    <p className="text-destructive">
      Die Vertragsdokumente konnten nicht geladen werden.{' '}
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void fassungen.refetch()}>
        Erneut laden
      </Button>
    </p>
  ) : (
    <div className="space-y-1">
      <Zeile erledigt={!!stand.unterschrieben}>
        <span>
          {stand.unterschrieben
            ? `Unterschrieben hinterlegt${fassungDatum(stand.unterschrieben) ? ` (${fassungDatum(stand.unterschrieben)})` : ''}`
            : ausstehend
              ? 'Noch kein unterschriebener hinterlegt'
              : 'Kein Mietvertrag hinterlegt'}
        </span>
        {stand.unterschrieben && (
          <>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void ansehen(stand.unterschrieben!)}>
              <Eye className="h-3 w-3" />
              Ansehen
            </Button>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void herunterladen(stand.unterschrieben!)}>
              <Download className="h-3 w-3" />
              Herunterladen
            </Button>
          </>
        )}
      </Zeile>
      {stand.offenesPdf && (
        <Zeile erledigt={false}>
          <span>
            PDF erstellt{fassungDatum(stand.offenesPdf) ? ` am ${fassungDatum(stand.offenesPdf)}` : ''}, noch nicht unterschrieben
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void ansehen(stand.offenesPdf!)}>
            <Eye className="h-3 w-3" />
            Ansehen
          </Button>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void herunterladen(stand.offenesPdf!)}>
            <Download className="h-3 w-3" />
            Herunterladen
          </Button>
        </Zeile>
      )}
      {!istKarte && stand.anzahl > 1 && (
        <p className="pl-5 text-muted-foreground">Alle {stand.anzahl} Fassungen stehen im Reiter „Dokumente“.</p>
      )}
    </div>
  );

  const aktionen = (
    <div className="flex flex-wrap gap-1.5">
      {wohnraum && (
        <Button size="sm" variant="outline" className={knopf} disabled={aus} onClick={() => setZeigeErstellung(true)}>
          <FileText className={symbol} />
          {stand.erstellt || stand.unterschrieben ? 'Neue Fassung erstellen' : 'Mietvertrag erstellen'}
        </Button>
      )}
      <Button size="sm" variant="outline" className={knopf} disabled={aus} onClick={() => eingabe.current?.click()}>
        {laedtHoch ? <Loader2 className={cn(symbol, 'animate-spin')} /> : <FileUp className={symbol} />}
        Unterschriebene Fassung hochladen
      </Button>
      {zuruecknehmbar && (
        <Button size="sm" variant="ghost" className={cn(knopf, 'text-muted-foreground')} disabled={aus} onClick={() => setFrageZuruecknehmen(true)}>
          <Undo2 className={symbol} />
          Zurücknehmen
        </Button>
      )}
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
  );

  const hinweis = gesperrt ? (
    <p className="text-muted-foreground">{gesperrt}</p>
  ) : wohnraum ? (
    <p className="text-muted-foreground">
      {istKarte
        ? 'Optional. Bei Bedarf als PDF erstellen und die unterschriebene Fassung hier hochladen.'
        : 'Optional — das Mietverhältnis läuft auch ohne. Das PDF nimmt den gespeicherten Stand des Vertrags; nach einer Änderung einfach eine neue Fassung erstellen.'}
    </p>
  ) : (
    <p className="text-muted-foreground">Für diesen Einheitstyp gibt es keine Vorlage — die unterschriebene Fassung hier hochladen.</p>
  );

  const dialoge = (
    <>
      {zeigeErstellung && (
        <MietvertragErstellungModal isOpen ersteFassung={ausstehend} onClose={() => setZeigeErstellung(false)} vertragId={vertragId} />
      )}

      <AlertDialog open={frageZuruecknehmen} onOpenChange={o => !o && !nimmtZurueck && setFrageZuruecknehmen(false)}>
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Vermietung zurücknehmen?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Mietverhältnis{beginn ? ` ab ${datumDe(beginn)}` : ''} wird gelöscht — mit seinen Forderungen und den
              abgelegten Dokumenten (etwa PDF und Selbstauskunft). Die Mieter bleiben im Bestand; ohne Mietvertrag lassen sie
              sich über die Suche löschen. Das geht nur, solange keine Zahlung, Kaution, Mahnung oder Abrechnung daran hängt —
              sonst bleibt nur die Kündigung.
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
    </>
  );

  if (istKarte) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card/70 p-2.5 text-xs" onClick={e => e.stopPropagation()}>
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          Mietvertrag{beginn ? ` zum Mietverhältnis ab ${datumDe(beginn)}` : ''}
        </p>
        {standZeilen}
        {hinweis}
        {aktionen}
        {dialoge}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border/80 bg-muted/60">
            <FileText className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <span className="text-lg font-semibold md:text-xl">Mietvertrag</span>
            <p className="mt-0.5 text-xs font-normal text-muted-foreground md:text-sm">Das Schriftstück zum Mietverhältnis</p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 text-xs md:p-6 md:text-sm">
        {standZeilen}
        {hinweis}
        {aktionen}
        {dialoge}
      </CardContent>
    </Card>
  );
}
