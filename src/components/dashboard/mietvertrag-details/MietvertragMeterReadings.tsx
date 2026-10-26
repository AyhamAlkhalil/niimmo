import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Gauge, Droplet, Thermometer, Zap, Flame } from "lucide-react";
import { useState } from "react";
import { MietvertragEditableField } from "./MietvertragEditableField";

interface MietvertragMeterReadingsProps {
  vertrag: any;
  einheit?: any;
  isGlobalEditMode?: boolean;
  editedValues?: Record<string, any>;
  onUpdateEditedValue?: (key: string, value: any) => void;
  editingMeter: string | null;
  editingMeterNumber: string | null;
  onEditMeter: (field: string, value: string) => void;
  onStartEditMeter: (field: string) => void;
  onCancelEditMeter: () => void;
  onEditMeterNumber: (field: string, value: string) => void;
  onStartEditMeterNumber: (field: string) => void;
  onCancelEditMeterNumber: () => void;
}

export function MietvertragMeterReadings({
  vertrag,
  einheit,
  isGlobalEditMode = false,
  editedValues = {},
  onUpdateEditedValue,
  editingMeter,
  editingMeterNumber,
  onEditMeter,
  onStartEditMeter,
  onCancelEditMeter,
  onEditMeterNumber,
  onStartEditMeterNumber,
  onCancelEditMeterNumber
}: MietvertragMeterReadingsProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Ein leerer Stand ist „nicht erfasst", keine 0. Bis 23.10.2026 zeigte das Feld für leer
  // eine 0 und belegte die Eingabe damit vor -- gespeichert wurde dann auch eine 0.
  const formatMeterValue = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? "Nicht erfasst" : String(value);

  // Leeres Feld = "" statt null: MietvertragEditableField erwartet string | number,
  // und das Eingabefeld bleibt so kontrolliert.
  const anzeigeWert = (stand: number | null | undefined): string | number => stand ?? "";

  // Im Bearbeitungsmodus geht der Rohtext an den Hook; dort entscheidet
  // geaenderteZaehlerstaende(), ob leer (null), Zahl oder ungültig.
  const speichereStand = (feld: string, value: string) => {
    if (isGlobalEditMode) onUpdateEditedValue?.(feld, value);
    else onEditMeter(feld, value);
  };

  const meterReadings = [
    {
      key: "kaltwasser",
      icon: Droplet,
      color: "text-navy-600",
      chip: "bg-navy-50 ring-navy-100",
      label: "Kaltwasser",
      number: einheit?.kaltwasser_zaehler,
      einzug: vertrag.kaltwasser_einzug,
      auszug: vertrag.kaltwasser_auszug
    },
    {
      key: "warmwasser", 
      icon: Thermometer,
      color: "text-terracotta-600",
      chip: "bg-terracotta-50 ring-terracotta-100",
      label: "Warmwasser",
      number: einheit?.warmwasser_zaehler,
      einzug: vertrag.warmwasser_einzug,
      auszug: vertrag.warmwasser_auszug
    },
    {
      key: "strom",
      icon: Zap,
      color: "text-gold-600",
      chip: "bg-gold-50 ring-gold-100",
      label: "Strom",
      number: einheit?.strom_zaehler,
      einzug: vertrag.strom_einzug,
      auszug: vertrag.strom_auszug
    },
    {
      key: "gas",
      icon: Flame,
      color: "text-crimson-600",
      chip: "bg-crimson-50 ring-crimson-100",
      label: "Gas",
      number: einheit?.gas_zaehler,
      einzug: vertrag.gas_einzug,
      auszug: vertrag.gas_auszug
    }
  ];

  return (
    <Card className="overflow-hidden rounded-2xl">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent group">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-muted/60 transition-colors group-hover:bg-muted">
                  <Gauge className="h-4 w-4 text-foreground/70" />
                </div>
                <CardTitle className="text-lg">Zählerstände & Verbrauch</CardTitle>
              </div>
              <div className="rounded-full p-2 transition-colors group-hover:bg-accent">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform" />
                )}
              </div>
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        
        <CollapsibleContent className="animate-accordion-down">
          <CardContent className="space-y-4 border-t border-border/70 pt-5">
            {meterReadings.map((meter, index) => {
              const IconComponent = meter.icon;
              // Erst ab einem Einzugsstand über 0: Bis zum 23.10.2026 schrieb die
              // Vertragsbearbeitung leere Stände als 0 — ein „Verbrauch“ wäre dann der
              // ganze Zählerstand (Validierung 24.10.2026). Bei der Bereinigung am 26.10.2026
              // blieben 8 Einzugsstände 0 stehen, die echt sein können, aber nicht belegt sind.
              const hasConsumption = meter.einzug != null && meter.auszug != null && Number(meter.einzug) > 0 && Number(meter.auszug) > Number(meter.einzug);
              
              return (
                <div 
                  key={meter.key} 
                  className="group relative overflow-hidden rounded-xl border border-border/80 bg-card p-5 transition-[border-color,box-shadow] duration-300 ease-sanft hover:border-neutral-300 hover:shadow-md animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* Header with Icon, Label and Meter Number */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 ${meter.chip}`}>
                        <IconComponent className={`h-5 w-5 ${meter.color}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{meter.label}</h3>
                        <p className="text-sm text-muted-foreground">Zählernummer & Ablesungen</p>
                      </div>
                    </div>
                    
                    {/* Meter Number Field */}
                    <div className="rounded-lg border border-border/70 bg-neutral-50/70 p-2">
                      <MietvertragEditableField
                        label="Zählernummer"
                        value={meter.number || ""}
                        isEditing={isGlobalEditMode || editingMeterNumber === `${meter.key}_zaehler`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeterNumber(`${meter.key}_zaehler`)}
                        onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.(`${meter.key}_zaehler`, raw) : undefined}
                        onSave={(value) => {
                          if (isGlobalEditMode) {
                            onUpdateEditedValue?.(`${meter.key}_zaehler`, value);
                          } else {
                            onEditMeterNumber(`${meter.key}_zaehler`, value);
                          }
                        }}
                        onCancel={onCancelEditMeterNumber}
                        type="text"
                        formatter={(value) => String(value) || "Nicht gesetzt"}
                        isGlobalEditMode={isGlobalEditMode}
                      />
                    </div>
                  </div>
                  
                  {/* Reading Values */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="rounded-lg border border-border/80 bg-neutral-50/60 p-4">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-forest-500" aria-hidden="true" />
                        Einzugsstand
                      </div>
                      <MietvertragEditableField
                        label="Bei Einzug"
                        value={anzeigeWert(meter.einzug)}
                        isEditing={isGlobalEditMode || editingMeter === `${meter.key}_einzug`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeter(`${meter.key}_einzug`)}
                        // Ohne onValueChange ging eine Eingabe im Bearbeitungsmodus verloren,
                        // wenn nicht zuerst der Haken am Feld geklickt wurde
                        onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.(`${meter.key}_einzug`, raw) : undefined}
                        onSave={(value) => speichereStand(`${meter.key}_einzug`, value)}
                        onCancel={onCancelEditMeter}
                        type="number"
                        step="0.01"
                        formatter={formatMeterValue}
                        // Haken und X gibt es im Bearbeitungsmodus nicht: Gespeichert wird alles zusammen
                        isGlobalEditMode={isGlobalEditMode}
                      />
                    </div>
                    
                    <div className="rounded-lg border border-border/80 bg-neutral-50/60 p-4">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                        Auszugsstand
                      </div>
                      <MietvertragEditableField
                        label="Bei Auszug"
                        value={anzeigeWert(meter.auszug)}
                        isEditing={isGlobalEditMode || editingMeter === `${meter.key}_auszug`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeter(`${meter.key}_auszug`)}
                        onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.(`${meter.key}_auszug`, raw) : undefined}
                        onSave={(value) => speichereStand(`${meter.key}_auszug`, value)}
                        onCancel={onCancelEditMeter}
                        type="number"
                        step="0.01"
                        formatter={formatMeterValue}
                        isGlobalEditMode={isGlobalEditMode}
                      />
                    </div>
                  </div>
                  
                  {/* Consumption Calculation */}
                  {hasConsumption && (
                    <div className="rounded-lg border border-border/80 bg-muted/50 p-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 rounded-full bg-brand" />
                          <span className="text-sm font-medium text-foreground">Gesamtverbrauch</span>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-3xl leading-none tabular-nums text-foreground">
                            {(Number(meter.auszug) - Number(meter.einzug)).toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {meter.key === 'kaltwasser' || meter.key === 'warmwasser' ? 'm³' : 
                             meter.key === 'strom' ? 'kWh' : 
                             meter.key === 'gas' ? 'm³' : 'Einheiten'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Visual separator for last item */}
                  {index < meterReadings.length - 1 && (
                    <div className="absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}