import { useMemo, useState } from "react";
import { Building2, Check, MapPin, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEuro, formatIsoDatum } from "@/utils/zahlungenAnsicht";
import type { ImmobilieOption, VertragOption } from "@/utils/zuordnungsvorschlaege";

/**
 * Durchsuchbare Ziel-Liste für eine Zuordnung: Mietverträge oder Objekte.
 *
 * Ersetzt seit dem 07.09.2026 den PaymentCorrectionDialog. Der öffnete sich
 * als zweites Fenster über der Prüfmaske; jetzt sitzt die Liste direkt in
 * der Detailspalte, sodass Zeile wählen → Ziel wählen → nächste Zeile ohne
 * Fensterwechsel geht.
 */

interface ZuordnungsAuswahlProps {
  modus: "mietvertrag" | "immobilie";
  vertraege: readonly VertragOption[];
  immobilien: readonly ImmobilieOption[];
  aktuelleId: string | null;
  onAuswahl: (id: string | null) => void;
  laedt?: boolean;
  /** Abfrage der Ziele fehlgeschlagen — darf nie wie „keine Einträge" aussehen. */
  fehler?: boolean;
}

const STATUS_RANG: Record<string, number> = { aktiv: 0, gekuendigt: 1, beendet: 2 };

const STATUS_ANZEIGE: Record<string, { label: string; klasse: string }> = {
  aktiv: { label: "Aktiv", klasse: "border-success/30 bg-success/10 text-success" },
  gekuendigt: { label: "Gekündigt", klasse: "border-warning/30 bg-warning/10 text-warning" },
  beendet: { label: "Beendet", klasse: "border-border bg-muted text-muted-foreground" },
};

function VertragStatus({ status }: { status?: string }) {
  const anzeige = STATUS_ANZEIGE[status ?? "aktiv"] ?? STATUS_ANZEIGE.aktiv;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded border px-1 py-0 text-[length:inherit] text-xs leading-4", anzeige.klasse)}>
      {anzeige.label}
    </span>
  );
}

export function ZuordnungsAuswahl({ modus, vertraege, immobilien, aktuelleId, onAuswahl, laedt, fehler }: ZuordnungsAuswahlProps) {
  const [suche, setSuche] = useState("");
  const s = suche.trim().toLowerCase();

  const vertragsListe = useMemo(() => {
    const gefiltert = s
      ? vertraege.filter(
          (v) => v.mieter.toLowerCase().includes(s) || v.objekt.toLowerCase().includes(s) || (v.adresse?.toLowerCase().includes(s) ?? false)
        )
      : vertraege;
    return [...gefiltert].sort(
      (a, b) => (STATUS_RANG[a.status ?? "aktiv"] ?? 9) - (STATUS_RANG[b.status ?? "aktiv"] ?? 9) || a.mieter.localeCompare(b.mieter, "de")
    );
  }, [vertraege, s]);

  const objektListe = useMemo(
    () => (s ? immobilien.filter((i) => i.name.toLowerCase().includes(s) || i.adresse.toLowerCase().includes(s)) : immobilien),
    [immobilien, s]
  );

  const leer = modus === "immobilie" ? objektListe.length === 0 : vertragsListe.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder={modus === "immobilie" ? "Objekt oder Adresse suchen" : "Mieter, Objekt oder Adresse suchen"}
          aria-label={modus === "immobilie" ? "Objekt suchen" : "Mietvertrag suchen"}
          className="h-9 pl-8"
        />
      </div>

      {aktuelleId && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-start text-destructive hover:text-destructive"
          onClick={() => onAuswahl(null)}
        >
          <X className="h-4 w-4" />
          Zuordnung entfernen
        </Button>
      )}

      <div className="max-h-[22rem] overflow-y-auto rounded-md border" role="listbox" aria-label="Zuordnungsziele">
        {laedt ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Lade …</p>
        ) : fehler ? (
          <p className="p-4 text-center text-sm font-medium text-destructive" role="alert">
            {modus === "immobilie" ? "Objekte" : "Mietverträge"} konnten nicht geladen werden. Bitte die Maske schließen und erneut öffnen.
          </p>
        ) : leer ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{s ? "Nichts gefunden" : "Keine Einträge"}</p>
        ) : modus === "immobilie" ? (
          objektListe.map((imm) => {
            const aktiv = imm.id === aktuelleId;
            return (
              <button
                key={imm.id}
                type="button"
                role="option"
                aria-selected={aktiv}
                onClick={() => onAuswahl(imm.id)}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  aktiv && "bg-primary/10"
                )}
              >
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{imm.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{imm.adresse}</span>
                </span>
                {aktiv && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })
        ) : (
          vertragsListe.map((v) => {
            const aktiv = v.id === aktuelleId;
            const laufzeit = v.beginn ? `${formatIsoDatum(v.beginn)} – ${v.ende ? formatIsoDatum(v.ende) : "unbefristet"}` : null;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={aktiv}
                onClick={() => onAuswahl(v.id)}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  aktiv && "bg-primary/10",
                  v.status === "beendet" && "text-muted-foreground"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">{v.mieter}</span>
                    <VertragStatus status={v.status} />
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {v.objekt}
                      {v.adresse ? ` · ${v.adresse}` : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                    {laufzeit ? `${laufzeit} · ` : ""}
                    {formatEuro(v.gesamtmiete)} / Monat
                  </span>
                </span>
                {aktiv && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
