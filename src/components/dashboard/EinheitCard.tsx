import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Home, Square, Users, Calendar, Euro, User, AlertTriangle, Copy, Phone, Mail, Link2, Briefcase, UserCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useAutoExpireContract } from "@/hooks/useAutoExpireContracts";
import { EinheitHistorieView } from "./EinheitHistorieView";
import MietvertragDetailsModal from "./MietvertragDetailsModal";
import { NewTenantContractDialog } from "./NewTenantContractDialog";

import { useToast } from "@/hooks/use-toast";
import { useLinkedContracts } from "@/hooks/useLinkedContracts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getVertragstyp, getVertragstypColors } from "@/utils/tenantTypeUtils";
import { getVertragsende, istGekuendigt } from "@/utils/contractUtils";

interface EinheitCardProps {
  einheit: {
    id: string;
    nummer?: string;
    etage?: string;
    qm?: number;
    kaltwasser_zaehler?: string;
    warmwasser_zaehler?: string;
    strom_zaehler?: string;
    gas_zaehler?: string;
    einheitentyp?: string;
  };
  vertrag?: {
    id: string;
    status: string;
    kaltmiete?: number;
    warmmiete?: number;
    betriebskosten?: number;
    start_datum?: string;
    ende_datum?: string;
    kuendigungsdatum?: string;
    mieter?: Array<{
      id: string;
      vorname: string;
      nachname: string;
      rolle: string;
      telnr?: string;
      hauptmail?: string;
    }>;
  } | null;
  immobilie?: {
    name: string;
    adresse: string;
  };
  openMietvertragId?: string | null;
  einheitIndex: number;
  onContractModalClose?: () => void;
}

