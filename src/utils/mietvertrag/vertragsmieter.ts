/**
 * Reihenfolge der Mieter beim direkten Erfassen eines Vertrags. Briefe und PDF
 * lesen die Mieter nach `mietvertrag_mieter.position`; Position 1 ist der
 * Hauptmieter, danach Zweit- und Drittmieter wie beim Aktivieren eines Entwurfs.
 * Bis zum 27.10.2026 schrieb der Direktweg jede Verknüpfung als „Hauptmieter,
 * Position 1" — die Auswahl Hauptmieter/Mitmieter im Formular blieb ohne Wirkung.
 */
import type { Tables } from '@/integrations/supabase/types';
import { mieterRolle } from './entwurf';

export type VertragsmieterQuelle = { art: 'neu'; index: number } | { art: 'bestand'; id: string };

/** Wer Hauptmieter sein soll; `index` zählt nur die ausgefüllten neuen Mieter. */
export type HauptmieterWahl = VertragsmieterQuelle | null;

export interface Vertragsmieter {
  quelle: VertragsmieterQuelle;
  position: number;
  rolle: Tables<'mietvertrag_mieter'>['rolle'];
}

/**
 * Genau ein Hauptmieter: der gewählte, solange er noch im Vertrag steht, sonst
 * der erste neue und ohne neue der erste bestehende. Eine einzige Wahl statt
 * einer Rolle je Karte — so kann keine Anzeige einen anderen Hauptmieter zeigen,
 * als gespeichert wird. Danach folgen die neuen und dann die bestehenden Mieter
 * in der Reihenfolge der Eingabe.
 */
export function vertragsReihenfolge(anzahlNeue: number, bestehende: string[], wahl: HauptmieterWahl): Vertragsmieter[] {
  const alle: VertragsmieterQuelle[] = [
    ...Array.from({ length: anzahlNeue }, (_, index) => ({ art: 'neu' as const, index })),
    ...bestehende.map(id => ({ art: 'bestand' as const, id })),
  ];
  if (alle.length === 0) return [];

  let haupt = -1;
  if (wahl?.art === 'neu' && wahl.index >= 0 && wahl.index < anzahlNeue) haupt = wahl.index;
  else if (wahl?.art === 'bestand') haupt = alle.findIndex(q => q.art === 'bestand' && q.id === wahl.id);
  if (haupt < 0) haupt = 0;

  return [alle[haupt], ...alle.filter((_, i) => i !== haupt)].map((quelle, i) => ({
    quelle,
    position: i + 1,
    rolle: mieterRolle(i + 1),
  }));
}
