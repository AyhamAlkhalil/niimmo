import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Gauge, Droplet, Thermometer, Zap, Flame } from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { MietvertragEditableField } from "./MietvertragEditableField";
import { ZaehlerHistorie } from "../ZaehlerHistorie";
import { zaehlerVerbrauch } from "@/utils/vertragZaehlerstaende";
import { zaehlerstandAnzeige } from "@/utils/zaehlerstandUtils";
import { vertragZaehlerarten, type ObjektZaehlerKonfiguration } from "@/utils/zaehlerarten";

interface MietvertragMeterReadingsProps {
  vertrag: any;
  einheit?: any;
  /** Objekt der Einheit: bestimmt, welche Zählerarten erscheinen (utils/zaehlerarten.ts) */
  immobilie?: ObjektZaehlerKonfiguration | null;
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
  immobilie,
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
  // Seit 26.11.2026 im selben Format wie Zählerliste und Historie (vorher „16.02“ neben „158,39“)
  const formatMeterValue = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? "Nicht erfasst" : zaehlerstandAnzeige(value);

  // Leeres Feld = "" statt null: MietvertragEditableField erwartet string | number,
  // und das Eingabefeld bleibt so kontrolliert.
  const anzeigeWert = (stand: number | null | undefined): string | number => stand ?? "";

  // Im Bearbeitungsmodus geht der Rohtext an den Hook; dort entscheidet
  // geaenderteZaehlerstaende(), ob leer (null), Zahl oder ungültig.
  const speichereStand = (feld: string, value: string) => {
    if (isGlobalEditMode) onUpdateEditedValue?.(feld, value);
    else onEditMeter(feld, value);
  };

  const datumText = (datum: string) => format(parseISO(datum.slice(0, 10)), "dd.MM.yyyy");
  const standText = (stand: number | string) => zaehlerstandAnzeige(stand);

  // Letzte Ablesung an der Einheit -- dieselben Felder wie in der Zählerliste
  // (ZaehlerVerwaltung). Bis zum 24.11.2026 zeigte die Karte nur Ein- und Auszug
  // und blieb bei laufenden Verträgen leer (Kundenmeldung 23.11.2026).
  const letzteAblesung = (key: string) => ({
    aktuell: einheit?.[`${key}_stand_aktuell`] as number | string | null | undefined,
    aktuellDatum: einheit?.[`${key}_stand_datum`] as string | null | undefined,
  });

  // Nur Zählerarten, die das Objekt hat (24.11.2026), dazu jede mit erfasstem Ein- oder Auszugsstand
  const gezeigteArten: string[] = vertragZaehlerarten(immobilie, vertrag);

  const meterReadings = [
    {
      key: "kaltwasser",
      icon: Droplet,
      color: "text-navy-600",
      chip: "bg-navy-50 ring-navy-100",
      label: "Kaltwasser",
      number: einheit?.kaltwasser_zaehler,
      einzug: vertrag.kaltwasser_einzug,
      auszug: vertrag.kaltwasser_auszug,
      ...letzteAblesung("kaltwasser")
    },
    {
      key: "warmwasser", 
      icon: Thermometer,
      color: "text-terracotta-600",
      chip: "bg-terracotta-50 ring-terracotta-100",
      label: "Warmwasser",
      number: einheit?.warmwasser_zaehler,
      einzug: vertrag.warmwasser_einzug,
      auszug: vertrag.warmwasser_auszug,
      ...letzteAblesung("warmwasser")
    },
    {
      key: "strom",
      icon: Zap,
      color: "text-gold-600",
      chip: "bg-gold-50 ring-gold-100",
      label: "Strom",
      number: einheit?.strom_zaehler,
      einzug: vertrag.strom_einzug,
      auszug: vertrag.strom_auszug,
      ...letzteAblesung("strom")
    },
    {
      key: "gas",
      icon: Flame,
      color: "text-crimson-600",
      chip: "bg-crimson-50 ring-crimson-100",
      label: "Gas",
      number: einheit?.gas_zaehler,
      einzug: vertrag.gas_einzug,
      auszug: vertrag.gas_auszug,
      ...letzteAblesung("gas")
    }
  ]
    .filter((meter) => gezeigteArten.includes(meter.key))
    // Erst ab einem Einzugsstand über 0: Bis zum 23.10.2026 schrieb die Vertragsbearbeitung leere
    // Stände als 0 — ein „Verbrauch“ wäre dann der ganze Zählerstand (Validierung 24.10.2026). Seit
    // 24.11.2026 auch bei laufendem Vertrag bis zur letzten Ablesung (zaehlerVerbrauch)
    .map((meter) => ({
      ...meter,
      verbrauch: zaehlerVerbrauch({
        einzug: meter.einzug,
        auszug: meter.auszug,
        aktuell: meter.aktuell,
        aktuellDatum: meter.aktuellDatum,
        vertrag,
      }),
      masseinheit: meter.key === "strom" ? "kWh" : "m³",
    }));

