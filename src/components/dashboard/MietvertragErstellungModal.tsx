/**
 * Erzeugt den Mietvertrag als PDF — Formular links, Live-Vorschau rechts.
 *
 * Das Muster folgt `MahnungErstellungModal`. Der E-Mail-Schritt entfällt: Ein
 * Mietvertrag wird nicht versendet, er wird ausgedruckt, unterschrieben und
 * als unterschriebene Fassung wieder hochgeladen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Info, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useMietvertragPdfDaten } from '@/hooks/useMietvertragPdfDaten';
import { supabase } from '@/integrations/supabase/client';
import { generateMietvertragPdf } from '@/utils/mietvertrag/mietvertragPdfGenerator';
import { hatBlocker, pruefeVertragsdaten, type Befund } from '@/utils/mietvertrag/pflichtpruefung';
import { AENDERUNGEN } from '@/utils/mietvertrag/wohnraumKlauseln';
import {
  VORLAGE_VERSION,
  type MietvertragDaten,
  type Uebergabezustand,
  type MietanpassungArt,
} from '@/utils/mietvertrag/typen';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vertragId: string;
}

export default function MietvertragErstellungModal({ isOpen, onClose, vertragId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const { data: geladen, isLoading, error } = useMietvertragPdfDaten(vertragId, isOpen);

  const [entwurf, setEntwurf] = useState<MietvertragDaten | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [erzeugtVorschau, setErzeugtVorschau] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (geladen) setEntwurf(geladen);
  }, [geladen]);

  const befunde: Befund[] = useMemo(
    () => (entwurf ? pruefeVertragsdaten(entwurf) : []),
    [entwurf]
  );
  const blockiert = hatBlocker(befunde);
  const blocker = befunde.filter(f => f.schwere === 'blocker');
  const warnungen = befunde.filter(f => f.schwere === 'warnung');

  const aendere = useCallback(<K extends keyof MietvertragDaten>(feld: K, wert: MietvertragDaten[K]) => {
    setEntwurf(v => (v ? { ...v, [feld]: wert } : v));
  }, []);

  const aendereMieter = useCallback((index: number, teil: Partial<MietvertragDaten['mieter'][number]>) => {
    setEntwurf(v =>
      v ? { ...v, mieter: v.mieter.map((m, i) => (i === index ? { ...m, ...teil } : m)) } : v
    );
  }, []);

  // ─── Vorschau ─────────────────────────────────────────────────────────────
  const vorschauErzeugen = useCallback(async (daten: MietvertragDaten) => {
    setErzeugtVorschau(true);
    try {
      const blob = await generateMietvertragPdf(daten);
      setPdfBlob(blob);
      setPdfBlobUrl(alt => {
        if (alt) URL.revokeObjectURL(alt);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      toast({
        title: 'Vorschau fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setErzeugtVorschau(false);
    }
  }, [toast]);

  // Abhängigkeiten bewusst auf die Felder, nicht auf die Funktion — sonst
  // löst der neue Blob-URL-State eine Endlosschleife aus.
  useEffect(() => {
    if (!isOpen || !entwurf || blockiert) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void vorschauErzeugen(entwurf), 500);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    blockiert,
    entwurf?.uebergabezustand,
    entwurf?.schoenheitsreparaturen,
    entwurf?.kleinreparaturEinzelgrenze,
    entwurf?.kleinreparaturJahresgrenzeProzent,
    entwurf?.mietanpassungArt,
    entwurf?.zusatzvereinbarungen,
    entwurf?.vertragsdatum,
    entwurf?.unterschriftOrt,
    entwurf?.anlagen,
    entwurf?.faelligkeitWerktag,
    entwurf?.kautionRaten,
    entwurf?.anzahlPersonen,
    entwurf?.einheit,
    entwurf?.mieter,
  ]);

  useEffect(() => () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
  }, [pdfBlobUrl]);

  // ─── Speichern ────────────────────────────────────────────────────────────
  async function speichern() {
    if (!entwurf || !pdfBlob) return;
    setSpeichert(true);
    try {
      const { data: user } = await supabase.auth.getUser();

      const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const name = entwurf.mieter
        .map(m => (m.istUnternehmen ? m.firmenname : m.nachname) ?? '')
        .join('_')
        .replace(/[^\w-]+/g, '_')
        .slice(0, 60);
      const dateiname = `Mietvertrag_${name || 'ohne_Name'}_${stempel}.pdf`;
      const pfad = `mietvertraege/${vertragId}/${dateiname}`;

      const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(pfad, bytes, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;

      const { error: dokError } = await supabase.from('dokumente').insert({
        titel: `Mietvertrag ${entwurf.einheit.bezeichnung}`,
        pfad,
        kategorie: 'Mietvertrag',
        dateityp: 'application/pdf',
        groesse_bytes: pdfBlob.size,
        mietvertrag_id: vertragId,
        immobilie_id: null,
        erstellt_von: user.user?.id ?? null,
        geloescht: false,
      });
      if (dokError) throw dokError;

      // Die im Dialog getroffenen Entscheidungen am Vertrag festhalten,
      // damit ein Nachdruck denselben Wortlaut ergibt.
      const { error: updateError } = await supabase
        .from('mietvertrag')
        .update({
          uebergabezustand: entwurf.uebergabezustand,
          schoenheitsreparaturen: entwurf.schoenheitsreparaturen,
          kleinreparatur_einzelgrenze: entwurf.kleinreparaturEinzelgrenze,
          kleinreparatur_jahresgrenze_prozent: entwurf.kleinreparaturJahresgrenzeProzent,
          mietanpassung_art: entwurf.mietanpassungArt,
          faelligkeit_werktag: entwurf.faelligkeitWerktag,
          kaution_raten: entwurf.kautionRaten,
          zusatzvereinbarungen: entwurf.zusatzvereinbarungen,
          vertrag_datum: entwurf.vertragsdatum,
          unterschrift_ort: entwurf.unterschriftOrt,
          vorlage_version: VORLAGE_VERSION,
          anzahl_personen: entwurf.anzahlPersonen || null,
          raumaufstellung: entwurf.einheit.raumaufstellung || null,
        })
        .eq('id', vertragId);
      if (updateError) throw updateError;

      // Stammdaten, die im Dialog ergänzt wurden, dorthin zurückschreiben,
      // wo sie hingehören — sonst müsste man sie beim nächsten Vertrag erneut
      // eintippen und die Daten liefen auseinander.
      if (geladen) {
        if (
          entwurf.einheit.bezeichnung !== geladen.einheit.bezeichnung ||
          entwurf.einheit.lage !== geladen.einheit.lage ||
          entwurf.einheit.wohnflaecheQm !== geladen.einheit.wohnflaecheQm
        ) {
          const { data: vertragRow } = await supabase
            .from('mietvertrag')
            .select('einheit_id')
            .eq('id', vertragId)
            .single();
          if (vertragRow?.einheit_id) {
            const { error: einheitError } = await supabase
              .from('einheiten')
              .update({
                bezeichnung: entwurf.einheit.bezeichnung || null,
                etage: entwurf.einheit.lage || null,
                qm: entwurf.einheit.wohnflaecheQm || null,
              })
              .eq('id', vertragRow.einheit_id);
            if (einheitError) throw einheitError;
          }
        }

        const { data: verknuepfungen } = await supabase
          .from('mietvertrag_mieter')
          .select('mieter_id, position')
          .eq('mietvertrag_id', vertragId)
          .order('position');

        for (const [i, m] of entwurf.mieter.entries()) {
          const alt = geladen.mieter[i];
          const geaendert =
            !alt ||
            m.strasse !== alt.strasse ||
            m.hausnummer !== alt.hausnummer ||
            m.plz !== alt.plz ||
            m.ort !== alt.ort;
          const mieterId = verknuepfungen?.[i]?.mieter_id;
          if (geaendert && mieterId) {
            const { error: mieterError } = await supabase
              .from('mieter')
              .update({
                strasse: m.strasse,
                hausnummer: m.hausnummer,
                plz: m.plz,
                ort: m.ort,
              })
              .eq('id', mieterId);
            if (mieterError) throw mieterError;
          }
        }
      }

      logActivity('mietvertrag_pdf_erzeugt', 'mietvertrag', vertragId, {
        datei: dateiname,
        vorlage: VORLAGE_VERSION,
      });

      queryClient.invalidateQueries({ queryKey: ['dokumente-detail', vertragId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-pdf-daten', vertragId] });

      toast({
        title: 'Mietvertrag gespeichert',
        description: `${dateiname} liegt jetzt in den Dokumenten des Vertrags.`,
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-[95vw] h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Mietvertrag erzeugen
          </DialogTitle>
          <DialogDescription>
            Vorlage {VORLAGE_VERSION} · {AENDERUNGEN.length} Klauseln wurden gegenüber der
            Word-Vorlage rechtlich überarbeitet. Vor dem Produktiveinsatz anwaltlich freigeben lassen.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Vertragsdaten werden geladen …</span>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center p-8">
            <Alert variant="destructive" className="max-w-lg">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Die Vertragsdaten konnten nicht geladen werden: {String(error)}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {entwurf && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(380px,32%)_1fr] overflow-hidden">
            {/* ── Formular ── */}
            <div className="overflow-y-auto border-r p-5 space-y-5">
              {blocker.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-2">
                      {blocker.length === 1
                        ? 'Eine Angabe fehlt noch:'
                        : `${blocker.length} Angaben fehlen noch:`}
                    </p>
                    <ul className="space-y-2">
                      {blocker.map((f, i) => (
                        <li key={i} className="text-xs">
                          <span className="block">{f.text}</span>
                          <span className="block opacity-80">→ {f.loesung}</span>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {warnungen.length > 0 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-2">Hinweise</p>
                    <ul className="space-y-2">
                      {warnungen.map((f, i) => (
                        <li key={i} className="text-xs">
                          <span className="block">{f.text}</span>
                          <span className="block opacity-80">→ {f.loesung}</span>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              {/* Stammdaten, die im Vertrag stehen müssen und oft noch fehlen.
                  Sie werden beim Speichern in Mieter, Einheit und Vertrag
                  zurückgeschrieben — damit sie beim nächsten Mal da sind. */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Angaben zur Mietsache</Label>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="einheit-bez">Einheitenbezeichnung</Label>
                    <Input
                      id="einheit-bez"
                      placeholder="WE 12"
                      value={entwurf.einheit.bezeichnung}
                      onChange={e =>
                        aendere('einheit', { ...entwurf.einheit, bezeichnung: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="einheit-qm">Wohnfläche (m²)</Label>
                    <Input
                      id="einheit-qm"
                      inputMode="decimal"
                      value={entwurf.einheit.wohnflaecheQm ? String(entwurf.einheit.wohnflaecheQm) : ''}
                      onChange={e =>
                        aendere('einheit', {
                          ...entwurf.einheit,
                          wohnflaecheQm: zahl(e.target.value, entwurf.einheit.wohnflaecheQm),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="einheit-lage">Lage im Gebäude</Label>
                  <Input
                    id="einheit-lage"
                    placeholder="Haus rechts, Dachgeschoss rechts"
                    value={entwurf.einheit.lage}
                    onChange={e => aendere('einheit', { ...entwurf.einheit, lage: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="raumaufstellung">Räume</Label>
                  <Input
                    id="raumaufstellung"
                    placeholder="3,5 Zimmer, 1 Küche, 1 Badezimmer, 1 Gäste-WC"
                    value={entwurf.einheit.raumaufstellung}
                    onChange={e =>
                      aendere('einheit', { ...entwurf.einheit, raumaufstellung: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personen">Anzahl Personen im Haushalt</Label>
                  <Input
                    id="personen"
                    inputMode="numeric"
                    value={entwurf.anzahlPersonen ? String(entwurf.anzahlPersonen) : ''}
                    onChange={e =>
                      aendere('anzahlPersonen', Math.round(zahl(e.target.value, entwurf.anzahlPersonen)))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Gehört zum Vertrag, nicht zur Einheit. Wird nicht geschätzt — ohne Angabe ist
                    der Personenschlüssel bei den Betriebskosten nicht vereinbarungsfähig.
                  </p>
                </div>
              </div>

              <Separator />

              {/* Mieteranschrift vor Einzug — steht im Vertragsrubrum */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">
                  Anschrift {entwurf.mieter.length > 1 ? 'der Mieter' : 'des Mieters'} vor Einzug
                </Label>
                {entwurf.mieter.map((m, i) => (
                  <div key={i} className="space-y-2 rounded border p-3">
                    <p className="text-xs font-medium">
                      {m.istUnternehmen ? m.firmenname : `${m.vorname} ${m.nachname}`.trim()}
                    </p>
                    <div className="grid grid-cols-[1fr_80px] gap-2">
                      <Input
                        placeholder="Straße"
                        value={m.strasse ?? ''}
                        onChange={e => aendereMieter(i, { strasse: e.target.value || null })}
                      />
                      <Input
                        placeholder="Nr."
                        value={m.hausnummer ?? ''}
                        onChange={e => aendereMieter(i, { hausnummer: e.target.value || null })}
                      />
                    </div>
                    <div className="grid grid-cols-[90px_1fr] gap-2">
                      <Input
                        placeholder="PLZ"
                        value={m.plz ?? ''}
                        onChange={e => aendereMieter(i, { plz: e.target.value || null })}
                      />
                      <Input
                        placeholder="Ort"
                        value={m.ort ?? ''}
                        onChange={e => aendereMieter(i, { ort: e.target.value || null })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Übergabezustand */}
              <div className="space-y-2">
                <Label>Zustand bei Übergabe</Label>
                <Select
                  value={entwurf.uebergabezustand}
                  onValueChange={(v: Uebergabezustand) => {
                    setEntwurf(e =>
                      e
                        ? {
                            ...e,
                            uebergabezustand: v,
                            // Bei nicht renovierter Übergabe darf keine
                            // Schönheitsreparaturklausel gedruckt werden.
                            schoenheitsreparaturen: v === 'renoviert' ? e.schoenheitsreparaturen : false,
                          }
                        : e
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="renoviert">renoviert</SelectItem>
                    <SelectItem value="teilrenoviert">teilrenoviert</SelectItem>
                    <SelectItem value="unrenoviert">unrenoviert</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="schoenheit"
                  checked={entwurf.schoenheitsreparaturen}
                  disabled={entwurf.uebergabezustand !== 'renoviert'}
                  onCheckedChange={c => aendere('schoenheitsreparaturen', c === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="schoenheit" className="leading-tight">
                    Schönheitsreparaturen auf den Mieter übertragen
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {entwurf.uebergabezustand === 'renoviert'
                      ? 'Zulässig, weil die Wohnung renoviert übergeben wird.'
                      : 'Nicht wählbar: Bei nicht renovierter Übergabe wäre die Klausel insgesamt unwirksam (BGH VIII ZR 185/14).'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Kleinreparaturen */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="klein-einzel">Kleinreparatur je Fall (€)</Label>
                  <Input
                    id="klein-einzel"
                    inputMode="decimal"
                    value={String(entwurf.kleinreparaturEinzelgrenze)}
                    onChange={e =>
                      aendere('kleinreparaturEinzelgrenze', zahl(e.target.value, entwurf.kleinreparaturEinzelgrenze))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="klein-jahr">Jahresgrenze (% der Jahresmiete)</Label>
                  <Input
                    id="klein-jahr"
                    inputMode="decimal"
                    value={String(entwurf.kleinreparaturJahresgrenzeProzent)}
                    onChange={e =>
                      aendere(
                        'kleinreparaturJahresgrenzeProzent',
                        zahl(e.target.value, entwurf.kleinreparaturJahresgrenzeProzent)
                      )
                    }
                  />
                </div>
              </div>

              {/* Mietanpassung */}
              <div className="space-y-2">
                <Label>Mietanpassung</Label>
                <Select
                  value={entwurf.mietanpassungArt}
                  onValueChange={(v: MietanpassungArt) => aendere('mietanpassungArt', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keine">gesetzlich (§ 558 BGB)</SelectItem>
                    <SelectItem value="staffel">Staffelmiete</SelectItem>
                    <SelectItem value="index">Indexmiete</SelectItem>
                  </SelectContent>
                </Select>
                {entwurf.mietanpassungArt !== 'keine' && (
                  <p className="text-xs text-muted-foreground">
                    Staffel- und Indexmiete schließen Mieterhöhungen nach § 558 BGB aus. Das
                    Mieterhöhungsmodul darf für diesen Vertrag dann nicht verwendet werden.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="faellig">Miete fällig am … Werktag</Label>
                  <Input
                    id="faellig"
                    inputMode="numeric"
                    value={String(entwurf.faelligkeitWerktag)}
                    onChange={e => aendere('faelligkeitWerktag', Math.round(zahl(e.target.value, 3)))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="raten">Kaution in … Raten</Label>
                  <Input
                    id="raten"
                    inputMode="numeric"
                    value={String(entwurf.kautionRaten)}
                    onChange={e => aendere('kautionRaten', Math.round(zahl(e.target.value, 3)))}
                  />
                </div>
              </div>

              <Separator />

              {/* Anlagen */}
              <div className="space-y-3">
                <Label>Anlagen</Label>
                {(
                  [
                    ['hausordnung', 'Hausordnung'],
                    ['betrkvKatalog', 'Betriebskostenkatalog'],
                    ['datenschutzhinweis', 'Datenschutzinformation (Art. 13 DSGVO)'],
                    ['widerrufsbelehrung', 'Widerrufsbelehrung'],
                    ['mietspiegelEinwilligung', 'Einwilligung Mietspiegel (freiwillig)'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`anlage-${key}`}
                      checked={entwurf.anlagen[key]}
                      onCheckedChange={c =>
                        aendere('anlagen', { ...entwurf.anlagen, [key]: c === true })
                      }
                    />
                    <Label htmlFor={`anlage-${key}`} className="text-sm font-normal">
                      {label}
                    </Label>
                  </div>
                ))}
                {entwurf.besichtigtAm && entwurf.anlagen.widerrufsbelehrung && (
                  <p className="text-xs text-muted-foreground">
                    Der Mieter hat die Wohnung am{' '}
                    {new Date(`${entwurf.besichtigtAm}T12:00:00`).toLocaleDateString('de-DE')}{' '}
                    besichtigt — damit besteht kein Widerrufsrecht (§ 312 Abs. 4 S. 2 BGB). Die
                    Belehrung wird nicht mitgedruckt.
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="zusatz">Individuelle Vereinbarungen (§ 26)</Label>
                <Textarea
                  id="zusatz"
                  rows={4}
                  placeholder="Eine Vereinbarung je Zeile"
                  value={entwurf.zusatzvereinbarungen ?? ''}
                  onChange={e => aendere('zusatzvereinbarungen', e.target.value || null)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ort">Ort der Unterzeichnung</Label>
                  <Input
                    id="ort"
                    value={entwurf.unterschriftOrt ?? ''}
                    onChange={e => aendere('unterschriftOrt', e.target.value || null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="datum">Vertragsdatum</Label>
                  <Input
                    id="datum"
                    type="date"
                    value={entwurf.vertragsdatum ?? ''}
                    onChange={e => aendere('vertragsdatum', e.target.value || null)}
                  />
                </div>
              </div>
            </div>

            {/* ── Vorschau ── */}
            <div className="flex flex-col bg-muted/30 overflow-hidden">
              <div className="flex-1 relative">
                {blockiert ? (
                  <div className="absolute inset-0 flex items-center justify-center p-8">
                    <div className="text-center max-w-md space-y-2">
                      <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="font-medium">Vorschau gesperrt</p>
                      <p className="text-sm text-muted-foreground">
                        Solange Pflichtangaben fehlen, wird kein Vertrag erzeugt. Ein Vertrag
                        darf nichts behaupten, was nicht erfasst ist.
                      </p>
                    </div>
                  </div>
                ) : pdfBlobUrl ? (
                  <iframe src={pdfBlobUrl} className="w-full h-full" title="Vertragsvorschau" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Vorschau wird erzeugt …</span>
                  </div>
                )}
                {erzeugtVorschau && pdfBlobUrl && (
                  <div className="absolute top-3 right-3 bg-background/90 rounded px-2 py-1 text-xs flex items-center gap-1.5 shadow">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    aktualisiert
                  </div>
                )}
              </div>

              <div className="border-t p-4 flex items-center justify-between gap-3 bg-background">
                <p className="text-xs text-muted-foreground">
                  Wird als PDF in den Dokumenten des Vertrags abgelegt.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose} disabled={speichert}>
                    Abbrechen
                  </Button>
                  <Button onClick={speichern} disabled={blockiert || !pdfBlob || speichert}>
                    {speichert ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Vertrag speichern
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Akzeptiert Dezimalkomma wie im restlichen Projekt. */
function zahl(eingabe: string, faellback: number): number {
  const n = Number(eingabe.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : faellback;
}
