/**
 * Gutschriften der Versorger in der Betriebskostenabrechnung.
 *
 * Bis zum 28.10.2026 kannte die Abrechnung nur Ausgaben: Schritt 1 lud nur
 * negative Buchungen, und Schritt 2 und 3 verwarfen jede einzelne Position mit
 * Betrag <= 0. Eine Erstattung des Abwasserverbands (Eingang, Kategorie
 * Nebenkosten, am Objekt) ließ sich so keiner Kostenart zuordnen, umgelegt
 * wurden die vollen Abschläge. Live lagen 9 solche Gutschriften vor, 6 davon
 * (578,06 €) in Objekten mit Kostenpositionen.
 *
 * Vorzeichen wie im Bestand (98 von 98 Positionen am 28.10.2026 geprüft): Eine
 * Kostenposition trägt den Betrag der Bankbuchung mit umgekehrtem Vorzeichen.
 * Ausgaben (Buchung negativ) stehen als positive Kosten, Gutschriften (Buchung
 * positiv) als negative Kosten. Ob umgelegt wird, entscheidet die Summe je
 * Kostenart, nicht die einzelne Position.
 */
import { aufCent } from "./nebenkostenAufteilung";

/**
 * Zahlungskategorien, die nie Betriebskosten sind. Ohne diesen Filter standen
 * Mieteingänge in der Zuordnungsliste und konnten als Kosten gebucht werden.
 */
export const NICHT_ZUORDENBARE_KATEGORIEN = ["Miete", "Mietkaution", "Ignorieren", "Rücklastschrift"];

export interface ZahlungFuerZuordnung {
  betrag: number;
  kategorie: string | null;
}

/**
 * Eingang, der Betriebskosten mindert. Nur die Kategorie Nebenkosten zählt: Ein
 * Eingang unter Nichtmiete oder Betriebskostenabrechnung ist Geld vom Mieter
 * oder etwas anderes, aber keine Erstattung eines Versorgers.
 */
export function istGutschrift(zahlung: ZahlungFuerZuordnung): boolean {
  return zahlung.betrag > 0 && zahlung.kategorie === "Nebenkosten";
}

/** Darf diese Buchung in Schritt 1 einer Kostenart zugeordnet werden? */
export function istZuordenbareZahlung(zahlung: ZahlungFuerZuordnung): boolean {
  if (zahlung.betrag < 0) {
    return !zahlung.kategorie || !NICHT_ZUORDENBARE_KATEGORIEN.includes(zahlung.kategorie);
  }
  return istGutschrift(zahlung);
}

/** Betrag der Kostenposition zu einer Buchung: Ausgabe positiv, Gutschrift negativ. */
export function kostenbetragAusZahlung(zahlungBetrag: number): number {
  return aufCent(-zahlungBetrag) + 0; // + 0 macht aus -0 eine 0
}

/**
 * Noch nicht auf Kostenpositionen verteilter Rest einer Buchung, im Vorzeichen
 * der Kostenposition (bei einer Gutschrift also negativ).
 */
export function offenerKostenbetrag(zahlungBetrag: number, verteilt: number): number {
  return aufCent(kostenbetragAusZahlung(zahlungBetrag) - verteilt) + 0;
}

/**
 * Ist von der Buchung noch etwas zu verteilen? Gerechnet wird in Cent und, wie
 * bisher, mit einem Cent Spielraum. Der frühere Vergleich `verteilt < |betrag|`
 * hielt eine voll zugeordnete Gutschrift (verteilt negativ) für immer offen.
 */
export function istNochOffen(zahlungBetrag: number, verteilt: number): boolean {
  const soll = kostenbetragAusZahlung(zahlungBetrag);
  const restCent = Math.round((soll - verteilt) * 100);
  return Math.sign(soll) * restCent > 1;
}

/**
 * Trennt die Summen je Kostenart: Nur eine positive Summe wird umgelegt. Eine
 * negative Summe (Gutschriften übersteigen die Kosten der Art im Zeitraum) wird
 * nicht umgelegt, sondern gesondert zurückgegeben, damit die Oberfläche sie
 * zeigen kann. Eine Summe von genau null fällt still heraus.
 */
export function trenneKostenartenNachSumme<T extends { total: number }>(
  eintraege: Iterable<T>
): { umzulegen: T[]; negativ: T[] } {
  const umzulegen: T[] = [];
  const negativ: T[] = [];
  for (const eintrag of eintraege) {
    const cent = Math.round(eintrag.total * 100);
    if (cent > 0) umzulegen.push(eintrag);
    else if (cent < 0) negativ.push(eintrag);
  }
  return { umzulegen, negativ };
}

/**
 * Summe, die tatsächlich umgelegt wird: je Kostenart netto, nur Arten mit positiver
 * Summe, Positionen ohne Kostenart nicht — dieselbe Regel wie Schritt 2 und 3. Die
 * Übersicht (BetrKVNebenkostenTab) summierte bis zum 28.10.2026 alle Positionen netto
 * und zeigte bei einer Kostenart mit überwiegender Gutschrift eine kleinere Summe als
 * die Abrechnung (Review 28.10.2026).
 */
export function summeUmzulegenderKostenarten<T>(
  positionen: readonly T[],
  betragVon: (position: T) => number,
  kostenartVon: (position: T) => string | null
): number {
  const jeArt = new Map<string, number>();
  for (const position of positionen) {
    const art = kostenartVon(position);
    if (!art) continue;
    jeArt.set(art, (jeArt.get(art) ?? 0) + betragVon(position));
  }
  const { umzulegen } = trenneKostenartenNachSumme([...jeArt.values()].map((total) => ({ total })));
  return umzulegen.reduce((summe, k) => summe + k.total, 0);
}
