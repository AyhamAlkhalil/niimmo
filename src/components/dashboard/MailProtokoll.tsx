import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Inbox, Loader2, Paperclip } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface MailProtokollProps {
  onBack: () => void;
}

type MailStatus = "entwurf" | "gesendet" | "fehler";

interface Mail {
  id: string;
  typ: string;
  status: MailStatus;
  betreff: string;
  text: string;
  empfaenger: string[];
  kopie: string[];
  anhang_pfad: string | null;
  anhang_name: string | null;
  fehler: string | null;
  erstellt_am: string;
  gesendet_am: string | null;
}

const TYP_BEZEICHNUNG: Record<string, string> = {
  mahnung: "Mahnung",
  nebenkostenabrechnung: "Betriebskostenabrechnung",
  uebergabe: "Übergabe",
  kuendigungsbestaetigung: "Kündigungsbestätigung",
};

const STATUS_ANZEIGE: Record<MailStatus, { label: string; klasse: string }> = {
  entwurf: { label: "Entwurf", klasse: "border-warning/30 bg-warning/10 text-warning" },
  gesendet: { label: "Gesendet", klasse: "border-success/30 bg-success/10 text-success" },
  fehler: { label: "Fehler", klasse: "border-destructive/30 bg-destructive/10 text-destructive" },
};

type Sicht = "alle" | "entwurf" | "gesendet" | "fehler";

/**
 * Was die Anwendung an Mails erzeugt hat, mit vollem Inhalt (21.09.2026).
 *
 * Betreff und Text entstanden bisher beim Versand in den Edge Functions und
 * waren danach nicht mehr einsehbar. Jetzt legt jede Mailfunktion ihren Inhalt
 * vor dem Versand ab; hier steht er zum Nachlesen und Kontrollieren.
 */
export const MailProtokoll = ({ onBack }: MailProtokollProps) => {
  const [sicht, setSicht] = useState<Sicht>("alle");
  const [offen, setOffen] = useState<string | null>(null);

  const { data: mails = [], isLoading, isError } = useQuery({
    queryKey: ["mails"],
    queryFn: async (): Promise<Mail[]> => {
      const { data, error } = await supabase
        .from("mails")
        .select("id, typ, status, betreff, text, empfaenger, kopie, anhang_pfad, anhang_name, fehler, erstellt_am, gesendet_am")
        .order("erstellt_am", { ascending: false })
        .range(0, 199);
      if (error) throw error;
      return (data ?? []) as unknown as Mail[];
    },
  });

  const zaehler = useMemo(
    () => ({
      alle: mails.length,
      entwurf: mails.filter((m) => m.status === "entwurf").length,
      gesendet: mails.filter((m) => m.status === "gesendet").length,
      fehler: mails.filter((m) => m.status === "fehler").length,
    }),
    [mails],
  );

  const gefiltert = sicht === "alle" ? mails : mails.filter((m) => m.status === sicht);

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="glass-card flex flex-wrap items-center gap-3 rounded-xl p-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Zurück">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold sm:text-2xl">Mails</h1>
          <div className="ml-auto flex flex-wrap gap-2">
            {(["alle", "entwurf", "gesendet", "fehler"] as Sicht[]).map((wert) => (
              <Button
                key={wert}
                size="sm"
                variant={sicht === wert ? "default" : "outline"}
                onClick={() => setSicht(wert)}
              >
                {wert === "alle" ? "Alle" : STATUS_ANZEIGE[wert].label} ({zaehler[wert]})
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="glass-card flex items-center justify-center gap-2 rounded-xl p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Mails werden geladen …
          </div>
        ) : isError ? (
          <div className="glass-card rounded-xl p-12 text-center text-sm font-medium text-destructive" role="alert">
            Die Mails konnten nicht geladen werden. Bitte die Seite neu laden.
          </div>
        ) : gefiltert.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {mails.length === 0
                ? "Noch keine Mail erfasst. Ab jetzt wird jede Mahnung, Abrechnung, Übergabe und Kündigungsbestätigung hier mit vollem Inhalt abgelegt."
                : "Keine Mail in dieser Sicht."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {gefiltert.map((mail) => (
              <MailZeile
                key={mail.id}
                mail={mail}
                offen={offen === mail.id}
                onUmschalten={(id) => setOffen((vorher) => (vorher === id ? null : id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MailZeile = ({
  mail,
  offen,
  onUmschalten,
}: {
  mail: Mail;
  offen: boolean;
  onUmschalten: (id: string) => void;
}) => {
  const { toast } = useToast();
  const status = STATUS_ANZEIGE[mail.status] ?? STATUS_ANZEIGE.entwurf;
  const Pfeil = offen ? ChevronDown : ChevronRight;
  const zeitpunkt = mail.gesendet_am ?? mail.erstellt_am;

  const anhangOeffnen = async () => {
    if (!mail.anhang_pfad) return;
    const { data, error } = await supabase.storage.from("dokumente").createSignedUrl(mail.anhang_pfad, 3600);
    if (error || !data?.signedUrl) {
      toast({
        title: "Anhang nicht verfügbar",
        description: "Die Datei ließ sich nicht öffnen.",
        variant: "destructive",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="glass-card rounded-xl">
      <button
        type="button"
        onClick={() => onUmschalten(mail.id)}
        aria-expanded={offen}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <Pfeil className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium leading-tight">{mail.betreff}</span>
            {mail.anhang_pfad && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className={cn("text-[10px]", status.klasse)}>
              {status.label}
            </Badge>
            <span>{TYP_BEZEICHNUNG[mail.typ] ?? mail.typ}</span>
            <span className="truncate">{mail.empfaenger.join(", ")}</span>
            <span>{format(new Date(zeitpunkt), "dd.MM.yy HH:mm", { locale: de })}</span>
          </span>
        </span>
      </button>

      {offen && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>An</dt>
            <dd className="text-foreground">{mail.empfaenger.join(", ") || "—"}</dd>
            {mail.kopie.length > 0 && (
              <>
                <dt>Kopie</dt>
                <dd className="text-foreground">{mail.kopie.join(", ")}</dd>
              </>
            )}
            <dt>Vorbereitet</dt>
            <dd className="text-foreground">
              {format(new Date(mail.erstellt_am), "dd.MM.yyyy HH:mm", { locale: de })}
            </dd>
            {mail.gesendet_am && (
              <>
                <dt>Gesendet</dt>
                <dd className="text-foreground">
                  {format(new Date(mail.gesendet_am), "dd.MM.yyyy HH:mm", { locale: de })}
                </dd>
              </>
            )}
          </dl>

          {mail.fehler && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {mail.fehler}
            </p>
          )}

          <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm">
            {mail.text || "Kein Text gespeichert."}
          </pre>

          {mail.anhang_pfad && (
            <Button variant="outline" size="sm" onClick={() => void anhangOeffnen()}>
              <Paperclip className="mr-1.5 h-4 w-4" />
              {mail.anhang_name ?? "Anhang"} öffnen
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
