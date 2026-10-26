import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageCircle, Sparkles } from "lucide-react";
import { ModernChatbot } from "./ModernChatbot";
import { CsvUploadProgressBar } from "./CsvUploadProgressBar";
import { MelderLeiste } from "@/components/aufgaben/MelderLeiste";

export function ModernChatbotTrigger() {
  const location = useLocation();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Prevent body scroll when chat is open
  useEffect(() => {
    if (isChatOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isChatOpen]);

  // Nicht auf den Anmeldeseiten. Nach dem Einloesen des Zuruecksetz-Links
  // besteht bereits eine Sitzung — ohne diese Ausnahme staende der Chatbot
  // ueber dem Formular fuer das neue Passwort.
  if (location.pathname === "/auth" || location.pathname === "/passwort-neu") {
    return null;
  }

  return (
    <>
      {/* CSV Upload Progress Bar - above the chatbot */}
      <CsvUploadProgressBar />

      {/* Backdrop overlay when chat is open */}
      {isChatOpen && (
        <div 
          className="fixed inset-0 z-40 bg-neutral-950/30 backdrop-blur-[3px] animate-fade-in"
          onClick={() => setIsChatOpen(false)}
        />
      )}

      {/* Floating Action Button — darüber die Melder-Leiste (Aufgaben & Meldungen).
          Beide teilen sich denselben Stapel, damit sie beim Öffnen des Chats
          gemeinsam verschwinden und nicht über dem abgedunkelten Hintergrund stehen. */}
      {!isChatOpen && (
        <div className="schwebende-knoepfe fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3">
          <MelderLeiste />

          <div className="relative">
            {/* Anthrazit statt rotem Leuchtverlauf; ein kleiner Karminpunkt als Markenzeichen (26.10.2026) */}
            <Button
              onClick={() => setIsChatOpen(true)}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              size="lg"
              aria-label="Chilla öffnen"
              className="group relative h-14 w-14 overflow-hidden rounded-full bg-primary px-0 text-primary-foreground shadow-xl ring-1 ring-white/10 transition-[transform,background-color,box-shadow] duration-300 ease-sanft hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-2xl active:translate-y-0"
            >
              {/* Icon container */}
              <div className="relative flex items-center justify-center">
                <MessageCircle
                  className={`h-6 w-6 transition-all duration-300 ${
                    isHovered ? 'scale-90 opacity-80' : 'scale-100 opacity-100'
                  }`}
                />
                <Sparkles
                  className={`absolute h-3.5 w-3.5 transition-all duration-300 ${
                    isHovered ? 'scale-110 opacity-100' : 'scale-75 opacity-0'
                  }`}
                />
              </div>
            </Button>
            <span className="pointer-events-none absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-brand ring-2 ring-card" aria-hidden="true" />

            {/* Tooltip */}
            <div 
              className={`absolute bottom-full right-0 mb-3 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-50 shadow-lg transition-all duration-200 ${
                isHovered ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-1 pointer-events-none'
              }`}
            >
              <div className="whitespace-nowrap">
                Chilla öffnen
              </div>
              {/* Tooltip arrow */}
              <div className="absolute top-full right-4 h-0 w-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
            </div>
          </div>
        </div>
      )}
      
      {/* Chat Component */}
      <ModernChatbot 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
      />
    </>
  );
}
