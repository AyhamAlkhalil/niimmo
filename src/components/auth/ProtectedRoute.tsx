
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      // Die Adresse mitgeben: Ein Vertrag, der in einem neuen Tab geöffnet wird (?vertrag=…), soll nach der
      // Anmeldung wieder aufgehen (Review 29.10.2026). Auth.tsx nimmt daraus nur eine gültige Vertrags-ID.
      navigate('/auth', { state: { zurueck: location.search } });
    }
  }, [user, loading, navigate, location.search]);

  if (loading) {
    return (
      <div className="min-h-screen modern-dashboard-bg flex items-center justify-center">
        <div className="glass-card p-12 rounded-3xl">
          <Loader2 className="h-12 w-12 animate-spin text-red-500 mx-auto mb-6" />
          <p className="text-gray-700 font-sans font-medium text-lg text-center">
            Authentifizierung wird überprüft...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
};
