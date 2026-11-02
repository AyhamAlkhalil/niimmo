import { getVertragsende } from '@/utils/contractUtils';
import { sollMonatsmiete, type KontoForderung } from '@/utils/rueckstandsberechnung';

/**
 * Monate vor der letzten Mieterhöhung, die eine Änderung von Mietbeginn oder -ende träfe (02.11.2026, Kunde: „falls so
 * ein Fall kommt … kurz hinweisen und dem User die Wahl lassen“). Dort steht noch die frühere Miete; der Trigger
 * update_forderungen_on_rent_change rechnet sie seit dem 30.10.2026 anteilig um (miete_vor_erhoehung), auf Wunsch
 * lässt mietvertrag_speichern sie unverändert. Diese Funktion bildet die Regel des Triggers für den Hinweis nach.
 */
export interface MonatVorErhoehung {
  /** JJJJ-MM */
  monat: string;
  /** Monatsmiete heute; null, wenn der Monat neu in die Laufzeit käme */
  bisher: number | null;
  /** Monatsmiete nach dem Anpassen; null, wenn sie entfiele */
  neu: number | null;
}

export interface VertragFuerVormonate {
  status?: string | null;
  start_datum?: string | null;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
  letzte_mieterhoehung_am?: string | null;
  kaltmiete?: number | string | null;
  betriebskosten?: number | string | null;
}

const monatPlus = (monat: string, n: number): string => {
  const [jahr, mon] = monat.split('-').map(Number);
  const d = new Date(Date.UTC(jahr, mon - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const tageImMonat = (monat: string): number => {
  const [jahr, mon] = monat.split('-').map(Number);
  return new Date(Date.UTC(jahr, mon, 0)).getUTCDate();
};

/** Tage des Monats innerhalb der Laufzeit, wie public.monatstage */
const monatstage = (start: string | null, ende: string | null, monat: string): number => {
  const erster = `${monat}-01`;
  const letzter = `${monat}-${String(tageImMonat(monat)).padStart(2, '0')}`;
  const von = start && start > erster ? start : erster;
  const bis = ende && ende < letzter ? ende : letzter;
  if (von > bis) return 0;
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000) + 1;
};

/** Anteil wie public.monatsanteil (Postgres-Rundung über sollMonatsmiete) */
const anteil = (betrag: number, start: string | null, ende: string | null, monat: string): number =>
  sollMonatsmiete({ status: 'aktiv', start_datum: start, ende_datum: ende, kaltmiete: betrag, betriebskosten: 0 }, monat);

/** Erster Monat mit der Miete der letzten Erhöhung: am 1. dieser Monat, sonst der Folgemonat (wie der Trigger) */
export function erhoehungsMonat(letzteMieterhoehungAm: string | null | undefined): string | null {
  if (!letzteMieterhoehungAm) return null;
  const monat = letzteMieterhoehungAm.slice(0, 7);
  return letzteMieterhoehungAm.slice(8, 10) === '01' ? monat : monatPlus(monat, 1);
}

export function monateVorErhoehung(
  vertrag: VertragFuerVormonate | null | undefined,
  neu: { start_datum: string | null; ende_datum: string | null; kuendigungsdatum?: string | null },
  forderungen: readonly KontoForderung[],
  heute: Date = new Date()
): MonatVorErhoehung[] {
  const erhoehung = erhoehungsMonat(vertrag?.letzte_mieterhoehung_am);
  if (!vertrag || !erhoehung) return [];
  const altStart = vertrag.start_datum?.slice(0, 10) || null;
  const altEnde = getVertragsende(vertrag)?.slice(0, 10) || null;
  const neuStart = neu.start_datum?.slice(0, 10) || null;
  const neuEnde = getVertragsende({
    ende_datum: neu.ende_datum,
    kuendigungsdatum: neu.kuendigungsdatum !== undefined ? neu.kuendigungsdatum : vertrag.kuendigungsdatum,
  })?.slice(0, 10) || null;
  if (altStart === neuStart && altEnde === neuEnde) return [];

  const laufend = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}`;
  // Monatsmieten je Monat wie im Trigger: Typ Miete, keine Rücklastschriftgebühr
  const mietenJe = new Map<string, number[]>();
  for (const f of forderungen) {
    if (!f.sollmonat || (f.typ ?? 'Miete') !== 'Miete' || f.ruecklastschrift_am) continue;
    const monat = f.sollmonat.slice(0, 7);
    mietenJe.set(monat, [...(mietenJe.get(monat) ?? []), Number(f.sollbetrag) || 0]);
  }
  // Nächstgelegene volle Monatsmiete vor der Erhöhung (miete_vor_erhoehung)
  const nachbar = (monat: string): number | null => {
    let bester: { abstand: number; monat: string; betrag: number } | null = null;
    for (const [m, betraege] of mietenJe) {
      if (m === monat || m >= erhoehung || betraege.length !== 1) continue;
      if (monatstage(altStart, altEnde, m) !== tageImMonat(m)) continue;
      const abstand = Math.abs(Date.parse(`${m}-01`) - Date.parse(`${monat}-01`));
      if (!bester || abstand < bester.abstand || (abstand === bester.abstand && m > bester.monat)) {
        bester = { abstand, monat: m, betrag: betraege[0] };
      }
    }
    return bester ? bester.betrag : null;
  };

  const ergebnis: MonatVorErhoehung[] = [];
  const erster = [altStart, neuStart].filter((d): d is string => !!d).sort()[0]?.slice(0, 7) ?? erhoehung;
  for (let monat = erster < '2025-01' ? '2025-01' : erster; monat < erhoehung; monat = monatPlus(monat, 1)) {
    const tageAlt = monatstage(altStart, altEnde, monat);
    const tageNeu = monatstage(neuStart, neuEnde, monat);
    if (tageAlt === tageNeu) continue;
    const mieten = mietenJe.get(monat) ?? [];
    if (tageAlt > 0) {
      if (mieten.length !== 1) continue;
      const bisher = mieten[0];
      if (tageNeu === 0) {
        ergebnis.push({ monat, bisher, neu: null });
        continue;
      }
      const volle = tageImMonat(monat);
      const nb = tageAlt === volle ? bisher : nachbar(monat);
      const basis = tageAlt === volle ? bisher : nb !== null && anteil(nb, altStart, altEnde, monat) === bisher ? nb : null;
      const betrag = basis !== null
        ? anteil(basis, neuStart, neuEnde, monat)
        : Math.round((bisher * tageNeu / tageAlt) * 100 + 1e-9) / 100;
      ergebnis.push({ monat, bisher, neu: betrag });
    } else if (tageNeu > 0 && monat <= laufend && mieten.length === 0 && neuStart
      && !(vertrag.status === 'beendet' && !neuEnde)) {
      // Ohne vollen Nachbarmonat nimmt der Trigger die heutige Vertragsmiete (monatsmiete_am)
      const basis = nachbar(monat) ?? (Number(vertrag.kaltmiete) || 0) + (Number(vertrag.betriebskosten) || 0);
      ergebnis.push({ monat, bisher: null, neu: anteil(basis, neuStart, neuEnde, monat) });
    }
  }
  return ergebnis;
}
