/**
 * Versand einer Mahnung per E-Mail oder per Post (28.10.2026).
 *
 * Bis dahin stieg die Mahnstufe nur durch Mailversand. 34 von 98 laufenden Verträgen haben keine
 * Mailadresse: Dort stieg sie nie, Stufe 3 (fristlose Kündigung) war unerreichbar, und jedes
 * Schreiben hieß wieder „1. Mahnung“. Jetzt merkt `send-mahnung` das Schreiben beim Speichern vor
 * (Tabelle `mahnung_versand`) und bucht danach den Mailversand oder „per Post versandt“ — auch
 * später, wenn der Dialog neu geöffnet wird. Die Function prüft alles selbst; die Regeln hier
 * dienen der Oberfläche und sind dieselben.
 */
export type Versandart = "email" | "post";

/**
 * Tage zwischen Aufgabe zur Post und Zugang beim Mieter. Eine Erklärung unter Abwesenden wird mit
 * dem Zugang wirksam (§ 130 Abs. 1 BGB); eine gesetzliche Zugangsfiktion gibt es im Zivilrecht nicht,
 * drei Tage sind die übliche Annahme (für Verwaltungsakte gilt seit 2025 der vierte Tag, § 41 Abs. 2
 * VwVfG — hier bewusst nicht). Derselbe Wert steht in send-mahnung; sendMahnung.test.ts vergleicht beide.
 */
export const POST_ZUGANG_TAGE = 3;

/** Höchstzahl der Empfänger einer Mahnungsmail; send-mahnung lehnt mehr ab. */
export const MAX_EMPFAENGER = 5;

/** Sendungsnummer eines Einschreibens: Buchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich. */
export const SENDUNGSNUMMER = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,63}$/;

/**
 * Ein Versand, der so lange in 'wird_versendet' steht, gilt als abgebrochen und darf geklärt werden
 * (HAENGT_NACH_MS in send-mahnung; vorher könnte er noch laufen).
 */
export const HAENGT_NACH_MS = 15 * 60 * 1000;

const BERLINER_TAG = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Kalendertag (JJJJ-MM-TT) eines Zeitpunkts in Berlin, unabhängig von der Zeitzone des Rechners —
 * dieselbe Rechnung wie berlinerIsoTag in send-mahnung (28.10.2026). Mit der Ortszeit des Rechners
 * nannten Datumsgrenzen und Vergleiche im Dialog andere Tage als die Function.
 */
export function berlinerKalendertag(zeitpunkt: Date = new Date()): string {
  const teile = Object.fromEntries(BERLINER_TAG.formatToParts(zeitpunkt).map((t) => [t.type, t.value]));
  return `${teile.year}-${teile.month}-${teile.day}`;
}

/** JJJJ-MM-TT um `tage` Kalendertage verschoben; über UTC-Mittag, damit keine Zeitumstellung stört. */
export function tagPlus(isoTag: string, tage: number): string {
  const [jahr, monat, tag] = isoTag.split("-").map(Number);
  return new Date(Date.UTC(jahr, monat - 1, tag + tage, 12)).toISOString().slice(0, 10);
}

/** Voraussichtlicher Zugang eines Briefs, der an `aufgabeIso` zur Post gegeben wurde. */
export const zugangBeiPost = (aufgabeIso: string): string => tagPlus(aufgabeIso, POST_ZUGANG_TAGE);

/** Ganze Kalendertage von `vonIso` bis `bisIso` (negativ, wenn `bisIso` davor liegt). */
export function tageZwischen(vonIso: string, bisIso: string): number {
  const ms = (iso: string) => {
    const [jahr, monat, tag] = iso.split("-").map(Number);
    return Date.UTC(jahr, monat - 1, tag);
  };
  return Math.round((ms(bisIso) - ms(vonIso)) / 86_400_000);
}

/** TT.MM.JJJJ → JJJJ-MM-TT und zurück */
export const isoAusDeutsch = (datum: string): string => datum.split(".").reverse().join("-");
export const deutschAusIso = (iso: string): string => iso.split("-").reverse().join(".");

