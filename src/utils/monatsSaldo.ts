import { format } from 'date-fns';
import { getVertragsende } from './contractUtils';
import {
  bkaAnrechnung,
  bkaVorauszahlung,
  istMonatsmiete,
  nurFaelligeForderungen,
  sollMonatsmiete,
  zaehltImMietkonto,
  type KontoForderung,
  type KontoZahlung,
  type SollVertrag,
} from './rueckstandsberechnung';

/**
 * Soll-Miete, Eingang und Noch offen des laufenden Monats für die Startseite (DashboardStats).
 *
 * Seit dem 29.10.2026 auf demselben Mietkonto wie die Rückstandsliste (berechneMietkontostand):
 * - Soll-Miete: die Monatsforderungen (Typ Miete: Monatsmiete, anteiliger Monat, Minderung, Gebühren),
 *   solange die Sollstellung den Monat nicht angelegt hat (am 1. vor 05:00 UTC) die Vertragsmiete.
 * - Eingang: der Teil davon, den Zahlungen decken. Zahlungen tilgen zuerst ältere Rückstände
 *   (§ 366 Abs. 2 BGB), eine im Vormonat vorausgezahlte Miete zählt mit.
 * - Noch offen = Soll-Miete − Eingang. Was aus früheren Monaten fällig und unbezahlt ist, steht
 *   getrennt in `aelter`; ab dem 8. ergeben Noch offen und `aelter` zusammen den Rückstand der Liste.
 *
 * Bis zum 28.10.2026 zählte der Eingang die Zahlungen mit zugeordnetem Monat. Die DB ordnet erst ab dem
 * 28. dem Folgemonat zu: Wer die Oktobermiete am 26.09. zahlte, stand im Oktober als offen, obwohl die
 * Rückstandsliste ihn ausgeglichen zeigte; eine Nachzahlung für September zählte als Oktober-Eingang.
 * Die Zeile „X € mehr eingegangen“ war kein Guthaben im Sinne der Liste und entfällt.
 */
export interface MonatsVertrag extends SollVertrag {
  id: string;
}

export interface MonatsForderung extends KontoForderung {
  mietvertrag_id: string | null;
}

export interface MonatsZahlung extends KontoZahlung {
  mietvertrag_id: string | null;
}

export interface MonatsSaldo {
  soll: number;
  eingang: number;
  offen: number;
  /** Fällige, unbezahlte Beträge aus früheren Monaten (und sonstige fällige Forderungen wie BKA) */
  aelter: number;
  vertraegeOffen: number;
  vertraegeAelter: number;
  /**
   * Überleitung Kaltmiete + Betriebskosten → Soll-Miete (29.10.2026, Kundenfrage): vertragsmiete + anteilig
   * + abweichend + gebuehren = soll. anteilig: Monate mit Mietbeginn oder -ende; abweichend: Monatsmieten,
   * die nicht der Vertragsmiete entsprechen (Mieterhöhung ab Folgemonat, Minderung, erlassene Miete).
   */
  ueberleitung: { vertragsmiete: number; anteilig: number; abweichend: number; gebuehren: number };
  /**
   * Aufteilung der Soll-Miete für die Faktenzeile (29.10.2026, Kundenfrage „warum eine Differenz?“):
   * kaltmiete + betriebskosten + ueberleitung.gebuehren = soll. Bis dahin zeigte die Faktenzeile die
   * Vertragswerte (vertragKaltmiete, vertragBetriebskosten), die im Monat eines Einzugs oder einer erst ab
   * dem Folgemonat geltenden Mieterhöhung nicht die Soll-Miete ergeben.
   * Anteiliger Monat: beide Teile anteilig wie die Sollstellung. Sonst gelten die Betriebskosten laut Vertrag,
   * eine abweichende Monatsmiete (Erhöhung erst ab Folgemonat, Minderung, erlassene Miete) ändert die Kaltmiete.
   * Der Unterschied zum Vertragswert je Teil wie in `ueberleitung` (29.10.2026, Kundenfrage „wieso 50.582,51 €
   * laut Verträgen, oben 49.668,45 €?“): vertragKaltmiete + kaltmieteAnteilig + kaltmieteAbweichend = kaltmiete,
   * ebenso für die Betriebskosten.
   */
  aufteilung: {
    kaltmiete: number;
    betriebskosten: number;
    vertragKaltmiete: number;
    vertragBetriebskosten: number;
    kaltmieteAnteilig: number;
    kaltmieteAbweichend: number;
    betriebskostenAnteilig: number;
    betriebskostenAbweichend: number;
  };
  /** Zahlungen (Miete, Rücklastschrift, BKA) mit Buchungstag im laufenden Monat — 0 heißt: Kontoauszug fehlt vermutlich */
  zahlungenImMonat: number;
}

