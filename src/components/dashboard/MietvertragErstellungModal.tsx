/**
 * Erzeugt den Mietvertrag als PDF — Formular links, Live-Vorschau rechts.
 *
 * Das Muster folgt `MahnungErstellungModal`. Der E-Mail-Schritt entfällt: Ein
 * Mietvertrag wird nicht versendet, er wird ausgedruckt, unterschrieben und
 * als unterschriebene Fassung wieder hochgeladen.
 *
 * Seit dem 11.11.2026 der einzige Weg zum Mietvertrag als PDF: Die Vermietung schließt ohne ihn ab (Nutzer: „die
 * Erstellung des Mietvertrags ist optional und kann jederzeit nachträglich erzeugt werden“), und er entsteht hier am
 * laufenden Vertrag — von der Einheit aus oder in den Vertragsdetails. Deshalb jetzt auch mit Schlüsseln und
 * Besichtigung und auf dem Handy bedienbar (wie der Vermietungsdialog seit dem 10.11.2026).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, FileText, Loader2, Save } from 'lucide-react';

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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useVermieterUnterzeichnerVorschlag } from '@/hooks/useVermieterUnterzeichnerVorschlag';
import { useMietvertragPdfDaten } from '@/hooks/useMietvertragPdfDaten';
import { supabase } from '@/integrations/supabase/client';
import { hatBlocker, pruefeVertragsdaten, type Befund } from '@/utils/mietvertrag/pflichtpruefung';
import VermieterStammdatenDialog from '@/components/dashboard/VermieterStammdatenDialog';
import { AENDERUNGEN } from '@/utils/mietvertrag/wohnraumKlauseln';
import { schluesselFuerDb } from '@/utils/mietvertrag/entwurf';
import { vertragsTitel } from '@/utils/mietvertrag/fassungen';
import { brauchtUnterzeichnerWahl, gewaehlterUnterzeichner } from '@/utils/mietvertrag/vertretung';
import { positionFuerDb, VORLAGE_VERSION, type MietvertragDaten } from '@/utils/mietvertrag/typen';
import { schriftstueckPfad } from '@/utils/storagePfad';
import { useVertragsvorschau } from '@/hooks/useVertragsvorschau';
import { PruefungsHinweise, UngueltigeZahlFelder, VertragsVorschau } from './mietvertrag-formular/Bausteine';
import {
  BetriebskostenEditor,
  KlauselFelder,
  MieteranschriftFelder,
  MietsacheFelder,
  MindestmietdauerFelder,
  ObjektAngabenFelder,
  SchluesselFelder,
} from './mietvertrag-formular/Abschnitte';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vertragId: string;
  /**
   * Vertrag, zu dem noch keine unterschriebene Fassung vorliegt (seit 11.11.2026): Dann unterschreibt in der Regel, wer
   * ihn anlegt — vorbelegt wie früher im Vermietungsablauf. Für einen schon unterschriebenen Vertrag bleibt die Wahl
   * offen: Wer damals unterschrieben hat, steht nicht am Vertrag.
   */
  ersteFassung?: boolean;
}

