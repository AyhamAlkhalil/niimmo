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
import { VersionBadge } from "@/components/dashboard/ChangelogDialog";
import { DevActivityLog } from "@/components/dashboard/DevActivityLog";
import { AgentLogViewer } from "@/components/dashboard/AgentLogViewer";
import { BlacklistVerwaltung } from "@/components/dashboard/BlacklistVerwaltung";
import { AufgabenBoard } from "@/components/aufgaben/AufgabenBoard";
import { MailProtokoll } from "@/components/dashboard/MailProtokoll";
import { NeuerMietvertragDialog } from "@/components/dashboard/NeuerMietvertragDialog";
import VermieterStammdatenDialog from "@/components/dashboard/VermieterStammdatenDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";

import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import { Loader2, Building2, BarChart3, Settings, KeyRound, Wrench, TableProperties, Gauge, Landmark, FileSpreadsheet, Activity, Bot, ShieldAlert, FilePlus2, ListChecks, Mail, Building, Box, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sortPropertiesByName } from "@/utils/contractUtils";
import { useNavigationState } from "@/hooks/useNavigationState";
import { DEV_EMAIL } from "@/constants/config";
import { Fehlergrenze3D } from "@/components/dashboard/ansicht3d/Fehlergrenze3D";

// three.js ist gross; die 3D-Ansicht wird erst geladen, wenn jemand sie oeffnet.
const ladeAnsicht3D = () => import("@/components/dashboard/ansicht3d/Ansicht3D");
const Ansicht3D = lazy(ladeAnsicht3D);

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
  const showAufgabenBoard = navState.showAufgabenBoard;
  const selectedAufgabe = navState.selectedAufgabe;
  const navigationSource = navState.navigationSource;

  // Setter wrappers
  const setSelectedImmobilie = useCallback((v: string | null) => updateNav({ selectedImmobilie: v }), [updateNav]);
  const setSelectedEinheit = useCallback((v: string | null) => updateNav({ selectedEinheit: v }), [updateNav]);
  const setSelectedMietvertrag = useCallback((v: string | null) => updateNav({ selectedMietvertrag: v }), [updateNav]);
  const setShowAnalytics = useCallback((v: boolean) => updateNav({ showAnalytics: v }), [updateNav]);
  const setShowControlboard = useCallback((v: boolean) => updateNav({ showControlboard: v }), [updateNav]);
  const setShowUebergabe = useCallback((v: boolean) => updateNav({ showUebergabe: v }), [updateNav]);
  const setShowDarlehen = useCallback((v: boolean) => updateNav({ showDarlehen: v }), [updateNav]);
  const setShowAufgabenBoard = useCallback(
    (v: boolean, aufgabeId: string | null = null) => updateNav({ showAufgabenBoard: v, selectedAufgabe: aufgabeId }),
    [updateNav],
  );
  const setNavigationSource = useCallback((v: 'dashboard' | 'immobilie' | 'search') => updateNav({ navigationSource: v }), [updateNav]);
  const setFokus3D = useCallback((v: string | null) => updateNav({ fokus3D: v }), [updateNav]);

  const [showStammdaten, setShowStammdaten] = useState<boolean>(false);
  const [showZaehlerVerwaltung, setShowZaehlerVerwaltung] = useState<boolean>(false);
  const [showMietaufstellung, setShowMietaufstellung] = useState<boolean>(false);
  const [showDevLog, setShowDevLog] = useState<boolean>(false);
  const [showAgentLogs, setShowAgentLogs] = useState<boolean>(false);
  const [showBlacklist, setShowBlacklist] = useState<boolean>(false);
  const [showMails, setShowMails] = useState<boolean>(false);
  const [showNeuerMietvertrag, setShowNeuerMietvertrag] = useState<boolean>(false);
  const [showVermieter, setShowVermieter] = useState<boolean>(false);
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
      updateNav({ selectedImmobilie: null, selectedEinheit: null, selectedMietvertrag: null, selectedTab: null, navigationSource: 'dashboard' });
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
        <div className="flex flex-col items-center gap-5">
          <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="" className="h-16 w-auto mix-blend-multiply" />
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">Dashboard wird geladen …</p>
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

  // Mails ansehen (nur für Admins)
  if (showMails && isAdmin) {
    return <MailProtokoll onBack={() => setShowMails(false)} />;
  }

  // Aufgaben-Board anzeigen (nur für Admins)
  if (showAufgabenBoard && isAdmin) {
    return <AufgabenBoard
      onBack={() => setShowAufgabenBoard(false)}
      aufgabeOeffnen={selectedAufgabe}
      onAufgabeGeoeffnet={() => updateNav({ selectedAufgabe: null })}
    />;
  }

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

  // 3D-Ansicht: steht hinter der Objektseite, damit "Zurueck" dort wieder in 3D landet.
  if (navState.show3D) {
    const schliessen3D = () => updateNav({ show3D: false, fokus3D: null });
    return (
      <Fehlergrenze3D onZurueck={schliessen3D}>
        <Suspense
          fallback={
            <div className="flex min-h-[100dvh] items-center justify-center bg-background">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <span className="ml-3 text-sm font-medium text-foreground">3D-Ansicht wird geladen …</span>
            </div>
          }
        >
          <Ansicht3D
            immobilien={sortedImmobilien}
            fokusId={navState.fokus3D}
            onFokus={setFokus3D}
            onZurueck={schliessen3D}
            onObjektseite={(immobilieId) =>
              updateNav({
                selectedImmobilie: immobilieId,
                selectedEinheit: null,
                selectedMietvertrag: null,
                selectedTab: null,
                navigationSource: 'immobilie',
              })
            }
          />
        </Suspense>
      </Fehlergrenze3D>
    );
  }

  // Bereiche als ruhige Navigationsleiste: drei Gruppen statt einer Knopfwand (26.10.2026)
  const bereiche: { gruppe: string; knoepfe: { label: string; icon: typeof Building2; onClick: () => void; akzent?: string; nurDev?: boolean }[] }[] = [
    {
      gruppe: "Verwaltung",
      knoepfe: [
        { label: "Neuer Mietvertrag", icon: FilePlus2, onClick: () => setShowNeuerMietvertrag(true) },
        { label: "Stammdaten", icon: Building, onClick: () => setShowVermieter(true) },
        { label: "Übergabe", icon: KeyRound, onClick: () => setShowUebergabe(true) },
        { label: "Stammdaten", icon: TableProperties, onClick: () => setShowStammdaten(true) },
        { label: "Zählerverwaltung", icon: Gauge, onClick: () => setShowZaehlerVerwaltung(true) },
      ],
    },
    {
      gruppe: "Finanzen",
      knoepfe: [
        { label: "Zahlungen", icon: Settings, onClick: () => setShowControlboard(true) },
        { label: "Darlehen", icon: Landmark, onClick: () => setShowDarlehen(true) },
        { label: "Mietaufstellung", icon: FileSpreadsheet, onClick: () => setShowMietaufstellung(true) },
      ],
    },
    {
      gruppe: "System",
      knoepfe: [
        { label: "Blacklist", icon: ShieldAlert, onClick: () => setShowBlacklist(true), akzent: "text-terracotta-600" },
        { label: "Aufgaben", icon: ListChecks, onClick: () => setShowAufgabenBoard(true) },
        { label: "Mails", icon: Mail, onClick: () => setShowMails(true) },
        { label: "Chilla Logs", icon: Bot, onClick: () => setShowAgentLogs(true), akzent: "text-iris-600" },
        { label: "Activity Log", icon: Activity, onClick: () => setShowDevLog(true), akzent: "text-brand", nurDev: true },
      ],
    },
  ];
  const heute = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return <div className="min-h-screen modern-dashboard-bg">
      {/* Markenlinie in Karmin, wie der Schnitt einer Visitenkarte */}
      <div className="h-[3px] bg-brand" aria-hidden="true" />
      <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <header className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card sm:mb-6">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex min-w-0 items-center gap-3 sm:gap-5">
                <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="NiImmo Gruppe" className="h-10 w-auto shrink-0 mix-blend-multiply sm:h-14" />
                <div className="hidden h-12 w-px shrink-0 bg-border sm:block" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="eyebrow">{isHausmeister ? "Zähler & Einheiten" : "Zentrale Verwaltung"}</p>
                    {isHausmeister && (
                      <Badge variant="warning">
                        <Wrench className="h-3 w-3" />
                        Hausmeister
                      </Badge>
                    )}
                  </div>
                  <h1 className="mt-0.5 truncate py-0.5 font-display text-2xl leading-tight text-foreground sm:text-3xl">
                    NiImmo <span className="italic text-muted-foreground">Gruppe</span>
                  </h1>
                  <p className="mt-1.5 hidden text-xs capitalize text-muted-foreground sm:block">{heute}</p>
                  <VersionBadge className="mt-1.5 sm:hidden" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <VersionBadge className="hidden sm:flex" />
                <UserMenu />
              </div>
            </div>

            {/* Bereiche - nur für Admin. Jede Gruppe trägt ihr Etikett und bricht nur als Ganzes um */}
            {isAdmin && (
              <nav aria-label="Bereiche" className="border-t border-border/70 bg-neutral-50/70 px-3 py-3 sm:px-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-7 lg:gap-y-2">
                  {bereiche.map((bereich) => (
                    <div key={bereich.gruppe} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                      <span className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground sm:w-auto">{bereich.gruppe}</span>
                      <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:gap-0.5">
                        {bereich.knoepfe.filter((k) => !k.nurDev || isDev).map((knopf, knopfIndex) => {
                          const Icon = knopf.icon;
                          return (
                            <Button
                              key={`${bereich.gruppe}-${knopfIndex}`}
                              onClick={knopf.onClick}
                              variant="ghost"
                              size="sm"
                              className="h-auto min-h-10 justify-start gap-2 whitespace-normal rounded-lg border border-transparent px-3 py-2 text-left leading-tight text-foreground/80 hover:border-border/80 hover:bg-card hover:text-foreground hover:shadow-sm sm:h-9 sm:min-h-0 sm:justify-center sm:whitespace-nowrap sm:px-2.5 sm:py-0"
                            >
                              <Icon className={knopf.akzent ?? "text-muted-foreground"} />
                              <span>{knopf.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </nav>
            )}
          </header>
          
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
          <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
            <div>
              <p className="eyebrow">Portfolio</p>
              <h2 className="mt-1 font-display text-2xl leading-none text-foreground sm:text-3xl">
                Ihre Immobilien
                {sortedImmobilien.length > 0 && <span className="ml-2 align-middle font-sans text-sm font-medium tabular-nums text-muted-foreground">{sortedImmobilien.length}</span>}
              </h2>
            </div>
            <div className="inline-flex shrink-0 items-center rounded-lg border border-border bg-card p-0.5 shadow-sm" role="group" aria-label="Darstellung der Immobilien">
              <Button variant="ghost" size="sm" aria-pressed="true" className="h-8 gap-1.5 rounded-md bg-primary px-2.5 text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground sm:px-3">
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Kacheln</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed="false"
                className="h-8 gap-1.5 rounded-md px-2.5 text-muted-foreground hover:text-foreground sm:px-3"
                onMouseEnter={() => void ladeAnsicht3D()}
                onFocus={() => void ladeAnsicht3D()}
                onClick={() => updateNav({ show3D: true })}
              >
                <Box className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">3D-Ansicht</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            {sortedImmobilien?.map((immobilie, index) => (
              <div 
                key={immobilie.id} 
                className="glass-card group cursor-pointer overflow-hidden rounded-2xl hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-card-hover" 
                style={{ animationDelay: `${index * 0.1}s` }} 
                onClick={() => handleImmobilieClick(immobilie.id)}
              >
                <ImmobilienCard immobilie={immobilie} onClick={() => handleImmobilieClick(immobilie.id)} />
              </div>
            ))}
          </div>
        </div>

        {sortedImmobilien?.length === 0 && <div className="text-center py-20">
            <div className="glass-card p-12 max-w-md mx-auto rounded-2xl">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
                <Building2 className="h-6 w-6 text-brand" />
              </div>
              <h3 className="font-display text-3xl text-foreground mb-2">
                Keine Immobilien gefunden
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Beginnen Sie mit der Verwaltung Ihres Portfolios
              </p>
            </div>
          </div>}
      </div>

      <VermieterStammdatenDialog
        isOpen={showVermieter}
        onClose={() => setShowVermieter(false)}
      />

      <NeuerMietvertragDialog
        isOpen={showNeuerMietvertrag}
        onClose={() => setShowNeuerMietvertrag(false)}
      />

    </div>;
};
export default Index;