/**
 * Pfade im Storage-Bucket `dokumente`.
 *
 * Supabase Storage nimmt in Objektpfaden nur ASCII an (storage-api `isValidKey`,
 * `\w` meint dort nur ASCII). Ein „ü" oder „é" lässt den Upload mit
 * `400 InvalidKey` scheitern — am 17.10.2026 gegen den Live-Storage geprüft.
 * Übergabe, Mahnung, Kündigung und Mieterhöhung legten den Mieternamen in den
 * Pfad und waren für die Mieter mit Umlaut im Namen nie speicherbar.
 *
 * Regel: Pfade nie aus Namen oder Gerätedateinamen bauen, sondern aus
 * Vertrags-ID, Art, Datum und Uhrzeit (docs/architektur.md §6).
 */
import { format } from "date-fns";

/** Zeichen, die Supabase Storage in Objektpfaden annimmt. */
export const STORAGE_PFAD = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

/**
 * Ablageort eines erzeugten Schriftstücks, z. B.
 * `mahnungen/<vertrag>/Mahnung_Stufe2_2026-10-17_142233.pdf`. Die Uhrzeit
 * trennt zwei Schreiben desselben Tages — mit dem Datum allein überschrieb das
 * zweite still das erste.
 */
export function schriftstueckPfad(ordner: string, vertragId: string, name: string, jetzt: Date): string {
  return `${ordner}/${vertragId}/${name}_${format(jetzt, "yyyy-MM-dd")}_${format(jetzt, "HHmmss")}.pdf`;
}

/**
 * Dateiendung für einen Upload. Der Dateiname kommt vom Gerät; ohne Punkt wäre
 * der ganze Name die „Endung" und mit ihm jedes Sonderzeichen im Pfad.
 */
export function dateiendung(dateiname: string, mimeTyp: string, ersatz = "jpg"): string {
  const ausName = dateiname.includes(".") ? (dateiname.split(".").pop() ?? "").toLowerCase() : "";
  if (/^[a-z0-9]{1,5}$/.test(ausName)) return ausName;
  const ausTyp = (mimeTyp.split(";")[0].split("/")[1] ?? "").trim().toLowerCase().replace(/^jpeg$/, "jpg");
  if (/^[a-z0-9]{1,5}$/.test(ausTyp)) return ausTyp;
  return ersatz;
}
