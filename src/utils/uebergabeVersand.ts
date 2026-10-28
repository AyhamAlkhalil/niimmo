/**
 * Nachträglicher Versand eines gespeicherten Übergabeprotokolls (seit 28.10.2026).
 *
 * Bis dahin gingen Mail an den Mieter und Benachrichtigung der Versorger nur, solange
 * der Übergabe-Dialog nach dem Speichern offen war. Wer ihn schloss, hatte keinen Weg
 * mehr — und ein Klick auf den Vertrag in der Liste begann ein neues, leeres Protokoll.
 * Hier steht, was sich für ein gespeichertes Protokoll aus der Datenbank wiederherstellen
 * lässt: welches Protokoll, welches Übergabedatum, welche Zählerstände, und an wen es
 * schon ging (Tabelle `mails`, die send-uebergabe-email vor und nach jedem Versand schreibt).
 */
import { format, isValid } from "date-fns";
import { datumAusTitel, istProtokollPdf, protokollArt, type ProtokollZeile, type UebergabeArt } from "./uebergabeProtokolle";
import { mailadressen } from "./uebergabeMail";

export interface VersandProtokoll {
  pfad: string;
  titel: string | null;
  /** Aus Titel oder Pfad; null bei Scans ohne „Einzug“/„Auszug“ im Namen — dann muss gewählt werden */
  art: UebergabeArt | null;
  hochgeladenAm: string | null;
}

const zeitwert = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Die PDF-Protokolle eines Vertrags, das zuletzt hochgeladene zuerst, und welches
 * vorgewählt ist: das ausdrücklich gewünschte (Zeile im Dokumente-Tab), sonst das
 * jüngste der gewünschten Art — dieselbe Regel wie der Listenhinweis „…protokoll vom …
 * vorhanden“ (letzteProtokolle), damit hinter dem Hinweis auch dieses Protokoll steht.
 */
export function protokolleEinesVertrags(
  zeilen: ProtokollZeile[],
  art: UebergabeArt | null,
  gewuenscht?: string | null
): { liste: VersandProtokoll[]; vorauswahl: string | null } {
  const jePfad = new Map<string, VersandProtokoll>();
  for (const z of zeilen) {
    if (!z.pfad || !istProtokollPdf(z)) continue;
    const bisher = jePfad.get(z.pfad);
    // Dieselbe Datei doppelt eingetragen: einmal zeigen, mit dem jüngeren Eintrag
    if (bisher && zeitwert(bisher.hochgeladenAm) >= zeitwert(z.hochgeladen_am)) continue;
    jePfad.set(z.pfad, { pfad: z.pfad, titel: z.titel, art: protokollArt(z.titel, z.pfad), hochgeladenAm: z.hochgeladen_am });
  }
  const liste = [...jePfad.values()].sort((a, b) => zeitwert(b.hochgeladenAm) - zeitwert(a.hochgeladenAm));
  if (gewuenscht && liste.some((p) => p.pfad === gewuenscht)) return { liste, vorauswahl: gewuenscht };
  // Ist eine Art verlangt und gibt es keine, wird nichts vorgewählt: Ein Einzugsprotokoll als
  // Auszugsmeldung an die Versorger wäre falsch, und ein Scan ohne Art muss gewählt werden.
  const vorauswahl = art ? (liste.find((p) => p.art === art)?.pfad ?? null) : (liste[0]?.pfad ?? null);
  return { liste, vorauswahl };
}

export interface ProtokollAblesung {
  zaehler_typ: string;
  stand: number | string | null;
  datum: string;
  protokoll_pfad: string | null;
  mietvertrag_id: string | null;
}

export type DatumQuelle = "historie" | "titel" | "hochgeladen";

/**
 * Das Übergabedatum für Betreff und Text der Mails. Der Pfad taugt dafür nicht: Er trägt
 * den Tag des Speicherns. Reihenfolge: die Ablesungen dieses Protokolls (ein Tag), das
 * Datum im Titel, zuletzt der Tag des Hochladens — den muss die Oberfläche als unsicher
 * kennzeichnen, er kann Monate nach der Übergabe liegen.
 */
export function uebergabeDatumFuer(
  protokoll: Pick<VersandProtokoll, "pfad" | "titel" | "hochgeladenAm">,
  ablesungen: ProtokollAblesung[]
): { datum: string; quelle: DatumQuelle } | null {
  const tage = [...new Set(ablesungen.filter((a) => a.protokoll_pfad === protokoll.pfad).map((a) => a.datum))];
  if (tage.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(tage[0])) return { datum: tage[0], quelle: "historie" };
  const ausTitel = datumAusTitel(protokoll.titel);
  if (ausTitel) return { datum: ausTitel, quelle: "titel" };
  if (protokoll.hochgeladenAm) {
    // Kalendertag in Ortszeit, nicht toISOString: zwischen 0 und 2 Uhr wäre das der Vortag
    const d = new Date(protokoll.hochgeladenAm);
    if (isValid(d)) return { datum: format(d, "yyyy-MM-dd"), quelle: "hochgeladen" };
  }
  return null;
}

