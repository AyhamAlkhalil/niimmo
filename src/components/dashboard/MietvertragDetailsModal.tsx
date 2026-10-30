import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, AlertCircle } from "lucide-react";
import { CreateForderungModal } from "./CreateForderungModal";
import { MietvertragOverviewTab } from "./mietvertrag-details/MietvertragOverviewTab";
import { MietvertragDocumentsTab } from "./mietvertrag-details/MietvertragDocumentsTab";
import { TerminationDialog } from "./termination/TerminationDialog";
import { KuendigungsbestaetigungDialog } from "./termination/KuendigungsbestaetigungDialog";
import { MahnungErstellungModal } from "./MahnungErstellungModal";
import MietvertragErstellungModal from "./MietvertragErstellungModal";
import { useMietvertragData } from "@/hooks/useMietvertragData";
import { useToast } from "@/hooks/use-toast";
import { useMietvertragMutations } from "@/hooks/useMietvertragMutations";
import { berechneMietkontostand, nurFaelligeForderungen } from "@/utils/rueckstandsberechnung";
import { offenePosten } from "@/utils/rueckstandSeit";
import { offizielleErhoehungGiltAbText } from "@/utils/mieterhoehungRegeln";
import { getVertragsende } from "@/utils/contractUtils";

interface MietvertragDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vertragId: string;
  einheit?: any;
  immobilie?: any;
}

