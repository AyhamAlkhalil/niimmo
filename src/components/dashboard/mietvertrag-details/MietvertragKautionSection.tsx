import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MietvertragEditableField } from "./MietvertragEditableField";
import { Euro, TrendingUp, TrendingDown, CheckCircle } from "lucide-react";
import { kautionAufteilung, kautionIstVorschau, leseKautionsbetrag } from "@/utils/vertragKaution";

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
  // Seit 28.10.2026 rechnet die Datenbank das Ist: Anteil von Hand (bar, Altbestand vor dem Import)
  // plus Kautionsbuchungen. Bearbeitbar ist nur der Anteil von Hand. Vorher war das Ist selbst
  // ein Eingabefeld, auf das jede Buchung addiert wurde — von Hand eingetragen und danach
  // importiert stand dieselbe Überweisung doppelt da, ohne dass es zu sehen war.
  const aufteilung = kautionAufteilung(vertrag);
  const vonHandRoh = isGlobalEditMode && editedValues.kaution_ist_grundwert !== undefined
    ? editedValues.kaution_ist_grundwert
    : aufteilung.vonHand;
  const kautionSoll = leseKautionsbetrag(sollRoh) ?? 0;
  const kautionIst = (isGlobalEditMode ? kautionIstVorschau(aufteilung, vonHandRoh) : aufteilung.ist) ?? 0;
  const kautionDifferenz = kautionSoll - kautionIst;

  // Ohne onValueChange ging eine Eingabe im Bearbeitungsmodus verloren,
  // wenn nicht zuerst der Haken am Feld geklickt wurde
  const speichere = (field: 'soll' | 'ist', value: string) => {
    if (isGlobalEditMode) onUpdateEditedValue?.(field === 'soll' ? 'kaution_betrag' : 'kaution_ist_grundwert', value);
    else onEditKaution(field, value);
  };
  const betragAnzeige = (value: string | number) => formatBetrag(Number(value) || 0);

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border/80 bg-muted/60">
            <Euro className="h-4 w-4 text-foreground/70" />
          </div>
          <div>
            <span className="text-lg font-semibold md:text-xl">Kaution Übersicht</span>
            <p className="mt-0.5 text-xs font-normal text-muted-foreground md:text-sm">
              Soll- und Ist-Beträge der Mietkaution
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {/* Kaution Soll */}
          <div className="rounded-xl border border-border/80 bg-neutral-50/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Soll
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-50 ring-1 ring-navy-100">
                <TrendingUp className="h-3.5 w-3.5 text-navy-600" />
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
              className="font-display text-3xl leading-none tabular-nums text-foreground md:text-3xl"
              formatter={betragAnzeige}
              hideEditButton={true}
              isGlobalEditMode={isGlobalEditMode}
            />
          </div>

          {/* Kaution Ist: berechnet, nur der Anteil von Hand ist bearbeitbar */}
          <div className="rounded-xl border border-border/80 bg-neutral-50/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Ist (erhalten)
              </span>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-forest-50 ring-1 ring-forest-100">
                <CheckCircle className="h-3.5 w-3.5 text-forest-600" />
              </div>
            </div>
            <p className="font-display text-3xl leading-none tabular-nums text-foreground md:text-3xl">
              {formatBetrag(kautionIst)}
            </p>
            <dl className="mt-3 space-y-1.5 border-t border-border/70 pt-3 text-xs md:text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">aus Kontobuchungen</dt>
                <dd className="tabular-nums text-foreground">{formatBetrag(aufteilung.ausBuchungen)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground" title="Bar erhalten oder vor dem Kontoimport eingegangen — keine Überweisung, die als Buchung kommt">
                  von Hand (bar, vor dem Import)
                </dt>
                <dd className="tabular-nums text-foreground">
                  <MietvertragEditableField
                    label=""
                    value={vonHandRoh ?? ""}
                    isEditing={isGlobalEditMode || editingKaution === 'ist'}
                    onEdit={() => !isGlobalEditMode && onStartEditKaution('ist')}
                    onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('kaution_ist_grundwert', raw) : undefined}
                    onSave={(value) => speichere('ist', value)}
                    onCancel={onCancelEditKaution}
                    type="number"
                    className="text-xs tabular-nums text-foreground md:text-sm"
                    formatter={betragAnzeige}
                    hideEditButton={true}
                    isGlobalEditMode={isGlobalEditMode}
                  />
                </dd>
              </div>
            </dl>
          </div>

          {/* Differenz */}
          <div className={`rounded-xl border p-4 ${
            kautionDifferenz > 0
              ? 'border-crimson-100 bg-crimson-50/60'
              : kautionDifferenz < 0
                ? 'border-ochre-100 bg-ochre-50/70'
                : 'border-border/80 bg-neutral-50/60'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs font-medium uppercase tracking-[0.08em] ${
                kautionDifferenz > 0
                  ? 'text-crimson-700'
                  : kautionDifferenz < 0
                    ? 'text-ochre-700'
                    : 'text-muted-foreground'
              }`}>
                Differenz
              </span>
              <div className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ${
                kautionDifferenz > 0
                  ? 'bg-crimson-100/70 ring-crimson-200/70'
                  : kautionDifferenz < 0
                    ? 'bg-ochre-100/70 ring-ochre-200/70'
                    : 'bg-neutral-100 ring-neutral-200'
              }`}>
                <TrendingDown className={`h-3.5 w-3.5 ${
                  kautionDifferenz > 0
                    ? 'text-crimson-700'
                    : kautionDifferenz < 0
                      ? 'text-ochre-700'
                      : 'text-muted-foreground'
                }`} />
              </div>
            </div>
            <p className={`font-display text-3xl leading-none tabular-nums ${
              kautionDifferenz > 0
                ? 'text-crimson-800'
                : kautionDifferenz < 0
                  ? 'text-ochre-800'
                  : 'text-foreground'
            }`}>
              {formatBetrag(Math.abs(kautionDifferenz))}
            </p>
            <p className={`mt-2 text-xs md:text-sm ${
              kautionDifferenz > 0
                ? 'text-crimson-700'
                : kautionDifferenz < 0
                  ? 'text-ochre-700'
                  : 'text-muted-foreground'
            }`}>
              {kautionDifferenz > 0 ? 'noch offen' : kautionDifferenz < 0 ? 'Überzahlung' : 'Vollständig'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}