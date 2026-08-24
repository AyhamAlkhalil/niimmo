-- update_faellige_forderungen() lief seit dem 28.04.2026 in einen Fehler:
--
--   ERROR: column reference "faelligkeitsdatum" is ambiguous
--
-- Die Funktion gibt faelligkeitsdatum ueber RETURNS TABLE zurueck. Damit ist der
-- Name gleichzeitig eine PL/pgSQL-Variable und eine Spalte, und im WHERE der
-- UPDATE-Anweisung konnte Postgres sich nicht entscheiden. 119 Cron-Laeufe sind
-- daran gescheitert, keiner davon erfolgreich - 650 laengst faellige Forderungen
-- standen deshalb weiterhin auf ist_faellig = false, die aelteste seit 08.02.2026.
-- Die Rueckstandsbetraege selbst waren nie betroffen, sie werden unabhaengig von
-- diesem Flag gerechnet; verzerrt war die Aufteilung "faellig / noch nicht faellig".
--
-- Zwei Aenderungen:
--   1. Spaltenbezuege im WHERE qualifiziert, damit die Mehrdeutigkeit verschwindet.
--   2. faellig_seit bekommt das Faelligkeitsdatum statt CURRENT_TIMESTAMP. Beim
--      taeglichen Lauf ist das praktisch dasselbe, beim Nachziehen der Altfaelle
--      ist es der Unterschied zwischen "faellig seit Februar" und "faellig seit heute".

CREATE OR REPLACE FUNCTION public.update_faellige_forderungen()
 RETURNS TABLE(forderung_id uuid, mietvertrag_id uuid, sollmonat date, sollbetrag numeric, faelligkeitsdatum date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE mietforderungen
  SET
    ist_faellig = true,
    faellig_seit = mietforderungen.faelligkeitsdatum::timestamptz
  WHERE
    mietforderungen.faelligkeitsdatum <= CURRENT_DATE
    AND mietforderungen.ist_faellig = false
  RETURNING
    mietforderungen.id as forderung_id,
    mietforderungen.mietvertrag_id,
    mietforderungen.sollmonat,
    mietforderungen.sollbetrag,
    mietforderungen.faelligkeitsdatum;
END;
$function$;
