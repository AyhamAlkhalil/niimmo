/**
 * Zentrale Rechenlogik der Betriebskostenabrechnung.
 *
 * Vorher lag diese Logik dreifach dupliziert in Step 1/2/3 mit abweichenden
 * Ergebnissen. Alle Verteilungen laufen jetzt durch dieses Modul.
 *
 * Kernregeln:
 *  - Nutzungsende eines Vertrags ist das FRÜHESTE gesetzte Datum aus
 *    {ende_datum, kuendigungsdatum} — nach diesem Tag nutzt der Mieter nicht mehr.
 *  - Kostenpositionen werden über ihren Zeitraum-Überlappungsanteil eingerechnet,
 *    nicht nach dem Kalenderjahr gefiltert (Heizperioden laufen jahresübergreifend).
 *  - Der Personen-Schlüssel rechnet über echte Personentage. Der Zeitanteil steckt
 *    dort bereits in der Bezugsgröße und darf nicht ein zweites Mal multipliziert werden.
 *  - Leerstandszeiträume werden als eigene Zeilen geführt, damit sich alle Anteile
 *    auf 100 % summieren und Leerstandskosten beim Eigentümer bleiben (BGH-Linie).
 */

import { differenceInCalendarDays, parseISO } from "date-fns";

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
 * Tatsächliches Nutzungsende eines Mietvertrags.
 * `kuendigungsdatum` ist das Datum, ZU dem gekündigt wurde (nicht das Datum des
 * Kündigungsschreibens) — es beendet den Vertrag also genauso wie `ende_datum`.
 * Maßgeblich ist das frühere der beiden gesetzten Daten.
 */
export function vertragsNutzungsende(
  endeDatum: string | null | undefined,
  kuendigungsdatum: string | null | undefined,
  fallback: Date
): Date {
  const ende = parseDatum(endeDatum);
  const kuendigung = parseDatum(kuendigungsdatum);
  if (ende && kuendigung) return ende < kuendigung ? ende : kuendigung;
  return ende ?? kuendigung ?? fallback;
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
      return bezug.personentage > 0
        ? (periode.personen * periode.tage) / bezug.personentage
        : 0;
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
  monatsbetrag: number,
  von: Date,
  bis: Date
): { betrag: number; monate: number } {
  if (monatsbetrag === 0) return { betrag: 0, monate: 0 };

  let monate = 0;
  const cursor = new Date(von.getFullYear(), von.getMonth(), 1);

  while (cursor <= bis) {
    const monatsStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monatsEnde = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const tageImMonat = monatsEnde.getDate();

    const overlap = ueberlappung(monatsStart, monatsEnde, von, bis);
    if (overlap) {
      monate += overlap.tage >= tageImMonat ? 1 : overlap.tage / tageImMonat;
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { betrag: monatsbetrag * monate, monate };
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
