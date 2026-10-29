import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { vertragsLink } from "@/utils/vertragsLink";
import { nachMieter, type OffenerMieter } from "@/utils/offeneMieten";
import type { OffeneMiete } from "@/hooks/useRueckstaende";

interface OffeneMietenListeProps {
  eintraege: OffeneMiete[];
  /** Monatsname, z. B. „Oktober“ */
  monat: string;
  /** Rückstände aus früheren Monaten (monatsSaldo.aelter) */
  aelter: number;
  onRueckstaendeZeigen?: () => void;
}

const euro = formatEuroKompakt;
const NEUER_TAB = "öffnet den Vertrag in einem neuen Tab";
// Feste Betragsspalte: Mit `auto` verschob ein längerer Betrag die Objektspalte je Zeile (Sichtprüfung)
const ZEILE = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_1rem]";
// ring-inset: CollapsibleContent schneidet mit overflow-hidden einen äußeren Fokusrahmen ab (Review)
const LINK = "group transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const ortText = (v: OffeneMiete) => [v.immobilie_name, v.einheit, v.teilweise_bezahlt ? "teilweise bezahlt" : ""].filter(Boolean).join(" · ");

const Pfeil = () => (
  <ExternalLink
    aria-hidden="true"
    className="hidden h-3.5 w-3.5 self-center text-muted-foreground transition-colors group-hover:text-foreground sm:order-4 sm:block"
  />
);

/** Ein Mieter, ein Vertrag: Die ganze Zeile öffnet den Vertrag */
const EinVertrag = ({ mieter }: { mieter: OffenerMieter }) => {
  const v = mieter.vertraege[0];
  const wo = ortText(v);
  return (
    <a href={vertragsLink(v.mietvertrag_id)} target="_blank" rel="noopener noreferrer" className={cn(ZEILE, LINK, "py-2.5")}>
      <span title={mieter.mieter_name} className="min-w-0 break-words font-medium text-foreground sm:truncate">{mieter.mieter_name}</span>
      <span className="whitespace-nowrap text-right tabular-nums text-brand sm:order-3">{euro(mieter.offen)} offen</span>
      <span title={wo} className="col-span-2 min-w-0 break-words text-sm text-muted-foreground sm:order-2 sm:col-span-1 sm:truncate">
        {wo}
      </span>
      <Pfeil />
      <span className="sr-only">({NEUER_TAB})</span>
    </a>
  );
};

/** Ein Mieter, mehrere Verträge (Wohnung und Garage): Name und Summe oben, darunter jeder Vertrag für sich */
const MehrereVertraege = ({ mieter }: { mieter: OffenerMieter }) => (
  <div className="py-2.5">
    <div className={ZEILE}>
      <span title={mieter.mieter_name} className="min-w-0 break-words font-medium text-foreground sm:truncate">{mieter.mieter_name}</span>
      {/* Füllt am Desktop die Objektspalte, sonst klafft dort eine Lücke über den Verträgen (Sichtprüfung) */}
      <span className="hidden text-sm text-muted-foreground sm:block">{mieter.vertraege.length} Verträge</span>
      <span className="whitespace-nowrap text-right tabular-nums text-brand sm:col-start-3">{euro(mieter.offen)} offen</span>
    </div>
    <ul className="mt-0.5">
      {mieter.vertraege.map((v) => {
        // Hat der Vertrag andere Mieter als die Zeile nennt, stehen sie dabei — sonst fehlte z. B. „Dora“ (Gegenprüfung)
        const wo = [ortText(v), v.mieter_name !== mieter.mieter_name ? v.mieter_name : ""].filter(Boolean).join(" · ");
        return (
          <li key={v.mietvertrag_id}>
            <a href={vertragsLink(v.mietvertrag_id)} target="_blank" rel="noopener noreferrer" className={cn(ZEILE, LINK, "py-1 text-sm")}>
              <span aria-hidden="true" className="hidden sm:block" />
              <span title={wo} className="min-w-0 break-words pl-3 text-muted-foreground sm:truncate sm:pl-0">{wo}</span>
              <span className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{euro(v.offen)}</span>
              <Pfeil />
              <span className="sr-only">({v.mieter_name}, {NEUER_TAB})</span>
            </a>
          </li>
        );
      })}
    </ul>
  </div>
);

