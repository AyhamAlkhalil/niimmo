import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Copy, Inbox, Loader2, Paperclip, Search } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const SICHTEN: { wert: "alle" | MailStatus; label: string }[] = [
  { wert: "alle", label: "Alle" },
  { wert: "entwurf", label: "Entwürfe" },
  { wert: "gesendet", label: "Gesendet" },
  { wert: "fehler", label: "Fehler" },
];

/**
 * Arbeitsplatz für Mails (21.09.2026): links die Tabelle über die volle Breite,
 * rechts der vollständige Inhalt der gewählten Mail.
 *
 * Betreff und Text entstanden bisher beim Versand in den Edge Functions und
 * waren danach nicht mehr einsehbar. Jede Mailfunktion legt ihren Inhalt jetzt
 * vor dem Versand ab; hier steht er zum Kontrollieren.
 */
export const MailProtokoll = ({ onBack }: MailProtokollProps) => {
  const [sicht, setSicht] = useState<"alle" | MailStatus>("alle");
  const [typ, setTyp] = useState<string>("alle");
  const [suche, setSuche] = useState("");
  const [ausgewaehltId, setAusgewaehltId] = useState<string | null>(null);

  const { data: mails = [], isLoading, isError } = useQuery({
    queryKey: ["mails"],
    queryFn: async (): Promise<Mail[]> => {
      const { data, error } = await supabase
        .from("mails")
        .select(
          "id, typ, status, betreff, text, empfaenger, kopie, anhang_pfad, anhang_name, fehler, erstellt_am, gesendet_am",
        )
        .order("erstellt_am", { ascending: false })
        .range(0, 499);
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

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    return mails.filter((mail) => {
      if (sicht !== "alle" && mail.status !== sicht) return false;
      if (typ !== "alle" && mail.typ !== typ) return false;
      if (!begriff) return true;
      const heuhaufen = [mail.betreff, mail.text, mail.empfaenger.join(" "), mail.kopie.join(" ")]
        .join(" ")
        .toLowerCase();
      return heuhaufen.includes(begriff);
    });
  }, [mails, sicht, typ, suche]);

  const ausgewaehlt = gefiltert.find((m) => m.id === ausgewaehltId) ?? gefiltert[0];
  const filterAktiv = sicht !== "alle" || typ !== "alle" || suche.trim().length > 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Zurück">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="mr-1 text-lg font-semibold">Mails</h1>
        <span className="mr-2 text-sm tabular-nums text-muted-foreground">{zaehler.alle}</span>

        <div className="relative min-w-[12rem] max-w-md flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Suchen: Betreff, Empfänger, Text"
            aria-label="Mails durchsuchen"
            className="h-9 bg-background pl-8"
          />
        </div>

        <Select value={typ} onValueChange={setTyp}>
          <SelectTrigger className="h-9 w-[16rem]" aria-label="Art der Mail">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle Arten</SelectItem>
            {Object.entries(TYP_BEZEICHNUNG).map(([wert, label]) => (
              <SelectItem key={wert} value={wert}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap gap-1.5">
          {SICHTEN.map(({ wert, label }) => (
            <Button
              key={wert}
              size="sm"
              variant={sicht === wert ? "default" : "outline"}
              className="h-9"
              onClick={() => setSicht(wert)}
            >
              {label}
              <span className="ml-1.5 tabular-nums opacity-70">{zaehler[wert]}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p className="text-sm">Mails werden geladen …</p>
            </div>
          ) : isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" role="alert">
              <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
              <p className="font-medium text-destructive">Mails konnten nicht geladen werden</p>
              <p className="text-sm text-muted-foreground">Bitte die Seite neu laden oder die Verbindung prüfen.</p>
            </div>
          ) : gefiltert.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Inbox className="h-9 w-9 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm font-medium">
                {filterAktiv ? "Keine Mail entspricht den Filtern" : "Noch keine Mail erfasst"}
              </p>
              {filterAktiv ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSicht("alle");
                    setTyp("alle");
                    setSuche("");
                  }}
                >
                  Filter zurücksetzen
                </Button>
              ) : (
                <p className="max-w-md text-sm text-muted-foreground">
                  Ab jetzt wird jede Mahnung, Betriebskostenabrechnung, Übergabe und Kündigungsbestätigung
                  mit vollem Inhalt abgelegt.
                </p>
              )}
            </div>
          ) : (
            <table className="w-full min-w-[44rem] table-fixed border-collapse text-[15px]">
              <thead className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-[8.5rem] px-4 py-2.5 font-medium">Zeitpunkt</th>
                  <th className="hidden w-[11rem] px-4 py-2.5 font-medium xl:table-cell">Art</th>
                  <th className="px-4 py-2.5 font-medium">Betreff</th>
                  <th className="hidden w-[14rem] px-4 py-2.5 font-medium 2xl:table-cell">Empfänger</th>
                  <th className="w-[7rem] px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map((mail) => {
                  const status = STATUS_ANZEIGE[mail.status] ?? STATUS_ANZEIGE.entwurf;
                  const gewaehlt = ausgewaehlt?.id === mail.id;
                  return (
                    <tr
                      key={mail.id}
                      onClick={() => setAusgewaehltId(mail.id)}
                      aria-selected={gewaehlt}
                      className={cn(
                        "cursor-pointer border-b align-top transition-colors hover:bg-muted/60",
                        gewaehlt && "bg-primary/10 hover:bg-primary/10",
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {format(new Date(mail.gesendet_am ?? mail.erstellt_am), "dd.MM.yy HH:mm", { locale: de })}
                      </td>
                      <td className="hidden truncate px-4 py-3 text-muted-foreground xl:table-cell">
                        {TYP_BEZEICHNUNG[mail.typ] ?? mail.typ}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{mail.betreff}</span>
                          {mail.anhang_pfad && (
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="mit Anhang" />
                          )}
                        </span>
                      </td>
                      <td className="hidden truncate px-4 py-3 text-muted-foreground 2xl:table-cell">
                        {mail.empfaenger.join(", ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
                            status.klasse,
                          )}
                        >
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <aside className="min-h-0 w-full shrink-0 border-t bg-card lg:w-[28rem] lg:border-l lg:border-t-0 xl:w-[34rem]">
          <MailDetail mail={ausgewaehlt} />
        </aside>
      </div>
    </div>
  );
};

const MailDetail = ({ mail }: { mail: Mail | undefined }) => {
  const { toast } = useToast();

  if (!mail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Keine Mail gewählt</p>
        <p className="text-xs text-muted-foreground">Eine Zeile anklicken, dann steht hier der ganze Inhalt.</p>
      </div>
    );
  }

  const status = STATUS_ANZEIGE[mail.status] ?? STATUS_ANZEIGE.entwurf;

  const anhangOeffnen = async () => {
    if (!mail.anhang_pfad) return;
    const { data, error } = await supabase.storage.from("dokumente").createSignedUrl(mail.anhang_pfad, 3600);
    if (error || !data?.signedUrl) {
      toast({ title: "Anhang nicht verfügbar", description: "Die Datei ließ sich nicht öffnen.", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const textKopieren = async () => {
    try {
      await navigator.clipboard.writeText(mail.text);
      toast({ title: "Text kopiert" });
    } catch {
      toast({ title: "Text konnte nicht kopiert werden", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-6 py-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
              status.klasse,
            )}
          >
            {status.label}
          </span>
          <span className="text-xs text-muted-foreground">{TYP_BEZEICHNUNG[mail.typ] ?? mail.typ}</span>
        </div>
        <h2 className="mt-2 text-2xl font-semibold leading-snug">{mail.betreff}</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-6 py-5">
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-muted-foreground">An</dt>
            <dd className="break-words">{mail.empfaenger.join(", ") || "—"}</dd>
            {mail.kopie.length > 0 && (
              <>
                <dt className="text-muted-foreground">Kopie</dt>
                <dd className="break-words">{mail.kopie.join(", ")}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Vorbereitet</dt>
            <dd className="tabular-nums">
              {format(new Date(mail.erstellt_am), "dd.MM.yyyy HH:mm", { locale: de })}
            </dd>
            {mail.gesendet_am && (
              <>
                <dt className="text-muted-foreground">Gesendet</dt>
                <dd className="tabular-nums">
                  {format(new Date(mail.gesendet_am), "dd.MM.yyyy HH:mm", { locale: de })}
                </dd>
              </>
            )}
          </dl>

          {mail.fehler && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {mail.fehler}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {mail.anhang_pfad && (
              <Button variant="outline" size="sm" onClick={() => void anhangOeffnen()}>
                <Paperclip className="mr-1.5 h-4 w-4" />
                {mail.anhang_name ?? "Anhang"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void textKopieren()}>
              <Copy className="mr-1.5 h-4 w-4" />
              Text kopieren
            </Button>
          </div>

          <div className="rounded-lg border bg-background p-5">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {mail.text || "Kein Text gespeichert."}
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
