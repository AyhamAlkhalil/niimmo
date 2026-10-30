import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { mieterNamenText } from "@/utils/offeneMieten";
import { mietsacheText } from "@/utils/uebergabeAblauf";
import type { AnstehendesVertragsende } from "@/utils/anstehendeVertragsenden";

/** Was die Startseite je Vertrag schon geladen hat */
export interface VertragsendeBasis {
  id: string;
  kaltmiete: number | null;
  betriebskosten: number | null;
  einheit_id: string;
  einheiten: { immobilie_id: string | null } | null;
}

interface Angaben {
  objekt: string;
  mietsache: string;
  mieter: string;
}

interface AnstehendeVertragsendenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eintraege: AnstehendesVertragsende<VertragsendeBasis>[];
  onNavigateToContract?: (immobilieId: string, einheitId: string, mietvertragId: string) => void;
}

// Unter 30 Tagen steht die Restzeit in der Markenfarbe: Dann ist Übergabe und Neuvermietung dran
const BALD_TAGE = 30;

// Am Handy zwei Spalten (Datum | Art, darunter Objekt, Mieter | Miete), ab sm eine Tabellenzeile
const ZEILE =
  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-2 sm:grid-cols-[9.5rem_6rem_minmax(0,1.3fr)_minmax(0,1fr)_6.5rem]";

const datumText = (isoTag: string) => isoTag.split("-").reverse().join(".");

/**
 * Alle anstehenden Vertragsenden auf einen Blick (30.10.2026, Kundenwunsch: „eine Liste mit allen bevorstehenden
 * Kündigungen … mit Daten und Datum“). Welche Verträge darin stehen, entscheidet die Startseite mit
 * anstehendeVertragsenden() — dieselbe Regel wie „Nächstes Vertragsende“. Hier werden nur Objekt, Mietsache und
 * Mieter dazugeladen; ein Ladefehler lässt Datum und Miete stehen und sagt, was fehlt.
 */
export const AnstehendeVertragsendenDialog = ({ open, onOpenChange, eintraege, onNavigateToContract }: AnstehendeVertragsendenDialogProps) => {
  const ids = eintraege.map((e) => e.vertrag.id);
  const { data: angaben, isLoading, isError } = useQuery({
    queryKey: ["anstehende-vertragsenden-angaben", ids],
    enabled: open && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mietvertrag")
        .select(`
          id,
          einheiten(
            einheitentyp,
            etage,
            qm,
            anzahl_zimmer,
            immobilien(name, adresse)
          ),
          mietvertrag_mieter(
            mieter:mieter_id(vorname, nachname)
          )
        `)
        .in("id", ids);
      if (error) throw error;
      const jeVertrag = new Map<string, Angaben>();
      for (const mv of data || []) {
        const einheit = mv.einheiten;
        const namen = (mv.mietvertrag_mieter || [])
          .map((mm) => `${mm.mieter?.vorname || ""} ${mm.mieter?.nachname || ""}`.trim())
          .filter(Boolean);
        jeVertrag.set(mv.id, {
          objekt: einheit?.immobilien?.name || einheit?.immobilien?.adresse || "",
          mietsache: einheit
            ? mietsacheText({ einheitentyp: einheit.einheitentyp, etage: einheit.etage, anzahlZimmer: einheit.anzahl_zimmer, qm: einheit.qm })
            : "",
          mieter: namen.length > 0 ? mieterNamenText(namen) : "",
        });
      }
      return jeVertrag;
    },
  });

  const kuendigungen = eintraege.filter((e) => e.art === "Kündigung").length;
  const platzhalter = isLoading ? "wird geladen …" : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Anstehende Vertragsenden</DialogTitle>
          <DialogDescription>
            {eintraege.length === 0
              ? "Kein laufender Vertrag hat ein Mietende ab heute."
              : `${eintraege.length} ${eintraege.length === 1 ? "Vertrag endet" : "Verträge enden"} ab heute, davon ${kuendigungen} durch Kündigung und ${eintraege.length - kuendigungen} befristet. Ein Klick öffnet den Vertrag.`}
          </DialogDescription>
        </DialogHeader>

        {isError && (
          <p role="alert" className="text-sm text-destructive">
            Objekte und Mieter konnten nicht geladen werden. Datum und Miete stimmen; bitte die Liste später erneut öffnen.
          </p>
        )}

        {eintraege.length > 0 && (
          <div className="text-base">
            <div aria-hidden="true" className={cn(ZEILE, "eyebrow hidden pb-2 sm:grid")}>
              <span>Mietende</span>
              <span>Art</span>
              <span>Objekt · Mietsache</span>
              <span>Mieter</span>
              <span className="text-right">Monatsmiete</span>
            </div>
            <ul aria-busy={isLoading} className="divide-y divide-border border-y border-border">
              {eintraege.map(({ vertrag, ende, tage, restzeit, art }) => {
                const a = angaben?.get(vertrag.id);
                const immobilieId = vertrag.einheiten?.immobilie_id;
                const wo = [a?.objekt, a?.mietsache].filter(Boolean).join(" · ");
                const miete = (vertrag.kaltmiete || 0) + (vertrag.betriebskosten || 0);
                const oeffnen = onNavigateToContract && immobilieId
                  ? () => {
                      onOpenChange(false);
                      onNavigateToContract(immobilieId, vertrag.einheit_id, vertrag.id);
                    }
                  : undefined;
                return (
                  <li key={vertrag.id}>
                    <button
                      type="button"
                      disabled={!oeffnen}
                      onClick={oeffnen}
                      className={cn(
                        ZEILE,
                        "group w-full py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-transparent"
                      )}
                    >
                      <span className="tabular-nums">
                        <span className="font-medium text-foreground">{datumText(ende)}</span>{" "}
                        <span className={cn("whitespace-nowrap text-sm", tage <= BALD_TAGE ? "text-brand" : "text-muted-foreground")}>
                          {restzeit}
                        </span>
                      </span>
                      <span className={cn("text-right text-sm sm:text-left", art === "Kündigung" ? "text-foreground" : "text-muted-foreground")}>
                        {art}
                      </span>
                      <span title={wo || undefined} className="col-span-2 min-w-0 break-words text-sm text-muted-foreground sm:col-span-1 sm:truncate">
                        {wo || platzhalter}
                      </span>
                      <span title={a?.mieter || undefined} className="min-w-0 break-words text-sm text-foreground sm:truncate">
                        {a ? a.mieter || "Ohne Mieter" : platzhalter}
                      </span>
                      <span className="flex items-baseline justify-end gap-1 whitespace-nowrap text-right tabular-nums text-foreground">
                        {formatEuroKompakt(miete)}
                        <ChevronRight
                          aria-hidden="true"
                          className="hidden h-3.5 w-3.5 self-center text-muted-foreground transition-colors group-hover:text-foreground sm:block"
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
