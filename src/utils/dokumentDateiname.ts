/**
 * Dateiname beim Herunterladen eines Dokuments.
 *
 * Bis zum 23.10.2026 hieß die Datei schlicht wie der Titel. Titel enden oft auf
 * ein Datum („Übergabeprotokoll – 01.10.2026"), der Browser hielt dann „.2026"
 * für die Endung, und die Datei ließ sich nicht per Doppelklick öffnen. Die
 * Endung steht verlässlich im Storage-Pfad: useDocumentUpload legt sie über
 * dateiendung() an.
 */

/** Endung aus dem Storage-Pfad, klein geschrieben; null, wenn keine erkennbar ist. */
export function endungAusPfad(pfad: string | null | undefined): string | null {
  const name = (pfad ?? "").split("/").pop() ?? "";
  const punkt = name.lastIndexOf(".");
  // Ein Punkt ganz vorn ist ein versteckter Dateiname, keine Endung
  if (punkt <= 0) return null;
  const endung = name.slice(punkt + 1).toLowerCase();
  // Gleiche Grenze wie dateiendung() beim Hochladen
  return /^[a-z0-9]{1,5}$/.test(endung) ? endung : null;
}

/**
 * Titel plus Endung aus dem Pfad, falls der Titel sie nicht schon trägt.
 * Ohne Titel gilt der Dateiname aus dem Pfad, ohne beides „dokument".
 */
export function downloadDateiname(titel: string | null | undefined, pfad: string | null | undefined): string {
  const endung = endungAusPfad(pfad);
  const ausPfad = (pfad ?? "").split("/").pop()?.trim() ?? "";
  const name = (titel ?? "").trim() || ausPfad || "dokument";
  if (!endung) return name;
  if (name.toLowerCase().endsWith(`.${endung}`)) return name;
  return `${name}.${endung}`;
}
