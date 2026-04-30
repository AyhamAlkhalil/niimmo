-- Blacklist-Tabelle (falls noch nicht vorhanden)
CREATE TABLE IF NOT EXISTS bewerbung_blacklist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  telefon TEXT,
  grund TEXT,
  notizen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE bewerbung_blacklist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bewerbung_blacklist' AND policyname = 'admin_full_access_blacklist'
  ) THEN
    CREATE POLICY "admin_full_access_blacklist" ON bewerbung_blacklist
      FOR ALL USING (is_admin(auth.uid()))
      WITH CHECK (is_admin(auth.uid()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_updated_at_blacklist()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_blacklist'
  ) THEN
    CREATE TRIGGER set_updated_at_blacklist
      BEFORE UPDATE ON bewerbung_blacklist
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_blacklist();
  END IF;
END $$;

-- RPC für agent-api: Blacklist abrufen / durchsuchen
CREATE OR REPLACE FUNCTION rpc_agent_blacklist(p_search TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',         b.id,
      'name',       b.name,
      'email',      b.email,
      'telefon',    b.telefon,
      'grund',      b.grund,
      'notizen',    b.notizen,
      'eingetragen', to_char(b.created_at AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY')
    ) ORDER BY b.name
  )
  INTO result
  FROM bewerbung_blacklist b
  WHERE
    p_search IS NULL
    OR b.name    ILIKE '%' || p_search || '%'
    OR b.email   ILIKE '%' || p_search || '%'
    OR b.telefon ILIKE '%' || p_search || '%'
    OR b.grund   ILIKE '%' || p_search || '%';

  IF result IS NULL THEN
    RETURN jsonb_build_object(
      'eintraege', '[]'::jsonb,
      'anzahl', 0,
      'hinweis', CASE WHEN p_search IS NOT NULL
        THEN format('Kein Eintrag auf der Blacklist für "%s" gefunden.', p_search)
        ELSE 'Die Blacklist ist leer.'
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'eintraege', result,
    'anzahl', jsonb_array_length(result),
    'hinweis', CASE WHEN p_search IS NOT NULL
      THEN format('%s Treffer auf der Blacklist für "%s".', jsonb_array_length(result), p_search)
      ELSE format('Blacklist hat %s Einträge.', jsonb_array_length(result))
    END
  );
END;
$$;
