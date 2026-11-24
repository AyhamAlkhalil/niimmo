import { useLocation } from "react-router-dom";
import { CsvUploadProgressBar } from "./CsvUploadProgressBar";
import { MelderLeiste } from "@/components/aufgaben/MelderLeiste";
import { SCHWEBENDE_KNOEPFE_ATTRIBUT } from "@/utils/schwebendeKnoepfe";

/**
 * Schwebende Elemente unten rechts: Fortschritt des CSV-Imports und die
 * Melder-Leiste. Bis zum 27.10.2026 hingen beide am Chatbot-Knopf; der
 * Chatbot ist auf Kundenwunsch entfallen.
 */
export function SchwebendeKnoepfe() {
  const location = useLocation();

  // Nicht auf den Anmeldeseiten. Nach dem Einloesen des Zuruecksetz-Links
  // besteht bereits eine Sitzung — ohne diese Ausnahme staende die Leiste
  // ueber dem Formular fuer das neue Passwort.
  // Ebenso nicht auf der Zustimmungsseite für Claude (/oauth/consent).
  if (location.pathname === "/auth" || location.pathname === "/passwort-neu" || location.pathname === "/oauth/consent") {
    return null;
  }

  return (
    <>
      <CsvUploadProgressBar />

      {/* Über den Fenstern (z-50) und mit eigenen Klicks: Ein offener Dialog sperrt
          sonst alles außerhalb, und der Kamera-Knopf war nicht erreichbar (24.11.2026).
          Wie er sich bei offenem Fenster verkleinert, steht in index.css. */}
      <div
        {...{ [SCHWEBENDE_KNOEPFE_ATTRIBUT]: "" }}
        className="schwebende-knoepfe pointer-events-auto fixed bottom-6 right-6 z-[60] flex flex-col items-center gap-3"
      >
        <MelderLeiste />
      </div>
    </>
  );
}
