import { format } from 'date-fns';
import {
  bkaAnrechnung,
  bkaVorauszahlung,
  istMonatsmiete,
  nurFaelligeForderungen,
  sollMonatsmiete,
  zaehltImMietkonto,
  zahlungsMonat,
  type KontoForderung,
  type KontoZahlung,
} from './rueckstandsberechnung';
import { vertragsMonatsmiete, type MonatsmieteVertrag } from './vertragsMonatsmiete';

/**
 * Soll-Miete, Eingang und Noch offen des laufenden Monats für die Startseite (DashboardStats).
 *
 * Seit dem 29.10.2026 (Kundenvorgaben, wörtlich: „Die Soll-Miete soll aus den Mietverträgen berechnet werden —
 * sie sind die Basis“, „Eingang sind alle Zahlungen die dem Monat zugeordnet werden als Miete“):
 * - Soll-Miete: je laufendem Vertrag die in diesem Monat gültige Miete aus dem Vertrag, bei Ein- oder Auszug
 *   anteilig (vertragsMonatsmiete). Keine Gebühren, keine Minderungen — die stehen nur im Mietkonto. Bis dahin
 *   summierte sie die Forderungen des Monats, samt Rücklastschriftgebühren.
 * - Eingang: alle Miet-Zahlungen, die diesem Monat zugeordnet sind (zugeordneter Monat, sonst Buchungsmonat),
 *   Rücklastschriften mindernd, ohne Deckel. Wer doppelt zahlt, erhöht den Eingang; wer im Vormonat
 *   vorausgezahlt hat, steht dort. Eingang + Noch offen ergibt daher nicht immer die Soll-Miete.
 * - Noch offen: was von der Soll-Miete eines Vertrags weder durch Zahlungen für diesen Monat noch durch ein
 *   Guthaben im Mietkonto (berechneMietkontostand) gedeckt ist. Was aus früheren Monaten fällig und unbezahlt
 *   ist, steht getrennt in `aelter`; ab dem 8. ergeben Noch offen und `aelter` zusammen den Rückstand der Liste.
 *
 * Bis zum 28.10.2026 zählte der Eingang die Zahlungen mit zugeordnetem Monat. Die DB ordnet erst ab dem
 * 28. dem Folgemonat zu: Wer die Oktobermiete am 26.09. zahlte, stand im Oktober als offen, obwohl die
 * Rückstandsliste ihn ausgeglichen zeigte; eine Nachzahlung für September zählte als Oktober-Eingang.
 * Die Zeile „X € mehr eingegangen“ war kein Guthaben im Sinne der Liste und entfällt.
 * Vom 28. bis 29.10.2026 tilgte auch die Oktoberzahlung zuerst ältere Rückstände: Ein Mieter, der im Oktober
 * gezahlt, aber im April ausgelassen hatte, stand unter „hat die Oktobermiete noch nicht bezahlt“ (Kundenmeldung).
 * Am 29.10.2026 zählt der Eingang auf Kundenvorgabe wieder die zugeordneten Zahlungen; „Noch offen“ bleibt beim
 * Mietkonto, damit die Vorauszahlung vom 26.09. dort nicht als offen erscheint.
 */
