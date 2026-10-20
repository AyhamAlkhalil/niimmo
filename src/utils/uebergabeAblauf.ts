/**
 * Geführter Ablauf der Übergabe (20.10.2026): Schritte, ihr Zustand und die
 * Plausibilitätshinweise zu den Zählerständen.
 *
 * Bis dahin war die Übergabe ein einziges langes Formular. Auf dem Handy lagen
 * Unterschriften und Speichern weit unten, der Mieter unterschrieb, ohne die
 * erfassten Werte vor sich zu haben, und ein Tippfehler im Zählerstand fiel
 * erst in der Abrechnung auf. Der Ablauf führt, sperrt aber nicht: Jeder
 * Schritt ist direkt anwählbar, gesperrt wird nur das Speichern — und nur bei
 * dem, was das Protokoll falsch machen würde (kein Datum, unlesbarer Stand).
 */
import { format, isValid, parseISO } from "date-fns";
import { parseZaehlerstand, istGueltigeZaehlerstandEingabe } from "./zaehlerstandUtils";

export const UEBERGABE_SCHRITTE = ["allgemein", "zaehler", "zustand", "unterschriften", "pruefen"] as const;
export type UebergabeSchritt = (typeof UEBERGABE_SCHRITTE)[number];

export const SCHRITT_TITEL: Record<UebergabeSchritt, string> = {
  allgemein: "Datum & Schlüssel",
  zaehler: "Zählerstände",
  zustand: "Zustand",
  unterschriften: "Unterschriften",
  pruefen: "Prüfen & Speichern",
};

export function istUebergabeSchritt(wert: unknown): wert is UebergabeSchritt {
  return typeof wert === "string" && (UEBERGABE_SCHRITTE as readonly string[]).includes(wert);
}

export const ZAEHLER_TYPEN = ["strom", "gas", "wasser", "warmwasser"] as const;
export type ZaehlerTyp = (typeof ZAEHLER_TYPEN)[number];

export const ZAEHLER_BEZEICHNUNG: Record<ZaehlerTyp, string> = {
  strom: "Strom",
  gas: "Gas",
  wasser: "Kaltwasser",
  warmwasser: "Warmwasser",
};

export const ZAEHLER_EINHEIT: Record<ZaehlerTyp, string> = {
  strom: "kWh",
  gas: "m³",
  wasser: "m³",
  warmwasser: "m³",
};

/** In der Datenbank heißt Kaltwasser `kaltwasser` (Historie, Einheit, Vertrag). */
export const ZAEHLER_DB_TYP: Record<ZaehlerTyp, string> = {
  strom: "strom",
  gas: "gas",
  wasser: "kaltwasser",
  warmwasser: "warmwasser",
};

/** Bekannter Stand eines Zählers, gegen den eine neue Ablesung geprüft wird. */
export interface Referenzstand {
  stand: number;
  /** yyyy-MM-dd; fehlt beim Einzugsstand ohne Vertragsbeginn */
  datum: string | null;
  quelle: "einzug" | "ablesung";
}

/**
 * Jüngster bekannter Stand vor (oder am) Übergabetag: die letzte Ablesung aus
 * der Historie oder — beim Auszug — der Einzugsstand des Vertrags. Spätere
 * Ablesungen zählen nicht; sie wären für eine nachträglich erfasste Übergabe
 * kein Maßstab.
 */
