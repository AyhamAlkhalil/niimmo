/**
 * Entwurf eines Übergabeprotokolls auf dem Gerät.
 *
 * Am 16.10.2026 gingen bei einem Einzug zehn hochgeladene Fotos, die
 * Zählerstände und alles Übrige verloren: Der Dialog schloss sich ohne
 * Rückfrage — ein Tippen daneben, Escape oder auf dem Handy ein Wischen nach
 * unten genügte —, und mit ihm verschwand der gesamte Zustand. Dasselbe droht,
 * wenn das Handy den Browser beim Öffnen der Kamera aus dem Speicher wirft.
 *
 * Deshalb liegt jede Eingabe sofort als Entwurf im localStorage, je Vertrag und
 * Übergabeart. Beim nächsten Öffnen desselben Vertrags ist alles wieder da; nach
 * dem Speichern wird der Entwurf gelöscht. Die Fotos selbst liegen ohnehin schon
 * im Storage, der Entwurf merkt sich nur ihre Pfade.
 *
 * Bewusst nur auf dem Gerät: Ein geräteübergreifender Entwurf bräuchte die
 * Übergabe als eigenen Datensatz — das ist offene Konzeptfrage D2
 * (docs/offene-punkte.md).
 */
import type { ZaehlerEingaben } from "./uebergabeSpeicherung";

export interface UebergabeEingaben {
  /** yyyy-MM-dd */
  uebergabeDatum: string | null;
  schluessel: { haustuer: string; wohnung: string; briefkasten: string; keller: string };
  zaehlerstaende: Record<string, ZaehlerEingaben>;
  zaehlerfotos: Record<string, Partial<Record<keyof ZaehlerEingaben, string[]>>>;
  notizen: string;
  notizenFotos: string[];
  unterschriftVermieter: string | null;
  unterschriftMieter: string | null;
  versorgerAuswahl: string[];
  mieterEmails: Record<string, string>;
}

export interface UebergabeEntwurf extends UebergabeEingaben {
  version: 1;
  /** ISO-Zeitpunkt der letzten Änderung */
  gespeichertAm: string;
}

/** Die Teile von `Storage`, die hier gebraucht werden — im Test ersetzbar. */
export interface Ablage {
  getItem(schluessel: string): string | null;
  setItem(schluessel: string, wert: string): void;
  removeItem(schluessel: string): void;
}

const ZAEHLER = ["strom", "gas", "wasser", "warmwasser"] as const;

/** localStorage, falls der Browser ihn hergibt (privates Fenster, gesperrte Website-Daten: nein). */
export function browserAblage(): Ablage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function entwurfSchluessel(vertragIds: string[], isEinzug: boolean): string {
  return `niimmo-uebergabe-entwurf:${isEinzug ? "einzug" : "auszug"}:${[...vertragIds].sort().join(",")}`;
}

/** Hat jemand schon etwas erfasst, das beim Schließen verloren ginge? Das Datum allein zählt nicht. */
export function hatEingaben(e: UebergabeEingaben): boolean {
  return (
    Object.values(e.schluessel).some((s) => s.trim() !== "") ||
    Object.values(e.zaehlerstaende).some((z) => ZAEHLER.some((t) => (z[t] ?? "").trim() !== "")) ||
    Object.values(e.zaehlerfotos).some((f) => ZAEHLER.some((t) => (f[t]?.length ?? 0) > 0)) ||
    e.notizen.trim() !== "" ||
    e.notizenFotos.length > 0 ||
    !!e.unterschriftVermieter ||
    !!e.unterschriftMieter ||
    e.versorgerAuswahl.length > 0
  );
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const textOderNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const textListe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objekt = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Liest den Entwurf und bringt ihn in Form. Ein beschädigter oder fremder Eintrag
 * ergibt `null` statt eines halb gefüllten Formulars. Zählerstände und Fotos
 * werden nur für die übergebenen Verträge übernommen.
 */
export function entwurfLesen(ablage: Ablage | null, schluessel: string, vertragIds: string[]): UebergabeEntwurf | null {
  if (!ablage) return null;
  let roh: unknown;
  try {
    const wert = ablage.getItem(schluessel);
    if (!wert) return null;
    roh = JSON.parse(wert);
  } catch {
    return null;
  }
  const r = objekt(roh);
  if (r.version !== 1) return null;

  const schluesselRoh = objekt(r.schluessel);
  const staendeRoh = objekt(r.zaehlerstaende);
  const fotosRoh = objekt(r.zaehlerfotos);
  const zaehlerstaende: UebergabeEingaben["zaehlerstaende"] = {};
  const zaehlerfotos: UebergabeEingaben["zaehlerfotos"] = {};
  for (const id of vertragIds) {
    const z = objekt(staendeRoh[id]);
    zaehlerstaende[id] = { strom: text(z.strom), gas: text(z.gas), wasser: text(z.wasser), warmwasser: text(z.warmwasser) };
    const f = objekt(fotosRoh[id]);
    zaehlerfotos[id] = {};
    for (const t of ZAEHLER) {
      const pfade = textListe(f[t]);
      if (pfade.length > 0) zaehlerfotos[id][t] = pfade;
    }
  }
  const emailsRoh = objekt(r.mieterEmails);
  const mieterEmails: Record<string, string> = {};
  for (const [id, mail] of Object.entries(emailsRoh)) {
    if (typeof mail === "string") mieterEmails[id] = mail;
  }
  const datum = text(r.uebergabeDatum);

  return {
    version: 1,
    gespeichertAm: text(r.gespeichertAm),
    uebergabeDatum: /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : null,
    schluessel: {
      haustuer: text(schluesselRoh.haustuer),
      wohnung: text(schluesselRoh.wohnung),
      briefkasten: text(schluesselRoh.briefkasten),
      keller: text(schluesselRoh.keller),
    },
    zaehlerstaende,
    zaehlerfotos,
    notizen: text(r.notizen),
    notizenFotos: textListe(r.notizenFotos),
    unterschriftVermieter: textOderNull(r.unterschriftVermieter),
    unterschriftMieter: textOderNull(r.unterschriftMieter),
    versorgerAuswahl: textListe(r.versorgerAuswahl),
    mieterEmails,
  };
}

/** Schreibt den Entwurf; `false`, wenn der Browser es nicht zulässt (z. B. Speicher voll). */
export function entwurfSchreiben(ablage: Ablage | null, schluessel: string, eingaben: UebergabeEingaben, jetzt: Date): boolean {
  if (!ablage) return false;
  const entwurf: UebergabeEntwurf = { version: 1, gespeichertAm: jetzt.toISOString(), ...eingaben };
  try {
    ablage.setItem(schluessel, JSON.stringify(entwurf));
    return true;
  } catch {
    return false;
  }
}

export function entwurfLoeschen(ablage: Ablage | null, schluessel: string): void {
  try {
    ablage?.removeItem(schluessel);
  } catch {
    // Nicht entfernbar heißt auch nicht lesbar — beim nächsten Öffnen fällt er ohnehin weg
  }
}
