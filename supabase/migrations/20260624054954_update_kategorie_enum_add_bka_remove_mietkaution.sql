-- Mietkaution aus Dokumenten-Kategorie entfernen, Betriebskostenabrechnung hinzufügen

-- 1. Vorhandene Dokumente mit 'Mietkaution' auf 'Sonstiges' setzen
UPDATE dokumente SET kategorie = 'Sonstiges' WHERE kategorie = 'Mietkaution';

-- 2. Alte enum umbenennen
ALTER TYPE kategorie RENAME TO kategorie_old;

-- 3. Neuen enum ohne 'Mietkaution', mit 'Betriebskostenabrechnung' erstellen
CREATE TYPE kategorie AS ENUM (
  'Mietvertrag',
  'Kündigung',
  'Übergabeprotokoll',
  'Sonstiges',
  'Mieterunterlagen',
  'Schriftverkehr',
  'Versicherungen',
  'Betriebskostenabrechnung'
);

-- 4. Spalte auf neuen enum umstellen
ALTER TABLE dokumente
  ALTER COLUMN kategorie TYPE kategorie USING kategorie::text::kategorie;

-- 5. Alten enum entfernen
DROP TYPE kategorie_old;
