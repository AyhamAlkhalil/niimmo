import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, ArrowRight, Loader2, Split } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ALLE_KATEGORIEN,
  findeKategorieNachId,
  type NebenkostenKategorie,
} from "./nebenkostenKategorien";
import {
  findeOderErstelleNebenkostenart,
  useInvalidateNebenkosten,
  useNebenkostenarten,
  type KostenpositionMitArt,
} from "@/hooks/useNebenkostenDaten";
import {
  baueAufteilungsReihen,
  betragAusProzent,
  pruefeAufteilung,
  summePositionen,
  teileKategorie,
} from "@/utils/nebenkostenAufteilung";

interface NebenkostenKategorieTeilenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  immobilieId: string;
  /** Kategorie, aus der herausgelöst wird. */
  quelle: NebenkostenKategorie | null;
  /** Positionen dieser Kategorie im angezeigten Zeitraum. */
  positionen: KostenpositionMitArt[];
}

/**
 * Löst einen Teilbetrag einer Kategorie in eine zweite Kategorie heraus.
 *
 * Kundenmeldung 10.09.2026: Abschläge an den Wasserverband laufen gebündelt in
 * "2.2 Wasserversorgung"; erst die Endabrechnung sagt, welcher Teil Entwässerung
 * war. Der Betrag wird anteilig über alle Positionen verschoben, damit jede
 * Kostenposition bei ihrer Bankbewegung bleibt.
 */
