-- 23.10.2026: „Als geprüft" und „Ignorieren" gelten bei Zahlungs-Auffälligkeiten dauerhaft.
--
-- Seit dem 22.07.2026 (zahlungs_anomalien_daily_refresh) setzte der tägliche Lauf um 08:00 jeden noch
-- auffälligen Fall zurück auf „offen", auch wenn er abgehakt war. Abhaken half damit nur bis zum nächsten
-- Morgen; die Stellplatzzahlung vom 01.10.2026 stand deshalb ab dem 03.10. jeden Tag wieder im Banner.
-- Gewünscht ist, dass ein abgehakter Fall wegbleibt (Rückmeldung vom 23.10.2026).
--
-- Neu: Ein Fall mit Status geprueft/ignoriert behält Status, geprueft_von und geprueft_am. Er wird nur
-- wieder „offen", wenn die Zahlung inzwischen einem anderen Vertrag zugeordnet ist und trotzdem noch
-- auffällt — dann ist es ein neuer Sachverhalt. Behobene Fälle löscht der Lauf weiterhin.
--
-- In ON CONFLICT DO UPDATE lesen alle SET-Ausdrücke die bisherige Zeile (zahlungs_anomalien.*); die
-- Reihenfolge der Zuweisungen spielt daher keine Rolle.

