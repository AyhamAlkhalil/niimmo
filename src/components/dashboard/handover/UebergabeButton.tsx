import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { UebergabeDialog } from "./UebergabeDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface UebergabeButtonProps {
  vertrag?: {
    id: string;
    status: string;
    kuendigungsdatum?: string;
    mieter?: Array<{
      vorname: string;
      nachname: string;
    }>;
  } | null;
  einheit?: {
    id: string;
    nummer?: string;
    etage?: string;
  };
  immobilie?: {
    name: string;
    adresse: string;
  };
  onSuccess?: () => void;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

export const UebergabeButton = ({
  vertrag,
  einheit,
  immobilie,
  onSuccess,
  className,
  size = "sm",
}: UebergabeButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const { toast } = useToast();

  // Check if the button should be enabled
  const isGekuendigt = vertrag?.status === "gekuendigt";

  // Beendete Verträge: Die Übergabe steht häufig noch aus, wenn der Vertrag
  // formal schon beendet ist — der Button muss deshalb erreichbar bleiben.
  const isBeendet = vertrag?.status === "beendet";

  // Check if contract is active but expires within 3 months
  const isExpiringWithin3Months = () => {
    if (!vertrag || vertrag.status !== "aktiv") return false;
    if (!vertrag.kuendigungsdatum) return false;

    const kuendigungDate = new Date(vertrag.kuendigungsdatum);
    const today = new Date();
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    return kuendigungDate <= threeMonthsFromNow && kuendigungDate >= today;
  };

  const canShowUebergabe = isGekuendigt || isBeendet || isExpiringWithin3Months();

  if (!vertrag) {
    return null;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!canShowUebergabe) {
      toast({
        title: "Übergabe nicht möglich",
        description: "Der Mietvertrag ist noch nicht gekündigt oder läuft nicht innerhalb der nächsten 3 Monate aus.",
        variant: "destructive",
      });
      return;
    }

    setShowDialog(true);
  };

  const mieterName = vertrag.mieter
    ?.map((m) => `${m.vorname} ${m.nachname}`)
    .join(", ");

  const button = (
    <Button
      variant={canShowUebergabe ? "outline" : "ghost"}
      size={size}
      onClick={handleClick}
      className={cn(
        "w-full",
        canShowUebergabe
          ? "border-orange-500 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
          : "text-muted-foreground cursor-not-allowed opacity-60",
        className
      )}
    >
      <KeyRound className="h-4 w-4 mr-2" />
      Übergabe (Auszug)
    </Button>
  );

  // Wrap in tooltip if disabled to show explanation
  if (!canShowUebergabe) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-center">
            <p>Mietvertrag ist noch nicht gekündigt</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      {button}
      <UebergabeDialog
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        vertragIds={[vertrag.id]}
        contracts={[{
          id: vertrag.id,
          einheit: {
            id: einheit?.id || "",
            nummer: einheit?.nummer,
            etage: einheit?.etage,
            immobilie: {
              name: immobilie?.name || "",
              adresse: immobilie?.adresse || ""
            }
          },
          kuendigungsdatum: vertrag.kuendigungsdatum
        }]}
        mieterName={mieterName}
        onSuccess={onSuccess}
      />
    </>
  );
};
