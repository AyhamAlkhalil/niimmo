/**
 * Bestehenden Vertrag direkt erfassen (`NewTenantContractDialog`): der Weg für
 * bereits unterschriebene Verträge, ohne Entwurf. Anders als die Aktivierung
 * eines Entwurfs läuft er in Einzelschritten aus dem Browser — was dabei schon
 * angelegt ist, muss bei einem Fehler zurückgenommen werden.
 */
import { supabase } from '@/integrations/supabase/client';

/**
 * Nimmt einen halb angelegten Vertrag samt der dafür neu angelegten Mieter zurück;
 * bestehende Mieter fasst das nie an. Ein von RLS verweigertes Löschen meldet
 * Supabase nicht als Fehler, es löscht nur 0 Zeilen — deshalb zählt, was wirklich
 * gelöscht zurückkommt. Bis zum 27.10.2026 blieben bei einem Fehler nach dem
 * Vertrag die neuen Mieter liegen, und ein gescheitertes Zurücknehmen fiel nicht auf.
 *
 * Bleibt der Vertrag stehen, bleiben auch seine neuen Mieter: Ihr Löschen nähme ihm
 * per ON DELETE CASCADE die Verknüpfungen, übrig bliebe ein aktiver Vertrag ohne
 * Mieter, den in der Übersicht niemand mehr findet.
 * Rückgabe: Hinweis auf übrig gebliebene Datensätze, sonst null. Wirft nie.
 */
export async function nimmAnlageZurueck(vertragId: string | null, neueMieterIds: string[]): Promise<string | null> {
  const reste: string[] = [];
  let vertragEntfernt = true;
  if (vertragId) {
    try {
      // Verknüpfungen, Dokumente und Forderungen hängen per ON DELETE CASCADE am Vertrag
      const { data, error } = await supabase.from('mietvertrag').delete().eq('id', vertragId).select('id');
      vertragEntfernt = !error && data?.length === 1;
    } catch {
      vertragEntfernt = false;
    }
    if (!vertragEntfernt) reste.push('der angelegte Vertrag');
  }
  if (neueMieterIds.length > 0) {
    let uebrig = neueMieterIds.length;
    if (vertragEntfernt) {
      try {
        const { data, error } = await supabase.from('mieter').delete().in('id', neueMieterIds).select('id');
        if (!error) uebrig -= data?.length ?? 0;
      } catch {
        // uebrig bleibt bei allen
      }
    }
    if (uebrig > 0) reste.push(uebrig === 1 ? '1 neu angelegter Mieter' : `${uebrig} neu angelegte Mieter`);
  }
  return reste.length > 0
    ? `Nicht zurückgenommen: ${reste.join(' und ')} — bitte in der Übersicht prüfen und von Hand löschen.`
    : null;
}