/** Ohne Mailadresse bleibt nur die Post. */
export const vorgabeVersandart = (adressen: string[]): Versandart => (adressen.length > 0 ? "email" : "post");

/**
 * Vorgaben für Zahlungs- und Räumungsfrist. Das Schreiben nennt feste Tage ab dem Tag des Schreibens;
 * per Post beginnen die Fristen aber erst mit dem Zugang. Ohne Mailadresse enthalten die Vorgaben
 * deshalb die Postlaufzeit (7 → 10, 14 → 17 Tage).
 */
export function fristVorgaben(versandart: Versandart): { zahlungsfristTage: string; raeumungsfristTage: string } {
  const zuschlag = versandart === "post" ? POST_ZUGANG_TAGE : 0;
  return { zahlungsfristTage: String(7 + zuschlag), raeumungsfristTage: String(14 + zuschlag) };
}

/**
 * Prüfung vor der Buchung „per Post versandt“, gleich wie in send-mahnung: Aufgabe frühestens am
 * Tag des Schreibens und nicht in der Zukunft; Zahlungsfrist und (Stufe 3) Räumungsende nicht vor
 * dem Zugang. Liefert die Meldung oder null.
 */
export function postversandFehler(p: {
  aufgabeIso: string;
  schreibtagIso: string;
  heuteIso: string;
  fristIso: string;
  raeumungsendeIso?: string | null;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.aufgabeIso)) return "Bitte das Datum der Aufgabe zur Post angeben.";
  if (p.aufgabeIso > p.heuteIso) return "Das Datum der Aufgabe zur Post liegt in der Zukunft.";
  if (p.aufgabeIso < p.schreibtagIso) {
    return `Das Schreiben ist vom ${deutschAusIso(p.schreibtagIso)}; es kann nicht vorher zur Post gegeben worden sein.`;
  }
  const zugang = zugangBeiPost(p.aufgabeIso);
  if (p.fristIso < zugang) {
    return `Die Zahlungsfrist im Schreiben (${deutschAusIso(p.fristIso)}) endet vor dem Zugang am ${deutschAusIso(zugang)}. Bitte ein neues Schreiben mit längerer Frist erstellen.`;
  }
  if (p.raeumungsendeIso && p.raeumungsendeIso < zugang) {
    return `Das Räumungsende im Schreiben (${deutschAusIso(p.raeumungsendeIso)}) liegt vor dem Zugang am ${deutschAusIso(zugang)}. Bitte ein neues Schreiben mit längerer Räumungsfrist erstellen.`;
  }
  return null;
}

/** Leer ist erlaubt (einfacher Brief); sonst nur die Zeichen einer Sendungsnummer. */
export function sendungsnummerFehler(text: string): string | null {
  const wert = text.trim();
  if (wert === "") return null;
  return SENDUNGSNUMMER.test(wert) ? null : "Die Sendungsnummer darf nur Buchstaben, Ziffern, Leerzeichen, Punkt und Bindestrich enthalten (höchstens 64 Zeichen).";
}

export interface KuendigungsFelder {
  status: "gekuendigt";
  kuendigungsdatum: string;
  ende_datum: string;
}

/** Beträge eines Schreibens, wie send-mahnung sie mit der Vormerkung speichert (Spalte betraege). */
export interface SchreibenBetraege {
  gesamtRueckstand: number;
  mahnkostenGesamt: number;
  verzugszinsenGesamt: number;
  zahlungsfristTage: number;
}

/** Was der Versandschritt vom gespeicherten Schreiben braucht (Teil von MahnungPdfData). */
export interface SchreibenKern {
  gesamtRueckstand: number;
  mahnkostenGesamt: number;
  verzugszinsenGesamt: number;
  zahlungsfristTage?: number;
  /** Tag des Schreibens, TT.MM.JJJJ */
  datum: string;
  /** Zahlungsfrist im Schreiben, TT.MM.JJJJ */
  zahlungsfristDatum: string;
}

