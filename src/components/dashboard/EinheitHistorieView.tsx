import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Users, Euro, Building2, Clock, FileText, Pencil, Check, X } from "lucide-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MietvertragDetailsModal from "./MietvertragDetailsModal";

interface EinheitHistorieViewProps {
  einheitId: string;
  onBack: () => void;
  einheit?: any;
  immobilie?: any;
}

interface Periode {
  type: 'vertrag' | 'leerstand';
  startDatum: Date;
  endDatum: Date | null;
  vertrag?: any;
  mieter?: any[];
  isAktuell?: boolean;
}

export const EinheitHistorieView = ({ einheitId, onBack, einheit, immobilie }: EinheitHistorieViewProps) => {
  const [selectedVertragId, setSelectedVertragId] = useState<string | null>(null);
  const [isEditingSoll, setIsEditingSoll] = useState(false);
  const [sollValue, setSollValue] = useState<string>("");
  const [currentSollMiete, setCurrentSollMiete] = useState<number | null>(einheit?.soll_miete ?? null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSollSave = useCallback(async () => {
    const trimmed = sollValue.trim();
    const value = trimmed === "" ? null : parseFloat(trimmed.replace(",", "."));
    if (value !== null && (isNaN(value) || value < 0)) {
      setIsEditingSoll(false);
      return;
    }
    const { error } = await supabase.from("einheiten").update({ soll_miete: value }).eq("id", einheitId);
    if (error) {
      toast({ title: "Fehler", description: "SOLL-Miete konnte nicht gespeichert werden.", variant: "destructive" });
    } else {
      setCurrentSollMiete(value);
      queryClient.invalidateQueries({ queryKey: ["mietaufstellung-bank"] });
      queryClient.invalidateQueries({ queryKey: ["einheiten"] });
    }
    setIsEditingSoll(false);
  }, [sollValue, einheitId, toast, queryClient]);

  const { data: alleMietvertraege, isLoading: vertraegeLoading } = useQuery({
    queryKey: ['alle-mietvertrag-einheit-historie', einheitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select('*')
        .eq('einheit_id', einheitId)
        .order('start_datum', { ascending: true });
      
      if (error) throw error;
      return data || [];
    }
  });

  const { data: mieterData } = useQuery({
    queryKey: ['mietvertrag-mieter-historie', alleMietvertraege?.map(v => v.id)],
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
            telnr,
            geburtsdatum
          )
        `)
        .in('mietvertrag_id', vertragIds);
      
      if (error) throw error;
      
      // Group tenants by contract ID - preserve ALL tenant associations regardless of contract status
      const mieterByVertrag: Record<string, any[]> = {};
      data?.forEach(mm => {
        if (!mieterByVertrag[mm.mietvertrag_id]) {
          mieterByVertrag[mm.mietvertrag_id] = [];
        }
        if (mm.mieter) {
          mieterByVertrag[mm.mietvertrag_id].push(mm.mieter);
        }
      });
      
      return mieterByVertrag;
    },
    enabled: !!alleMietvertraege?.length
  });

  // Generate timeline periods including vacancy periods
  const generateTimeline = (): Periode[] => {
    if (!alleMietvertraege || alleMietvertraege.length === 0) return [];

    const sortedVertraege = [...alleMietvertraege].sort((a, b) => 
      new Date(a.start_datum || '1900-01-01').getTime() - new Date(b.start_datum || '1900-01-01').getTime()
    );

    const perioden: Periode[] = [];
    const heute = new Date();

    sortedVertraege.forEach((vertrag, index) => {
      const startDatum = new Date(vertrag.start_datum || '1900-01-01');
      const endDatum = vertrag.kuendigungsdatum ? new Date(vertrag.kuendigungsdatum) : 
                      vertrag.ende_datum ? new Date(vertrag.ende_datum) : null;
      
      // Check for vacancy period before this contract
      if (index > 0) {
        const vorherigendesVertrag = sortedVertraege[index - 1];
        const vorherigesEndDatum = vorherigendesVertrag.kuendigungsdatum ? 
          new Date(vorherigendesVertrag.kuendigungsdatum) : 
          vorherigendesVertrag.ende_datum ? new Date(vorherigendesVertrag.ende_datum) : null;
        
        if (vorherigesEndDatum && vorherigesEndDatum < startDatum) {
          // Calculate days between contracts
          const daysDifference = Math.ceil((startDatum.getTime() - vorherigesEndDatum.getTime()) / (1000 * 60 * 60 * 24));
          
          // Only add vacancy period if more than 5 days
          if (daysDifference > 5) {
            perioden.push({
              type: 'leerstand',
              startDatum: vorherigesEndDatum,
              endDatum: startDatum
            });
          }
        }
      }

      // Add contract period
      const isAktuell = vertrag.status === 'aktiv' && (!endDatum || endDatum > heute);
      perioden.push({
        type: 'vertrag',
        startDatum,
        endDatum,
        vertrag,
        mieter: mieterData?.[vertrag.id] || [],
        isAktuell
      });
    });

    // Check for vacancy at the end
    const letzterVertrag = sortedVertraege[sortedVertraege.length - 1];
    if (letzterVertrag) {
      const letzteEndDatum = letzterVertrag.kuendigungsdatum ? 
        new Date(letzterVertrag.kuendigungsdatum) : 
        letzterVertrag.ende_datum ? new Date(letzterVertrag.ende_datum) : null;
      
      if (letzteEndDatum && letzteEndDatum < heute && letzterVertrag.status !== 'aktiv') {
        // Check if more than 5 days have passed since the last contract ended
        const daysSinceEnd = Math.ceil((heute.getTime() - letzteEndDatum.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysSinceEnd > 5) {
          perioden.push({
            type: 'leerstand',
            startDatum: letzteEndDatum,
            endDatum: null // Ongoing vacancy
          });
        }
      }
    }

    // Sort timeline so most current contracts appear first
    return perioden.reverse();
  };

  const timeline = generateTimeline();

  const formatDatum = (datum: Date) => {
    return datum.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const calculateDuration = (start: Date, end: Date | null) => {
    const endDate = end || new Date();
    const diffTime = Math.abs(endDate.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const months = Math.floor(diffDays / 30);
    const days = diffDays % 30;
    
    if (months > 0) {
      return `${months} Monat${months > 1 ? 'e' : ''} ${days > 0 ? `${days} Tag${days > 1 ? 'e' : ''}` : ''}`;
    }
    return `${diffDays} Tag${diffDays > 1 ? 'e' : ''}`;
  };

  if (vertraegeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-fit p-6">
      <MietvertragDetailsModal
        isOpen={!!selectedVertragId}
        onClose={() => setSelectedVertragId(null)}
        vertragId={selectedVertragId || ''}
        einheit={einheit}
        immobilie={immobilie}
      />
      
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={onBack}
            className="mb-4 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück zur Immobilie
          </Button>
          
          <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Historie {einheitId ? `Einheit ${einheitId.slice(-2)}` : 'Einheit'}
            </h1>
            {immobilie && (
              <p className="text-gray-600">{immobilie.name} - {immobilie.adresse}</p>
            )}
            <div className="flex items-center space-x-2 mt-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600">
                {einheit?.qm && `${einheit.qm} m² • `}
                {einheit?.etage && `${einheit.etage}`}
              </span>
            </div>

            {/* Einheitsdaten: SOLL-Miete editierbar */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2">
              <Euro className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-500 shrink-0">SOLL-Miete:</span>
              {isEditingSoll ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-7 w-28 text-sm text-right py-0 px-2"
                    value={sollValue}
                    onChange={(e) => setSollValue(e.target.value)}
                    onBlur={handleSollSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSollSave();
                      if (e.key === "Escape") setIsEditingSoll(false);
                    }}
                    autoFocus
                    placeholder="0,00"
                  />
                  <button onClick={handleSollSave} className="text-green-600 hover:text-green-700">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setIsEditingSoll(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  className="group flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-gray-900 rounded px-1 py-0.5 hover:bg-gray-100"
                  onClick={() => {
                    setSollValue(currentSollMiete != null ? String(currentSollMiete) : "");
                    setIsEditingSoll(true);
                  }}
                  title="Klicken zum Bearbeiten"
                >
                  {currentSollMiete != null
                    ? `${currentSollMiete.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                    : <span className="text-gray-400 italic">nicht hinterlegt</span>
                  }
                  <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40" />
                </button>
              )}
              <span className="text-xs text-gray-400">(p.m.)</span>
            </div>
          </div>
        </div>

        <div className="space-y-4 pb-6">
          <h2 className="text-xl font-semibold text-gray-900">Mietvertrag-Historie</h2>
          
          {timeline.length === 0 ? (
            <Card className="w-fit mx-auto">
              <CardContent className="p-6 text-center">
                <Clock className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">Keine Mietverträge für diese Einheit gefunden.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {timeline.map((periode, index) => (
                <Card 
                  key={index} 
                  className={`${periode.type === 'leerstand' ? 'border-red-200 bg-red-50' : 
                    periode.isAktuell ? 'border-green-500 bg-green-50 shadow-lg' : 'border-gray-200'}`}
                >
                  {periode.type === 'vertrag' ? (
                    <div 
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedVertragId(periode.vertrag.id)}
                    >
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <FileText className="h-6 w-6 text-blue-600" />
                            <div>
                              <CardTitle className="text-lg">
                                Mietvertrag {periode.isAktuell && '(Aktuell)'}
                              </CardTitle>
                               <p className="text-sm text-gray-600">
                                 {formatDatum(periode.startDatum)} 
                                 {periode.endDatum && ` - ${formatDatum(periode.endDatum)}`}
                                 {!periode.endDatum && periode.isAktuell && ' - laufend'}
                                 {periode.vertrag.status === 'gekuendigt' && periode.vertrag.kuendigungsdatum && (
                                   <span className="block text-yellow-600 font-medium">
                                     Gekündigt zum: {formatDatum(new Date(periode.vertrag.kuendigungsdatum))}
                                   </span>
                                 )}
                               </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge 
                              className={
                                periode.isAktuell ? 'bg-green-600' : 
                                periode.vertrag.status === 'gekuendigt' ? 'bg-yellow-600' :
                                periode.vertrag.status === 'beendet' ? 'bg-red-600' : 'bg-gray-600'
                              }
                            >
                              {periode.vertrag.status}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="flex items-center space-x-2">
                            <Calendar className="h-4 w-4 text-gray-500" />
                            <div>
                              <p className="text-sm text-gray-600">Mietbeginn</p>
                              <p className="font-semibold">{formatDatum(periode.startDatum)}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Users className="h-4 w-4 text-gray-500" />
                            <div>
                              <p className="text-sm text-gray-600">Mieter</p>
                              <p className="font-semibold">
                                {periode.mieter && periode.mieter.length > 0 
                                  ? periode.mieter.map(m => `${m.vorname} ${m.nachname}`).join(', ')
                                  : 'Keine Mieter zugeordnet'
                                }
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t">
                          <p className="text-sm text-blue-600 font-medium">
                            Klicken für Details zu Zahlungen und Dokumenten →
                          </p>
                        </div>
                      </CardContent>
                    </div>
                  ) : (
                    // Leerstand
                    <>
                      <CardHeader>
                        <div className="flex items-center space-x-3">
                          <Clock className="h-6 w-6 text-red-500" />
                          <div>
                            <CardTitle className="text-lg text-red-700">
                              Leerstand
                            </CardTitle>
                            <p className="text-sm text-red-600">
                              {formatDatum(periode.startDatum)} 
                              {periode.endDatum ? ` - ${formatDatum(periode.endDatum)}` : ' - andauernd'}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div>
                            {/* Empty space */}
                          </div>
                          <Badge variant="destructive">
                            Nicht vermietet
                          </Badge>
                        </div>
                      </CardContent>
                    </>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};