/** Zähler der Versorger-Mail; `wasser` meint Kaltwasser wie im Übergabeformular */
// Als Map: Ein zaehler_typ wie "__proto__" oder "constructor" träfe in einem Objekt den Prototyp
const VERSORGER_ZAEHLER = new Map<string, "strom" | "gas" | "wasser">([
  ["strom", "strom"],
  ["gas", "gas"],
  ["kaltwasser", "wasser"],
]);

/**
 * Die Zählerstände eines gespeicherten Protokolls für den Text an die Versorger, aus der
 * Ablesehistorie (protokoll_pfad, seit 22.10.2026). Fehlt ein Stand, bleibt er weg — der
 * Dialog schreibt dann „nicht erfasst“. Bewusst kein Rückgriff auf die Stände am Vertrag:
 * Die können vom PDF abweichen, und an den Versorger geht, was im Protokoll steht.
 */
export function versorgerStaende(
  ablesungen: ProtokollAblesung[],
  pfad: string,
  vertragId: string | null
): { strom?: string; gas?: string; wasser?: string } {
  const eigene = ablesungen.filter((a) => a.protokoll_pfad === pfad);
  // Bei mehreren Verträgen an einem Protokoll die Stände des eigenen zuerst
  const sortiert = [...eigene].sort((a, b) => Number(b.mietvertrag_id === vertragId) - Number(a.mietvertrag_id === vertragId));
  const ergebnis: { strom?: string; gas?: string; wasser?: string } = {};
  for (const a of sortiert) {
    const feld = VERSORGER_ZAEHLER.get(a.zaehler_typ);
    // Leerzeichen zählen als leer: Number("   ") ergäbe 0 und damit einen erfundenen Stand
    if (!feld || ergebnis[feld] !== undefined || a.stand === null || (typeof a.stand === "string" && a.stand.trim() === "")) continue;
    const zahl = typeof a.stand === "number" ? a.stand : Number(a.stand);
    if (!Number.isFinite(zahl)) continue;
    // Wie zaehlerstandText: Dezimalkomma, kein Tausenderpunkt — „12.345“ läse jeder als zwölftausend
    ergebnis[feld] = zahl.toLocaleString("de-DE", { maximumFractionDigits: 6, useGrouping: false });
  }
  return ergebnis;
}

export interface VersandMail {
  status: string;
  empfaenger: string[] | null;
  gesendet_am: string | null;
  erstellt_am: string;
  fehler: string | null;
  nutzlast: unknown;
}

export interface Versorgeradresse {
  typ: string;
  email: string | null;
}

export interface VersandStand {
  /** Alle Adressen, die eine Mieter-Mail zu diesem Protokoll bekommen haben (auch CC) */
  mieter: { adressen: string[]; am: Date | null; beliefert: boolean };
  /** Je Versorger (strom/gas/wasser) die Adressen, die die Benachrichtigung haben */
  versorger: Record<string, { adressen: string[]; am: Date | null }>;
  /** Versorger, bei denen jede hinterlegte Adresse die Mail hat */
  benachrichtigt: Set<string>;
  /** Versandläufe, die nie abgeschlossen wurden (Function brach ab) — Ausgang unbekannt */
  unklar: number;
}

const VERSORGER_TYPEN = new Set(["strom", "gas", "wasser"]);

type Rolle = "mieter" | "cc" | "strom" | "gas" | "wasser" | "unbekannt";

/**
 * Steht die Adresse als abgelehnt im Fehlertext? send-uebergabe-email schreibt ihn als
 * „adresse: Grund; adresse: Grund“. Die Adresse muss am Anfang eines Abschnitts stehen —
 * ein bloßes includes("mueller@x.de:") träfe auch das Endstück von „hans.mueller@x.de:“.
 */
