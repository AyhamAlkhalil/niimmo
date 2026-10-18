/**
 * Entwurf nach der Unterschrift aktivieren. Erst hier entstehen Mieter,
 * Vertrag, Verknüpfungen und Forderungen. Ohne die unterschriebene Fassung
 * wird nicht aktiviert (Entscheidung vom 18.10.2026).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { aktiviereEntwurf, verwirfEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { checkContractOverlap } from '@/utils/contractOverlapValidation';
import { istLeerePerson, istWohnraumEinheit, monateNachzuholen } from '@/utils/mietvertrag/entwurf';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  entwurf: EntwurfZeile;
  /** Weitere Entwürfe derselben Einheit. */
  andere: EntwurfZeile[];
  einheitentyp: string | null | undefined;
}

function eur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function datumDe(iso: string | null | undefined): string {
  return iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE') : '—';
}

export function EntwurfAktivierenDialog({ isOpen, onClose, entwurf, andere, einheitentyp }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  const [datei, setDatei] = useState<File | null>(null);
  const [andereVerwerfen, setAndereVerwerfen] = useState(true);
  const [ueberschneidung, setUeberschneidung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [beginnBestaetigt, setBeginnBestaetigt] = useState(false);

  const d = entwurf.daten;
  const mitmieter = entwurf.personen.filter(p => p.rolle === 'mitmieter' && !istLeerePerson(p));
  const hatPdf = entwurf.dateien.some(x => x.art === 'entwurf_pdf');
  const gesamt = d.kaltmiete + d.betriebskostenVorauszahlung + (d.heizkostenVorauszahlung ?? 0);
  // Ein Tippfehler im Mietbeginn (2016 statt 2026) erzeugte sonst ungefragt Dutzende Forderungen
  const nachzuholen = monateNachzuholen(d.mietbeginn, heuteIso());
  const bestaetigungNoetig = nachzuholen > 3;

  useEffect(() => {
    if (!isOpen) {
      setDatei(null);
      setAndereVerwerfen(true);
      setBeginnBestaetigt(false);
      setUeberschneidung(null);
      return;
    }
    let aktiv = true;
    void checkContractOverlap(entwurf.einheitId, d.mietbeginn, d.vertragsende).then(ergebnis => {
      if (aktiv && ergebnis.hasOverlap) setUeberschneidung(ergebnis.warningMessage ?? 'Der Zeitraum überschneidet sich mit einem anderen Vertrag dieser Einheit.');
    });
    return () => {
      aktiv = false;
    };
  }, [isOpen, entwurf.einheitId, d.mietbeginn, d.vertragsende]);

  async function aktivieren() {
    if (!datei) return;
    setLaeuft(true);
    try {
      const ergebnis = await aktiviereEntwurf({
        entwurf,
        unterschrieben: datei,
        mitVorlage: istWohnraumEinheit(einheitentyp) && hatPdf,
      });

      const hinweise = [...ergebnis.hinweise];
      if (andereVerwerfen) {
        for (const anderer of andere) {
          try {
            await verwirfEntwurf(anderer);
            logActivity('mietvertrag_entwurf_verworfen', 'mietvertrag_entwurf', anderer.id, { grund: 'anderer Entwurf aktiviert' });
          } catch (e) {
            hinweise.push(e instanceof Error ? e.message : String(e));
          }
        }
      }

      logActivity('mietvertrag_entwurf_aktiviert', 'mietvertrag', ergebnis.vertragId, {
        entwurf: entwurf.id,
        nachgeholte_forderungen: ergebnis.nachgeholt,
      });

      // Vertrag, Mieter, Einheit, Forderungen und Übersichten hängen daran
      await queryClient.invalidateQueries();

      toast({
        title: 'Mietvertrag aktiviert',
        description: [
          `Der Vertrag ab ${datumDe(d.mietbeginn)} steht jetzt an der Einheit.`,
          ergebnis.nachgeholt > 0 ? `${ergebnis.nachgeholt} Monatsforderung(en) seit Mietbeginn angelegt.` : '',
          ...hinweise,
        ]
          .filter(Boolean)
          .join(' '),
        variant: hinweise.length > 0 ? 'destructive' : undefined,
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Aktivieren fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && !laeuft && onClose()}>
      <DialogContent className="max-w-lg" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Unterschriebenen Vertrag aktivieren</DialogTitle>
          <DialogDescription>
            Erst jetzt werden Mieter und Vertrag angelegt und mit der Einheit verknüpft. Ab dem Mietbeginn entstehen
            die Monatsforderungen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Mieter: </span>
              {mitmieter
                .map(p => (p.istUnternehmen ? p.firmenname : `${p.vorname} ${p.nachname}`.trim()))
                .filter(Boolean)
                .join(', ') || '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Mietbeginn: </span>
              {datumDe(d.mietbeginn)}
              {nachzuholen > 0 && (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  — {nachzuholen === 1 ? 'die Forderung für den laufenden Monat wird' : `${nachzuholen} Monatsforderungen werden`} angelegt
                </span>
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Monatlich: </span>
              {eur(gesamt)} € ({eur(d.kaltmiete)} € kalt) · Kaution {eur(d.kautionBetrag)} €
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {hatPdf ? <CheckCircle2 className="h-3 w-3 text-success" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
              {hatPdf ? 'Entwurfs-PDF liegt vor und wird mit abgelegt.' : 'Kein Entwurfs-PDF vorhanden.'}
            </p>
          </div>

          {ueberschneidung && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="whitespace-pre-line text-xs">{ueberschneidung}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="unterschrieben" className="flex items-center gap-1.5">
              <FileUp className="h-4 w-4" />
              Unterschriebene Fassung (Scan oder Foto) *
            </Label>
            <Input
              id="unterschrieben"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => setDatei(e.target.files?.[0] ?? null)}
            />
          </div>

          {bestaetigungNoetig && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
              <Checkbox id="beginn" checked={beginnBestaetigt} onCheckedChange={c => setBeginnBestaetigt(c === true)} />
              <Label htmlFor="beginn" className="text-sm font-normal leading-snug">
                Der Mietbeginn {datumDe(d.mietbeginn)} stimmt — für {nachzuholen} Monate werden Forderungen angelegt, die
                als offen gelten, bis Zahlungen zugeordnet sind.
              </Label>
            </div>
          )}

          {andere.length > 0 && (
            <div className="flex items-start gap-2">
              <Checkbox id="andere" checked={andereVerwerfen} onCheckedChange={c => setAndereVerwerfen(c === true)} />
              <Label htmlFor="andere" className="text-sm font-normal leading-snug">
                {andere.length === 1 ? 'Den anderen Entwurf' : `Die anderen ${andere.length} Entwürfe`} dieser Einheit
                verwerfen — samt Interessentendaten und Selbstauskunft.
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button onClick={() => void aktivieren()} disabled={!datei || laeuft || mitmieter.length === 0 || (bestaetigungNoetig && !beginnBestaetigt)}>
            {laeuft && <Loader2 className="h-4 w-4 animate-spin" />}
            Vertrag aktivieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
