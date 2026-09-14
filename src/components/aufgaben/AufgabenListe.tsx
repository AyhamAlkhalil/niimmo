import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, ChevronDown, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  signiereScreenshot,
  useAufgabenListe,
  type Aufgabe,
  type AufgabenStatus,
} from "@/hooks/useAufgaben";

interface AufgabenListeProps {
  onBack: () => void;
}

/**
 * Gemeldete Probleme ansehen: was gemeldet wurde, mit Bild, und ob es erledigt ist.
 *
 * Seit dem 14.09.2026 nur lesend. Bearbeitet und abgehakt wird außerhalb der
 * Anwendung; steht eine Meldung auf erledigt, bekommt der Melder beim nächsten
 * Öffnen einen Hinweis.
 */
export const AufgabenListe = ({ onBack }: AufgabenListeProps) => {
  const { data: aufgaben = [], isLoading, isError } = useAufgabenListe();
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(null);

  const offene = aufgaben.filter((a) => a.status !== "fertig");
  const erledigte = aufgaben.filter((a) => a.status === "fertig");
  const umschalten = (id: string) => setAufgeklappt((vorher) => (vorher === id ? null : id));

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="glass-card flex items-center gap-3 rounded-xl p-4">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Zurück">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold sm:text-2xl">Aufgaben</h1>
          {!isLoading && !isError && <Badge variant="secondary">{offene.length} offen</Badge>}
        </div>

        {isLoading ? (
          <div className="glass-card flex items-center justify-center gap-2 rounded-xl p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Aufgaben werden geladen …
          </div>
        ) : isError ? (
          <div className="glass-card rounded-xl p-12 text-center text-sm font-medium text-destructive" role="alert">
            Die Aufgaben konnten nicht geladen werden. Bitte die Seite neu laden.
          </div>
        ) : aufgaben.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Noch nichts gemeldet. Probleme meldet man über den Kamera-Knopf unten rechts.
            </p>
          </div>
        ) : (
          <>
            <Abschnitt titel="Offen" leerText="Nichts offen.">
              {offene.map((a) => (
                <AufgabenZeile key={a.id} aufgabe={a} offen={aufgeklappt === a.id} onUmschalten={umschalten} />
              ))}
            </Abschnitt>
            {erledigte.length > 0 && (
              <Abschnitt titel="Erledigt">
                {erledigte.map((a) => (
                  <AufgabenZeile key={a.id} aufgabe={a} offen={aufgeklappt === a.id} onUmschalten={umschalten} />
                ))}
              </Abschnitt>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const Abschnitt = ({
  titel,
  leerText,
  children,
}: {
  titel: string;
  leerText?: string;
  children: React.ReactNode[];
}) => (
  <section className="space-y-2">
    <h2 className="px-1 text-sm font-semibold text-muted-foreground">{titel}</h2>
    {children.length === 0 && leerText ? (
      <p className="glass-card rounded-xl p-4 text-sm text-muted-foreground">{leerText}</p>
    ) : (
      children
    )}
  </section>
);

const STATUS_ANZEIGE: Record<AufgabenStatus, { label: string; klasse: string }> = {
  offen: { label: "Offen", klasse: "border-border bg-muted text-muted-foreground" },
  geplant: { label: "Offen", klasse: "border-border bg-muted text-muted-foreground" },
  in_entwicklung: { label: "In Arbeit", klasse: "border-warning/30 bg-warning/10 text-warning" },
  in_testing: { label: "In Arbeit", klasse: "border-warning/30 bg-warning/10 text-warning" },
  fertig: { label: "Erledigt", klasse: "border-success/30 bg-success/10 text-success" },
};

const AufgabenZeile = ({
  aufgabe,
  offen,
  onUmschalten,
}: {
  aufgabe: Aufgabe;
  offen: boolean;
  onUmschalten: (id: string) => void;
}) => {
  const status = STATUS_ANZEIGE[aufgabe.status] ?? STATUS_ANZEIGE.offen;
  const Pfeil = offen ? ChevronDown : ChevronRight;

  return (
    <div className={cn("glass-card rounded-xl", aufgabe.status === "fertig" && "opacity-70")}>
      <button
        type="button"
        onClick={() => onUmschalten(aufgabe.id)}
        aria-expanded={offen}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <Pfeil className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium leading-tight">{aufgabe.titel}</span>
            {aufgabe.screenshot_pfade.length > 0 && <Camera className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline" className={cn("text-[10px]", status.klasse)}>
              {status.label}
            </Badge>
            {aufgabe.melder?.anzeigename && <span>{aufgabe.melder.anzeigename}</span>}
            <span>{format(new Date(aufgabe.erstellt_am), "dd.MM.yy", { locale: de })}</span>
            {aufgabe.erledigt_am && (
              <span>erledigt am {format(new Date(aufgabe.erledigt_am), "dd.MM.yy", { locale: de })}</span>
            )}
          </span>
        </span>
      </button>

      {offen && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3 text-sm">
          {aufgabe.beschreibung && <p className="whitespace-pre-wrap">{aufgabe.beschreibung}</p>}
          {aufgabe.seiten_titel && (
            <p className="text-xs text-muted-foreground">Gemeldet in: {aufgabe.seiten_titel}</p>
          )}
          {aufgabe.screenshot_pfade.length > 0 && <Bilder pfade={aufgabe.screenshot_pfade} />}
          {!aufgabe.beschreibung && aufgabe.screenshot_pfade.length === 0 && (
            <p className="text-xs text-muted-foreground">Keine weiteren Angaben.</p>
          )}
        </div>
      )}
    </div>
  );
};

const Bilder = ({ pfade }: { pfade: string[] }) => {
  const { data: adressen = [], isLoading } = useQuery({
    queryKey: ["aufgabe-screenshots", pfade],
    queryFn: async () => {
      const ergebnisse = await Promise.all(pfade.map((pfad) => signiereScreenshot(pfad)));
      return ergebnisse.filter((adresse): adresse is string => !!adresse);
    },
    // Die signierte Adresse gilt eine Stunde.
    staleTime: 50 * 60 * 1000,
  });

  if (isLoading) return <p className="text-xs text-muted-foreground">Bild wird geladen …</p>;
  // Ein fehlendes Bild darf nicht wie "kein Bild angehängt" aussehen.
  if (adressen.length === 0) {
    return <p className="text-xs text-destructive">Das Bild konnte nicht geladen werden.</p>;
  }

  return (
    <div className="space-y-2">
      {adressen.map((adresse) => (
        <a key={adresse} href={adresse} target="_blank" rel="noreferrer" title="In voller Größe öffnen">
          <img
            src={adresse}
            alt="Gemeldeter Bildschirm"
            className="max-h-80 w-full rounded-md border bg-white object-contain"
          />
        </a>
      ))}
    </div>
  );
};
