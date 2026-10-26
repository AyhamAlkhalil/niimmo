import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
  }, [location.pathname]);

  return (
    <div className="modern-dashboard-bg flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <img src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png" alt="NiImmo Gruppe" className="mx-auto mb-8 h-14 w-auto mix-blend-multiply" />
        <p className="eyebrow">Fehler 404</p>
        <h1 className="mt-3 font-display text-5xl leading-none text-foreground sm:text-6xl">Seite nicht gefunden</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">Die aufgerufene Adresse gibt es nicht oder nicht mehr.</p>
        <a href="/" className="mt-8 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-knopf transition-colors hover:bg-primary/90">
          Zum Dashboard
        </a>
      </div>
    </div>
  );
};

export default NotFound;
