-- Fix: "column reference mietvertrag_id is ambiguous" (42702)
-- check_and_update_mahnstufen() hat einen RETURNS TABLE(mietvertrag_id uuid, ...)
-- OUT-Parameter, der mit der Spalte mietforderungen.mietvertrag_id kollidiert,
-- solange die WHERE-Klausel nicht tabellenqualifiziert ist. Der tägliche
-- Mahnstufen-Cron-Job (niimmo-check-mahnstufen) schlug dadurch seit der
-- Migration 20260417000001 bei jedem Lauf fehl.

CREATE OR REPLACE FUNCTION public.check_and_update_mahnstufen()
RETURNS TABLE(
  mietvertrag_id uuid,
  alte_mahnstufe integer,
  neue_mahnstufe integer,
  grund text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vertrag_record RECORD;
  forderung_record RECORD;
  zahlung_exists boolean;
  forderung_datum date;
  neue_stufe integer;
BEGIN
  FOR vertrag_record IN
    SELECT * FROM mietvertrag
    WHERE status = 'aktiv'
  LOOP
    neue_stufe := COALESCE(vertrag_record.mahnstufe, 0);

    FOR forderung_record IN
      SELECT * FROM mietforderungen mf
      WHERE mf.mietvertrag_id = vertrag_record.id
      ORDER BY mf.sollmonat
    LOOP
      forderung_datum := COALESCE(
        forderung_record.faelligkeitsdatum,
        forderung_record.sollmonat + INTERVAL '7 days'
      );

      SELECT EXISTS(
        SELECT 1 FROM zahlungen z
        WHERE z.mietvertrag_id = vertrag_record.id
        AND z.buchungsdatum BETWEEN (forderung_datum - INTERVAL '14 days')
                                AND (forderung_datum + INTERVAL '7 days')
        AND ABS(z.betrag - forderung_record.sollbetrag) <= 50
        AND z.kategorie = 'Miete'
      ) INTO zahlung_exists;

      IF NOT zahlung_exists AND forderung_datum < CURRENT_DATE THEN
        neue_stufe := LEAST(neue_stufe + 1, 3);

        UPDATE mietvertrag
        SET
          mahnstufe = neue_stufe,
          letzte_mahnung_am = CURRENT_TIMESTAMP,
          naechste_mahnung_am = CURRENT_DATE + INTERVAL '30 days'
        WHERE id = vertrag_record.id;

        mietvertrag_id := vertrag_record.id;
        alte_mahnstufe := COALESCE(vertrag_record.mahnstufe, 0);
        neue_mahnstufe := neue_stufe;
        grund := 'Keine Miete-Zahlung für ' || TO_CHAR(forderung_record.sollmonat, 'YYYY-MM') || ' im Zeitraum ±14/7 Tage gefunden';

        RETURN NEXT;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;
