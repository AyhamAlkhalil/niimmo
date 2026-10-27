import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { istVergangenerTag } from '@/utils/contractUtils';

/**
 * Automatically transitions a contract from 'gekuendigt' to 'beendet'
 * once its Kündigungsdatum has passed.
 *
 * Der letzte Vertragstag zählt noch als laufend, wie im Nachtlauf (`< CURRENT_DATE`).
 * Bis zum 27.10.2026 setzte der Vergleich `terminationDate > today` den Vertrag schon an
 * seinem letzten Tag auf 'beendet', sobald jemand die Objektansicht öffnete.
 */
export const useAutoExpireContract = (
  vertragId: string | undefined,
  status: string | undefined,
  kuendigungsdatum: string | undefined
) => {
  useEffect(() => {
    if (!vertragId || status !== 'gekuendigt' || !kuendigungsdatum) return;
    if (!istVergangenerTag(kuendigungsdatum)) return;

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
  }, [vertragId, status, kuendigungsdatum]);
};
