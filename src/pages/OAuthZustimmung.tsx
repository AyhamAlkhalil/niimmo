import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { entscheideAutorisierung, ladeAutorisierung } from '@/services/oauthZustimmungService';
import {
  type AutorisierungsDetails,
  gueltigeAutorisierungsId,
  ruecksprungErlaubt,
} from '@/utils/oauthZustimmung';

type Zustand =
  | { art: 'laedt' }
  | { art: 'fehler'; meldung: string }
  | { art: 'frage'; details: AutorisierungsDetails }
  | { art: 'weiter' }
  | { art: 'abgelehnt' };

/**
 * Zustimmungsseite des OAuth-Servers (16.11.2026): Hier gibt ein angemeldeter Mitarbeiter Claude Zugang zur
 * Verwaltung (MCP-Server, Edge Function mcp). Supabase Auth leitet mit ?authorization_id=… hierher.
 */
const OAuthZustimmung = () => {
  const [parameter] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const benutzerId = user?.id ?? null;
  const autorisierungsId = parameter.get('authorization_id');
  // Nie in einer fremden Seite: Ein unsichtbar eingebetteter „Zugang erlauben“-Knopf wäre Clickjacking. X-Frame-Options
  // steht bei Lovable nur als Meta-Tag in index.html und wirkt nicht (Browser beachten es nur als HTTP-Header).
  const eingebettet = typeof window !== 'undefined' && window.top !== window.self;
  const [zustand, setZustand] = useState<Zustand>({ art: 'laedt' });
  const [entscheidet, setEntscheidet] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (eingebettet) {
      setZustand({ art: 'fehler', meldung: 'Diese Seite darf nicht in einer anderen Seite angezeigt werden. Bitte direkt öffnen.' });
      return;
    }
    if (!gueltigeAutorisierungsId(autorisierungsId)) {
      setZustand({ art: 'fehler', meldung: 'Die Adresse ist unvollständig. Bitte die Verbindung in Claude neu starten.' });
      return;
    }
    if (!benutzerId) {
      // Nach der Anmeldung kommt Auth.tsx hierher zurück; replace, sonst führt „Zurück“ in eine Schleife
      navigate('/auth', { replace: true, state: { oauth: autorisierungsId } });
      return;
    }
    let abgebrochen = false;
    ladeAutorisierung(autorisierungsId)
      .then((antwort) => {
        if (abgebrochen) return;
        if (antwort.art === 'weiter') {
          // Schon früher zugestimmt: nur zu einem zugelassenen Ziel weiterleiten
          if (!ruecksprungErlaubt(antwort.redirect_url)) {
            setZustand({ art: 'fehler', meldung: 'Diese Anwendung ist für NiImmo nicht zugelassen.' });
            return;
          }
          setZustand({ art: 'weiter' });
          window.location.assign(antwort.redirect_url);
          return;
        }
        setZustand({ art: 'frage', details: antwort.details });
      })
      .catch((e: unknown) => {
        if (!abgebrochen) setZustand({ art: 'fehler', meldung: e instanceof Error ? e.message : 'Unbekannter Fehler.' });
      });
    return () => {
      abgebrochen = true;
    };
  }, [autorisierungsId, benutzerId, loading, navigate, eingebettet]);

  const entscheide = async (aktion: 'approve' | 'deny', erlaubt: boolean) => {
    if (!gueltigeAutorisierungsId(autorisierungsId) || eingebettet) return;
    setEntscheidet(true);
    try {
      const ziel = await entscheideAutorisierung(autorisierungsId, aktion);
      // Eine fremde Anwendung bekommt auch die Ablehnung nicht als Weiterleitung
      if (!erlaubt || !ruecksprungErlaubt(ziel)) {
        setZustand({ art: 'abgelehnt' });
        return;
      }
      setZustand({ art: 'weiter' });
      window.location.assign(ziel);
    } catch (e: unknown) {
      setZustand({ art: 'fehler', meldung: e instanceof Error ? e.message : 'Unbekannter Fehler.' });
    } finally {
      setEntscheidet(false);
    }
  };

  return (
    <div className="modern-dashboard-bg flex min-h-screen flex-col px-5 py-8 sm:px-10">
      <img
        src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png"
        alt="NiImmo Gruppe"
        className="h-12 w-auto self-start mix-blend-multiply"
      />
      <main className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md">
          <p className="eyebrow">Zugang für einen KI-Assistenten</p>
          {zustand.art === 'laedt' && (
            <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Anfrage wird geprüft …
            </div>
          )}
          {zustand.art === 'weiter' && (
            <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Weiter zu Claude …
            </div>
          )}
          {zustand.art === 'abgelehnt' && (
            <>
              <h1 className="mt-2 font-display text-4xl font-light leading-none text-foreground">Abgelehnt</h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Die Anwendung hat keinen Zugang erhalten. Sie können dieses Fenster schließen.
              </p>
            </>
          )}
          {zustand.art === 'fehler' && (
            <div className="mt-4 border-t border-foreground pt-4" role="alert">
              <h1 className="flex items-center gap-2 font-display text-3xl font-light leading-tight text-foreground">
                <ShieldAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
                Kein Zugang möglich
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{zustand.meldung}</p>
              <Button variant="outline" className="mt-6" onClick={() => navigate('/')}>Zum Dashboard</Button>
            </div>
          )}
          {zustand.art === 'frage' && (() => {
            const { details } = zustand;
            const erlaubt = ruecksprungErlaubt(details.redirect_uri);
            let ziel = details.redirect_uri;
            try {
              ziel = new URL(details.redirect_uri).hostname;
            } catch {
              /* Adresse unverändert anzeigen */
            }
            return (
              <>
                <h1 className="mt-2 font-display text-4xl font-light leading-none text-foreground">
                  {details.client.name} verbinden?
                </h1>
                <dl className="mt-6 divide-y divide-border border-y border-border text-sm">
                  <div className="flex justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">Konto</dt>
                    <dd className="text-right text-foreground">{details.user.email}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">Rückkehr zu</dt>
                    <dd className="text-right text-foreground">{ziel}</dd>
                  </div>
                </dl>
                {erlaubt ? (
                  <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
                    <p className="flex gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      <span>
                        Claude arbeitet dann mit Ihren Rechten in der Verwaltung: Objekte, Mieter, Verträge, Mietkonten und
                        Zahlungen lesen und — soweit Ihre Rolle es erlaubt — ändern, etwa Zahlungen zuordnen,
                        Zählerstände erfassen oder Aufgaben anlegen. Jede Änderung wird mit Ihrem Namen protokolliert.
                      </span>
                    </p>
                    <p>
                      Die abgefragten Daten, auch Namen und Kontaktdaten von Mietern, gehen dabei an Anthropic, den Anbieter
                      von Claude. Den Zugang können Sie in Claude unter Einstellungen → Konnektoren jederzeit trennen.
                    </p>
                    <p className="border-l-2 border-warning pl-3 text-foreground">
                      Nur erlauben, wenn Sie die Verbindung gerade selbst in Ihrem Claude-Konto gestartet haben. Kam der
                      Link von jemand anderem, bitte ablehnen — sonst arbeitet dessen Claude mit Ihren Rechten.
                    </p>
                  </div>
                ) : (
                  <p className="mt-5 flex gap-2 text-sm leading-relaxed text-destructive" role="alert">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    Diese Anwendung ist für NiImmo nicht zugelassen. Zugang erhalten nur Claude-Konnektoren
                    (claude.ai). Bitte ablehnen und den Absender des Links prüfen.
                  </p>
                )}
                <div className="mt-8 flex flex-wrap gap-3">
                  {erlaubt && (
                    <Button onClick={() => entscheide('approve', true)} disabled={entscheidet}>
                      {entscheidet && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      Zugang erlauben
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => entscheide('deny', erlaubt)} disabled={entscheidet}>
                    Ablehnen
                  </Button>
                </div>
              </>
            );
          })()}
        </div>
      </main>
      <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} NiImmo Gruppe</p>
    </div>
  );
};

export default OAuthZustimmung;
