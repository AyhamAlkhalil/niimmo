/**
 * Aufteilen einer Nebenkosten-Kategorie auf eine zweite Kategorie.
 *
 * Hintergrund (Kundenmeldung 10.09.2026): Abschläge an den Wasserverband laufen
 * über das Jahr gebündelt in "2.2 Wasserversorgung". Erst die Endabrechnung im
 * Folgejahr sagt, welcher Teil davon Entwässerung war. Bis dahin soll gebucht
 * werden dürfen, danach wird der Anteil in einem Zug herausgelöst.
 *
 * Aufgeteilt wird anteilig über alle Positionen der Kategorie, damit der Bezug
 * jeder Kostenposition zu ihrer Bankbewegung erhalten bleibt. Gerechnet wird in
 * Cent: die Summe der verschobenen Beträge trifft den Zielbetrag exakt, keine
 * Position verliert mehr, als sie trägt.
 */

export interface AufteilbarePosition {
  id: string;
  gesamtbetrag: number;
}

export interface Aufteilungszeile {
  positionId: string;
  /** Betrag der Position vor der Aufteilung. */
  vorher: number;
  /** Betrag, der in die Zielkategorie wandert. */
  verschoben: number;
  /** Betrag, der in der Ausgangskategorie verbleibt. */
  rest: number;
}

/** Rundet kaufmännisch auf Cent. */
export function aufCent(betrag: number): number {
  return Math.round(betrag * 100) / 100;
}

export function summePositionen(positionen: readonly AufteilbarePosition[]): number {
  return aufCent(positionen.reduce((summe, p) => summe + (p.gesamtbetrag || 0), 0));
}

/** Betrag zu einem Prozentsatz der Kategoriesumme. */
export function betragAusProzent(summe: number, prozent: number): number {
  return aufCent((summe * prozent) / 100);
}

/**
 * Verteilt den Zielbetrag anteilig auf die Positionen.
 *
 * Rest-Cent aus der Rundung gehen an die Positionen mit dem größten
 * Nachkommaanteil (größte Reste zuerst) — so bleibt die Verteilung proportional
 * und die Summe stimmt auf den Cent.
 */
export function teileKategorie(
  positionen: readonly AufteilbarePosition[],
  zielBetrag: number
): Aufteilungszeile[] {
  const summeCent = positionen.reduce((s, p) => s + Math.round((p.gesamtbetrag || 0) * 100), 0);
  const zielCent = Math.round(zielBetrag * 100);

  // NaN muss eigenstaendig abgefangen werden: jeder Vergleich mit NaN ist false,
  // die Groessenpruefung unten wuerde einen ungueltigen Betrag also durchlassen
  // und NaN-Betraege in die Buchungen schreiben.
  if (positionen.length === 0 || !Number.isFinite(summeCent) || summeCent <= 0) return [];
  if (!Number.isFinite(zielCent) || zielCent <= 0 || zielCent > summeCent) return [];

  const cents = positionen.map((p) => Math.round((p.gesamtbetrag || 0) * 100));
  const roh = cents.map((c) => (c * zielCent) / summeCent);
  const verteilt = roh.map((r) => Math.floor(r));

  let rest = zielCent - verteilt.reduce((s, c) => s + c, 0);
  const nachRest = roh
    .map((r, index) => ({ index, nachkomma: r - Math.floor(r) }))
    .sort((a, b) => b.nachkomma - a.nachkomma);

  for (const { index } of nachRest) {
    if (rest <= 0) break;
    if (verteilt[index] >= cents[index]) continue;
    verteilt[index] += 1;
    rest -= 1;
  }

  return positionen.map((position, index) => ({
    positionId: position.id,
    vorher: cents[index] / 100,
    verschoben: verteilt[index] / 100,
    rest: (cents[index] - verteilt[index]) / 100,
  }));
}

/** Prüft eine Eingabe und nennt den Grund, wenn nicht aufgeteilt werden kann. */
export function pruefeAufteilung(
  positionen: readonly AufteilbarePosition[],
  zielBetrag: number
): string | null {
  if (positionen.length === 0) return "In dieser Kategorie liegt keine Position.";
  // Kostenpositionen werden immer als Betrag ohne Vorzeichen angelegt. Käme hier
  // doch ein negativer Wert an, wäre die anteilige Verteilung nicht mehr
  // nachvollziehbar — dann lieber gar nicht aufteilen.
  if (positionen.some((p) => (p.gesamtbetrag || 0) < 0)) {
    return "Diese Kategorie enthält eine Position mit negativem Betrag und lässt sich nicht aufteilen.";
  }
  const summe = summePositionen(positionen);
  if (!Number.isFinite(zielBetrag) || zielBetrag <= 0) return "Bitte einen Betrag größer null angeben.";
  if (aufCent(zielBetrag) > summe) {
    return `Höchstens ${summe.toFixed(2)} € können verschoben werden.`;
  }
  return null;
}
