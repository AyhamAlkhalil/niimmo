import { MietvertragContractInfo } from "./MietvertragContractInfo";
import { MietvertragKautionSection } from "./MietvertragKautionSection";
import { MietvertragPaymentsSection } from "./MietvertragPaymentsSection";
import { MietvertragMeterReadings } from "./MietvertragMeterReadings";

interface MietvertragOverviewTabProps {
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
  onShowVertragPdf?: () => void;
  formatDatum: (datum: string) => string;
  formatBetrag: (betrag: number) => string;
}

export function MietvertragOverviewTab({
  vertrag,
  mieter,
  forderungen,
  zahlungen,
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
  onShowVertragPdf,
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
        onShowVertragPdf={onShowVertragPdf}
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