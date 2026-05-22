ALTER TABLE csv_uploads
  ADD COLUMN IF NOT EXISTS zeitraum_von DATE,
  ADD COLUMN IF NOT EXISTS zeitraum_bis DATE;
