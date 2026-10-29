import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Euro, User } from "lucide-react";
import type { FehlendeMietzahlung } from "@/hooks/useRueckstaende";

interface FehlendeMietzahlungenItemProps {
  item: FehlendeMietzahlung;
  isGuthaben?: boolean;
  onMietvertragClick: (mietvertragId: string, event?: React.MouseEvent) => void;
  formatBetrag: (betrag: number) => string;
}

export function FehlendeMietzahlungenItem({
  item,
  isGuthaben = false,
  onMietvertragClick,
  formatBetrag
}: FehlendeMietzahlungenItemProps) {
  const borderColor = isGuthaben ? 'border-green-200' : 'border-red-200';
  const amountColor = isGuthaben ? 'text-green-600' : 'text-red-600';
  const label = isGuthaben ? 'Guthaben' : 'Rückstand';

  return (
    <Card 
      key={item.mietvertrag_id}
      id={`rueckstand-${item.mietvertrag_id}`}
      className={`border ${borderColor} bg-white/50 hover:bg-white/80 transition-all duration-200 cursor-pointer hover-scale`}
      onClick={(e) => onMietvertragClick(item.mietvertrag_id, e)}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1 space-y-2 min-w-0">
            {/* Property and Unit Info */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <h3 className="font-semibold text-gray-900 text-sm sm:text-base">
                {item.immobilie_name}
              </h3>
              <Badge variant="outline" className="text-xs">
                {item.einheit_nummer ? `Einheit ${item.einheit_nummer} · ` : ''}{item.einheit_typ} - {item.einheit_etage}
              </Badge>
              {/* Mahnstufe - Show inline on mobile */}
              {!isGuthaben && item.mahnstufe > 0 && (
                <Badge variant="destructive" className="text-xs sm:hidden">
                  Mahnstufe {item.mahnstufe}
                </Badge>
              )}
            </div>
            
            {/* Address */}
            <p className="text-xs sm:text-sm text-gray-600 truncate">{item.immobilie_adresse}</p>
            
            {/* Tenant Info - Stack on mobile */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <User className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">{item.mieter_name}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-1">
                  <Euro className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span className="whitespace-nowrap">Kaltmiete: {formatBetrag(item.kaltmiete)}</span>
                </div>
                {item.einheit_qm > 0 && (
                  <span className="whitespace-nowrap">{item.einheit_qm} m²</span>
                )}
              </div>
            </div>

            {/* Financial grid - 2 cols on mobile, 3 on desktop */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 pt-2 text-xs sm:text-sm">
              <div>
                <p className="text-gray-600">Forderungen</p>
                <p className="font-medium">{formatBetrag(item.gesamt_forderungen)}</p>
              </div>
              <div>
                <p className="text-gray-600">Zahlungen</p>
                <p className="font-medium text-green-600">{formatBetrag(item.gesamt_zahlungen)}</p>
              </div>
              <div className="col-span-2 sm:col-span-1 pt-1 sm:pt-0 border-t sm:border-t-0 border-gray-200">
                <p className="text-gray-600">{label}</p>
                <p className={`font-bold ${amountColor} text-sm sm:text-base`}>
                  {formatBetrag(item.fehlend_betrag)}
                </p>
              </div>
            </div>
            {item.bka_ohne_forderung !== 0 && (
              <p className="text-xs text-warning">
                {formatBetrag(Math.abs(item.bka_ohne_forderung))} {item.bka_ohne_forderung > 0 ? 'BKA-Zahlung' : 'BKA-Auszahlung'} ohne BKA-Forderung, nicht im Betrag — bitte die Betriebskostenabrechnung als Forderung anlegen
              </p>
            )}
            {item.verbundener_gegenbetrag > 0 && (
              <p className="text-xs text-warning">
                Ein weiterer Vertrag dieses Mieters hat {formatBetrag(item.verbundener_gegenbetrag)} {isGuthaben ? 'Rückstand' : 'Guthaben'} — vielleicht eine Sammelzahlung; bitte die Zahlung aufteilen
              </p>
            )}
            {item.vorauszahlung > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatBetrag(item.vorauszahlung)} sind mit noch nicht fälligen Forderungen verrechnet und im Betrag nicht enthalten
              </p>
            )}
          </div>

          {/* Action Section - Hidden on mobile, details accessible via card click */}
          <div className="hidden sm:flex flex-col items-end gap-2 ml-4 flex-shrink-0">
            {/* Mahnstufe */}
            {!isGuthaben && item.mahnstufe > 0 && (
              <Badge variant="destructive" className="text-xs">
                Mahnstufe {item.mahnstufe}
              </Badge>
            )}
            
            {/* View Button */}
            <Button 
              variant="outline" 
              size="sm"
              onClick={(e) => onMietvertragClick(item.mietvertrag_id, e)}
              className="gap-2"
            >
              <Eye className="h-4 w-4" />
              Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
