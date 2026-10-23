import { AlertTriangle, Droplet, Droplets, Flame, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { punktAlsKomma, zaehlerstandText } from "@/utils/zaehlerstandUtils";
import { dateiendung } from "@/utils/storagePfad";
import {
  ZAEHLER_BEZEICHNUNG,
  ZAEHLER_EINHEIT,
  referenzText,
  type Referenzstand,
  type ZaehlerHinweis,
  type ZaehlerTyp,
} from "@/utils/uebergabeAblauf";
import { FotoAufnahme } from "./FotoAufnahme";

const SYMBOL: Record<ZaehlerTyp, typeof Zap> = { strom: Zap, gas: Flame, wasser: Droplet, warmwasser: Droplets };

interface ZaehlerFeldProps {
  contractId: string;
  typ: ZaehlerTyp;
  isEinzug: boolean;
  wert: string;
  onWertChange: (wert: string) => void;
  fotos: string[];
  onFotosChange: (pfade: string[]) => void;
  onUploadingChange: (aktiv: boolean) => void;
  /** aus den Stammdaten der Einheit */
  nummer?: string | null;
  referenz: Referenzstand | null;
  hinweise: ZaehlerHinweis[];
}

/**
 * Ein Zähler: Stand, Foto, Vergleichswert und Rückfragen an einer Stelle. Die
 * Zählernummer steht dabei, damit vor Ort klar ist, welcher Zähler gemeint ist.
 */
export const ZaehlerFeld = ({
  contractId,
  typ,
  isEinzug,
  wert,
  onWertChange,
  fotos,
  onFotosChange,
  onUploadingChange,
  nummer,
  referenz,
  hinweise,
}: ZaehlerFeldProps) => {
  const Symbol = SYMBOL[typ];
  const einheit = ZAEHLER_EINHEIT[typ];
  const id = `zaehler-${contractId}-${typ}`;
  const unlesbar = hinweise.some((h) => h.art === "unlesbar");
  const art = isEinzug ? "einzug" : "auszug";

  const hinweisText = (h: ZaehlerHinweis): string => {
    switch (h.art) {
      case "unlesbar":
        return "Nicht als Zahl lesbar. Bitte mit höchstens einem Komma eingeben, z. B. 4711,5.";
      case "foto_ohne_stand":
        return "Foto vorhanden, aber kein Stand eingetragen — der Wert fehlt sonst im Protokoll.";
      case "kleiner":
        return `Kleiner als ${referenz ? referenzText(referenz, einheit) : "der letzte bekannte Stand"}. Tippfehler oder Zählertausch?`;
      case "sprung":
        return `Mehr als zehnmal so hoch wie ${referenz ? referenzText(referenz, einheit) : "der letzte bekannte Stand"}. Fehlt ein Komma?`;
    }
  };

  return (
    <div className={cn("space-y-2 rounded-lg border bg-card p-3", unlesbar && "border-destructive")}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <Symbol className="h-4 w-4 text-muted-foreground" />
          {ZAEHLER_BEZEICHNUNG[typ]}
        </Label>
        {nummer?.trim() && <span className="truncate text-xs tabular-nums text-muted-foreground">Nr. {nummer.trim()}</span>}
      </div>

      <FotoAufnahme
        inputId={`zaehlerfoto-${contractId}-${typ}`}
        bezeichnung={`${ZAEHLER_BEZEICHNUNG[typ]}-Zählerfoto`}
        pfadFuer={(file, i) =>
          // Endung nur aus sicheren Zeichen — ein Umlaut im Pfad lässt den Upload scheitern
          `zaehlerfotos/${contractId}/${typ}_${art}_${Date.now()}_${i}.${dateiendung(file.name, file.type)}`
        }
        existingPhotos={fotos}
        onPhotosChange={onFotosChange}
        onUploadingChange={onUploadingChange}
        vorKnopf={
          <div className="relative flex-1">
            <Input
              id={id}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Stand"
              value={wert}
              onChange={(e) => onWertChange(e.target.value)}
              aria-invalid={unlesbar || undefined}
              className={cn("h-11 pr-12 text-base tabular-nums", unlesbar && "border-destructive focus-visible:ring-destructive")}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{einheit}</span>
          </div>
        }
      />

      {/* „12.345“ wird als 12,345 gelesen — das muss vor dem Unterschreiben auffallen */}
      {punktAlsKomma(wert) && !unlesbar && (
        <p className="text-xs text-muted-foreground">
          Gelesen als <span className="font-medium tabular-nums text-foreground">{zaehlerstandText(wert)} {einheit}</span>. Ohne Nachkommastellen
          bitte ohne Punkt eingeben.
        </p>
      )}
      {referenz && !hinweise.some((h) => h.art === "kleiner" || h.art === "sprung") && (
        <p className="text-xs text-muted-foreground">Zum Vergleich: {referenzText(referenz, einheit)}</p>
      )}
      {hinweise.map((h) => (
        <p key={h.art} className={cn("flex items-start gap-1.5 text-xs", h.sperrt ? "text-destructive" : "text-warning")}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {hinweisText(h)}
        </p>
      ))}
    </div>
  );
};
