import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useAppBenutzer } from "@/hooks/useAppBenutzer";
import {
  AufnahmeFehler,
  ermittleKontext,
  gibAufnahmeFrei,
  nimmBildschirmAuf,
  type AufnahmeKontext,
  type Bildschirmaufnahme,
} from "@/utils/bildschirmaufnahme";
import { ProblemMeldenDialog } from "./ProblemMeldenDialog";

/**
 * Schwebender Melde-Knopf über dem Chatbot: Bildschirm aufnehmen, Problem melden.
 *
 * Seit dem 14.09.2026 nur noch dieser eine Knopf. Glocke und Aufgaben-Board sind
 * entfallen, weil Meldungen außerhalb der Anwendung abgearbeitet werden.
 *
 * Er wird innerhalb des Chatbot-Auslösers gerendert und verschwindet deshalb
 * zusammen mit dessen Knopf, sobald der Chat geöffnet ist. Der Hausmeister sieht
 * ihn nicht; die eigentliche Sperre liegt in der Datenbank.
 */
export const MelderLeiste = () => {
  const { isAdmin, isLoading: rolleLaedt } = useUserRole();
  const { darfMelden, isLoading: verzeichnisLaedt } = useAppBenutzer();

  const [dialogOffen, setDialogOffen] = useState(false);
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [aufnahme, setAufnahme] = useState<Bildschirmaufnahme | null>(null);
  const [kontext, setKontext] = useState<AufnahmeKontext | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  // Die laufende Aufnahme zusaetzlich in einer Referenz halten: Das Freigeben
  // ist ein Seiteneffekt und gehoert nicht in den Zustands-Aktualisierer, der
  // im StrictMode doppelt ausgefuehrt wird.
  const aktuelleAufnahme = useRef<Bildschirmaufnahme | null>(null);

  const aufnahmeErsetzen = useCallback((neu: Bildschirmaufnahme | null) => {
    const vorher = aktuelleAufnahme.current;
    if (vorher && vorher !== neu) gibAufnahmeFrei(vorher);
    aktuelleAufnahme.current = neu;
    setAufnahme(neu);
  }, []);

  // Beim Aushaengen (Abmelden, Wechsel auf die Anmeldeseite) nicht liegenlassen.
  useEffect(() => () => gibAufnahmeFrei(aktuelleAufnahme.current), []);

  const melden = async () => {
    // Kontext vor der Aufnahme festhalten: Danach hat der Bestätigungsdialog des
    // Browsers unter Umständen schon die Fenstermaße verändert.
    setKontext(ermittleKontext());
    setNimmtAuf(true);
    setHinweis(null);

    try {
      aufnahmeErsetzen(await nimmBildschirmAuf());
    } catch (fehler) {
      aufnahmeErsetzen(null);
      const grund = fehler instanceof AufnahmeFehler ? fehler.grund : "fehlgeschlagen";
      setHinweis(
        grund === "nicht_unterstuetzt"
          ? "Dieser Browser kann den Bildschirm nicht aufnehmen."
          : grund === "abgelehnt" || grund === "abgebrochen"
            ? "Die Aufnahme wurde abgebrochen."
            : "Die Aufnahme hat nicht geklappt.",
      );
    } finally {
      setNimmtAuf(false);
      // Der Dialog geht in jedem Fall auf — eine Meldung ohne Bild ist besser
      // als gar keine Meldung.
      setDialogOffen(true);
    }
  };

  if (rolleLaedt || verzeichnisLaedt || !isAdmin || !darfMelden) return null;

  return (
    <>
      <div className="melder-leiste flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={() => void melden()}
          disabled={nimmtAuf}
          title="Bildschirm aufnehmen und Problem melden"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition-all hover:scale-105 hover:bg-gray-800 active:scale-95 disabled:opacity-70"
        >
          {nimmtAuf ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </button>
      </div>

      <ProblemMeldenDialog
        open={dialogOffen}
        onOpenChange={(offen) => {
          setDialogOffen(offen);
          if (!offen) {
            aufnahmeErsetzen(null);
            setHinweis(null);
          }
        }}
        aufnahme={aufnahme}
        kontext={kontext}
        aufnahmeHinweis={hinweis}
        onAufnahmeErsetzen={aufnahmeErsetzen}
      />
    </>
  );
};
