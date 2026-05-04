import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ImmobilienCard } from "@/components/dashboard/ImmobilienCard";
import { ImmobilienDetail } from "@/components/dashboard/ImmobilienDetail";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { FehlendeMietzahlungen } from "@/components/dashboard/FehlendeMietzahlungen";
import { Analytics } from "@/components/dashboard/Analytics";

import { SearchPanel } from "@/components/dashboard/SearchPanel";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { EditableMietUebersicht } from "@/components/dashboard/EditableMietUebersichtModal";
import { RentIncreaseList } from "@/components/dashboard/rent-increase/RentIncreaseList";
import { PaymentManagement } from "@/components/controlboard/PaymentManagement";
import { Uebergabe } from "@/pages/Uebergabe";
import { DarlehenVerwaltung } from "@/components/dashboard/DarlehenVerwaltung";
import { HausmeisterDashboard } from "@/components/dashboard/HausmeisterDashboard";

import { ZaehlerVerwaltung } from "@/components/dashboard/ZaehlerVerwaltung";
import { MietaufstellungBank } from "@/components/dashboard/MietaufstellungBank";
import { DevActivityLog } from "@/components/dashboard/DevActivityLog";
import { AgentLogViewer } from "@/components/dashboard/AgentLogViewer";
import { BlacklistVerwaltung } from "@/components/dashboard/BlacklistVerwaltung";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

import { useState, useMemo, useCallback } from "react";
import { Loader2, Building2, BarChart3, Settings, KeyRound, Wrench, TableProperties, Gauge, Landmark, FileSpreadsheet, Activity, Bot, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sortPropertiesByName } from "@/utils/contractUtils";
import { useNavigationState } from "@/hooks/useNavigationState";
import { DEV_EMAIL } from "@/constants/config";

