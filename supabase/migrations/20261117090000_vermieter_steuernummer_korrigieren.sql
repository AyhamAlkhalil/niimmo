-- Steuernummer der NiImmo Wohnungsbaugesellschaft mbH korrigieren.
--
-- Laut Geschaeftsfuehrung (17.11.2026) gilt fuer die Wohnungsbaugesellschaft
-- (Amtsgericht Hildesheim, HRB 208111) die Steuernummer 16/204/50884. Die
-- 16/204/50817 und HRB 206538 gehoeren zur NiImmo Holding GmbH.
--
-- In der Tabelle stand seit der Migration 20260821060154 die 16/204/50864. Sie
-- galt am 06.09.2026 als vom Kunden bestaetigt und stand deshalb auf allen
-- Mietvertraegen. Diese Nummer war falsch.
--
-- Geaendert wird nur der bekannte Altwert. Hat jemand die Nummer inzwischen im
-- Stammdaten-Dialog anders gepflegt, bleibt sie unberuehrt.

update public.vermieter
set steuernummer = '16/204/50884',
    aktualisiert_am = now()
where firmenname = 'NiImmo Wohnungsbaugesellschaft mbH'
  and handelsregister = 'HRB 208111'
  and steuernummer = '16/204/50864';
