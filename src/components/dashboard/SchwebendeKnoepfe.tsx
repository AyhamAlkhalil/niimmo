import { useLocation } from "react-router-dom";
import { CsvUploadProgressBar } from "./CsvUploadProgressBar";
import { MelderLeiste } from "@/components/aufgaben/MelderLeiste";

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
  if (location.pathname === "/auth" || location.pathname === "/passwort-neu") {
    return null;
  }

  return (
    <>
      <CsvUploadProgressBar />

      <div className="schwebende-knoepfe fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3">
        <MelderLeiste />
      </div>
    </>
  );
}
