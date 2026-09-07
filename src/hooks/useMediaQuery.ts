import { useEffect, useState } from "react";

/**
 * Reagiert auf eine CSS-Media-Query, z. B. `(min-width: 1024px)`.
 * `useIsMobile` kennt nur die 768-px-Grenze; die Zahlungsübersicht braucht
 * die lg-Grenze, ab der die Detailspalte neben der Tabelle Platz hat.
 */
export function useMediaQuery(query: string): boolean {
  const [trifft, setTrifft] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const aktualisieren = () => setTrifft(mql.matches);
    aktualisieren();
    mql.addEventListener("change", aktualisieren);
    return () => mql.removeEventListener("change", aktualisieren);
  }, [query]);

  return trifft;
}
