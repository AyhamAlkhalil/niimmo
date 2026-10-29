import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatEuroKompakt } from "@/utils/betragAnzeige";
import { vertragsLink } from "@/utils/vertragsLink";
import { anzahlMieter } from "@/utils/offeneMieten";
import type { OffeneMiete } from "@/hooks/useRueckstaende";

/** So viele Zeilen stehen ohne „Alle anzeigen“ da */
export const OFFENE_MIETEN_SICHTBAR = 6;

interface OffeneMietenListeProps {
  eintraege: OffeneMiete[];
  /** Monatsname, z. B. „Oktober“ */
  monat: string;
  /** Rückstände aus früheren Monaten (monatsSaldo.aelter) */
  aelter: number;
  vertraegeAelter: number;
  onRueckstaendeZeigen?: () => void;
}

/**
 * „Noch offen“ als Arbeitsliste (29.10.2026, Kundenwunsch): Wer die Miete des Monats noch nicht bezahlt hat.
 * Jede Zeile öffnet den Vertrag in einem neuen Tab, damit die Startseite stehen bleibt.
 */
export const OffeneMietenListe = ({ eintraege, monat, aelter, vertraegeAelter, onRueckstaendeZeigen }: OffeneMietenListeProps) => {
  const [alleZeigen, setAlleZeigen] = useState(false);
  const euro = formatEuroKompakt;
  const anzahl = eintraege.length;
  const mieter = anzahlMieter(eintraege);
  const sichtbar = alleZeigen ? eintraege : eintraege.slice(0, OFFENE_MIETEN_SICHTBAR);

  return (
    <section aria-labelledby="offene-mieten-titel" className="mt-8">
      <h2 id="offene-mieten-titel" className="text-base text-foreground">
        {anzahl === 0 ? (
          <>Alle Mieter haben die {monat}miete bezahlt.</>
        ) : (
          <>
            <span className="font-medium">{mieter} Mieter</span> {mieter === 1 ? 'hat' : 'haben'} die {monat}miete noch nicht bezahlt:
          </>
        )}
      </h2>

      {anzahl > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {sichtbar.map((e) => {
            const wo = [e.immobilie_name, e.einheit, e.teilweise_bezahlt ? 'teilweise bezahlt' : ''].filter(Boolean).join(' · ');
            // Feste Betragsspalte: Mit `auto` verschob ein längerer Betrag die Objektspalte je Zeile (Sichtprüfung)
            return (
              <li key={e.mietvertrag_id}>
                <a
                  href={vertragsLink(e.mietvertrag_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-2 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_1rem]"
                >
                  <span title={e.mieter_name} className="min-w-0 break-words font-medium text-foreground sm:truncate">{e.mieter_name}</span>
                  <span className="whitespace-nowrap text-right tabular-nums text-brand sm:order-3">{euro(e.offen)} offen</span>
                  <span title={wo} className="col-span-2 min-w-0 break-words text-sm text-muted-foreground sm:order-2 sm:col-span-1 sm:truncate">
                    {wo}
                  </span>
                  <ExternalLink
                    aria-hidden="true"
                    className="hidden h-3.5 w-3.5 self-center text-muted-foreground transition-colors group-hover:text-foreground sm:order-4 sm:block"
                  />
                  <span className="sr-only">(öffnet den Vertrag in einem neuen Tab)</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {anzahl > OFFENE_MIETEN_SICHTBAR && (
        <button
          type="button"
          onClick={() => setAlleZeigen(!alleZeigen)}
          aria-expanded={alleZeigen}
          className="mt-2 text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand"
        >
          {alleZeigen ? 'Weniger anzeigen' : `Alle ${anzahl} anzeigen`}
        </button>
      )}

      {aelter > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Dazu {euro(aelter)} Rückstände aus früheren Monaten ({vertraegeAelter} Mieter).{' '}
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
      )}
    </section>
  );
};
