/**
 * Finanzierung eines Objekts im Kopf der Objektansicht: eingeklappt eine Zeile mit Restschuld, Rate
 * und Überschuss, aufgeklappt die Rechnung von der Warmmiete bis zum Überschuss, die Darlehen mit
 * Zins und Tilgung und der Zahlungsplan.
 *
 * Überschuss heißt wie in der Mietaufstellung für die Bank: Kaltmiete minus Darlehensrate.
 * Betriebskosten sind durchlaufende Posten und kein Ertrag. Gerechnet wird in
 * utils/darlehenBerechnung.ts, die Mietsummen kommen aus summiereLaufendeMieten.
 */
import { useMemo, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, ChevronDown, Landmark, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDarlehenBuchungen, useObjektDarlehen, type ObjektDarlehen } from "@/hooks/useObjektDarlehen";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import {
  darlehenStand,
  gehoertInZahlungsplan,
  gleicheMitKontoauszugAb,
  summiereDarlehen,
  zahlungsplan,
  type DarlehenStand,
  type DarlehenSumme,
  type KontoauszugRate,
  type PlanStatus,
  type PlanZeitraum,
} from "@/utils/darlehenBerechnung";
import { formatEuro, formatIsoDatum } from "@/utils/zahlungenAnsicht";

interface ObjektFinanzierungProps {
  immobilieId: string;
  /** Summen der laufenden Verträge; null, solange sie laden. */
  kaltmiete: number | null;
  betriebskosten: number | null;
  /** Die Mieten ließen sich nicht laden — dann gibt es keinen Überschuss. */
  mietenFehler?: boolean;
}

interface Zeile {
  darlehen: ObjektDarlehen;
  stand: DarlehenStand;
}

const EURO_GANZ = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EURO_VORZEICHEN = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});
/** Typografisches Minus statt Bindestrich, damit Abzüge und negative Beträge gleich aussehen. */
const mitMinus = (text: string) => text.replace("-", "−");
const euro = (betrag: number) => mitMinus(formatEuro(betrag));
const minus = (betrag: number) => (betrag === 0 ? formatEuro(0) : `−${formatEuro(betrag)}`);
const ZAHL = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ZAHL_GANZ = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const prozent = (p: number) => `${p.toLocaleString("de-DE", { maximumFractionDigits: 4 })} %`;
const monatJahr = (iso: string) => format(parseISO(iso), "MMM yyyy", { locale: de });

/** Anzahl Zeilen des Zahlungsplans, bevor „alle anzeigen" nötig ist. */
const ZEILEN_KURZ = { jahr: 6, monat: 12 } as const;

/** Warum ein Darlehen nicht im Zahlungsplan steht. */
const OHNE_PLAN_GRUND: Partial<Record<PlanStatus, string>> = {
  tilgt: "Laufzeit beendet",
  nur_zins: "endfällig, Laufzeitende fehlt",
  zu_lang: "tilgt zu wenig",
  zins_nicht_gedeckt: "Rate deckt die Zinsen nicht",
  unvollstaendig: "Angaben fehlen",
};

