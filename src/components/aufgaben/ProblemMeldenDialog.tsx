import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, ImageOff, Loader2, Paperclip, Send, Trash2 } from "lucide-react";
import { useAufgabeAnlegen } from "@/hooks/useAufgaben";
import {
  uebernimmBilddatei,
  type AufnahmeKontext,
  type Bildschirmaufnahme,
} from "@/utils/bildschirmaufnahme";

interface ProblemMeldenDialogProps {
  open: boolean;
  onOpenChange: (offen: boolean) => void;
  /** Bereits erstellte Aufnahme; der Dialog öffnet sich mit fertigem Bild. */
  aufnahme: Bildschirmaufnahme | null;
  kontext: AufnahmeKontext | null;
  /** Hinweis, falls die Aufnahme nicht zustande kam. */
  aufnahmeHinweis?: string | null;
  onAufnahmeErsetzen: (aufnahme: Bildschirmaufnahme | null) => void;
}

/**
 * Problem melden: Bild und kurze Beschreibung, sonst nichts.
 *
 * Art, Dringlichkeit, Zuständigkeit und Markierungen sind am 14.09.2026 entfallen.
 * Meldungen werden außerhalb der Anwendung abgearbeitet; dort braucht es nur Bild
 * und Text. Seite und Fenstergröße werden weiterhin still mitgeschickt.
 */
export const ProblemMeldenDialog = ({
  open,
  onOpenChange,
  aufnahme,
  kontext,
  aufnahmeHinweis,
  onAufnahmeErsetzen,
}: ProblemMeldenDialogProps) => {
  const anlegen = useAufgabeAnlegen();
  const dateiFeld = useRef<HTMLInputElement>(null);

  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitel("");
    setBeschreibung("");
  }, [open]);

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
    // daran vorbei und legte bei zweimaligem Druecken zwei Meldungen an.
    if (!bereinigterTitel || anlegen.isPending) return;

    anlegen.mutate(
      {
        titel: bereinigterTitel,
        beschreibung: beschreibung.trim() || undefined,
        aufnahme,
        kontext,
      },
      {
        onSuccess: () => {
          toast.success("Meldung gesendet");
          onAufnahmeErsetzen(null);
          onOpenChange(false);
        },
        onError: (fehler: unknown) => {
          const nachricht = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
          toast.error(`Die Meldung konnte nicht gesendet werden: ${nachricht}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
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
          <div className="rounded-lg border bg-muted/30 p-3">
            {aufnahme ? (
              <div className="space-y-2">
                <img
                  src={aufnahme.vorschauUrl}
                  alt="Aufgenommener Bildschirm"
                  className="max-h-64 w-full rounded-md border bg-white object-contain"
                />
                <div className="flex justify-end">
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
              Meldung senden
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
