import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status eines Mietvertrags als Etikett -- die eine Zuordnung von Status zu Farbe
 * (docs/architektur.md §5, „Statusfarben aus einer Quelle“). Bis zum 26.10.2026 gab
 * es vier eigene Varianten: Suche, Stammdaten, Vertragsdialog und Einheitenkarte.
 */
type VertragStatus = "aktiv" | "gekuendigt" | "beendet" | string | null | undefined;

const DARSTELLUNG: Record<"aktiv" | "gekuendigt" | "beendet" | "leer", { text: string; variante: "success" | "warning" | "secondary" | "brand" }> = {
  aktiv: { text: "Aktiv", variante: "success" },
  gekuendigt: { text: "Gekündigt", variante: "warning" },
  beendet: { text: "Beendet", variante: "secondary" },
  leer: { text: "Leerstand", variante: "brand" },
};

interface VertragStatusBadgeProps {
  status: VertragStatus;
  /** Einheit ohne Vertrag */
  leer?: boolean;
  /** Abweichender Text, z. B. „Leerstehend“ */
  text?: string;
  className?: string;
}

export function VertragStatusBadge({ status, leer = false, text, className }: VertragStatusBadgeProps) {
  const schluessel = leer ? "leer" : status === "aktiv" || status === "gekuendigt" || status === "beendet" ? status : null;
  if (!schluessel) {
    return status ? <Badge variant="secondary" className={className}>{text ?? status}</Badge> : null;
  }
  const { text: standardText, variante } = DARSTELLUNG[schluessel];
  return (
    <Badge variant={variante} className={cn("whitespace-nowrap", className)}>
      {text ?? standardText}
    </Badge>
  );
}
