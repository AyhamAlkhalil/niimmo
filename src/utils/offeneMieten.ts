import type { OffeneMiete } from '@/hooks/useRueckstaende';

/** Ein Mieter unter „Noch offen“ mit allen seinen offenen Verträgen */
export interface OffenerMieter {
  schluessel: string;
  mieter_name: string;
  /** Summe über die Verträge */
  offen: number;
  vertraege: OffeneMiete[];
}

/** „Anna Berg“, „Anna Berg und Ben Berg“, ab drei Namen „Anna Berg u. a.“ */
export const mieterNamenText = (namen: readonly string[]): string =>
  namen.length === 0 ? 'Unbekannt' : namen.length <= 2 ? namen.join(' und ') : `${namen[0]} u. a.`;

/**
 * Je Mieter eine Zeile (29.10.2026, Kundenmeldung): Die Überschrift zählte Wohnung und Garage eines Mieters
 * einmal, die Liste aber zweimal — „28 Mieter“ über „Alle 29 anzeigen“. Verträge mit mindestens einem
 * gemeinsamen Mieter gehören zusammen, auch Wohnung „Anna und Ben“ und Garage „Anna“ (Review); so verknüpft
 * auch useRueckstaende die Verträge eines Mieters. Ohne Mieter steht der Vertrag für sich. Größter Betrag zuerst.
 */
export const nachMieter = (eintraege: readonly OffeneMiete[]): OffenerMieter[] => {
  // Union-Find über die Verträge: Wer einen Mieter mit einem früheren Vertrag teilt, hängt an dessen Gruppe
  const wurzel = eintraege.map((_, i) => i);
  const finde = (i: number): number => (wurzel[i] === i ? i : (wurzel[i] = finde(wurzel[i])));
  const vertragJeMieter = new Map<string, number>();
  eintraege.forEach((e, i) => {
    for (const id of e.mieter_ids) {
      const anderer = vertragJeMieter.get(id);
      if (anderer === undefined) vertragJeMieter.set(id, i);
      else wurzel[finde(i)] = finde(anderer);
    }
  });

  const gruppen = new Map<number, OffeneMiete[]>();
  eintraege.forEach((e, i) => {
    const r = finde(i);
    const liste = gruppen.get(r);
    if (liste) liste.push(e);
    else gruppen.set(r, [e]);
  });

  return [...gruppen.values()]
    .map((vertraege) => ({
      schluessel: vertraege[0].mietvertrag_id,
      // Alle Namen der Gruppe: Wohnung „Anna und Ben“ und Garage „Anna“ ergeben „Anna und Ben“ (Gegenprüfung)
      mieter_name: vertraege.length === 1 ? vertraege[0].mieter_name : mieterNamenText([...new Set(vertraege.flatMap((v) => v.mieter_namen))]),
      offen: Math.round(vertraege.reduce((s, v) => s + Math.round(v.offen * 100), 0)) / 100,
      vertraege,
    }))
    .sort((a, b) => b.offen - a.offen);
};

/** Anzahl der Mieter hinter den offenen Verträgen: Wohnung und Garage eines Mieters zählen einmal (29.10.2026) */
export const anzahlMieter = (eintraege: readonly OffeneMiete[]): number => nachMieter(eintraege).length;
