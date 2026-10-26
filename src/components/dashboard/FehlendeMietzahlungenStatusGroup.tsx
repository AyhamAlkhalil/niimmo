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

const statusConfig = {
  aktiv: {
    label: 'Aktive Verträge',
    icon: CheckCircle2,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    iconColor: 'text-green-600'
  },
  gekuendigt: {
    label: 'Gekündigte Verträge',
    icon: Clock,
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-700',
    iconColor: 'text-orange-600'
  },
  beendet: {
    label: 'Beendete Verträge',
    icon: XCircle,
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-700',
    iconColor: 'text-gray-600'
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
    <div className={`space-y-2 ${status === 'beendet' ? 'opacity-50' : ''}`}>
      {/* Status Header */}
      <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${config.bgColor} ${config.borderColor} border rounded-md`}>
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${config.iconColor}`} />
          <span className={`text-sm font-medium ${config.textColor}`}>{config.label}</span>
          <Badge variant="outline" className={`text-xs ${config.textColor} ${config.borderColor}`}>
            {items.length}
          </Badge>
          {status === 'beendet' && (
            <span className="text-xs text-gray-400 italic">nicht in Summe</span>
          )}
        </div>
        <span className={`text-sm font-semibold ${isGuthaben ? 'text-green-600' : 'text-red-600'}`}>
          {formatBetrag(totalAmount)}
        </span>
      </div>

      {/* Items */}
      <div className="space-y-2 pl-2 sm:pl-4 border-l-2 border-gray-200">
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