CREATE OR REPLACE FUNCTION public.check_zahlungs_anomalien(p_tage_zurueck integer DEFAULT 60)
 RETURNS TABLE(action text, zahlung_id uuid, regel_typ text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_z RECORD;
  v_current RECORD;
  v_linked RECORD;
  v_mieter_ids uuid[];
  v_current_diff numeric;
  v_linked_diff numeric;
  v_best_id uuid;
  v_best_diff numeric;
  v_toleranz numeric := 5;
  v_mismatched_ids uuid[] := ARRAY[]::uuid[];
  v_window_start date := CURRENT_DATE - (p_tage_zurueck || ' days')::interval;
BEGIN
  FOR v_z IN
    SELECT z.id, z.betrag, z.buchungsdatum, z.mietvertrag_id, z.kategorie
    FROM zahlungen z
    WHERE z.mietvertrag_id IS NOT NULL
      AND z.kategorie IN ('Miete','Mietkaution')
      AND z.buchungsdatum >= v_window_start
    -- Jede Zahlung im Fenster wird jeden Lauf neu bewertet; abgehakte Fälle behalten ihren Status (ON CONFLICT).
  LOOP
    SELECT mv.kaltmiete, mv.betriebskosten, mv.kaution_betrag
    INTO v_current
    FROM mietvertrag mv WHERE mv.id = v_z.mietvertrag_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT array_agg(mieter_id) INTO v_mieter_ids
    FROM mietvertrag_mieter WHERE mietvertrag_id = v_z.mietvertrag_id;
    CONTINUE WHEN v_mieter_ids IS NULL;

    v_current_diff := CASE WHEN v_z.kategorie = 'Mietkaution'
      THEN ABS(v_z.betrag - v_current.kaution_betrag)
      ELSE ABS(v_z.betrag - (COALESCE(v_current.kaltmiete,0) + COALESCE(v_current.betriebskosten,0)))
    END;

    v_best_id := NULL; v_best_diff := NULL;

    FOR v_linked IN
      SELECT DISTINCT mv2.id, mv2.kaltmiete, mv2.betriebskosten, mv2.kaution_betrag,
             mv2.start_datum, mv2.ende_datum
      FROM mietvertrag_mieter mm2
      JOIN mietvertrag mv2 ON mv2.id = mm2.mietvertrag_id
      WHERE mm2.mieter_id = ANY(v_mieter_ids)
        AND mv2.id <> v_z.mietvertrag_id
        AND mv2.status IN ('aktiv','gekuendigt')
    LOOP
      CONTINUE WHEN v_linked.start_datum IS NULL;
      CONTINUE WHEN v_z.buchungsdatum < (v_linked.start_datum - INTERVAL '1 month');
      CONTINUE WHEN v_linked.ende_datum IS NOT NULL AND v_z.buchungsdatum > (v_linked.ende_datum + INTERVAL '1 month');

      v_linked_diff := CASE WHEN v_z.kategorie = 'Mietkaution'
        THEN (CASE WHEN v_linked.kaution_betrag IS NULL THEN NULL ELSE ABS(v_z.betrag - v_linked.kaution_betrag) END)
        ELSE ABS(v_z.betrag - (COALESCE(v_linked.kaltmiete,0) + COALESCE(v_linked.betriebskosten,0)))
      END;
      CONTINUE WHEN v_linked_diff IS NULL;

      IF v_best_diff IS NULL OR v_linked_diff < v_best_diff THEN
        v_best_diff := v_linked_diff; v_best_id := v_linked.id;
      END IF;
    END LOOP;

    CONTINUE WHEN v_best_id IS NULL;

    IF (v_current_diff IS NULL OR v_current_diff > v_toleranz) AND v_best_diff <= v_toleranz THEN
      v_mismatched_ids := array_append(v_mismatched_ids, v_z.id);
      INSERT INTO zahlungs_anomalien
        (zahlung_id, zugeordneter_mietvertrag_id, vermuteter_mietvertrag_id, regel_typ,
         betrag, zugeordneter_vertrag_diff, vermuteter_vertrag_diff, begruendung, status,
         geprueft_von, geprueft_am)
      VALUES (v_z.id, v_z.mietvertrag_id, v_best_id,
        CASE WHEN v_z.kategorie='Mietkaution' THEN 'kaution_abweichung_verbundener_vertrag'
             ELSE 'betrag_abweichung_verbundener_vertrag' END,
        v_z.betrag, v_current_diff, v_best_diff,
        format('Zahlung %s€ passt nicht zum zugeordneten Vertrag (Diff %s€), aber zu verbundenem Vertrag desselben Mieters (Diff %s€).',
               v_z.betrag, COALESCE(v_current_diff::text,'n/a'), v_best_diff),
        'offen', NULL, NULL)
      ON CONFLICT (zahlung_id) DO UPDATE SET
        zugeordneter_mietvertrag_id = EXCLUDED.zugeordneter_mietvertrag_id,
        vermuteter_mietvertrag_id = EXCLUDED.vermuteter_mietvertrag_id,
        regel_typ = EXCLUDED.regel_typ,
        betrag = EXCLUDED.betrag,
        zugeordneter_vertrag_diff = EXCLUDED.zugeordneter_vertrag_diff,
        vermuteter_vertrag_diff = EXCLUDED.vermuteter_vertrag_diff,
        begruendung = EXCLUDED.begruendung,
        status = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                      THEN zahlungs_anomalien.status ELSE 'offen' END,
        geprueft_von = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                            THEN zahlungs_anomalien.geprueft_von END,
        geprueft_am = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                           THEN zahlungs_anomalien.geprueft_am END,
        updated_at = now();
      action := 'flagged'; zahlung_id := v_z.id; regel_typ := 'betrag_abweichung_verbundener_vertrag';
      RETURN NEXT;

    ELSIF v_current_diff IS NOT NULL AND v_current_diff <= v_toleranz AND v_best_diff <= v_toleranz
          AND (v_current_diff - v_best_diff) > 0.50 THEN
      v_mismatched_ids := array_append(v_mismatched_ids, v_z.id);
      INSERT INTO zahlungs_anomalien
        (zahlung_id, zugeordneter_mietvertrag_id, vermuteter_mietvertrag_id, regel_typ,
         betrag, zugeordneter_vertrag_diff, vermuteter_vertrag_diff, begruendung, status,
         geprueft_von, geprueft_am)
      VALUES (v_z.id, v_z.mietvertrag_id, v_best_id, 'betrag_naeher_bei_verbundenem_vertrag',
        v_z.betrag, v_current_diff, v_best_diff,
        format('Zahlung %s€ passt bei verbundenem Vertrag deutlich näher (Diff %s€) als beim zugeordneten Vertrag (Diff %s€).',
               v_z.betrag, v_best_diff, v_current_diff),
        'offen', NULL, NULL)
      ON CONFLICT (zahlung_id) DO UPDATE SET
        zugeordneter_mietvertrag_id = EXCLUDED.zugeordneter_mietvertrag_id,
        vermuteter_mietvertrag_id = EXCLUDED.vermuteter_mietvertrag_id,
        regel_typ = EXCLUDED.regel_typ,
        betrag = EXCLUDED.betrag,
        zugeordneter_vertrag_diff = EXCLUDED.zugeordneter_vertrag_diff,
        vermuteter_vertrag_diff = EXCLUDED.vermuteter_vertrag_diff,
        begruendung = EXCLUDED.begruendung,
        status = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                      THEN zahlungs_anomalien.status ELSE 'offen' END,
        geprueft_von = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                            THEN zahlungs_anomalien.geprueft_von END,
        geprueft_am = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                           THEN zahlungs_anomalien.geprueft_am END,
        updated_at = now();
      action := 'flagged'; zahlung_id := v_z.id; regel_typ := 'betrag_naeher_bei_verbundenem_vertrag';
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Auto-Resolve: Findings im geprueften Zeitfenster, die jetzt nicht mehr
  -- mismatchen, automatisch entfernen (Problem wurde offenbar anderweitig,
  -- z.B. durch manuelle Korrektur der Zuordnung, behoben).
  DELETE FROM zahlungs_anomalien za
  USING zahlungen z
  WHERE za.zahlung_id = z.id
    AND z.buchungsdatum >= v_window_start
    AND NOT (za.zahlung_id = ANY(v_mismatched_ids));
END;
$function$;
