import { MietvertragContractInfo } from "./MietvertragContractInfo";
import { MietvertragDokument } from "../MietvertragDokument";
import { istWohnraumEinheit } from "@/utils/mietvertrag/entwurf";
import { MietvertragKautionSection } from "./MietvertragKautionSection";
import { MietvertragPaymentsSection } from "./MietvertragPaymentsSection";
import { MietvertragMeterReadings } from "./MietvertragMeterReadings";

interface MietvertragOverviewTabProps {
  /** Zahlungen oder Forderungen nicht geladen: Finanzübersicht zeigt einen Fehler statt Zahlen */
  finanzFehler?: boolean;
  /** Zahlungen oder Forderungen laden noch: Finanzübersicht zeigt keine Zahlen */
  finanzLaedt?: boolean;
  vertrag: any;
  mieter: any[];
  forderungen: any[];
  zahlungen: any[];
  allMietvertraege?: any[];
  vertragId: string;
  immobilie?: any;
  einheit?: any;
  isGlobalEditMode?: boolean;
  editedValues?: Record<string, any>;
  onUpdateEditedValue?: (key: string, value: any) => void;
  editingMietvertrag: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe' | null;
  editingKaution: 'soll' | 'ist' | null;
  editingMeter: string | null;
  editingMeterNumber: string | null;
  onEditMietvertrag: (field: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe', value: string) => void;
  onStartEdit: (field: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe') => void;
  onCancelEdit: () => void;
  onEditKaution: (field: 'soll' | 'ist', value: string) => void;
  onStartEditKaution: (field: 'soll' | 'ist') => void;
  onCancelEditKaution: () => void;
  onEditMeter: (field: string, value: string) => void;
  onStartEditMeter: (field: string) => void;
  onCancelEditMeter: () => void;
  onEditMeterNumber: (field: string, value: string) => void;
  onStartEditMeterNumber: (field: string) => void;
  onCancelEditMeterNumber: () => void;
  onCreateForderung: () => void;
  onContractUpdate?: () => void;
  onShowMahnung?: () => void;
  onShowKuendigung?: () => void;
  onShowKuendigungsbestaetigung?: () => void;
  /** Nach „Zurücknehmen“ gibt es den Vertrag nicht mehr. */
  onZurueckgenommen?: () => void;
  formatDatum: (datum: string) => string;
  formatBetrag: (betrag: number) => string;
}

export function MietvertragOverviewTab({
  vertrag,
  mieter,
  forderungen,
  zahlungen,
  finanzFehler,
  finanzLaedt,
  allMietvertraege,
  vertragId,
  immobilie,
  einheit,
  isGlobalEditMode = false,
  editedValues = {},
  onUpdateEditedValue,
  editingMietvertrag,
  editingKaution,
  editingMeter,
  editingMeterNumber,
  onEditMietvertrag,
  onStartEdit,
  onCancelEdit,
  onEditKaution,
  onStartEditKaution,
  onCancelEditKaution,
  onEditMeter,
  onStartEditMeter,
  onCancelEditMeter,
  onEditMeterNumber,
  onStartEditMeterNumber,
  onCancelEditMeterNumber,
  onCreateForderung,
  onContractUpdate,
  onShowMahnung,
  onShowKuendigung,
  onShowKuendigungsbestaetigung,
  onZurueckgenommen,
  formatDatum,
  formatBetrag
}: MietvertragOverviewTabProps) {
  return (
    <div className="space-y-3">
      {/* Combined Contract + Tenant Info */}
      <MietvertragContractInfo
        vertrag={vertrag}
        einheit={einheit}
        immobilie={immobilie}
        mieter={mieter}
        isGlobalEditMode={isGlobalEditMode}
        editedValues={editedValues}
        onUpdateEditedValue={onUpdateEditedValue}
        editingMietvertrag={editingMietvertrag}
        onEditMietvertrag={onEditMietvertrag}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        formatDatum={formatDatum}
        formatBetrag={formatBetrag}
        onShowMahnung={onShowMahnung}
        onShowKuendigung={onShowKuendigung}
        onShowKuendigungsbestaetigung={onShowKuendigungsbestaetigung}
      />

      {/* Der Mietvertrag als Schriftstück: Stand, erstellen, neue Fassung, hochladen, zurücknehmen (12.11.2026) */}
      <MietvertragDokument
        variante="details"
        vertragId={vertragId}
        ausstehend={!!vertrag?.unterschrift_ausstehend}
        status={vertrag?.status}
        wohnraum={istWohnraumEinheit(einheit?.einheitentyp)}
        gesperrt={
          isGlobalEditMode
            ? 'Während des Bearbeitens gesperrt — erst speichern oder abbrechen. Das PDF nimmt den gespeicherten Stand des Vertrags.'
            : null
        }
        onZurueckgenommen={onZurueckgenommen}
      />

      {/* Kaution Section */}
      <MietvertragKautionSection
        vertrag={vertrag}
        isGlobalEditMode={isGlobalEditMode}
        editedValues={editedValues}
        onUpdateEditedValue={onUpdateEditedValue}
        editingKaution={editingKaution}
        onEditKaution={onEditKaution}
        onStartEditKaution={onStartEditKaution}
        onCancelEditKaution={onCancelEditKaution}
        formatBetrag={formatBetrag}
      />

      {/* Meter Readings Section */}
      <MietvertragMeterReadings
        vertrag={vertrag}
        einheit={einheit}
        isGlobalEditMode={isGlobalEditMode}
        editedValues={editedValues}
        onUpdateEditedValue={onUpdateEditedValue}
        editingMeter={editingMeter}
        editingMeterNumber={editingMeterNumber}
        onEditMeter={onEditMeter}
        onStartEditMeter={onStartEditMeter}
        onCancelEditMeter={onCancelEditMeter}
        onEditMeterNumber={onEditMeterNumber}
        onStartEditMeterNumber={onStartEditMeterNumber}
        onCancelEditMeterNumber={onCancelEditMeterNumber}
      />

      {/* Payments Section */}
      <MietvertragPaymentsSection
        vertrag={vertrag}
        forderungen={forderungen}
        zahlungen={zahlungen}
        finanzFehler={finanzFehler}
        finanzLaedt={finanzLaedt}
        allMietvertraege={allMietvertraege}
        vertragId={vertragId}
        mieterIds={mieter?.map((m: any) => m.id).filter(Boolean) || []}
        einheit={einheit}
        immobilie={immobilie}
        formatBetrag={formatBetrag}
        formatDatum={formatDatum}
        onCreateForderung={onCreateForderung}
        onContractUpdate={onContractUpdate}
      />
    </div>
  );
}