-- Handelsregisternummer der NiImmo Wohnungsbaugesellschaft mbH korrigieren.
--
-- Die Migration 20260821060154 hat 'HRB 208151' eingetragen; der Wert stammte aus
-- src/config/company.ts und war dort seit jeher falsch. Belegt ist HRB 208111:
-- Amtsgericht Hildesheim, EUID DEP2408.HRB208111 (Kundenauskunft aus dem
-- Handelsregister, 06.09.2026). Die vier Briefgeneratoren fuehrten immer schon
-- die richtige Nummer -- nur der Mietvertrag, der die Vermieterdaten aus dieser
-- Tabelle liest, druckte die falsche.
--
-- Anschrift und Registergericht sind bereits korrekt (Egestorffstrasse 11,
-- 31319 Sehnde, Amtsgericht Hildesheim) und bleiben unberuehrt.
--
-- NICHT geaendert wird die Steuernummer: In der Tabelle steht 16/204/50864, auf
-- allen bisher versendeten Mahnungen, Kuendigungen, Uebergabeprotokollen und
-- Erhoehungsschreiben 16/204/50884. Welche Fassung gilt, ist beim Kunden offen
-- (Stand 06.09.2026) -- siehe docs/offene-punkte.md B5.

update public.vermieter
set handelsregister = 'HRB 208111',
    aktualisiert_am = now()
where firmenname = 'NiImmo Wohnungsbaugesellschaft mbH'
  and handelsregister = 'HRB 208151';
