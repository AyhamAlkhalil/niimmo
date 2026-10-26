
import { Building2, Euro, Home, TrendingDown, TrendingUp, Percent, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { getVertragsende, istLaufenderVertrag } from "@/utils/contractUtils";

interface DashboardStatsProps {
  immobilien: any[] | undefined;
  onNavigateToContract?: (immobilieId: string, einheitId: string, mietvertragId: string) => void;
}

export const DashboardStats = ({ immobilien, onNavigateToContract }: DashboardStatsProps) => {
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  const [editingTyp, setEditingTyp] = useState<'basiszinssatz' | 'vpi' | null>(null);
  const [editWert, setEditWert] = useState("");
  const { data: gesamtEinheiten } = useQuery({
    queryKey: ['gesamt-einheiten'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('einheiten')
        .select('id');
      if (error) throw error;
      return data?.length || 0;
    }
  });

  const { data: mietvertraege } = useQuery({
    queryKey: ['alle-mietvertrag'],
    queryFn: async () => {
      const heute = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id,
          kaltmiete,
          betriebskosten,
          status,
          start_datum,
          ende_datum,
          kuendigungsdatum,
          einheit_id,
          einheiten(
            id,
            immobilie_id
          )
        `)
        .in('status', ['aktiv', 'gekuendigt'])
        // Verträge die bereits begonnen haben
        .or(`start_datum.is.null,start_datum.lte.${heute}`)
        // Verträge deren ende_datum noch nicht abgelaufen ist
        .or(`ende_datum.is.null,ende_datum.gte.${heute}`)
        // Verträge deren kuendigungsdatum noch nicht abgelaufen ist
        .or(`kuendigungsdatum.is.null,kuendigungsdatum.gte.${heute}`);
      if (error) throw error;
      return data || [];
    }
  });

  const { data: erfassedMiete } = useQuery({
    queryKey: ['erfasste-miete'],
    queryFn: async () => {
      const heute = new Date();
      const aktuellerMonat = heute.toISOString().slice(0, 7);
      const { data: zahlungen, error } = await supabase
        .from('zahlungen')
        .select('betrag')
        .in('kategorie', ['Miete', 'Rücklastschrift', 'Betriebskostenabrechnung'])
        .eq('zugeordneter_monat', aktuellerMonat)
        .not('mietvertrag_id', 'is', null);
      if (error) {
        return 0;
      }
      // Rücklastschriften haben negativen betrag → reduzieren automatisch
      // BKA-Zahlungseingänge (Nachzahlungen) werden als Einnahme gezählt
      return zahlungen?.reduce((sum, zahlung) => sum + (zahlung.betrag || 0), 0) || 0;
    }
  });

  const { data: marktdaten } = useQuery({
    queryKey: ['aktuelle-marktdaten'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('aktuelle_marktdaten')
        .select('*');
      if (error) throw error;
      const basiszins = data?.find((d: any) => d.typ === 'basiszinssatz');
      const vpi = data?.find((d: any) => d.typ === 'vpi');
      return { basiszins, vpi };
    },
    staleTime: 300000,
  });

  const saveMarktdaten = async (typ: 'basiszinssatz' | 'vpi', wert: number) => {
    const heute = new Date().toISOString().split('T')[0];
    await (supabase as any).from('marktdaten').upsert({
      typ,
      wert,
      stichtag: heute,
      quelle: 'Manuelle Korrektur',
      abgerufen_am: new Date().toISOString(),
    }, { onConflict: 'typ,stichtag' });
    queryClient.invalidateQueries({ queryKey: ['aktuelle-marktdaten'] });
    setEditingTyp(null);
  };

  // Dieselbe Stichtagsregel wie Mietaufstellung und Mietuebersicht. Der Filter
  // in der Query oben ist nur der Vorfilter -- massgeblich ist istLaufenderVertrag,
  // damit die drei Ansichten nicht wieder auseinanderlaufen.
  const relevanteVertraege = (mietvertraege || []).filter((mv) => istLaufenderVertrag(mv));
  const aktiveMietvertraege = relevanteVertraege.filter(mv => mv.status === 'aktiv');
  const gekuendigteMietvertraege = relevanteVertraege.filter(mv => mv.status === 'gekuendigt');

  const gesamtKaltmiete = relevanteVertraege.reduce((sum, v) => sum + (v.kaltmiete || 0), 0);
  const gesamtBetriebskosten = relevanteVertraege.reduce((sum, v) => sum + (v.betriebskosten || 0), 0);
  const erwartedMiete = gesamtKaltmiete + gesamtBetriebskosten;
  const differenz = erwartedMiete - (erfassedMiete || 0);

  const vermieteteEinheiten = aktiveMietvertraege.length + gekuendigteMietvertraege.length;
  const leerstände = gesamtEinheiten ? gesamtEinheiten - vermieteteEinheiten : 0;

  // Berechne das nächste Kündigungs- oder Auslaufdatum
  const naechstesVertragInfo = mietvertraege
    ?.reduce((frueheste: { datum: string | null, vertrag: any | null }, mv) => {
      const heute = new Date();
      const ende = getVertragsende(mv);
      const naechstesDatumFuerVertrag = ende && new Date(ende) > heute ? new Date(ende) : null;
      if (!naechstesDatumFuerVertrag) return frueheste;
      const datumString = naechstesDatumFuerVertrag.toISOString().split('T')[0];
      if (!frueheste.datum) return { datum: datumString, vertrag: mv };
      return new Date(datumString) < new Date(frueheste.datum) ? { datum: datumString, vertrag: mv } : frueheste;
    }, { datum: null, vertrag: null });

  const naechstesDatum = naechstesVertragInfo?.datum;
  const naechsterVertrag = naechstesVertragInfo?.vertrag;

  const formatDatum = (datum: string | null) => {
    if (!datum) return 'Keine';
    return new Date(datum).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getCurrentMonthYear = () => {
    const heute = new Date();
    return heute.toLocaleDateString('de-DE', {
      month: 'long',
      year: 'numeric'
    });
  };

  // Beträge wie in Schriftstücken: „48.250 €“ statt „€48,250“, Cent nur wenn vorhanden
  const euro = formatEuroKompakt;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Row 1: Verschmolzene kompakte Leiste */}
      <div className="metric-card flex items-center gap-4 overflow-x-auto rounded-2xl px-4 py-3 scrollbar-hide sm:gap-7 sm:px-6 sm:py-4">
        {/* Immobilien */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60">
            <Building2 className="h-4 w-4 text-foreground/70" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl leading-none tabular-nums text-foreground">{immobilien?.length || 0}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Immobilien</span>
          </div>
        </div>

        <div className="h-8 w-px shrink-0 bg-border" />

        {/* Einheiten */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60">
            <Home className="h-4 w-4 text-foreground/70" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl leading-none tabular-nums text-foreground">{gesamtEinheiten || 0}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Einheiten</span>
          </div>
        </div>

        <div className="h-8 w-px shrink-0 bg-border" />

        {/* Status */}
        <div className="flex shrink-0 items-center gap-4 sm:gap-5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-brand ring-4 ring-brand/10" />
            <span className="text-xs text-muted-foreground">Leer</span>
            <span className="text-sm font-semibold tabular-nums text-foreground sm:text-base">{leerstände}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-ochre-500 ring-4 ring-ochre-500/15" />
            <span className="text-xs text-muted-foreground">Gekündigt</span>
            <span className="text-sm font-semibold tabular-nums text-brand sm:text-base">{gekuendigteMietvertraege.length}</span>
          </div>
          <div
            className="-mx-2 hidden cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent sm:flex"
            onClick={() => {
              if (naechsterVertrag && onNavigateToContract) {
                onNavigateToContract(
                  naechsterVertrag.einheiten?.immobilie_id,
                  naechsterVertrag.einheit_id,
                  naechsterVertrag.id
                );
              }
            }}
          >
            <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Nächstes Ende</span>
            <span className="text-xs font-semibold tabular-nums text-foreground">{formatDatum(naechstesDatum)}</span>
          </div>
        </div>

        <div className="hidden h-8 w-px shrink-0 bg-border lg:block" />

        {/* Basiszinssatz */}
        <div className="group hidden shrink-0 items-center gap-3 lg:flex">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60">
            <Percent className="h-4 w-4 text-foreground/70" />
          </div>
          {editingTyp === 'basiszinssatz' ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={editWert}
                onChange={e => setEditWert(e.target.value)}
                className="h-7 w-20 rounded-md border border-input bg-card px-2 text-xs shadow-feld focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/25"
                autoFocus
              />
              <button onClick={() => saveMarktdaten('basiszinssatz', parseFloat(editWert))} className="rounded-md p-1 text-success hover:bg-success/10" aria-label="Basiszinssatz speichern">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingTyp(null)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Abbrechen">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {marktdaten?.basiszins ? `${marktdaten.basiszins.wert}%` : '–'}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">→ {marktdaten?.basiszins ? `${(marktdaten.basiszins.wert + 5).toFixed(2)}%` : '–'}</span>
                  {isAdmin && (
                    <button
                      onClick={() => { setEditingTyp('basiszinssatz'); setEditWert(String(marktdaten?.basiszins?.wert ?? '')); }}
                      className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="Basiszinssatz bearbeiten"
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">Basis / Verzug</span>
              </div>
            </div>
          )}
        </div>

        <div className="hidden h-8 w-px shrink-0 bg-border lg:block" />

        {/* VPI */}
        <div className="group hidden shrink-0 items-center gap-3 lg:flex">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60">
            <TrendingUp className="h-4 w-4 text-foreground/70" />
          </div>
          {editingTyp === 'vpi' ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                value={editWert}
                onChange={e => setEditWert(e.target.value)}
                className="h-7 w-20 rounded-md border border-input bg-card px-2 text-xs shadow-feld focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/25"
                autoFocus
              />
              <button onClick={() => saveMarktdaten('vpi', parseFloat(editWert))} className="rounded-md p-1 text-success hover:bg-success/10" aria-label="Verbraucherpreisindex speichern">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingTyp(null)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Abbrechen">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {marktdaten?.vpi ? marktdaten.vpi.wert.toFixed(1) : '–'}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => { setEditingTyp('vpi'); setEditWert(String(marktdaten?.vpi?.wert ?? '')); }}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Verbraucherpreisindex bearbeiten"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              <span className="text-xs text-muted-foreground">VPI 2020=100</span>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Monatliche Miete – volle Breite */}
      <div className="metric-card relative overflow-hidden rounded-2xl p-5 sm:p-6 lg:p-7">
        {/* Feine Karminlinie links als Markenzeichen der Leitkennzahl */}
        <div className="absolute inset-y-0 left-0 w-[3px] bg-brand" aria-hidden="true" />
        <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5">
          <div>
            <p className="eyebrow">Monatliche Miete</p>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{getCurrentMonthYear()}</p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/60">
            <Euro className="h-4 w-4 text-foreground/70" />
          </div>
        </div>

        {/* Hauptmetriken */}
        <div className="mb-4 grid grid-cols-3 divide-x divide-border sm:mb-5">
          <div className="pr-3 sm:pr-6">
            <p className="mb-1.5 text-xs text-muted-foreground">Erwartete Miete</p>
            <p className="font-display text-2xl leading-none tabular-nums text-foreground sm:text-3xl lg:text-4xl">{euro(erwartedMiete)}</p>
          </div>
          <div className="px-3 sm:px-6">
            <p className="mb-1.5 text-xs text-muted-foreground">Erfasste Miete</p>
            <div className="flex items-center gap-2">
              <p className="font-display text-2xl leading-none tabular-nums text-foreground sm:text-3xl lg:text-4xl">{euro(erfassedMiete || 0)}</p>
              {(erfassedMiete === 0 || erfassedMiete === null || erfassedMiete === undefined) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 cursor-help text-warning" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">Noch keine Zahlungen für diesen Monat erfasst. Bitte laden Sie einen Kontoauszug (CSV) im Controlboard hoch.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
          <div className="pl-3 sm:pl-6">
            <p className="mb-1.5 text-xs text-muted-foreground">Differenz</p>
            <p className={`font-display text-2xl leading-none tabular-nums sm:text-3xl lg:text-4xl ${differenz > 0 ? 'text-brand' : differenz < 0 ? 'text-success' : 'text-foreground'}`}>
              {differenz > 0 ? '−' : differenz < 0 ? '+' : ''}{euro(Math.abs(differenz))}
            </p>
          </div>
        </div>

        {/* Detailzeile */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/80 pt-3.5 text-xs text-muted-foreground">
          <span>Kaltmiete <strong className="ml-1 font-semibold tabular-nums text-foreground">{euro(gesamtKaltmiete)}</strong></span>
          <span>Betriebskosten <strong className="ml-1 font-semibold tabular-nums text-foreground">{euro(gesamtBetriebskosten)}</strong></span>
          <span className="hidden h-3 w-px bg-border sm:inline-block" aria-hidden="true" />
          <span>Einheiten <strong className="ml-1 font-semibold tabular-nums text-foreground">{gesamtEinheiten || 0}</strong></span>
          <span>Leerstand <strong className={`ml-1 font-semibold tabular-nums ${leerstände > 0 ? 'text-brand' : 'text-success'}`}>{leerstände}</strong></span>
        </div>
      </div>
    </div>
  );
};
