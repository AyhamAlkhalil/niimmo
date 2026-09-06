/**
 * Gesetzliche Grenzen der Mieterhöhung bis zur ortsüblichen Vergleichsmiete.
 *
 * Bis zum 06.09.2026 rechnete der Erhöhungsdialog mit 20 % bzw. 30 %
 * (RentIncreaseModal.tsx:59) — beide Werte zu hoch. Eine Erhöhung über die
 * Kappungsgrenze hinaus ist nach § 558 Abs. 3 BGB in Höhe des Überschusses
 * unwirksam; die Buchhaltung bekam die zu hohe Grenze grün bestätigt.
 *
 * Die übrigen Stellen im System rechneten bereits richtig: agent-api
 * (index.ts:992), der Hinweis an der Immobilie und die Vertragsklausel in
 * wohnraumKlauseln.ts. Diese Datei ist ab jetzt die Quelle für das Frontend;
 * die Deno-Kopie in agent-api ist bei Änderungen mitzuziehen.
 */

/** § 558 Abs. 3 Satz 1 BGB — Regelfall: höchstens 20 % in drei Jahren. */
export const KAPPUNGSGRENZE_REGEL_PROZENT = 20;

/**
 * § 558 Abs. 3 Satz 2 BGB — in Gebieten mit angespanntem Wohnungsmarkt,
 * die eine Landesverordnung ausweist: höchstens 15 % in drei Jahren.
 */
export const KAPPUNGSGRENZE_ANGESPANNT_PROZENT = 15;

/** § 558 Abs. 1 BGB — die Miete muss 15 Monate unverändert gewesen sein. */
export const SPERRFRIST_MONATE = 15;

/**
 * § 558b Abs. 2 BGB — der Mieter hat bis zum Ende des zweiten Monats nach
 * Zugang Zeit zu überlegen; erst danach wird die Erhöhung fällig.
 */
export const UEBERLEGUNGSFRIST_MONATE = 2;

export function kappungsgrenzeProzent(istAngespannterMarkt: boolean): number {
  return istAngespannterMarkt ? KAPPUNGSGRENZE_ANGESPANNT_PROZENT : KAPPUNGSGRENZE_REGEL_PROZENT;
}

/** Höchstbetrag, auf den die Kaltmiete angehoben werden darf. */
export function maximaleKaltmiete(aktuelleKaltmiete: number, istAngespannterMarkt: boolean): number {
  const grenze = kappungsgrenzeProzent(istAngespannterMarkt);
  return aktuelleKaltmiete * (1 + grenze / 100);
}

/**
 * Der erste Monat, für den die erhöhte Miete geschuldet wird: Ablauf des
 * zweiten Kalendermonats nach Zugang des Verlangens (§ 558b Abs. 1, 2 BGB).
 * Beispiel: Zugang im März → erhöhte Miete ab Juni.
 */
export function wirksamAb(zugang: Date): Date {
  return new Date(zugang.getFullYear(), zugang.getMonth() + UEBERLEGUNGSFRIST_MONATE + 1, 1);
}
