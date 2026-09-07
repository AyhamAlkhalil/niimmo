import { Building2, Copy, Edit2, Home, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PaymentKategorieEditor } from "./PaymentKategorieEditor";
import { KategorieBadge } from "./KategorieBadge";
import { ZahlungZeile, brauchtZuordnung, formatEuro, istZugeordnet, monatsLabel } from "@/utils/zahlungenAnsicht";

/**
 * Die schmale Detailspalte rechts neben der Buchungstabelle. Sie zeigt, was
 * in der Zeile keinen Platz hat — vollständiger Verwendungszweck, IBAN,
 * Verrechnungsmonat — und trägt die beiden Aktionen: Kategorie ändern und
 * Zuordnung setzen.
 */

interface ZahlungInspectorProps {
  zahlung: ZahlungZeile | undefined;
  onZuordnen: (zahlung: ZahlungZeile) => void;
  /** Nur in der Überlagerung auf schmalen Bildschirmen. */
  onSchliessen?: () => void;
}

function Eintrag({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ZahlungInspector({ zahlung, onZuordnen, onSchliessen }: ZahlungInspectorProps) {
  const { toast } = useToast();

  if (!zahlung) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">Keine Buchung gewählt</p>
        <p className="text-xs text-muted-foreground">
          Eine Zeile anklicken oder mit ↑ ↓ blättern. Enter öffnet die Zuordnung.
        </p>
      </div>
    );
  }

  const zugeordnet = istZugeordnet(zahlung);
  const offen = brauchtZuordnung(zahlung);

  const ibanKopieren = async () => {
    if (!zahlung.iban) return;
    try {
      await navigator.clipboard.writeText(zahlung.iban);
      toast({ title: "IBAN kopiert" });
    } catch {
      toast({ title: "IBAN konnte nicht kopiert werden", variant: "destructive" });
    }
  };

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
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
              zugeordnet
                ? "border-success/30 bg-success/10 text-success"
                : offen
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-muted text-muted-foreground"
            )}
          >
            {zugeordnet ? "Zugeordnet" : offen ? "Zuordnung offen" : "Ohne Zuordnung"}
          </span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-3">
          <dl className="space-y-3">
            <Eintrag label="Verwendungszweck">
              {zahlung.verwendungszweck ? (
                <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/40 px-2 py-1.5 text-sm leading-snug">
                  {zahlung.verwendungszweck}
                </p>
              ) : (
                <span className="text-muted-foreground">–</span>
              )}
            </Eintrag>
            <Eintrag label="IBAN">
              {zahlung.iban ? (
                <span className="flex items-center gap-1">
                  <span className="truncate font-mono text-xs">{zahlung.iban}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="IBAN kopieren" onClick={ibanKopieren}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </span>
              ) : (
                <span className="text-muted-foreground">–</span>
              )}
            </Eintrag>
            <div className="grid grid-cols-2 gap-3">
              <Eintrag label="Verrechnungsmonat">
                {zahlung.zugeordneter_monat ? monatsLabel(zahlung.zugeordneter_monat.slice(0, 7)) : <span className="text-muted-foreground">–</span>}
              </Eintrag>
              <Eintrag label="Kategorie">
                <PaymentKategorieEditor
                  paymentId={zahlung.id}
                  currentKategorie={zahlung.kategorie}
                  currentImmobilieId={zahlung.immobilie_id}
                  compact
                />
              </Eintrag>
            </div>
          </dl>

          <Separator />

          <section aria-label="Zuordnung" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zuordnung</h3>
            </div>
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                zugeordnet ? "bg-card" : offen ? "border-warning/40 bg-warning/5" : "bg-muted/40"
              )}
            >
              {zahlung.mietvertrag_id ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="font-medium">{zahlung.mieter_name || "Vertrag ohne Mieter"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      <span className="block">{zahlung.immobilie_name || "Objekt unbekannt"}</span>
                      {zahlung.immobilie_adresse && <span className="block text-xs text-muted-foreground">{zahlung.immobilie_adresse}</span>}
                    </span>
                  </div>
                  {(zahlung.einheit_typ || zahlung.einheit_etage) && (
                    <div className="flex items-start gap-2">
                      <Home className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{[zahlung.einheit_typ, zahlung.einheit_etage].filter(Boolean).join(" · ")}</span>
                    </div>
                  )}
                </div>
              ) : zahlung.immobilie_id ? (
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    <span className="block font-medium">{zahlung.immobilie_name || "Objekt"}</span>
                    {zahlung.immobilie_adresse && <span className="block text-xs text-muted-foreground">{zahlung.immobilie_adresse}</span>}
                    <span className="block text-xs text-muted-foreground">Objektbezug (Nebenkosten / Nichtmiete)</span>
                  </span>
                </div>
              ) : (
                <p className={cn("text-sm", offen ? "text-warning" : "text-muted-foreground")}>
                  {offen ? "Diese Buchung braucht einen Mietvertrag, damit der Rückstand stimmt." : "Kein Vertrags- oder Objektbezug."}
                </p>
              )}
            </div>
            <Button className="w-full" variant={zugeordnet ? "outline" : "default"} onClick={() => onZuordnen(zahlung)}>
              <Edit2 className="h-4 w-4" />
              {zugeordnet ? "Zuordnung ändern" : "Zuordnen"}
            </Button>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
