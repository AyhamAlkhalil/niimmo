import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { calculateMietvertragRueckstand } from "@/utils/rueckstandsberechnung";
import { MietvertragTimelineView } from "./MietvertragTimelineView";
import { LinkedContractsTimeline } from "./LinkedContractsTimeline";
import { useLinkedContracts } from "@/hooks/useLinkedContracts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, TrendingDown, TrendingUp, AlertCircle, CheckCircle, Link2, Building2, Settings } from "lucide-react";

interface MietvertragPaymentsSectionProps {
  vertrag: any;
  forderungen: any[];
  zahlungen: any[];
  allMietvertraege?: any[];
  vertragId: string;
  mieterIds?: string[];
  einheit?: any;
  immobilie?: any;
  formatBetrag: (betrag: number) => string;
  formatDatum: (datum: string) => string;
  onCreateForderung: () => void;
  onContractUpdate?: () => void;
}

export function MietvertragPaymentsSection({
  vertrag,
  forderungen,
  zahlungen,
  allMietvertraege,
  vertragId,
  mieterIds = [],
  einheit,
  immobilie,
  formatBetrag,
  formatDatum,
  onCreateForderung,
  onContractUpdate
}: MietvertragPaymentsSectionProps) {
  const [showLinkedTimeline, setShowLinkedTimeline] = useState(false);
  const [selectedLinkedContract, setSelectedLinkedContract] = useState<any>(null);
  const [lastschriftPopoverOpen, setLastschriftPopoverOpen] = useState(false);
  const [lastschriftEnabled, setLastschriftEnabled] = useState(vertrag?.lastschrift || false);
  const [isSaving, setIsSaving] = useState(false);

  // Check for linked contracts (same tenant, different units)
  const { linkedContracts, hasLinkedContracts } = useLinkedContracts(vertragId, mieterIds);

  const handleLastschriftSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('mietvertrag')
        .update({
          lastschrift: lastschriftEnabled,
        })
        .eq('id', vertragId);

      if (error) throw error;
      
      toast.success('Lastschrift-Einstellungen gespeichert');
      setLastschriftPopoverOpen(false);
      onContractUpdate?.();
    } catch (error) {
      toast.error('Fehler beim Speichern');
    } finally {
      setIsSaving(false);
    }
  };

  const rueckstandsBerechnung = calculateMietvertragRueckstand(
    vertrag, 
    forderungen || [], 
    zahlungen || []
  );
  
  const { gesamtForderungen, gesamtZahlungen, rueckstand } = rueckstandsBerechnung;

  const alleForderungenAbStart = (forderungen || []).filter(f => f.sollmonat);
  const faelligeForderungen = alleForderungenAbStart;
  const nichtFaelligeForderungen: any[] = [];

  // BKA-Einträge separat aufschlüsseln
  const bkaForderungen = alleForderungenAbStart.filter(f => f.typ === 'BKA');
  const bkaNachzahlungen = bkaForderungen.filter(f => Number(f.sollbetrag) > 0);
  const bkaGuthaben = bkaForderungen.filter(f => Number(f.sollbetrag) < 0);
  const bkaNachzahlungBetrag = bkaNachzahlungen.reduce((s, f) => s + Number(f.sollbetrag), 0);
  const bkaGuthabenBetrag = Math.abs(bkaGuthaben.reduce((s, f) => s + Number(f.sollbetrag), 0));

  // Fällige Forderungen = alle (Miete + BKA Nachzahlungen); BKA-Guthaben mindern den Betrag
  const faelligeForderungenBetrag = faelligeForderungen.reduce((sum, f) => sum + (Number(f.sollbetrag) || 0), 0);
  const nichtFaelligeForderungenBetrag = 0;

  return (
    <>
      {/* Overview Cards */}
      <Card>
        <CardHeader>
          <CardTitle>Finanzübersicht</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Fällige Forderungen */}
            <div className={`metric-card p-6 rounded-xl transition-all duration-300 hover:scale-[1.02] ${
              faelligeForderungenBetrag > 0 
                ? 'border-destructive/20 bg-gradient-to-br from-destructive/5 via-destructive/3 to-transparent' 
                : 'border-muted bg-gradient-to-br from-muted/50 to-transparent'
            }`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-lg ${faelligeForderungenBetrag > 0 ? 'bg-destructive/10' : 'bg-muted/50'}`}>
                  <AlertCircle className={`h-5 w-5 ${faelligeForderungenBetrag > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {faelligeForderungen.length} Forderung{faelligeForderungen.length !== 1 ? 'en' : ''}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className={`text-sm font-medium ${faelligeForderungenBetrag > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  Fällige Forderungen
                </p>
                <p className={`text-2xl font-bold ${faelligeForderungenBetrag > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {formatBetrag(faelligeForderungenBetrag)}
                </p>
              </div>
            </div>

            {/* Geleistete Zahlungen */}
            <div className="metric-card p-6 rounded-xl transition-all duration-300 hover:scale-[1.02] border-primary/20 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    Eingegangen
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-primary">Geleistete Zahlungen</p>
                <p className="text-2xl font-bold text-primary">
                  {formatBetrag(gesamtZahlungen)}
                </p>
              </div>
            </div>

            {/* Rückstand / Guthaben */}
            <div className={`metric-card p-6 rounded-xl transition-all duration-300 hover:scale-[1.02] ${
              rueckstand > 0 
                ? 'border-yellow-400/30 bg-gradient-to-br from-yellow-50/80 via-yellow-25/40 to-transparent' 
                : 'border-green-400/30 bg-gradient-to-br from-green-50/80 via-green-25/40 to-transparent'
            }`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-lg ${rueckstand > 0 ? 'bg-yellow-100' : 'bg-green-100'}`}>
                  {rueckstand > 0 ? (
                    <TrendingDown className="h-5 w-5 text-yellow-600" />
                  ) : (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className={`text-sm font-medium ${rueckstand > 0 ? 'text-yellow-700' : 'text-green-700'}`}>
                  {rueckstand > 0 ? 'Rückstand' : (rueckstand < 0 ? 'Guthaben' : 'Kein Rückstand')}
                </p>
                <p className={`text-2xl font-bold ${rueckstand > 0 ? 'text-yellow-800' : 'text-green-800'}`}>
                  {formatBetrag(Math.abs(rueckstand))}
                </p>
              </div>
            </div>
          </div>

          {/* BKA-Hinweis wenn BKA-Einträge vorhanden */}
          {bkaForderungen.length > 0 && (
            <div className="mt-4 pt-4 border-t border-muted flex flex-wrap gap-3">
              {bkaNachzahlungen.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                  <span className="font-semibold">BKA-Nachzahlung</span>
                  <span>{bkaNachzahlungen.length}×</span>
                  <span className="font-bold">{formatBetrag(bkaNachzahlungBetrag)}</span>
                </div>
              )}
              {bkaGuthaben.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  <span className="font-semibold">BKA-Guthaben</span>
                  <span>{bkaGuthaben.length}×</span>
                  <span className="font-bold">−{formatBetrag(bkaGuthabenBetrag)}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground self-center">
                BKA-Salden sind bereits im Rückstand eingerechnet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Contracts Badge & Timeline Toggle */}
      {hasLinkedContracts && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Link2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Verbundene Verträge erkannt</p>
                  <p className="text-xs text-muted-foreground">
                    Die Mieter haben {linkedContracts.length} weitere{linkedContracts.length === 1 ? 'n' : ''} Vertrag/Verträge
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {linkedContracts.map((contract) => (
                  <Button
                    key={contract.id}
                    variant={selectedLinkedContract?.id === contract.id && showLinkedTimeline ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (selectedLinkedContract?.id === contract.id && showLinkedTimeline) {
                        setShowLinkedTimeline(false);
                        setSelectedLinkedContract(null);
                      } else {
                        setSelectedLinkedContract(contract);
                        setShowLinkedTimeline(true);
                      }
                    }}
                    className="gap-2"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="max-w-[150px] truncate">
                      {contract.einheit?.immobilie?.name || 'Objekt'} - {contract.einheit?.etage || 'EG'}
                    </span>
                    <Badge variant="secondary" className="text-xs ml-1">
                      {formatBetrag((contract.kaltmiete || 0) + (contract.betriebskosten || 0))}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked Contracts Dual Timeline View */}
      {showLinkedTimeline && selectedLinkedContract && (
        <LinkedContractsTimeline
          currentContractId={vertragId}
          currentContractLabel={`${immobilie?.name || 'Aktuelles Objekt'} - ${einheit?.etage || 'EG'}`}
          linkedContract={selectedLinkedContract}
          formatBetrag={formatBetrag}
          formatDatum={formatDatum}
          onClose={() => {
            setShowLinkedTimeline(false);
            setSelectedLinkedContract(null);
          }}
        />
      )}

      {/* Timeline Section */}
      <Card className="elegant-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Zahlungen & Forderungen Timeline</CardTitle>
            <div className="flex items-center space-x-4">
              {/* Lastschrift Status with Popover */}
              <Popover open={lastschriftPopoverOpen} onOpenChange={setLastschriftPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className={`gap-2 ${vertrag?.lastschrift ? 'border-primary/30 bg-primary/5' : ''}`}
                  >
                    <Settings className="h-4 w-4" />
                    <span className="text-sm">Lastschrift:</span>
                    <Badge variant={vertrag?.lastschrift ? "default" : "secondary"} className="text-xs">
                      {vertrag?.lastschrift ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Lastschrift-Einstellungen</h4>
                      <p className="text-xs text-muted-foreground">
                        Markiert den Vertrag als Lastschrift-Vertrag. Rücklastschriften erzeugen automatisch Rückstände.
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <Label htmlFor="lastschrift-toggle" className="text-sm">
                        Lastschrift aktiviert
                      </Label>
                      <Switch
                        id="lastschrift-toggle"
                        checked={lastschriftEnabled}
                        onCheckedChange={setLastschriftEnabled}
                      />
                    </div>
                    
                    <div className="flex justify-end gap-2 pt-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => {
                          setLastschriftEnabled(vertrag?.lastschrift || false);
                          setLastschriftPopoverOpen(false);
                        }}
                      >
                        Abbrechen
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={handleLastschriftSave}
                        disabled={isSaving}
                      >
                        {isSaving ? 'Speichern...' : 'Speichern'}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              
              <Button
                variant="outline"
                size="sm"
                onClick={onCreateForderung}
                className="modern-button-ghost hover:bg-primary/5 hover:border-primary/20"
              >
                <Plus className="h-4 w-4 mr-2" />
                Forderung erstellen
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <MietvertragTimelineView
            forderungen={forderungen}
            zahlungen={zahlungen}
            allMietvertraege={allMietvertraege}
            vertragId={vertragId}
            vertrag={vertrag}
            formatDatum={formatDatum}
            formatBetrag={formatBetrag}
          />
        </CardContent>
      </Card>

    </>
  );
}