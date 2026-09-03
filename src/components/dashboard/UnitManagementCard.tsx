import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Home, Square, Users, Calendar, Euro, User, AlertTriangle, Building2, UserPlus, FileText, XCircle } from "lucide-react";
import { useState } from "react";
import { NewTenantContractDialog } from "./NewTenantContractDialog";
import MietvertragDetailsModal from "./MietvertragDetailsModal";
import { TerminationDialog } from "./termination/TerminationDialog";
import { getVertragsende, istGekuendigt } from "@/utils/contractUtils";
interface UnitManagementCardProps {
  einheit: {
    id: string;
    nummer?: string;
    etage?: string;
    qm?: number;
    einheitentyp?: string;
  };
  vertrag?: {
    id: string;
    status: string;
    kaltmiete?: number;
    betriebskosten?: number;
    start_datum?: string;
    ende_datum?: string;
    kuendigungsdatum?: string;
    mieter?: Array<{
      id: string;
      vorname: string;
      nachname: string;
      hauptmail?: string;
      telnr?: string;
    }>;
  } | null;
  immobilie?: {
    name: string;
    adresse: string;
  };
  einheitIndex: number;
  onContractChange?: () => void;
}

export const UnitManagementCard = ({ 
  einheit, 
  vertrag, 
  immobilie, 
  einheitIndex, 
  onContractChange 
}: UnitManagementCardProps) => {
  const [showNewTenantDialog, setShowNewTenantDialog] = useState(false);
  const [showContractDetails, setShowContractDetails] = useState(false);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [currentVertragId, setCurrentVertragId] = useState<string | null>(null);

  const getStatusColor = () => {
    if (!vertrag) return "border-red-500 bg-red-50";
    
    switch (vertrag.status) {
      case 'aktiv': 
        return "border-green-500 bg-green-50";
      case 'gekuendigt': 
        return "border-orange-500 bg-orange-50";
      case 'beendet': 
        return "border-red-500 bg-red-50";
      default: 
        return "border-gray-300 bg-gray-50";
    }
  };

  const getStatusBadge = () => {
    if (!vertrag) {
      return <Badge variant="destructive">Leerstehend</Badge>;
    }
    
    switch (vertrag.status) {
      case 'aktiv':
        return <Badge className="bg-green-600 text-white">Aktiv</Badge>;
      case 'gekuendigt':
        return <Badge className="bg-orange-600 text-white">Gekündigt</Badge>;
      case 'beendet':
        return <Badge variant="destructive">Beendet</Badge>;
      default:
        return <Badge variant="outline">{vertrag.status}</Badge>;
    }
  };

  const isTerminated = vertrag && (vertrag.status === 'gekuendigt' || vertrag.status === 'beendet');
  const isVacant = !vertrag;

  const handleNewContract = () => {
    setShowNewTenantDialog(false);
    onContractChange?.();
  };

  const handleTerminationSuccess = () => {
    setShowTerminationDialog(false);
    onContractChange?.();
  };

  return (
    <>
      <Card className={`transition-all hover:shadow-md border-l-4 ${getStatusColor()}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2">
              <Home className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">
                  Einheit {einheitIndex}
                </CardTitle>
                {einheit.etage && (
                  <p className="text-sm text-muted-foreground">{einheit.etage}</p>
                )}
              </div>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Unit Details */}
          <div className="grid grid-cols-2 gap-4">
            {einheit.qm && (
              <div className="flex items-center space-x-2">
                <Square className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{einheit.qm} m²</span>
              </div>
            )}
            {einheit.einheitentyp && (
              <div className="flex items-center space-x-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{einheit.einheitentyp}</span>
              </div>
            )}
          </div>

          {/* Contract Information */}
          {vertrag && (
            <div className="space-y-3 pt-2 border-t">
              {/* Tenant Information */}
              {vertrag.mieter && vertrag.mieter.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Mieter:</span>
                  </div>
                  <div className="pl-6 space-y-1">
                    {vertrag.mieter.slice(0, 2).map((mieter, index) => (
                      <div key={index} className="text-sm">
                        {mieter.vorname} {mieter.nachname}
                      </div>
                    ))}
                    {vertrag.mieter.length > 2 && (
                      <div className="text-xs text-muted-foreground">
                        +{vertrag.mieter.length - 2} weitere
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">Keine Mieter zugeordnet</span>
                </div>
              )}

              {/* Rent Information */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Kaltmiete</span>
                  </div>
                  <span className="text-sm font-medium">{vertrag.kaltmiete || 0}€</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Betriebskosten</span>
                  </div>
                  <span className="text-sm font-medium">{vertrag.betriebskosten || 0}€</span>
                </div>

                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-sm font-medium">Warmmiete</span>
                  <span className="text-sm font-bold text-primary">
                    {((vertrag.kaltmiete || 0) + (vertrag.betriebskosten || 0))}€
                  </span>
                </div>
              </div>

              {/* Contract Dates */}
              {vertrag.start_datum && (
                <div className="flex items-center space-x-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>seit {new Date(vertrag.start_datum).toLocaleDateString('de-DE')}</span>
                </div>
              )}

              {/* Vertragsende aus derselben Quelle wie die Detailansicht */}
              {(() => {
                const ende = getVertragsende(vertrag);
                if (!ende) return null;
                const gekuendigt = istGekuendigt(vertrag);
                return (
                  <div className={`flex items-center space-x-2 text-sm p-2 rounded ${gekuendigt ? 'text-orange-700 bg-orange-100' : 'text-muted-foreground'}`}>
                    {gekuendigt ? <AlertTriangle className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
                    <span>
                      {gekuendigt ? 'Gekündigt zum' : 'Befristet bis'}: {new Date(ende).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 border-t space-y-2">
            {/* Show contract details button for existing contracts */}
            {vertrag && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowContractDetails(true)}
                  className="w-full"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Vertrag anzeigen
                </Button>

                {/* Show termination button for active contracts */}
                {vertrag.status === 'aktiv' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowTerminationDialog(true)}
                    className="w-full"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Vertrag kündigen
                  </Button>
                )}
              </div>
            )}

            {/* Show new contract button only for vacant or terminated contracts */}
            {(!vertrag || vertrag.status === 'gekuendigt' || vertrag.status === 'beendet') && (
              <Button
                onClick={() => setShowNewTenantDialog(true)}
                className={`w-full ${
                  !vertrag 
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                }`}
                size="sm"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Neuen Mietvertrag anlegen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <NewTenantContractDialog
        isOpen={showNewTenantDialog}
        onClose={handleNewContract}
        einheitId={einheit.id}
        immobilie={immobilie}
      />

      {(vertrag || currentVertragId) && (
        <>
          <MietvertragDetailsModal
            isOpen={showContractDetails}
            onClose={() => {
              setShowContractDetails(false);
              setCurrentVertragId(null);
            }}
            vertragId={currentVertragId || vertrag?.id || ''}
            einheit={einheit}
            immobilie={immobilie}
          />

          <TerminationDialog
            isOpen={showTerminationDialog}
            onClose={() => setShowTerminationDialog(false)}
            vertragId={vertrag.id}
            einheit={einheit}
            immobilie={immobilie}
            onTerminationSuccess={handleTerminationSuccess}
          />
        </>
      )}
    </>
  );
};