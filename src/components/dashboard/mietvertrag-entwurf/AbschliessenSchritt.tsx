/**
 * Schritt „Abschließen“: Das Mietverhältnis kommt ins System — Vertrag, Mieterverknüpfung und die Forderungen ab
 * Mietbeginn, in einer Transaktion (`aktiviere_mietvertrag_entwurf`).
 *
 * Seit dem 11.11.2026 ohne unterschriebene Fassung und ohne PDF (Nutzer: „den Mietvertrag als PDF zu erzeugen ist ein
 * anderer Prozess als einen Mietvertrag im System zu haben … Man soll ganz normal abschließen können, und die
 * Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt werden“). Der Vertrag trägt dann
 * `unterschrift_ausstehend`; an der Einheit lässt sich der Mietvertrag erstellen, die unterschriebene Fassung
 * hochladen und — solange nichts darauf aufbaut — die Vermietung zurücknehmen (`MietvertragOhneUnterschrift`).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { aktiviereEntwurf, entwurfDateiLink, verwirfEntwurf, type EntwurfZeile } from '@/services/mietvertragEntwurfService';
import { checkContractOverlap } from '@/utils/contractOverlapValidation';
import { hatNamen, monateNachzuholen, rund2 } from '@/utils/mietvertrag/entwurf';
import { abschliessenMoeglich, bereichFuerFeld, schrittTitel, type SchrittId } from '@/utils/mietvertrag/entwurfProzess';
import { istPlausiblesDatum } from '@/utils/pdf/briefLayout';
import { angelegteMieterAusAnderen, namensAufzaehlung } from '@/utils/mieterOhneVertrag';

interface Props {
  /** Gespeicherter Stand; `null`, solange der Entwurf nie gespeichert wurde. */
  entwurf: EntwurfZeile | null;
  /** Miete & Laufzeit mit „Miete speichern“ bestätigt — sonst stünden womöglich nur Werte aus dem Vorvertrag da. */
  mieteVorgemerkt: boolean;
  ungespeichert: boolean;
  wohnraum: boolean;
  /** Was das Abschließen braucht (Mitmieter, Mietbeginn, Kaltmiete, Enddatum einer Befristung …). */
  luecken: { feld: string; text: string }[];
  /** Weitere Entwürfe derselben Einheit. */
  andere: EntwurfZeile[];
  speichert: boolean;
  onSpeichern: () => Promise<boolean>;
  onGeheZu: (schritt: SchrittId) => void;
  onAbgeschlossen: () => void;
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

