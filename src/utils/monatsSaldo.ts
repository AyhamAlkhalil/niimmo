/**
 * Soll, Eingang und Offenes des laufenden Monats für die Startseite (DashboardStats).
 *
 * Bis zum 27.10.2026 rechnete die Startseite „Noch offen“ als Gesamt-Soll minus Gesamt-Eingang.
 * Überzahlungen einzelner Mieter verdeckten so die Rückstände anderer: Im Oktober 2026 stand grün
 * „Mehr eingegangen +12 €“, obwohl 19 laufende Verträge zusammen 6.695,58 € zu wenig gezahlt hatten.
 * Jetzt je Vertrag: offen ist, was dort fehlt; ein Mehr wird getrennt ausgewiesen.
 *
 * Soll eines Vertrags sind seine Forderungen des Monats (Typ Miete: Monatsmiete, anteiliger
 * Einzugsmonat, Minderung, Gebühren) — so wie die Sollstellung sie angelegt hat. Hat sie den Monat
 * noch nicht angelegt (am Ersten vor dem Lauf um 05:00 UTC), gilt die Vertragsmiete.
 * Eingang sind Miete und Rücklastschriften des Monats (zugeordneter_monat); Zahlungen auf eine
 * Betriebskostenabrechnung gehören nicht zur Monatsmiete und würden einen Mietrückstand verdecken.
 */
export interface MonatsVertrag {
  id: string;
  kaltmiete?: number | null;
  betriebskosten?: number | null;
}

export interface MonatsForderung {
  mietvertrag_id: string | null;
  sollbetrag: number | string | null;
  typ?: string | null;
}

export interface MonatsZahlung {
  mietvertrag_id: string | null;
  betrag: number | string | null;
  kategorie?: string | null;
}

export interface MonatsSaldo {
  soll: number;
  eingang: number;
  offen: number;
  mehr: number;
  vertraegeMitRueckstand: number;
}

const zahl = (wert: unknown): number => {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
};

const rund = (betrag: number): number => Math.round(betrag * 100) / 100;

export function monatsSaldo(
  vertraege: readonly MonatsVertrag[],
  forderungen: readonly MonatsForderung[],
  zahlungen: readonly MonatsZahlung[]
): MonatsSaldo {
  const sollJe = new Map<string, number>();
  for (const f of forderungen) {
    if (!f.mietvertrag_id || (f.typ ?? 'Miete') !== 'Miete') continue;
    sollJe.set(f.mietvertrag_id, (sollJe.get(f.mietvertrag_id) ?? 0) + zahl(f.sollbetrag));
  }
  const eingangJe = new Map<string, number>();
  for (const z of zahlungen) {
    if (!z.mietvertrag_id || (z.kategorie !== 'Miete' && z.kategorie !== 'Rücklastschrift')) continue;
    eingangJe.set(z.mietvertrag_id, (eingangJe.get(z.mietvertrag_id) ?? 0) + zahl(z.betrag));
  }

  let soll = 0;
  let eingang = 0;
  let offen = 0;
  let mehr = 0;
  let vertraegeMitRueckstand = 0;
  for (const v of vertraege) {
    const s = sollJe.has(v.id) ? (sollJe.get(v.id) as number) : zahl(v.kaltmiete) + zahl(v.betriebskosten);
    const e = eingangJe.get(v.id) ?? 0;
    const differenz = rund(s - e);
    soll += s;
    eingang += e;
    if (differenz > 0) {
      offen += differenz;
      vertraegeMitRueckstand += 1;
    } else if (differenz < 0) {
      mehr -= differenz;
    }
  }
  return { soll: rund(soll), eingang: rund(eingang), offen: rund(offen), mehr: rund(mehr), vertraegeMitRueckstand };
}
