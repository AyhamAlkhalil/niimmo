-- BKA-Forderungen: typ-Spalte für Unterscheidung Miete / BKA-Nachzahlung / BKA-Guthaben
ALTER TABLE mietforderungen
  ADD COLUMN IF NOT EXISTS typ TEXT DEFAULT 'Miete'
    CHECK (typ IN ('Miete', 'BKA'));

-- Bestehende Einträge bleiben 'Miete'
