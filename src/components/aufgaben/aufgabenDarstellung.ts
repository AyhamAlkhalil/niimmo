import { Bug, Lightbulb, ListTodo, type LucideIcon } from "lucide-react";
import type { AufgabenPrioritaet, AufgabenStatus, AufgabenTyp } from "@/hooks/useAufgaben";

/** Gemeinsame Beschriftungen für Board, Melder und Detailansicht. */

export const TYP_DARSTELLUNG: Record<
  AufgabenTyp,
  { icon: LucideIcon; label: string; className: string }
> = {
  bug: {
    icon: Bug,
    label: "Fehler",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  feature: {
    icon: Lightbulb,
    label: "Wunsch",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  aufgabe: {
    icon: ListTodo,
    label: "Aufgabe",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export const STATUS_DARSTELLUNG: Record<AufgabenStatus, { label: string; className: string }> = {
  offen: { label: "Offen", className: "bg-muted text-muted-foreground" },
  geplant: { label: "Geplant", className: "bg-blue-100 text-blue-700" },
  in_entwicklung: { label: "In Arbeit", className: "bg-yellow-100 text-yellow-800" },
  in_testing: { label: "Zum Prüfen", className: "bg-purple-100 text-purple-700" },
  fertig: { label: "Erledigt", className: "bg-green-100 text-green-700" },
};

export const PRIORITAET_DARSTELLUNG: Record<
  AufgabenPrioritaet,
  { label: string; className: string }
> = {
  kritisch: { label: "Kritisch", className: "bg-destructive text-destructive-foreground" },
  hoch: { label: "Hoch", className: "bg-orange-500 text-white" },
  mittel: { label: "Mittel", className: "bg-yellow-100 text-yellow-800" },
  niedrig: { label: "Niedrig", className: "bg-muted text-muted-foreground" },
};

export const TYP_REIHENFOLGE: AufgabenTyp[] = ["bug", "aufgabe", "feature"];
export const STATUS_REIHENFOLGE: AufgabenStatus[] = [
  "offen",
  "geplant",
  "in_entwicklung",
  "in_testing",
  "fertig",
];
export const PRIORITAET_REIHENFOLGE: AufgabenPrioritaet[] = [
  "kritisch",
  "hoch",
  "mittel",
  "niedrig",
];

/** Offene Aufgaben zuerst, darin die dringendste oben. */
const PRIO_GEWICHT: Record<AufgabenPrioritaet, number> = {
  kritisch: 0,
  hoch: 1,
  mittel: 2,
  niedrig: 3,
};

/**
 * Unbekannte Dringlichkeit ganz nach hinten statt `undefined` in die
 * Subtraktion — das ergaebe NaN und damit eine beliebige Reihenfolge.
 * `dev_tickets` ist eine Bestandstabelle, Altwerte sind moeglich.
 */
const UNBEKANNT = 99;

/** Zeitstempel als Zeitpunkt vergleichen, nicht als Text. */
function alsZeit(wert: string): number {
  const zeit = Date.parse(wert);
  return Number.isNaN(zeit) ? 0 : zeit;
}

export function sortiereAufgaben<
  T extends { status: AufgabenStatus; prioritaet: AufgabenPrioritaet; erstellt_am: string },
>(aufgaben: T[]): T[] {
  return [...aufgaben].sort((a, b) => {
    const aFertig = a.status === "fertig" ? 1 : 0;
    const bFertig = b.status === "fertig" ? 1 : 0;
    if (aFertig !== bFertig) return aFertig - bFertig;

    const prio =
      (PRIO_GEWICHT[a.prioritaet] ?? UNBEKANNT) - (PRIO_GEWICHT[b.prioritaet] ?? UNBEKANNT);
    if (prio !== 0) return prio;

    // Ein Textvergleich waere hier falsch, sobald Zeitstempel mit
    // unterschiedlichem Zonenversatz zusammentreffen.
    return alsZeit(b.erstellt_am) - alsZeit(a.erstellt_am);
  });
}
