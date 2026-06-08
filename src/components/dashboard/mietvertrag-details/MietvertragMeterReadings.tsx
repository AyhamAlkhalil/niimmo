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

  const formatMeterValue = (value: number | null) => {
    return value ? value.toString() : "0";
  };

  const meterReadings = [
    {
      key: "kaltwasser",
      icon: Droplet,
      color: "text-blue-500",
      label: "Kaltwasser",
      number: einheit?.kaltwasser_zaehler,
      einzug: vertrag.kaltwasser_einzug,
      auszug: vertrag.kaltwasser_auszug
    },
    {
      key: "warmwasser", 
      icon: Thermometer,
      color: "text-orange-500",
      label: "Warmwasser",
      number: einheit?.warmwasser_zaehler,
      einzug: vertrag.warmwasser_einzug,
      auszug: vertrag.warmwasser_auszug
    },
    {
      key: "strom",
      icon: Zap,
      color: "text-yellow-500", 
      label: "Strom",
      number: einheit?.strom_zaehler,
      einzug: vertrag.strom_einzug,
      auszug: vertrag.strom_auszug
    },
    {
      key: "gas",
      icon: Flame,
      color: "text-red-500",
      label: "Gas",
      number: einheit?.gas_zaehler,
      einzug: vertrag.gas_einzug,
      auszug: vertrag.gas_auszug
    }
  ];

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3 bg-gradient-to-r from-primary/5 to-primary/10">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent group">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Gauge className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-lg">Zählerstände & Verbrauch</CardTitle>
              </div>
              <div className="p-2 rounded-full group-hover:bg-primary/10 transition-colors">
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
          <CardContent className="space-y-6 pt-4">
            {meterReadings.map((meter, index) => {
              const IconComponent = meter.icon;
              const hasConsumption = meter.einzug && meter.auszug && Number(meter.auszug) > Number(meter.einzug);
              
              return (
                <div 
                  key={meter.key} 
                  className="group relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background to-muted/30 p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/20 animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  {/* Header with Icon, Label and Meter Number */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2.5 rounded-xl bg-gradient-to-br ${meter.color === 'text-blue-500' ? 'from-blue-100 to-blue-200' : 
                        meter.color === 'text-orange-500' ? 'from-orange-100 to-orange-200' :
                        meter.color === 'text-yellow-500' ? 'from-yellow-100 to-yellow-200' :
                        'from-red-100 to-red-200'} shadow-sm`}>
                        <IconComponent className={`h-5 w-5 ${meter.color}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{meter.label}</h3>
                        <p className="text-sm text-muted-foreground">Zählernummer & Ablesungen</p>
                      </div>
                    </div>
                    
                    {/* Meter Number Field */}
                    <div className="bg-muted/50 rounded-lg p-2">
                      <MietvertragEditableField
                        label="Zählernummer"
                        value={meter.number || ""}
                        isEditing={isGlobalEditMode || editingMeterNumber === `${meter.key}_zaehler`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeterNumber(`${meter.key}_zaehler`)}
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
                      />
                    </div>
                  </div>
                  
                  {/* Reading Values */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="text-xs text-green-700 font-medium mb-2 uppercase tracking-wide">
                        Einzugsstand
                      </div>
                      <MietvertragEditableField
                        label="Bei Einzug"
                        value={Number(meter.einzug || 0)}
                        isEditing={isGlobalEditMode || editingMeter === `${meter.key}_einzug`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeter(`${meter.key}_einzug`)}
                        onSave={(value) => {
                          if (isGlobalEditMode) {
                            onUpdateEditedValue?.(`${meter.key}_einzug`, parseFloat(value));
                          } else {
                            onEditMeter(`${meter.key}_einzug`, value);
                          }
                        }}
                        onCancel={onCancelEditMeter}
                        type="number"
                        step="0.01"
                        formatter={formatMeterValue}
                      />
                    </div>
                    
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="text-xs text-red-700 font-medium mb-2 uppercase tracking-wide">
                        Auszugsstand
                      </div>
                      <MietvertragEditableField
                        label="Bei Auszug"
                        value={Number(meter.auszug || 0)}
                        isEditing={isGlobalEditMode || editingMeter === `${meter.key}_auszug`}
                        onEdit={() => !isGlobalEditMode && onStartEditMeter(`${meter.key}_auszug`)}
                        onSave={(value) => {
                          if (isGlobalEditMode) {
                            onUpdateEditedValue?.(`${meter.key}_auszug`, parseFloat(value));
                          } else {
                            onEditMeter(`${meter.key}_auszug`, value);
                          }
                        }}
                        onCancel={onCancelEditMeter}
                        type="number"
                        step="0.01"
                        formatter={formatMeterValue}
                      />
                    </div>
                  </div>
                  
                  {/* Consumption Calculation */}
                  {hasConsumption && (
                    <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-lg p-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-primary">Gesamtverbrauch</span>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-primary">
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