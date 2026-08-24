-- Die View aktuelle_marktdaten lief als SECURITY DEFINER und umging damit die
-- RLS der zugrundeliegenden Tabelle marktdaten - der einzige ERROR im
-- Security-Advisor. Inhaltlich harmlos (Bundesbank-Basiszinssatz und VPI, beides
-- oeffentliche Daten), das Muster ist aber falsch.
--
-- Mit security_invoker gilt die RLS des Aufrufers: authenticated sieht die
-- Werte weiterhin (Dashboard-Kopfzeile), anon nicht mehr.

alter view public.aktuelle_marktdaten set (security_invoker = on);
