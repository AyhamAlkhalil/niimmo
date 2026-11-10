/**
 * Mieter ohne Mietvertrag prüfen und löschen (10.11.2026). Die Regeln, wer gelöscht werden darf, stehen in der
 * Datenbankfunktion `loesche_mieter_ohne_vertrag`: kein Vertrag, kein offener Entwurf, keine WhatsApp-Nachrichten.
 * Die Oberfläche fragt vorher nur ab, wem sie das Löschen überhaupt anbieten soll.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  leseLoeschErgebnis,
  mieterOhneVertragTreffer,
  type MieterLoeschErgebnis,
  type MieterOhneVertragRoh,
} from '@/utils/mieterOhneVertrag';

/** Von diesen Mietern die ohne Mietvertrag, mit Namen. Die Liste ist kurz (Mitmieter eines Entwurfs). */
export async function ladeMieterOhneVertrag(ids: string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('mieter')
    .select('id, vorname, nachname, firmenname, ist_unternehmen, mietvertrag_mieter(mietvertrag_id)')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return mieterOhneVertragTreffer((data ?? []) as MieterOhneVertragRoh[], []).map(m => ({ id: m.id, name: m.name }));
}

export async function loescheMieterOhneVertrag(ids: string[]): Promise<MieterLoeschErgebnis> {
  if (ids.length === 0) return { geloescht: [], behalten: [] };
  const { data, error } = await supabase.rpc('loesche_mieter_ohne_vertrag', { p_mieter_ids: ids });
  if (error) throw new Error(error.message);
  return leseLoeschErgebnis(data);
}
