import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useAppBenutzer } from "@/hooks/useAppBenutzer";
import {
  signiereScreenshot,
  useAufgabeAendern,
  useAufgabeAnlegen,
  useAufgabeLoeschen,
  useErwaehnungSetzen,
  type Aufgabe,
  type AufgabenPrioritaet,
  type AufgabenStatus,
  type AufgabenTyp,
} from "@/hooks/useAufgaben";
import { AufgabeKommentare } from "./AufgabeKommentare";
import { BenutzerAuswahl } from "./BenutzerAuswahl";
import {
  PRIORITAET_DARSTELLUNG,
  PRIORITAET_REIHENFOLGE,
  STATUS_DARSTELLUNG,
  STATUS_REIHENFOLGE,
  TYP_DARSTELLUNG,
  TYP_REIHENFOLGE,
} from "./aufgabenDarstellung";

interface AufgabeDetailProps {
  /** null = neue Aufgabe anlegen. */
  aufgabe: Aufgabe | null;
  open: boolean;
  onOpenChange: (offen: boolean) => void;
}

export const AufgabeDetail = ({ aufgabe, open, onOpenChange }: AufgabeDetailProps) => {
  const istNeu = !aufgabe;
  const { benutzer, entwickler } = useAppBenutzer();
  const anlegen = useAufgabeAnlegen();
  const aendern = useAufgabeAendern();
  const loeschen = useAufgabeLoeschen();
  const erwaehnungSetzen = useErwaehnungSetzen();

  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [typ, setTyp] = useState<AufgabenTyp>("aufgabe");
  const [status, setStatus] = useState<AufgabenStatus>("offen");
  const [prioritaet, setPrioritaet] = useState<AufgabenPrioritaet>("mittel");
  const [verantwortlichId, setVerantwortlichId] = useState<string | null>(null);

  // Bewusst nur an der Kennung, nicht am ganzen Objekt: Jeder Neuabruf der
  // Liste liefert ein neues Objekt. Haenge der Effekt daran, wuerde er beim
  // Markieren einer Person oder bei einer Aenderung durch jemand anderen
  // mitten im Tippen die Eingaben mit den Serverwerten ueberschreiben.
  useEffect(() => {
    if (!open) return;
    setTitel(aufgabe?.titel ?? "");
    setBeschreibung(aufgabe?.beschreibung ?? "");
    // Unbekannte Altwerte auf gueltige Auswahlwerte ziehen, sonst bleibt das
    // Auswahlfeld leer und ein Speichern schriebe den Fehlwert fest.
    setTyp(TYP_REIHENFOLGE.includes(aufgabe?.typ as AufgabenTyp) ? (aufgabe!.typ as AufgabenTyp) : "aufgabe");
    setStatus(STATUS_REIHENFOLGE.includes(aufgabe?.status as AufgabenStatus) ? (aufgabe!.status as AufgabenStatus) : "offen");
    setPrioritaet(PRIORITAET_REIHENFOLGE.includes(aufgabe?.prioritaet as AufgabenPrioritaet) ? (aufgabe!.prioritaet as AufgabenPrioritaet) : "mittel");
    setVerantwortlichId(aufgabe?.verantwortlich_id ?? entwickler?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, aufgabe?.id, entwickler?.id]);

  const speichern = () => {
    const bereinigt = titel.trim();
    if (!bereinigt) return;

    if (istNeu) {
      anlegen.mutate(
        {
          titel: bereinigt,
          typ,
          prioritaet,
          beschreibung: beschreibung.trim() || undefined,
          verantwortlichId,
          erwaehnteIds: [],
        },
        {
          onSuccess: () => {
            toast.success("Aufgabe angelegt");
            onOpenChange(false);
          },
          onError: () => toast.error("Die Aufgabe konnte nicht angelegt werden"),
        },
      );
      return;
    }

    aendern.mutate(
      {
        id: aufgabe.id,
        aenderung: {
          titel: bereinigt,
          typ,
          status,
          prioritaet,
          beschreibung: beschreibung.trim() || null,
          verantwortlich_id: verantwortlichId,
        },
      },
      {
        onSuccess: () => {
          toast.success("Aufgabe gespeichert");
          onOpenChange(false);
        },
        onError: () => toast.error("Die Änderung konnte nicht gespeichert werden"),
      },
    );
  };

  const erwaehnteIds = aufgabe?.erwaehnungen.map((e) => e.benutzer_id) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{istNeu ? "Neue Aufgabe" : "Aufgabe"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {aufgabe && <Bildschirmfotos pfade={aufgabe.screenshot_pfade} />}

          <div>
            <Label htmlFor="aufgabe-titel">Titel *</Label>
            <Input
              id="aufgabe-titel"
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
            />
          </div>

          <div className={cn("grid gap-3", istNeu ? "grid-cols-2" : "grid-cols-3")}>
            <div>
              <Label>Art</Label>
              <Select value={typ} onValueChange={(w) => setTyp(w as AufgabenTyp)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYP_REIHENFOLGE.map((wert) => (
                    <SelectItem key={wert} value={wert}>
                      {TYP_DARSTELLUNG[wert].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!istNeu && (
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(w) => setStatus(w as AufgabenStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_REIHENFOLGE.map((wert) => (
                      <SelectItem key={wert} value={wert}>
                        {STATUS_DARSTELLUNG[wert].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Dringlichkeit</Label>
              <Select
                value={prioritaet}
                onValueChange={(w) => setPrioritaet(w as AufgabenPrioritaet)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITAET_REIHENFOLGE.map((wert) => (
                    <SelectItem key={wert} value={wert}>
                      {PRIORITAET_DARSTELLUNG[wert].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Verantwortlich</Label>
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

          {!istNeu && (
            <div>
              <Label className="mb-1.5 block">Markierte Personen</Label>
              <BenutzerAuswahl
                benutzer={benutzer}
                ausgewaehlt={erwaehnteIds}
                verantwortlichId={verantwortlichId}
                onUmschalten={(id) =>
                  erwaehnungSetzen.mutate({
                    ticketId: aufgabe.id,
                    benutzerId: id,
                    markieren: !erwaehnteIds.includes(id),
                  })
                }
              />
            </div>
          )}

          <div>
            <Label htmlFor="aufgabe-beschreibung">Beschreibung</Label>
            <Textarea
              id="aufgabe-beschreibung"
              value={beschreibung}
              onChange={(e) => setBeschreibung(e.target.value)}
              className="min-h-[100px]"
            />
          </div>

          {aufgabe && <Herkunft aufgabe={aufgabe} />}
          {aufgabe && <AufgabeKommentare aufgabenId={aufgabe.id} />}

          <div className="flex justify-between pt-2">
            {aufgabe && (
              <Button
                variant="destructive"
                size="sm"
                disabled={loeschen.isPending}
                onClick={() =>
                  loeschen.mutate(aufgabe.id, {
                    onSuccess: () => {
                      toast.success("Aufgabe gelöscht");
                      onOpenChange(false);
                    },
                    onError: () => toast.error("Die Aufgabe konnte nicht gelöscht werden"),
                  })
                }
              >
                <Trash2 className="mr-1 h-4 w-4" /> Löschen
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button
                onClick={speichern}
                disabled={!titel.trim() || anlegen.isPending || aendern.isPending}
              >
                {istNeu ? "Anlegen" : "Speichern"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Bildschirmfotos liegen im privaten Bucket und brauchen eine signierte Adresse. */
const Bildschirmfotos = ({ pfade }: { pfade: string[] }) => {
  const { data: adressen = [] } = useQuery({
    queryKey: ["aufgabe-screenshots", pfade],
    queryFn: async () => {
      const ergebnisse = await Promise.all(pfade.map((pfad) => signiereScreenshot(pfad)));
      return ergebnisse.filter((a): a is string => !!a);
    },
    enabled: pfade.length > 0,
    staleTime: 50 * 60 * 1000,
  });

  if (!pfade.length) return null;

  return (
    <div className="space-y-2">
      {adressen.map((adresse) => (
        <a key={adresse} href={adresse} target="_blank" rel="noreferrer" className="block">
          <img
            src={adresse}
            alt="Aufgenommener Bildschirm"
            className="max-h-72 w-full rounded-md border bg-white object-contain"
          />
        </a>
      ))}
      {adressen.length === 0 && (
        <p className="text-xs text-muted-foreground">Bild wird geladen...</p>
      )}
    </div>
  );
};

/** Woher die Meldung kam — hilft beim Nachstellen. */
const Herkunft = ({ aufgabe }: { aufgabe: Aufgabe }) => {
  const kontext = aufgabe.technischer_kontext as
    | { fensterbreite?: number; fensterhoehe?: number; browser?: string }
    | null;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Gemeldet von <strong>{aufgabe.melder?.anzeigename ?? "unbekannt"}</strong> am{" "}
          {format(new Date(aufgabe.erstellt_am), "dd.MM.yyyy 'um' HH:mm", { locale: de })}
        </span>
        {aufgabe.quelle === "bildschirmmeldung" && (
          <Badge variant="outline" className="text-[10px] font-normal">
            per Bildschirmaufnahme
          </Badge>
        )}
      </div>
      {aufgabe.seiten_titel && (
        <div className="mt-1 flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          {aufgabe.seiten_titel}
          {aufgabe.seiten_pfad && <span className="font-mono">{aufgabe.seiten_pfad}</span>}
        </div>
      )}
      {kontext?.fensterbreite && (
        <div className="mt-1">
          Fenster {kontext.fensterbreite} × {kontext.fensterhoehe}
        </div>
      )}
      {aufgabe.erledigt_am && (
        <div className="mt-1">
          Erledigt am {format(new Date(aufgabe.erledigt_am), "dd.MM.yyyy", { locale: de })}
        </div>
      )}
    </div>
  );
};
