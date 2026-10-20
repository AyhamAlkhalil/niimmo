/**
 * Schritt „Unterschrift & Start": PDF drucken, unterschreiben lassen,
 * unterschriebene Fassung hochladen, Vertrag aktivieren.
 *
 * Erst das Aktivieren legt Mieter, Vertrag, Verknüpfungen, Dokumente und die
 * Forderungen ab Mietbeginn an — in einer Transaktion
 * (`aktiviere_mietvertrag_entwurf`). Ohne unterschriebene Fassung wird nicht
 * aktiviert (Entscheidung vom 18.10.2026).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, FileUp, Loader2, PenLine, Printer, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { aktiviereEntwurf, entwurfDateiLink, verwirfEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { checkContractOverlap } from '@/utils/contractOverlapValidation';
import { hatNamen, monateNachzuholen, rund2 } from '@/utils/mietvertrag/entwurf';
import type { SchrittId } from '@/utils/mietvertrag/entwurfProzess';
import { istPlausiblesDatum } from '@/utils/pdf/briefLayout';

interface Props {
  /** Gespeicherter Stand; `null`, solange der Entwurf nie gespeichert wurde. */
  entwurf: EntwurfZeile | null;
  ungespeichert: boolean;
  wohnraum: boolean;
  /** Pflichtangaben vollständig (Wohnraum: PDF erzeugbar). */
  vollstaendig: boolean;
  /** Was jeder Vertrag braucht (Mitmieter, Mietbeginn, Kaltmiete, Enddatum einer Befristung). */
  luecken: { feld: string; text: string }[];
  /** Weitere Entwürfe derselben Einheit. */
  andere: EntwurfZeile[];
  speichert: boolean;
  onSpeichern: () => Promise<boolean>;
  onGeheZu: (schritt: SchrittId) => void;
  onAktiviert: () => void;
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

function Punkt({ nr, erledigt, titel, children }: { nr: number; erledigt: boolean; titel: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={
          erledigt
            ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-success bg-success/10 text-success'
            : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground'
        }
      >
        {erledigt ? <CheckCircle2 className="h-3.5 w-3.5" /> : nr}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
        <p className="text-sm font-medium">{titel}</p>
        {children}
      </div>
    </li>
  );
}

