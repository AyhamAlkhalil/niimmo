import { cn } from "@/lib/utils";
import { KATEGORIE_TON_KLASSEN, kategorieLabel, kategorieTon } from "@/utils/zahlungKategorie";

/**
 * Farbrollen statt Palettenfarben (docs/architektur.md §5). Zuordnung und
 * Klassen liegen in utils/zahlungKategorie.ts.
 */

interface KategorieBadgeProps {
  kategorie: string | null | undefined;
  className?: string;
}

export function KategorieBadge({ kategorie, className }: KategorieBadgeProps) {
  const ton = kategorie ? kategorieTon(kategorie) : "muted";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
        KATEGORIE_TON_KLASSEN[ton],
        !kategorie && "border-dashed",
        className
      )}
    >
      {kategorieLabel(kategorie)}
    </span>
  );
}