export type MonatsVertrag = MonatsmieteVertrag;

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
   * Die Verträge hinter „Noch offen“, größter offener Betrag zuerst (29.10.2026, Kundenwunsch: Arbeitsliste
   * unter der Kennzahl). offen < soll heißt: teilweise bezahlt.
   */
  offeneVertraege: { mietvertragId: string; offen: number; soll: number }[];
  /**
   * Die Soll-Miete aufgeteilt für die Faktenzeile: kaltmiete + betriebskosten = soll, je Vertrag aus dem Vertrag.
   * Eine Überleitung zu „Vertragswerten“ und Gebühren gibt es nicht mehr (Kunde 29.10.2026: „total verwirrend“).
   */
  aufteilung: { kaltmiete: number; betriebskosten: number };
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
  // Eingang: alle Miet-Zahlungen, die diesem Monat zugeordnet sind — auch die eines Vertrags, der nicht mehr läuft
  // (Nachzahlung nach dem Auszug). Bis zur Review vom 29.10.2026 nur die der laufenden Verträge, so fehlten
  // Nachzahlungen von Ex-Mietern.
  const eingang = zahlungen
    .filter((x) => !!x.mietvertrag_id && zaehltImMietkonto(x) && x.kategorie !== 'Betriebskostenabrechnung' && zahlungsMonat(x) === monat)
    .reduce((s, x) => s + zahl(x.betrag), 0);

  let soll = 0;
  let offen = 0;
  let aelter = 0;
  let vertraegeOffen = 0;
  let vertraegeAelter = 0;
  let kaltmiete = 0;
  let betriebskosten = 0;
  const offeneVertraege: MonatsSaldo['offeneVertraege'] = [];
  let zahlungenImMonat = 0;

  for (const v of vertraege) {
    const f = (forderungenJe.get(v.id) ?? []).filter((x) => x.sollmonat);
    const z = (zahlungenJe.get(v.id) ?? []).filter(zaehltImMietkonto);
    zahlungenImMonat += z.filter((x) => (x.buchungsdatum as string).slice(0, 7) === monat).length;

    // Soll aus dem Vertrag: die in diesem Monat gültige Miete, anteilig bei Ein- oder Auszug
    const miete = vertragsMonatsmiete(v, monat, f);
    const sollPositiv = Math.max(0, miete.gesamt);

    // Mietkonto bis einschließlich dieses Monats aus den Forderungen: alles Fällige, dazu die Monatsmiete (samt
    // Minderung) auch vor dem 8. Eine Rücklastschriftgebühr zählt erst ab ihrer Fälligkeit, über `faellig`. Fehlt
    // die Monatsmiete noch (am 1. vor 05:00 UTC), kommt sie aus der Nachbildung der Sollstellung dazu.
    // Eine vorab bezahlte BKA-Nachzahlung zählt nicht als Eingang auf die Miete.
    const imMonat = f.filter(
      (x) => (x.sollmonat as string).slice(0, 7) === monat && (x.typ ?? 'Miete') !== 'BKA' && !x.ruecklastschrift_am
    );
    const fehlendeMiete = imMonat.some(istMonatsmiete) ? 0 : sollMonatsmiete(v, monat);
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

    // Zahlungen für diesen Monat decken zuerst seine Miete, der Rest des Kontos gilt als älter. Am Saldo ändert
    // das nichts: offen + aelter = Konto. BKA-Zahlungen sind für die BKA bestimmt (§ 366 Abs. 1 BGB) und zählen
    // hier nicht. Eine Rücklastschrift gilt wie jede Zahlung für ihren zugeordneten Monat; eine Sonderregel
    // („hebt die letzte Zahlung davor auf“) überstimmte die Zuordnung von Hand und traf auch geplatzte BKA-
    // Lastschriften, ein Deckel auf den Listenrückstand vor dem 8. rechnete eine Zahlung doppelt (Gegenprüfung).
    const fuerMonat = z
      .filter((x) => x.kategorie !== 'Betriebskostenabrechnung' && zahlungsMonat(x) === monat)
      .reduce((s, x) => s + zahl(x.betrag), 0);
    const gedeckt = Math.min(sollPositiv, Math.max(0, fuerMonat));
    const offenV = rund(Math.min(sollPositiv - gedeckt, Math.max(0, konto)));
    const aelterV = rund(Math.max(0, konto) - offenV);
    soll += sollPositiv;
    offen += offenV;
    aelter += aelterV;
    if (offenV > 0) {
      vertraegeOffen += 1;
      offeneVertraege.push({ mietvertragId: v.id, offen: rund(offenV), soll: sollPositiv });
    }
    if (aelterV > 0) vertraegeAelter += 1;

    kaltmiete += miete.kaltmiete;
    betriebskosten += miete.betriebskosten;
  }

  return {
    soll: rund(soll),
    eingang: rund(eingang),
    offen: rund(offen),
    aelter: rund(aelter),
    vertraegeOffen,
    vertraegeAelter,
    offeneVertraege: offeneVertraege.sort((a, b) => b.offen - a.offen),
    aufteilung: { kaltmiete: rund(kaltmiete), betriebskosten: rund(betriebskosten) },
    zahlungenImMonat,
  };
}