export function AbschliessenSchritt({
  entwurf,
  mieteVorgemerkt,
  ungespeichert,
  wohnraum,
  luecken,
  andere,
  speichert,
  onSpeichern,
  onGeheZu,
  onAbgeschlossen,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  const [andereVerwerfen, setAndereVerwerfen] = useState(true);
  const angelegte = angelegteMieterAusAnderen(andere, entwurf?.personen ?? []);
  const [beginnBestaetigt, setBeginnBestaetigt] = useState(false);
  const [ueberschneidung, setUeberschneidung] = useState<string | null>(null);
  const [ueberschneidungBestaetigt, setUeberschneidungBestaetigt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  const d = entwurf?.daten ?? null;
  // Ein PDF aus dem Ablauf bis zum 11.11.2026 — es wandert zu den Dokumenten des Vertrags
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

  async function abschliessen() {
    if (!entwurf) return;
    setLaeuft(true);
    try {
      const ergebnis = await aktiviereEntwurf({ entwurf, mitVorlage: wohnraum && !!pdf });

      const hinweise = [...ergebnis.hinweise];
      if (andereVerwerfen) {
        for (const anderer of andere) {
          try {
            await verwirfEntwurf(anderer);
            logActivity('mietvertrag_entwurf_verworfen', 'mietvertrag_entwurf', anderer.id, { grund: 'andere Vermietung abgeschlossen' });
          } catch (e) {
            hinweise.push(e instanceof Error ? e.message : String(e));
          }
        }
      }

      logActivity('mietvertrag_entwurf_aktiviert', 'mietvertrag', ergebnis.vertragId, {
        entwurf: entwurf.id,
        nachgeholte_forderungen: ergebnis.nachgeholt,
        ohne_unterschrift: true,
      });

      toast({
        title: 'Vermietung abgeschlossen',
        description: [
          `Das Mietverhältnis ab ${datumDe(entwurf.daten.mietbeginn)} läuft.`,
          ergebnis.nachgeholt > 0 ? `${ergebnis.nachgeholt} Monatsforderung(en) seit Mietbeginn angelegt.` : '',
          'Den Mietvertrag erstellst du bei Bedarf an der Einheit.',
          ...hinweise,
        ]
          .filter(Boolean)
          .join(' '),
        variant: hinweise.length > 0 ? 'destructive' : undefined,
      });
      // Den Entwurf gibt es nicht mehr: nicht nachfragen lassen, sonst wartet das Schließen auf drei Fehlversuche
      queryClient.removeQueries({ queryKey: ['mietvertrag-entwurf', entwurf.id] });
      onAbgeschlossen();
      // Vertrag, Mieter, Einheit, Forderungen und Übersichten hängen daran
      void queryClient.invalidateQueries();
    } catch (e) {
      toast({
        title: 'Abschließen fehlgeschlagen',
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
          <p>Die Vermietung ist noch nicht gespeichert.</p>
          <Button type="button" size="sm" onClick={() => void onSpeichern()} disabled={speichert}>
            {speichert && <Loader2 className="h-4 w-4 animate-spin" />}
            Jetzt speichern
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const bereit = abschliessenMoeglich({
    mieteOffen: !mieteVorgemerkt,
    ungespeichert,
    luecken: luecken.length,
    beginnOffen: bestaetigungNoetig && !beginnBestaetigt,
    ueberschneidungOffen: !!ueberschneidung && !ueberschneidungBestaetigt,
  });
  // Je Schritt ein Knopf zu den offenen Punkten
  const schritteMitLuecken = [...new Set(luecken.map(l => bereichFuerFeld(l.feld)))].filter(
    (b): b is 'mieter' | 'miete' => b !== 'vertrag'
  );

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm">
        Mit dem Abschließen läuft das Mietverhältnis im System: Die Einheit gilt als vermietet, das Mietkonto führt die
        Miete ab Mietbeginn. Einen Mietvertrag braucht es dafür nicht — du erstellst ihn bei Bedarf an der Einheit, auch
        später, und lädst dort die unterschriebene Fassung hoch.
      </p>

      <div className="space-y-1 rounded-md border p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Mieter: </span>
          {mitmieter.map(p => (p.istUnternehmen ? p.firmenname : `${p.vorname} ${p.nachname}`.trim())).filter(Boolean).join(', ') ||
            '—'}
        </p>
        <p>
          <span className="text-muted-foreground">Mietbeginn: </span>
          {datumDe(d.mietbeginn)}
          {istPlausiblesDatum(d.vertragsende) && <span> · befristet bis {datumDe(d.vertragsende)}</span>}
          {nachzuholen > 0 && (
            <span className="text-xs text-muted-foreground">
              {' '}
              — {nachzuholen === 1 ? 'die Forderung für den laufenden Monat wird' : `${nachzuholen} Monatsforderungen werden`} beim
              Abschließen angelegt
            </span>
          )}
        </p>
        <p>
          <span className="text-muted-foreground">Monatlich: </span>
          {eur(gesamt)} € ({eur(d.kaltmiete)} € kalt)
          {d.kautionArt !== 'keine' && ` · Kaution ${eur(d.kautionBetrag)} €`}
        </p>
        {pdf && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span>Das schon erstellte PDF (nicht unterschrieben) kommt zu den Dokumenten des Vertrags.</span>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void pdfOeffnen()}>
              <ExternalLink className="h-3.5 w-3.5" />
              PDF öffnen
            </Button>
          </div>
        )}
      </div>

      {!mieteVorgemerkt && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-2 text-sm">
            <p>Miete und Laufzeit sind noch nicht bestätigt. Bitte dort prüfen und „Miete speichern“.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => onGeheZu('miete')}>
              Zu „{schrittTitel('miete')}“
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {ungespeichert && (
        <Alert>
          <Save className="h-4 w-4" />
          <AlertDescription className="space-y-2 text-sm">
            <p>Es gibt ungespeicherte Änderungen. Abgeschlossen wird der gespeicherte Stand.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void onSpeichern()} disabled={speichert}>
              {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Speichern
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {ueberschneidung && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-start gap-2 whitespace-pre-line text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {ueberschneidung}
          </p>
          <div className="flex items-start gap-2">
            <Checkbox id="ueberschneidung" checked={ueberschneidungBestaetigt} onCheckedChange={c => setUeberschneidungBestaetigt(c === true)} />
            <Label htmlFor="ueberschneidung" className="text-sm font-normal leading-snug">
              Geprüft — das Mietverhältnis soll trotzdem ab {datumDe(d.mietbeginn)} gelten. Den bisherigen Vertrag beende ich
              gesondert.
            </Label>
          </div>
        </div>
      )}

      {bestaetigungNoetig && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <Checkbox id="beginn" checked={beginnBestaetigt} onCheckedChange={c => setBeginnBestaetigt(c === true)} />
          <Label htmlFor="beginn" className="text-sm font-normal leading-snug">
            Der Mietbeginn {datumDe(d.mietbeginn)} stimmt — für {nachzuholen} Monate werden Forderungen angelegt, die als offen
            gelten, bis Zahlungen zugeordnet sind.
          </Label>
        </div>
      )}

      {andere.length > 0 && (
        <div className="flex items-start gap-2">
          <Checkbox id="andere" checked={andereVerwerfen} onCheckedChange={c => setAndereVerwerfen(c === true)} />
          <Label htmlFor="andere" className="text-sm font-normal leading-snug">
            {andere.length === 1 ? 'Die andere Vermietung' : `Die anderen ${andere.length} Vermietungen`} dieser Einheit verwerfen —
            samt Interessentendaten und Selbstauskunft.
            {/* Seit 10.11.2026 können dort schon Mieter angelegt sein; sie bleiben, löschen geht über die Suche */}
            {angelegte.length > 0 &&
              ` Schon angelegte Mieter (${namensAufzaehlung(angelegte)}) bleiben im Bestand; ohne Mietvertrag lassen sie sich über die Suche löschen.`}
          </Label>
        </div>
      )}

      {luecken.length > 0 && (
        <div className="space-y-1.5 text-xs text-destructive">
          <p className="font-medium">Vor dem Abschließen noch klären:</p>
          {luecken.map((l, i) => (
            <p key={i}>{l.text}</p>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {schritteMitLuecken.map(s => (
              <Button key={s} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onGeheZu(s)}>
                Zu „{schrittTitel(s)}“
              </Button>
            ))}
          </div>
        </div>
      )}

      <Button type="button" onClick={() => void abschliessen()} disabled={!bereit || laeuft}>
        {laeuft ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        Vermietung abschließen
      </Button>
    </div>
  );
}