/** Zeile aus mahnung_versand mit status 'vorgemerkt' */
export interface MahnungVormerkung {
  id: string;
  stufe: number;
  dokument_pfad: string;
  zahlungsfrist: string;
  kuendigung: KuendigungsFelder | null;
  betraege: Partial<SchreibenBetraege> | null;
  erstellt_am: string;
}

/** Beträge für die Vormerkung; die Vorgabe 7 Tage wie im Schreiben (mahnungPdfGenerator). */
export const betraegeDesSchreibens = (d: SchreibenKern): SchreibenBetraege => ({
  gesamtRueckstand: d.gesamtRueckstand,
  mahnkostenGesamt: d.mahnkostenGesamt,
  verzugszinsenGesamt: d.verzugszinsenGesamt,
  zahlungsfristTage: d.zahlungsfristTage ?? 7,
});

/**
 * Kündigungsfelder einer Vormerkung beim (späteren) Versand — dieselbe Regel wie
 * pruefeVorgemerkteKuendigung in send-mahnung: Räumungsende nicht vor heute bzw. bei Post nicht vor
 * dem Zugang (`fruehestensIso`), Kündigungsdatum nicht nach dem Räumungsende und nicht vor heute.
 *
 * kuendigungsdatum ist hier der Tag, ZU dem gekündigt ist (fristloseKuendigungFelder setzt es auf das
 * Räumungsende), nicht der Tag der Erklärung: Der Nachtlauf beendet jeden Vertrag mit
 * kuendigungsdatum vor heute. Eine solche Vormerkung bleibt deshalb bis zum Räumungsende versendbar.
 * Liefert die Meldung oder null.
 */
export function vorgemerkteKuendigungFehler(
  k: Partial<KuendigungsFelder> | null | undefined,
  heuteIso: string,
  fruehestensIso: string = heuteIso,
): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!k || k.status !== "gekuendigt") return "Der Vertragsstatus der Kündigung fehlt.";
  const kuendigungsdatum = (k.kuendigungsdatum ?? "").slice(0, 10);
  const ende = (k.ende_datum ?? "").slice(0, 10);
  if (!iso.test(kuendigungsdatum) || !iso.test(ende)) return "Kündigungsdatum oder Vertragsende ist kein gültiges Datum.";
  if (ende < fruehestensIso) {
    return fruehestensIso > heuteIso ? "Das Räumungsende im Schreiben liegt vor dem Zugang." : "Das Räumungsende im Schreiben ist schon vorbei.";
  }
  if (kuendigungsdatum > ende) return "Das Vertragsende liegt vor dem Kündigungsdatum.";
  if (kuendigungsdatum < heuteIso) return "Das Kündigungsdatum im Schreiben liegt in der Vergangenheit; der Vertrag würde sofort beendet.";
  return null;
}

/**
 * Die Vormerkung, die der Dialog zum Versand anbietet: Stufe = gespeicherte Stufe + 1, nicht veraltet
 * (Frist nicht vor heute, bei Stufe 3 dieselbe Regel wie send-mahnung: vorgemerkteKuendigungFehler),
 * Schreiben noch unter Dokumente; die jüngste. Veraltete Vormerkungen werden nicht angeboten — auch keine, deren
 * Rückstand nicht mehr dem heutigen entspricht: Hat der Mieter seither gezahlt, ginge sonst das alte Schreiben mit
 * dem alten Betrag hinaus, bei Stufe 3 samt Kündigung (§ 543 Abs. 2 S. 2 BGB; Prüfung 29.10.2026).
 */
export function angeboteneVormerkung(
  zeilen: MahnungVormerkung[],
  stufe: number,
  heuteIso: string,
  vorhandenePfade: Set<string>,
  aktuellerRueckstand?: number,
): MahnungVormerkung | null {
  const passend = zeilen.filter(
    (v) =>
      Number(v.stufe) === stufe &&
      !!v.zahlungsfrist &&
      v.zahlungsfrist.slice(0, 10) >= heuteIso &&
      (stufe < 3 || vorgemerkteKuendigungFehler(v.kuendigung, heuteIso) === null) &&
      vorhandenePfade.has(v.dokument_pfad) &&
      (aktuellerRueckstand === undefined ||
        (typeof v.betraege?.gesamtRueckstand === 'number' &&
          Math.abs(v.betraege.gesamtRueckstand - aktuellerRueckstand) < 0.005)),
  );
  passend.sort((a, b) => (a.erstellt_am < b.erstellt_am ? 1 : a.erstellt_am > b.erstellt_am ? -1 : 0));
  return passend[0] ?? null;
}

