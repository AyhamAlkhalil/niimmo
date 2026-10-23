import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Users, Euro, Building2, Clock, FileText } from "lucide-react";
import { Loader2 } from "lucide-react";
import MietvertragDetailsModal from "./MietvertragDetailsModal";
import { getVertragsende } from "@/utils/contractUtils";
import { alleSeiten } from "@/utils/supabaseSeiten";
import { protokolleErgaenzen, uebergabenJeVertrag, type ProtokollDokument, type UebergabeAblesung, type UebergabeEreignis } from "@/utils/uebergabeHistorie";
import { datumAusTitel, protokollArt, type ProtokollZeile } from "@/utils/uebergabeProtokolle";
import { dokumentOeffnen } from "@/lib/dokumentOeffnen";
import { toast } from "sonner";

const ZAEHLER_KURZ: Record<string, string> = { strom: "Strom", gas: "Gas", kaltwasser: "Kaltwasser", warmwasser: "Warmwasser" };
const ZAEHLER_EINHEIT: Record<string, string> = { strom: "kWh", gas: "m³", kaltwasser: "m³", warmwasser: "m³" };

/**
 * Übergaben eines Vertrags in der Einheit-Historie: Datum, Stände und das
 * Protokoll dazu (seit 22.10.2026). Der Klick auf die Karte öffnet weiter die
 * Vertragsdetails; die Knöpfe hier fangen ihn ab.
 */