export function referenzstand(
  ablesungen: Array<{ stand: number | null; datum: string | null }>,
  einzug: { stand: number | null; datum: string | null } | null,
  uebergabeDatum: string | null
): Referenzstand | null {
  // Nur der Tag zählt — ein Zeitstempel am Übergabetag ist kein späterer Stand
  const tag = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
  const kandidaten: Referenzstand[] = [];
  for (const a of ablesungen) {
    if (a.stand === null || !Number.isFinite(a.stand)) continue;
    const datum = tag(a.datum);
    if (uebergabeDatum && datum && datum > uebergabeDatum) continue;
    kandidaten.push({ stand: a.stand, datum, quelle: "ablesung" });
  }
  if (einzug && einzug.stand !== null && Number.isFinite(einzug.stand)) {
    const datum = tag(einzug.datum);
    if (!(uebergabeDatum && datum && datum > uebergabeDatum)) {
      kandidaten.push({ stand: einzug.stand, datum, quelle: "einzug" });
    }
  }
  if (kandidaten.length === 0) return null;
  // Jüngstes Datum gewinnt; ohne Datum nur, wenn sonst nichts da ist
  return kandidaten.reduce((beste, k) => {
    if (!beste.datum) return k.datum ? k : beste;
    if (!k.datum) return beste;
    return k.datum > beste.datum ? k : beste;
  });
}

/** „der letzte bekannte Stand (4.711,5 kWh am 01.04.2026)" */
export function referenzText(referenz: Referenzstand, einheit: string): string {
  const geparst = referenz.datum ? parseISO(referenz.datum) : null;
  const datum = geparst && isValid(geparst) ? ` am ${format(geparst, "dd.MM.yyyy")}` : "";
  const stand = referenz.stand.toLocaleString("de-DE", { maximumFractionDigits: 3 });
  return `${referenz.quelle === "einzug" ? "der Einzugsstand" : "der letzte bekannte Stand"} (${stand} ${einheit}${datum})`;
}

export type ZaehlerHinweisArt = "unlesbar" | "foto_ohne_stand" | "kleiner" | "sprung";

export interface ZaehlerHinweis {
  art: ZaehlerHinweisArt;
  /** blockiert das Speichern */
  sperrt: boolean;
}

/**
 * Hinweise zu einem Zählerfeld. Nur „unlesbar" sperrt das Speichern — der Rest
 * sind Rückfragen an den Menschen vor dem Zähler: Ein kleinerer Stand kann ein
 * Zählertausch sein, ein Sprung ein vergessenes Komma.
 */
export function zaehlerHinweise(eingabe: string | undefined, fotos: number, referenz: Referenzstand | null): ZaehlerHinweis[] {
  if (!istGueltigeZaehlerstandEingabe(eingabe)) return [{ art: "unlesbar", sperrt: true }];
  const wert = parseZaehlerstand(eingabe ?? "");
  if (wert === null) return fotos > 0 ? [{ art: "foto_ohne_stand", sperrt: false }] : [];
  if (!referenz) return [];
  if (wert < referenz.stand) return [{ art: "kleiner", sperrt: false }];
  // Zehnfach und mindestens 1000 darüber: typisch für ein fehlendes Komma
  if (referenz.stand > 0 && wert >= referenz.stand * 10 && wert - referenz.stand >= 1000) return [{ art: "sprung", sperrt: false }];
  return [];
}

export type SchrittZustand = "ok" | "hinweis" | "fehler";

export interface AblaufEingaben {
  uebergabeDatum: string | null;
  /** je Vertrag und Zähler die Eingabe */
  zaehlerstaende: Record<string, Partial<Record<ZaehlerTyp, string>>>;
  /** je Vertrag und Zähler die Zahl der Fotos */
  zaehlerfotos: Record<string, Partial<Record<ZaehlerTyp, number>>>;
  /** je Vertrag und Zähler der Vergleichsstand */
  referenzen?: Record<string, Partial<Record<ZaehlerTyp, Referenzstand | null>>>;
  unterschriftVermieter: boolean;
  unterschriftMieter: boolean;
}

export interface Pruefpunkt {
  schritt: UebergabeSchritt;
  art: SchrittZustand;
  text: string;
}

const anzahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

/**
 * Alles, was vor dem Speichern auffällt — nach Schritt geordnet. Ein Punkt
 * der Art „fehler" sperrt das Speichern.
 */
