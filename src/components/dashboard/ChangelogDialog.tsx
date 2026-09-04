import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Wrench, Bug, Rocket, ChevronDown, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  RELEASES,
  APP_VERSION,
  BUILD_DATE,
  COMMIT_SHA,
  type AenderungsArt,
} from "@/config/changelog";

/** Merkt sich je Browser, welche Version zuletzt gelesen wurde. */
const GESEHEN_KEY = "niimmo.changelog.gesehen";

/** Neuerungen zuerst — was die Verwaltung jetzt kann, ist die wichtigere Information. */
const ART_REIHENFOLGE: Record<AenderungsArt, number> = { neu: 0, verbessert: 1, behoben: 2 };

const ART_STIL: Record<AenderungsArt, { label: string; icon: typeof Sparkles; klasse: string }> = {
  neu: { label: "Neu", icon: Sparkles, klasse: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  verbessert: { label: "Verbessert", icon: Wrench, klasse: "bg-blue-100 text-blue-800 border-blue-200" },
  behoben: { label: "Behoben", icon: Bug, klasse: "bg-amber-100 text-amber-800 border-amber-200" },
};

/** Liest die zuletzt gelesene Version. Privater Modus o. Ä. darf nicht stören. */
function leseGesehen(): string | null {
  try {
    return localStorage.getItem(GESEHEN_KEY);
  } catch {
    return null;
  }
}

function merkeGesehen(version: string) {
  try {
    localStorage.setItem(GESEHEN_KEY, version);
  } catch {
    /* Speichern gesperrt — der Dialog funktioniert trotzdem. */
  }
}

const fmtDatum = (iso: string) => {
  try {
    return format(parseISO(iso), "d. MMMM yyyy", { locale: de });
  } catch {
    return iso;
  }
};

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  // Nur das jüngste Release ist offen; ältere klappt man bei Bedarf auf.
  const [offen, setOffen] = useState<Set<string>>(() => new Set([RELEASES[0]?.version]));

  // Details stehen zusammengeklappt. Sonst füllt ein einziges Release den
  // ganzen Dialog und man muss scrollen, um zu sehen, was es überhaupt gibt.
  const [offeneDetails, setOffeneDetails] = useState<Set<string>>(() => new Set());

  const toggleDetail = (schluessel: string) =>
    setOffeneDetails((prev) => {
      const next = new Set(prev);
      if (next.has(schluessel)) next.delete(schluessel);
      else next.add(schluessel);
      return next;
    });

  useEffect(() => {
    if (open) merkeGesehen(APP_VERSION);
  }, [open]);

  const toggle = (version: string) =>
    setOffen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-red-600" />
            Was ist neu
          </DialogTitle>
          <DialogDescription>
            Neueste zuerst. Für Einzelheiten den jeweiligen Punkt anklicken.
          </DialogDescription>
        </DialogHeader>

        {/* Technischer Stand — belegt, welcher Stand tatsächlich läuft */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Version <b className="font-mono text-foreground">{APP_VERSION}</b>
          </span>
          {BUILD_DATE && (
            <span>
              Stand{" "}
              <b className="text-foreground">
                {format(new Date(BUILD_DATE), "dd.MM.yyyy, HH:mm", { locale: de })} Uhr
              </b>
            </span>
          )}
          <span className="font-mono">{COMMIT_SHA}</span>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {RELEASES.map((release, index) => {
              const istOffen = offen.has(release.version);
              const istAktuell = release.version === APP_VERSION;

              return (
                <div
                  key={release.version}
                  className={cn(
                    "rounded-xl border",
                    istAktuell ? "border-red-200 bg-red-50/40" : "border-border"
                  )}
                >
                  <button
                    onClick={() => toggle(release.version)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left"
                  >
                    {istOffen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono text-sm font-semibold">{release.version}</span>
                    {istAktuell && (
                      <Badge className="h-5 border-red-200 bg-red-100 px-1.5 text-[10px] text-red-800">
                        aktuell
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {fmtDatum(release.datum)}
                    </span>
                    {release.schwerpunkt && (
                      <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">
                        {release.schwerpunkt}
                      </span>
                    )}
                  </button>

                  {istOffen && (
                    <ul className="divide-y border-t">
                      {[...release.aenderungen]
                        .sort((a, b) => ART_REIHENFOLGE[a.art] - ART_REIHENFOLGE[b.art])
                        .map((a, i) => {
                          const stil = ART_STIL[a.art];
                          const Icon = stil.icon;
                          const schluessel = `${release.version}#${i}`;
                          const detailOffen = offeneDetails.has(schluessel);

                          return (
                            <li key={schluessel}>
                              <button
                                type="button"
                                onClick={() => a.detail && toggleDetail(schluessel)}
                                aria-expanded={a.detail ? detailOffen : undefined}
                                className={cn(
                                  "flex w-full items-start gap-2.5 px-4 py-2.5 text-left",
                                  a.detail && "transition-colors hover:bg-muted/50",
                                )}
                              >
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "mt-0.5 h-5 shrink-0 gap-1 px-1.5 text-[10px]",
                                    stil.klasse,
                                  )}
                                >
                                  <Icon className="h-2.5 w-2.5" />
                                  {stil.label}
                                </Badge>
                                <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
                                  {a.titel}
                                </span>
                                {a.detail && (
                                  <ChevronDown
                                    className={cn(
                                      "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                      detailOffen && "rotate-180",
                                    )}
                                  />
                                )}
                              </button>

                              {a.detail && detailOffen && (
                                <p className="px-4 pb-3 pl-[5.25rem] text-xs leading-relaxed text-muted-foreground">
                                  {a.detail}
                                </p>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Versionsanzeige für den Kopfbereich. Zeigt einen Punkt, solange die laufende
 * Version in diesem Browser noch nicht geöffnet wurde.
 */
export function VersionBadge({ className }: { className?: string }) {
  const [dialogOffen, setDialogOffen] = useState(false);
  const [gesehen, setGesehen] = useState<string | null>(() => leseGesehen());

  const istNeu = useMemo(() => gesehen !== APP_VERSION, [gesehen]);

  const oeffnen = () => {
    setDialogOffen(true);
    setGesehen(APP_VERSION);
  };

  return (
    <>
      <button
        onClick={oeffnen}
        title={`Version ${APP_VERSION} — Updates ansehen`}
        className={cn(
          "relative flex items-center gap-1 rounded-full border border-gray-200/70 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-gray-500 transition-colors hover:bg-white hover:text-gray-800",
          className
        )}
      >
        v{APP_VERSION}
        {istNeu && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        )}
      </button>
      <ChangelogDialog open={dialogOffen} onOpenChange={setDialogOffen} />
    </>
  );
}
