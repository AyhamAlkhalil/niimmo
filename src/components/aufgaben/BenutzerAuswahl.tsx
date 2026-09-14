import { cn } from "@/lib/utils";
import { kurzName } from "@/utils/benutzerName";

/** Kleines Kürzel-Abzeichen für Listen und Detailansicht. */
export const BenutzerAbzeichen = ({
  benutzer,
  className,
}: {
  benutzer: { anzeigename: string; kuerzel: string } | null;
  className?: string;
}) => {
  if (!benutzer) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
      title={benutzer.anzeigename}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700">
        {benutzer.kuerzel}
      </span>
      <span className="truncate">{kurzName(benutzer)}</span>
    </span>
  );
};
