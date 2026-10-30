import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { istVergangenerTag } from '@/utils/contractUtils';

/**
 * Setzt einen gekündigten Vertrag auf 'beendet', sobald sein Vertragsende vorbei ist.
 *
 * `vertragsende` kommt aus getVertragsende() (ende_datum vor kuendigungsdatum), wie in den
 * DB-Funktionen seit dem 30.10.2026. Der letzte Vertragstag zählt noch als laufend, wie im
 * Nachtlauf. Bis zum 27.10.2026 setzte der Vergleich `terminationDate > today` den Vertrag schon an
 * seinem letzten Tag auf 'beendet', sobald jemand die Objektansicht öffnete.
 */
export const useAutoExpireContract = (
  vertragId: string | undefined,
  status: string | undefined,
  vertragsende: string | undefined
) => {
  useEffect(() => {
    if (!vertragId || status !== 'gekuendigt' || !vertragsende) return;
    if (!istVergangenerTag(vertragsende)) return;

    const updateStatus = async () => {
      try {
        const { error } = await supabase
          .from('mietvertrag')
          .update({ status: 'beendet' })
          .eq('id', vertragId);
        if (error) console.error('[useAutoExpireContract] Status-Update fehlgeschlagen:', error);
      } catch (error) {
        console.error('[useAutoExpireContract] Unerwarteter Fehler:', error);
      }
    };

    updateStatus();
  }, [vertragId, status, vertragsende]);
};