export function StartSchritt({
  entwurf,
  ungespeichert,
  wohnraum,
  vollstaendig,
  luecken,
  andere,
  speichert,
  onSpeichern,
  onGeheZu,
  onAktiviert,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  const [datei, setDatei] = useState<File | null>(null);
  const [andereVerwerfen, setAndereVerwerfen] = useState(true);
  const [beginnBestaetigt, setBeginnBestaetigt] = useState(false);
  const [ueberschneidung, setUeberschneidung] = useState<string | null>(null);
  const [ueberschneidungBestaetigt, setUeberschneidungBestaetigt] = useState(false);
  const [ohnePdfBestaetigt, setOhnePdfBestaetigt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const d = entwurf?.daten ?? null;
  const pdf = entwurf?.dateien.find(x => x.art === 'entwurf_pdf') ?? null;
  const mitmieter = (entwurf?.personen ?? []).filter(p => p.rolle === 'mitmieter' && hatNamen(p));
  const nachzuholen = d && istPlausiblesDatum(d.mietbeginn) ? monateNachzuholen(d.mietbeginn, heuteIso()) : 0;
  const bestaetigungNoetig = nachzuholen > 3;
  const gesamt = d
    ? rund2(d.kaltmiete + (d.betriebskostenModus === 'inklusiv' ? 0 : d.betriebskostenVorauszahlung) + (d.heizkostenVorauszahlung ?? 0))
    : 0;

  const einheitId = entwurf?.einheitId;
  const mietbeginn = d?.mietbeginn;
  const vertragsende = d?.vertragsende || null;
  useEffect(() => {
    if (!einheitId || !mietbeginn) return;
    let aktiv = true;
    void checkContractOverlap(einheitId, mietbeginn, vertragsende).then(ergebnis => {
      if (!aktiv) return;
      setUeberschneidung(ergebnis.hasOverlap ? ergebnis.warningMessage ?? 'Der Zeitraum überschneidet sich mit einem anderen Vertrag dieser Einheit.' : null);
      setUeberschneidungBestaetigt(false);
    });
    return () => {
      aktiv = false;
    };
  }, [einheitId, mietbeginn, vertragsende]);

  async function pdfOeffnen() {
    if (!pdf) return;
    // Fenster vorab öffnen, sonst blockt der Browser es nach dem await
    const fenster = window.open('', '_blank');
    try {
      const link = await entwurfDateiLink(pdf.pfad);
      if (fenster) fenster.location.href = link;
      else window.open(link, '_blank');
    } catch (e) {
      fenster?.close();
      toast({ title: 'PDF nicht abrufbar', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  async function aktivieren() {
    if (!entwurf || !datei) return;
    setLaeuft(true);
    try {
      const ergebnis = await aktiviereEntwurf({ entwurf, unterschrieben: datei, mitVorlage: wohnraum && !!pdf });

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

      toast({
        title: 'Mietvertrag aktiviert',
        description: [
          `Der Vertrag ab ${datumDe(entwurf.daten.mietbeginn)} steht jetzt an der Einheit, ${pdf ? 'PDF und unterschriebene Fassung' : 'die unterschriebene Fassung'} in seinen Dokumenten.`,
          ergebnis.nachgeholt > 0 ? `${ergebnis.nachgeholt} Monatsforderung(en) seit Mietbeginn angelegt.` : '',
          ...hinweise,
        ]
          .filter(Boolean)
          .join(' '),
        variant: hinweise.length > 0 ? 'destructive' : undefined,
      });
      // Den Entwurf gibt es nicht mehr: nicht nachfragen lassen, sonst wartet das Schließen auf drei Fehlversuche
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', entwurf.id] });
      onAktiviert();
      // Vertrag, Mieter, Einheit, Forderungen und Übersichten hängen daran
      void queryClient.invalidateQueries();
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

  if (!entwurf || !d) {
    return (
      <Alert>
        <Save className="h-4 w-4" />
        <AlertDescription className="space-y-2 text-sm">
          <p>Der Entwurf ist noch nicht gespeichert.</p>
          <Button type="button" size="sm" onClick={() => void onSpeichern()} disabled={speichert}>
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            Jetzt speichern
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const ohnePdf = wohnraum && !pdf;
  const bereit =
    !ungespeichert &&
    !!datei &&
    luecken.length === 0 &&
    (!bestaetigungNoetig || beginnBestaetigt) &&
    (!ueberschneidung || ueberschneidungBestaetigt) &&
    (!ohnePdf || ohnePdfBestaetigt);

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        <Punkt nr={1} erledigt={!!pdf && !ungespeichert} titel={wohnraum ? 'Mietvertrag als PDF' : 'Vertragsdaten'}>
          {ungespeichert ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>Es gibt ungespeicherte Änderungen{wohnraum ? ' — das PDF wird beim Speichern neu erstellt' : ''}.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void onSpeichern()} disabled={speichert}>
                {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Speichern
              </Button>
            </div>
          ) : pdf ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Erstellt und am Entwurf abgelegt.</span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void pdfOeffnen()}>
                <ExternalLink className="h-3.5 w-3.5" />
                PDF öffnen
              </Button>
            </div>
          ) : wohnraum ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>{vollstaendig ? 'Noch kein PDF gespeichert.' : 'Noch kein PDF — es fehlen Pflichtangaben.'}</p>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onGeheZu('pruefen')}>
                <PenLine className="h-3.5 w-3.5" />
                Zu „Prüfen &amp; PDF"
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Für {d.vertragsart === 'gewerbe' ? 'Gewerbe' : 'diesen Einheitstyp'} gibt es noch keine abgenommene Vorlage —
              der Vertrag entsteht außerhalb und wird hier hochgeladen.
            </p>
          )}
        </Punkt>

        <Punkt nr={2} erledigt={!!datei} titel="Ausdrucken und von beiden Seiten unterschreiben lassen">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Printer className="h-3.5 w-3.5" />
            Papier mit Unterschrift — eine Klick-Signatur genügt für Wohnraum nicht.
          </p>
        </Punkt>

        <Punkt nr={3} erledigt={false} titel="Unterschriebene Fassung hochladen und Vertrag aktivieren">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="unterschrieben" className="flex items-center gap-1.5 text-xs">
                <FileUp className="h-3.5 w-3.5" />
                Scan oder Foto (PDF, JPG, PNG)
              </Label>
              <Input
                id="unterschrieben"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => setDatei(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="space-y-1 rounded-md border p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Mieter: </span>
                {mitmieter.map(p => (p.istUnternehmen ? p.firmenname : `${p.vorname} ${p.nachname}`.trim())).filter(Boolean).join(', ') ||
                  '—'}
              </p>
              <p>
                <span className="text-muted-foreground">Mietbeginn: </span>
                {datumDe(d.mietbeginn)}
                {nachzuholen > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    — {nachzuholen === 1 ? 'die Forderung für den laufenden Monat wird' : `${nachzuholen} Monatsforderungen werden`} beim
                    Aktivieren angelegt
                  </span>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Monatlich: </span>
                {eur(gesamt)} € ({eur(d.kaltmiete)} € kalt)
                {d.kautionArt !== 'keine' && ` · Kaution ${eur(d.kautionBetrag)} €`}
              </p>
              <p className="text-xs text-muted-foreground">
                Bis zum Aktivieren bleibt die Einheit frei und es entstehen keine Forderungen. Danach steht der Vertrag an
                der Einheit, {pdf ? 'das PDF und die unterschriebene Fassung' : 'die unterschriebene Fassung'} in seinen
                Dokumenten.
              </p>
            </div>

            {ueberschneidung && (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-start gap-2 whitespace-pre-line text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {ueberschneidung}
                </p>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="ueberschneidung"
                    checked={ueberschneidungBestaetigt}
                    onCheckedChange={c => setUeberschneidungBestaetigt(c === true)}
                  />
                  <Label htmlFor="ueberschneidung" className="text-sm font-normal leading-snug">
                    Geprüft — der Vertrag soll trotzdem ab {datumDe(d.mietbeginn)} gelten. Den bisherigen Vertrag beende ich
                    gesondert.
                  </Label>
                </div>
              </div>
            )}

            {ohnePdf && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <Checkbox id="ohne-pdf" checked={ohnePdfBestaetigt} onCheckedChange={c => setOhnePdfBestaetigt(c === true)} />
                <Label htmlFor="ohne-pdf" className="text-sm font-normal leading-snug">
                  Zu diesem Entwurf gibt es kein PDF aus der Vorlage. Die unterschriebene Fassung ist ein anderer Vertrag; die
                  Angaben des Entwurfs werden so übernommen, wie sie sind
                  {vollstaendig ? '' : ' — auch die noch fehlenden'}.
                </Label>
              </div>
            )}

            {bestaetigungNoetig && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                <Checkbox id="beginn" checked={beginnBestaetigt} onCheckedChange={c => setBeginnBestaetigt(c === true)} />
                <Label htmlFor="beginn" className="text-sm font-normal leading-snug">
                  Der Mietbeginn {datumDe(d.mietbeginn)} stimmt — für {nachzuholen} Monate werden Forderungen angelegt, die als
                  offen gelten, bis Zahlungen zugeordnet sind.
                </Label>
              </div>
            )}

            {andere.length > 0 && (
              <div className="flex items-start gap-2">
                <Checkbox id="andere" checked={andereVerwerfen} onCheckedChange={c => setAndereVerwerfen(c === true)} />
                <Label htmlFor="andere" className="text-sm font-normal leading-snug">
                  {andere.length === 1 ? 'Den anderen Entwurf' : `Die anderen ${andere.length} Entwürfe`} dieser Einheit verwerfen
                  — samt Interessentendaten und Selbstauskunft.
                </Label>
              </div>
            )}

            {luecken.length > 0 && (
              <div className="space-y-0.5 text-xs text-destructive">
                <p className="font-medium">Vor dem Aktivieren noch klären:</p>
                {luecken.map((l, i) => (
                  <p key={i}>{l.text}</p>
                ))}
              </div>
            )}

            <Button type="button" onClick={() => void aktivieren()} disabled={!bereit || laeuft}>
              {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Vertrag aktivieren
            </Button>
          </div>
        </Punkt>
      </ol>
    </div>
  );
}
