import { istMonatsmiete, zaehltImMietkonto, zahlungsMonat, type KontoForderung, type KontoZahlung } from './rueckstandsberechnung';

/** Cent-Reste machen ein Konto nicht „seit Jahren“ offen */
const TOLERANZ = 1;

const faelligAm = (f: KontoForderung): string => (f.faelligkeitsdatum ?? f.sollmonat ?? '').slice(0, 10);

/** Positive fällige Forderungen, jüngste zuerst — offen sind nach § 366 Abs. 2 BGB die jüngsten */
const juengsteZuerst = (faellige: readonly KontoForderung[]): KontoForderung[] =>
  faellige
    .filter((f) => !!faelligAm(f) && (Number(f.sollbetrag) || 0) > 0)
    .sort((a, b) => faelligAm(b).localeCompare(faelligAm(a)));

/**
 * Seit wann ein Rückstand offen ist (29.10.2026, Prüfung der Rückstandsliste), als Monat (JJJJ-MM): Jede Zahlung
 * deckt zuerst den Monat, dem sie zugeordnet ist (`zugeordneter_monat`, sonst der Buchungsmonat); was übrig
 * bleibt, deckt die ältesten offenen Monate. Genannt wird der älteste Monat, der danach noch offen ist.
 * Wer den Juli ausließ und seitdem jeden Monat pünktlich zahlt, ist so seit Juli im Rückstand — die erste
 * Fassung verteilte alle Zahlungen auf die älteste Schuld und nannte Oktober (Review). Am Saldo ändert das
 * nichts; der kommt weiter aus berechneMietkontostand. Bleibt kein Monat offen (BKA-Sonderfälle der
 * Kontoführung), der älteste offene Monat nach § 366 Abs. 2 BGB.
 */
export function rueckstandSeit(
  faellige: readonly KontoForderung[],
  zahlungen: readonly KontoZahlung[],
  rueckstand: number
): string | null {
  if (!(rueckstand > 0)) return null;
  const offenJe = new Map<string, number>();
  for (const f of faellige) {
    const monat = faelligAm(f).slice(0, 7);
    if (monat) offenJe.set(monat, (offenJe.get(monat) ?? 0) + (Number(f.sollbetrag) || 0));
  }
  let ueberschuss = 0;
  for (const z of zahlungen) {
    if (!zaehltImMietkonto(z)) continue;
    const monat = zahlungsMonat(z);
    const betrag = Number(z.betrag) || 0;
    if (offenJe.has(monat)) offenJe.set(monat, (offenJe.get(monat) as number) - betrag);
    else ueberschuss += betrag;
  }
  const monate = [...offenJe.keys()].sort();
  for (const monat of monate) {
    const offen = offenJe.get(monat) as number;
    if (offen < 0) {
      ueberschuss -= offen;
      offenJe.set(monat, 0);
    }
  }
  for (const monat of monate) {
    if (ueberschuss <= 0) break;
    const deckung = Math.min(ueberschuss, offenJe.get(monat) as number);
    offenJe.set(monat, (offenJe.get(monat) as number) - deckung);
    ueberschuss -= deckung;
  }
  const aeltester = monate.find((monat) => (offenJe.get(monat) as number) > TOLERANZ);
  if (aeltester) return aeltester;

  let summe = 0;
  const offen = juengsteZuerst(faellige);
  for (const f of offen) {
    summe += Number(f.sollbetrag) || 0;
    if (summe >= rueckstand - 0.005) return faelligAm(f).slice(0, 7);
  }
  return offen.length > 0 ? faelligAm(offen[offen.length - 1]).slice(0, 7) : null;
}

/** Ein offener Posten eines Rückstands, wie ihn das Mahnschreiben aufzählt */
export interface OffenerPosten {
  /** JJJJ-MM des Sollmonats */
  monat: string;
  betrag: number;
  art: 'Miete' | 'Rücklastschriftgebühr' | 'Betriebskostennachzahlung' | 'Sonstige Forderung';
}

/**
 * Die offenen Posten eines Rückstands, ältester zuerst (29.10.2026, Prüfung: das Mahnschreiben kündigte „folgende
 * Mietzahlungen“ an und zählte keine auf). Offen sind nach § 366 Abs. 2 BGB die jüngsten fälligen Forderungen;
 * was der Rückstand über sie hinaus ausmacht (BKA-Zahlung ohne Forderung), steht als „Sonstige Forderung“.
 */
export function offenePosten(faellige: readonly KontoForderung[], rueckstand: number): OffenerPosten[] {
  let rest = Math.round(rueckstand * 100) / 100;
  const posten: OffenerPosten[] = [];
  for (const f of juengsteZuerst(faellige)) {
    if (rest <= 0.005) break;
    const teil = Math.round(Math.min(rest, Number(f.sollbetrag) || 0) * 100) / 100;
    const art: OffenerPosten['art'] = istMonatsmiete(f) ? 'Miete'
      : f.ruecklastschrift_am ? 'Rücklastschriftgebühr'
        : f.typ === 'BKA' ? 'Betriebskostennachzahlung' : 'Sonstige Forderung';
    posten.push({ monat: (f.sollmonat ?? faelligAm(f)).slice(0, 7), betrag: teil, art });
    rest = Math.round((rest - teil) * 100) / 100;
  }
  if (rest > 0.005) posten.push({ monat: '', betrag: rest, art: 'Sonstige Forderung' });
  return posten.reverse();
}

/**
 * Der Mietanteil eines Rückstands (Review 29.10.2026): Offen sind die jüngsten fälligen Forderungen; davon
 * zählen nur Monatsmieten — eine Betriebskostennachzahlung oder Rücklastschriftgebühr ist keine Miete.
 */
export function mietrueckstand(faellige: readonly KontoForderung[], rueckstand: number): number {
  const miete = offenePosten(faellige, rueckstand).filter((p) => p.art === 'Miete').reduce((s, p) => s + p.betrag, 0);
  return Math.round(miete * 100) / 100;
}

/**
 * Mietrückstand in Monatsmieten (Kaltmiete + Betriebskosten), auf eine Nachkommastelle abgerundet: 1,95 ist
 * noch keine zwei Monatsmieten (Review: gerundet stand dort „2“). Unter 0,1 und ohne Miete: null.
 */
export function rueckstandInMonatsmieten(mietrueckstandBetrag: number, monatsmiete: number): number | null {
  if (!(mietrueckstandBetrag > 0) || !(monatsmiete > 0)) return null;
  const anzahl = Math.floor((mietrueckstandBetrag / monatsmiete) * 10 + 1e-9) / 10;
  return anzahl >= 0.1 ? anzahl : null;
}

/** „2026-09“ → „September 2026“ */
export const monatText = (monat: string): string => {
  const [jahr, m] = monat.split('-').map(Number);
  return new Date(jahr, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
};