export default function MietvertragErstellungModal({ isOpen, onClose, vertragId, ersteFassung = false }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();
  const { data: geladen, isFetching, error } = useMietvertragPdfDaten(vertragId, isOpen);

  const [entwurf, setEntwurfRoh] = useState<MietvertragDaten | null>(null);
  const [speichert, setSpeichert] = useState(false);
  // Sperrt sofort, nicht erst nach dem nächsten Rendern: Ein Doppelklick legte zwei Verträge an (Besprechung 12.11.2026)
  const speichertGerade = useRef(false);
  const [zeigeVermieter, setZeigeVermieter] = useState(false);

  // Je Öffnen einmal übernehmen, und zwar den frisch geladenen Stand. Bis zum 11.11.2026 setzte jedes Neuladen den
  // ganzen Entwurf zurück — etwa nach „PDF ansehen“ im neuen Tab (Fenster wieder im Vordergrund): Eingaben waren weg
  // (Review 11.11.2026). Später nachgeladen werden nur die Vermieter-Stammdaten, die man hier ergänzen kann.
  const uebernommen = useRef(false);
  useEffect(() => {
    if (!isOpen) uebernommen.current = false;
  }, [isOpen]);
  useEffect(() => {
    if (!geladen || isFetching) return;
    if (!uebernommen.current) {
      uebernommen.current = true;
      setEntwurfRoh(geladen);
      return;
    }
    setEntwurfRoh(d => (d ? { ...d, vermieter: geladen.vermieter } : geladen));
  }, [geladen, isFetching]);

  const setEntwurf = (aenderung: (d: MietvertragDaten) => MietvertragDaten) =>
    setEntwurfRoh(d => (d ? aenderung(d) : d));

  // Wer für den Vermieter unterschrieben hat, steht nicht am Vertrag — beim Nachdruck wird bewusst
  // gewählt statt mit dem Angemeldeten vorbelegt, sonst stünde womöglich der Falsche darin (Review 03.11.2026).
  // Bei der ersten Fassung unterschreibt in der Regel, wer sie anlegt (Kundenwunsch 03.11.2026).
  const unterzeichner = useVermieterUnterzeichnerVorschlag(ersteFassung ? entwurf?.vermieter.vertretenDurch : null);
  const unterzeichnerVorbelegt = useRef(false);
  useEffect(() => {
    if (!isOpen) unterzeichnerVorbelegt.current = false;
  }, [isOpen]);
  useEffect(() => {
    if (!ersteFassung || !entwurf || !unterzeichner.bereit || unterzeichnerVorbelegt.current) return;
    unterzeichnerVorbelegt.current = true;
    if (!unterzeichner.vorschlag || !brauchtUnterzeichnerWahl(entwurf.vermieter) || gewaehlterUnterzeichner(entwurf)) return;
    const vorschlag = unterzeichner.vorschlag;
    setEntwurfRoh(d => (d ? { ...d, unterzeichnerVermieter: vorschlag } : d));
  }, [ersteFassung, entwurf, unterzeichner.bereit, unterzeichner.vorschlag]);

  const befunde: Befund[] = useMemo(() => (entwurf ? pruefeVertragsdaten(entwurf) : []), [entwurf]);
  const blockiert = hatBlocker(befunde);
  // Ungültige Eurobeträge (z. B. „1.200“) sperren das Speichern (28.10.2026) — das Feld gibt
  // dann null weiter, und gespeichert würde eine leere Position
  const [ungueltigeZahlen, setUngueltigeZahlen] = useState<ReadonlySet<string>>(new Set());
  const meldeUngueltigeZahl = useCallback((schluessel: string, ungueltig: boolean) => {
    setUngueltigeZahlen(alt => {
      if (alt.has(schluessel) === ungueltig) return alt;
      const neu = new Set(alt);
      if (ungueltig) neu.add(schluessel);
      else neu.delete(schluessel);
      return neu;
    });
  }, []);
  const zahlFehler = ungueltigeZahlen.size > 0;
  const { pdfBlob, pdfUrl, erzeugt, aktuell, fehlgeschlagen } = useVertragsvorschau(entwurf, isOpen, blockiert);
  // Die Vorschau-Spalte gibt es erst ab lg. Darunter kein verstecktes iframe — es lüde das PDF trotzdem (Handy)
  const mitVorschauSpalte = useMediaQuery('(min-width: 1024px)');

  /** Handy und Tablet: Der Browser öffnet das PDF selbst. */
  function pdfAnsehen() {
    if (aktuell && pdfBlob) {
      // Eigene Adresse, synchron im Klick — sonst blockt der Browser den Tab
      const adresse = URL.createObjectURL(pdfBlob);
      window.open(adresse, '_blank');
      setTimeout(() => URL.revokeObjectURL(adresse), 5 * 60_000);
      return;
    }
    toast({
      title: 'Noch keine Vorschau',
      description: blockiert
        ? 'Für das PDF fehlen Pflichtangaben — sie stehen oben im Formular.'
        : fehlgeschlagen
          ? 'Die Vorschau ließ sich nicht erzeugen. Bitte eine Angabe ändern oder neu öffnen.'
          : 'Die Vorschau wird gerade erzeugt. Bitte gleich noch einmal tippen.',
    });
  }

  // ─── Speichern ────────────────────────────────────────────────────────────
  async function speichern() {
    if (!entwurf || !pdfBlob || zahlFehler || speichertGerade.current) return;
    speichertGerade.current = true;
    setSpeichert(true);
    try {
      const { data: user } = await supabase.auth.getUser();

      // Pfad nie aus Namen bauen: Umlaute lässt der Storage nicht zu (storagePfad.ts) — der Titel trägt die Namen
      const jetzt = new Date();
      const pfad = schriftstueckPfad('mietvertraege', vertragId, 'Mietvertrag', jetzt);
      const titel = vertragsTitel(
        {
          mieter: entwurf.mieter.map(m => (m.istUnternehmen && m.firmenname?.trim()) || m.nachname),
          adresse: `${entwurf.objekt.strasse} ${entwurf.objekt.hausnummer}`,
          lage: entwurf.einheit.lage || entwurf.einheit.bezeichnung,
        },
        { art: 'erstellt', zeitpunkt: jetzt }
      );

      const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from('dokumente')
        .upload(pfad, bytes, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;

      const { error: dokError } = await supabase.from('dokumente').insert({
        titel,
        pfad,
        kategorie: 'Mietvertrag',
        dateityp: 'application/pdf',
        groesse_bytes: pdfBlob.size,
        mietvertrag_id: vertragId,
        immobilie_id: null,
        erstellt_von: user.user?.id ?? null,
        geloescht: false,
      });
      if (dokError) {
        // Ohne Zeile in `dokumente` wäre die Datei unsichtbar
        await supabase.storage.from('dokumente').remove([pfad]);
        throw dokError;
      }

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
          // Seit 11.11.2026 hier erfassbar: Schlüssel und Besichtigung (Widerrufsbelehrung) — sonst druckte der
          // Nachdruck wieder die alten
          schluessel: schluesselFuerDb(entwurf.schluessel),
          besichtigt_am: entwurf.besichtigtAm,
          // Mindestmietdauer (§ 2 Ziff. 3) — „“ (angehakt ohne Datum) sperrt die Pflichtprüfung vorher
          kuendigungsverzicht_bis: entwurf.kuendigungsverzichtBis || null,
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
          betriebskosten_positionen: entwurf.betriebskostenPositionen.map(positionFuerDb),
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
            m.ort !== alt.ort ||
            (m.ausweisnummer ?? null) !== (alt.ausweisnummer ?? null);
          const mieterId = verknuepfungen?.[i]?.mieter_id;
          if (geaendert && mieterId) {
            const { error: mieterError } = await supabase
              .from('mieter')
              .update({
                strasse: m.strasse,
                hausnummer: m.hausnummer,
                plz: m.plz,
                ort: m.ort,
                // Besprechung 12.11.2026 — Firmen haben keine
                ausweisnummer: m.istUnternehmen ? null : m.ausweisnummer?.trim() || null,
              })
              .eq('id', mieterId);
            if (mieterError) throw mieterError;
          }
        }
      }

      logActivity('mietvertrag_pdf_erzeugt', 'mietvertrag', vertragId, {
        datei: pfad.split("/").pop(),
        vorlage: VORLAGE_VERSION,
      });

      // Präfix: auch der Stand des Mietvertrags an Einheit und Vertragsansicht (useMietvertragFassungen)
      queryClient.invalidateQueries({ queryKey: ['dokumente-detail', vertragId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
      queryClient.invalidateQueries({ queryKey: ['mietvertrag-pdf-daten', vertragId] });

      toast({
        title: 'Mietvertrag gespeichert',
        description: `„${titel}“ liegt jetzt in den Dokumenten des Vertrags.`,
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Speichern fehlgeschlagen',
        description: e instanceof Error ? e.message : 'Unbekannter Fehler',
        variant: 'destructive',
      });
    } finally {
      speichertGerade.current = false;
      setSpeichert(false);
    }
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
      {/* Handy: ganzer Bildschirm, Höhe in dvh — mit vh verdeckte die Browserleiste die Fußleiste (wie der Vermietungsdialog) */}
      <DialogContent className="flex h-[100dvh] max-w-full flex-col gap-0 border-0 p-0 sm:h-[92vh] sm:max-w-[95vw] sm:border">
        <DialogHeader className="border-b py-3 pl-4 pr-12 text-left sm:px-6 sm:py-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 shrink-0" />
            Mietvertrag erstellen
          </DialogTitle>
          <DialogDescription>
            Optional — das Mietverhältnis läuft auch ohne.{' '}
            <span className="hidden sm:inline">
              Vorlage {VORLAGE_VERSION} · {AENDERUNGEN.length} Klauseln wurden gegenüber der Word-Vorlage rechtlich
              überarbeitet. Vor dem Produktiveinsatz anwaltlich freigeben lassen.
            </span>
          </DialogDescription>
        </DialogHeader>

        {!entwurf && !error && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Vertragsdaten werden geladen …</span>
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center p-8">
            <Alert variant="destructive" className="max-w-lg">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Die Vertragsdaten konnten nicht geladen werden: {String(error)}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {entwurf && (
          <>
            <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(380px,32%)_1fr]">
              {/* ── Formular ── */}
              <UngueltigeZahlFelder.Provider value={meldeUngueltigeZahl}>
                <div className="space-y-5 overflow-y-auto p-4 sm:p-5 lg:border-r">
                  <PruefungsHinweise befunde={befunde} onVermieterOeffnen={() => setZeigeVermieter(true)} />

                  <Separator />
                  {/* Stammdaten, die im Vertrag stehen müssen und oft noch fehlen.
                      Sie werden beim Speichern in Mieter, Einheit, Objekt und
                      Vertrag zurückgeschrieben — damit sie beim nächsten Mal da sind. */}
                  <MietsacheFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                  <SchluesselFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                  <Separator />
                  <ObjektAngabenFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                  <Separator />
                  <BetriebskostenEditor entwurf={entwurf} setEntwurf={setEntwurf} />
                  <Separator />
                  <MieteranschriftFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                  <Separator />
                  {/* § 2 — seit 12.11.2026 auch hier (Besprechung: „Auswahl Mindestmietdauer: 1 Jahr“) */}
                  <MindestmietdauerFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                  <Separator />
                  <KlauselFelder entwurf={entwurf} setEntwurf={setEntwurf} />
                </div>
              </UngueltigeZahlFelder.Provider>

              {/* ── Vorschau (ab lg) ── */}
              <div className="hidden flex-col overflow-hidden bg-muted/30 lg:flex">
                {mitVorschauSpalte && <VertragsVorschau gesperrt={blockiert} pdfUrl={pdfUrl} erzeugt={erzeugt} />}
              </div>
            </div>

            {/* ── Fußleiste ── */}
            <div className="flex flex-col-reverse gap-2 border-t bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:pb-3">
              <p className={zahlFehler ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {zahlFehler
                  ? 'Ein Betrag ist nicht lesbar (rot markiert), z. B. „1.200“ – bitte ohne Tausenderpunkt eingeben.'
                  : 'Wird als PDF in den Dokumenten des Vertrags abgelegt.'}
              </p>
              <div className="flex flex-wrap gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                {/* Nicht gesperrt: Ein ausgegrauter Knopf zeigt auf dem Handy keinen Grund — die Meldung schon */}
                <Button variant="outline" className="lg:hidden" onClick={pdfAnsehen}>
                  <Eye className="h-4 w-4" />
                  PDF ansehen
                </Button>
                <Button variant="outline" onClick={onClose} disabled={speichert}>
                  Abbrechen
                </Button>
                <Button onClick={speichern} disabled={blockiert || zahlFehler || !aktuell || speichert}>
                  {speichert ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Vertrag speichern
                </Button>
              </div>
            </div>
          </>
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