export const EinheitCard = ({ einheit, vertrag, immobilie, openMietvertragId, einheitIndex, onContractModalClose }: EinheitCardProps) => {
  const [showHistorie, setShowHistorie] = useState(false);
  const [showMietvertragDetails, setShowMietvertragDetails] = useState(false);
  const [showNewTenantDialog, setShowNewTenantDialog] = useState(false);
  const [autoOpenContract, setAutoOpenContract] = useState(false);
  const [showContractHighlight, setShowContractHighlight] = useState(false);
  const [currentVertragId, setCurrentVertragId] = useState<string | null>(null);
  const { toast } = useToast();

  // Check for linked contracts (same tenants with multiple units)
  const mieterIds = vertrag?.mieter?.map(m => m.id) || [];
  const { linkedContracts, hasLinkedContracts } = useLinkedContracts(
    vertrag?.id || '',
    mieterIds
  );

  // Check if this contract should be automatically opened with highlighting
  useEffect(() => {
    if (openMietvertragId && vertrag?.id === openMietvertragId) {
      setAutoOpenContract(true);
      setShowMietvertragDetails(true);
      
      // Show contract highlight animation after card opens
      setTimeout(() => {
        setShowContractHighlight(true);
        // Remove highlight after animation
        setTimeout(() => {
          setShowContractHighlight(false);
        }, 3000);
      }, 500);
    }
  }, [openMietvertragId, vertrag?.id]);

  // Auto-expire contracts past their Kündigungsdatum
  useAutoExpireContract(vertrag?.id, vertrag?.status, vertrag?.kuendigungsdatum);

  const getStatusColor = () => {
    if (!vertrag) return "bg-red-100 border-red-200";
    
    if (vertrag.status === 'aktiv') return "bg-green-100 border-green-200";
    if (vertrag.status === 'gekuendigt') return "bg-yellow-100 border-yellow-500";
    if (vertrag.status === 'beendet') return "bg-red-100 border-red-200";
    
    return "bg-gray-100 border-gray-200";
  };

  const getStatusBadge = () => {
    if (!vertrag) return <Badge variant="destructive">Leerstehend</Badge>;

    if (vertrag.status === 'aktiv') {
      return <Badge variant={undefined} className="bg-green-600 text-white border-transparent">Aktiv</Badge>;
    }
    if (vertrag.status === 'gekuendigt') {
      return <Badge
        style={{ backgroundColor: '#d97706', color: 'white', border: 'none' }}
        className="hover:bg-yellow-700"
      >
        Gekündigt
      </Badge>;
    }
    if (vertrag.status === 'beendet') {
      return <Badge variant="destructive">Beendet</Badge>;
    }

    return <Badge>{vertrag.status}</Badge>;
  };


  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowHistorie(true);
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Kopiert!",
        description: `${type} wurde in die Zwischenablage kopiert.`,
      });
    } catch (err) {
      toast({
        title: "Fehler",
        description: `${type} konnte nicht kopiert werden.`,
        variant: "destructive",
      });
    }
  };

  if (showHistorie) {
    return (
      <EinheitHistorieView
        einheitId={einheit.id}
        onBack={() => setShowHistorie(false)}
        einheit={einheit}
        immobilie={immobilie}
      />
    );
  }

  return (
    <>
      <Card
        className={`transition-all hover:shadow-lg cursor-pointer border-l-4 ${getStatusColor()}`}
        onClick={handleCardClick}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <Home className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">
                Einheit {einheitIndex}
              </CardTitle>
              {/* Vertragstyp Badge (Gewerbe/Privat) */}
              {(() => {
                const vertragstyp = getVertragstyp(einheit.einheitentyp);
                const colors = getVertragstypColors(vertragstyp);
                return (
                  <Badge 
                    variant="outline" 
                    className={`${colors.bg} ${colors.text} ${colors.border} flex items-center gap-1 text-xs`}
                  >
                    {vertragstyp === 'Gewerbe' ? (
                      <Briefcase className="h-3 w-3" />
                    ) : (
                      <UserCircle className="h-3 w-3" />
                    )}
                    {vertragstyp}
                  </Badge>
                );
              })()}
              {/* Linked contracts indicator */}
              {hasLinkedContracts && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge 
                        variant="outline" 
                        className="bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 cursor-help"
                      >
                        <Link2 className="h-3 w-3" />
                        +{linkedContracts.length}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="font-medium mb-1">Weitere Einheiten desselben Mieters:</p>
                      <ul className="text-xs space-y-1">
                        {linkedContracts.map(lc => (
                          <li key={lc.id} className="flex items-center gap-1">
                            <Home className="h-3 w-3" />
                            {lc.einheit?.immobilie?.name || 'Objekt'} - {lc.einheit?.etage || 'Einheit'}
                          </li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {getStatusBadge()}
          </div>
          
          {einheit.etage && (
            <p className="text-sm text-gray-600">{einheit.etage}</p>
          )}
        </CardHeader>
        
        <CardContent className="space-y-3">
          {einheit.qm && (
            <div className="flex items-center space-x-2">
              <Square className="h-4 w-4 text-gray-500" />
              <span className="text-sm">{einheit.qm} m²</span>
            </div>
          )}


          {vertrag && (
            <>
              {/* Mieter - Zugeordnet über Mietvertrag */}
              {vertrag.mieter && vertrag.mieter.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium">
                      {vertrag.mieter.length === 1 ? 'Mieter:' : 'Mieter:'}
                    </span>
                  </div>
                  <div className="pl-6 space-y-2">
                    {vertrag.mieter.slice(0, 2).map((mieter, index) => (
                      <div key={index} className="flex flex-col p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center space-x-2 mb-2">
                          <User className="h-3 w-3 text-blue-600" />
                          <span className="text-sm text-gray-700 font-medium">
                            {mieter.vorname} {mieter.nachname}
                          </span>
                        </div>
                        
                        {/* Telefonnummer */}
                        {mieter.telnr && (
                          <div className="text-xs text-gray-600 ml-5 flex items-center justify-between group">
                            <div className="flex items-center space-x-1">
                              <Phone className="h-3 w-3" />
                              <span>{mieter.telnr}</span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(mieter.telnr!, 'Telefonnummer');
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 rounded"
                              title="Telefonnummer kopieren"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        
                        {/* E-Mail */}
                        {mieter.hauptmail && (
                          <div className="text-xs text-gray-600 ml-5 flex items-center justify-between group">
                            <div className="flex items-center space-x-1">
                              <Mail className="h-3 w-3" />
                              <span>{mieter.hauptmail}</span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(mieter.hauptmail!, 'E-Mail-Adresse');
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 rounded"
                              title="E-Mail-Adresse kopieren"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {vertrag.mieter.length > 2 && (
                      <div className="text-xs text-gray-500 pl-5 bg-gray-50 rounded p-2">
                        +{vertrag.mieter.length - 2} weitere Mieter
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Mietinformationen */}
              <div className={`space-y-2 pt-2 border-t border-gray-100 transition-all duration-500 ${
                showContractHighlight 
                  ? 'animate-contract-found border-4 border-red-500 bg-red-50 shadow-lg rounded-lg p-3' 
                  : ''
              }`}>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Mietinformationen
                  {showContractHighlight && (
                    <span className="ml-2 text-xs bg-red-500 text-white px-2 py-1 rounded-full animate-bounce-in">
                      Gefunden!
                    </span>
                  )}
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-600">Kaltmiete</span>
                  </div>
                  <span className="text-sm font-medium text-gray-800">{vertrag.kaltmiete || 0}€</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-gray-500" />
                    <span className="text-sm text-gray-600">Betriebskosten</span>
                  </div>
                  <span className="text-sm font-medium text-gray-800">{vertrag.betriebskosten || 0}€</span>
                </div>

                {vertrag.warmmiete && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Euro className="h-4 w-4 text-orange-500" />
                      <span className="text-sm text-gray-600 font-medium">Warmmiete</span>
                    </div>
                    <span className="text-sm font-bold text-orange-600">{vertrag.warmmiete}€</span>
                  </div>
                )}
              </div>

              {vertrag.start_datum && (
                <div className="flex items-center space-x-2 pt-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">
                    seit {new Date(vertrag.start_datum).toLocaleDateString('de-DE')}
                  </span>
                </div>
              )}

              {/* Vertragsende aus derselben Quelle wie die Detailansicht. Vorher
                  zeigte die Karte kuendigungsdatum und das Detail ende_datum --
                  bei abweichenden Werten nannten beide ein anderes Datum. */}
              {(() => {
                const ende = getVertragsende(vertrag);
                if (!ende) return null;
                const gekuendigt = istGekuendigt(vertrag);
                return (
                  <div className="flex items-center space-x-2 pt-1">
                    {gekuendigt
                      ? <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      : <Calendar className="h-4 w-4 text-gray-500" />}
                    <span className={`text-sm font-medium ${gekuendigt ? 'text-yellow-700' : 'text-gray-600'}`}>
                      {gekuendigt ? 'Gekündigt zum' : 'Befristet bis'}: {new Date(ende).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                );
              })()}
            </>
          )}

          {/* Wenn keine Mieter zugeordnet sind */}
          {(!vertrag || !vertrag.mieter || vertrag.mieter.length === 0) && (
            <div className="flex items-center space-x-2 text-gray-500 bg-gray-50 p-2 rounded-lg">
              <Users className="h-4 w-4" />
              <span className="text-sm">
                {vertrag ? 'Keine Mieter zugeordnet' : 'Leerstehend - Kein Mietvertrag'}
              </span>
            </div>
          )}

          {/* New contract button - only for vacant or terminated contracts */}
          {(!vertrag || vertrag.status === 'gekuendigt' || vertrag.status === 'beendet') && (
            <div className="pt-3 border-t border-gray-200">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowNewTenantDialog(true);
                }}
                className={`w-full ${
                  !vertrag 
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                }`}
                size="sm"
              >
                <User className="h-4 w-4 mr-2" />
                Neuen Mietvertrag anlegen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Contract Details Modal */}
      {(vertrag || currentVertragId) && (
        <MietvertragDetailsModal
          isOpen={showMietvertragDetails}
          onClose={() => {
            setShowMietvertragDetails(false);
            setShowContractHighlight(false);
            setCurrentVertragId(null);
            onContractModalClose?.();
          }}
          vertragId={currentVertragId || vertrag?.id || ''}
          einheit={einheit}
          immobilie={immobilie}
        />
      )}

      {/* New Tenant Contract Dialog */}
      <NewTenantContractDialog
        isOpen={showNewTenantDialog}
        onClose={() => setShowNewTenantDialog(false)}
        einheitId={einheit.id}
        immobilie={immobilie}
      />
    </>
  );
};
