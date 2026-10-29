import { Badge } from "@/components/ui/badge";
import { FehlendeMietzahlungenItem } from "./FehlendeMietzahlungenItem";
import type { FehlendeMietzahlung } from "@/hooks/useRueckstaende";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

interface StatusGroupProps {
  status: 'aktiv' | 'gekuendigt' | 'beendet';
  items: FehlendeMietzahlung[];
  isGuthaben?: boolean;
  onMietvertragClick: (mietvertragId: string, event?: React.MouseEvent) => void;
  formatBetrag: (betrag: number) => string;
}

// Rollen-Tokens statt fester Farben (Regel 9, 29.10.2026). „Aktiv“ war grün — mitten in den Rückständen las
// sich das wie „in Ordnung“; jetzt neutral, gekündigt als Hinweis, beendet zurückgenommen.
const statusConfig = {
  aktiv: {
    label: 'Aktive Verträge',
    icon: CheckCircle2,
    bgColor: 'bg-muted/60',
    borderColor: 'border-border',
    textColor: 'text-foreground',
    iconColor: 'text-muted-foreground'
  },
  gekuendigt: {
    label: 'Gekündigte Verträge',
    icon: Clock,
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    textColor: 'text-foreground',
    iconColor: 'text-warning'
  },
  beendet: {
    label: 'Beendete Verträge',
    icon: XCircle,
    bgColor: 'bg-muted/40',
    borderColor: 'border-border',
    textColor: 'text-muted-foreground',
    iconColor: 'text-muted-foreground'
  }
};

export function FehlendeMietzahlungenStatusGroup({
  status,
  items,
  isGuthaben = false,
  onMietvertragClick,
  formatBetrag
}: StatusGroupProps) {
  if (items.length === 0) return null;

  const config = statusConfig[status];
  const Icon = config.icon;
  const totalAmount = items.reduce((sum, item) => sum + item.fehlend_betrag, 0);

  return (
    <div className={`space-y-2 ${status === 'beendet' ? 'opacity-70' : ''}`}>
      {/* Status Header */}
      <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${config.bgColor} ${config.borderColor} border rounded-md`}>
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${config.iconColor}`} aria-hidden="true" />
          <span className={`text-sm font-medium ${config.textColor}`}>{config.label}</span>
          <Badge variant="outline" className={`text-xs ${config.textColor} ${config.borderColor}`}>
            {items.length}
          </Badge>
          {status === 'beendet' && (
            <span className="text-xs italic text-muted-foreground">nicht in Summe</span>
          )}
        </div>
        <span className={`text-sm font-semibold ${isGuthaben ? 'text-success' : 'text-brand'}`}>
          {formatBetrag(totalAmount)}
        </span>
      </div>

      {/* Items */}
      <div className="space-y-2 pl-2 sm:pl-4 border-l-2 border-border">
        {items.map((item) => (
          <FehlendeMietzahlungenItem
            key={item.mietvertrag_id}
            item={item}
            isGuthaben={isGuthaben}
            onMietvertragClick={onMietvertragClick}
            formatBetrag={formatBetrag}
          />
        ))}
      </div>
    </div>
  );
}
