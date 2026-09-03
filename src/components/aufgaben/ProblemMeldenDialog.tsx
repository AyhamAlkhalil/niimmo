import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Camera, ImageOff, Loader2, Paperclip, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppBenutzer } from "@/hooks/useAppBenutzer";
import { useAufgabeAnlegen, type AufgabenPrioritaet, type AufgabenTyp } from "@/hooks/useAufgaben";
import {
  uebernimmBilddatei,
  type AufnahmeKontext,
  type Bildschirmaufnahme,
} from "@/utils/bildschirmaufnahme";
import { BenutzerAuswahl } from "./BenutzerAuswahl";
import { PRIORITAET_DARSTELLUNG, TYP_DARSTELLUNG, TYP_REIHENFOLGE } from "./aufgabenDarstellung";

interface ProblemMeldenDialogProps {
  open: boolean;
  onOpenChange: (offen: boolean) => void;
  /** Bereits erstellte Aufnahme; der Dialog öffnet sich mit fertigem Bild. */
  aufnahme: Bildschirmaufnahme | null;
  kontext: AufnahmeKontext | null;
  /** Hinweis, falls die Aufnahme nicht zustande kam. */
  aufnahmeHinweis?: string | null;
  onAufnahmeErsetzen: (aufnahme: Bildschirmaufnahme | null) => void;
  onFertig?: (aufgabenId: string) => void;
}

const PRIORITAETEN: AufgabenPrioritaet[] = ["kritisch", "hoch", "mittel", "niedrig"];

