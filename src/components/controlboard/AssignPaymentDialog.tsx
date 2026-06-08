import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, User, Building2, MapPin, Calendar, CheckCircle, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, isValid, parseISO } from "date-fns";
import { useActivityLog } from "@/hooks/useActivityLog";

interface AssignPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: {
    id: string;
    betrag: number;
    buchungsdatum: string;
    empfaengername?: string;
    iban?: string;
    verwendungszweck?: string;
    kategorie?: string;
  } | null;
}

export function AssignPaymentDialog({ open, onOpenChange, payment }: AssignPaymentDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const isMiete = payment?.kategorie === 'Miete';
  const isNebenkosten = payment?.kategorie === 'Nebenkosten';
  const [assignmentType, setAssignmentType] = useState<'contract' | 'property'>(
    isNebenkosten ? 'property' : 'contract'
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  // Reset search and assignment type when dialog opens with a new payment
  useEffect(() => {
    if (payment) {
      setAssignmentType(payment.kategorie === 'Nebenkosten' ? 'property' : 'contract');
      setSearchTerm("");
    }
  }, [payment]);

  // Fetch contracts with related data (active, terminated, and ended)
  const { data: contracts, isLoading: contractsLoading } = useQuery({
    queryKey: ['contracts-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id,
          start_datum,
          ende_datum,
          kaltmiete,
          betriebskosten,
          status,
          einheiten (
            id,
            etage,
            qm,
            immobilien (
              id,
              name,
              adresse
            )
          ),
          mietvertrag_mieter (
            mieter (
              id,
              vorname,
              nachname
            )
          )
        `)
        .in('status', ['aktiv', 'gekuendigt', 'beendet'])
        .order('status', { ascending: true })
        .order('start_datum', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: open && assignmentType === 'contract',
    staleTime: 60 * 1000,
  });

  // Fetch properties for property assignment
  const { data: properties, isLoading: propertiesLoading } = useQuery({
    queryKey: ['properties-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('immobilien')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: open && assignmentType === 'property',
    staleTime: 60 * 1000,
  });

  const isLoading = assignmentType === 'contract' ? contractsLoading : propertiesLoading;

  // Filter contracts based on search — memoized
  const filteredContracts = useMemo(() => {
    if (!contracts) return [];
    if (!searchTerm) return contracts;
    const search = searchTerm.toLowerCase();
    return contracts.filter(contract => {
      const mieterNames = contract.mietvertrag_mieter
        ?.map(mm => `${mm.mieter?.vorname} ${mm.mieter?.nachname}`.toLowerCase())
        .join(' ') || '';
      const immobilieName = contract.einheiten?.immobilien?.name?.toLowerCase() || '';
      const adresse = contract.einheiten?.immobilien?.adresse?.toLowerCase() || '';
      return mieterNames.includes(search) || immobilieName.includes(search) || adresse.includes(search);
    });
  }, [contracts, searchTerm]);

  // Filter properties based on search — memoized
  const filteredProperties = useMemo(() => {
    if (!properties) return [];
    if (!searchTerm) return properties;
    const search = searchTerm.toLowerCase();
    return properties.filter(property =>
      property.name?.toLowerCase().includes(search) ||
      property.adresse?.toLowerCase().includes(search)
    );
  }, [properties, searchTerm]);

  const handleAssignToContract = async (contractId: string) => {
    if (!payment) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({
          mietvertrag_id: contractId,
          immobilie_id: null,
          // Bei Zuordnungswechsel von Nebenkosten zu Mietvertrag → Kategorie anpassen
          ...(payment.kategorie === 'Nebenkosten' ? { kategorie: 'Miete' } : {})
        })
        .eq('id', payment.id);

      if (error) throw error;

      toast({
        title: "Zahlung zugeordnet",
        description: "Die Zahlung wurde erfolgreich dem Mietvertrag zugeordnet.",
      });

      logActivity('zahlung_zugeordnet', 'zahlung', payment.id, {
        mietvertragId: contractId,
        betrag: payment.betrag,
        kategorie: payment.kategorie ?? null,
        empfaenger: payment.empfaengername ?? null,
      });

      // Refresh queries parallel
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien-zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['unzugeordnete-nebenkosten'] }),
        queryClient.invalidateQueries({ queryKey: ['zugeordnete-nebenkosten'] }),
      ]);
      onOpenChange(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Die Zahlung konnte nicht zugeordnet werden.";
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignToProperty = async (propertyId: string) => {
    if (!payment) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({ 
          immobilie_id: propertyId,
          mietvertrag_id: null 
        })
        .eq('id', payment.id);

      if (error) throw error;

      toast({
        title: "Zahlung zugeordnet",
        description: "Die Zahlung wurde erfolgreich der Immobilie zugeordnet.",
      });

      logActivity('zahlung_zugeordnet', 'zahlung', payment.id, {
        immobilieId: propertyId,
        betrag: payment.betrag,
        kategorie: payment.kategorie ?? null,
        empfaenger: payment.empfaengername ?? null,
      });

      // Refresh queries parallel
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien-zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['unzugeordnete-nebenkosten'] }),
        queryClient.invalidateQueries({ queryKey: ['zugeordnete-nebenkosten'] }),
      ]);
      onOpenChange(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Die Zahlung konnte nicht zugeordnet werden.";
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCategorizeAsNonRent = async () => {
    if (!payment) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({ kategorie: 'Nichtmiete' })
        .eq('id', payment.id);

      if (error) throw error;

      toast({
        title: "Als Nichtmiete kategorisiert",
        description: "Die Zahlung wurde als sonstige Zahlung markiert.",
      });

      // Refresh queries
      await queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] });
      
      onOpenChange(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Die Kategorisierung konnte nicht durchgeführt werden.";
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassign = async () => {
    if (!payment) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase
        .from('zahlungen')
        .update({ 
          mietvertrag_id: null,
          immobilie_id: null 
        })
        .eq('id', payment.id);

      if (error) throw error;

      toast({
        title: "Zuordnung aufgehoben",
        description: "Die Zahlung wurde von allen Zuordnungen getrennt.",
      });

      // Refresh queries parallel
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unassigned-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien-zahlungen'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien-nebenkosten'] }),
      ]);
      onOpenChange(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Die Zuordnung konnte nicht aufgehoben werden.";
      toast({
        title: "Fehler",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Zahlung zuordnen</DialogTitle>
          {payment && (
            <div className="text-sm text-muted-foreground space-y-1 mt-2">
              <p><strong>Betrag:</strong> {payment.betrag.toFixed(2)} €</p>
              <p><strong>Datum:</strong> {payment.buchungsdatum && isValid(parseISO(payment.buchungsdatum)) ? format(parseISO(payment.buchungsdatum), 'dd.MM.yyyy') : '-'}</p>
              {payment.empfaengername && <p><strong>Empfänger:</strong> {payment.empfaengername}</p>}
              {payment.verwendungszweck && <p><strong>Verwendungszweck:</strong> {payment.verwendungszweck}</p>}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Assignment Type Selector */}
          <div className="space-y-2">
            <div className="flex gap-2 p-1 bg-muted rounded-lg">
              <Button
                variant={assignmentType === 'contract' ? 'default' : 'ghost'}
                size="sm"
                className="flex-1"
                onClick={() => setAssignmentType('contract')}
              >
                Mietvertrag
              </Button>
              <Button
                variant={assignmentType === 'property' ? 'default' : 'ghost'}
                size="sm"
                className="flex-1"
                onClick={() => setAssignmentType('property')}
                disabled={isMiete}
              >
                Immobilie
              </Button>
            </div>
            
            {isMiete && (
              <p className="text-sm text-muted-foreground px-1">
                Mietzahlungen können nur Mietverträgen zugeordnet werden
              </p>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={assignmentType === 'contract' ? "Mieter, Immobilie oder Adresse suchen..." : "Immobilie oder Adresse suchen..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Content based on assignment type */}
          {assignmentType === 'contract' ? (
            <ScrollArea className="h-[400px] border rounded-lg">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  Lade Mietverträge...
                </div>
              ) : filteredContracts?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Keine Mietverträge gefunden
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {filteredContracts?.map((contract) => {
                    // Alle Mieter des Vertrags sammeln
                    const allMieter = contract.mietvertrag_mieter?.map(mm => mm.mieter).filter(Boolean) || [];
                    const mieterNames = allMieter
                      .map(m => `${m?.vorname} ${m?.nachname}`)
                      .join(', ');
                    const immobilie = contract.einheiten?.immobilien;
                    const warmmiete = (contract.kaltmiete || 0) + (contract.betriebskosten || 0);
                    
                    // Status styling
                    const statusConfig = {
                      aktiv: { label: 'Aktiv', variant: 'default' as const, icon: CheckCircle, className: 'bg-green-100 text-green-800 border-green-200' },
                      gekuendigt: { label: 'Gekündigt', variant: 'secondary' as const, icon: Clock, className: 'bg-orange-100 text-orange-800 border-orange-200' },
                      beendet: { label: 'Beendet', variant: 'outline' as const, icon: XCircle, className: 'bg-gray-100 text-gray-600 border-gray-200' },
                    };
                    const status = (contract as any).status as keyof typeof statusConfig || 'aktiv';
                    const config = statusConfig[status] || statusConfig.aktiv;
                    const StatusIcon = config.icon;

                    return (
                      <div
                        key={contract.id}
                        className={`p-4 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group ${
                          status === 'beendet' ? 'opacity-75 border-dashed' : ''
                        }`}
                        onClick={() => handleAssignToContract(contract.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            {/* Mieter mit Status-Badge */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold">
                                {mieterNames || 'Kein Mieter'}
                              </span>
                              {allMieter.length > 1 && (
                                <span className="text-xs text-muted-foreground">
                                  ({allMieter.length} Mieter)
                                </span>
                              )}
                              {/* Status Badge */}
                              <Badge variant={config.variant} className={`text-xs flex items-center gap-1 ${config.className}`}>
                                <StatusIcon className="h-3 w-3" />
                                {config.label}
                              </Badge>
                            </div>

                            {/* Immobilie */}
                            {immobilie && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Building2 className="h-4 w-4" />
                                <span>{immobilie.name}</span>
                              </div>
                            )}

                            {/* Adresse */}
                            {immobilie?.adresse && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <MapPin className="h-4 w-4" />
                                <span>{immobilie.adresse}</span>
                              </div>
                            )}

                            {/* Vertragsdaten */}
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                <span>
                                  {contract.start_datum && isValid(parseISO(contract.start_datum)) ? format(parseISO(contract.start_datum), 'dd.MM.yyyy') : '-'}
                                  {contract.ende_datum && isValid(parseISO(contract.ende_datum)) && ` - ${format(parseISO(contract.ende_datum), 'dd.MM.yyyy')}`}
                                </span>
                              </div>
                              <div>
                                <strong>{warmmiete.toFixed(2)} €</strong> / Monat
                              </div>
                            </div>
                          </div>

                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isAssigning}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Zuordnen
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </ScrollArea>
          ) : (
            <ScrollArea className="h-[400px] border rounded-lg">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  Lade Immobilien...
                </div>
              ) : filteredProperties?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Keine Immobilien gefunden
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {filteredProperties?.map((property) => (
                    <div
                      key={property.id}
                      className="p-4 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group"
                      onClick={() => handleAssignToProperty(property.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          {/* Property Name */}
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{property.name}</span>
                          </div>

                          {/* Address */}
                          {property.adresse && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>{property.adresse}</span>
                            </div>
                          )}

                          {/* Additional Info */}
                          <div className="text-sm text-muted-foreground">
                            {property.einheiten_anzahl} Einheiten
                            {property.objekttyp && ` • ${property.objekttyp}`}
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isAssigning}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Zuordnen
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCategorizeAsNonRent}
              disabled={isAssigning}
            >
              Als Nichtmiete kategorisieren
            </Button>
            <Button
              variant="outline"
              onClick={handleUnassign}
              disabled={isAssigning}
            >
              Zuordnung aufheben
            </Button>
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
