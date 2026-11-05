/**
 * Verteilerschlüssel je Kostenart am Objekt (seit 04.11.2026).
 *
 * Kundenwunsch: „bei jeder Nebenkostenart selbst entscheiden können, wie die
 * Verteilerschlüssel sind“ — einmal am Objekt festgelegt, in jedem neuen
 * Mietvertrag nur zur Kontrolle angezeigt (Video vom 03.11.2026: „fix pro
 * Objekt … in den Stammdaten des Objektes“). Gespeichert wird an der
 * Nebenkostenart des Objekts (`nebenkostenarten.verteilerschluessel_art`),
 * denselben Wert nimmt die Betriebskostenabrechnung. So gibt es nur eine
 * Wahrheit. Fehlt die Kostenart am Objekt noch, gilt die Kundenvorgabe aus
 * `BETRKV_KATEGORIEN`, bis jemand hier etwas anderes wählt.
 */
import {
  BETRKV_KATEGORIEN,
  findeKategorieNachName,
  type NebenkostenKategorie,
} from '@/components/dashboard/nebenkosten/nebenkostenKategorien';
import { BETRKV_STANDARD, schluesselDesObjekts } from './datenAusDb';

export interface Nebenkostenart {
  id: string;
  name: string;
  verteilerschluessel_art: string | null;
  ist_umlagefaehig: boolean | null;
}

export interface SchluesselZeile {
  kategorie: NebenkostenKategorie;
  /** Schlüssel, den Abrechnung und Vertrag jetzt verwenden */
  schluessel: string;
  /** true: am Objekt festgelegt; false: Kundenvorgabe, weil die Kostenart dort noch nicht gepflegt ist */
  gepflegt: boolean;
  /** Nebenkostenarten des Objekts, die zu dieser Kostenart gehören */
  artIds: string[];
  /** Positionen im Mietvertrag, die diesen Schlüssel tragen („2.12, 2.18“) */
  vertragsPositionen: string[];
}

export function schluesselJeKategorie(arten: readonly Nebenkostenart[]): SchluesselZeile[] {
  return BETRKV_KATEGORIEN.map(kategorie => {
    const zugehoerig = arten.filter(a => findeKategorieNachName(a.name)?.id === kategorie.id);
    return {
      kategorie,
      schluessel: schluesselDesObjekts([...arten], kategorie.id),
      gepflegt: zugehoerig.some(a => a.ist_umlagefaehig !== false && !!a.verteilerschluessel_art),
      artIds: zugehoerig.map(a => a.id),
      vertragsPositionen: BETRKV_STANDARD.filter(p => p.kategorie === kategorie.id).map(p => p.nummer),
    };
  });
}

/** Nur was sich gegenüber dem angezeigten Stand geändert hat, wird geschrieben. */
export function geaenderteSchluessel(
  zeilen: readonly SchluesselZeile[],
  auswahl: Readonly<Record<string, string>>
): { zeile: SchluesselZeile; schluessel: string }[] {
  return zeilen
    .filter(z => auswahl[z.kategorie.id] && auswahl[z.kategorie.id] !== z.schluessel)
    .map(z => ({ zeile: z, schluessel: auswahl[z.kategorie.id] }));
}
