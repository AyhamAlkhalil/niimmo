
import { ArrowUpRight } from "lucide-react";
import { Fassade } from "@/components/dashboard/Fassade";
import { objektBelegung } from "@/utils/fassadenPlan";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ImmobilienCardProps {
  immobilie: {
    id: string;
    name: string;
    adresse: string;
    einheiten_anzahl: number;
    beschreibung?: string;
    ort?: string | null;
    objekttyp?: string | null;
    baujahr?: number | null;
  };
  onClick: () => void;
}

export const ImmobilienCard = ({ immobilie, onClick }: ImmobilienCardProps) => {
  const { data: einheitenStatus } = useQuery({
    queryKey: ['einheiten-status', immobilie.id],
    queryFn: async () => {
      const { data: einheiten, error: einheitenError } = await supabase
        .from('einheiten')
        .select('id')
        .eq('immobilie_id', immobilie.id);

      if (einheitenError) throw einheitenError;

      if (!einheiten || einheiten.length === 0) {
        return objektBelegung([], [], immobilie.einheiten_anzahl);
      }

      const einheitIds = einheiten.map(e => e.id);
      const { data: vertraege, error: vertraegeError } = await supabase
        .from('mietvertrag')
        .select('einheit_id, status, start_datum, ende_datum, kuendigungsdatum')
        .in('einheit_id', einheitIds);

      if (vertraegeError) throw vertraegeError;

      // Stichtagsregel wie im Objektkopf, siehe utils/fassadenPlan.ts
      return objektBelegung(einheitIds, vertraege, immobilie.einheiten_anzahl);
    }
  });

  // Überzeile „Sehnde · Mischnutzung“ aus vorhandenen Stammdaten (26.10.2026)
  const ueberzeile = [immobilie.ort, immobilie.objekttyp].filter(Boolean).join(" · ") || "Objekt";

  const frei = einheitenStatus ? einheitenStatus.frei : null;
  const plakette = frei === null ? null : frei === 0 ? "Voll vermietet" : `${frei} ${frei === 1 ? "Einheit" : "Einheiten"} frei`;

  // Exposé-Kachel (27.10.2026): Fassadenzeichnung statt Symbol, darunter Name, Lage und drei Werte
  return (
    <article className="flex h-full flex-col">
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <Fassade id={immobilie.id} objekttyp={immobilie.objekttyp} einheiten={immobilie.einheiten_anzahl} frei={frei ?? 0} />
        {plakette && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 bg-card/95 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-foreground">
            {frei ? <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" /> : null}
            {plakette}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-4">
        <p className="eyebrow truncate">{ueberzeile}</p>
        <h3 className="mt-1.5 line-clamp-2 text-xl font-medium leading-snug text-foreground transition-colors group-hover:text-brand">
          {immobilie.name}
        </h3>
        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{immobilie.adresse}</p>
        {immobilie.beschreibung && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{immobilie.beschreibung}</p>
        )}

        <dl className="mt-auto grid grid-cols-3 border-t border-border pt-3 [&>div+div]:border-l [&>div+div]:border-border [&>div+div]:pl-4 [&>div]:pr-2">
          <div>
            <dt className="text-xs text-muted-foreground">Einheiten</dt>
            <dd className="mt-0.5 text-lg tabular-nums text-foreground">{immobilie.einheiten_anzahl}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Gekündigt</dt>
            <dd className="mt-0.5 text-lg tabular-nums text-foreground">{einheitenStatus ? einheitenStatus.gekuendigt : "–"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Belegung</dt>
            <dd className="mt-0.5 flex items-baseline justify-between gap-2 text-lg tabular-nums text-foreground">
              {einheitenStatus ? `${einheitenStatus.belegungProzent} %` : "–"}
              <ArrowUpRight className="h-4 w-4 shrink-0 self-center text-muted-foreground transition-[color,transform] duration-300 ease-sanft group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
};
