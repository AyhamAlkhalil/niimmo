/**
 * Zentrale Rechenlogik der Betriebskostenabrechnung.
 *
 * Vorher lag diese Logik dreifach dupliziert in Step 1/2/3 mit abweichenden
 * Ergebnissen. Alle Verteilungen laufen jetzt durch dieses Modul.
 *
 * Kernregeln:
 *  - Nutzungsende eines Vertrags ist das Vertragsende wie getVertragsende(): ende_datum,
 *    sonst kuendigungsdatum (seit 30.10.2026; vorher das frühere der beiden).
 *  - Kostenpositionen werden über ihren Zeitraum-Überlappungsanteil eingerechnet,
 *    nicht nach dem Kalenderjahr gefiltert (Heizperioden laufen jahresübergreifend).
 *  - Der Personen-Schlüssel rechnet über echte Personentage. Der Zeitanteil steckt
 *    dort bereits in der Bezugsgröße und darf nicht ein zweites Mal multipliziert werden.
 *  - Leerstandszeiträume werden als eigene Zeilen geführt, damit sich alle Anteile
 *    auf 100 % summieren und Leerstandskosten beim Eigentümer bleiben (BGH-Linie).
 */

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { getVertragsende } from "@/utils/contractUtils";

export type VerteilerSchluessel = "qm" | "personen" | "gleich";

/** Tage inklusive beider Endpunkte. */
export function tageInZeitraum(von: Date, bis: Date): number {
  return Math.max(0, differenceInCalendarDays(bis, von) + 1);
}

