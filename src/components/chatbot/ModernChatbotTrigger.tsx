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
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 animate-fade-in"
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
            {/* Subtle ring effect */}
            <div className="absolute -inset-2 bg-gradient-to-r from-red-600 to-red-900 rounded-full opacity-20"></div>
            
            {/* Main button */}
            <Button
              onClick={() => setIsChatOpen(true)}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              size="lg"
              className="relative h-16 w-16 rounded-full bg-gradient-to-r from-red-600 to-red-900 hover:from-red-700 hover:to-red-800 shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 group overflow-hidden"
            >
              {/* Background glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-red-400 to-red-600 opacity-0 group-hover:opacity-20 transition-opacity duration-300 rounded-full" />
              
              {/* Icon container */}
              <div className="relative flex items-center justify-center">
                <MessageCircle 
                  className={`h-7 w-7 transition-all duration-300 ${
                    isHovered ? 'scale-90 opacity-80' : 'scale-100 opacity-100'
                  }`} 
                />
                <Sparkles 
                  className={`absolute h-4 w-4 transition-all duration-300 ${
                    isHovered ? 'scale-110 opacity-100' : 'scale-75 opacity-0'
                  }`}
                />
              </div>

              {/* Ripple effect on click */}
              <div className="absolute inset-0 rounded-full bg-white/20 scale-0 group-active:scale-100 transition-transform duration-200" />
            </Button>

            {/* Tooltip */}
            <div 
              className={`absolute bottom-full right-0 mb-3 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg transition-all duration-200 ${
                isHovered ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-1 pointer-events-none'
              }`}
            >
              <div className="whitespace-nowrap">
                Chilla öffnen
              </div>
              {/* Tooltip arrow */}
              <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
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
