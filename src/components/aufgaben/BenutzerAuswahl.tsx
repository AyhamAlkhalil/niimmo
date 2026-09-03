import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FUNKTION_BEZEICHNUNG, type AppBenutzer } from "@/hooks/useAppBenutzer";
import { kurzName } from "@/utils/benutzerName";

interface BenutzerAuswahlProps {
  benutzer: AppBenutzer[];
  ausgewaehlt: string[];
  onUmschalten: (id: string) => void;
  /** Diese Person ist bereits verantwortlich und wird gesondert gekennzeichnet. */
  verantwortlichId?: string | null;
}

/**
 * Personen zum Markieren. Bewusst als Reihe von Schaltflächen und nicht als
 * Auswahlliste: Bei fünf Personen ist ein Klick schneller als ein Aufklappmenü,
 * und darum geht es beim Melden.
 */
export const BenutzerAuswahl = ({
  benutzer,
  ausgewaehlt,
  onUmschalten,
  verantwortlichId,
}: BenutzerAuswahlProps) => {
  if (!benutzer.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {benutzer.map((person) => {
        const istAusgewaehlt = ausgewaehlt.includes(person.id);
        const istVerantwortlich = person.id === verantwortlichId;

        return (
          <button
            key={person.id}
            type="button"
            onClick={() => onUmschalten(person.id)}
            aria-pressed={istAusgewaehlt}
            title={`${person.anzeigename} — ${FUNKTION_BEZEICHNUNG[person.funktion]}`}
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm transition-colors",
              istAusgewaehlt
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-gray-200 bg-white/70 text-gray-700 hover:bg-white",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                istAusgewaehlt ? "bg-red-600 text-white" : "bg-gray-200 text-gray-700",
              )}
            >
              {istAusgewaehlt ? <Check className="h-3.5 w-3.5" /> : person.kuerzel}
            </span>
            <span className="whitespace-nowrap">
              {person.anzeigename}
              {istVerantwortlich && (
                <span className="ml-1 text-xs text-muted-foreground">· verantwortlich</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

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