export function parseDatum(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Alle Positionen, die den Zeitraum berühren — inkl. jahresübergreifender Rechnungen.
 *
 * Kalendertag über format(), nicht toISOString(): parseISO('2026-01-01') ist lokale
 * Mitternacht, toISOString() machte daraus in deutscher Zeit '2025-12-31'. Bis zum
 * 27.10.2026 erschienen so alle Vorjahrespositionen mit Ende 31.12. im Folgejahr (mit
 * vollem Betrag in den Kategoriesummen von Schritt 1, und „Aufteilen“ schrieb sie mit
 * um), und eine Position, die am 31.12. beginnt, fiel aus der Abrechnung.
 */
export function positionenImZeitraum<T extends { zeitraum_von: string; zeitraum_bis: string }>(
  positionen: T[] | undefined,
  von: Date,
  bis: Date
): T[] {
  if (!positionen) return [];
  const vonTag = format(von, "yyyy-MM-dd");
  const bisTag = format(bis, "yyyy-MM-dd");
  return positionen.filter((p) => p.zeitraum_von <= bisTag && p.zeitraum_bis >= vonTag);
}

/** Schnittmenge zweier Zeiträume, oder null wenn sie sich nicht überlappen. */
export function ueberlappung(
  aVon: Date,
  aBis: Date,
  bVon: Date,
  bBis: Date
): { von: Date; bis: Date; tage: number } | null {
  const von = aVon > bVon ? aVon : bVon;
  const bis = aBis < bBis ? aBis : bBis;
  if (von > bis) return null;
  return { von, bis, tage: tageInZeitraum(von, bis) };
}

/**
 * Tatsächliches Nutzungsende eines Mietvertrags: das Vertragsende aus getVertragsende() — `ende_datum` führt,
 * `kuendigungsdatum` nur als Ersatz. Bis zum 30.10.2026 galt das frühere der beiden; lag das Räumungsende
 * (ende_datum) nach dem Kündigungstermin, fehlten Kosten und Vorauszahlungen der Monate dazwischen, die das Mietkonto
 * verlangt hat. Sollstellung, Mietkonto und Vertragsablauf rechnen alle mit dem Vertragsende.
 */
export function vertragsNutzungsende(
  endeDatum: string | null | undefined,
  kuendigungsdatum: string | null | undefined,
  fallback: Date
): Date {
  return parseDatum(getVertragsende({ ende_datum: endeDatum, kuendigungsdatum })) ?? fallback;
}

/**
 * Anteil einer Kostenposition, der in den Abrechnungszeitraum fällt.
 * Eine Rechnung über 01.07.–30.06. geht damit zur Hälfte in jedes Kalenderjahr ein,
 * statt (wie bisher) in keines von beiden.
 */
export function kostenAnteilImZeitraum(
  position: { zeitraum_von: string; zeitraum_bis: string; gesamtbetrag: number },
  abrVon: Date,
  abrBis: Date
): number {
  const von = parseDatum(position.zeitraum_von);
  const bis = parseDatum(position.zeitraum_bis);
  if (!von || !bis) return 0;

  const positionsTage = tageInZeitraum(von, bis);
  if (positionsTage === 0) return 0;

  const overlap = ueberlappung(von, bis, abrVon, abrBis);
  if (!overlap) return 0;

  if (overlap.tage >= positionsTage) return position.gesamtbetrag;
  return (position.gesamtbetrag * overlap.tage) / positionsTage;
}

/** Eine Nutzungsperiode im Abrechnungszeitraum — Mietvertrag oder Leerstand. */
export interface Nutzungsperiode {
  einheitId: string;
  qm: number;
  /** Bewohner laut Mietvertrag. Bei Leerstand 0, bei ungepflegtem Vertrag ebenfalls 0. */
  personen: number;
  /**
   * false, wenn am Mietvertrag keine Personenzahl hinterlegt ist. Dann fehlt die
   * Bezugsgröße für den Personentage-Schlüssel und die Abrechnung der gesamten
   * Immobilie ist nicht belegbar — es wird bewusst nichts geschätzt.
   */
  personenGepflegt: boolean;
  /**
   * true, wenn die Periode Leerstand ist. Leerstand steuert keine Personentage
   * bei — daran hängt, ob eine fehlende Personenzahl das Ergebnis überhaupt
   * verändern kann.
   */
  istLeerstand: boolean;
  von: Date;
  bis: Date;
  tage: number;
}

export interface Bezugsgroessen {
  /** Gesamtfläche aller Einheiten der Immobilie. */
  qm: number;
  /** Anzahl Einheiten der Immobilie. */
  einheiten: number;
  /** Summe aus Personen × Tage über alle Nutzungsperioden inkl. Leerstand. */
  personentage: number;
  /** Tage des Abrechnungszeitraums. */
  gesamtTage: number;
  /** Nutzungsperioden mit Mietvertrag, also ohne Leerstand. */
  belegtePerioden: number;
}

export function berechneBezugsgroessen(
  einheiten: { qm: number | null }[],
  perioden: Nutzungsperiode[],
  gesamtTage: number
): Bezugsgroessen {
  return {
    qm: einheiten.reduce((sum, e) => sum + (e.qm || 0), 0),
    einheiten: einheiten.length,
    personentage: perioden.reduce((sum, p) => sum + p.personen * p.tage, 0),
    gesamtTage,
    belegtePerioden: perioden.filter((p) => !p.istLeerstand).length,
  };
}

/**
 * Anteil einer Nutzungsperiode an den Gesamtkosten einer Kategorie (0..1).
 *
 * Bei `personen` ist der Zeitanteil bereits in den Personentagen enthalten;
 * bei `qm` und `gleich` wird er separat multipliziert. Über alle Perioden
 * (inkl. Leerstand) summiert sich das Ergebnis auf 1.
 */
export function berechneAnteil(
  periode: Nutzungsperiode,
  schluessel: VerteilerSchluessel,
  bezug: Bezugsgroessen
): number {
  const zeitanteil = bezug.gesamtTage > 0 ? periode.tage / bezug.gesamtTage : 0;

  switch (schluessel) {
    case "personen":
      if (bezug.personentage > 0) {
        return (periode.personen * periode.tage) / bezug.personentage;
      }
      // Gibt es im Abrechnungszeitraum nur eine belegte Periode, trägt sie die
      // nach Personentagen verteilten Kosten zwangsläufig allein — Leerstand
      // steuert 0 Personentage bei. Der Schlüssel ist dann auch ohne gepflegte
      // Personenzahl eindeutig (Kundenmeldung 10.09.2026, Einfamilienhaus).
      return bezug.belegtePerioden === 1 && !periode.istLeerstand ? 1 : 0;
    case "gleich":
      return bezug.einheiten > 0 ? (1 / bezug.einheiten) * zeitanteil : 0;
    case "qm":
    default:
      return bezug.qm > 0 ? (periode.qm / bezug.qm) * zeitanteil : 0;
  }
}

/** Bezugsgröße, die im PDF als "Einheiten gesamt" bzw. "Ihre Einheiten" erscheint. */
export function bezugsgroesseFuerSchluessel(
  schluessel: VerteilerSchluessel,
  periode: Nutzungsperiode,
  bezug: Bezugsgroessen
): { gesamt: number; anteilig: number } {
  switch (schluessel) {
    case "personen":
      return { gesamt: bezug.personentage, anteilig: periode.personen * periode.tage };
    case "gleich":
      return { gesamt: bezug.einheiten, anteilig: 1 };
    case "qm":
    default:
      return { gesamt: bezug.qm, anteilig: periode.qm };
  }
}

/**
 * Trägt diese Periode die nach Personentagen verteilten Kosten allein, weil es
 * im Abrechnungszeitraum keine zweite belegte Periode gibt?
 *
 * Nur für die Beschriftung im Schriftstück gedacht: Der gespeicherte
 * Verteilerschlüssel bleibt `personen`. Im Druck steht statt einer leeren
 * Bezugsgröße "Alleinnutzung" — sonst sähe der Mieter einen Betrag ohne jede
 * Begründung, weil es ohne gepflegte Personenzahl keine Personentage gibt.
 */
export function istAlleinnutzung(
  schluessel: VerteilerSchluessel,
  periode: Nutzungsperiode,
  bezug: Bezugsgroessen
): boolean {
  // Bewusst als Verneinung von "> 0" formuliert, exakt wie die Fallunterscheidung
  // in berechneAnteil — sonst könnten Beschriftung und Betrag auseinanderlaufen.
  return (
    schluessel === "personen" &&
    !(bezug.personentage > 0) &&
    bezug.belegtePerioden === 1 &&
    !periode.istLeerstand
  );
}

/**
 * Ist die Personenzahl der Mietverträge für diese Abrechnung überhaupt nötig?
 *
 * Nein, solange nur eine einzige belegte Nutzungsperiode im Zeitraum liegt: Sie
 * trägt die nach Personentagen verteilten Kosten dann zu 100 %, gleich wie viele
 * Personen dort wohnen. Erst ab zwei belegten Perioden bestimmt die Zahl das
 * Verhältnis untereinander — dann fehlt ohne sie die Bezugsgröße und es wird
 * bewusst nichts geschätzt.
 */
export function personenzahlErforderlich(bezug: Bezugsgroessen): boolean {
  return bezug.belegtePerioden > 1;
}

/**
 * Geleistete Betriebskosten-Vorauszahlungen im Nutzungszeitraum, monatsgenau.
 *
 * Bisher wurde `monatsbetrag * 12 * zeitanteil` gerechnet — bei unterjährigem
 * Ein-/Auszug weicht das vom tatsächlich gezahlten Betrag ab, weil Vorauszahlungen
 * monatlich anfallen, nicht tagesanteilig. Angebrochene Monate werden hier
 * tagesanteilig gewichtet, volle Monate zählen voll.
 *
 * Hinweis: Das ist die SOLL-Vorauszahlung. Die tatsächlich geleisteten Zahlungen
 * lassen sich nicht ableiten, weil Bankbewegungen nicht in Kalt-/Betriebskosten
 * aufgeteilt vorliegen. Offene Forderungen werden im UI separat ausgewiesen.
 */
export function berechneVorauszahlungen(
  monatsbetrag: number | ((monat: string) => number),
  von: Date,
  bis: Date
): { betrag: number; monate: number; abschnitte: VorauszahlungsAbschnitt[] } {
  // Seit 30.10.2026 auch je Monat (betriebskostenImMonat): Bis dahin galt der heutige Betrag für das ganze Jahr, nach
  // einer Anpassung (§ 560 BGB, Mieterhöhung) also rückwirkend auch für Monate, in denen das Mietkonto den alten verlangte
  const betragIm = typeof monatsbetrag === 'function' ? monatsbetrag : () => monatsbetrag;
  let monate = 0;
  const abschnitte: VorauszahlungsAbschnitt[] = [];
  const cursor = new Date(von.getFullYear(), von.getMonth(), 1);

  while (cursor <= bis) {
    const monatsStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monatsEnde = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const tageImMonat = monatsEnde.getDate();

    const overlap = ueberlappung(monatsStart, monatsEnde, von, bis);
    if (overlap) {
      const anteil = overlap.tage >= tageImMonat ? 1 : overlap.tage / tageImMonat;
      const imMonat = betragIm(format(monatsStart, 'yyyy-MM'));
      monate += anteil;
      const letzter = abschnitte[abschnitte.length - 1];
      if (letzter && letzter.monatsbetrag === imMonat) letzter.monate += anteil;
      else abschnitte.push({ monate: anteil, monatsbetrag: imMonat });
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Je Abschnitt Betrag × Monate: Bei gleichbleibender Vorauszahlung genau wie bis zum 30.10.2026
  const betrag = abschnitte.reduce((summe, a) => summe + a.monatsbetrag * a.monate, 0);
  if (betrag === 0) return { betrag: 0, monate: 0, abschnitte: [] };
  return { betrag, monate, abschnitte };
}

/** Monate mit gleicher Vorauszahlung, in zeitlicher Folge */
export interface VorauszahlungsAbschnitt {
  monate: number;
  monatsbetrag: number;
}

/** Eine Änderung der Betriebskosten-Vorauszahlung am Vertrag (Tabelle betriebskosten_verlauf, seit 30.10.2026) */
export interface BetriebskostenAenderung {
  /** Erster Monat (JJJJ-MM-01), ab dem die Monatsmieten den neuen Betrag tragen */
  gueltig_ab: string;
  betriebskosten_alt: number | string | null;
  betriebskosten_neu: number | string | null;
  created_at: string;
}

/**
 * Vorauszahlung, die das Mietkonto im Monat (JJJJ-MM) verlangt hat: die Änderungen in der Reihenfolge, in der sie
 * erfasst wurden, jede ab ihrem gueltig_ab. Vor der ersten gilt deren alter Betrag, ohne Verlauf der heutige.
 * Änderungen vor dem 30.10.2026 sind nicht erfasst — dafür bleibt es beim heutigen Betrag.
 */
export function betriebskostenImMonat(
  aktuell: number | string | null | undefined,
  verlauf: readonly BetriebskostenAenderung[] | undefined,
  monat: string
): number {
  const aenderungen = [...(verlauf ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (aenderungen.length === 0) return Number(aktuell) || 0;
  let betrag = Number(aenderungen[0].betriebskosten_alt) || 0;
  for (const a of aenderungen) {
    if (a.gueltig_ab.slice(0, 7) <= monat) betrag = Number(a.betriebskosten_neu) || 0;
  }
  return betrag;
}

/** „12 Monate × 240,00 €“, nach einer Anpassung „8 Monate × 240,00 € + 4 Monate × 260,00 €“ */
export function vorauszahlungText(abschnitte: readonly VorauszahlungsAbschnitt[], einheit = 'Monate'): string {
  const zahl = (n: number) => (Number.isInteger(n) ? `${n}` : n.toLocaleString('de-DE', { maximumFractionDigits: 2 }));
  const euro = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return abschnitte.map((a) => `${zahl(a.monate)} ${einheit} × ${euro(a.monatsbetrag)} €`).join(' + ');
}

/**
 * Ermittelt Nutzungsperioden einer Einheit: je Mietvertrag eine Periode, dazu
 * Leerstandsperioden für jede Lücke im Abrechnungszeitraum.
 *
 * Verträge müssen nach Nutzungsbeginn sortiert übergeben werden.
 */
export interface VertragFuerPeriode {
  id: string;
  start_datum: string | null;
  ende_datum: string | null;
  kuendigungsdatum?: string | null;
  anzahl_personen?: number | null;
}

export interface PeriodenErgebnis {
  vertragsPerioden: (Nutzungsperiode & { mietvertragId: string })[];
  leerstandsPerioden: Nutzungsperiode[];
  /** Zeiträume, in denen sich zwei Verträge derselben Einheit überschneiden. */
  ueberschneidungen: { vertragA: string; vertragB: string }[];
}

export function ermittlePerioden(
  einheit: { id: string; qm: number | null },
  vertraege: VertragFuerPeriode[],
  abrVon: Date,
  abrBis: Date
): PeriodenErgebnis {
  const qm = einheit.qm || 0;

  const vertragsPerioden: (Nutzungsperiode & { mietvertragId: string })[] = [];
  const ueberschneidungen: { vertragA: string; vertragB: string }[] = [];

  const sortiert = [...vertraege]
    .map((mv) => {
      const start = parseDatum(mv.start_datum) ?? abrVon;
      const ende = vertragsNutzungsende(mv.ende_datum, mv.kuendigungsdatum, abrBis);
      return { mv, start, ende };
    })
    .filter(({ start, ende }) => start <= abrBis && ende >= abrVon)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (let i = 0; i < sortiert.length; i++) {
    const { mv, start, ende } = sortiert[i];
    const overlap = ueberlappung(start, ende, abrVon, abrBis);
    if (!overlap) continue;

    // Die Personenzahl gehört zum Mietvertrag, nicht zur Einheit: sie beschreibt,
    // wer dort wohnt, nicht die Wohnung. Ein Rückgriff auf einheiten.anzahl_personen
    // würde die Belegung der Wohnung einem Vertrag zuschreiben, zu dem sie nicht
    // gehört — deshalb wird hier bewusst nichts ersetzt.
    const personen = mv.anzahl_personen ?? 0;

    vertragsPerioden.push({
      mietvertragId: mv.id,
      einheitId: einheit.id,
      qm,
      personen,
      personenGepflegt: personen > 0,
      istLeerstand: false,
      von: overlap.von,
      bis: overlap.bis,
      tage: overlap.tage,
    });

    const naechster = sortiert[i + 1];
    if (naechster && naechster.start <= ende) {
      ueberschneidungen.push({ vertragA: mv.id, vertragB: naechster.mv.id });
    }
  }

  // Leerstand = jede Lücke zwischen den belegten Perioden.
  const leerstandsPerioden: Nutzungsperiode[] = [];
  let cursor = new Date(abrVon);

  for (const periode of vertragsPerioden) {
    if (periode.von > cursor) {
      const luekeEnde = new Date(periode.von);
      luekeEnde.setDate(luekeEnde.getDate() - 1);
      const tage = tageInZeitraum(cursor, luekeEnde);
      if (tage > 0) {
        leerstandsPerioden.push({
          einheitId: einheit.id,
          qm,
          // Leerstand hat keine Bewohner — 0 Personentage ist hier ein echter
          // Wert, kein fehlender.
          personen: 0,
          personenGepflegt: true,
          istLeerstand: true,
          von: new Date(cursor),
          bis: luekeEnde,
          tage,
        });
      }
    }
    const naechsterTag = new Date(periode.bis);
    naechsterTag.setDate(naechsterTag.getDate() + 1);
    if (naechsterTag > cursor) cursor = naechsterTag;
  }

  if (cursor <= abrBis) {
    const tage = tageInZeitraum(cursor, abrBis);
    if (tage > 0) {
      leerstandsPerioden.push({
        einheitId: einheit.id,
        qm,
        personen: 0,
        personenGepflegt: true,
        istLeerstand: true,
        von: new Date(cursor),
        bis: new Date(abrBis),
        tage,
      });
    }
  }

  return { vertragsPerioden, leerstandsPerioden, ueberschneidungen };
}

/** Ende der Einwendungsfrist nach § 556 Abs. 3 BGB: 12 Monate nach Ablauf des Zeitraums. */
export function abrechnungsfristEnde(abrechnungsjahr: number): Date {
  return new Date(abrechnungsjahr + 1, 11, 31);
}

/**
 * Abgerechnet wird erst nach Ablauf des Jahres (Prüfung 29.10.2026): Für das laufende Jahr rechnete die Abrechnung
 * die Vorauszahlungen aller zwölf Monate an, auch die noch nicht fälligen, bei erst teilweise gebuchten Kosten —
 * jeder Mieter hatte ein Scheinguthaben (live Wolfsburg 11 × −8.939,61 €), und „Alle BKA-Salden eintragen“ war frei.
 */
export function istAbrechnungsjahrAbgelaufen(abrechnungsjahr: number, heute: Date = new Date()): boolean {
  return heute.getFullYear() > abrechnungsjahr;
}

/**
 * Garagen und Stellplätze tragen keine Betriebskosten des Hauses (live hat keiner der 23 Verträge eine Vorauszahlung)
 * und zählen weder als Einheit noch mit Fläche oder Personen (Prüfung 29.10.2026: Sarstedt war gesperrt, weil sechs
 * Stellplätze keine Wohnfläche haben; in Wolfsburg trugen zwei Garagen je 17,36 € Heiz- und Grundsteuerkosten).
 */
export function traegtBetriebskosten(einheitentyp: string | null | undefined): boolean {
  return einheitentyp !== 'Garage' && einheitentyp !== 'Stellplatz';
}

/**
 * Bei Pauschal- und Inklusivmiete wird nicht abgerechnet (§ 556 Abs. 2 BGB): keine Nachzahlung, kein Guthaben; der
 * Kostenanteil bleibt beim Vermieter. Bis zum 30.10.2026 bekamen auch diese Verträge eine Abrechnung (live noch keiner).
 */
export function ohneBetriebskostenabrechnung(
  modus: string | null | undefined
): 'pauschale' | 'inklusiv' | null {
  return modus === 'pauschale' || modus === 'inklusiv' ? modus : null;
}

/**
 * BetrKV-Nummern („2.1“ … „2.17“), die der Vertrag ausdrücklich nicht umlegt (betriebskosten_positionen mit
 * umgelegt: false). Ihr Anteil bleibt beim Vermieter. Nicht aufgeführte Arten bleiben wie bisher umgelegt.
 */
export function nichtUmgelegteNummern(positionen: unknown): Set<string> {
  const nummern = new Set<string>();
  if (!Array.isArray(positionen)) return nummern;
  for (const p of positionen) {
    if (p && typeof p === 'object' && (p as { umgelegt?: unknown }).umgelegt === false) {
      const nummer = (p as { nummer?: unknown }).nummer;
      if (typeof nummer === 'string' && nummer.trim()) nummern.add(nummer.trim());
    }
  }
  return nummern;
}

export function istAbrechnungsfristAbgelaufen(
  abrechnungsjahr: number,
  heute: Date = new Date()
): boolean {
  return heute > abrechnungsfristEnde(abrechnungsjahr);
}

// ─── Adressen ─────────────────────────────────────────────────────────────────

export interface ObjektAdresse {
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  ort?: string | null;
  /** Freitextfeld aus dem Altbestand, Format "PLZ Ort, Straße Hausnummer". */
  adresse?: string | null;
}

/**
 * Objektadresse als Briefanschrift (Straße zuerst, dann PLZ und Ort).
 *
 * Das Freitextfeld `immobilien.adresse` führt PLZ und Ort VORAN
 * ("29227 Celle, Burger Landstraße 18"). Wer es an Kommas zerlegt und den ersten
 * Teil als Straße nimmt, erzeugt eine vertauschte Anschrift. Deshalb werden die
 * atomisierten Felder bevorzugt; das Freitextfeld dient nur als Notnagel.
 */
export function objektAdresseZeilen(objekt: ObjektAdresse): string[] {
  const strasse = [objekt.strasse, objekt.hausnummer].filter(Boolean).join(" ").trim();
  const plzOrt = [objekt.plz, objekt.ort].filter(Boolean).join(" ").trim();

  if (strasse && plzOrt) return [strasse, plzOrt];
  if (strasse) return [strasse];
  if (plzOrt) return [plzOrt];

  // Kein atomisierter Datensatz: Freitext unverändert übernehmen, statt ihn zu
  // zerlegen und dabei womöglich falsch zu sortieren.
  const freitext = (objekt.adresse || "").trim();
  return freitext ? [freitext] : [];
}

/** Einzeilige Objektbezeichnung für Betreff und Kopfzeilen. */
export function objektAdresseEinzeilig(objekt: ObjektAdresse): string {
  const zeilen = objektAdresseZeilen(objekt);
  return zeilen.length > 0 ? zeilen.join(", ") : "";
}

/**
 * Zerlegt die vom Mieter angegebene Nachsendeadresse in Zeilen. Sie ist ein
 * freies Textfeld und wird deshalb nur an Umbrüchen und Kommas getrennt.
 */
export function nachsendeAdresseZeilen(anschrift: string | null | undefined): string[] {
  if (!anschrift) return [];
  return anschrift
    .split(/[\n,]/)
    .map((z) => z.trim())
    .filter(Boolean);
}

/**
 * Verteilt exakte Centbeträge auf ganze Cent, sodass die Summe genau der gerundeten Gesamtsumme
 * entspricht: abrunden, Restcent an die größten Reste. Bis zum 27.10.2026 wurden die Anteile einer
 * Kostenart einzeln gerundet und Anteile unter 1 Cent verworfen; die Summe wich um Cent ab
 * (Heizkosten 243,00 € verteilt als 243,02 €).
 */
export function aufCentVerteilen(exakteCent: readonly number[]): number[] {
  const werte = exakteCent.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const unten = werte.map((w) => Math.floor(w + 1e-9));
  let rest = Math.round(werte.reduce((a, b) => a + b, 0)) - unten.reduce((a, b) => a + b, 0);
  const reihenfolge = werte
    .map((w, i) => ({ i, bruch: w - unten[i] }))
    .sort((a, b) => b.bruch - a.bruch || a.i - b.i);
  for (const { i } of reihenfolge) {
    if (rest <= 0) break;
    unten[i] += 1;
    rest -= 1;
  }
  return unten;
}
