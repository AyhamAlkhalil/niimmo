-- Betriebskostenabrechnung: Datenintegrität und Abgrenzung zu Mietforderungen
--
-- 1. Duplikate in nebenkostenarten zusammenführen + künftig verhindern
-- 2. Audit-Spalten für nebenkosten_abrechnungen (auch PDF-Download erfassen)
-- 3. Transaktionale RPC für kostenposition_anteile
-- 4. BKA-Forderungen aus dem Mahnwesen heraushalten
-- 5. Fälligkeit für BKA-Nachzahlungen / Guthaben korrekt setzen

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nebenkostenarten: Duplikate zusammenführen
--
-- Der Lookup im Frontend strippte Umlaute ersatzlos ("Entwässerung" -> "entwsserung"),
-- traf damit nie die Kategorie-ID "entwaesserung" und legte bei jeder Zuordnung eine
-- neue Art an. Betroffen: Entwässerung, Straßenreinigung & Müll, Gebäudereinigung,
-- Wäschepflege, Bankgebühren.
-- ─────────────────────────────────────────────────────────────────────────────

-- Kanonische Art je (immobilie_id, name): die älteste.
CREATE TEMP TABLE nka_kanonisch AS
SELECT DISTINCT ON (immobilie_id, lower(name))
  id AS keep_id,
  immobilie_id,
  lower(name) AS name_key
FROM public.nebenkostenarten
ORDER BY immobilie_id, lower(name), erstellt_am NULLS LAST, id;

CREATE TEMP TABLE nka_mapping AS
SELECT n.id AS dup_id, k.keep_id
FROM public.nebenkostenarten n
JOIN nka_kanonisch k
  ON k.immobilie_id IS NOT DISTINCT FROM n.immobilie_id
 AND k.name_key = lower(n.name)
WHERE n.id <> k.keep_id;

-- Kostenpositionen auf die kanonische Art umhängen (kein Unique-Constraint, unkritisch).
UPDATE public.kostenpositionen kp
SET nebenkostenart_id = m.keep_id
FROM nka_mapping m
WHERE kp.nebenkostenart_id = m.dup_id;

-- nebenkosten_anteile hat UNIQUE(nebenkostenart_id, einheit_id):
-- kollidierende Zeilen verwerfen, den Rest umhängen.
DELETE FROM public.nebenkosten_anteile a
USING nka_mapping m
WHERE a.nebenkostenart_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM public.nebenkosten_anteile b
    WHERE b.nebenkostenart_id = m.keep_id
      AND b.einheit_id = a.einheit_id
  );

UPDATE public.nebenkosten_anteile a
SET nebenkostenart_id = m.keep_id
FROM nka_mapping m
WHERE a.nebenkostenart_id = m.dup_id;

UPDATE public.nebenkosten_zahlungen z
SET nebenkostenart_id = m.keep_id
FROM nka_mapping m
WHERE z.nebenkostenart_id = m.dup_id;

DELETE FROM public.nebenkostenarten n
USING nka_mapping m
WHERE n.id = m.dup_id;

DROP TABLE nka_mapping;
DROP TABLE nka_kanonisch;

