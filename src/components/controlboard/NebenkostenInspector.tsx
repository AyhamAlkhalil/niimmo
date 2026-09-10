import { ArrowUpCircle, Building2, Check, Copy, Eye, EyeOff, ExternalLink, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { KategorieBadge } from "./KategorieBadge";
import { ZuordnungsAuswahl } from "./ZuordnungsAuswahl";
import { ZahlungZeile, formatEuro } from "@/utils/zahlungenAnsicht";
import { KONFIDENZ_LABEL, KiKonfidenz, KiVorschlag, NebenkostenSicht } from "@/utils/nebenkostenZuordnung";
import type { ImmobilieOption } from "@/utils/zuordnungsvorschlaege";

/**
 * Detailspalte des Nebenkosten-Reiters: die gewählte Ausgabe, der
 * KI-Vorschlag mit Begründung, die Objektliste zum Zuordnen und die
 * Kategorie-Aktionen. Ersetzt seit dem 10.09.2026 das Ziehen der Karten auf
 * Objektkacheln — Zeile wählen, Objekt anklicken, nächste Zeile.
 */

const KONFIDENZ_KLASSEN: Record<KiKonfidenz, string> = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-destructive/30 bg-destructive/10 text-destructive",
};

interface NebenkostenInspectorProps {
  zahlung: ZahlungZeile | undefined;
  sicht: NebenkostenSicht | null;
  vorschlag: KiVorschlag | undefined;
  immobilien: readonly ImmobilieOption[];
  immobilienLaden: boolean;
  immobilienFehler: boolean;
  anzahlJeObjekt: ReadonlyMap<string, number>;
  beschaeftigt: boolean;
  onZuordnen: (zahlungId: string, immobilieId: string) => void;
  onAufheben: (zahlungId: string) => void;
  onAlsNichtmiete: (zahlungId: string) => void;
  onAlsNebenkosten: (zahlungId: string) => void;
  onAusblenden: (zahlungId: string) => void;
  onEinblenden: (zahlungId: string) => void;
  onZumObjekt: (immobilieId: string) => void;
  /** Nur in der Überlagerung auf schmalen Bildschirmen. */
  onSchliessen?: () => void;
}

