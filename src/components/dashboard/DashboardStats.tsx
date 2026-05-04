
import { Building2, Euro, Home, TrendingDown, TrendingUp, Percent, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";

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
      const { data, error } = await supabase
        .from('mietvertrag')
        .select(`
          id, 
          kaltmiete,
          betriebskosten,
          status, 
          ende_datum, 
          kuendigungsdatum,
          einheit_id,
          einheiten(
            id,
            immobilie_id
          )
        `);
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
        .in('kategorie', ['Miete', 'Rücklastschrift'])
        .eq('zugeordneter_monat', aktuellerMonat)
        .not('mietvertrag_id', 'is', null);
      if (error) {
        return 0;
      }
      // Rücklastschriften haben negativen betrag → reduzieren die Erfasste Miete automatisch
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

  const aktiveMietvertraege = mietvertraege?.filter(mv => mv.status === 'aktiv') || [];
  const gekuendigteMietvertraege = mietvertraege?.filter(mv => mv.status === 'gekuendigt') || [];
  // Nur Verträge die bereits begonnen haben (start_datum <= heute)
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const relevanteVertraege = [...aktiveMietvertraege, ...gekuendigteMietvertraege].filter(v => {
    if (!v.start_datum) return true;
    return new Date(v.start_datum + 'T00:00:00') <= heute;
  });
  
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
      const kuendigungsdatum = mv.kuendigungsdatum ? new Date(mv.kuendigungsdatum) : null;
      const auslaufdatum = mv.ende_datum ? new Date(mv.ende_datum) : null;
      let naechstesDatumFuerVertrag: Date | null = null;
      if (kuendigungsdatum && kuendigungsdatum > heute) {
        naechstesDatumFuerVertrag = kuendigungsdatum;
      }
      if (auslaufdatum && auslaufdatum > heute) {
        if (!naechstesDatumFuerVertrag || auslaufdatum < naechstesDatumFuerVertrag) {
          naechstesDatumFuerVertrag = auslaufdatum;
        }
      }
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

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Row 1: Verschmolzene kompakte Leiste */}
      <div className="metric-card px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border border-gray-200 bg-white/80 flex items-center gap-3 sm:gap-6 overflow-x-auto scrollbar-hide" style={{ animationDelay: '0s' }}>
        {/* Immobilien */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-100 border border-blue-200 flex-shrink-0">
            <Building2 className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-gray-900">{immobilien?.length || 0}</span>
            <span className="text-[10px] sm:text-xs text-gray-500 hidden sm:inline">Immobilien</span>
          </div>
        </div>

        <div className="w-px h-6 bg-gray-200" />

        {/* Einheiten */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-green-100 border border-green-200 flex-shrink-0">
            <Home className="h-3.5 w-3.5 text-green-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-gray-900">{gesamtEinheiten || 0}</span>
            <span className="text-[10px] sm:text-xs text-gray-500 hidden sm:inline">Einheiten</span>
          </div>
        </div>

        <div className="w-px h-6 bg-gray-200" />

        {/* Status */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] sm:text-xs text-gray-500">Leer</span>
            <span className="text-sm sm:text-base font-bold text-gray-900">{leerstände}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-[10px] sm:text-xs text-gray-500">Gekündigt</span>
            <span className="text-sm sm:text-base font-bold text-red-600">{gekuendigteMietvertraege.length}</span>
          </div>
          <div
            className="hidden sm:flex items-center gap-1.5 cursor-pointer hover:bg-gray-100 rounded px-1.5 py-0.5 -mx-1.5 transition-colors"
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
            <TrendingDown className="h-3 w-3 text-gray-400" />
            <span className="text-[10px] sm:text-xs text-gray-500">Nächstes Ende</span>
            <span className="text-[10px] sm:text-xs font-medium text-gray-700">{formatDatum(naechstesDatum)}</span>
          </div>
        </div>

        <div className="w-px h-6 bg-gray-200 hidden lg:block" />

        {/* Basiszinssatz */}
        <div className="hidden lg:flex items-center gap-2 group">
          <div className="p-1.5 rounded-lg bg-orange-100 border border-orange-200 flex-shrink-0">
            <Percent className="h-3.5 w-3.5 text-orange-600" />
          </div>
          {editingTyp === 'basiszinssatz' ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={editWert}
                onChange={e => setEditWert(e.target.value)}
                className="w-16 text-xs border rounded px-1 py-0.5 h-6"
                autoFocus
              />
              <button onClick={() => saveMarktdaten('basiszinssatz', parseFloat(editWert))} className="text-green-600 hover:text-green-700">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingTyp(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-gray-900">
                    {marktdaten?.basiszins ? `${marktdaten.basiszins.wert}%` : '–'}
                  </span>
                  <span className="text-[10px] text-gray-400">→ {marktdaten?.basiszins ? `${(marktdaten.basiszins.wert + 5).toFixed(2)}%` : '–'}</span>
                  {isAdmin && (
                    <button
                      onClick={() => { setEditingTyp('basiszinssatz'); setEditWert(String(marktdaten?.basiszins?.wert ?? '')); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
                    >
                      <Pencil className="h-2.5 w-2.5 text-gray-400" />
                    </button>
                  )}
                </div>
                <span className="text-[10px] text-gray-400">Basis / Verzug</span>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-gray-200 hidden lg:block" />

        {/* VPI */}
        <div className="hidden lg:flex items-center gap-2 group">
          <div className="p-1.5 rounded-lg bg-teal-100 border border-teal-200 flex-shrink-0">
            <TrendingUp className="h-3.5 w-3.5 text-teal-600" />
          </div>
          {editingTyp === 'vpi' ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                value={editWert}
                onChange={e => setEditWert(e.target.value)}
                className="w-16 text-xs border rounded px-1 py-0.5 h-6"
                autoFocus
              />
              <button onClick={() => saveMarktdaten('vpi', parseFloat(editWert))} className="text-green-600 hover:text-green-700">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingTyp(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-1">
                <span className="text-sm font-bold text-gray-900">
                  {marktdaten?.vpi ? marktdaten.vpi.wert.toFixed(1) : '–'}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => { setEditingTyp('vpi'); setEditWert(String(marktdaten?.vpi?.wert ?? '')); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-2.5 w-2.5 text-gray-400" />
                  </button>
                )}
              </div>
              <span className="text-[10px] text-gray-400">VPI 2020=100</span>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Monatliche Miete – volle Breite */}
      <div 
        className="metric-card p-4 sm:p-5 lg:p-6 rounded-xl sm:rounded-2xl border border-purple-100 bg-purple-50"
        style={{ animationDelay: '0.3s' }}
      >
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <div className="p-2 sm:p-2.5 rounded-lg bg-purple-100 border border-purple-200">
              <Euro className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm sm:text-base font-semibold text-gray-800">Monatliche Miete</p>
              <p className="text-[10px] sm:text-xs text-gray-500">{getCurrentMonthYear()}</p>
            </div>
        </div>

        {/* Hauptmetriken */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-4">
          <div>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">Erwartete Miete</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">€{erwartedMiete.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">Erfasste Miete</p>
            <div className="flex items-center gap-1.5">
              <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">€{(erfassedMiete || 0).toLocaleString()}</p>
              {(erfassedMiete === 0 || erfassedMiete === null || erfassedMiete === undefined) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">Noch keine Zahlungen für diesen Monat erfasst. Bitte laden Sie einen Kontoauszug (CSV) im Controlboard hoch.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">Differenz</p>
            <p className={`text-lg sm:text-xl lg:text-2xl font-bold ${differenz > 0 ? 'text-red-600' : differenz < 0 ? 'text-green-600' : 'text-gray-900'}`}>
              {differenz > 0 ? '-' : differenz < 0 ? '+' : ''}€{Math.abs(differenz).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Detailzeile */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 border-t border-purple-200/60 text-[10px] sm:text-xs text-gray-500">
          <span>Kaltmiete: <strong className="text-gray-700">€{gesamtKaltmiete.toLocaleString()}</strong></span>
          <span>Betriebskosten: <strong className="text-gray-700">€{gesamtBetriebskosten.toLocaleString()}</strong></span>
          <span className="hidden sm:inline">|</span>
          <span>Einheiten: <strong className="text-gray-700">{gesamtEinheiten || 0}</strong></span>
          <span>Leerstand: <strong className={leerstände > 0 ? 'text-red-600' : 'text-green-600'}>{leerstände}</strong></span>
        </div>
      </div>
    </div>
  );
};