-- Künftige Duplikate ausschließen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nebenkostenarten_immobilie_name
  ON public.nebenkostenarten (immobilie_id, lower(name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. nebenkosten_abrechnungen: Audit erweitern
--
-- Bisher wurde nur der E-Mail-Versand erfasst. Mieter ohne E-Mail-Adresse werden
-- postalisch bedient — deren Abrechnungen tauchten nirgends auf und der
-- Doppelversand-Schutz griff für sie nicht.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.nebenkosten_abrechnungen
  ADD COLUMN IF NOT EXISTS pdf_erstellt_am TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS versandt_an TEXT,
  ADD COLUMN IF NOT EXISTS erstellt_von UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.nebenkosten_abrechnungen.pdf_erstellt_am
  IS 'Letzter PDF-Download (postalischer Versand). Unabhängig von versandt_am.';
COMMENT ON COLUMN public.nebenkosten_abrechnungen.versandt_an
  IS 'Empfängeradressen des letzten E-Mail-Versands, kommasepariert.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. kostenposition_anteile transaktional ersetzen
--
-- Das Frontend löschte erst alle Anteile und schrieb sie danach neu. Brach der
-- Insert ab, waren die Anteile aller Mieter verloren.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.replace_kostenposition_anteile(
  p_kostenposition_ids UUID[],
  p_anteile JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF p_kostenposition_ids IS NULL OR array_length(p_kostenposition_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.kostenposition_anteile
  WHERE kostenposition_id = ANY(p_kostenposition_ids);

  INSERT INTO public.kostenposition_anteile (
    kostenposition_id, einheit_id, anteil_prozent, anteil_betrag,
    verteilerschluessel_art, bezugsgroesse_einheit, bezugsgroesse_gesamt,
    zeitraum_von, zeitraum_bis, zeitanteil_faktor
  )
  SELECT
    a.kostenposition_id, a.einheit_id, a.anteil_prozent, a.anteil_betrag,
    a.verteilerschluessel_art, a.bezugsgroesse_einheit, a.bezugsgroesse_gesamt,
    a.zeitraum_von, a.zeitraum_bis, a.zeitanteil_faktor
  FROM jsonb_to_recordset(COALESCE(p_anteile, '[]'::jsonb)) AS a(
    kostenposition_id UUID,
    einheit_id UUID,
    anteil_prozent NUMERIC,
    anteil_betrag NUMERIC,
    verteilerschluessel_art TEXT,
    bezugsgroesse_einheit NUMERIC,
    bezugsgroesse_gesamt NUMERIC,
    zeitraum_von DATE,
    zeitraum_bis DATE,
    zeitanteil_faktor NUMERIC
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

COMMENT ON FUNCTION public.replace_kostenposition_anteile IS
  'Ersetzt die Anteile der übergebenen Kostenpositionen in einer Transaktion.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BKA-Forderungen aus dem Mahnwesen heraushalten
--
-- check_and_update_mahnstufen lief über ALLE Forderungen. Eine offene
-- BKA-Nachzahlung trieb damit die Miet-Mahnstufe hoch, obwohl der Abgleich nur
-- nach Zahlungen der Kategorie 'Miete' sucht — eine BKA-Zahlung konnte die
-- Forderung also gar nicht ausgleichen.
--
-- Basis ist die Fassung aus 20260706093000 (tabellenqualifizierte WHERE-Klausel
-- gegen "column reference mietvertrag_id is ambiguous"); ergänzt wird nur der
-- typ-Filter.
-- ─────────────────────────────────────────────────────────────────────────────

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
        -- Nur Mietforderungen mahnen; BKA hat einen eigenen Zahlungsweg.
        AND COALESCE(mf.typ, 'Miete') = 'Miete'
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

-- Mietanpassungen dürfen BKA-Positionen nicht überschreiben.
CREATE OR REPLACE FUNCTION public.update_forderungen_on_rent_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.kaltmiete IS DISTINCT FROM NEW.kaltmiete
     OR OLD.betriebskosten IS DISTINCT FROM NEW.betriebskosten THEN
    UPDATE public.mietforderungen
    SET sollbetrag = COALESCE(NEW.kaltmiete, 0) + COALESCE(NEW.betriebskosten, 0)
    WHERE mietvertrag_id = NEW.id
      AND COALESCE(typ, 'Miete') = 'Miete'
      AND sollmonat >= DATE_TRUNC('month', CURRENT_DATE)::date
      AND sollbetrag = COALESCE(OLD.kaltmiete, 0) + COALESCE(OLD.betriebskosten, 0);
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fälligkeit von BKA-Positionen
--
-- Die Regel "8. des Sollmonats" gilt für Mieten. Eine BKA-Nachzahlung wird mit
-- dem Zugang der Abrechnung fällig (30 Tage Zahlungsziel), ein Guthaben wird
-- ausgezahlt und ist nie eine offene Forderung.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_faelligkeitsdatum_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.faelligkeitsdatum IS NULL THEN
    IF COALESCE(NEW.typ, 'Miete') = 'BKA' THEN
      NEW.faelligkeitsdatum := CURRENT_DATE + INTERVAL '30 days';
    ELSE
      -- sollmonat ist DATE (erster des Monats), +7 Tage = 8. des Monats
      NEW.faelligkeitsdatum := NEW.sollmonat + INTERVAL '7 days';
    END IF;
  END IF;

  -- Guthaben ist keine Forderung.
  IF COALESCE(NEW.sollbetrag, 0) < 0 THEN
    NEW.ist_faellig := false;
    NEW.faellig_seit := NULL;
  ELSIF NEW.faelligkeitsdatum <= CURRENT_DATE THEN
    NEW.ist_faellig := true;
    NEW.faellig_seit := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

-- Bestehende BKA-Guthaben nachziehen.
UPDATE public.mietforderungen
SET ist_faellig = false, faellig_seit = NULL
WHERE sollbetrag < 0 AND ist_faellig IS TRUE;
