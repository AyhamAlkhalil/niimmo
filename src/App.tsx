
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useRealtimeUpdates } from "@/hooks/useRealtimeUpdates";
import { useBenachrichtigungsStrom } from "@/hooks/useBenachrichtigungen";
import { ModernChatbotTrigger } from "@/components/chatbot/ModernChatbotTrigger";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Component that sets up real-time updates within the query client context
const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
  useRealtimeUpdates();
  // Genau einmal fuer die ganze Anwendung: Die Glocke wird an zwei Stellen
  // gezeigt, das Abonnement darf es nur einmal geben.
  useBenachrichtigungsStrom();
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              } />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <ModernChatbotTrigger />
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
