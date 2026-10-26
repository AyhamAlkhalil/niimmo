
import { CardContent } from "@/components/ui/card";
import { ArrowUpRight, MapPin, Users } from "lucide-react";
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
      // Get all units for this property
      const { data: einheiten, error: einheitenError } = await supabase
        .from('einheiten')
        .select('id')
        .eq('immobilie_id', immobilie.id);

      if (einheitenError) throw einheitenError;

      if (!einheiten || einheiten.length === 0) {
        return { aktive: 0, gekuendigt: 0, beendet: 0, leerstehend: immobilie.einheiten_anzahl, gesamt: immobilie.einheiten_anzahl };
      }

      // Get rental contracts for these units
      const einheitIds = einheiten.map(e => e.id);
      const { data: vertraege, error: vertraegeError } = await supabase
        .from('mietvertrag')
        .select('status')
        .in('einheit_id', einheitIds);

      if (vertraegeError) throw vertraegeError;

      const aktive = vertraege?.filter(v => v.status === 'aktiv').length || 0;
      const gekuendigt = vertraege?.filter(v => v.status === 'gekuendigt').length || 0;
      const beendet = vertraege?.filter(v => v.status === 'beendet').length || 0;
      const leerstehend = immobilie.einheiten_anzahl - aktive - gekuendigt - beendet;

      return { aktive, gekuendigt, beendet, leerstehend, gesamt: immobilie.einheiten_anzahl };
    }
  });

  const auslastung = einheitenStatus && einheitenStatus.gesamt > 0
    ? Math.min(100, Math.round(((einheitenStatus.aktive + einheitenStatus.gekuendigt) / einheitenStatus.gesamt) * 100))
    : 0;

  // Überzeile „Sehnde · Mischnutzung“ aus vorhandenen Stammdaten (26.10.2026)
  const ueberzeile = [immobilie.ort, immobilie.objekttyp].filter(Boolean).join(" · ") || "Objekt";

  const status = einheitenStatus
    ? [
        { label: "Aktiv", wert: einheitenStatus.aktive, punkt: "bg-forest-500" },
        { label: "Gekündigt", wert: einheitenStatus.gekuendigt, punkt: "bg-ochre-500" },
        { label: "Leer", wert: Math.max(0, einheitenStatus.beendet + einheitenStatus.leerstehend), punkt: "bg-brand" },
      ]
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow truncate">{ueberzeile}</p>
            <h3 className="mt-2 line-clamp-2 pb-0.5 font-display text-2xl leading-[1.12] text-foreground sm:text-3xl">
              {immobilie.name}
            </h3>
            <div className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2 text-sm leading-snug">{immobilie.adresse}</span>
            </div>
          </div>

          <div className="shrink-0 rounded-xl border border-border/80 bg-muted/50 px-3.5 py-2.5 text-center">
            <div className="font-display text-3xl leading-none tabular-nums text-foreground">
              {immobilie.einheiten_anzahl}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Einheiten
            </div>
          </div>
        </div>

        {/* Auslastungsanzeige */}
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Auslastung</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{auslastung}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/80">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-sanft"
              style={{ width: `${auslastung}%` }}
            />
          </div>
        </div>
      </div>

      <CardContent className="mt-auto space-y-4 px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
        {immobilie.beschreibung && (
          <p className="line-clamp-2 rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            {immobilie.beschreibung}
          </p>
        )}

        {status && (
          <>
            <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border/80 bg-neutral-50/60">
              {status.map((s) => (
                <div key={s.label} className="px-2 py-3 text-center">
                  <div className="font-display text-2xl leading-none tabular-nums text-foreground">{s.wert}</div>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${s.punkt}`} aria-hidden="true" />
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-border/80 pt-3.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span className="tabular-nums">{einheitenStatus.aktive} von {einheitenStatus.gesamt} vermietet</span>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-foreground/70 transition-colors group-hover:text-brand">
                Objekt öffnen
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 ease-sanft group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            </div>
          </>
        )}
      </CardContent>
    </div>
  );
};
