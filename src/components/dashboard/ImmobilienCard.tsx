
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building, MapPin, TrendingUp, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ImmobilienCardProps {
  immobilie: {
    id: string;
    name: string;
    adresse: string;
    einheiten_anzahl: number;
    beschreibung?: string;
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

  return (
    <div className="h-full">
      <CardHeader className="p-3 sm:p-4 lg:pb-4">
        <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
            <div className="p-2 sm:p-3 accent-red rounded-lg sm:rounded-xl modern-shadow flex-shrink-0">
              <Building className="h-4 w-4 sm:h-6 sm:w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm sm:text-lg lg:text-xl font-sans font-semibold text-gray-800 mb-0.5 sm:mb-1 truncate">
                {immobilie.name}
              </CardTitle>
              <div className="flex items-start text-gray-500">
                <MapPin className="h-3 w-3 sm:h-4 sm:w-4 mr-1 mt-0.5 flex-shrink-0" />
                <span className="text-xs sm:text-sm font-sans leading-tight line-clamp-2">{immobilie.adresse}</span>
              </div>
            </div>
          </div>
          
          <div className="metric-card px-2 py-1.5 sm:px-4 sm:py-3 rounded-lg sm:rounded-xl border border-gray-100 flex-shrink-0">
            <div className="text-lg sm:text-2xl font-sans font-bold text-gray-800 text-center">
              {immobilie.einheiten_anzahl}
            </div>
            <div className="text-[10px] sm:text-xs text-gray-500 font-sans font-medium text-center">
              Einheiten
            </div>
          </div>
        </div>

        {/* Auslastungsanzeige */}
        <div className="space-y-2 sm:space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-sans font-medium text-gray-600">Auslastung</span>
            <span className="text-xs sm:text-sm font-sans font-bold text-gray-800">{auslastung}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 sm:h-3 overflow-hidden">
            <div 
              className="h-full progress-bar rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${auslastung}%` }}
            ></div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 px-3 pb-3 sm:px-4 sm:pb-4 space-y-3 sm:space-y-6">
        {immobilie.beschreibung && (
          <p className="text-xs sm:text-sm font-sans text-gray-600 leading-relaxed line-clamp-2 bg-gray-50 p-2 sm:p-3 rounded-lg">
            {immobilie.beschreibung}
          </p>
        )}

        {einheitenStatus && (
          <div className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
              <div className="text-center p-2 sm:p-4 bg-green-50 rounded-lg sm:rounded-xl border border-green-100 metric-card">
                <div className="flex items-center justify-center mb-1 sm:mb-2">
                  <div className="w-2 h-2 sm:w-3 sm:h-3 bg-green-500 rounded-full modern-shadow"></div>
                </div>
                <div className="text-sm sm:text-lg font-sans font-bold text-green-700">{einheitenStatus.aktive}</div>
                <div className="text-[10px] sm:text-xs text-green-600 font-sans font-medium">Aktiv</div>
              </div>
              
              <div className="text-center p-2 sm:p-4 bg-yellow-50 rounded-lg sm:rounded-xl border border-yellow-100 metric-card">
                <div className="flex items-center justify-center mb-1 sm:mb-2">
                  <div className="w-2 h-2 sm:w-3 sm:h-3 bg-yellow-500 rounded-full modern-shadow"></div>
                </div>
                <div className="text-sm sm:text-lg font-sans font-bold text-yellow-700">{einheitenStatus.gekuendigt}</div>
                <div className="text-[10px] sm:text-xs text-yellow-600 font-sans font-medium">Gekündigt</div>
              </div>
              
              <div className="text-center p-2 sm:p-4 bg-red-50 rounded-lg sm:rounded-xl border border-red-100 metric-card">
                <div className="flex items-center justify-center mb-1 sm:mb-2">
                  <div className="w-2 h-2 sm:w-3 sm:h-3 bg-red-500 rounded-full modern-shadow"></div>
                </div>
                <div className="text-sm sm:text-lg font-sans font-bold text-red-700">{Math.max(0, einheitenStatus.beendet + einheitenStatus.leerstehend)}</div>
                <div className="text-[10px] sm:text-xs text-red-600 font-sans font-medium">Leer</div>
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2 sm:pt-4 border-t border-gray-100">
              <div className="flex items-center space-x-1 sm:space-x-2">
                <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400" />
                <span className="text-[10px] sm:text-xs text-gray-500 font-sans font-medium">Performance</span>
              </div>
              <div className="flex items-center space-x-1">
                <Users className="h-3 w-3 sm:h-4 sm:w-4 text-gray-400" />
                <span className="text-[10px] sm:text-xs text-gray-500 font-sans font-medium">{einheitenStatus.aktive}/{einheitenStatus.gesamt}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </div>
  );
};
