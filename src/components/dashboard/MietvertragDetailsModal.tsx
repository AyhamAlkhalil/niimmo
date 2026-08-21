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
import { MahnungErstellungModal } from "./MahnungErstellungModal";
import MietvertragErstellungModal from "./MietvertragErstellungModal";
import { useMietvertragData } from "@/hooks/useMietvertragData";
import { useMietvertragMutations } from "@/hooks/useMietvertragMutations";

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
    queryClient,
  } = useMietvertragData(vertragId, isOpen);

  const einheitData = fetchedEinheit || einheit;
  const [showVertragPdfModal, setShowVertragPdfModal] = useState(false);

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

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[95vh] h-[95vh] md:h-auto overflow-hidden flex flex-col p-4 md:p-6">
        <DialogHeader className="flex-shrink-0">
          <div className="flex flex-wrap items-start gap-2 justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base md:text-lg min-w-0">
                <Building2 className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
                <span>Mietvertrag</span>
                {(immobilie || einheitData) && (
                  <span className="text-xs md:text-sm font-normal text-muted-foreground truncate hidden sm:inline">
                    – {immobilie?.name}{immobilie?.adresse ? ` · ${immobilie.adresse}` : ''}{einheitData ? ` · Einheit ${einheitData.zaehler ? String(einheitData.zaehler).padStart(2, '0') : (einheitData.id ? einheitData.id.slice(-2) : '')} · ${einheitData.einheitentyp || ''}${einheitData.etage ? ` ${einheitData.etage}` : ''}` : ''}
                  </span>
                )}
              </DialogTitle>
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
            <TabsList className="grid w-full grid-cols-2 sticky top-0 z-10 bg-background">
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
                onShowMahnung={() => mutations.setShowMahnungModal(true)}
                onShowKuendigung={() => mutations.setShowTerminationDialog(true)}
                onShowVertragPdf={() => setShowVertragPdfModal(true)}
                allMietvertraege={allMietvertraege}
                vertragId={vertragId}
                formatDatum={formatDatum}
                formatBetrag={formatBetrag}
              />
            </TabsContent>

            <TabsContent value="dokumente" className="space-y-4">
              <MietvertragDocumentsTab
                dokumente={dokumente || []}
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
              queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
              queryClient.invalidateQueries({ queryKey: ['rueckstaende'] }),
              queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
              queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
            ]);
          }}
          contractData={vertrag ? {
            mietvertrag_id: vertragId,
            current_kaltmiete: Number(vertrag.kaltmiete || 0),
            current_betriebskosten: Number(vertrag.betriebskosten || 0),
            letzte_mieterhoehung_am: vertrag.letzte_mieterhoehung_am,
            start_datum: vertrag.start_datum,
            einheit_id: einheit?.id,
            immobilie_id: immobilie?.id,
            immobilie_name: immobilie?.name,
            immobilie_adresse: immobilie?.adresse,
            mahnstufe: vertrag.mahnstufe || 0,
            mieter: mieter as any[]
          } : null}
          rueckstand={(() => {
            const gesamtSoll = (forderungen || []).reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);
            const gesamtGezahlt = (zahlungen || [])
              .filter(z => z.kategorie === 'Miete' || z.kategorie === 'Rücklastschrift')
              .reduce((sum, z) => sum + Number(z.betrag), 0);
            return Math.max(0, gesamtSoll - gesamtGezahlt);
          })()}
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
            <strong>Ja:</strong> Das Datum der letzten Mieterhöhung wird automatisch auf heute gesetzt.
            <br />
            <strong>Nein:</strong> Die Miete wird nur korrigiert, ohne das Mieterhöhungsdatum zu ändern.
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
