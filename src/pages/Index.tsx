import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ImmobilienCard } from "@/components/dashboard/ImmobilienCard";
import { ImmobilienDetail } from "@/components/dashboard/ImmobilienDetail";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { FehlendeMietzahlungen } from "@/components/dashboard/FehlendeMietzahlungen";
import { Analytics } from "@/components/dashboard/Analytics";

import { SearchPanel } from "@/components/dashboard/SearchPanel";
import { Hauptnavigation, type Bereich, type Ziel } from "@/components/dashboard/Hauptnavigation";
import { EditableMietUebersicht } from "@/components/dashboard/EditableMietUebersichtModal";
import { RentIncreaseList } from "@/components/dashboard/rent-increase/RentIncreaseList";
import { PaymentManagement } from "@/components/controlboard/PaymentManagement";
import { Uebergabe } from "@/pages/Uebergabe";
import { DarlehenVerwaltung } from "@/components/dashboard/DarlehenVerwaltung";
import { HausmeisterDashboard } from "@/components/dashboard/HausmeisterDashboard";

import { ZaehlerVerwaltung } from "@/components/dashboard/ZaehlerVerwaltung";
import { MietaufstellungBank } from "@/components/dashboard/MietaufstellungBank";
import { DevActivityLog } from "@/components/dashboard/DevActivityLog";
import { BlacklistVerwaltung } from "@/components/dashboard/BlacklistVerwaltung";
import { AufgabenBoard } from "@/components/aufgaben/AufgabenBoard";
import { MailProtokoll } from "@/components/dashboard/MailProtokoll";
import { NeuerMietvertragDialog } from "@/components/dashboard/NeuerMietvertragDialog";
import VermieterStammdatenDialog from "@/components/dashboard/VermieterStammdatenDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";

