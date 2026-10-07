import type { Partei } from "./ansicht3dTypen";

/** Etage ohne die Füllzeichen aus der Datenbank. */
export function etageText(partei: Partei): string {
  const text = (partei.einheit.etage ?? "").replace(/\s+/g, " ").trim();
  return text || partei.einheit.einheitentyp || "ohne Lageangabe";
}

/** Wer dort wohnt — oder „Leerstand". */
export function mieterText(partei: Partei): string {
  if (partei.zustand.status === "leer") return "Leerstand";
  if (partei.mieter.length === 0) return "Keine Mieter zugeordnet";
  return partei.mieter.length > 2 ? `${partei.mieter.slice(0, 2).join(", ")} +${partei.mieter.length - 2}` : partei.mieter.join(", ");
}