export function NebenkostenKategorieTeilenDialog({
  open,
  onOpenChange,
  immobilieId,
  quelle,
  positionen,
}: NebenkostenKategorieTeilenDialogProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateNebenkosten(immobilieId);
  const { data: nebenkostenarten } = useNebenkostenarten(immobilieId);

  const [zielId, setZielId] = useState("");
  const [modus, setModus] = useState<"betrag" | "prozent">("betrag");
  const [eingabe, setEingabe] = useState("");
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    if (!open) return;
    setZielId("");
    setModus("betrag");
    setEingabe("");
  }, [open, quelle?.id]);

  const summe = useMemo(() => summePositionen(positionen), [positionen]);
  const zahl = parseFloat(eingabe.replace(",", "."));
  const zielBetrag = useMemo(() => {
    if (!Number.isFinite(zahl)) return NaN;
    return modus === "betrag" ? zahl : betragAusProzent(summe, zahl);
  }, [zahl, modus, summe]);

  const eingabeFehler = eingabe.trim() === "" ? null : pruefeAufteilung(positionen, zielBetrag);
  const zeilen = useMemo(
    () => (eingabeFehler || !Number.isFinite(zielBetrag) ? [] : teileKategorie(positionen, zielBetrag)),
    [positionen, zielBetrag, eingabeFehler]
  );

  const verschobenGesamt = zeilen.reduce((s, z) => s + z.verschoben, 0);
  const restGesamt = zeilen.reduce((s, z) => s + z.rest, 0);
  const betroffene = zeilen.filter((z) => z.verschoben > 0).length;
  const geleert = zeilen.length > 0 && restGesamt < 0.005;
  const ziel = zielId ? findeKategorieNachId(zielId) : undefined;
  const kannSpeichern = !!ziel && zeilen.length > 0 && !eingabeFehler && !speichert;

  const zielAuswahl = ALLE_KATEGORIEN.filter((k) => k.id !== quelle?.id);

  async function speichern() {
    if (!kannSpeichern || !ziel) return;
    setSpeichert(true);

    try {
      // Zwei Schritte: Erst muss die Zielkostenart bestehen, dann werden die
      // Positionen umgebucht. Nur der zweite Schritt ist in sich unteilbar;
      // deshalb werden beide getrennt gemeldet.
      let zielArtId: string;
      try {
        zielArtId = await findeOderErstelleNebenkostenart(immobilieId, ziel.id, nebenkostenarten);
      } catch (fehler: unknown) {
        const grund = fehler instanceof Error ? fehler.message : "Unbekannter Fehler";
        throw new Error(`Die Kostenart ${ziel.name} konnte nicht angelegt werden: ${grund}`);
      }

      const { data: benutzer } = await supabase.auth.getUser();

      // Gekürzte und neue Positionen gehen in EINER Anfrage raus. Eine Schleife
      // aus einzelnen update/insert-Aufrufen kann mittendrin abbrechen und die
      // Kategorie halb aufgeteilt zurücklassen — die Summe stimmte dann nicht
      // mehr. Der Upsert wird als ein INSERT ... ON CONFLICT ausgeführt und ist
      // damit ganz oder gar nicht wirksam.
      const reihen = baueAufteilungsReihen(
        positionen,
        zeilen,
        { nebenkostenartId: zielArtId, name: ziel.name, umlagefaehig: ziel.umlagefaehig },
        immobilieId,
        { urheber: benutzer.user?.id ?? null }
      );

      if (reihen.length === 0) throw new Error("Es gibt nichts zu verschieben.");

      const { error } = await supabase
        .from("kostenpositionen")
        .upsert(reihen, { onConflict: "id" });
      if (error) throw error;

      toast({
        title: "✓ Aufgeteilt",
        description: `${verschobenGesamt.toFixed(2)} € aus ${quelle?.name} nach ${ziel.name} verschoben.`,
      });
      invalidate();
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unbekannter Fehler";
      toast({
        title: "Aufteilen fehlgeschlagen",
        description: `${message} Es wurde nichts umgebucht; die Beträge stehen unverändert in ${quelle?.name ?? "der Kategorie"}.`,
        variant: "destructive",
      });
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" />
            {quelle?.name ?? "Kategorie"} aufteilen
          </DialogTitle>
          <DialogDescription>
            Für Abschläge, die erst nach der Endabrechnung einer zweiten Kostenart zuzuordnen sind.
            Der Betrag wird anteilig über alle {positionen.length} Position(en) dieser Kategorie
            verschoben; jede Position bleibt bei ihrer Bankbewegung.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{quelle?.name}</span>
              <span className="font-semibold tabular-nums">{summe.toFixed(2)} €</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {positionen.length} Position(en) im angezeigten Zeitraum
            </p>
          </div>

          <div className="space-y-2">
            <Label>Zielkategorie</Label>
            <Select value={zielId} onValueChange={setZielId}>
              <SelectTrigger>
                <SelectValue placeholder="Kategorie wählen" />
              </SelectTrigger>
              <SelectContent>
                {zielAuswahl.map((kategorie) => (
                  <SelectItem key={kategorie.id} value={kategorie.id}>
                    {kategorie.betrkvNummer ? `${kategorie.betrkvNummer} ` : ""}
                    {kategorie.name}
                    {!kategorie.umlagefaehig && " (nicht umlagefähig)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Zu verschieben</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={eingabe}
                onChange={(e) => setEingabe(e.target.value)}
                placeholder={modus === "betrag" ? "z. B. 1100,00" : "z. B. 42"}
                className="flex-1"
              />
              <div className="flex overflow-hidden rounded-md border">
                <Button
                  type="button"
                  size="sm"
                  variant={modus === "betrag" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => setModus("betrag")}
                >
                  €
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={modus === "prozent" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => setModus("prozent")}
                >
                  %
                </Button>
              </div>
            </div>
            {modus === "prozent" && Number.isFinite(zielBetrag) && !eingabeFehler && (
              <p className="text-xs text-muted-foreground">
                entspricht {zielBetrag.toFixed(2)} €
              </p>
            )}
            {eingabeFehler && (
              <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {eingabeFehler}
              </p>
            )}
          </div>

          {zeilen.length > 0 && ziel && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Ergebnis</p>
              <div className="flex items-center justify-between text-sm">
                <span>{quelle?.name}</span>
                <span
                  className={cn("font-semibold tabular-nums", geleert && "text-muted-foreground")}
                >
                  {restGesamt.toFixed(2)} €
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <ArrowRight className="h-3.5 w-3.5 text-primary" />
                  {ziel.name}
                </span>
                <span className="font-semibold tabular-nums text-primary">
                  {verschobenGesamt.toFixed(2)} €
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {betroffene} Position(en) betroffen
                {geleert && ` · ${quelle?.name} bleibt ohne Kosten zurück`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={speichert}>
            Abbrechen
          </Button>
          <Button onClick={speichern} disabled={!kannSpeichern}>
            {speichert ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Wird aufgeteilt …
              </>
            ) : (
              "Aufteilen"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
