import { useState, useEffect, useCallback, useId } from "react";

const STORAGE_KEY = "niimmo-nav-state";
const NAV_CHANGE_EVENT = "niimmo-nav-change";

interface NavigationState {
  selectedImmobilie: string | null;
  selectedEinheit: string | null;
  selectedMietvertrag: string | null;
  showAnalytics: boolean;
  showControlboard: boolean;
  showUebergabe: boolean;
  showDarlehen: boolean;
  showAufgabenBoard: boolean;
  /** Aus einer Benachrichtigung heraus direkt zu oeffnende Aufgabe. */
  selectedAufgabe: string | null;
  navigationSource: "dashboard" | "immobilie" | "search";
  selectedTab: string | null;
}

const defaultState: NavigationState = {
  selectedImmobilie: null,
  selectedEinheit: null,
  selectedMietvertrag: null,
  showAnalytics: false,
  showControlboard: false,
  showUebergabe: false,
  showDarlehen: false,
  showAufgabenBoard: false,
  selectedAufgabe: null,
  navigationSource: "dashboard",
  selectedTab: null,
};

function loadState(): NavigationState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaultState, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return defaultState;
}

function saveState(state: NavigationState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function useNavigationState() {
  // Jede Hook-Instanz kennzeichnet ihre eigenen Meldungen und ignoriert sie
  // beim Empfang. Vorher verhinderte ein globales Flag die Rueckkopplung —
  // das konnte nicht funktionieren: `dispatchEvent` ruft die Empfaenger
  // SYNCHRON auf, also genau dann, wenn das Flag gesetzt ist. Damit kehrte
  // jeder Empfaenger sofort zurueck und der Abgleich zwischen Instanzen fand
  // nie statt. Aufgefallen ist es, als die schwebende Leiste (ausserhalb der
  // Routen gemountet) das Aufgaben-Board oeffnen sollte und nichts geschah.
  const instanzId = useId();
  const [state, setState] = useState<NavigationState>(loadState);

  // Persist on every change and notify other hook instances
  useEffect(() => {
    saveState(state);
    window.dispatchEvent(new CustomEvent(NAV_CHANGE_EVENT, { detail: instanzId }));
  }, [state, instanzId]);

  // Listen for changes from other hook instances
  useEffect(() => {
    const handleNavChange = (ereignis: Event) => {
      // Eigene Meldung: nichts zu tun.
      if ((ereignis as CustomEvent<string>).detail === instanzId) return;

      const loaded = loadState();
      setState((prev) => {
        // Nur bei echter Abweichung neu setzen. Das beendet zugleich die
        // Kette: Der Empfaenger meldet seinerseits, alle anderen sehen dann
        // denselben Stand und aendern nichts mehr.
        const prevJson = JSON.stringify(prev);
        const loadedJson = JSON.stringify(loaded);
        return prevJson === loadedJson ? prev : loaded;
      });
    };
    window.addEventListener(NAV_CHANGE_EVENT, handleNavChange);
    return () => window.removeEventListener(NAV_CHANGE_EVENT, handleNavChange);
  }, [instanzId]);

  const update = useCallback((partial: Partial<NavigationState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    setState(defaultState);
  }, []);

  return { navState: state, updateNav: update, resetNav: reset };
}