export function ObjektFinanzierung({ immobilieId, kaltmiete, betriebskosten, mietenFehler = false }: ObjektFinanzierungProps) {
  const { isAdmin } = useUserRole();
  const [offen, setOffen] = useState(false);
  const darlehenAbfrage = useObjektDarlehen(immobilieId, isAdmin);
  const buchungenAbfrage = useDarlehenBuchungen(immobilieId, darlehenAbfrage.data);
  const heute = format(new Date(), "yyyy-MM-dd");

  const zeilen = useMemo<Zeile[]>(
    () => (darlehenAbfrage.data ?? []).map((darlehen) => ({ darlehen, stand: darlehenStand(darlehen, heute) })),
    [darlehenAbfrage.data, heute],
  );
  const summe = useMemo(
    () => summiereDarlehen(zeilen.map((z) => ({ stand: z.stand, monatliche_rate: z.darlehen.monatliche_rate }))),
    [zeilen],
  );

  // Darlehen sind nur für admin lesbar (RLS); ohne die Rolle gäbe es hier nur eine leere Zeile.
  if (!isAdmin) return null;

  const ueberschuss = kaltmiete == null ? null : kaltmiete - summe.rate;

  return (
    <Collapsible open={offen} onOpenChange={setOffen} className="rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-2 font-medium">
            <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Finanzierung
          </span>
          {darlehenAbfrage.isLoading ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Darlehen werden geladen …
            </span>
          ) : darlehenAbfrage.isError ? (
            <span className="text-destructive">Darlehen konnten nicht geladen werden.</span>
          ) : (
            <>
              {zeilen.length === 0 ? (
                <span className="text-muted-foreground">kein Darlehen hinterlegt</span>
              ) : (
                <>
                  <Kennzahl
                    label="Restschuld"
                    wert={
                      summe.ohneRestschuld === zeilen.length
                        ? "unbekannt"
                        : `${summe.ohneRestschuld > 0 ? "mind. " : ""}${EURO_GANZ.format(summe.restschuld)}`
                    }
                  />
                  <Kennzahl label="Rate" wert={EURO_GANZ.format(summe.rate)} zusatz="im Monat" />
                </>
              )}
              <Kennzahl
                label="Überschuss"
                wert={mietenFehler ? "–" : ueberschuss == null ? "…" : mitMinus(EURO_VORZEICHEN.format(ueberschuss))}
                zusatz="im Monat"
                ton={ueberschuss == null ? undefined : ueberschuss < 0 ? "negativ" : "positiv"}
              />
            </>
          )}
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs">
            {offen ? "Weniger" : "Details"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", offen && "rotate-180")} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="space-y-5 border-t px-3 py-3">
          {darlehenAbfrage.isError ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              Die Darlehen des Objekts konnten nicht geladen werden.
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => darlehenAbfrage.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          ) : darlehenAbfrage.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Darlehen werden geladen …
            </div>
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <Ertragsrechnung
                  kaltmiete={kaltmiete}
                  betriebskosten={betriebskosten}
                  mietenFehler={mietenFehler}
                  summe={summe}
                  hatDarlehen={zeilen.length > 0}
                />
                <DarlehenListe
                  zeilen={zeilen}
                  buchungen={buchungenAbfrage.data}
                  buchungenFehler={buchungenAbfrage.isError}
                />
              </div>
              {zeilen.length > 0 && <Zahlungsplan zeilen={zeilen} />}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Kennzahl({
  label,
  wert,
  zusatz,
  ton,
}: {
  label: string;
  wert: string;
  zusatz?: string;
  ton?: "positiv" | "negativ";
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span
        className={cn(
          "font-semibold tabular-nums text-foreground",
          ton === "positiv" && "text-success",
          ton === "negativ" && "text-destructive",
        )}
      >
        {wert}
      </span>
      {zusatz && <span className="text-muted-foreground"> {zusatz}</span>}
    </span>
  );
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titel}</h4>
      {children}
    </section>
  );
}

function Posten({
  label,
  wert,
  hinweis,
  art = "normal",
}: {
  label: string;
  wert: string;
  hinweis?: string;
  art?: "normal" | "leise" | "summe-positiv" | "summe-negativ";
}) {
  const summe = art === "summe-positiv" || art === "summe-negativ";
  return (
    <div className={cn("flex items-baseline justify-between gap-3", summe && "mt-1 border-t pt-1.5")}>
      <dt className={cn(art === "leise" ? "text-muted-foreground" : "text-foreground", summe && "font-semibold")}>
        {label}
        {hinweis && <span className="text-xs text-muted-foreground"> · {hinweis}</span>}
      </dt>
      <dd
        className={cn(
          "tabular-nums",
          art === "leise" && "text-muted-foreground",
          summe && "font-semibold",
          art === "summe-positiv" && "text-success",
          art === "summe-negativ" && "text-destructive",
        )}
      >
        {wert}
      </dd>
    </div>
  );
}