function imFehlertext(fehler: string | null, adresse: string): boolean {
  if (!fehler) return false;
  const maskiert = adresse.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|;\\s*)${maskiert}:`, "i").test(fehler);
}

const textListe = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

function rollenAusNutzlast(nutzlast: unknown): Map<string, Rolle> | null {
  const n = nutzlast && typeof nutzlast === "object" ? (nutzlast as Record<string, unknown>) : null;
  if (!n || !Array.isArray(n.empfaenger)) return null;
  const rollen = new Map<string, Rolle>();
  for (const e of n.empfaenger) {
    const email = (e as { email?: unknown })?.email;
    const rolle = (e as { rolle?: unknown })?.rolle;
    if (typeof email !== "string") continue;
    rollen.set(email.toLowerCase(), typeof rolle === "string" && ["mieter", "cc", "strom", "gas", "wasser"].includes(rolle) ? (rolle as Rolle) : "unbekannt");
  }
  return rollen;
}

/**
 * Wer ein Protokoll schon hat — aus den Zeilen in `mails` mit diesem Anhang. Seit
 * 28.10.2026 legt send-uebergabe-email je Empfänger die Rolle und das Ergebnis in
 * `nutzlast` ab; ältere Zeilen tragen nur die Empfängerliste und den Fehlertext, dort
 * wird über die Adresse zugeordnet (Versorger-Adresse am Objekt, sonst Mieter-Mail).
 *
 * „Beliefert“ heißt wie im Übergabe-Dialog: Jede als Mieter adressierte Adresse hat die
 * Mail — eine angekommene CC-Kopie allein informiert den Mieter nicht.
 */
export function versandStand(mails: VersandMail[], mieterAdressen: string[], versorger: Versorgeradresse[]): VersandStand {
  const mieterKlein = new Set(mieterAdressen.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const versorgerJeAdresse = new Map<string, string>();
  for (const v of versorger) for (const a of mailadressen(v.email) ?? []) versorgerJeAdresse.set(a.toLowerCase(), v.typ);

  const mieterAn = new Map<string, string>();
  let mieterAm: Date | null = null;
  const mieterAdressiert = new Set<string>();
  const mieterZugestellt = new Set<string>();
  const versorgerAn: Record<string, { adressen: Map<string, string>; am: Date | null }> = {};
  let unklar = 0;

  for (const mail of mails) {
    if (mail.status === "entwurf") {
      unklar++;
      continue;
    }
    if (mail.status !== "gesendet") continue;
    const empfaenger = mail.empfaenger ?? [];
    const n = mail.nutzlast && typeof mail.nutzlast === "object" ? (mail.nutzlast as Record<string, unknown>) : {};
    // Ältere Zeilen: zugestellt ist, wer nicht im Fehlertext („adresse: Grund; …“) steht
    const zugestellt = textListe(n.zugestellt) ?? empfaenger.filter((a) => !imFehlertext(mail.fehler, a));
    const rollen = rollenAusNutzlast(mail.nutzlast);
    const rolleVon = (adresse: string): Rolle => {
      const klein = adresse.toLowerCase();
      const ausNutzlast = rollen?.get(klein);
      if (ausNutzlast) return ausNutzlast;
      const typ = versorgerJeAdresse.get(klein);
      if (typ) return typ as Rolle;
      return mieterKlein.has(klein) ? "mieter" : "cc";
    };
    const am = mail.gesendet_am ? new Date(mail.gesendet_am) : new Date(mail.erstellt_am);
    const zeit = isValid(am) ? am : null;
    for (const adresse of empfaenger) if (rolleVon(adresse) === "mieter") mieterAdressiert.add(adresse.toLowerCase());
    for (const adresse of zugestellt) {
      const rolle = rolleVon(adresse);
      if (VERSORGER_TYPEN.has(rolle)) {
        const eintrag = (versorgerAn[rolle] ??= { adressen: new Map(), am: null });
        eintrag.adressen.set(adresse.toLowerCase(), adresse);
        if (zeit && (!eintrag.am || zeit > eintrag.am)) eintrag.am = zeit;
        continue;
      }
      mieterAn.set(adresse.toLowerCase(), adresse);
      if (rolle === "mieter") mieterZugestellt.add(adresse.toLowerCase());
      if (zeit && (!mieterAm || zeit > mieterAm)) mieterAm = zeit;
    }
  }

  const versorgerStand: VersandStand["versorger"] = {};
  for (const [typ, e] of Object.entries(versorgerAn)) versorgerStand[typ] = { adressen: [...e.adressen.values()], am: e.am };

  // Wie im Versorger-Dialog: benachrichtigt erst, wenn jede hinterlegte Adresse die Mail hat
  const benachrichtigt = new Set<string>();
  for (const v of versorger) {
    const geliefert = versorgerAn[v.typ]?.adressen;
    if (!geliefert || geliefert.size === 0) continue;
    const hinterlegt = mailadressen(v.email);
    if (!hinterlegt || hinterlegt.every((a) => geliefert.has(a.toLowerCase()))) benachrichtigt.add(v.typ);
  }

  return {
    mieter: {
      adressen: [...mieterAn.values()],
      am: mieterAm,
      beliefert: mieterAdressiert.size > 0 && [...mieterAdressiert].every((a) => mieterZugestellt.has(a)),
    },
    versorger: versorgerStand,
    benachrichtigt,
    unklar,
  };
}
