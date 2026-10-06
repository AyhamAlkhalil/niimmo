import { formatCurrency } from "@/utils/contractUtils";
import { formatDateForDisplay } from "@/utils/dateUtils";
import type { ParteiStatus } from "@/utils/ansicht3d/parteiStatus";
import type { Partei } from "./ansicht3dTypen";

/** Statusfarben der Oberfläche — dieselben Rollen wie in der Szene. */
export const STATUS_KLASSEN: Record<ParteiStatus, { chip: string; balken: string; punkt: string }> = {
  vermietet: { chip: "bg-success/10 text-success border-success/25", balken: "bg-foreground/20", punkt: "bg-success" },
  gekuendigt: { chip: "bg-warning/10 text-warning border-warning/30", balken: "bg-warning", punkt: "bg-warning" },
  kommend: { chip: "bg-primary/10 text-primary border-primary/25", balken: "bg-primary", punkt: "bg-primary" },
  leer: { chip: "bg-destructive/10 text-destructive border-destructive/25", balken: "bg-destructive", punkt: "bg-destructive" },
};

/** Eine Zeile, die den Zustand in Worten sagt: „seit 01.04.2019", „gekündigt zum 31.12.2026" … */
export function zustandText(partei: Partei): string {
  const { status, seit, bis, ab } = partei.zustand;
  switch (status) {
    case "vermietet":
      if (bis) return `befristet bis ${formatDateForDisplay(bis)}`;
      return seit ? `seit ${formatDateForDisplay(seit)}` : "laufender Vertrag";
    case "gekuendigt":
      return bis ? `gekündigt zum ${formatDateForDisplay(bis)}` : "gekündigt";
    case "kommend":
      return ab ? `neuer Vertrag ab ${formatDateForDisplay(ab)}` : "neuer Vertrag";
    case "leer":
      return seit ? `leer seit ${formatDateForDisplay(seit)}` : "ohne Mietvertrag";
  }
}

export function einheitTitel(partei: Partei): string {
  return `Einheit ${partei.nummer}`;
}

/** Etage ohne die Füllzeichen aus der Datenbank. */
export function etageText(partei: Partei): string {
  const text = (partei.einheit.etage ?? "").replace(/\s+/g, " ").trim();
  return text || partei.einheit.einheitentyp || "ohne Lageangabe";
}

export function mieterText(partei: Partei): string {
  if (partei.zustand.status === "leer") return "Leerstand";
  if (partei.mieter.length === 0) return "Keine Mieter zugeordnet";
  return partei.mieter.length > 2 ? `${partei.mieter.slice(0, 2).join(", ")} +${partei.mieter.length - 2}` : partei.mieter.join(", ");
}

/** Ganze Beträge wie formatCurrency(), krumme mit zwei Nachkommastellen („€1.426,50" statt „€1.426,5"). */
export function geld(betrag: number): string {
  const gerundet = Math.round(betrag * 100) / 100;
  if (Number.isInteger(gerundet)) return formatCurrency(gerundet);
  return `€${gerundet.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
