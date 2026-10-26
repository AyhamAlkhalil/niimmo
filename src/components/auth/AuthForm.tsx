
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, Lock, ArrowLeft } from 'lucide-react';

interface AuthFormProps {
  mode: 'login' | 'signup';
  onToggleMode: () => void;
}

export const AuthForm = ({ mode, onToggleMode }: AuthFormProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resetModus, setResetModus] = useState(false);

  // Passwort zuruecksetzen laeuft ueber eine eigene Function: Fuer Auth-Mails
  // ist bei Supabase kein SMTP hinterlegt, der geteilte Absender waere auf
  // zwei Mails pro Stunde begrenzt.
  const sendeResetMail = async () => {
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError('Bitte geben Sie Ihre E-Mail-Adresse ein');
      return;
    }

    setLoading(true);
    const { error: fehler } = await supabase.functions.invoke('send-passwort-reset', {
      body: { email: email.trim() },
    });
    setLoading(false);

    if (fehler) {
      setError('Die E-Mail konnte gerade nicht verschickt werden. Bitte später erneut versuchen.');
      return;
    }
    // Bewusst unabhaengig davon, ob die Adresse bekannt ist — sonst liesse sich
    // hier herausfinden, wer einen Zugang hat.
    setSuccess('Falls für diese Adresse ein Zugang besteht, ist eine E-Mail mit dem Link unterwegs.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setError(null);
    setSuccess(null);
    setLoading(true);

    // Basic validation
    if (!email || !password) {
      setError('Bitte füllen Sie alle Felder aus');
      setLoading(false);
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein');
      setLoading(false);
      return;
    }

    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          // Handle different error cases
          if (error.message.includes('Invalid login credentials')) {
            setError('Ungültige Anmeldedaten. Bitte überprüfen Sie E-Mail und Passwort oder registrieren Sie sich zuerst.');
          } else if (error.message.includes('Email not confirmed')) {
            setError('Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.');
          } else if (error.message.includes('Too many requests')) {
            setError('Zu viele Anmeldeversuche. Bitte warten Sie einen Moment.');
          } else {
            setError(`Anmeldefehler: ${error.message}`);
          }
        } else if (data?.user) {
          setSuccess('Erfolgreich angemeldet!');
        }
      } else {
        const redirectUrl = `${window.location.origin}/`;
        
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectUrl
          }
        });

        if (error) {
          // Handle different signup errors
          if (error.message.includes('User already registered')) {
            setError('Ein Benutzer mit dieser E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an.');
          } else if (error.message.includes('Password should be at least')) {
            setError('Das Passwort ist zu schwach. Bitte verwenden Sie ein stärkeres Passwort.');
          } else if (error.message.includes('Invalid email')) {
            setError('Bitte geben Sie eine gültige E-Mail-Adresse ein.');
          } else {
            setError(`Registrierungsfehler: ${error.message}`);
          }
        } else if (data?.user) {
          if (data.user.email_confirmed_at) {
            setSuccess('Registrierung erfolgreich! Sie werden automatisch angemeldet.');
          } else {
            setSuccess('Registrierung erfolgreich! Bitte überprüfen Sie Ihre E-Mail zur Bestätigung.');
          }
        }
      }
    } catch (err) {
      setError('Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.');
    } finally {
      setLoading(false);
    }
  };

  // Removed handleButtonClick - form submission should be handled by onSubmit only

  return (
    <Card className="mx-auto w-full max-w-md rounded-2xl shadow-lg">
      <CardHeader className="pb-5">
        <CardTitle className="text-xl">
          {resetModus ? 'Passwort zurücksetzen' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </CardTitle>
        <CardDescription>
          {resetModus
            ? 'Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort vergeben'
            : mode === 'login'
              ? 'Melden Sie sich in Ihrem NiImmo Account an'
              : 'Erstellen Sie einen neuen NiImmo Account'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="ihre@email.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 pl-10"
                disabled={loading}
              />
            </div>
          </div>

          {!resetModus && (
          <div className="space-y-2">
            <Label htmlFor="password">Passwort</Label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Mindestens 6 Zeichen"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 pl-10"
                disabled={loading}
              />
            </div>
          </div>
          )}

          {mode === 'signup' && !resetModus && (
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Passwort wiederholen"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-11 pl-10"
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-success/30 bg-success/5 text-success">
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <Button 
            type="button"
            size="lg"
            className="relative z-10 w-full cursor-pointer" 
            disabled={loading}
            onClick={(e) => {
              if (resetModus) {
                void sendeResetMail();
                return;
              }
              handleSubmit(e);
            }}
            style={{ pointerEvents: 'auto' }}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {resetModus ? 'Wird gesendet...' : mode === 'login' ? 'Anmelden...' : 'Registrieren...'}
              </>
            ) : (
              resetModus ? 'Link anfordern' : mode === 'login' ? 'Anmelden' : 'Registrieren'
            )}
          </Button>

          <div className="space-y-2 text-center">
            {resetModus ? (
              <button
                type="button"
                onClick={() => { setResetModus(false); setError(null); setSuccess(null); }}
                className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-brand hover:decoration-current"
                disabled={loading}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Zurück zur Anmeldung
              </button>
            ) : (
              <>
                {mode === 'login' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => { setResetModus(true); setError(null); setSuccess(null); }}
                      className="text-sm font-medium text-foreground/80 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-brand hover:decoration-current"
                      disabled={loading}
                    >
                      Passwort vergessen?
                    </button>
                  </div>
                )}
                <div>
                  <button
                    type="button"
                    onClick={onToggleMode}
                    className="cursor-pointer text-sm text-muted-foreground underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-brand hover:decoration-current"
                    disabled={loading}
                  >
                    {mode === 'login' 
                      ? 'Noch kein Account? Jetzt registrieren' 
                      : 'Bereits ein Account? Jetzt anmelden'
                    }
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