export default function MietvertragDetailsModal({ 
  isOpen, 
  onClose, 
  vertragId, 
  einheit, 
  immobilie
}: MietvertragDetailsModalProps) {
  // Data fetching + realtime
  const {
    vertrag, vertragLoading, fetchedEinheit,
    mieter, zahlungen, allMietvertraege, forderungen, dokumente,
    dokumenteLoading, dokumenteFehler, dokumenteLaedtNeu, refetchDokumente,
    finanzFehler, finanzLaedt, queryClient,
  } = useMietvertragData(vertragId, isOpen);
  const { toast } = useToast();

  const einheitData = fetchedEinheit || einheit;
  const [showVertragPdfModal, setShowVertragPdfModal] = useState(false);
  const [showBestaetigung, setShowBestaetigung] = useState(false);
  const [bestaetigungVorbelegung, setBestaetigungVorbelegung] = useState<{ schreibenVom: string | null; eingangAm: string | null } | null>(null);

  // All editing state + mutations
  const mutations = useMietvertragMutations({ vertragId, vertrag, einheitData, mieter });

  // Utility functions
  const formatDatum = (datum: string) => {
    return new Date(datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatBetrag = (betrag: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(betrag);
  };

  // Loading state
  if (vertragLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Lade Mietvertragsdaten...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Not found state
  if (!vertrag) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <div className="text-center p-8">
            <AlertCircle className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Mietvertrag nicht gefunden</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Gleiche Rechnung wie die Rueckstandsliste. Die eigene Formel bis zum 07.10.2026
  // liess bezahlte Betriebskosten-Nachzahlungen weg (docs/offene-punkte.md C5); bis zum
  // 27.10.2026 zaehlten auch noch nicht faellige Forderungen mit -- vom 1. bis 7. war
  // der Mahnbetrag um die laufende Monatsmiete zu hoch.
  const mahnRueckstand = Math.max(0, berechneMietkontostand(vertrag, forderungen || [], zahlungen || []).rueckstand);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[95vh] h-[95vh] md:h-auto overflow-hidden flex flex-col p-4 md:p-6">
        <DialogHeader className="flex-shrink-0 border-b border-border/70 pb-4 md:pb-5">
          <div className="flex flex-wrap items-start gap-3 justify-between pr-9">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center border border-border/80 bg-muted/60 sm:flex">
                <Building2 className="h-5 w-5 text-foreground/70" />
              </div>
              <div className="min-w-0">
                <p className="eyebrow">Mietvertrag</p>
                <DialogTitle className="mt-1 truncate py-0.5 text-2xl leading-tight md:text-3xl">
                  <span className="sr-only">Mietvertrag: </span>
                  {immobilie?.name ?? "Mietvertrag"}
                </DialogTitle>
                {(immobilie || einheitData) && (
                  <p className="mt-1.5 truncate text-sm text-muted-foreground">
                    {immobilie?.adresse ?? ''}{einheitData ? `${immobilie?.adresse ? ' · ' : ''}Einheit ${einheitData.zaehler ? String(einheitData.zaehler).padStart(2, '0') : (einheitData.id ? einheitData.id.slice(-2) : '')} · ${einheitData.einheitentyp || ''}${einheitData.etage ? ` ${einheitData.etage}` : ''}` : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              {!mutations.isGlobalEditMode ? (
                <Button onClick={mutations.handleStartGlobalEdit} variant="outline" size="sm">
                  Bearbeiten
                </Button>
              ) : (
                <>
                  <Button onClick={mutations.handleSaveGlobalEdit} size="sm">
                    Speichern
                  </Button>
                  <Button onClick={mutations.handleCancelGlobalEdit} variant="outline" size="sm">
                    Abbrechen
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-4 md:-mx-6 px-4 md:px-6">
          <Tabs defaultValue="uebersicht" className="space-y-2 md:space-y-4">
            <TabsList className="sticky top-0 z-10 grid w-full grid-cols-2 bg-card">
              <TabsTrigger value="uebersicht" className="text-xs md:text-sm">Übersicht</TabsTrigger>
              <TabsTrigger value="dokumente" className="text-xs md:text-sm">Dokumente</TabsTrigger>
            </TabsList>

            <TabsContent value="uebersicht" className="space-y-4">
              <MietvertragOverviewTab
                vertrag={vertrag}
                mieter={mieter || []}
                forderungen={forderungen || []}
                zahlungen={zahlungen || []}
                immobilie={immobilie}
                einheit={einheitData}
                isGlobalEditMode={mutations.isGlobalEditMode}
                editedValues={mutations.editedValues}
                onUpdateEditedValue={mutations.handleUpdateEditedValue}
                editingMietvertrag={mutations.editingMietvertrag}
                editingKaution={mutations.editingKaution}
                onEditMietvertrag={mutations.handleEditMietvertrag}
                onStartEdit={(field) => mutations.setEditingMietvertrag(field)}
                onCancelEdit={() => mutations.setEditingMietvertrag(null)}
                onEditKaution={mutations.handleEditKaution}
                onStartEditKaution={mutations.setEditingKaution}
                onCancelEditKaution={() => mutations.setEditingKaution(null)}
                editingMeter={mutations.editingMeter}
                editingMeterNumber={mutations.editingMeterNumber}
                onEditMeter={mutations.handleEditMeter}
                onStartEditMeter={mutations.setEditingMeter}
                onCancelEditMeter={() => mutations.setEditingMeter(null)}
                onEditMeterNumber={mutations.handleEditMeterNumber}
                onStartEditMeterNumber={mutations.setEditingMeterNumber}
                onCancelEditMeterNumber={() => mutations.setEditingMeterNumber(null)}
                onCreateForderung={() => mutations.setShowCreateForderungModal(true)}
                onContractUpdate={() => {
                  queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
                }}
                onShowMahnung={() => {
                  // Ohne geladene Zahlungen und Forderungen wäre der vorbelegte Mahnbetrag falsch
                  if (finanzFehler) {
                    toast({ title: "Mahnung nicht möglich", description: "Zahlungen oder Forderungen konnten nicht geladen werden. Bitte das Fenster neu öffnen.", variant: "destructive" });
                    return;
                  }
                  // Der Mahnbetrag wird beim Öffnen übernommen; mit halb geladenen Daten wäre er falsch
                  if (finanzLaedt) {
                    toast({ title: "Daten werden noch geladen", description: "Zahlungen und Forderungen sind noch nicht vollständig geladen. Bitte gleich noch einmal versuchen." });
                    return;
                  }
                  mutations.setShowMahnungModal(true);
                }}
                finanzFehler={finanzFehler}
                finanzLaedt={finanzLaedt}
                onShowKuendigung={() => mutations.setShowTerminationDialog(true)}
                onShowKuendigungsbestaetigung={() => { setBestaetigungVorbelegung(null); setShowBestaetigung(true); }}
                onShowVertragPdf={() => setShowVertragPdfModal(true)}
                allMietvertraege={allMietvertraege}
                vertragId={vertragId}
                formatDatum={formatDatum}
                formatBetrag={formatBetrag}
              />
            </TabsContent>

            <TabsContent value="dokumente" className="space-y-4">
              <MietvertragDocumentsTab
                dokumente={dokumente}
                isLoading={dokumenteLoading}
                ladeFehler={dokumenteFehler}
                laedtNeu={dokumenteLaedtNeu}
                onErneutLaden={() => { void refetchDokumente(); }}
                formatDatum={formatDatum}
                mietvertragId={vertragId}
                onDocumentsChange={() => {
                  queryClient.invalidateQueries({ queryKey: ['dokumente-detail', vertragId] });
                }}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Create Forderung Modal */}
        <CreateForderungModal
          isOpen={mutations.showCreateForderungModal}
          onClose={() => mutations.setShowCreateForderungModal(false)}
          mietvertragId={vertragId}
          currentKaltmiete={Number(vertrag?.kaltmiete || 0)}
          currentBetriebskosten={Number(vertrag?.betriebskosten || 0)}
        />

        {/* Termination Dialog */}
        <TerminationDialog
          isOpen={mutations.showTerminationDialog}
          onClose={() => mutations.setShowTerminationDialog(false)}
          vertragId={vertragId}
          einheit={einheitData}
          immobilie={immobilie}
          onTerminationSuccess={mutations.handleTerminationSuccess}
          onUploadErfolg={(angaben) => { setBestaetigungVorbelegung(angaben); setShowBestaetigung(true); }}
        />

        <KuendigungsbestaetigungDialog
          isOpen={showBestaetigung}
          onClose={() => setShowBestaetigung(false)}
          vertragId={vertragId}
          vorbelegung={bestaetigungVorbelegung}
          onGespeichert={() => {
            queryClient.invalidateQueries({ queryKey: ['dokumente-detail', vertragId] });
          }}
        />

        {/* Mietvertrag als PDF erzeugen */}
        <MietvertragErstellungModal
          isOpen={showVertragPdfModal}
          onClose={() => setShowVertragPdfModal(false)}
          vertragId={vertragId}
        />

        {/* Mahnung Modal */}
        <MahnungErstellungModal
          isOpen={mutations.showMahnungModal}
          onClose={() => {
            mutations.setShowMahnungModal(false);
            Promise.all([
              // Objektansicht: Einheitskarten (Präfix) und Objektkopf — 'immobilie-detail' gab es nie (28.10.2026)
              queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail'] }),
              queryClient.invalidateQueries({ queryKey: ['alle-mietvertrag-immobilie'] }),
              queryClient.invalidateQueries({ queryKey: ['mietforderungen', vertragId] }),
              queryClient.invalidateQueries({ queryKey: ['rueckstaende'] }),
              queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
              // Versandprotokoll in der Vertragsansicht und offene Vormerkungen (28.10.2026)
              queryClient.invalidateQueries({ queryKey: ['mahnung-versand', vertragId] }),
              queryClient.invalidateQueries({ queryKey: ['mahnung-vormerkungen', vertragId] }),
              queryClient.invalidateQueries({ queryKey: ['mahnung-unklar', vertragId] }),
              // Ein gespeichertes Schreiben liegt unter Dokumente, auch wenn es nicht versendet wurde
              queryClient.invalidateQueries({ queryKey: ['dokumente-detail', vertragId] }),
            ]);
          }}
          contractData={vertrag ? {
            mietvertrag_id: vertragId,
            current_kaltmiete: Number(vertrag.kaltmiete || 0),
            current_betriebskosten: Number(vertrag.betriebskosten || 0),
            letzte_mieterhoehung_am: vertrag.letzte_mieterhoehung_am,
            start_datum: vertrag.start_datum,
            einheit_id: einheit?.id,
            einheitentyp: einheitData?.einheitentyp,
            immobilie_id: immobilie?.id,
            immobilie_name: immobilie?.name,
            immobilie_adresse: immobilie?.adresse,
            mahnstufe: vertrag.mahnstufe || 0,
            vertragsende: getVertragsende(vertrag),
            mieter: mieter as any[]
          } : null}
          rueckstand={mahnRueckstand}
          // Die offenen Monate dahinter (§ 366 Abs. 2 BGB: die jüngsten): Das Schreiben zählt sie auf, und nur ihr
          // Mietanteil zählt für die Schwelle der fristlosen Kündigung (Prüfung 29.10.2026)
          offenePosten={offenePosten(nurFaelligeForderungen((forderungen || []).filter((f) => f.sollmonat), new Date()), mahnRueckstand)}
        />

      </DialogContent>
    </Dialog>

    {/* Rent Increase Confirmation Dialog */}
    <AlertDialog open={mutations.showRentIncreaseConfirm} onOpenChange={(open) => {
      if (!open) mutations.handleRentIncreaseCancel();
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mietänderung bestätigen</AlertDialogTitle>
          <AlertDialogDescription>
            Sie haben die Kaltmiete geändert. Handelt es sich um eine offizielle Mieterhöhung?
            <br /><br />
            <strong>Ja:</strong> Das Datum der letzten Mieterhöhung wird auf heute gesetzt. Die neue Miete wird ab dem {offizielleErhoehungGiltAbText()} gefordert; der laufende Monat bleibt.
            <br />
            <strong>Nein:</strong> Die Miete wird nur korrigiert, ohne das Mieterhöhungsdatum zu ändern. Die Korrektur gilt schon für den laufenden Monat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(e) => {
            e.stopPropagation();
            mutations.handleRentIncreaseCancel();
          }}>
            Abbrechen
          </AlertDialogCancel>
          <Button
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              mutations.handleRentIncreaseConfirm(false);
            }}
          >
            Nein, nur Korrektur
          </Button>
          <AlertDialogAction onClick={(e) => {
            e.stopPropagation();
            mutations.handleRentIncreaseConfirm(true);
          }}>
            Ja, offizielle Mieterhöhung
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
