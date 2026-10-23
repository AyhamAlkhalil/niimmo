import { format } from "date-fns";
import { de } from "date-fns/locale";
import { parseZaehlerstand, zaehlerstandText } from "@/utils/zaehlerstandUtils";
import { ZAEHLER_BEZEICHNUNG, ZAEHLER_EINHEIT, ZAEHLER_TYPEN, type ZaehlerTyp } from "@/utils/uebergabeAblauf";

interface UebergabeZusammenfassungProps {
  isEinzug: boolean;
  uebergabeDatum: Date | undefined;
  mieterName?: string;
  schluessel: { haustuer: string; wohnung: string; briefkasten: string; keller: string };
  einheiten: Array<{ id: string; titel: string; zaehlerstaende: Partial<Record<ZaehlerTyp, string>> }>;
  zaehlerfotos: number;
  zustandsfotos: number;
  notizen: string;
}

const SCHLUESSEL_NAMEN = { haustuer: "Haustür", wohnung: "Wohnung", briefkasten: "Briefkasten", keller: "Keller" } as const;

/**
 * Was das Protokoll festhält, auf einen Blick — direkt über den Unterschriften
 * und beim Prüfen. Bis zum 20.10.2026 unterschrieb der Mieter am Ende eines
 * langen Formulars, ohne die erfassten Werte vor sich zu haben.
 */
export const UebergabeZusammenfassung = ({
  isEinzug,
  uebergabeDatum,
  mieterName,
  schluessel,
  einheiten,
  zaehlerfotos,
  zustandsfotos,
  notizen,
}: UebergabeZusammenfassungProps) => {
  const schluesselText = (Object.keys(SCHLUESSEL_NAMEN) as Array<keyof typeof SCHLUESSEL_NAMEN>)
    .filter((k) => schluessel[k].trim() !== "")
    .map((k) => `${SCHLUESSEL_NAMEN[k]} ${schluessel[k].trim()}`)
    .join(" · ");
  const fotos = [
    zaehlerfotos > 0 && `${zaehlerfotos} ${zaehlerfotos === 1 ? "Zählerfoto" : "Zählerfotos"}`,
    zustandsfotos > 0 && `${zustandsfotos} ${zustandsfotos === 1 ? "Zustandsfoto" : "Zustandsfotos"}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">{isEinzug ? "Einzug" : "Auszug"}</dt>
        <dd className="font-medium">{uebergabeDatum ? format(uebergabeDatum, "EEEE, d. MMMM yyyy", { locale: de }) : "kein Datum"}</dd>
        {mieterName && (
          <>
            <dt className="text-muted-foreground">Mieter</dt>
            <dd>{mieterName}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Schlüssel</dt>
        <dd>{schluesselText || "keine angegeben"}</dd>
        {fotos && (
          <>
            <dt className="text-muted-foreground">Fotos</dt>
            <dd>{fotos}</dd>
          </>
        )}
      </dl>

      {einheiten.map((e) => (
        <div key={e.id} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{einheiten.length > 1 ? `Zählerstände · ${e.titel}` : "Zählerstände"}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {ZAEHLER_TYPEN.map((typ) => {
              const wert = e.zaehlerstaende[typ] ?? "";
              const erfasst = parseZaehlerstand(wert) !== null;
              return (
                <div key={typ}>
                  <dt className="text-xs text-muted-foreground">{ZAEHLER_BEZEICHNUNG[typ]}</dt>
                  <dd className="tabular-nums">{erfasst ? `${zaehlerstandText(wert)} ${ZAEHLER_EINHEIT[typ]}` : "–"}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}

      {notizen.trim() && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Zustand</p>
          <p className="line-clamp-4 whitespace-pre-line">{notizen.trim()}</p>
        </div>
      )}
    </div>
  );
};