/** Die aufgeklappte Liste: je Mieter eine Zeile, größter Betrag zuerst */
export const OffeneMietenZeilen = ({ mieter }: { mieter: OffenerMieter[] }) => (
  <ul className="divide-y divide-border border-t border-border">
    {mieter.map((m) => (
      <li key={m.schluessel}>{m.vertraege.length === 1 ? <EinVertrag mieter={m} /> : <MehrereVertraege mieter={m} />}</li>
    ))}
  </ul>
);

/**
 * „Noch offen“ als Arbeitsliste (29.10.2026, Kundenwunsch): Wer die Miete des Monats noch nicht bezahlt hat.
 * Zugeklappt steht nur der Satz; die Liste öffnet erst ein Klick (Kundenmeldung: „nicht immer offen“). Jede Zeile
 * öffnet den Vertrag in einem neuen Tab, damit die Startseite stehen bleibt.
 */
export const OffeneMietenListe = ({ eintraege, monat, aelter, onRueckstaendeZeigen }: OffeneMietenListeProps) => {
  const [offen, setOffen] = useState(false);
  const mieter = nachMieter(eintraege);
  // Ohne Anzahl: Sie zählte Verträge und hieß „Mieter“ — dieselbe Verwechslung wie 28 zu 29 (29.10.2026)
  const aelterZeile = aelter > 0 && (
    <p className="mt-3 px-2 text-sm text-muted-foreground">
      Dazu {euro(aelter)} Rückstände aus früheren Monaten.{" "}
      {onRueckstaendeZeigen && (
        <button
          type="button"
          onClick={onRueckstaendeZeigen}
          className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand"
        >
          Zu den Rückständen
        </button>
      )}
    </p>
  );

  if (mieter.length === 0) {
    return (
      <section aria-labelledby="offene-mieten-titel" className="mt-8">
        <h2 id="offene-mieten-titel" className="px-2 text-base text-foreground">
          Alle Mieter haben die {monat}miete bezahlt.
        </h2>
        {aelterZeile}
      </section>
    );
  }

  return (
    <section aria-labelledby="offene-mieten-titel" className="mt-8 border-y border-border">
      <Collapsible open={offen} onOpenChange={setOffen}>
        <h2 className="text-base text-foreground">
          <CollapsibleTrigger className="group/kopf flex w-full items-center justify-between gap-4 px-2 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span id="offene-mieten-titel">
              <span className="font-medium">{mieter.length} Mieter</span> {mieter.length === 1 ? "hat" : "haben"} die {monat}miete noch nicht bezahlt
            </span>
            {/* Das Wort gehört zum Namen des Knopfs, damit „Anzeigen klicken“ per Sprache greift (WCAG 2.5.3) */}
            <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors group-hover/kopf:text-foreground">
              {offen ? "Zuklappen" : "Anzeigen"}
              <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", offen && "rotate-180")} />
            </span>
          </CollapsibleTrigger>
        </h2>
        {/* text-base: Die Vorlage setzt text-sm, Name und Betrag wären so klein wie die Ortszeile (Gegenprüfung) */}
        <CollapsibleContent className="text-base data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <OffeneMietenZeilen mieter={mieter} />
        </CollapsibleContent>
      </Collapsible>
      {/* Auch zugeklappt sichtbar, wie bei „Alle Mieter haben bezahlt“ (Review) */}
      {aelterZeile && <div className="border-t border-border pb-3">{aelterZeile}</div>}
    </section>
  );
};
