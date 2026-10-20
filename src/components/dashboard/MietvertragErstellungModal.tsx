/**
 * Erzeugt den Mietvertrag als PDF — Formular links, Live-Vorschau rechts.
 *
 * Das Muster folgt `MahnungErstellungModal`. Der E-Mail-Schritt entfällt: Ein
 * Mietvertrag wird nicht versendet, er wird ausgedruckt, unterschrieben und
 * als unterschriebene Fassung wieder hochgeladen.
 *
 * Die Formularabschnitte teilt sich der Dialog mit dem Vertragsentwurf
 * (`mietvertrag-formular/`); neue Verträge entstehen seit 18.10.2026 dort.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Loader2, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useActivityLog } from '@/hooks/useActivityLog';
import { useMietvertragPdfDaten } from '@/hooks/useMietvertragPdfDaten';
import { supabase } from '@/integrations/supabase/client';
import { hatBlocker, pruefeVertragsdaten, type Befund } from '@/utils/mietvertrag/pflichtpruefung';
import VermieterStammdatenDialog from '@/components/dashboard/VermieterStammdatenDialog';
import { AENDERUNGEN } from '@/utils/mietvertrag/wohnraumKlauseln';
import { VORLAGE_VERSION, type MietvertragDaten } from '@/utils/mietvertrag/typen';
import { schriftstueckPfad } from '@/utils/storagePfad';
import { useVertragsvorschau } from '@/hooks/useVertragsvorschau';
import { PruefungsHinweise, VertragsVorschau } from './mietvertrag-formular/Bausteine';
import {
  BetriebskostenEditor,
  KlauselFelder,
  MieteranschriftFelder,
  MietsacheFelder,
  ObjektAngabenFelder,
} from './mietvertrag-formular/Abschnitte';

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

  const [entwurf, setEntwurfRoh] = useState<MietvertragDaten | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [zeigeVermieter, setZeigeVermieter] = useState(false);

  useEffect(() => {
    if (geladen) setEntwurfRoh(geladen);
  }, [geladen]);

  const setEntwurf = (aenderung: (d: MietvertragDaten) => MietvertragDaten) =>
    setEntwurfRoh(d => (d ? aenderung(d) : d));

  const befunde: Befund[] = useMemo(() => (entwurf ? pruefeVertragsdaten(entwurf) : []), [entwurf]);
  const blockiert = hatBlocker(befunde);
  const { pdfBlob, pdfUrl, erzeugt, aktuell } = useVertragsvorschau(entwurf, isOpen, blockiert);

  // ─── Speichern ────────────────────────────────────────────────────────────
  async function speichern() {
    if (!entwurf || !pdfBlob) return;
    setSpeichert(true);
    try {
      const { data: user } = await supabase.auth.getUser();

      // Pfad nie aus Namen bauen: Umlaute lässt der Storage nicht zu (storagePfad.ts)
      const pfad = schriftstueckPfad('mietvertraege', vertragId, 'Mietvertrag', new Date());
      const dateiname = pfad.split('/').pop()!;

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
          staffelplan: entwurf.staffelplan?.map(s => ({ gueltig_ab: s.gueltigAb, kaltmiete: s.kaltmiete })) ?? null,
          index_basis_wert: entwurf.indexBasisWert,
          index_basis_monat: entwurf.indexBasisMonat,
          faelligkeit_werktag: entwurf.faelligkeitWerktag,
          kaution_raten: entwurf.kautionRaten,
          zusatzvereinbarungen: entwurf.zusatzvereinbarungen,
          vertrag_datum: entwurf.vertragsdatum,
          unterschrift_ort: entwurf.unterschriftOrt,
          vorlage_version: VORLAGE_VERSION,
          anzahl_personen: entwurf.anzahlPersonen || null,
          raumaufstellung: entwurf.einheit.raumaufstellung || null,
          schliessanlage_art: entwurf.schliessanlageArt,
          mitbenutzung_einrichtungen: entwurf.mitbenutzungEinrichtungen?.trim() || null,
          // Schnappschuss der Kostenaufstellung: Ein Nachdruck muss dieselbe
          // Spalte ergeben, auch wenn die Kostenarten der Immobilie später
          // geändert werden.
          betriebskosten_positionen: entwurf.betriebskostenPositionen.map(pos => ({
            nummer: pos.nummer,
            bezeichnung: pos.bezeichnung,
            schluessel: pos.schluessel,
            umgelegt: pos.umgelegt,
            betrag: pos.betrag,
          })),
        })
        .eq('id', vertragId);
      if (updateError) throw updateError;

      // Stammdaten, die im Dialog ergänzt wurden, dorthin zurückschreiben,
      // wo sie hingehören — sonst müsste man sie beim nächsten Vertrag erneut
      // eintippen und die Daten liefen auseinander.
      if (geladen) {
        const { data: vertragRow } = await supabase
          .from('mietvertrag')
          .select('einheit_id, einheit:einheit_id (immobilie_id)')
          .eq('id', vertragId)
          .single();

        if (
          vertragRow?.einheit_id &&
          (entwurf.einheit.bezeichnung !== geladen.einheit.bezeichnung ||
            entwurf.einheit.lage !== geladen.einheit.lage ||
            entwurf.einheit.wohnflaecheQm !== geladen.einheit.wohnflaecheQm ||
            (entwurf.einheit.nebenraeume ?? '') !== (geladen.einheit.nebenraeume ?? '') ||
            entwurf.einheit.einbaukueche !== geladen.einheit.einbaukueche)
        ) {
          const { error: einheitError } = await supabase
            .from('einheiten')
            .update({
              bezeichnung: entwurf.einheit.bezeichnung || null,
              etage: entwurf.einheit.lage || null,
              qm: entwurf.einheit.wohnflaecheQm || null,
              nebenraeume: entwurf.einheit.nebenraeume?.trim() || null,
              einbaukueche: entwurf.einheit.einbaukueche,
            })
            .eq('id', vertragRow.einheit_id);
          if (einheitError) throw einheitError;
        }

        // Heizung, Warmwasser und Gesamtfläche gelten für das ganze Haus
        const immobilieId = vertragRow?.einheit?.immobilie_id;
        if (
          immobilieId &&
          (entwurf.objekt.heizungsart !== geladen.objekt.heizungsart ||
            entwurf.objekt.warmwasser !== geladen.objekt.warmwasser ||
            entwurf.objekt.heizkostenSchluessel !== geladen.objekt.heizkostenSchluessel ||
            entwurf.objekt.gesamtwohnflaecheQm !== geladen.objekt.gesamtwohnflaecheQm)
        ) {
          const { error: objektError } = await supabase
            .from('immobilien')
            .update({
              heizungsart: entwurf.objekt.heizungsart,
              warmwasser: entwurf.objekt.warmwasser,
              heizkosten_schluessel: entwurf.objekt.heizkostenSchluessel,
              gesamtwohnflaeche: entwurf.objekt.gesamtwohnflaecheQm,
            })
            .eq('id', immobilieId);
          if (objektError) throw objektError;
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
    <>
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
              <PruefungsHinweise befunde={befunde} onVermieterOeffnen={() => setZeigeVermieter(true)} />

              <Separator />
              {/* Stammdaten, die im Vertrag stehen müssen und oft noch fehlen.
                  Sie werden beim Speichern in Mieter, Einheit, Objekt und
                  Vertrag zurückgeschrieben — damit sie beim nächsten Mal da sind. */}
              <MietsacheFelder entwurf={entwurf} setEntwurf={setEntwurf} />
              <Separator />
              <ObjektAngabenFelder entwurf={entwurf} setEntwurf={setEntwurf} />
              <Separator />
              <BetriebskostenEditor entwurf={entwurf} setEntwurf={setEntwurf} />
              <Separator />
              <MieteranschriftFelder entwurf={entwurf} setEntwurf={setEntwurf} />
              <Separator />
              <KlauselFelder entwurf={entwurf} setEntwurf={setEntwurf} />
            </div>

            {/* ── Vorschau ── */}
            <div className="flex flex-col bg-muted/30 overflow-hidden">
              <VertragsVorschau gesperrt={blockiert} pdfUrl={pdfUrl} erzeugt={erzeugt} />

              <div className="border-t p-4 flex items-center justify-between gap-3 bg-background">
                <p className="text-xs text-muted-foreground">
                  Wird als PDF in den Dokumenten des Vertrags abgelegt.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose} disabled={speichert}>
                    Abbrechen
                  </Button>
                  <Button onClick={speichern} disabled={blockiert || !aktuell || speichert}>
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

      {/* Bewusst neben dem Vertragsdialog, nicht darin: Radix soll zwei
          eigenständige Ebenen verwalten, sonst schließt das Speichern der
          Stammdaten auch den Vertrag. */}
      <VermieterStammdatenDialog
        isOpen={zeigeVermieter}
        onClose={() => setZeigeVermieter(false)}
        onGespeichert={() => setZeigeVermieter(false)}
      />
    </>
  );
}