const zahl = (wert: unknown): number => {
  const n = Number(wert);
  return Number.isFinite(n) ? n : 0;
};

const rund = (betrag: number): number => {
  const r = Math.round(betrag * 100) / 100;
  return r === 0 ? 0 : r;
};

const nachVertrag = <T extends { mietvertrag_id: string | null }>(zeilen: readonly T[]): Map<string, T[]> => {
  const je = new Map<string, T[]>();
  for (const z of zeilen) {
    if (!z.mietvertrag_id) continue;
    const liste = je.get(z.mietvertrag_id);
    if (liste) liste.push(z);
    else je.set(z.mietvertrag_id, [z]);
  }
  return je;
};

export function monatsSaldo(
  vertraege: readonly MonatsVertrag[],
  forderungen: readonly MonatsForderung[],
  zahlungen: readonly MonatsZahlung[],
  stichtag: Date = new Date()
): MonatsSaldo {
  const monat = format(stichtag, 'yyyy-MM');
  const forderungenJe = nachVertrag(forderungen);
  const zahlungenJe = nachVertrag(zahlungen);

  let soll = 0;
  let eingang = 0;
  let offen = 0;
  let aelter = 0;
  let vertraegeOffen = 0;
  let vertraegeAelter = 0;
  let vertragsmiete = 0;
  let anteilig = 0;
  let abweichend = 0;
  let gebuehren = 0;
  let kaltmiete = 0;
  let betriebskosten = 0;
  let vertragKaltmiete = 0;
  let vertragBetriebskosten = 0;
  const kaltUnterschied = { anteilig: 0, abweichend: 0 };
  const bkUnterschied = { anteilig: 0, abweichend: 0 };
  const letzterTag = format(new Date(stichtag.getFullYear(), stichtag.getMonth() + 1, 0), 'yyyy-MM-dd');
  let zahlungenImMonat = 0;

  for (const v of vertraege) {
    const f = (forderungenJe.get(v.id) ?? []).filter((x) => x.sollmonat);
    const z = (zahlungenJe.get(v.id) ?? []).filter(zaehltImMietkonto);
    zahlungenImMonat += z.filter((x) => (x.buchungsdatum as string).slice(0, 7) === monat).length;

    // Forderungen des Monats ohne BKA: Monatsmiete, anteiliger Monat, Minderung, Gebühren. Fehlt die
    // Monatsmiete noch (am 1. vor 05:00 UTC), kommt sie aus der Nachbildung der Sollstellung dazu.
    const imMonat = f.filter((x) => (x.sollmonat as string).slice(0, 7) === monat && (x.typ ?? 'Miete') !== 'BKA');
    const fehlendeMiete = imMonat.some(istMonatsmiete) ? 0 : sollMonatsmiete(v, monat);
    const sollV = imMonat.reduce((s, x) => s + zahl(x.sollbetrag), 0) + fehlendeMiete;
    const sollPositiv = Math.max(0, rund(sollV));

    // Mietkonto bis einschließlich dieses Monats: alles Fällige, dazu die Monatsmiete auch vor dem 8.
    // Eine vorab bezahlte BKA-Nachzahlung zählt nicht als Eingang auf die Miete.
    const faellig = nurFaelligeForderungen(f, stichtag);
    const schonFaellig = new Set(faellig);
    const heute = format(stichtag, 'yyyy-MM-dd');
    const nichtFaelligeBka = f.filter(
      (x) => x.typ === 'BKA' && !schonFaellig.has(x) && !!x.faelligkeitsdatum && x.faelligkeitsdatum.slice(0, 10) > heute
    );
    const nochNichtFaellig = imMonat.filter((x) => !schonFaellig.has(x)).reduce((s, x) => s + zahl(x.sollbetrag), 0) + fehlendeMiete;
    const konto = rund(
      faellig.reduce((s, x) => s + zahl(x.sollbetrag), 0) +
        nochNichtFaellig -
        z.reduce((s, x) => s + zahl(x.betrag), 0) +
        bkaAnrechnung(f, z).ohneForderung +
        bkaVorauszahlung(faellig, nichtFaelligeBka, z)
    );

    const offenV = Math.min(sollPositiv, Math.max(0, konto));
    const aelterV = rund(Math.max(0, konto - sollPositiv));
    soll += sollPositiv;
    offen += offenV;
    eingang += sollPositiv - offenV;
    aelter += aelterV;
    if (offenV > 0) vertraegeOffen += 1;
    if (aelterV > 0) vertraegeAelter += 1;

    const kv = zahl(v.kaltmiete);
    const bv = zahl(v.betriebskosten);
    const vm = kv + bv;
    const gebuehrV = imMonat.filter((x) => !!x.ruecklastschrift_am).reduce((s, x) => s + zahl(x.sollbetrag), 0);
    const ende = getVertragsende(v)?.slice(0, 10);
    const teilmonat = (!!v.start_datum && v.start_datum.slice(0, 10) > `${monat}-01`) || (!!ende && ende < letzterTag);
    vertragsmiete += vm;
    gebuehren += gebuehrV;
    if (teilmonat) anteilig += sollPositiv - vm - gebuehrV;
    else abweichend += sollPositiv - vm - gebuehrV;

    // Aufteilung der Monatsmiete (ohne Gebühren) in Kaltmiete und Betriebskosten. Der anteilige Teil in
    // ganzen Cent: 877,42 × 200 / 1.600 ergab in Euro gerechnet 109,67 statt 109,68.
    const mieteV = rund(sollPositiv - gebuehrV);
    let bkV = 0;
    if (vm > 0 && mieteV > 0) {
      bkV = teilmonat ? Math.round((Math.round(mieteV * 100) * bv) / vm) / 100 : bv;
      bkV = Math.min(bkV, mieteV);
    }
    vertragKaltmiete += kv;
    vertragBetriebskosten += bv;
    betriebskosten += bkV;
    kaltmiete += mieteV - bkV;
    const art = teilmonat ? 'anteilig' : 'abweichend';
    kaltUnterschied[art] += mieteV - bkV - kv;
    bkUnterschied[art] += bkV - bv;
  }

  return {
    soll: rund(soll),
    eingang: rund(eingang),
    offen: rund(offen),
    aelter: rund(aelter),
    vertraegeOffen,
    vertraegeAelter,
    ueberleitung: { vertragsmiete: rund(vertragsmiete), anteilig: rund(anteilig), abweichend: rund(abweichend), gebuehren: rund(gebuehren) },
    aufteilung: {
      kaltmiete: rund(kaltmiete),
      betriebskosten: rund(betriebskosten),
      vertragKaltmiete: rund(vertragKaltmiete),
      vertragBetriebskosten: rund(vertragBetriebskosten),
      kaltmieteAnteilig: rund(kaltUnterschied.anteilig),
      kaltmieteAbweichend: rund(kaltUnterschied.abweichend),
      betriebskostenAnteilig: rund(bkUnterschied.anteilig),
      betriebskostenAbweichend: rund(bkUnterschied.abweichend),
    },
    zahlungenImMonat,
  };
}
