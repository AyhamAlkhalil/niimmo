import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Camera, Inbox, Loader2, Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useAppBenutzer } from "@/hooks/useAppBenutzer";
import { useAufgaben, type Aufgabe } from "@/hooks/useAufgaben";
import { AufgabeDetail } from "./AufgabeDetail";
import { BenutzerAbzeichen } from "./BenutzerAuswahl";
import {
  PRIORITAET_DARSTELLUNG,
  STATUS_DARSTELLUNG,
  STATUS_REIHENFOLGE,
  TYP_DARSTELLUNG,
  TYP_REIHENFOLGE,
  sortiereAufgaben,
} from "./aufgabenDarstellung";

interface AufgabenBoardProps {
  onBack: () => void;
  /** Beim Öffnen aus einer Benachrichtigung direkt aufklappen. */
  aufgabeOeffnen?: string | null;
  onAufgabeGeoeffnet?: () => void;
}

type Sicht = "meine" | "offen" | "alle";

export const AufgabenBoard = ({ onBack, aufgabeOeffnen, onAufgabeGeoeffnet }: AufgabenBoardProps) => {
  const { data: aufgaben = [], isLoading } = useAufgaben();
  const { ichSelbst } = useAppBenutzer();

  const [sicht, setSicht] = useState<Sicht>("offen");
  const [suche, setSuche] = useState("");
  const [filterTyp, setFilterTyp] = useState<string>("alle");
  const [filterStatus, setFilterStatus] = useState<string>("alle");
  // Ein Zustand fuer beide Faelle. Zwei getrennte Zustaende koennten sonst
  // gleichzeitig offen sein — zwei Dialoge uebereinander, zwei Fokusfallen.
  const [dialog, setDialog] = useState<{ art: "neu" } | { art: "detail"; id: string } | null>(null);

  // Eine aus der Benachrichtigung übergebene Aufgabe wird einmalig übernommen
  // und die Vorgabe sofort geleert. Sonst bliebe sie Vorrang behalten und ein
  // Klick auf eine andere Zeile würde die Ansicht nicht wechseln.
  useEffect(() => {
    if (!aufgabeOeffnen) return;
    setDialog({ art: "detail", id: aufgabeOeffnen });
    onAufgabeGeoeffnet?.();
  }, [aufgabeOeffnen, onAufgabeGeoeffnet]);

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();

    const gefilterteListe = aufgaben.filter((a) => {
      if (sicht === "offen" && a.status === "fertig") return false;
      if (sicht === "meine") {
        const meine =
          a.verantwortlich_id === ichSelbst?.id ||
          a.melder_id === ichSelbst?.id ||
          a.erwaehnungen.some((e) => e.benutzer_id === ichSelbst?.id);
        if (!meine) return false;
      }
      if (filterTyp !== "alle" && a.typ !== filterTyp) return false;
      if (filterStatus !== "alle" && a.status !== filterStatus) return false;
      if (begriff) {
        const heuhaufen = [a.titel, a.kurzbeschreibung, a.beschreibung, a.seiten_titel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!heuhaufen.includes(begriff)) return false;
      }
      return true;
    });

    return sortiereAufgaben(gefilterteListe);
  }, [aufgaben, sicht, suche, filterTyp, filterStatus, ichSelbst?.id]);

  const offeneAnzahl = aufgaben.filter((a) => a.status !== "fertig").length;
  const meineAnzahl = aufgaben.filter(
    (a) =>
      a.status !== "fertig" &&
      (a.verantwortlich_id === ichSelbst?.id ||
        a.erwaehnungen.some((e) => e.benutzer_id === ichSelbst?.id)),
  ).length;

  const detail =
    dialog?.art === "detail" ? (aufgaben.find((a) => a.id === dialog.id) ?? null) : null;

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto max-w-5xl px-4 py-4 sm:p-6 lg:p-8">
        <div className="glass-card mb-4 rounded-xl p-4 sm:mb-6 sm:rounded-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-bold sm:text-2xl">Aufgaben</h1>
              <Badge variant="secondary">{offeneAnzahl} offen</Badge>
            </div>
            <Button size="sm" onClick={() => setDialog({ art: "neu" })}>
              <Plus className="mr-1 h-4 w-4" /> Neu
            </Button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              variant={sicht === "meine" ? "default" : "outline"}
              size="sm"
              onClick={() => setSicht("meine")}
            >
              Für mich {meineAnzahl > 0 && `(${meineAnzahl})`}
            </Button>
            <Button
              variant={sicht === "offen" ? "default" : "outline"}
              size="sm"
              onClick={() => setSicht("offen")}
            >
              Offen ({offeneAnzahl})
            </Button>
            <Button
              variant={sicht === "alle" ? "default" : "outline"}
              size="sm"
              onClick={() => setSicht("alle")}
            >
              Alle ({aufgaben.length})
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="Suchen..."
                className="h-9 pl-9"
              />
            </div>
            <Select value={filterTyp} onValueChange={setFilterTyp}>
              <SelectTrigger className="h-9 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Arten</SelectItem>
                {TYP_REIHENFOLGE.map((wert) => (
                  <SelectItem key={wert} value={wert}>
                    {TYP_DARSTELLUNG[wert].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Status</SelectItem>
                {STATUS_REIHENFOLGE.map((wert) => (
                  <SelectItem key={wert} value={wert}>
                    {STATUS_DARSTELLUNG[wert].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="glass-card flex items-center justify-center gap-2 rounded-xl p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Aufgaben werden geladen...
          </div>
        ) : gefiltert.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {aufgaben.length === 0
                ? "Noch keine Aufgaben. Melden Sie ein Problem über den Kamera-Knopf unten rechts."
                : "Keine Aufgabe passt zu dieser Auswahl."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {gefiltert.map((aufgabe) => (
              <AufgabenZeile
                key={aufgabe.id}
                aufgabe={aufgabe}
                istMeine={aufgabe.verantwortlich_id === ichSelbst?.id}
                onClick={() => setDialog({ art: "detail", id: aufgabe.id })}
              />
            ))}
          </div>
        )}
      </div>

      <AufgabeDetail
        aufgabe={detail}
        // Bei "detail" erst oeffnen, wenn die Aufgabe wirklich vorliegt —
        // sonst zeigte der Dialog waehrend des Ladens "Neue Aufgabe" an.
        open={dialog?.art === "neu" || (dialog?.art === "detail" && !!detail)}
        onOpenChange={(offen) => {
          if (!offen) setDialog(null);
        }}
      />
    </div>
  );
};

const AufgabenZeile = ({
  aufgabe,
  istMeine,
  onClick,
}: {
  aufgabe: Aufgabe;
  istMeine: boolean;
  onClick: () => void;
}) => {
  const typ = TYP_DARSTELLUNG[aufgabe.typ] ?? TYP_DARSTELLUNG.aufgabe;
  const status = STATUS_DARSTELLUNG[aufgabe.status] ?? STATUS_DARSTELLUNG.offen;
  const prio = PRIORITAET_DARSTELLUNG[aufgabe.prioritaet] ?? PRIORITAET_DARSTELLUNG.mittel;
  const TypSymbol = typ.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "glass-card flex w-full items-start gap-3 rounded-xl p-3 text-left transition-shadow hover:shadow-md",
        aufgabe.status === "fertig" && "opacity-60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          typ.className,
        )}
      >
        <TypSymbol className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium leading-tight">{aufgabe.titel}</span>
          {istMeine && (
            <Badge className="bg-red-100 text-[10px] text-red-700 hover:bg-red-100">für mich</Badge>
          )}
          {aufgabe.screenshot_pfade.length > 0 && (
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>

        {aufgabe.kurzbeschreibung && (
          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
            {aufgabe.kurzbeschreibung}
          </span>
        )}

        <span className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", status.className)}>
            {status.label}
          </Badge>
          <Badge className={cn("text-[10px]", prio.className)}>{prio.label}</Badge>
          <BenutzerAbzeichen benutzer={aufgabe.verantwortlich} />
          <span className="text-[11px] text-muted-foreground">
            {format(new Date(aufgabe.erstellt_am), "dd.MM.yy", { locale: de })}
          </span>
        </span>
      </span>
    </button>
  );
};
