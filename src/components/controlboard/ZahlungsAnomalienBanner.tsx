import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { useZahlungsAnomalien, useUpdateZahlungsAnomalieStatus } from "@/hooks/useZahlungsAnomalien";

const EUR_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

interface ZahlungsAnomalienBannerProps {
  /** Wird aufgerufen, wenn der Nutzer von einem Finding zur betroffenen Zahlung im Controlboard springen möchte. */
  onNavigateToZahlung?: (zahlungId: string, buchungsdatum: string | null) => void;
}

/**
 * Zeigt vom Cron-Job `check_zahlungs_anomalien()` erkannte Verdachtsfälle:
 * Zahlungen, die vermutlich dem falschen Mietvertrag desselben Mieters
 * zugeordnet wurden. Nur für Admins sichtbar, rein additiv (keine
 * Änderung an der eigentlichen Zuordnungslogik).
 */
export function ZahlungsAnomalienBanner({ onNavigateToZahlung }: ZahlungsAnomalienBannerProps) {
  const { isAdmin } = useUserRole();
  const { anomalien, count, isLoading } = useZahlungsAnomalien();
  const updateStatus = useUpdateZahlungsAnomalieStatus();
  const [isOpen, setIsOpen] = useState(true);

  if (!isAdmin || isLoading || count === 0) {
    return null;
  }

  return (
    <Alert className="mb-6 border-orange-300 bg-orange-50/80">
      <AlertTriangle className="h-4 w-4 text-orange-600" />
      <div>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center justify-between gap-2">
            <AlertTitle className="text-orange-900">
              {count} Zahlungs-Zuordnung{count > 1 ? 'en' : ''} zur Prüfung
            </AlertTitle>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-orange-700 hover:bg-orange-100 shrink-0"
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
          <AlertDescription className="text-orange-800/80">
            Diese Zahlungen wurden möglicherweise dem falschen Vertrag desselben Mieters zugeordnet.
            Wird täglich neu geprüft — behobene Fälle verschwinden automatisch. "Als geprüft"/"Ignorieren"
            blendet den Fall nur für heute aus, nicht dauerhaft.
          </AlertDescription>
          <CollapsibleContent>
            <div className="space-y-3 mt-3">
              {anomalien.map((anomalie) => (
                <div key={anomalie.id} className="rounded-lg border border-orange-200 bg-white p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-foreground">
                          {EUR_FORMATTER.format(anomalie.betrag)}
                        </span>
                        {anomalie.buchungsdatum && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(anomalie.buchungsdatum), 'dd.MM.yyyy', { locale: de })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Aktuell zugeordnet: </span>
                        <span className="font-medium">
                          {anomalie.zugeordneterMietvertrag?.mieterNamen ?? 'Unbekannt'}
                        </span>
                        {' – '}
                        {anomalie.zugeordneterMietvertrag?.einheitBezeichnung ?? 'Unbekannt'}
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Vermutet passender: </span>
                        <span className="font-medium">
                          {anomalie.vermuteterMietvertrag?.mieterNamen ?? 'Unbekannt'}
                        </span>
                        {' – '}
                        {anomalie.vermuteterMietvertrag?.einheitBezeichnung ?? 'Unbekannt'}
                      </p>
                      <p className="text-xs text-muted-foreground italic">{anomalie.begruendung}</p>
                    </div>
                    <div className="flex sm:flex-col gap-2 shrink-0">
                      {onNavigateToZahlung && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onNavigateToZahlung(anomalie.zahlungId, anomalie.buchungsdatum)}
                        >
                          <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                          Zur Zahlung springen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: anomalie.id, status: 'geprueft' })}
                      >
                        Als geprüft markieren
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: anomalie.id, status: 'ignoriert' })}
                      >
                        Ignorieren
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Alert>
  );
}
