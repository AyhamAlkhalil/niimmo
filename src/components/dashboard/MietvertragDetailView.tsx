
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, FileText, User, Euro, Calendar, CheckCircle, XCircle, FolderOpen } from "lucide-react";
import { Loader2 } from "lucide-react";
import { DokumentenModal } from "./DokumentenModal";
import { TerminationDialog } from "./termination/TerminationDialog";

interface MietvertragDetailViewProps {
  einheitId: string;
  onBack: () => void;
  einheit?: any;
  immobilie?: any;
  onContractChange?: () => void;
}

export const MietvertragDetailView = ({ einheitId, onBack, einheit, immobilie, onContractChange }: MietvertragDetailViewProps) => {
  const [selectedMietvertragId, setSelectedMietvertragId] = useState<string | null>(null);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [terminationVertragId, setTerminationVertragId] = useState<string | null>(null);
  const handleTerminationClick = (vertragId: string) => {
    setTerminationVertragId(vertragId);
    setShowTerminationDialog(true);
  };

  const handleTerminationSuccess = () => {
    setShowTerminationDialog(false);
    setTerminationVertragId(null);
    onContractChange?.();
  };

  const { data: alleMietvertraege, isLoading: vertraegeLoading } = useQuery({
    queryKey: ['alle-mietvertrag-einheit', einheitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select('*')
        .eq('einheit_id', einheitId)
        .order('id', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  const aktuellerVertrag = alleMietvertraege?.[0];
  const alteVertraege = alleMietvertraege?.slice(1) || [];

  const { data: mieterData } = useQuery({
    queryKey: ['mietvertrag-mieter-all', alleMietvertraege?.map(v => v.id)],
    queryFn: async () => {
      if (!alleMietvertraege?.length) return {};
      
      const vertragIds = alleMietvertraege.map(v => v.id);
      const { data, error } = await supabase
        .from('mietvertrag_mieter')
        .select(`
          mietvertrag_id,
          mieter_id,
          mieter:mieter_id (
            id,
            vorname,
            nachname,
            hauptmail,
            weitere_mails,
            telnr,
            geburtsdatum
          )
        `)
        .in('mietvertrag_id', vertragIds);
      
      if (error) throw error;
      
      const mieterByVertrag = {};
      data?.forEach(mm => {
        if (!mieterByVertrag[mm.mietvertrag_id]) {
          mieterByVertrag[mm.mietvertrag_id] = [];
        }
        mieterByVertrag[mm.mietvertrag_id].push({
          ...mm.mieter
        });
      });
      
      return mieterByVertrag;
    },
    enabled: !!alleMietvertraege?.length
  });

  const { data: zahlungenData } = useQuery({
    queryKey: ['zahlungen-by-vertrag', alleMietvertraege?.map(v => v.id)],
    queryFn: async () => {
      if (!alleMietvertraege?.length) return {};
      
      const vertragIds = alleMietvertraege.map(v => v.id);
      const { data, error } = await supabase
        .from('zahlungen')
        .select('*')
        .in('mietvertrag_id', vertragIds)
        .order('buchungsdatum', { ascending: false });
      
      if (error) throw error;
      
      const zahlungenByVertrag = {};
      data?.forEach(zahlung => {
        if (!zahlungenByVertrag[zahlung.mietvertrag_id]) {
          zahlungenByVertrag[zahlung.mietvertrag_id] = [];
        }
        zahlungenByVertrag[zahlung.mietvertrag_id].push(zahlung);
      });
      
      return zahlungenByVertrag;
    },
    enabled: !!alleMietvertraege?.length
  });

  const generateZahlungshistorie = (vertrag: any) => {
    if (!vertrag) return [];
    
    // Prüfe ob Mietvertrag beendet ist
    const heute = new Date();
    const istBeendet = vertrag.status === 'beendet' || 
                      (vertrag.ende_datum && new Date(vertrag.ende_datum) < heute);
    
    // Wenn beendet, keine Zahlungshistorie generieren
    if (istBeendet) {
      return [];
    }
    
    const payments = [];
    const startDate = new Date('2025-07-01');
    const currentDate = new Date();
    const endDate = vertrag.ende_datum ? new Date(vertrag.ende_datum) : currentDate;
    
    const checkDate = new Date(startDate);
    while (checkDate <= endDate && checkDate <= currentDate) {  
      const isPaid = false; // Bei leerer Zahlungstabelle ist nichts bezahlt
      payments.push({
        id: `${vertrag.id}-${checkDate.getFullYear()}-${checkDate.getMonth()}`,
        monat: checkDate.toISOString().split('T')[0],
        betrag: vertrag.kaltmiete || 0,
        bezahlt: isPaid,
        bezahlt_am: isPaid ? new Date(checkDate.getTime() + Math.random() * 10 * 24 * 60 * 60 * 1000).toISOString() : null
      });
      
      checkDate.setMonth(checkDate.getMonth() + 1);
    }
    
    return payments.reverse();
  };

  const MietvertragCard = ({ vertrag, mieter, isAktuell = false }: { vertrag: any, mieter: any[], isAktuell?: boolean }) => {
    const zahlungshistorie = generateZahlungshistorie(vertrag);
    const zugeordneteZahlungen = zahlungenData?.[vertrag.id] || [];
    
    // Berechne Gesamtsaldo
    const sollbetragProMonat = (vertrag.kaltmiete || 0) + (vertrag.betriebskosten || 0);
    const anzahlMonate = zahlungshistorie.length;
    const gesamtSoll = sollbetragProMonat * anzahlMonate;
    const gesamtErhaltene = zugeordneteZahlungen.reduce((sum, z) => sum + (z.betrag || 0), 0);
    const gesamtsaldo = gesamtErhaltene - gesamtSoll;
    
    // Annahme: Lastschriftverfahren Flag (noch nicht in DB)
    const istLastschrift = vertrag.lastschrift_verfahren === true;
    
    return (
      <Card className={`${isAktuell ? 'border-green-500 shadow-lg' : 'border-gray-200'}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="h-6 w-6 text-blue-600" />
              <div>
                <CardTitle className="text-xl">
                  Mietvertrag {isAktuell ? '(Aktuell)' : '(Historisch)'}
                </CardTitle>
                <p className="text-sm text-gray-600">
                  {vertrag.start_datum && new Date(vertrag.start_datum).toLocaleDateString('de-DE')} 
                  {vertrag.ende_datum && ` - ${new Date(vertrag.ende_datum).toLocaleDateString('de-DE')}`}
                </p>
              </div>
            </div>
            <Badge className={vertrag.status === 'aktiv' ? 'bg-green-600' : 'bg-yellow-600'}>
              {vertrag.status}
            </Badge>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Mietinformationen */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2">
              <Euro className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Kaltmiete</p>
                <p className="font-semibold">{vertrag.kaltmiete || 0}€</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Euro className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-sm text-gray-600">Betriebskosten</p>
                <p className="font-semibold">{vertrag.betriebskosten || 0}€</p>
              </div>
            </div>
            {vertrag.warmmiete && (
              <div className="flex items-center space-x-2">
                <Euro className="h-4 w-4 text-orange-500" />
                <div>
                  <p className="text-sm text-gray-600">Warmmiete</p>
                  <p className="font-semibold text-orange-600">{vertrag.warmmiete}€</p>
                </div>
              </div>
            )}
          </div>

          {/* Mieter */}
          {mieter && mieter.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold flex items-center space-x-2">
                <User className="h-4 w-4" />
                <span>Mieter</span>
              </h4>
              <div className="space-y-2">
                {mieter.map((m, index) => (
                  <div key={index} className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">{m.vorname} {m.nachname}</p>
                        <p className="text-sm text-gray-600">{m.telnr || m.hauptmail}</p>
                        {m.geburtsdatum && (
                          <p className="text-sm text-gray-500">
                            Geb.: {new Date(m.geburtsdatum).toLocaleDateString('de-DE')}
                          </p>
                        )}
                        {m.weitere_mails && (
                          <p className="text-sm text-gray-500">{m.weitere_mails}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zahlungshistorie */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center space-x-2">
                <Calendar className="h-4 w-4" />
                <span>Zahlungshistorie</span>
              </h4>
              <div className="text-right">
                <p className="text-sm text-gray-600">Gesamtsaldo</p>
                <p className={`font-bold ${gesamtsaldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {gesamtsaldo >= 0 ? '+' : ''}{gesamtsaldo.toFixed(2)}€
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              {zahlungshistorie.map((zahlung) => {
                const sollbetrag = (vertrag?.kaltmiete || 0) + (vertrag?.betriebskosten || 0);
                
                // Wenn Sollbetrag 0€ ist, automatisch als bezahlt markieren
                const istBezahlt = zahlung.bezahlt || sollbetrag === 0;
                
                return (
                  <div 
                    key={zahlung.id} 
                    className={`p-3 rounded-lg border-l-4 ${
                      istBezahlt 
                        ? 'bg-green-50 border-green-500' 
                        : istLastschrift && !zahlung.bezahlt
                        ? 'bg-yellow-50 border-yellow-500'
                        : 'bg-red-50 border-red-500'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-3">
                        {istBezahlt ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : istLastschrift ? (
                          <div className="h-5 w-5 rounded-full bg-yellow-500 flex items-center justify-center">
                            <div className="h-2 w-2 rounded-full bg-white"></div>
                          </div>
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600" />
                        )}
                        <div>
                          <p className="font-medium">
                            {new Date(zahlung.monat).toLocaleDateString('de-DE', { 
                              month: 'long', 
                              year: 'numeric' 
                            })}
                          </p>
                          <p className="text-sm text-gray-600">
                            Soll: {sollbetrag.toFixed(2)}€ (Kaltmiete + Betriebskosten)
                          </p>
                          <p className="text-xs text-gray-500">
                            {istBezahlt 
                              ? sollbetrag === 0 
                                ? 'Automatisch bezahlt (0€ Sollbetrag)'
                                : `Bezahlt am ${new Date(zahlung.bezahlt_am).toLocaleDateString('de-DE')}`
                              : istLastschrift 
                              ? 'Lastschrift eingereicht'
                              : 'Noch ausstehend'
                            }
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{sollbetrag.toFixed(2)}€</p>
                        <Badge 
                          variant={istBezahlt ? "default" : istLastschrift && !zahlung.bezahlt ? "secondary" : "destructive"}
                          className={
                            istBezahlt 
                              ? "bg-green-600 hover:bg-green-700" 
                              : istLastschrift && !zahlung.bezahlt
                              ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                              : ""
                          }
                        >
                          {istBezahlt ? 'Bezahlt' : istLastschrift ? 'Lastschrift' : 'Offen'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Zugeordnete Überweisungen */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <h5 className="font-semibold mb-3 flex items-center space-x-2">
                <Euro className="h-4 w-4" />
                <span>Zugeordnete Überweisungen</span>
              </h5>
              <div className="space-y-2">
                {zugeordneteZahlungen.map((zahlung) => (
                  <div key={zahlung.id} className="flex items-center justify-between p-2 bg-blue-50 rounded-lg border border-blue-200">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {zahlung.buchungsdatum ? new Date(zahlung.buchungsdatum).toLocaleDateString('de-DE') : 'Unbekannt'}
                      </p>
                      <p className="text-xs text-gray-600 truncate max-w-48">
                        {zahlung.verwendungszweck || 'Keine Beschreibung'}
                      </p>
                    </div>
                    <p className="font-bold text-green-600">+{Number(zahlung.betrag).toFixed(2)}€</p>
                  </div>
                ))}
                {zugeordneteZahlungen.length === 0 && (
                  <p className="text-sm text-gray-500 italic">Keine Überweisungen zugeordnet</p>
                )}
              </div>
            </div>
          </div>

          {/* Dokumente Button */}
          <div className="pt-4 border-t space-y-2">
            <Button 
              onClick={() => setSelectedMietvertragId(vertrag.id)}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Dokumente anzeigen
            </Button>
            
            {/* Termination Button for active contracts */}
            {vertrag.status === 'aktiv' && isAktuell && (
              <Button
                variant="destructive"
                onClick={() => handleTerminationClick(vertrag.id)}
                className="w-full"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Mietvertrag kündigen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (vertraegeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={onBack}
            className="mb-4 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Einheit
          </Button>
          
          <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Mietverträge - {einheit?.nummer ? `Einheit ${einheit.nummer}` : 'Einheit'}
            </h1>
            {immobilie && (
              <p className="text-gray-600">{immobilie.name} - {immobilie.adresse}</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Aktueller Mietvertrag */}
          {aktuellerVertrag && (
            <MietvertragCard 
              vertrag={aktuellerVertrag} 
              mieter={mieterData?.[aktuellerVertrag.id] || []}
              isAktuell={true}
            />
          )}

          {/* Alte Mietverträge */}
          {alteVertraege.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Historische Mietverträge</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="space-y-2">
                  {alteVertraege.map((vertrag, index) => (
                    <AccordionItem key={vertrag.id} value={`vertrag-${index}`}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center justify-between w-full mr-4">
                          <span>
                            Vertrag vom {vertrag.start_datum && new Date(vertrag.start_datum).toLocaleDateString('de-DE')}
                            {vertrag.ende_datum && ` bis ${new Date(vertrag.ende_datum).toLocaleDateString('de-DE')}`}
                          </span>
                          <Badge variant="outline">{vertrag.status}</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="pt-4">
                          <MietvertragCard 
                            vertrag={vertrag} 
                            mieter={mieterData?.[vertrag.id] || []}
                            isAktuell={false}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}

          {(!alleMietvertraege || alleMietvertraege.length === 0) && (
            <Card>
              <CardContent className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Keine Mietverträge für diese Einheit gefunden</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Dokumenten Modal */}
        {selectedMietvertragId && (
          <DokumentenModal
            isOpen={!!selectedMietvertragId}
            onClose={() => setSelectedMietvertragId(null)}
            mietvertragId={selectedMietvertragId}
            einheit={einheit}
            immobilie={immobilie}
          />
        )}

        {/* Termination Dialog */}
        {terminationVertragId && (
          <TerminationDialog
            isOpen={showTerminationDialog}
            onClose={() => {
              setShowTerminationDialog(false);
              setTerminationVertragId(null);
            }}
            vertragId={terminationVertragId}
            einheit={einheit}
            immobilie={immobilie}
            onTerminationSuccess={handleTerminationSuccess}
          />
        )}
      </div>
    </div>
  );
};
