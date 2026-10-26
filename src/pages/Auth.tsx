
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthForm } from '@/components/auth/AuthForm';

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate('/');
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate('/');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
  };

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Formularseite */}
      <div className="modern-dashboard-bg flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-3">
          <img
            src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png"
            alt="NiImmo Gruppe"
            className="h-12 w-auto mix-blend-multiply"
          />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <p className="eyebrow">Zentrale Verwaltung</p>
            <h1 className="mt-2 font-display text-4xl leading-none text-foreground sm:text-5xl">
              Willkommen
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Ihre zentrale Immobilienverwaltung
            </p>
            <div className="mt-8">
              <AuthForm mode={mode} onToggleMode={toggleMode} />
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} NiImmo Gruppe</p>
      </div>

      {/* Markenfläche (ab Desktop) */}
      <div className="relative hidden overflow-hidden bg-neutral-900 lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* Feine Grundrisslinien, kaum sichtbar */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.06]" aria-hidden="true">
          <defs>
            <pattern id="grundriss" width="120" height="120" patternUnits="userSpaceOnUse">
              <path d="M0 0H120V120" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M40 0V52H86V120M0 78H40" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M86 52H120" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grundriss)" />
        </svg>
        <div className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 h-[28rem] w-[28rem] rounded-full bg-ochre-500/10 blur-3xl" aria-hidden="true" />

        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-xl">
          <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="" className="h-full w-auto" />
        </div>

        <div className="relative max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-crimson-300">Immobilienverwaltung</p>
          <p className="mt-5 font-display text-6xl leading-[1.02] text-neutral-50">
            Objekte, Verträge und Zahlungen <span className="italic text-neutral-400">an einem Ort.</span>
          </p>
          <div className="mt-10 h-px w-24 bg-gradient-to-r from-crimson-400 to-transparent" aria-hidden="true" />
        </div>

        <p className="relative text-xs text-neutral-400">Vertraulich · nur für Mitarbeitende der NiImmo Gruppe</p>
      </div>
    </div>
  );
};

export default Auth;
