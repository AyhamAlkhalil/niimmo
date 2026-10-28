/**
 * Abgleich bei der Übernahme importierter Buchungen (CSV-Import).
 *
 * Bis zum 07.09.2026 fragte die Übernahme je Buchung einzeln in der Datenbank
 * nach, ob dieselbe Buchung schon existiert (Tag, Betrag, IBAN, Verwendungs-
 * zweck) und ob der Vertrag eine Bankverbindung hat — vier Datenbankrunden
 * je Zeile, gemessen rund 150 ms je Buchung, also 18 s für 122 Zeilen.
 * Jetzt werden alle bestehenden Buchungen der betroffenen Tage einmal geladen
 * und hier im Speicher abgeglichen. Die Regeln des Abgleichs sind dieselben
 * wie die der früheren Datenbankabfrage:
 *
 *   .eq('buchungsdatum', …) .eq('betrag', …)
 *   iban ? .eq('iban', iban) : .is('iban', null)
 *   verwendungszweck ? .eq(…) : .is(…, null)
 *
 * mit `iban = result.iban?.trim() || null` — ein leerer String wird zu null,
 * ein Leerstring in der Datenbank bleibt dagegen ein Leerstring und trifft
 * null nicht. Genau das bildet der Schlüssel ab.
 *
 * Seit dem 27.10.2026 wird gezählt statt gesucht: Jede Bestandsbuchung steht
 * höchstens einer Importzeile gegenüber, und eine eben eingefügte Zeile zählt
 * nicht als Bestand für die nächste. Vorher wurden zwei gleiche Überweisungen
 * am selben Tag (Tag, Betrag, IBAN, Verwendungszweck) zu einer — die zweite
 * fand die erste und aktualisierte sie, die Meldung zählte trotzdem beide.
 * Bestandsbuchungen, die process-payments schon als Duplikat einer Importzeile
 * gezählt hat, scheiden vorher aus (bestehendeAusschliessen).
 */

export interface BestehendeZahlung {
  id: string;
  kategorie: string | null;
  mietvertrag_id: string | null;
  buchungsdatum: string;
  betrag: number | string;
  iban: string | null;
  verwendungszweck: string | null;
}

export interface AbgleichMerkmale {
  buchungsdatum: string;
  betrag: number;
  iban: string | null;
  verwendungszweck: string | null;
}

/** `trim() || null` — wie die Übernahme Werte vor dem Vergleich normalisiert. */
export function normalisiereWert(wert: string | null | undefined): string | null {
  const getrimmt = wert?.trim();
  return getrimmt ? getrimmt : null;
}

const NULL_MARKE = '\u0000null';

/**
 * Schlüssel für den Abgleich. null und '' bleiben unterscheidbar; der Betrag
 * wird numerisch verglichen, wie es die Datenbank tut (850 = 850.00).
 */
export function abgleichSchluessel(m: AbgleichMerkmale | BestehendeZahlung): string {
  const betrag = Number(m.betrag);
  return [
    m.buchungsdatum,
    Number.isFinite(betrag) ? String(betrag) : String(m.betrag),
    m.iban === null ? NULL_MARKE : m.iban,
    m.verwendungszweck === null ? NULL_MARKE : m.verwendungszweck,
  ].join('|');
}

export type BestehendeIndex = Map<string, BestehendeZahlung[]>;

export function bestehendeIndexieren(zeilen: readonly BestehendeZahlung[]): BestehendeIndex {
  const index: BestehendeIndex = new Map();
  for (const zeile of zeilen) {
    const schluessel = abgleichSchluessel(zeile);
    const liste = index.get(schluessel);
    if (liste) liste.push(zeile);
    else index.set(schluessel, [zeile]);
  }
  return index;
}

/**
 * Erste bestehende Buchung mit denselben Merkmalen; sie wird dabei aus dem Index
 * genommen, damit eine weitere gleiche Importzeile sie nicht noch einmal trifft.
 */
export function nimmBestehende(index: BestehendeIndex, merkmale: AbgleichMerkmale): BestehendeZahlung | null {
  const schluessel = abgleichSchluessel(merkmale);
  const liste = index.get(schluessel);
  const zeile = liste?.shift() ?? null;
  if (liste && liste.length === 0) index.delete(schluessel);
  return zeile;
}

/** Entfernt Bestandsbuchungen, die process-payments schon als Duplikat gezählt hat. */
export function bestehendeAusschliessen(index: BestehendeIndex, ids: ReadonlySet<string>): void {
  for (const [schluessel, liste] of index) {
    const rest = liste.filter((zeile) => !ids.has(zeile.id));
    if (rest.length === 0) index.delete(schluessel);
    else index.set(schluessel, rest);
  }
}

/** Eindeutige Buchungstage einer Liste — Filter für die Vorabfrage. */
export function buchungstageVon(zeilen: ReadonlyArray<{ buchungsdatum?: string | null }>): string[] {
  return [...new Set(zeilen.map((z) => z.buchungsdatum).filter((d): d is string => Boolean(d)))].sort();
}

/** Eindeutige Vertrags-IDs, für die eine Bankverbindung nachgetragen werden könnte. */
export function vertragsIdsMitIban(zeilen: ReadonlyArray<{ mietvertrag_id?: string | null; iban?: string | null }>): string[] {
  return [...new Set(zeilen.filter((z) => z.mietvertrag_id && z.iban).map((z) => z.mietvertrag_id as string))];
}

/** IBAN der Bundesagentur (Bürgergeld): zahlt für viele Mieter, ist nie das Konto eines Mieters. */
export const JOBCENTER_IBAN = 'DE94760000000076001601';