import { useState, useMemo, useCallback, useEffect, lazy, Suspense, type ReactNode } from "react";
import { toast } from "sonner";
import { vertragAusAdresse } from "@/utils/vertragsLink";
import { Loader2, Building2, Box, LayoutGrid } from "lucide-react";
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
  const [showBlacklist, setShowBlacklist] = useState<boolean>(false);
  const [showMails, setShowMails] = useState<boolean>(false);
  const [showNeuerMietvertrag, setShowNeuerMietvertrag] = useState<boolean>(false);
  const [showVermieter, setShowVermieter] = useState<boolean>(false);
  const [rueckstaendeOpen, setRueckstaendeOpen] = useState<boolean>(false);
  const [rentIncreaseOpen, setRentIncreaseOpen] = useState<boolean>(false);
  const [listSource, setListSource] = useState<'rueckstaende' | 'rentincrease' | null>(null);
  const [scrollToContractId, setScrollToContractId] = useState<string | null>(null);

  // Vertrag aus der Adresse öffnen (?vertrag=<id>): Die Liste „Noch offen“ der Startseite öffnet Verträge in
  // einem neuen Tab (29.10.2026). Der Parameter verschwindet, sobald der Vertrag geladen ist, damit Neuladen
  // ihn nicht erneut öffnet; scheitert die Abfrage, bleibt er für einen zweiten Versuch stehen.
  useEffect(() => {
    const mietvertragId = vertragAusAdresse(window.location.search);
    if (!mietvertragId) return;
    const parameterEntfernen = () => window.history.replaceState(window.history.state, '', window.location.pathname);
    void (async () => {
      const { data: mietvertrag, error } = await supabase
        .from('mietvertrag')
        .select('einheit_id, einheiten (immobilie_id)')
        .eq('id', mietvertragId)
        .maybeSingle();
      if (error) {
        toast.error('Der Vertrag konnte nicht geladen werden. Bitte die Seite neu laden.');
        return;
      }
      parameterEntfernen();
      if (!mietvertrag?.einheit_id || !mietvertrag.einheiten?.immobilie_id) {
        toast.error('Diesen Vertrag gibt es nicht mehr oder er ist keiner Einheit zugeordnet.');
        return;
      }
      updateNav({
        showAnalytics: false,
        showControlboard: false,
        showUebergabe: false,
        showDarlehen: false,
        showAufgabenBoard: false,
        selectedAufgabe: null,
        show3D: false,
        fokus3D: null,
        selectedTab: null,
        selectedImmobilie: mietvertrag.einheiten.immobilie_id,
        selectedEinheit: mietvertrag.einheit_id,
        selectedMietvertrag: mietvertragId,
        navigationSource: 'dashboard',
      });
    })();
  }, [updateNav]);

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
          <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="" className="h-16 w-auto" />
          <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">Dashboard wird geladen …</p>
        </div>
      </div>;
  }

  // Menüleiste (27.10.2026): schließt jede offene Ansicht und öffnet das Ziel. Bis dahin
  // ging es von einer Unterseite in die nächste nur über deren Zurück-Knopf.
  const oeffne = (ziel: Ziel) => {
    if (ziel === 'neuer-mietvertrag') { setShowNeuerMietvertrag(true); return; }
    if (ziel === 'vermieter') { setShowVermieter(true); return; }
    setShowStammdaten(ziel === 'stammdaten');
    setShowZaehlerVerwaltung(ziel === 'zaehler');
    setShowMietaufstellung(ziel === 'mietaufstellung');
    setShowDevLog(ziel === 'devlog');
    setShowBlacklist(ziel === 'blacklist');
    setShowMails(ziel === 'mails');
    setListSource(null);
    setScrollToContractId(null);
    updateNav({
      showAnalytics: false,
      showControlboard: ziel === 'zahlungen',
      showUebergabe: ziel === 'uebergabe',
      showDarlehen: ziel === 'darlehen',
      showAufgabenBoard: ziel === 'aufgaben',
      selectedAufgabe: null,
      selectedImmobilie: null,
      selectedEinheit: null,
      selectedMietvertrag: null,
      selectedTab: null,
      show3D: false,
      fokus3D: null,
      navigationSource: 'dashboard',
    });
    window.scrollTo({ top: 0 });
  };

  const zurSuche = () => {
    oeffne('portfolio');
    // Das Suchfeld gibt es erst, wenn die Startseite wieder steht
    window.setTimeout(() => {
      const feld = document.querySelector<HTMLInputElement>('#search-panel input');
      feld?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      feld?.focus({ preventScroll: true });
    }, 60);
  };

  // Dieselbe Reihenfolge wie vorher: Die erste zutreffende Ansicht gewinnt
  let bereich: Bereich = 'portfolio';
  let inhalt: ReactNode;

  if (isHausmeister) {
    // Hausmeister bekommt eigenes Dashboard
    inhalt = <HausmeisterDashboard />;
  } else if (showAnalytics) {
    bereich = 'finanzen';
    inhalt = <Analytics onBack={() => setShowAnalytics(false)} />;
  } else if (showControlboard) {
    bereich = 'finanzen';
    inhalt = <PaymentManagement onBack={() => setShowControlboard(false)} />;
  } else if (showUebergabe) {
    bereich = 'verwaltung';
    inhalt = <Uebergabe onBack={() => setShowUebergabe(false)} />;
  } else if (showDarlehen) {
    bereich = 'finanzen';
    inhalt = <DarlehenVerwaltung onBack={() => setShowDarlehen(false)} />;
  } else if (showZaehlerVerwaltung) {
    bereich = 'verwaltung';
    inhalt = <ZaehlerVerwaltung onBack={() => setShowZaehlerVerwaltung(false)} />;
  } else if (showMietaufstellung) {
    bereich = 'finanzen';
    inhalt = <MietaufstellungBank onBack={() => setShowMietaufstellung(false)} />;
  } else if (showDevLog && isDev) {
    // Dev Activity Log (nur für info@kitdienstleistungen.de)
    bereich = 'system';
    inhalt = <DevActivityLog onBack={() => setShowDevLog(false)} />;
  } else if (showMails && isAdmin) {
    bereich = 'system';
    inhalt = <MailProtokoll onBack={() => setShowMails(false)} />;
  } else if (showAufgabenBoard && isAdmin) {
    bereich = 'system';
    inhalt = <AufgabenBoard
      onBack={() => setShowAufgabenBoard(false)}
      aufgabeOeffnen={selectedAufgabe}
      onAufgabeGeoeffnet={() => updateNav({ selectedAufgabe: null })}
    />;
  } else if (showBlacklist && isAdmin) {
    bereich = 'system';
    inhalt = <BlacklistVerwaltung onBack={() => setShowBlacklist(false)} />;
  } else if (showStammdaten) {
    bereich = 'verwaltung';
    inhalt = <EditableMietUebersicht onBack={() => setShowStammdaten(false)} />;
  } else if (selectedImmobilie) {
    inhalt = <ImmobilienDetail
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
  } else if (navState.show3D) {
    // 3D-Ansicht: steht hinter der Objektseite, damit "Zurueck" dort wieder in 3D landet.
    const schliessen3D = () => updateNav({ show3D: false, fokus3D: null });
    inhalt = (
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
  } else {
    // Startseite im Exposé-Raster (27.10.2026): Kopf mit Leitzahlen, Handlungsbedarf als
    // Zeilen auf einer Linie, Suche, dann die Objekte mit Fassadenzeichnung
    inhalt = (
      <div className="mx-auto max-w-[1400px] px-4 pb-20 sm:px-6 lg:px-10">
        {isAdmin && (
          <DashboardStats
            immobilien={immobilien}
            onNavigateToContract={handleNavigateToContract}
            onRueckstaendeZeigen={() => {
              setRueckstaendeOpen(true);
              window.setTimeout(() => {
                document.getElementById('rueckstaende-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 60);
            }}
          />
        )}

        {isAdmin && (
          <section aria-labelledby="handlungsbedarf-titel" className="mb-14">
            <h2 id="handlungsbedarf-titel" className="eyebrow mb-3">Handlungsbedarf</h2>
            <div className="border-t border-foreground">
              <FehlendeMietzahlungen
                open={rueckstaendeOpen}
                onOpenChange={setRueckstaendeOpen}
                onMietvertragClick={(id) => { setListSource('rueckstaende'); setRueckstaendeOpen(true); handleMietvertragClick(id); }}
              />
              <RentIncreaseList
                open={rentIncreaseOpen}
                onOpenChange={setRentIncreaseOpen}
                onContractClick={(id) => { setListSource('rentincrease'); setRentIncreaseOpen(true); handleRentIncreaseContractClick(id); }}
              />
            </div>
          </section>
        )}

        <div id="search-panel" className={isAdmin ? undefined : "pt-8 sm:pt-12"}>
          <SearchPanel
            onImmobilieSelect={handleSearchImmobilieClick}
            onMietvertragClick={handleSearchMietvertragClick}
            onDarlehenSelect={() => oeffne('darlehen')}
          />
        </div>

        <section aria-labelledby="objekte-titel">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <p className="eyebrow">Bestand</p>
              <h2 id="objekte-titel" className="mt-2 text-3xl font-light leading-none tracking-[-0.02em] text-foreground sm:text-4xl">
                Ihre Immobilien
                {sortedImmobilien.length > 0 && <span className="ml-3 align-middle text-base font-normal tabular-nums text-muted-foreground">{sortedImmobilien.length}</span>}
              </h2>
            </div>
            <div className="flex items-center gap-6 text-sm" role="group" aria-label="Darstellung der Immobilien">
              <button
                type="button"
                aria-pressed="true"
                className="relative inline-flex items-center gap-1.5 pb-1.5 font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                Kacheln
              </button>
              <button
                type="button"
                aria-pressed="false"
                className="inline-flex items-center gap-1.5 pb-1.5 text-muted-foreground transition-colors hover:text-foreground"
                onMouseEnter={() => void ladeAnsicht3D()}
                onFocus={() => void ladeAnsicht3D()}
                onClick={() => updateNav({ show3D: true })}
              >
                <Box className="h-4 w-4" aria-hidden="true" />
                3D-Ansicht
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 xl:grid-cols-3">
            {sortedImmobilien?.map((immobilie) => (
              <div
                key={immobilie.id}
                role="button"
                tabIndex={0}
                aria-label={`${immobilie.name} öffnen`}
                className="group cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-4"
                onClick={() => handleImmobilieClick(immobilie.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleImmobilieClick(immobilie.id);
                  }
                }}
              >
                <ImmobilienCard immobilie={immobilie} onClick={() => handleImmobilieClick(immobilie.id)} />
              </div>
            ))}
          </div>

          {sortedImmobilien?.length === 0 && (
            <div className="border border-border px-6 py-16 text-center">
              <Building2 className="mx-auto h-6 w-6 text-brand" aria-hidden="true" />
              <h3 className="mt-4 text-2xl font-light text-foreground">Keine Immobilien gefunden</h3>
              <p className="mt-2 text-sm text-muted-foreground">Beginnen Sie mit der Verwaltung Ihres Portfolios</p>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Hauptnavigation
        aktiv={bereich}
        onOeffnen={oeffne}
        onSuche={zurSuche}
        isAdmin={isAdmin}
        isDev={isDev}
        isHausmeister={isHausmeister}
      />
      <main className="app-inhalt">{inhalt}</main>

      <VermieterStammdatenDialog
        isOpen={showVermieter}
        onClose={() => setShowVermieter(false)}
      />

      <NeuerMietvertragDialog
        isOpen={showNeuerMietvertrag}
        onClose={() => setShowNeuerMietvertrag(false)}
      />
    </div>
  );
};
export default Index;