function Ertragsrechnung({
  kaltmiete,
  betriebskosten,
  mietenFehler,
  summe,
  hatDarlehen,
}: {
  kaltmiete: number | null;
  betriebskosten: number | null;
  mietenFehler: boolean;
  summe: DarlehenSumme;
  hatDarlehen: boolean;
}) {
  if (mietenFehler) {
    return (
      <Abschnitt titel="Im Monat">
        <p className="text-sm text-destructive">Die Mieten konnten nicht geladen werden — ohne sie kein Überschuss.</p>
      </Abschnitt>
    );
  }
  if (kaltmiete == null || betriebskosten == null) {
    return (
      <Abschnitt titel="Im Monat">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Mieten werden geladen …
        </p>
      </Abschnitt>
    );
  }
  const ueberschuss = kaltmiete - summe.rate;
  const aufgeteilt = hatDarlehen && summe.rate > summe.ohneAufteilung;
  return (
    <Abschnitt titel="Im Monat">
      <dl className="space-y-1 text-sm">
        <Posten label="Warmmiete" wert={formatEuro(kaltmiete + betriebskosten)} />
        <Posten label="Betriebskosten" hinweis="laufen durch" wert={minus(betriebskosten)} art="leise" />
        <Posten label="Kaltmiete" wert={formatEuro(kaltmiete)} />
        {aufgeteilt && (
          <>
            <Posten label="Zinsen" wert={minus(summe.zins)} />
            <Posten label="Tilgung" wert={minus(summe.tilgung)} />
          </>
        )}
        {summe.ohneAufteilung > 0 && (
          <Posten label={aufgeteilt ? "Rate ohne Aufteilung" : "Darlehensrate"} wert={minus(summe.ohneAufteilung)} />
        )}
        <Posten
          label="Überschuss"
          wert={euro(ueberschuss)}
          art={ueberschuss < 0 ? "summe-negativ" : "summe-positiv"}
        />
        <Posten label="im Jahr" wert={euro(ueberschuss * 12)} art="leise" />
        {hatDarlehen && summe.tilgung > 0 && (
          <Posten label="nach Zinsen" hinweis="Tilgung baut Vermögen auf" wert={euro(ueberschuss + summe.tilgung)} art="leise" />
        )}
      </dl>
    </Abschnitt>
  );
}

function DarlehenListe({
  zeilen,
  buchungen,
  buchungenFehler,
}: {
  zeilen: Zeile[];
  buchungen: Map<string, KontoauszugRate[]> | undefined;
  buchungenFehler: boolean;
}) {
  return (
    <Abschnitt titel={zeilen.length === 1 ? "Darlehen" : `Darlehen (${zeilen.length})`}>
      {zeilen.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Diesem Objekt ist kein Darlehen zugeordnet. Darlehen werden in der Darlehensverwaltung angelegt und dort
          einem Objekt zugeordnet.
        </p>
      ) : (
        <ul className="divide-y">
          {zeilen.map((z) => (
            <DarlehenEintrag
              key={z.darlehen.id}
              zeile={z}
              buchungen={buchungen?.get(z.darlehen.id)}
              buchungenFehler={buchungenFehler}
            />
          ))}
        </ul>
      )}
    </Abschnitt>
  );
}