  // Im eingeklappten Kopf sichtbar machen, dass es Ablesungen gibt
  const juengsteAblesung = meterReadings
    .map((meter) => (meter.aktuell != null && meter.aktuell !== "" ? meter.aktuellDatum?.slice(0, 10) : null))
    .filter((datum): datum is string => !!datum)
    .sort()
    .pop();

  return (
    <Card className="overflow-hidden rounded-2xl">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent group">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center border border-border/80 bg-muted/60 transition-colors group-hover:bg-muted">
                  <Gauge className="h-4 w-4 text-foreground/70" />
                </div>
                <div className="text-left">
                  <CardTitle className="text-lg">Zählerstände & Verbrauch</CardTitle>
                  {/* Ohne geladene Einheit nichts behaupten */}
                  {einheit && (
                    <p className="text-xs font-normal text-muted-foreground">
                      {juengsteAblesung ? `Letzte Ablesung ${datumText(juengsteAblesung)}` : "Noch keine Ablesung an der Einheit"}
                    </p>
                  )}
                </div>
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

        {/* Eingeklappt eine kurze Übersicht je Zähler (26.11.2026). Bis dahin zeigte die eingeklappte Karte
            nichts — als einziger Abschnitt der Vertragsdetails —, und die Stände wirkten wie nicht vorhanden. */}
        {!isOpen && einheit && meterReadings.length > 0 && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {meterReadings.map((meter) => {
                const IconComponent = meter.icon;
                const hatStand = meter.aktuell != null && meter.aktuell !== "";
                return (
                  <button
                    type="button"
                    key={meter.key}
                    onClick={() => setIsOpen(true)}
                    className="rounded-lg border border-border/70 bg-neutral-50/60 px-3 py-2 text-left transition-colors hover:border-neutral-300"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <IconComponent className={`h-3.5 w-3.5 ${meter.color}`} />
                      {meter.label}
                    </div>
                    <div className="mt-1 font-medium tabular-nums text-foreground">{hatStand ? standText(meter.aktuell as number | string) : "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {hatStand && meter.aktuellDatum ? `am ${datumText(meter.aktuellDatum)}` : "keine Ablesung"}
                    </div>
                    {meter.verbrauch && (
                      <div className="mt-1 text-xs tabular-nums text-foreground/80">
                        +{meter.verbrauch.wert.toLocaleString("de-DE", { maximumFractionDigits: 3 })} {meter.masseinheit}{" "}
                        {meter.verbrauch.bis === "auszug" ? "Einzug bis Auszug" : "seit Einzug"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        )}

        <CollapsibleContent className="animate-accordion-down">
          <CardContent className="space-y-4 border-t border-border/70 pt-5">
            {meterReadings.map((meter, index) => {
              const IconComponent = meter.icon;
              const verbrauch = meter.verbrauch;
              
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" aria-hidden="true" />
                        Letzte Ablesung
                      </div>
                      {/* Nur Anzeige: Erfasst und korrigiert wird in der Zählerliste bzw. der Historie unten */}
                      {meter.aktuell != null && meter.aktuell !== "" ? (
                        <div>
                          <div className="font-medium tabular-nums text-foreground">{standText(meter.aktuell)}</div>
                          <div className="text-xs text-muted-foreground">
                            {meter.aktuellDatum ? `am ${datumText(meter.aktuellDatum)}` : "ohne Datum"}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">Nicht erfasst</div>
                      )}
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
                  {verbrauch && (
                    <div className="rounded-lg border border-border/80 bg-muted/50 p-4 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 rounded-full bg-brand" />
                          <span className="text-sm font-medium text-foreground">
                            {verbrauch.bis === "auszug"
                              ? "Verbrauch Einzug bis Auszug"
                              : `Verbrauch seit Einzug (bis ${datumText(verbrauch.datum!)})`}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-3xl leading-none tabular-nums text-foreground">
                            {verbrauch.wert.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {meter.masseinheit}
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

            {/* Alle Ablesungen der Einheit, dieselbe Liste wie „Historie“ in der Zählerliste */}
            {einheit?.id && (
              <div className="rounded-xl border border-border/80 bg-card px-4 py-3">
                <ZaehlerHistorie einheitId={einheit.id} label="Alle Ablesungen der Einheit" />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}