const Index = () => {
  const { isAdmin, isHausmeister, isLoading: roleLoading } = useUserRole();
  const { user } = useAuth();
  const { navState, updateNav } = useNavigationState();
  const isDev = user?.email === DEV_EMAIL;

  // Derive persisted values
  const selectedImmobilie = navState.selectedImmobilie;
  const selectedEinheit = navState.selectedEinheit;
  const selectedMietvertrag = navState.selectedMietvertrag;
  const showAnalytics = navState.showAnalytics;
  const showControlboard = navState.showControlboard;
  const showUebergabe = navState.showUebergabe;
  const showDarlehen = navState.showDarlehen;
  const navigationSource = navState.navigationSource;

  // Setter wrappers
  const setSelectedImmobilie = useCallback((v: string | null) => updateNav({ selectedImmobilie: v }), [updateNav]);
  const setSelectedEinheit = useCallback((v: string | null) => updateNav({ selectedEinheit: v }), [updateNav]);
  const setSelectedMietvertrag = useCallback((v: string | null) => updateNav({ selectedMietvertrag: v }), [updateNav]);
  const setShowAnalytics = useCallback((v: boolean) => updateNav({ showAnalytics: v }), [updateNav]);
  const setShowControlboard = useCallback((v: boolean) => updateNav({ showControlboard: v }), [updateNav]);
  const setShowUebergabe = useCallback((v: boolean) => updateNav({ showUebergabe: v }), [updateNav]);
  const setShowDarlehen = useCallback((v: boolean) => updateNav({ showDarlehen: v }), [updateNav]);
  const setNavigationSource = useCallback((v: 'dashboard' | 'immobilie' | 'search') => updateNav({ navigationSource: v }), [updateNav]);

  const [showStammdaten, setShowStammdaten] = useState<boolean>(false);
  const [showZaehlerVerwaltung, setShowZaehlerVerwaltung] = useState<boolean>(false);
  const [showMietaufstellung, setShowMietaufstellung] = useState<boolean>(false);
  const [showDevLog, setShowDevLog] = useState<boolean>(false);
  const [showAgentLogs, setShowAgentLogs] = useState<boolean>(false);
  const [showBlacklist, setShowBlacklist] = useState<boolean>(false);
  const [rueckstaendeOpen, setRueckstaendeOpen] = useState<boolean>(false);
  const [rentIncreaseOpen, setRentIncreaseOpen] = useState<boolean>(false);
  const [listSource, setListSource] = useState<'rueckstaende' | 'rentincrease' | null>(null);
  const [scrollToContractId, setScrollToContractId] = useState<string | null>(null);
  const {
    data: immobilien,
    isLoading,
    refetch
  } = useQuery({
    queryKey: ['immobilien'],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from('immobilien').select('*').order('name');
      if (error) throw error;
      return data;
    }
  });

  // Query to get unit status for each property for sorting by occupancy
  const {
    data: einheitenStatusMap
  } = useQuery({
    queryKey: ['einheiten-status-all'],
    queryFn: async () => {
      if (!immobilien) return {};

      // Bulk-fetch all units and contracts in 2 queries instead of 2*N
      const { data: alleEinheiten, error: einheitenError } = await supabase
        .from('einheiten')
        .select('id, immobilie_id');
      if (einheitenError) throw einheitenError;

      const einheitIds = (alleEinheiten || []).map(e => e.id);
      const { data: alleVertraege, error: vertraegeError } = await supabase
        .from('mietvertrag')
        .select('status, einheit_id')
        .in('einheit_id', einheitIds);
      if (vertraegeError) throw vertraegeError;

      // Build a map: einheit_id -> immobilie_id
      const einheitToImmobilie: Record<string, string> = {};
      for (const e of alleEinheiten || []) {
        if (e.immobilie_id) einheitToImmobilie[e.id] = e.immobilie_id;
      }

      // Count active contracts per immobilie
      const aktiveProImmobilie: Record<string, number> = {};
      for (const v of alleVertraege || []) {
        if (v.status === 'aktiv' && v.einheit_id) {
          const immId = einheitToImmobilie[v.einheit_id];
          if (immId) {
            aktiveProImmobilie[immId] = (aktiveProImmobilie[immId] || 0) + 1;
          }
        }
      }

      const statusMap: Record<string, number> = {};
      for (const immobilie of immobilien) {
        const aktive = aktiveProImmobilie[immobilie.id] || 0;
        statusMap[immobilie.id] = Math.round((aktive / immobilie.einheiten_anzahl) * 100);
      }
      return statusMap;
    },
    enabled: !!immobilien
  });

  // Sort immobilien using centralized utility
  const sortedImmobilien = useMemo(() => {
    if (!immobilien) return [];
    return sortPropertiesByName(immobilien);
  }, [immobilien]);
  const handleImmobilieClick = (immobilieId: string, einheitId?: string) => {
    updateNav({ selectedImmobilie: immobilieId, selectedEinheit: einheitId || null, selectedMietvertrag: null, selectedTab: null });
    setNavigationSource('immobilie');
  };
  const handleBackClick = () => {
    // Return to dashboard lists for dashboard-originated navigations
    if (navigationSource === 'dashboard' || listSource) {
      setSelectedImmobilie(null);
      setSelectedEinheit(null);
      setSelectedMietvertrag(null);
      setNavigationSource('dashboard');

      // Ensure the originating list is open and scroll to specific contract card
      setTimeout(() => {
        if (listSource === 'rueckstaende') {
          setRueckstaendeOpen(true);
          // Scroll to specific contract card if we have the ID
          if (scrollToContractId) {
            setTimeout(() => {
              const element = document.getElementById(`rueckstand-${scrollToContractId}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100); // Wait for list to open
          } else {
            document.getElementById('rueckstaende-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else if (listSource === 'rentincrease') {
          setRentIncreaseOpen(true);
          // Scroll to specific contract card if we have the ID
          if (scrollToContractId) {
            setTimeout(() => {
              const element = document.getElementById(`rentincrease-${scrollToContractId}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100); // Wait for list to open
          } else {
            document.getElementById('rentincrease-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        setListSource(null);
        setScrollToContractId(null);
      }, 0);
    } else if (navigationSource === 'search') {
      // Coming from search, go back to dashboard and scroll to search
      setSelectedImmobilie(null);
      setSelectedEinheit(null);
      setSelectedMietvertrag(null);
      setNavigationSource('dashboard');
      // Scroll to search panel after returning
      setTimeout(() => {
        document.getElementById('search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } else {
      // Coming from immobilie view
      if (selectedMietvertrag) {
        // Close contract view/modal within immobilie context
        setSelectedMietvertrag(null);
      } else {
        // Go back to main dashboard overview
        setSelectedImmobilie(null);
        setSelectedEinheit(null);
        setNavigationSource('dashboard');
      }
    }
    // Refresh the immobilien data when going back
    refetch();
  };
  const handleNavigateToContract = (immobilieId: string, einheitId: string, mietvertragId: string) => {
    setSelectedImmobilie(immobilieId);
    setSelectedEinheit(einheitId);
    setSelectedMietvertrag(mietvertragId);
    setNavigationSource('dashboard');
  };

  const handleMietvertragClick = async (mietvertragId: string) => {
    const { data: mietvertrag } = await supabase
      .from('mietvertrag')
      .select(`einheit_id, einheiten (immobilie_id)`)
      .eq('id', mietvertragId)
      .maybeSingle(); // Use maybeSingle to handle cases where no data exists
      
    if (mietvertrag?.einheit_id && mietvertrag.einheiten?.immobilie_id) {
      setSelectedImmobilie(mietvertrag.einheiten.immobilie_id);
      setSelectedEinheit(mietvertrag.einheit_id);
      setSelectedMietvertrag(mietvertragId);
      setScrollToContractId(mietvertragId); // Store for scroll-back
      setNavigationSource('dashboard');
    }
  };

  const handleSearchMietvertragClick = async (mietvertragId: string) => {
    const { data: mietvertrag } = await supabase
      .from('mietvertrag')
      .select(`einheit_id, einheiten (immobilie_id)`)
      .eq('id', mietvertragId)
      .maybeSingle();
      
    if (mietvertrag?.einheit_id && mietvertrag.einheiten?.immobilie_id) {
      setSelectedImmobilie(mietvertrag.einheiten.immobilie_id);
      setSelectedEinheit(mietvertrag.einheit_id);
      setSelectedMietvertrag(mietvertragId);
      setNavigationSource('search');
    }
  };

  const handleSearchImmobilieClick = (immobilieId: string, einheitId?: string, tab?: string) => {
    updateNav({
      selectedImmobilie: immobilieId,
      selectedEinheit: einheitId || null,
      selectedMietvertrag: null,
      selectedTab: tab || null,
      navigationSource: 'search',
    });
  };

  const handleRentIncreaseContractClick = async (mietvertragId: string) => {
    const { data: mietvertrag } = await supabase
      .from('mietvertrag')
      .select(`einheit_id, einheiten (immobilie_id)`)
      .eq('id', mietvertragId)
      .maybeSingle();
      
    if (mietvertrag?.einheit_id && mietvertrag.einheiten?.immobilie_id) {
      setSelectedImmobilie(mietvertrag.einheiten.immobilie_id);
      setSelectedEinheit(mietvertrag.einheit_id);
      setSelectedMietvertrag(mietvertragId);
      setScrollToContractId(mietvertragId); // Store for scroll-back
      setNavigationSource('dashboard');
    }
  };

  if (isLoading || roleLoading) {
    return <div className="min-h-screen modern-dashboard-bg flex items-center justify-center">
        <div className="glass-card p-12 rounded-3xl">
          <Loader2 className="h-12 w-12 animate-spin text-red-500 mx-auto mb-6" />
          <p className="text-gray-700 font-sans font-medium text-lg text-center">Dashboard wird geladen...</p>
        </div>
      </div>;
  }

  // Hausmeister bekommt eigenes Dashboard
  if (isHausmeister) {
    return <HausmeisterDashboard />;
  }

  // Analytics-Ansicht anzeigen
  if (showAnalytics) {
    return <Analytics onBack={() => setShowAnalytics(false)} />;
  }



  // Controlboard-Ansicht anzeigen
  if (showControlboard) {
    return <PaymentManagement onBack={() => setShowControlboard(false)} />;
  }

  // Übergabe-Ansicht anzeigen
  if (showUebergabe) {
    return <Uebergabe onBack={() => setShowUebergabe(false)} />;
  }

  // Darlehen-Ansicht anzeigen
  if (showDarlehen) {
    return <DarlehenVerwaltung onBack={() => setShowDarlehen(false)} />;
  }

  // Zählerverwaltung anzeigen
  if (showZaehlerVerwaltung) {
    return <ZaehlerVerwaltung onBack={() => setShowZaehlerVerwaltung(false)} />;
  }

  // Mietaufstellung für Bank anzeigen
  if (showMietaufstellung) {
    return <MietaufstellungBank onBack={() => setShowMietaufstellung(false)} />;
  }

  // Dev Activity Log anzeigen (nur für info@kitdienstleistungen.de)
  if (showDevLog && isDev) {
    return <DevActivityLog onBack={() => setShowDevLog(false)} />;
  }

  // Chilla Agent-Logs anzeigen (nur für Admins)
  if (showAgentLogs && isAdmin) {
    return <AgentLogViewer onBack={() => setShowAgentLogs(false)} />;
  }

  // Blacklist anzeigen (nur für Admins)
  if (showBlacklist && isAdmin) {
    return <BlacklistVerwaltung onBack={() => setShowBlacklist(false)} />;
  }

  // Stammdaten-Ansicht anzeigen
  if (showStammdaten) {
    return <EditableMietUebersicht onBack={() => setShowStammdaten(false)} />;
  }

  if (selectedImmobilie) {
    return <ImmobilienDetail
      immobilieId={selectedImmobilie}
      onBack={handleBackClick}
      filters={{
        mietstatus: "all",
        zahlungsstatus: "all",
        vertragsart: "all"
      }}
      scrollToEinheitId={selectedEinheit}
      openMietvertragId={selectedMietvertrag}
      onContractModalClose={() => {
        // If user came from a dashboard list (Rückstände or Mieterhöhungen), go back to that list
        if (listSource) {
          handleBackClick();
        } else {
          setSelectedMietvertrag(null);
        }
      }}
      isHausmeister={isHausmeister}
      initialTab={navState.selectedTab ?? undefined}
    />;
  }
  return <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <div className="glass-card p-4 sm:p-6 rounded-xl sm:rounded-2xl mb-4 sm:mb-6">
            <div className="flex flex-col gap-4">
              {/* Logo & Title Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 sm:gap-4">
                  <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="NiImmo Logo" className="h-8 sm:h-12 w-auto" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-xl sm:text-2xl lg:text-3xl font-sans font-bold text-gradient-red">
                        NiImmo
                      </h1>
                      {isHausmeister && (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
                          <Wrench className="h-3 w-3 mr-1" />
                          Hausmeister
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-600 font-sans text-xs sm:text-sm hidden sm:block">
                      {isHausmeister ? "Zähler & Einheiten" : "Zentrale Verwaltung"}
                    </p>
                  </div>
                </div>
                <UserMenu />
              </div>
              
              {/* Action Buttons - Only for Admin */}
              {isAdmin && (
                <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-2 sm:flex-wrap">
                  <Button 
                    onClick={() => setShowControlboard(true)} 
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <Settings className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Zahlungen</span>
                  </Button>
                  <Button 
                    onClick={() => setShowUebergabe(true)} 
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <KeyRound className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Übergabe</span>
                  </Button>
                  <Button 
                    onClick={() => setShowStammdaten(true)} 
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <TableProperties className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Stammdaten</span>
                  </Button>
                  <Button 
                    onClick={() => setShowZaehlerVerwaltung(true)} 
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <Gauge className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Zählerverwaltung</span>
                  </Button>
                  <Button
                    onClick={() => setShowDarlehen(true)}
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <Landmark className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Darlehen</span>
                  </Button>
                  <Button
                    onClick={() => setShowMietaufstellung(true)}
                    variant="ghost"
                    size="sm"
                    className="bg-white/60 hover:bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:text-gray-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Mietaufstellung</span>
                  </Button>
                  <Button
                    onClick={() => setShowBlacklist(true)}
                    variant="ghost"
                    size="sm"
                    className="bg-orange-50/60 hover:bg-orange-100/80 backdrop-blur-sm border border-orange-200/50 text-orange-700 hover:text-orange-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <ShieldAlert className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Blacklist</span>
                  </Button>
                  <Button
                    onClick={() => setShowAgentLogs(true)}
                    variant="ghost"
                    size="sm"
                    className="bg-indigo-50/60 hover:bg-indigo-100/80 backdrop-blur-sm border border-indigo-200/50 text-indigo-700 hover:text-indigo-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                  >
                    <Bot className="h-4 w-4 mr-1.5 shrink-0" />
                    <span className="truncate">Chilla Logs</span>
                  </Button>
                  {isDev && (
                    <Button
                      onClick={() => setShowDevLog(true)}
                      variant="ghost"
                      size="sm"
                      className="bg-red-50/60 hover:bg-red-100/80 backdrop-blur-sm border border-red-200/50 text-red-700 hover:text-red-900 transition-all duration-200 justify-start sm:justify-center h-10 sm:h-9"
                    >
                      <Activity className="h-4 w-4 mr-1.5 shrink-0" />
                      <span className="truncate">Activity Log</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Dashboard Stats - Only for Admin */}
          {isAdmin && (
            <DashboardStats 
              immobilien={immobilien} 
              onNavigateToContract={handleNavigateToContract}
            />
          )}
        </div>

        {/* Fehlende Mietzahlungen Übersicht - Only for Admin */}
        {isAdmin && (
          <div className="mb-6">
            <FehlendeMietzahlungen 
              open={rueckstaendeOpen}
              onOpenChange={setRueckstaendeOpen}
              onMietvertragClick={(id) => { setListSource('rueckstaende'); setRueckstaendeOpen(true); handleMietvertragClick(id); }} 
            />
          </div>
        )}

        {/* Mögliche Mieterhöhungen - Only for Admin */}
        {isAdmin && (
          <div className="mb-6">
            <RentIncreaseList 
              open={rentIncreaseOpen}
              onOpenChange={setRentIncreaseOpen}
              onContractClick={(id) => { setListSource('rentincrease'); setRentIncreaseOpen(true); handleRentIncreaseContractClick(id); }}
            />
          </div>
        )}

        {/* Suchfunktion */}
        <div id="search-panel">
          <SearchPanel
            onImmobilieSelect={handleSearchImmobilieClick}
            onMietvertragClick={handleSearchMietvertragClick}
            onDarlehenSelect={() => setShowDarlehen(true)}
          />
        </div>

        {/* Immobilien Grid */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-2xl font-sans font-bold text-gray-800">Ihre Immobilien</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {sortedImmobilien?.map((immobilie, index) => (
              <div 
                key={immobilie.id} 
                className="glass-card rounded-2xl overflow-hidden group hover:shadow-xl transition-all duration-300 cursor-pointer" 
                style={{ animationDelay: `${index * 0.1}s` }} 
                onClick={() => handleImmobilieClick(immobilie.id)}
              >
                <ImmobilienCard immobilie={immobilie} onClick={() => handleImmobilieClick(immobilie.id)} />
              </div>
            ))}
          </div>
        </div>

        {sortedImmobilien?.length === 0 && <div className="text-center py-20">
            <div className="glass-card p-12 max-w-md mx-auto rounded-3xl">
              <div className="relative mb-8">
                <Building2 className="h-20 w-20 text-red-300 mx-auto floating-animation" />
              </div>
              <h3 className="text-2xl font-sans font-semibold text-gray-700 mb-4">
                Keine Immobilien gefunden
              </h3>
              <p className="text-gray-500 font-sans leading-relaxed">
                Beginnen Sie mit der Verwaltung Ihres Portfolios
              </p>
            </div>
          </div>}
      </div>
      
    </div>;
};
export default Index;