function DarlehenEintrag({
  zeile: { darlehen: d, stand },
  buchungen,
  buchungenFehler,
}: {
  zeile: Zeile;
  buchungen: KontoauszugRate[] | undefined;
  buchungenFehler: boolean;
}) {
  const kopf = [
    d.bank,
    d.zinssatz_prozent != null ? prozent(d.zinssatz_prozent) : null,
    d.monatliche_rate ? `Rate ${formatEuro(d.monatliche_rate)}` : null,
    d.darlehensbetrag ? `Darlehen ${formatEuro(d.darlehensbetrag)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium">{d.bezeichnung}</p>
        <p className="text-sm font-semibold tabular-nums">
          {stand.restschuld != null ? formatEuro(stand.restschuld) : "–"}
          <span className="text-xs font-normal text-muted-foreground"> offen</span>
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{kopf}</p>
      <StandText stand={stand} ende={d.ende_datum} />
      {d.auchObjekte.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Gemeinsam mit {d.auchObjekte.join(", ")} — die volle Rate ist hier eingerechnet.
        </p>
      )}
      {stand.ohneStichtag && (
        <p className="text-xs text-muted-foreground">Restschuld ohne Stichtag hinterlegt — als heutiger Stand gerechnet.</p>
      )}
      <AbgleichText stand={stand} buchungen={buchungen} fehler={buchungenFehler} />
    </li>
  );
}

function Hinweis({ ton, children }: { ton: "ok" | "warnung"; children: ReactNode }) {
  const Icon = ton === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", ton === "ok" ? "text-success" : "text-warning")}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function StandText({ stand, ende }: { stand: DarlehenStand; ende: string | null }) {
  const n = stand.naechsteRate;
  if (stand.laufzeitAbgelaufen && ende) {
    return (
      <Hinweis ton="warnung">
        Laufzeitende {formatIsoDatum(ende)} erreicht, {euro(stand.restschuldAmLaufzeitende ?? 0)} waren offen. Die
        hinterlegte Rate ist weiter eingerechnet — Anschlussfinanzierung in der Darlehensverwaltung eintragen.
      </Hinweis>
    );
  }
  switch (stand.status) {
    case "getilgt":
      return <Hinweis ton="ok">Getilgt{stand.getilgtAm ? ` seit ${monatJahr(stand.getilgtAm)}` : ""}.</Hinweis>;
    case "nur_zins":
      return (
        <p className="text-xs text-muted-foreground">
          Endfällig: Die Rate ist reiner Zins, die Restschuld bleibt bis zum Laufzeitende stehen
          {ende ? ` (${formatIsoDatum(ende)}).` : " — das Laufzeitende ist nicht hinterlegt."}
        </p>
      );
    case "zu_lang":
      return <Hinweis ton="warnung">Die Rate tilgt so wenig, dass das Darlehen in 50 Jahren nicht abbezahlt ist. Zinssatz und Rate prüfen.</Hinweis>;
    case "zins_nicht_gedeckt":
      return <Hinweis ton="warnung">Die Rate deckt die Zinsen nicht. Zinssatz und Rate in der Darlehensverwaltung prüfen.</Hinweis>;
    case "unvollstaendig":
      return <Hinweis ton="warnung">Zinssatz, Rate oder Restschuld fehlen — in der Darlehensverwaltung ergänzen.</Hinweis>;
    default:
      return (
        <>
          {n && (
            <p className="text-xs text-muted-foreground">
              Rate am {formatIsoDatum(n.faellig)}: <span className="tabular-nums">{formatEuro(n.zins)}</span> Zins ·{" "}
              <span className="tabular-nums">{formatEuro(n.tilgung)}</span> Tilgung
            </p>
          )}
          {stand.getilgtAm && (
            <p className="text-xs text-muted-foreground">Schuldenfrei voraussichtlich {monatJahr(stand.getilgtAm)}</p>
          )}
          {stand.restschuldAmLaufzeitende != null && ende && (
            <p className="text-xs text-muted-foreground">
              Am Laufzeitende ({formatIsoDatum(ende)}) noch offen:{" "}
              <span className="tabular-nums">{formatEuro(stand.restschuldAmLaufzeitende)}</span>
            </p>
          )}
        </>
      );
  }
}

function AbgleichText({
  stand,
  buchungen,
  fehler,
}: {
  stand: DarlehenStand;
  buchungen: KontoauszugRate[] | undefined;
  fehler: boolean;
}) {
  if (fehler) return <p className="text-xs text-muted-foreground">Abgleich mit dem Kontoauszug nicht möglich.</p>;
  if (!buchungen) return null;
  const abgleich = gleicheMitKontoauszugAb(stand, buchungen);
  if (abgleich.geprueft === 0) return null;
  if (!abgleich.abweichung) {
    const faellig = stand.faelligeRaten.length;
    const seit = monatJahr(stand.faelligeRaten[0].faellig);
    const ohneBuchung = faellig - abgleich.geprueft;
    return (
      <Hinweis ton="ok">
        {ohneBuchung === 0
          ? `Kontoauszug bestätigt ${faellig === 1 ? "die Rate" : `alle ${faellig} Raten`} seit ${seit}`
          : `Kontoauszug bestätigt ${abgleich.geprueft} von ${faellig} Raten seit ${seit} — für ${
              ohneBuchung === 1 ? "eine Rate" : `${ohneBuchung} Raten`
            } liegt keine Buchung vor`}
      </Hinweis>
    );
  }
  const { buchung, plan } = abgleich.abweichung;
  const aufteilung = (zins: number | null, tilgung: number | null) =>
    zins != null && tilgung != null ? ` (${formatEuro(zins)} Zins, ${formatEuro(tilgung)} Tilgung)` : "";
  return (
    <Hinweis ton="warnung">
      Kontoauszug {monatJahr(plan.faellig)}: {formatEuro(buchung.rate)}
      {aufteilung(buchung.zins, buchung.tilgung)}, gerechnet {formatEuro(plan.rate)}
      {aufteilung(plan.zins, plan.tilgung)}. Zinssatz, Rate oder Restschuld in der Darlehensverwaltung anpassen.
    </Hinweis>
  );
}

const ZELLE = "whitespace-nowrap px-1.5 py-1.5 sm:px-3";

/** Auf dem Handy volle Euro, sonst passen die vier Spalten nicht nebeneinander. */
function Betrag({ wert, className }: { wert: number; className?: string }) {
  return (
    <TableCell className={cn(ZELLE, "text-right tabular-nums", className)}>
      <span className="sm:hidden">{mitMinus(ZAHL_GANZ.format(wert))}</span>
      <span className="hidden sm:inline">{mitMinus(ZAHL.format(wert))}</span>
    </TableCell>
  );
}

function zeitraumText(z: PlanZeitraum, je: "jahr" | "monat"): string {
  if (je === "monat" || z.von === z.bis) return monatJahr(z.von);
  if (z.von.slice(5, 7) === "01" && z.bis.slice(5, 7) === "12") return z.schluessel;
  const monat = (iso: string) => format(parseISO(iso), "MMM", { locale: de });
  return `${monat(z.von)}–${monat(z.bis)} ${z.schluessel}`;
}

function Zahlungsplan({ zeilen }: { zeilen: Zeile[] }) {
  const [je, setJe] = useState<"jahr" | "monat">("jahr");
  const [alle, setAlle] = useState(false);
  const plan = useMemo(() => zahlungsplan(zeilen.map((z) => z.stand), je), [zeilen, je]);
  const ohnePlan = zeilen.filter((z) => !gehoertInZahlungsplan(z.stand) && z.stand.status !== "getilgt");
  const gesamt = useMemo(
    () =>
      plan.reduce(
        (s, z) => ({ rate: s.rate + z.rate, zins: s.zins + z.zins, tilgung: s.tilgung + z.tilgung }),
        { rate: 0, zins: 0, tilgung: 0 },
      ),
    [plan],
  );
  const kurz = ZEILEN_KURZ[je];
  const sichtbar = alle ? plan : plan.slice(0, kurz);
  const letzte = plan[plan.length - 1];
  const einheit = je === "jahr" ? "Jahre" : "Monate";
  const fehlen = ohnePlan
    .map((z) => {
      const grund = z.stand.laufzeitAbgelaufen ? "Laufzeit beendet" : OHNE_PLAN_GRUND[z.stand.status] ?? "kein Ende absehbar";
      return `${z.darlehen.bezeichnung} (${grund})`;
    })
    .join(", ");

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Zahlungsplan
          {letzte?.restschuld === 0 && ohnePlan.length === 0 && (
            <span className="ml-2 font-normal normal-case tracking-normal">
              · schuldenfrei {monatJahr(letzte.bis)}
            </span>
          )}
        </h4>
        {plan.length > 0 && (
          <ToggleGroup
            type="single"
            value={je}
            onValueChange={(v) => {
              if (!v) return;
              setJe(v as "jahr" | "monat");
              setAlle(false);
            }}
            aria-label="Zahlungsplan zusammenfassen"
            className="h-7 gap-0 overflow-hidden rounded-md border border-input bg-background"
          >
            {(["jahr", "monat"] as const).map((wert) => (
              <ToggleGroupItem
                key={wert}
                value={wert}
                className="h-full rounded-none border-r px-2.5 text-xs last:border-r-0 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
              >
                {wert === "jahr" ? "Jahre" : "Monate"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {plan.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {ohnePlan.length > 0 ? `Kein Zahlungsplan: ${fehlen}.` : "Alle Darlehen sind getilgt."}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border bg-background">
            <Table className="text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(ZELLE, "h-8")}>{je === "jahr" ? "Jahr" : "Monat"}</TableHead>
                  <TableHead className={cn(ZELLE, "hidden h-8 text-right sm:table-cell")}>{je === "jahr" ? "Raten" : "Rate"}</TableHead>
                  <TableHead className={cn(ZELLE, "h-8 text-right")}>Zinsen</TableHead>
                  <TableHead className={cn(ZELLE, "h-8 text-right")}>Tilgung</TableHead>
                  <TableHead className={cn(ZELLE, "h-8 text-right")}>Restschuld</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sichtbar.map((z) => (
                  <TableRow key={z.schluessel}>
                    <TableCell className={ZELLE}>{zeitraumText(z, je)}</TableCell>
                    <Betrag wert={z.rate} className="hidden sm:table-cell" />
                    <Betrag wert={z.zins} />
                    <Betrag wert={z.tilgung} />
                    <Betrag wert={z.restschuld} className="font-medium" />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className={ZELLE}>
                    Gesamt{!alle && plan.length > kurz && <span className="font-normal text-muted-foreground"> ({plan.length} {einheit})</span>}
                  </TableCell>
                  <Betrag wert={gesamt.rate} className="hidden sm:table-cell" />
                  <Betrag wert={gesamt.zins} />
                  <Betrag wert={gesamt.tilgung} />
                  <TableCell className={ZELLE} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Beträge in Euro, Raten jeweils zum Monatsende, bei gleichbleibendem Zinssatz.
              {ohnePlan.length > 0 && ` Nicht enthalten: ${fehlen}.`}
            </p>
            {plan.length > kurz && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAlle((a) => !a)}>
                {alle ? "Weniger anzeigen" : `Alle ${plan.length} ${einheit} anzeigen`}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
