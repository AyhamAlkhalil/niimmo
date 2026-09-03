import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, Lock } from "lucide-react";

/**
 * Neues Passwort vergeben.
 *
 * Der Token steht hinter der Raute in der Adresse und wird hier selbst
 * eingelöst (verifyOtp). Der Weiterleitungs-Mechanismus von Supabase bleibt
 * damit außen vor — dessen Freigabeliste enthält Adressen mehrerer fremder
 * Projekte und wäre eine ständige Fehlerquelle.
 */

const MINDESTLAENGE = 8;

type Zustand = "pruefe" | "bereit" | "ungueltig" | "fertig";

const PasswortNeu = () => {
  const navigate = useNavigate();
  const [zustand, setZustand] = useState<Zustand>("pruefe");
  const [passwort, setPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    const einloesen = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = hash.get("token");

      if (!token) {
        setZustand("ungueltig");
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: "recovery",
      });

      if (error) {
        setZustand("ungueltig");
        return;
      }

      // Der Token ist verbraucht — aus der Adresszeile nehmen, damit er nicht
      // im Verlauf des Browsers stehen bleibt.
      window.history.replaceState(null, "", window.location.pathname);
      setZustand("bereit");
    };

    void einloesen();
  }, []);

  const speichern = async () => {
    setFehler(null);

    if (passwort.length < MINDESTLAENGE) {
      setFehler(`Das Passwort muss mindestens ${MINDESTLAENGE} Zeichen lang sein.`);
      return;
    }
    if (passwort !== wiederholung) {
      setFehler("Die beiden Eingaben stimmen nicht überein.");
      return;
    }

    setLaeuft(true);
    const { error } = await supabase.auth.updateUser({ password: passwort });
    setLaeuft(false);

    if (error) {
      setFehler(`Das Passwort konnte nicht gespeichert werden: ${error.message}`);
      return;
    }

    setZustand("fertig");
    window.setTimeout(() => navigate("/"), 1800);
  };

  return (
    <div className="modern-dashboard-bg flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img
            src="/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png"
            alt="NiImmo Logo"
            className="mx-auto mb-4 h-16 w-auto"
          />
          <h1 className="text-gradient-red mb-2 text-3xl font-bold">NiImmo Dashboard</h1>
        </div>

        <Card className="mx-auto w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mb-4 flex justify-center">
              {zustand === "fertig" ? (
                <CheckCircle2 className="h-12 w-12 text-green-600" />
              ) : (
                <Lock className="h-12 w-12 text-red-500" />
              )}
            </div>
            <CardTitle className="text-2xl font-bold">Neues Passwort</CardTitle>
            <CardDescription>
              {zustand === "pruefe" && "Der Link wird geprüft..."}
              {zustand === "bereit" && "Vergeben Sie ein neues Passwort für Ihren Zugang."}
              {zustand === "ungueltig" && "Dieser Link ist abgelaufen oder wurde bereits benutzt."}
              {zustand === "fertig" && "Das Passwort ist gespeichert."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {zustand === "pruefe" && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {zustand === "ungueltig" && (
              <>
                <Alert variant="destructive">
                  <AlertDescription>
                    Fordern Sie auf der Anmeldeseite einen neuen Link an. Jeder Link gilt eine
                    Stunde und lässt sich nur einmal verwenden.
                  </AlertDescription>
                </Alert>
                <Button className="w-full" onClick={() => navigate("/auth")}>
                  Zur Anmeldung
                </Button>
              </>
            )}

            {zustand === "fertig" && (
              <Alert className="border-green-500 text-green-700">
                <AlertDescription>Sie werden gleich weitergeleitet.</AlertDescription>
              </Alert>
            )}

            {zustand === "bereit" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="passwort">Neues Passwort</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="passwort"
                      type="password"
                      autoFocus
                      value={passwort}
                      onChange={(e) => setPasswort(e.target.value)}
                      placeholder={`Mindestens ${MINDESTLAENGE} Zeichen`}
                      className="pl-10"
                      disabled={laeuft}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wiederholung">Passwort wiederholen</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      id="wiederholung"
                      type="password"
                      value={wiederholung}
                      onChange={(e) => setWiederholung(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void speichern();
                      }}
                      placeholder="Zur Sicherheit noch einmal"
                      className="pl-10"
                      disabled={laeuft}
                    />
                  </div>
                </div>

                {fehler && (
                  <Alert variant="destructive">
                    <AlertDescription>{fehler}</AlertDescription>
                  </Alert>
                )}

                <Button className="w-full" onClick={() => void speichern()} disabled={laeuft}>
                  {laeuft && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Passwort speichern
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PasswortNeu;