/** Stand des Versandschritts aus einer Vormerkung, wenn der Dialog neu geöffnet wurde. */
export function versandStandAusVormerkung(v: MahnungVormerkung): {
  pfad: string;
  daten: SchreibenKern;
  fristIso: string;
  kuendigung: KuendigungsFelder | null;
} {
  const zahl = (wert: unknown) => (typeof wert === "number" && Number.isFinite(wert) ? wert : 0);
  const fristIso = v.zahlungsfrist.slice(0, 10);
  return {
    pfad: v.dokument_pfad,
    daten: {
      gesamtRueckstand: zahl(v.betraege?.gesamtRueckstand),
      mahnkostenGesamt: zahl(v.betraege?.mahnkostenGesamt),
      verzugszinsenGesamt: zahl(v.betraege?.verzugszinsenGesamt),
      zahlungsfristTage: zahl(v.betraege?.zahlungsfristTage) || 7,
      datum: deutschAusIso(berlinerKalendertag(new Date(v.erstellt_am))),
      zahlungsfristDatum: deutschAusIso(fristIso),
    },
    fristIso,
    kuendigung: v.kuendigung
      ? { status: "gekuendigt", kuendigungsdatum: v.kuendigung.kuendigungsdatum.slice(0, 10), ende_datum: v.kuendigung.ende_datum.slice(0, 10) }
      : null,
  };
}

/** Eine Zeile mit status 'versendet' für die Vertragsansicht */
export interface MahnungVersandZeile {
  stufe: number;
  versandart: Versandart;
  versendet_am: string;
  erstellt_von: string | null;
  sendungsnummer?: string | null;
}

/** „Stufe 2 · per Post am 28.10.2026“ — die Person setzt die Ansicht dazu. */
export function versandZeileText(z: MahnungVersandZeile): string {
  const weg = z.versandart === "post" ? "per Post" : "per E-Mail";
  return `Stufe ${z.stufe} · ${weg} am ${deutschAusIso(z.versendet_am.slice(0, 10))}`;
}

/**
 * Eindeutige Ablehnung durch send-mahnung (4xx): Eine Wiederholung ändert nichts. Netz, Zeitlimit und
 * 5xx sind unklar — dort darf der Dialog einmal wiederholen, weil Vormerken idempotent ist.
 */
export function istAblehnung(fehler: unknown): boolean {
  const status = (fehler as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Zeile aus mahnung_versand mit status 'wird_versendet' (beansprucht, aber nicht abgeschlossen) */
export interface UnklarerVersand {
  id: string;
  stufe: number;
  dokument_pfad: string;
  versandart: Versandart;
  erstellt_am: string;
  aktualisiert_am: string;
}

/**
 * Ein beanspruchter, nicht abgeschlossener Versand (Absturz, Zeitlimit). Der Dialog bietet ihn nicht
 * erneut zum Versand an, sondern zeigt „Versand unklar“; klären lässt er sich erst, wenn er nicht mehr
 * laufen kann (HAENGT_NACH_MS seit der letzten Änderung). Liefert die jüngste Zeile und ab wann.
 */
export function unklarerVersand(
  zeilen: UnklarerVersand[],
  jetzt: Date = new Date(),
): { zeile: UnklarerVersand; klaerbarAb: Date; klaerbar: boolean } | null {
  const sortiert = [...zeilen].sort((a, b) => (a.aktualisiert_am < b.aktualisiert_am ? 1 : -1));
  const zeile = sortiert[0];
  if (!zeile) return null;
  const klaerbarAb = new Date(Date.parse(zeile.aktualisiert_am) + HAENGT_NACH_MS);
  return { zeile, klaerbarAb, klaerbar: jetzt.getTime() >= klaerbarAb.getTime() };
}