export const ProblemMeldenDialog = ({
  open,
  onOpenChange,
  aufnahme,
  kontext,
  aufnahmeHinweis,
  onAufnahmeErsetzen,
  onFertig,
}: ProblemMeldenDialogProps) => {
  const { benutzer, ichSelbst, entwickler } = useAppBenutzer();
  const anlegen = useAufgabeAnlegen();
  const dateiFeld = useRef<HTMLInputElement>(null);

  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [typ, setTyp] = useState<AufgabenTyp>("bug");
  const [prioritaet, setPrioritaet] = useState<AufgabenPrioritaet>("hoch");
  const [verantwortlichId, setVerantwortlichId] = useState<string | null>(null);
  const [erwaehnte, setErwaehnte] = useState<string[]>([]);

  // Beim Öffnen zurücksetzen. Verantwortlich ist standardmäßig die Entwicklung,
  // damit die häufigste Meldung ohne einen weiteren Klick auskommt.
  useEffect(() => {
    if (!open) return;
    setTitel("");
    setBeschreibung("");
    setTyp("bug");
    setPrioritaet("hoch");
    setVerantwortlichId(entwickler?.id ?? null);
    setErwaehnte([]);
  }, [open, entwickler?.id]);

  // Bild aus der Zwischenablage einfügen (Screenshot-Taste des Betriebssystems).
  useEffect(() => {
    if (!open) return;

    const beiEinfuegen = async (ereignis: ClipboardEvent) => {
      const bild = Array.from(ereignis.clipboardData?.items ?? []).find((eintrag) =>
        eintrag.type.startsWith("image/"),
      );
      if (!bild) return;
      const datei = bild.getAsFile();
      if (!datei) return;

      ereignis.preventDefault();
      try {
        onAufnahmeErsetzen(await uebernimmBilddatei(datei, "zwischenablage"));
        toast.success("Bild aus der Zwischenablage übernommen");
      } catch {
        toast.error("Das Bild aus der Zwischenablage ließ sich nicht lesen");
      }
    };

    window.addEventListener("paste", beiEinfuegen);
    return () => window.removeEventListener("paste", beiEinfuegen);
  }, [open, onAufnahmeErsetzen]);

  const beiDateiwahl = async (datei: File | undefined) => {
    if (!datei) return;
    try {
      onAufnahmeErsetzen(await uebernimmBilddatei(datei, "datei"));
    } catch {
      toast.error("Diese Datei ist kein lesbares Bild");
    }
  };

  const absenden = () => {
    const bereinigterTitel = titel.trim();
    // Die Sperre steht hier und nicht nur am Knopf: Strg+Enter kaeme sonst
    // daran vorbei und legte bei zweimaligem Druecken zwei Aufgaben an.
    if (!bereinigterTitel || anlegen.isPending) return;

    anlegen.mutate(
      {
        titel: bereinigterTitel,
        typ,
        prioritaet,
        beschreibung: beschreibung.trim() || undefined,
        verantwortlichId,
        erwaehnteIds: erwaehnte,
        aufnahme,
        kontext,
      },
      {
        onSuccess: ({ aufgabenId, markierungenFehlgeschlagen }) => {
          if (markierungenFehlgeschlagen) {
            toast.warning(
              "Aufgabe angelegt, aber die zusätzlichen Personen konnten nicht markiert werden",
              { description: "Bitte im Aufgaben-Board nachtragen." },
            );
          } else {
            const empfaenger = [
              verantwortlichId,
              ...erwaehnte.filter((e) => e !== verantwortlichId),
            ].filter(Boolean);
            toast.success(
              empfaenger.length
                ? `Aufgabe angelegt — ${empfaenger.length} Person${empfaenger.length > 1 ? "en" : ""} benachrichtigt`
                : "Aufgabe angelegt",
            );
          }
          onAufnahmeErsetzen(null);
          onOpenChange(false);
          onFertig?.(aufgabenId);
        },
        onError: (fehler: unknown) => {
          const nachricht = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
          toast.error(`Die Aufgabe konnte nicht angelegt werden: ${nachricht}`);
        },
      },
    );
  };

  const markierbar = benutzer.filter((person) => person.id !== ichSelbst?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-red-600" />
            Problem melden
          </DialogTitle>
          <DialogDescription>
            {kontext?.titel ? `Aufgenommen in: ${kontext.titel}` : "Beschreiben Sie kurz, was nicht stimmt."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bild */}
          <div className="rounded-lg border bg-muted/30 p-3">
            {aufnahme ? (
              <div className="space-y-2">
                <img
                  src={aufnahme.vorschauUrl}
                  alt="Aufgenommener Bildschirm"
                  className="max-h-64 w-full rounded-md border bg-white object-contain"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {aufnahme.breite} × {aufnahme.hoehe} Pixel
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onAufnahmeErsetzen(null)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Bild entfernen
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <ImageOff className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {aufnahmeHinweis ?? "Kein Bild angehängt."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Bild einfügen mit Strg+V oder über „Bild wählen“.
                </p>
                <Button variant="outline" size="sm" onClick={() => dateiFeld.current?.click()}>
                  <Paperclip className="mr-1.5 h-4 w-4" /> Bild wählen
                </Button>
              </div>
            )}
            <input
              ref={dateiFeld}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void beiDateiwahl(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {/* Titel */}
          <div>
            <Label htmlFor="melder-titel">Was stimmt nicht? *</Label>
            <Input
              id="melder-titel"
              autoFocus
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder="z. B. Mietaufstellung zeigt falsche Summe"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) absenden();
              }}
            />
          </div>

          {/* Art und Dringlichkeit */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">Art</Label>
              <div className="flex gap-1.5">
                {TYP_REIHENFOLGE.map((wert) => {
                  const darstellung = TYP_DARSTELLUNG[wert];
                  const Symbol = darstellung.icon;
                  return (
                    <button
                      key={wert}
                      type="button"
                      onClick={() => setTyp(wert)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors",
                        typ === wert
                          ? "border-red-300 bg-red-50 font-medium text-red-900"
                          : "border-gray-200 bg-white/70 text-gray-600 hover:bg-white",
                      )}
                    >
                      <Symbol className="h-4 w-4" />
                      {darstellung.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Dringlichkeit</Label>
              <div className="flex gap-1.5">
                {PRIORITAETEN.map((wert) => (
                  <button
                    key={wert}
                    type="button"
                    onClick={() => setPrioritaet(wert)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-2 text-sm transition-colors",
                      prioritaet === wert
                        ? "border-red-300 bg-red-50 font-medium text-red-900"
                        : "border-gray-200 bg-white/70 text-gray-600 hover:bg-white",
                    )}
                  >
                    {PRIORITAET_DARSTELLUNG[wert].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Verantwortlich */}
          <div>
            <Label className="mb-1.5 block">Wer kümmert sich darum?</Label>
            <div className="flex flex-wrap gap-2">
              {benutzer.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() =>
                    setVerantwortlichId((vorher) => (vorher === person.id ? null : person.id))
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm transition-colors",
                    verantwortlichId === person.id
                      ? "border-red-300 bg-red-600 text-white"
                      : "border-gray-200 bg-white/70 text-gray-700 hover:bg-white",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                      verantwortlichId === person.id
                        ? "bg-white/25 text-white"
                        : "bg-gray-200 text-gray-700",
                    )}
                  >
                    {person.kuerzel}
                  </span>
                  {person.anzeigename}
                </button>
              ))}
            </div>
          </div>

          {/* Zusätzlich markieren */}
          {markierbar.length > 0 && (
            <div>
              <Label className="mb-1.5 block">
                Zusätzlich informieren
                <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
              </Label>
              <BenutzerAuswahl
                benutzer={markierbar}
                ausgewaehlt={erwaehnte}
                verantwortlichId={verantwortlichId}
                onUmschalten={(id) =>
                  setErwaehnte((vorher) =>
                    vorher.includes(id) ? vorher.filter((e) => e !== id) : [...vorher, id],
                  )
                }
              />
            </div>
          )}

          {/* Details */}
          <div>
            <Label htmlFor="melder-details">Weitere Angaben</Label>
            <Textarea
              id="melder-details"
              value={beschreibung}
              onChange={(e) => setBeschreibung(e.target.value)}
              placeholder="Was haben Sie getan, was war zu erwarten?"
              className="min-h-[80px]"
            />
          </div>

          {kontext && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px] font-normal">
                Fenster {kontext.fensterbreite} × {kontext.fensterhoehe}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal">
                Ansicht {kontext.pfad}
              </Badge>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={absenden}
              disabled={!titel.trim() || anlegen.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {anlegen.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-4 w-4" />
              )}
              Aufgabe anlegen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
