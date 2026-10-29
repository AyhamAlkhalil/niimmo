import type { OffeneMiete } from '@/hooks/useRueckstaende';

/** Anzahl der Mieter hinter den offenen Verträgen: Wohnung und Garage eines Mieters zählen einmal (29.10.2026) */
export const anzahlMieter = (eintraege: readonly OffeneMiete[]): number => new Set(eintraege.map((e) => e.mieter_schluessel)).size;
