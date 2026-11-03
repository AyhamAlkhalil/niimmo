import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useBriefunterzeichner } from './useBriefunterzeichner';
import { unterzeichnerVorschlag } from '@/utils/mietvertrag/vertretung';

/**
 * Wer den Mietvertrag für den Vermieter unterschreiben soll, wenn nichts gewählt ist: der
 * Geschäftsführer, der angemeldet ist (Kundenwunsch 03.11.2026 „wer legt diesen Mietvertrag an“).
 * `bereit` erst, wenn Anmeldung und Briefunterzeichner geladen sind — sonst ginge der Vorschlag
 * verloren, weil die Dialoge nur einmal je Öffnen vorbelegen. Wer nicht eingetragen ist, bekommt
 * keinen Vorschlag und wählt selbst.
 */
export function useVermieterUnterzeichnerVorschlag(vertretenDurch: readonly string[] | null | undefined): {
  vorschlag: string | null;
  bereit: boolean;
} {
  const { user, loading } = useAuth();
  const { eintraege, isLoading } = useBriefunterzeichner();
  const vorschlag = useMemo(
    () => (vertretenDurch ? unterzeichnerVorschlag(vertretenDurch, eintraege, user?.email) : null),
    [vertretenDurch, eintraege, user?.email]
  );
  return { vorschlag, bereit: !loading && !isLoading };
}