export function pruefpunkte(e: AblaufEingaben, vertragIds: string[]): Pruefpunkt[] {
  const punkte: Pruefpunkt[] = [];
  if (!e.uebergabeDatum) punkte.push({ schritt: "allgemein", art: "fehler", text: "Kein Übergabedatum gewählt." });

  let erfasst = 0;
  let gesamt = 0;
  let unlesbar = 0;
  let fotoOhneStand = 0;
  let auffaellig = 0;
  for (const id of vertragIds) {
    for (const typ of ZAEHLER_TYPEN) {
      gesamt++;
      const eingabe = e.zaehlerstaende[id]?.[typ];
      const hinweise = zaehlerHinweise(eingabe, e.zaehlerfotos[id]?.[typ] ?? 0, e.referenzen?.[id]?.[typ] ?? null);
      if (parseZaehlerstand(eingabe ?? "") !== null && istGueltigeZaehlerstandEingabe(eingabe)) erfasst++;
      for (const h of hinweise) {
        if (h.art === "unlesbar") unlesbar++;
        else if (h.art === "foto_ohne_stand") fotoOhneStand++;
        else auffaellig++;
      }
    }
  }
  if (unlesbar > 0) {
    punkte.push({ schritt: "zaehler", art: "fehler", text: `${anzahl(unlesbar, "Zählerstand ist", "Zählerstände sind")} nicht als Zahl lesbar.` });
  }
  if (fotoOhneStand > 0) {
    punkte.push({ schritt: "zaehler", art: "hinweis", text: `${anzahl(fotoOhneStand, "Zähler hat", "Zähler haben")} ein Foto, aber keinen Stand.` });
  }
  if (auffaellig > 0) {
    punkte.push({ schritt: "zaehler", art: "hinweis", text: `${anzahl(auffaellig, "Zählerstand weicht", "Zählerstände weichen")} auffällig vom letzten bekannten Stand ab.` });
  }
  if (erfasst === 0) {
    punkte.push({ schritt: "zaehler", art: "hinweis", text: "Kein Zählerstand erfasst." });
  } else if (unlesbar === 0 && fotoOhneStand === 0 && auffaellig === 0) {
    punkte.push({ schritt: "zaehler", art: "ok", text: `${erfasst} von ${gesamt} Zählerständen erfasst.` });
  }

  if (!e.unterschriftVermieter || !e.unterschriftMieter) {
    const fehlen = [!e.unterschriftVermieter && "Vermieter", !e.unterschriftMieter && "Mieter"].filter(Boolean).join(" und ");
    punkte.push({ schritt: "unterschriften", art: "hinweis", text: `Unterschrift fehlt: ${fehlen}.` });
  } else {
    punkte.push({ schritt: "unterschriften", art: "ok", text: "Beide Seiten haben unterschrieben." });
  }
  return punkte;
}

/** Zustand je Schritt für die Schrittleiste: der schlechteste seiner Prüfpunkte. */
export function schrittZustaende(punkte: Pruefpunkt[]): Record<UebergabeSchritt, SchrittZustand> {
  const rang: Record<SchrittZustand, number> = { ok: 0, hinweis: 1, fehler: 2 };
  const zustaende: Record<UebergabeSchritt, SchrittZustand> = {
    allgemein: "ok",
    zaehler: "ok",
    zustand: "ok",
    unterschriften: "ok",
    pruefen: "ok",
  };
  for (const p of punkte) {
    if (rang[p.art] > rang[zustaende[p.schritt]]) zustaende[p.schritt] = p.art;
  }
  return zustaende;
}

/** Bausteine für die Notizen — ein Tipp hängt den Satz an. */
export const NOTIZ_BAUSTEINE = [
  "Keine Mängel festgestellt.",
  "Wohnung besenrein übergeben.",
  "Rauchwarnmelder vorhanden und geprüft.",
  "Alle Räume gemeinsam begangen.",
];

/** Hängt einen Baustein als neue Zeile an, ohne ihn zu verdoppeln. */
export function bausteinAnhaengen(notizen: string, baustein: string): string {
  if (notizen.split("\n").some((z) => z.trim() === baustein)) return notizen;
  const basis = notizen.replace(/\s+$/, "");
  return basis ? `${basis}\n${baustein}` : baustein;
}
