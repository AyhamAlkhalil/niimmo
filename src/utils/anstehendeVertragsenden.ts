import { alsIsoTag, getVertragsende } from '@/utils/contractUtils';

export interface VertragFuerVertragsende {
  status?: string | null;
  start_datum?: string | null;
  ende_datum?: string | null;
  kuendigungsdatum?: string | null;
}

export type VertragsendeArt = 'Kündigung' | 'Befristung';

export interface AnstehendesVertragsende<T> {
  vertrag: T;
  /** Mietende als Kalendertag JJJJ-MM-TT, aus getVertragsende() */
  ende: string;
  /** Kalendertage bis zum Mietende, 0 = heute */
  tage: number;
  /** „heute“, „in 31 Tagen“, „in 3 Monaten“, „in 3 Jahren“ */
  restzeit: string;
  art: VertragsendeArt;
}

const tagNummer = (isoTag: string): number => {
  const [jahr, monat, tag] = isoTag.split('-').map(Number);
  return Date.UTC(jahr, monat - 1, tag) / 86_400_000;
};

/** Eine Kündigung liegt vor, sobald ein Kündigungsdatum steht oder der Vertrag gekündigt ist; sonst endet er befristet */
export const vertragsendeArt = (v: VertragFuerVertragsende): VertragsendeArt =>
  v.kuendigungsdatum || v.status === 'gekuendigt' ? 'Kündigung' : 'Befristung';

/**
 * Restzeit bis zum Mietende: bis 90 Tage taggenau, danach in vollen Monaten, ab zwei Jahren in vollen Jahren
 * („in 1158 Tagen“ las sich in der Sichtprüfung schlecht).
 */
export const restzeitText = (heute: string, ende: string): string => {
  const tage = tagNummer(ende) - tagNummer(heute);
  if (tage <= 0) return 'heute';
  if (tage === 1) return 'morgen';
  if (tage <= 90) return `in ${tage} Tagen`;
  const [j1, m1, d1] = heute.split('-').map(Number);
  const [j2, m2, d2] = ende.split('-').map(Number);
  const monate = (j2 - j1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (monate < 24) return `in ${monate} Monaten`;
  return `in ${Math.floor(monate / 12)} Jahren`;
};

/**
 * Alle laufenden Verträge (aktiv oder gekündigt, schon begonnen), deren Mietende heute oder später liegt,
 * das früheste zuerst (30.10.2026, Kundenwunsch: alle bevorstehenden Kündigungen auf einen Blick). Das erste
 * Element ist das „Nächste Vertragsende“ der Startseite — Kennzahl und Liste kommen aus derselben Regel.
 *
 * Kalendertage als Text verglichen: Mit `new Date(ende) > heute` fiel ein Vertrag, der heute endet, ab 1 bzw.
 * 2 Uhr heraus (27.10.2026). Bei gleichem Datum bleibt die Reihenfolge der Eingabe (stabile Sortierung).
 */
export function anstehendeVertragsenden<T extends VertragFuerVertragsende>(
  vertraege: readonly T[],
  stichtag: Date
): AnstehendesVertragsende<T>[] {
  const heute = alsIsoTag(stichtag);
  return vertraege
    .flatMap((vertrag) => {
      if (vertrag.status !== 'aktiv' && vertrag.status !== 'gekuendigt') return [];
      const start = vertrag.start_datum?.slice(0, 10);
      if (start && start > heute) return [];
      const ende = getVertragsende(vertrag)?.slice(0, 10);
      if (!ende || ende < heute) return [];
      return [{
        vertrag,
        ende,
        tage: tagNummer(ende) - tagNummer(heute),
        restzeit: restzeitText(heute, ende),
        art: vertragsendeArt(vertrag),
      }];
    })
    .sort((a, b) => (a.ende < b.ende ? -1 : a.ende > b.ende ? 1 : 0));
}
