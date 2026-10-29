import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, User } from "lucide-react";
import type { FehlendeMietzahlung } from "@/hooks/useRueckstaende";
import { monatText } from "@/utils/rueckstandSeit";

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
  // Farben über Rollen-Tokens (Regel 9); bis zum 29.10.2026 feste red-/green-/gray-Klassen
  const borderColor = isGuthaben ? 'border-success/30' : 'border-brand/30';
  const amountColor = isGuthaben ? 'text-success' : 'text-brand';
  const label = isGuthaben ? 'Guthaben' : 'Rückstand';
  // Seit wann und wie viele Monatsmieten (29.10.2026, Prüfung der Rückstandsliste): Das braucht, wer Rückstände
  // abarbeitet und über Mahnung oder Kündigung entscheidet — die Summen seit Mietbeginn sagen das nicht.
  // Nur der Mietanteil, abgerundet (Review): 1,95 Monatsmieten sind noch keine zwei.
  const monatsmieten = isGuthaben || item.mietvertrag_status === 'Beendet' ? null : item.rueckstand_monatsmieten;

  return (
    <Card
      key={item.mietvertrag_id}
      id={`rueckstand-${item.mietvertrag_id}`}
      className={`border ${borderColor} cursor-pointer bg-card transition-colors hover:bg-accent/60`}
      onClick={(e) => onMietvertragClick(item.mietvertrag_id, e)}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1 space-y-2 min-w-0">
            {/* Objekt und Einheit */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <h3 className="font-semibold text-foreground text-sm sm:text-base">
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

            <p className="text-xs sm:text-sm text-muted-foreground truncate">{item.immobilie_adresse}</p>

            {/* Mieter und Miete: Kaltmiete + Betriebskosten, denn daran misst sich der Rückstand */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <User className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{item.mieter_name}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                {item.monatsmiete > 0 && <span className="whitespace-nowrap">Miete {formatBetrag(item.monatsmiete)} im Monat</span>}
                {item.einheit_qm > 0 && (
                  <span className="whitespace-nowrap">{item.einheit_qm} m²</span>
                )}
              </div>
            </div>

            {/* Betrag zuerst, darunter seit wann; die Summen seit Mietbeginn zur Kontrolle */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 pt-2 text-xs sm:text-sm">
              <div className="col-span-2 sm:col-span-1 sm:order-3">
                <p className="text-muted-foreground">{label}</p>
                <p className={`font-bold ${amountColor} text-base`}>
                  {formatBetrag(item.fehlend_betrag)}
                </p>
                {!isGuthaben && (item.rueckstand_seit || monatsmieten !== null) && (
                  <p className="text-xs text-muted-foreground">
                    {item.rueckstand_seit && `offen seit ${monatText(item.rueckstand_seit)}`}
                    {item.rueckstand_seit && monatsmieten !== null && ' · '}
                    {monatsmieten !== null && `Miete für ${monatsmieten.toLocaleString('de-DE')} ${monatsmieten === 1 ? 'Monat' : 'Monate'} offen`}
                  </p>
                )}
              </div>
              <div className="sm:order-1">
                <p className="text-muted-foreground">Forderungen seit Mietbeginn</p>
                <p className="font-medium text-foreground">{formatBetrag(item.gesamt_forderungen)}</p>
              </div>
              <div className="sm:order-2">
                <p className="text-muted-foreground">Zahlungen seit Mietbeginn</p>
                <p className="font-medium text-foreground">{formatBetrag(item.gesamt_zahlungen)}</p>
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
                Dazu {formatBetrag(item.vorauszahlung)} Vorauszahlung auf eine noch nicht fällige Forderung, z. B. die nächste Miete — nicht im Betrag enthalten
              </p>
            )}
          </div>

          {/* Action Section - Hidden on mobile, details accessible via card click */}
          <div className="hidden sm:flex flex-col items-end gap-2 ml-4 flex-shrink-0">
            {!isGuthaben && item.mahnstufe > 0 && (
              <Badge variant="destructive" className="text-xs">
                Mahnstufe {item.mahnstufe}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => onMietvertragClick(item.mietvertrag_id, e)}
              className="gap-2"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
