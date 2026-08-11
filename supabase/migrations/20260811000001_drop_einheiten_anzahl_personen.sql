-- einheiten.anzahl_personen entfernen
--
-- Die Personenzahl gehört zum Mietvertrag, nicht zur Einheit: sie beschreibt,
-- wer dort wohnt, nicht die Wohnung (Kundenvorgabe 11.08.2026). Maßgeblich ist
-- mietvertrag.anzahl_personen.
--
-- Die Spalte trug bei allen 113 Einheiten den Default-Wert 1 und wurde von
-- keiner Oberfläche beschrieben. Sie war damit keine Information, aber eine
-- Fehlerquelle: Die Betriebskostenabrechnung griff darauf zurück, wenn am
-- Vertrag nichts hinterlegt war, und verteilte Kosten nach Personentagen so,
-- als wohne überall genau eine Person. Wo beide Werte gepflegt waren, wichen
-- sie in 18 von 35 Fällen voneinander ab.
--
-- Vor dem Löschen geprüft: keine Datenbankfunktion und kein View greift auf die
-- Spalte zu; im Anwendungscode wird sie seit e47528d nirgends mehr gelesen.

ALTER TABLE public.einheiten DROP COLUMN IF EXISTS anzahl_personen;

COMMENT ON COLUMN public.mietvertrag.anzahl_personen IS
  'Bewohner laut Mietvertrag. Einzige gültige Quelle für die Umlage nach Personentagen — fehlt sie, wird nicht geschätzt, sondern die Abrechnung gesperrt.';
