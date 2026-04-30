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

CREATE POLICY "admin_full_access_blacklist" ON bewerbung_blacklist
  FOR ALL USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION update_updated_at_blacklist()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_blacklist
  BEFORE UPDATE ON bewerbung_blacklist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_blacklist();
