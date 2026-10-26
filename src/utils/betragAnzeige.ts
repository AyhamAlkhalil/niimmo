/**
 * Beträge für große Kennzahlen (Dashboard, Objektseite).
 *
 * Runde Beträge ohne Cent („34.000 €“), sonst immer mit zwei Stellen („2.666,40 €“) —
 * „,00“ ist bei großen Zahlen nur Rauschen, „2.666,4 €“ wäre falsch. Für Buchungen und
 * Tabellen bleibt `formatEuro` aus utils/zahlungenAnsicht.ts mit festen zwei Stellen.
 */

/** Zahl ohne Währungszeichen: „34.000“ oder „2.666,40“ */
export function formatBetragKompakt(betrag: number): string {
  if (!Number.isFinite(betrag)) return "–";
  const cent = Math.round(betrag * 100);
  const wert = cent / 100;
  return wert.toLocaleString(
    "de-DE",
    cent % 100 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  );
}

/** „34.000 €“ oder „2.666,40 €“, mit geschütztem Leerzeichen vor dem Zeichen */
export function formatEuroKompakt(betrag: number): string {
  const zahl = formatBetragKompakt(betrag);
  return zahl === "–" ? zahl : `${zahl}\u00a0€`;
}