export function NebenkostenInspector({
  zahlung,
  sicht,
  vorschlag,
  immobilien,
  immobilienLaden,
  immobilienFehler,
  anzahlJeObjekt,
  beschaeftigt,
  onZuordnen,
  onAufheben,
  onAlsNichtmiete,
  onAlsNebenkosten,
  onAusblenden,
  onEinblenden,
  onZumObjekt,
  onSchliessen,
}: NebenkostenInspectorProps) {
  const { toast } = useToast();

  if (!zahlung) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">Keine Ausgabe gewählt</p>
        <p className="text-xs text-muted-foreground">Eine Zeile anklicken oder mit ↑ ↓ blättern, dann rechts das Objekt wählen.</p>
      </div>
    );
  }

  const ibanKopieren = async () => {
    if (!zahlung.iban) return;
    try {
      await navigator.clipboard.writeText(zahlung.iban);
      toast({ title: "IBAN kopiert" });
    } catch {
      toast({ title: "IBAN konnte nicht kopiert werden", variant: "destructive" });
    }
  };

  const statusText = sicht === "zugeordnet" ? "Zugeordnet" : sicht === "ausgeblendet" ? "Ausgeblendet" : "Ohne Objekt";
  const statusKlasse =
    sicht === "zugeordnet"
      ? "border-success/30 bg-success/10 text-success"
      : sicht === "ausgeblendet"
        ? "border-border bg-muted text-muted-foreground"
        : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("text-2xl font-semibold tabular-nums leading-tight", zahlung.betrag < 0 ? "text-destructive" : "text-success")}>
              {formatEuro(zahlung.betrag)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {zahlung.buchungsdatum_formatted}
              {zahlung.empfaengername && (
                <>
                  {" · "}
                  {zahlung.betrag < 0 ? "an" : "von"} <span className="text-foreground">{zahlung.empfaengername}</span>
                </>
              )}
            </p>
          </div>
          {onSchliessen && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Details schließen" onClick={onSchliessen}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <KategorieBadge kategorie={zahlung.kategorie} />
          <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4", statusKlasse)}>{statusText}</span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Verwendungszweck</p>
            {zahlung.verwendungszweck ? (
              <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-2 py-1.5 text-sm leading-snug">{zahlung.verwendungszweck}</p>
            ) : (
              <p className="text-sm text-muted-foreground">–</p>
            )}
            {zahlung.iban && (
              <span className="flex items-center gap-1">
                <span className="truncate font-mono text-xs text-muted-foreground">{zahlung.iban}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="IBAN kopieren" onClick={ibanKopieren}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
          </div>

          {vorschlag && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs font-medium uppercase tracking-wide text-primary">KI-Vorschlag</p>
                <span className={cn("ml-auto inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4", KONFIDENZ_KLASSEN[vorschlag.confidence] ?? KONFIDENZ_KLASSEN.low)}>
                  {KONFIDENZ_LABEL[vorschlag.confidence] ?? vorschlag.confidence}
                </span>
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">Kostenart: </span>
                <span className="font-medium">{vorschlag.category}</span>
              </p>
              {vorschlag.suggested_immobilie_name && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Objekt: </span>
                  <span className="font-medium">{vorschlag.suggested_immobilie_name}</span>
                </p>
              )}
              {vorschlag.reasoning && <p className="text-xs leading-snug text-muted-foreground">{vorschlag.reasoning}</p>}
              {vorschlag.suggested_immobilie_id && zahlung.immobilie_id !== vorschlag.suggested_immobilie_id && (
                <Button size="sm" className="w-full" disabled={beschaeftigt} onClick={() => onZuordnen(zahlung.id, vorschlag.suggested_immobilie_id as string)}>
                  <Check className="h-4 w-4" />
                  Vorschlag übernehmen
                </Button>
              )}
            </div>
          )}

          <Separator />

          <section aria-label="Objekt" className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objekt</h3>
            {zahlung.immobilie_id ? (
              <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{zahlung.immobilie_name || "Objekt"}</span>
                  {zahlung.immobilie_adresse && <span className="block truncate text-xs text-muted-foreground">{zahlung.immobilie_adresse}</span>}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Zum Objekt wechseln" onClick={() => onZumObjekt(zahlung.immobilie_id as string)}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">Kein Objekt gewählt — die Ausgabe fehlt in jeder Nebenkostenabrechnung.</p>
            )}
            <ZuordnungsAuswahl
              modus="immobilie"
              vertraege={[]}
              immobilien={immobilien}
              aktuelleId={zahlung.immobilie_id}
              onAuswahl={(id) => (id ? onZuordnen(zahlung.id, id) : onAufheben(zahlung.id))}
              laedt={immobilienLaden}
              fehler={immobilienFehler}
              anzahlJeId={anzahlJeObjekt}
            />
          </section>

          <Separator />

          <section aria-label="Kategorie" className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kategorie</h3>
            <div className="flex flex-col gap-2">
              {zahlung.kategorie === "Nebenkosten" ? (
                <Button variant="outline" size="sm" className="justify-start text-destructive hover:text-destructive" disabled={beschaeftigt} onClick={() => onAlsNichtmiete(zahlung.id)}>
                  <X className="h-4 w-4" />
                  Als Nichtmiete markieren
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="justify-start" disabled={beschaeftigt} onClick={() => onAlsNebenkosten(zahlung.id)}>
                  <ArrowUpCircle className="h-4 w-4" />
                  Als Nebenkosten markieren
                </Button>
              )}
              {sicht === "ausgeblendet" ? (
                <Button variant="outline" size="sm" className="justify-start" disabled={beschaeftigt} onClick={() => onEinblenden(zahlung.id)}>
                  <Eye className="h-4 w-4" />
                  Wieder einblenden
                </Button>
              ) : (
                sicht === "offen" && (
                  <Button variant="outline" size="sm" className="justify-start text-muted-foreground" disabled={beschaeftigt} onClick={() => onAusblenden(zahlung.id)}>
                    <EyeOff className="h-4 w-4" />
                    Ausblenden
                  </Button>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              „Als Nichtmiete" nimmt den Objektbezug weg und blendet die Ausgabe aus. Ausgeblendete Ausgaben bleiben in der Sicht „Ausgeblendet" erreichbar.
            </p>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
