import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MietvertragEditableField } from "./MietvertragEditableField";
import { Euro, TrendingUp, TrendingDown, CheckCircle } from "lucide-react";
import { leseKautionsbetrag } from "@/utils/vertragKaution";

interface MietvertragKautionSectionProps {
  vertrag: any;
  isGlobalEditMode?: boolean;
  editedValues?: Record<string, any>;
  onUpdateEditedValue?: (key: string, value: any) => void;
  editingKaution: 'soll' | 'ist' | null;
  onEditKaution: (field: 'soll' | 'ist', value: string) => void;
  onStartEditKaution: (field: 'soll' | 'ist') => void;
  onCancelEditKaution: () => void;
  formatBetrag: (betrag: number) => string;
}

export function MietvertragKautionSection({
  vertrag,
  isGlobalEditMode = false,
  editedValues = {},
  onUpdateEditedValue,
  editingKaution,
  onEditKaution,
  onStartEditKaution,
  onCancelEditKaution,
  formatBetrag
}: MietvertragKautionSectionProps) {
  // Im Bearbeitungsmodus der Rohtext der Eingabe; der Hook entscheidet über
  // geaenderteKaution(), ob leer (null), Betrag oder ungültig. Eine leere Kaution
  // steht leer im Feld -- bis 26.10.2026 stand dort eine 0 und wurde gespeichert.
  const sollRoh = isGlobalEditMode && editedValues.kaution_betrag !== undefined ? editedValues.kaution_betrag : vertrag.kaution_betrag;
  const istRoh = isGlobalEditMode && editedValues.kaution_ist !== undefined ? editedValues.kaution_ist : vertrag.kaution_ist;
  const kautionSoll = leseKautionsbetrag(sollRoh) ?? 0;
  const kautionIst = leseKautionsbetrag(istRoh) ?? 0;
  const kautionDifferenz = kautionSoll - kautionIst;

  // Ohne onValueChange ging eine Eingabe im Bearbeitungsmodus verloren,
  // wenn nicht zuerst der Haken am Feld geklickt wurde
  const speichere = (field: 'soll' | 'ist', value: string) => {
    if (isGlobalEditMode) onUpdateEditedValue?.(field === 'soll' ? 'kaution_betrag' : 'kaution_ist', value);
    else onEditKaution(field, value);
  };
  const betragAnzeige = (value: string | number) => formatBetrag(Number(value) || 0);

  return (
    <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-background to-muted/50 border-b pb-4">
        <CardTitle className="flex items-center space-x-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Euro className="h-5 w-5 text-primary" />
          </div>
          <div>
            <span className="text-lg md:text-xl font-semibold">Kaution Übersicht</span>
            <p className="text-xs md:text-sm text-muted-foreground font-normal mt-0.5">
              Soll- und Ist-Beträge der Mietkaution
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">
          {/* Kaution Soll */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200/50 dark:border-blue-800/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs md:text-sm font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                Soll
              </span>
              <div className="p-1.5 bg-blue-100 dark:bg-blue-800/40 rounded-lg">
                <TrendingUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <MietvertragEditableField
              label=""
              value={sollRoh ?? ""}
              isEditing={isGlobalEditMode || editingKaution === 'soll'}
              onEdit={() => !isGlobalEditMode && onStartEditKaution('soll')}
              onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('kaution_betrag', raw) : undefined}
              onSave={(value) => speichere('soll', value)}
              onCancel={onCancelEditKaution}
              type="number"
              className="font-bold text-xl md:text-2xl text-blue-800 dark:text-blue-200"
              formatter={betragAnzeige}
              hideEditButton={true}
              isGlobalEditMode={isGlobalEditMode}
            />
          </div>

          {/* Kaution Ist */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 border border-emerald-200/50 dark:border-emerald-800/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs md:text-sm font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                Ist (erhalten)
              </span>
              <div className="p-1.5 bg-emerald-100 dark:bg-emerald-800/40 rounded-lg">
                <CheckCircle className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <MietvertragEditableField
              label=""
              value={istRoh ?? ""}
              isEditing={isGlobalEditMode || editingKaution === 'ist'}
              onEdit={() => !isGlobalEditMode && onStartEditKaution('ist')}
              onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('kaution_ist', raw) : undefined}
              onSave={(value) => speichere('ist', value)}
              onCancel={onCancelEditKaution}
              type="number"
              className="font-bold text-xl md:text-2xl text-emerald-800 dark:text-emerald-200"
              formatter={betragAnzeige}
              hideEditButton={true}
              isGlobalEditMode={isGlobalEditMode}
            />
          </div>

          {/* Differenz */}
          <div className={`p-4 rounded-xl border ${
            kautionDifferenz > 0 
              ? 'bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-900/20 dark:to-red-900/20 border-rose-200/50 dark:border-rose-800/50'
              : kautionDifferenz < 0 
                ? 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200/50 dark:border-amber-800/50'
                : 'bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-900/20 dark:to-gray-900/20 border-slate-200/50 dark:border-slate-800/50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs md:text-sm font-medium uppercase tracking-wide ${
                kautionDifferenz > 0 
                  ? 'text-rose-600 dark:text-rose-400'
                  : kautionDifferenz < 0 
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-600 dark:text-slate-400'
              }`}>
                Differenz
              </span>
              <div className={`p-1.5 rounded-lg ${
                kautionDifferenz > 0 
                  ? 'bg-rose-100 dark:bg-rose-800/40'
                  : kautionDifferenz < 0 
                    ? 'bg-amber-100 dark:bg-amber-800/40'
                    : 'bg-slate-100 dark:bg-slate-800/40'
              }`}>
                <TrendingDown className={`h-3.5 w-3.5 md:h-4 md:w-4 ${
                  kautionDifferenz > 0 
                    ? 'text-rose-600 dark:text-rose-400'
                    : kautionDifferenz < 0 
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-600 dark:text-slate-400'
                }`} />
              </div>
            </div>
            <p className={`font-bold text-xl md:text-2xl ${
              kautionDifferenz > 0 
                ? 'text-rose-700 dark:text-rose-300' 
                : kautionDifferenz < 0 
                  ? 'text-amber-700 dark:text-amber-300' 
                  : 'text-slate-700 dark:text-slate-300'
            }`}>
              {formatBetrag(Math.abs(kautionDifferenz))}
            </p>
            <p className={`text-xs md:text-sm mt-1 ${
              kautionDifferenz > 0 
                ? 'text-rose-600 dark:text-rose-400' 
                : kautionDifferenz < 0 
                  ? 'text-amber-600 dark:text-amber-400' 
                  : 'text-slate-600 dark:text-slate-400'
            }`}>
              {kautionDifferenz > 0 ? 'noch offen' : kautionDifferenz < 0 ? 'Überzahlung' : 'Vollständig'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}