import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Home, Square, Users, Calendar, Euro, User, AlertTriangle, Copy, Phone, Mail, Link2, Briefcase, UserCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useAutoExpireContract } from "@/hooks/useAutoExpireContracts";
import { EinheitHistorieView } from "./EinheitHistorieView";
import MietvertragDetailsModal from "./MietvertragDetailsModal";
import { NewTenantContractDialog } from "./NewTenantContractDialog";
import { MietvertragEntwurfDialog } from "./mietvertrag-entwurf/MietvertragEntwurfDialog";
import { EntwuerfeAnEinheit } from "./mietvertrag-entwurf/EntwuerfeAnEinheit";
import { istWohnraumEinheit } from "@/utils/mietvertrag/entwurf";
import type { SchrittId } from "@/utils/mietvertrag/entwurfProzess";
import { useUserRole } from "@/hooks/useUserRole";

import { useToast } from "@/hooks/use-toast";
import { useLinkedContracts } from "@/hooks/useLinkedContracts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getVertragstyp, getVertragstypColors } from "@/utils/tenantTypeUtils";
import { getVertragsende, istGekuendigt } from "@/utils/contractUtils";
import { VertragStatusBadge } from "@/components/dashboard/VertragStatusBadge";
import { formatEuro } from "@/utils/zahlungenAnsicht";

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
  // Neuer Vertrag entsteht seit 18.10.2026 als Entwurf; der direkte Weg bleibt für unterschriebene Altverträge
  const [showEntwurfDialog, setShowEntwurfDialog] = useState(false);
  const [bearbeiteEntwurfId, setBearbeiteEntwurfId] = useState<string | null>(null);
  const [entwurfSchritt, setEntwurfSchritt] = useState<SchrittId | null>(null);
  // Entwürfe und neue Verträge schreiben nur Admins (RLS) — Hausmeister sehen die Knöpfe nicht
  const { isAdmin } = useUserRole();
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

  // Gekündigten Vertrag nach dem Vertragsende auf 'beendet' setzen
  useAutoExpireContract(vertrag?.id, vertrag?.status, getVertragsende(vertrag) ?? undefined);

  // Weiße Karte, Status als schmale Farblinie oben; nur was Aufmerksamkeit braucht, bekommt
  // einen Hauch von Farbe (26.10.2026; vorher vollflächig grün, gelb oder rot eingefärbt)
  const getStatusColor = () => {
    if (!vertrag) return { linie: "bg-brand", flaeche: "bg-crimson-50/40" };

    if (vertrag.status === 'aktiv') return { linie: "bg-forest-500", flaeche: "bg-card" };
    if (vertrag.status === 'gekuendigt') return { linie: "bg-ochre-500", flaeche: "bg-ochre-50/50" };
    if (vertrag.status === 'beendet') return { linie: "bg-brand", flaeche: "bg-crimson-50/40" };

    return { linie: "bg-neutral-300", flaeche: "bg-card" };
  };

  const getStatusBadge = () => {
    if (!vertrag) return <VertragStatusBadge status={null} leer text="Leerstehend" />;
    return <VertragStatusBadge status={vertrag.status} />;
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
        className={`group relative cursor-pointer overflow-hidden rounded-xl transition-[box-shadow,transform,border-color] duration-300 ease-sanft hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-card-hover ${getStatusColor().flaeche}`}
        onClick={handleCardClick}
      >
        <div className={`absolute inset-x-0 top-0 h-[3px] ${getStatusColor().linie}`} aria-hidden="true" />
        <CardHeader className="pb-3 pt-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Home className="h-4 w-4 text-foreground/50" />
              <CardTitle className="font-display text-2xl font-normal leading-none">
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
                        className="flex cursor-help items-center gap-1 border-border bg-card text-foreground/80"
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
            <p className="text-sm text-muted-foreground">{einheit.etage}</p>
          )}
        </CardHeader>
        
        <CardContent className="space-y-3">
          {einheit.qm && (
            <div className="flex items-center space-x-2">
              <Square className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{Number(einheit.qm).toLocaleString('de-DE')} m²</span>
            </div>
          )}


          {vertrag && (
            <>
              {/* Mieter - Zugeordnet über Mietvertrag */}
              {vertrag.mieter && vertrag.mieter.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {vertrag.mieter.length === 1 ? 'Mieter:' : 'Mieter:'}
                    </span>
                  </div>
                  <div className="pl-6 space-y-2">
                    {vertrag.mieter.slice(0, 2).map((mieter, index) => (
                      <div key={index} className="flex flex-col rounded-lg border border-border/70 bg-neutral-50/70 p-3">
                        <div className="flex items-center space-x-2 mb-2">
                          <User className="h-3 w-3 text-foreground/50" />
                          <span className="text-sm font-medium text-foreground">
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
              <div className={`space-y-2 pt-3 border-t border-border/70 transition-all duration-500 ${
                showContractHighlight 
                  ? 'animate-contract-found rounded-lg border-2 border-brand bg-brand-soft p-3 shadow-lg' 
                  : ''
              }`}>
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Mietinformationen
                  {showContractHighlight && (
                    <span className="ml-2 rounded-full bg-brand px-2 py-1 text-xs normal-case tracking-normal text-brand-foreground animate-bounce-in">
                      Gefunden!
                    </span>
                  )}
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Kaltmiete</span>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-foreground">{formatEuro(Number(vertrag.kaltmiete) || 0)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Euro className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Betriebskosten</span>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-foreground">{formatEuro(Number(vertrag.betriebskosten) || 0)}</span>
                </div>

                {vertrag.warmmiete && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Euro className="h-4 w-4 text-foreground/60" />
                      <span className="text-sm font-medium text-foreground">Warmmiete</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{formatEuro(Number(vertrag.warmmiete) || 0)}</span>
                  </div>
                )}
              </div>

              {vertrag.start_datum && (
                <div className="flex items-center space-x-2 pt-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
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
                      ? <AlertTriangle className="h-4 w-4 text-warning" />
                      : <Calendar className="h-4 w-4 text-muted-foreground" />}
                    <span className={`text-sm font-medium ${gekuendigt ? 'text-warning' : 'text-muted-foreground'}`}>
                      {gekuendigt ? 'Gekündigt zum' : 'Befristet bis'}: {new Date(ende).toLocaleDateString('de-DE')}
                    </span>
                  </div>
                );
              })()}
            </>
          )}

          {/* Wenn keine Mieter zugeordnet sind */}
          {(!vertrag || !vertrag.mieter || vertrag.mieter.length === 0) && (
            <div className="flex items-center space-x-2 rounded-lg border border-dashed border-border bg-card/70 p-2.5 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-sm">
                {vertrag ? 'Keine Mieter zugeordnet' : 'Leerstehend - Kein Mietvertrag'}
              </span>
            </div>
          )}

          {/* Offene Entwürfe belegen die Einheit nicht, stehen aber hier bis zur Aktivierung */}
          {isAdmin && (
            <EntwuerfeAnEinheit
              einheitId={einheit.id}
              wohnraum={istWohnraumEinheit(einheit.einheitentyp)}
              onOeffnen={(id, schritt) => {
                setBearbeiteEntwurfId(id);
                setEntwurfSchritt(schritt ?? null);
                setShowEntwurfDialog(true);
              }}
            />
          )}

          {/* New contract button - only for vacant or terminated contracts */}
          {isAdmin && (!vertrag || vertrag.status === 'gekuendigt' || vertrag.status === 'beendet') && (
            <div className="pt-3 border-t border-border/70">
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  setBearbeiteEntwurfId(null);
                  setEntwurfSchritt(null);
                  setShowEntwurfDialog(true);
                }}
                variant={!vertrag ? "default" : "outline"}
                className="w-full"
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

      {showEntwurfDialog && (
        <MietvertragEntwurfDialog
          isOpen
          onClose={() => {
            setShowEntwurfDialog(false);
            setBearbeiteEntwurfId(null);
            setEntwurfSchritt(null);
          }}
          einheitId={einheit.id}
          entwurfId={bearbeiteEntwurfId}
          startSchritt={entwurfSchritt}
          onDirektErfassen={() => {
            setShowEntwurfDialog(false);
            setShowNewTenantDialog(true);
          }}
        />
      )}

      {/* „Bestehenden Vertrag direkt erfassen": bereits unterschriebenen Vertrag sofort anlegen (bisheriger Weg) */}
      <NewTenantContractDialog
        isOpen={showNewTenantDialog}
        onClose={() => setShowNewTenantDialog(false)}
        einheitId={einheit.id}
        immobilie={immobilie}
      />
    </>
  );
};
