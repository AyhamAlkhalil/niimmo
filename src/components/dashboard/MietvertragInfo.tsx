import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileText, Building, Home, Euro, Calendar, MapPin, AlertTriangle, ChevronDown, Square, Hash, Layers, Gauge, Droplet, Zap, Flame, Thermometer, Edit2, Save, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getVertragsende } from "@/utils/contractUtils";

interface MietvertragInfoProps {
  vertrag: any;
  einheit: any;
  immobilie: any;
}

export const MietvertragInfo = ({ vertrag, einheit, immobilie }: MietvertragInfoProps) => {
  const [isEinheitExpanded, setIsEinheitExpanded] = useState(false); // Default collapsed
  const [isImmobilieExpanded, setIsImmobilieExpanded] = useState(false);
  const [isZaehlerstaendeExpanded, setIsZaehlerstaendeExpanded] = useState(false);
  const [isEditingReadings, setIsEditingReadings] = useState(false);
  const [editedReadings, setEditedReadings] = useState({
    kaltwasser_einzug: vertrag?.kaltwasser_einzug || '',
    warmwasser_einzug: vertrag?.warmwasser_einzug || '',
    strom_einzug: vertrag?.strom_einzug || '',
    gas_einzug: vertrag?.gas_einzug || '',
    kaltwasser_auszug: vertrag?.kaltwasser_auszug || '',
    warmwasser_auszug: vertrag?.warmwasser_auszug || '',
    strom_auszug: vertrag?.strom_auszug || '',
    gas_auszug: vertrag?.gas_auszug || ''
  });
  const { toast } = useToast();

  const handleSaveReadings = async () => {
    try {
      const { error } = await supabase
        .from('mietvertrag')
        .update(editedReadings)
        .eq('id', vertrag.id);

      if (error) throw error;

      toast({
        title: "Erfolg",
        description: "Zählerstände wurden aktualisiert.",
      });
      setIsEditingReadings(false);
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Fehler beim Speichern der Zählerstände.",
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setEditedReadings({
      kaltwasser_einzug: vertrag?.kaltwasser_einzug || '',
      warmwasser_einzug: vertrag?.warmwasser_einzug || '',
      strom_einzug: vertrag?.strom_einzug || '',
      gas_einzug: vertrag?.gas_einzug || '',
      kaltwasser_auszug: vertrag?.kaltwasser_auszug || '',
      warmwasser_auszug: vertrag?.warmwasser_auszug || '',
      strom_auszug: vertrag?.strom_auszug || '',
      gas_auszug: vertrag?.gas_auszug || ''
    });
    setIsEditingReadings(false);
  };

  return (
    <Card className="elegant-card border-0 shadow-lg rounded-2xl overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
        <CardTitle className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <span className="text-xl font-semibold text-gray-800">Vertragsdetails</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Immobilie & Einheit Section */}
          <div className="space-y-6">
            <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
              <Collapsible open={isImmobilieExpanded} onOpenChange={setIsImmobilieExpanded}>
                <CollapsibleTrigger className="flex items-center justify-between w-full mb-4 hover:bg-blue-100/50 rounded-lg p-2 transition-colors">
                  <div className="flex items-center space-x-3">
                    <Building className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-800">Immobilie</h3>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-blue-600 transition-transform ${isImmobilieExpanded ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">Name</label>
                    <p className="text-lg font-semibold text-gray-900">{immobilie?.name || 'Nicht verfügbar'}</p>
                  </div>
                  <div className="flex items-start space-x-2">
                    <MapPin className="h-4 w-4 text-gray-500 mt-1" />
                    <div>
                      <label className="text-sm font-medium text-gray-600">Adresse</label>
                      <p className="text-gray-700">{immobilie?.adresse || 'Nicht verfügbar'}</p>
                    </div>
                  </div>
                </div>

                <CollapsibleContent className="mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-blue-200">
                    {immobilie?.objekttyp && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Objekttyp</label>
                        <p className="text-gray-900 capitalize">{immobilie.objekttyp}</p>
                      </div>
                    )}
                    {immobilie?.baujahr && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Baujahr</label>
                        <p className="text-gray-900">{immobilie.baujahr}</p>
                      </div>
                    )}
                    {immobilie?.einheiten_anzahl && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Anzahl Einheiten</label>
                        <p className="text-gray-900">{immobilie.einheiten_anzahl}</p>
                      </div>
                    )}
                    {immobilie?.kaufpreis && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Kaufpreis</label>
                        <p className="text-gray-900">€{immobilie.kaufpreis.toLocaleString()}</p>
                      </div>
                    )}
                    {immobilie?.["Kontonr."] && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Kontonummer</label>
                        <p className="text-gray-900 font-mono text-sm">{immobilie["Kontonr."]}</p>
                      </div>
                    )}
                    {immobilie?.["Annuität"] && (
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Annuität</label>
                        <p className="text-gray-900">€{immobilie["Annuität"].toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-100">
              <Collapsible open={isEinheitExpanded} onOpenChange={setIsEinheitExpanded}>
                <CollapsibleTrigger className="flex items-center justify-between w-full mb-4 hover:bg-green-100/50 rounded-lg p-2 transition-colors">
                  <div className="flex items-center space-x-3">
                    <Home className="h-5 w-5 text-green-600" />
                    <h3 className="text-lg font-semibold text-gray-800">Einheit</h3>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-green-600 transition-transform ${isEinheitExpanded ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">Einheit ID</label>
                    <p className="text-gray-900 font-mono text-sm bg-white px-3 py-2 rounded-lg border">
                      {einheit?.id?.slice(0, 8) || 'Keine ID'}...
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600 block mb-1">Etage</label>
                    <p className="text-gray-900">{einheit?.etage || 'Nicht angegeben'}</p>
                  </div>
                  {einheit?.qm && (
                    <div>
                      <label className="text-sm font-medium text-gray-600 block mb-1">Größe</label>
                      <p className="text-gray-900">{einheit.qm} m²</p>
                    </div>
                  )}
                </div>

                <CollapsibleContent className="mt-4">
                  <div className="pt-4 border-t border-green-200">
                    {/* Zählernummern - Always visible when unit section is expanded */}
                    {(einheit?.kaltwasser_zaehler || einheit?.warmwasser_zaehler || einheit?.strom_zaehler || einheit?.gas_zaehler) && (
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-green-700 mb-3 flex items-center space-x-2">
                          <Gauge className="h-4 w-4" />
                          <span>Zählernummern (fix angezeigt)</span>
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {einheit?.kaltwasser_zaehler && (
                            <div className="bg-white/80 p-3 rounded-lg border border-blue-200">
                              <div className="flex items-center space-x-2 mb-1">
                                <Droplet className="h-4 w-4 text-blue-600" />
                                <label className="text-sm font-medium text-gray-600">Kaltwasser</label>
                              </div>
                              <p className="text-gray-900 font-mono text-sm">{einheit.kaltwasser_zaehler}</p>
                            </div>
                          )}
                          {einheit?.warmwasser_zaehler && (
                            <div className="bg-white/80 p-3 rounded-lg border border-orange-200">
                              <div className="flex items-center space-x-2 mb-1">
                                <Thermometer className="h-4 w-4 text-orange-600" />
                                <label className="text-sm font-medium text-gray-600">Warmwasser</label>
                              </div>
                              <p className="text-gray-900 font-mono text-sm">{einheit.warmwasser_zaehler}</p>
                            </div>
                          )}
                          {einheit?.strom_zaehler && (
                            <div className="bg-white/80 p-3 rounded-lg border border-yellow-200">
                              <div className="flex items-center space-x-2 mb-1">
                                <Zap className="h-4 w-4 text-yellow-600" />
                                <label className="text-sm font-medium text-gray-600">Strom</label>
                              </div>
                              <p className="text-gray-900 font-mono text-sm">{einheit.strom_zaehler}</p>
                            </div>
                          )}
                          {einheit?.gas_zaehler && (
                            <div className="bg-white/80 p-3 rounded-lg border border-red-200">
                              <div className="flex items-center space-x-2 mb-1">
                                <Flame className="h-4 w-4 text-red-600" />
                                <label className="text-sm font-medium text-gray-600">Gas</label>
                              </div>
                              <p className="text-gray-900 font-mono text-sm">{einheit.gas_zaehler}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {einheit?.zaehler && (
                        <div className="bg-white/60 p-3 rounded-lg">
                          <div className="flex items-center space-x-2 mb-1">
                            <Hash className="h-4 w-4 text-green-600" />
                            <label className="text-sm font-medium text-gray-600">Alte Zählernummer</label>
                          </div>
                          <p className="text-gray-900 font-mono text-sm">{einheit.zaehler}</p>
                        </div>
                      )}
                      {einheit?.einheitentyp && (
                        <div className="bg-white/60 p-3 rounded-lg">
                          <div className="flex items-center space-x-2 mb-1">
                            <Layers className="h-4 w-4 text-green-600" />
                            <label className="text-sm font-medium text-gray-600">Einheitentyp</label>
                          </div>
                          <p className="text-gray-900 capitalize">{einheit.einheitentyp}</p>
                        </div>
                      )}
                      {einheit?.qm && (
                        <div className="bg-white/60 p-3 rounded-lg">
                          <div className="flex items-center space-x-2 mb-1">
                            <Square className="h-4 w-4 text-green-600" />
                            <label className="text-sm font-medium text-gray-600">Wohnfläche</label>
                          </div>
                          <p className="text-gray-900 font-semibold">{einheit.qm} m²</p>
                        </div>
                      )}
                      <div className="bg-white/60 p-3 rounded-lg">
                        <label className="text-sm font-medium text-gray-600 block mb-1">Vollständige ID</label>
                        <p className="text-gray-900 font-mono text-xs break-all">{einheit?.id || 'Keine ID'}</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Zählerstände Section */}
            <div className="p-6 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-100">
              <Collapsible open={isZaehlerstaendeExpanded} onOpenChange={setIsZaehlerstaendeExpanded}>
                <CollapsibleTrigger className="flex items-center justify-between w-full mb-4 hover:bg-amber-100/50 rounded-lg p-2 transition-colors">
                  <div className="flex items-center space-x-3">
                    <Gauge className="h-5 w-5 text-amber-600" />
                    <h3 className="text-lg font-semibold text-gray-800">Zählerstände</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    {!isEditingReadings ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingReadings(true);
                        }}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="flex space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveReadings();
                          }}
                          className="text-green-600 hover:text-green-700"
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelEdit();
                          }}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    <ChevronDown className={`h-4 w-4 text-amber-600 transition-transform ${isZaehlerstaendeExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </CollapsibleTrigger>
                
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Hier werden die Zählerstände bei Ein- und Auszug dokumentiert.
                  </p>
                </div>

                <CollapsibleContent className="mt-4">
                  <div className="space-y-6 pt-4 border-t border-amber-200">
                    {/* Einzug */}
                    <div>
                      <h4 className="text-sm font-semibold text-amber-700 mb-3 flex items-center space-x-2">
                        <Calendar className="h-4 w-4" />
                        <span>Bei Einzug</span>
                        {vertrag?.start_datum && (
                          <span className="text-xs text-gray-500 font-normal">
                            ({new Date(vertrag.start_datum).toLocaleDateString('de-DE')})
                          </span>
                        )}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-white/80 p-3 rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Droplet className="h-4 w-4 text-blue-600" />
                            <label className="text-sm font-medium text-gray-600">Kaltwasser</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.kaltwasser_einzug}
                              onChange={(e) => setEditedReadings({...editedReadings, kaltwasser_einzug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.kaltwasser_einzug ? `${vertrag.kaltwasser_einzug} m³` : 'Nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-orange-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Thermometer className="h-4 w-4 text-orange-600" />
                            <label className="text-sm font-medium text-gray-600">Warmwasser</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.warmwasser_einzug}
                              onChange={(e) => setEditedReadings({...editedReadings, warmwasser_einzug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.warmwasser_einzug ? `${vertrag.warmwasser_einzug} m³` : 'Nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-yellow-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Zap className="h-4 w-4 text-yellow-600" />
                            <label className="text-sm font-medium text-gray-600">Strom</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.strom_einzug}
                              onChange={(e) => setEditedReadings({...editedReadings, strom_einzug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.strom_einzug ? `${vertrag.strom_einzug} kWh` : 'Nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-red-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Flame className="h-4 w-4 text-red-600" />
                            <label className="text-sm font-medium text-gray-600">Gas</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.gas_einzug}
                              onChange={(e) => setEditedReadings({...editedReadings, gas_einzug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.gas_einzug ? `${vertrag.gas_einzug} m³` : 'Nicht erfasst'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Auszug */}
                    <div>
                      <h4 className="text-sm font-semibold text-amber-700 mb-3 flex items-center space-x-2">
                        <Calendar className="h-4 w-4" />
                        <span>Bei Auszug</span>
                        {vertrag?.kuendigungsdatum && (
                          <span className="text-xs text-gray-500 font-normal">
                            ({new Date(vertrag.kuendigungsdatum).toLocaleDateString('de-DE')})
                          </span>
                        )}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-white/80 p-3 rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Droplet className="h-4 w-4 text-blue-600" />
                            <label className="text-sm font-medium text-gray-600">Kaltwasser</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.kaltwasser_auszug}
                              onChange={(e) => setEditedReadings({...editedReadings, kaltwasser_auszug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.kaltwasser_auszug ? `${vertrag.kaltwasser_auszug} m³` : 'Noch nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-orange-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Thermometer className="h-4 w-4 text-orange-600" />
                            <label className="text-sm font-medium text-gray-600">Warmwasser</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.warmwasser_auszug}
                              onChange={(e) => setEditedReadings({...editedReadings, warmwasser_auszug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.warmwasser_auszug ? `${vertrag.warmwasser_auszug} m³` : 'Noch nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-yellow-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Zap className="h-4 w-4 text-yellow-600" />
                            <label className="text-sm font-medium text-gray-600">Strom</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.strom_auszug}
                              onChange={(e) => setEditedReadings({...editedReadings, strom_auszug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.strom_auszug ? `${vertrag.strom_auszug} kWh` : 'Noch nicht erfasst'}
                            </p>
                          )}
                        </div>
                        <div className="bg-white/80 p-3 rounded-lg border border-red-200">
                          <div className="flex items-center space-x-2 mb-1">
                            <Flame className="h-4 w-4 text-red-600" />
                            <label className="text-sm font-medium text-gray-600">Gas</label>
                          </div>
                          {isEditingReadings ? (
                            <Input
                              type="number"
                              step="0.1"
                              value={editedReadings.gas_auszug}
                              onChange={(e) => setEditedReadings({...editedReadings, gas_auszug: e.target.value})}
                              className="text-sm"
                              placeholder="0.0"
                            />
                          ) : (
                            <p className="text-gray-900 font-mono text-sm">
                              {vertrag?.gas_auszug ? `${vertrag.gas_auszug} m³` : 'Noch nicht erfasst'}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {/* Mietdaten Section */}
          <div className="space-y-6">
            <div className="p-6 bg-gradient-to-br from-red-50 to-pink-50 rounded-xl border border-red-100">
              <div className="flex items-center space-x-3 mb-4">
                <Euro className="h-5 w-5 text-red-600" />
                <h3 className="text-lg font-semibold text-gray-800">Mietkosten</h3>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-white p-4 rounded-lg border border-red-100">
                  <label className="text-sm font-medium text-gray-600 block mb-1">Kaltmiete</label>
                  <p className="text-2xl font-bold text-red-600">
                    {vertrag?.kaltmiete ? `${vertrag.kaltmiete.toLocaleString()}€` : 'Nicht angegeben'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-lg border border-red-100">
                  <label className="text-sm font-medium text-gray-600 block mb-1">Warmmiete</label>
                  <p className="text-2xl font-bold text-gray-800">
                    {vertrag?.warmmiete ? `${vertrag.warmmiete.toLocaleString()}€` : 'Nicht angegeben'}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border border-purple-100">
              <div className="flex items-center space-x-3 mb-4">
                <Calendar className="h-5 w-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-gray-800">Laufzeit</h3>
              </div>
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-lg border border-purple-100">
                  <label className="text-sm font-medium text-gray-600 block mb-1">Vertragsbeginn</label>
                  <p className="text-lg font-semibold text-gray-900">
                    {vertrag?.start_datum 
                      ? new Date(vertrag.start_datum).toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })
                      : 'Nicht angegeben'
                    }
                  </p>
                </div>
                <div className="bg-white p-4 rounded-lg border border-purple-100">
                  <label className="text-sm font-medium text-gray-600 block mb-1">Vertragsende</label>
                  <p className="text-lg font-semibold text-gray-900">
                    {getVertragsende(vertrag)
                      ? new Date(getVertragsende(vertrag)!).toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric'
                        })
                      : 'Unbefristet'
                    }
                  </p>
                </div>
                
                {vertrag?.status === 'gekuendigt' && vertrag?.kuendigungsdatum && (
                  <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                    <div className="flex items-center space-x-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <label className="text-sm font-medium text-yellow-800">Kündigungsdatum</label>
                    </div>
                    <p className="text-lg font-semibold text-yellow-900">
                      {new Date(vertrag.kuendigungsdatum).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric'
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};