const UebergabenZeile = ({ ereignisse, fehler }: { ereignisse: UebergabeEreignis[]; fehler: boolean }) => {
  if (!fehler && ereignisse.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="text-sm font-medium">Übergaben</p>
      {fehler ? (
        <p className="text-xs text-destructive">Die Übergaben konnten nicht geladen werden.</p>
      ) : (
        ereignisse.map((e) => (
          <div key={`${e.art}-${e.datum}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Badge variant="outline" className={e.art === "einzug" ? "border-success/40 text-success" : "border-warning/40 text-warning"}>
              {e.art === "einzug" ? "Einzug" : "Auszug"} · {new Date(`${e.datum}T00:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </Badge>
            <span className="text-muted-foreground">
              {e.ablesungen.length === 0
                ? "ohne Zählerstände"
                : e.ablesungen
                    .map((a) => `${ZAEHLER_KURZ[a.zaehler_typ] ?? a.zaehler_typ} ${a.stand != null ? Number(a.stand).toLocaleString("de-DE") : "–"} ${ZAEHLER_EINHEIT[a.zaehler_typ] ?? ""}`.trim())
                    .join(" · ")}
            </span>
            {e.protokollPfad && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                aria-label={`Übergabeprotokoll ${e.art === "einzug" ? "Einzug" : "Auszug"} vom ${new Date(`${e.datum}T00:00:00`).toLocaleDateString("de-DE")} öffnen`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  void dokumentOeffnen(e.protokollPfad!).then((ok) => !ok && toast.error("Das Protokoll konnte nicht geöffnet werden"));
                }}
              >
                Protokoll
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  );
};

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
  const [lastClosedVertragId, setLastClosedVertragId] = useState<string | null>(null);

  const { data: alleMietvertraege, isLoading: vertraegeLoading, isError: vertraegeFehler, refetch: vertraegeNeuLaden } = useQuery({
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

  const { data: mieterData, isError: mieterFehler } = useQuery({
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

  // Ablesungen aus Übergaben — je Vertrag mit Datum und Protokoll
  const { data: uebergabeAblesungen, isError: uebergabenFehler } = useQuery({
    queryKey: ['uebergabe-ablesungen-einheit', einheitId],
    queryFn: () =>
      alleSeiten<UebergabeAblesung>((von, bis, mitZaehlung) =>
        supabase
          .from('zaehlerstand_historie')
          .select('id, zaehler_typ, stand, datum, quelle, mietvertrag_id, protokoll_pfad, foto_pfad, erfassung, zaehler_nummer', { count: mitZaehlung ? 'exact' : undefined })
          .eq('einheit_id', einheitId)
          .like('quelle', 'Übergabe%')
          .order('datum')
          .order('id')
          .range(von, bis)
      ),
  });
  // Protokolle der Verträge — auch Übergaben ohne Ablesung (Garage, Altbestand, Handupload)
  const vertragIds = useMemo(() => (alleMietvertraege ?? []).map((v) => v.id), [alleMietvertraege]);
  const { data: protokollZeilen, isError: protokolleFehler } = useQuery({
    queryKey: ['uebergabe-protokolle-einheit', einheitId, vertragIds],
    enabled: vertragIds.length > 0,
    queryFn: () =>
      alleSeiten<ProtokollZeile>((von, bis, mitZaehlung) =>
        supabase
          .from('dokumente')
          .select('mietvertrag_id, titel, pfad, dateityp, hochgeladen_am', { count: mitZaehlung ? 'exact' : undefined })
          .in('mietvertrag_id', vertragIds)
          .eq('kategorie', 'Übergabeprotokoll')
          .eq('geloescht', false)
          .order('id')
          .range(von, bis)
      ),
  });
  const uebergaben = useMemo(() => {
    const ausAblesungen = uebergabenJeVertrag(
      (alleMietvertraege ?? []).map((v) => ({ id: v.id, start: v.start_datum, ende: getVertragsende(v) })),
      uebergabeAblesungen ?? []
    );
    const protokolle: ProtokollDokument[] = [];
    for (const z of protokollZeilen ?? []) {
      const istPdf = z.dateityp === 'application/pdf' || /\.pdf$/i.test(z.pfad ?? '') || /\.pdf$/i.test(z.titel ?? '');
      const art = protokollArt(z.titel, z.pfad);
      const datum = datumAusTitel(z.titel) ?? z.hochgeladen_am?.slice(0, 10);
      if (istPdf && art && datum && z.mietvertrag_id && z.pfad) protokolle.push({ mietvertrag_id: z.mietvertrag_id, art, datum, pfad: z.pfad });
    }
    return protokolleErgaenzen(ausAblesungen, protokolle);
  }, [alleMietvertraege, uebergabeAblesungen, protokollZeilen]);

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
      const ende = getVertragsende(vertrag);
      const endDatum = ende ? new Date(ende) : null;
      
      // Check for vacancy period before this contract
      if (index > 0) {
        const vorherigendesVertrag = sortedVertraege[index - 1];
        const vorherigesEnde = getVertragsende(vorherigendesVertrag);
        const vorherigesEndDatum = vorherigesEnde ? new Date(vorherigesEnde) : null;
        
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
      const letztesEnde = getVertragsende(letzterVertrag);
      const letzteEndDatum = letztesEnde ? new Date(letztesEnde) : null;
      
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
        onClose={() => {
          const closedId = selectedVertragId;
          setSelectedVertragId(null);
          setLastClosedVertragId(closedId);
          setTimeout(() => setLastClosedVertragId(null), 4000);
        }}
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

          </div>
        </div>

        <div className="space-y-4 pb-6">
          <h2 className="text-xl font-semibold text-gray-900">Mietvertrag-Historie</h2>
          
          {/* Ein Ladefehler ist kein „keine Mietverträge“ (bis 23.10.2026) */}
          {vertraegeFehler ? (
            <Card className="w-fit mx-auto">
              <CardContent className="p-6 text-center space-y-3">
                <p className="text-destructive">Die Mietverträge dieser Einheit konnten nicht geladen werden.</p>
                <Button variant="outline" onClick={() => void vertraegeNeuLaden()}>Erneut laden</Button>
              </CardContent>
            </Card>
          ) : timeline.length === 0 ? (
            <Card className="w-fit mx-auto">
              <CardContent className="p-6 text-center">
                <Clock className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">Keine Mietverträge für diese Einheit gefunden.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {timeline.map((periode, index) => {
                const isHighlighted = periode.type === 'vertrag' && periode.vertrag?.id === lastClosedVertragId;
                return (
                <Card
                  key={index}
                  className={`transition-all duration-300 ${
                    isHighlighted
                      ? 'border-red-500 ring-2 ring-red-500 ring-offset-2 shadow-lg shadow-red-200/60 animate-pulse-once'
                      : periode.type === 'leerstand'
                        ? 'border-red-200 bg-red-50'
                        : periode.isAktuell
                          ? 'border-green-500 bg-green-50 shadow-lg'
                          : 'border-gray-200'
                  }`}
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
                                 {periode.vertrag.status === 'gekuendigt' && periode.endDatum && (
                                   <span className="block text-yellow-600 font-medium">
                                     Gekündigt zum: {formatDatum(periode.endDatum)}
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
                                  : mieterFehler
                                    ? 'Mieter konnten nicht geladen werden'
                                    : 'Keine Mieter zugeordnet'
                                }
                              </p>
                            </div>
                          </div>
                        </div>

                        <UebergabenZeile ereignisse={uebergaben.get(periode.vertrag.id) ?? []} fehler={uebergabenFehler || protokolleFehler} />

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
                );
              })}
            </div>
          )}

          {/* Übergaben, die sich keinem Vertrag zuordnen lassen (alte Einträge weit weg
              von Beginn oder Ende) — sie sollen nicht einfach verschwinden */}
          {(uebergaben.get(null)?.length ?? 0) > 0 && (
            <Card>
              <CardContent className="p-4">
                <UebergabenZeile ereignisse={uebergaben.get(null) ?? []} fehler={false} />
                <p className="mt-2 text-xs text-muted-foreground">Ohne Zuordnung zu einem Mietvertrag.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};