/** Ohne Leerraum, in Großbuchstaben — so vergleicht auch process-payments (normalisiereIban). */
export function normalisiereIban(iban: string | null | undefined): string {
  return (iban ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Bankverbindungen und Mieter eines Vertrags, soweit der IBAN-Nachtrag sie braucht. */
export interface VertragsKonten {
  id: string;
  bankkonto_mieter: string | null;
  weitere_bankkonten: string | null;
  /** `id:<mieter_id>` und `name:<vorname>|<nachname>` — Verträge, die eine Kennung teilen, sind verbunden. */
  mieterKennungen: string[];
}

/**
 * Kennungen der Mieter eines Vertrags. Verbunden sind Verträge derselben Mieter (Wohnung und Garage),
 * auch wenn ein Mieter mit zwei Datensätzen im Bestand steht — dann über den vollen Namen. Vergleicht
 * wie vertraegeVerbunden in process-payments: Vor- und Nachname je für sich, NFC, getrimmt, klein
 * (28.10.2026). Ein zerlegt gespeichertes „ü“ (u + Trema) gleicht so dem zusammengesetzten.
 */
export function mieterKennungen(
  eintraege: ReadonlyArray<{ mieter_id?: string | null; mieter?: { vorname?: string | null; nachname?: string | null } | null }> | null | undefined
): string[] {
  const kennungen = new Set<string>();
  for (const e of eintraege ?? []) {
    if (e.mieter_id) kennungen.add(`id:${e.mieter_id}`);
    const vorname = (e.mieter?.vorname ?? '').normalize('NFC').trim().toLowerCase();
    const nachname = (e.mieter?.nachname ?? '').normalize('NFC').trim().toLowerCase();
    if (vorname && nachname) kennungen.add(`name:${vorname}|${nachname}`);
  }
  return [...kennungen];
}

export interface NachtragKontext {
  /** Alle Verträge mit ihren Bankverbindungen; nach jedem Nachtrag fortgeschrieben. */
  vertraege: ReadonlyArray<VertragsKonten>;
  /** IBANs, die laut process-payments für mehrere nicht verbundene Verträge zahlen (normalisiert). */
  nichtIdentifizierend: ReadonlySet<string>;
}

/**
 * IBAN, die nach der Übernahme als Bankverbindung am Vertrag nachgetragen werden darf, sonst null.
 *
 * Bis zum 27.10.2026 wurde die Zahler-IBAN jeder zugeordneten Buchung eingetragen, auch von
 * Rücklastschriften, Kautionsstellen, Sammelkonten und dem Jobcenter. Weil der IBAN-Abgleich vor dem
 * Namensabgleich läuft, schlug das falsche Konto danach den richtigen Namen: live waren zwei
 * Sammelkonten Hauptkonto von drei Verträgen, 16 Verträge trugen die Jobcenter-IBAN.
 *
 * Seit dem 28.10.2026 auch nicht, wenn die IBAN schon an einem anderen, nicht verbundenen Vertrag
 * steht oder für mehrere nicht verbundene Verträge zahlt: So wurde ein Konto der Bank für Retouren
 * und Kautionsüberträge zum Hauptkonto eines Vertrags, und jede Buchung von dort ging vorausgewählt
 * an ihn. An Wohnung und Garage derselben Mieter darf dieselbe IBAN stehen.
 */
export function ibanFuerNachtrag(
  kategorie: string | null | undefined,
  iban: string | null | undefined,
  mietvertragId: string,
  kontext: NachtragKontext
): string | null {
  if (kategorie !== 'Miete') return null;
  const normalisiert = normalisiereIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalisiert) || normalisiert === JOBCENTER_IBAN) return null;
  if (kontext.nichtIdentifizierend.has(normalisiert)) return null;
  const ziel = new Set(kontext.vertraege.find((v) => v.id === mietvertragId)?.mieterKennungen ?? []);
  const anFremdemVertrag = kontext.vertraege.some(
    (v) =>
      v.id !== mietvertragId &&
      [v.bankkonto_mieter, ...(v.weitere_bankkonten ?? '').split(',')].some((k) => normalisiereIban(k) === normalisiert) &&
      !v.mieterKennungen.some((k) => ziel.has(k))
  );
  return anFremdemVertrag ? null : normalisiert;
}

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vertrags- und Objektbezug einer Zeile vor dem Speichern: nur in UUID-Form, sonst null.
 * `verworfen` sagt, ob ein nicht leerer Bezug dabei wegfiel.
 *
 * Bis zum 28.10.2026 kam der Text "null" aus der KI als Vertrag durch, und jede solche Zeile
 * scheiterte beim Speichern an der UUID (live 37 Buchungen in 4 Importen) — die Buchung fehlte.
 * Jetzt wird sie ohne Bezug gespeichert und als nicht zuordenbar gemeldet.
 */
export function bezugPruefen(zeile: { mietvertrag_id?: string | null; immobilie_id?: string | null }): {
  mietvertrag_id: string | null;
  immobilie_id: string | null;
  verworfen: boolean;
} {
  const pruefe = (wert: string | null | undefined) => {
    const getrimmt = typeof wert === 'string' ? wert.trim() : '';
    return { id: UUID_FORM.test(getrimmt) ? getrimmt : null, verworfen: getrimmt !== '' && !UUID_FORM.test(getrimmt) };
  };
  const vertrag = pruefe(zeile.mietvertrag_id);
  const objekt = pruefe(zeile.immobilie_id);
  return { mietvertrag_id: vertrag.id, immobilie_id: objekt.id, verworfen: vertrag.verworfen || objekt.verworfen };
}
