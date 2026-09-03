-- Ausführungsrechte der neuen Funktionen einschränken
--
-- Beim Anlegen der Aufgaben-Funktionen wurde `REVOKE … FROM PUBLIC` gesetzt.
-- Das reicht hier nicht: Für das Schema `public` bestehen Default-Privilegien
-- (`pg_default_acl`), die jeder neuen Funktion zusätzlich ein *explizites*
-- EXECUTE für `anon`, `authenticated` und `service_role` mitgeben. Der Entzug
-- von PUBLIC lässt diese Einzelrechte unberührt — `anon` konnte die Funktionen
-- also weiterhin aufrufen.
--
-- Nachgewiesen im Testlauf: `anon` durfte `mein_app_benutzer_id()` aufrufen.
-- Ausgenutzt werden konnte das nicht (ohne Anmeldung fehlen sowohl Konto-Kennung
-- als auch E-Mail im Token, die Funktion liefert dann nichts), es ist aber genau
-- das Muster, das am 24.08.2026 zur offenen Datenlage geführt hat.
--
-- Trigger-Funktionen brauchen überhaupt kein EXECUTE für aufrufende Rollen:
-- Sie werden vom Trigger ausgeführt, nicht vom Anwender aufgerufen.

revoke execute on function public.mein_app_benutzer_id()                          from public, anon;
revoke execute on function public.setze_erledigt_am()                             from public, anon, authenticated;
revoke execute on function public.benachrichtige_bei_aufgabe()                    from public, anon, authenticated;
revoke execute on function public.benachrichtige_bei_aufgaben_aenderung()         from public, anon, authenticated;
revoke execute on function public.benachrichtige_bei_erwaehnung()                 from public, anon, authenticated;
revoke execute on function public.benachrichtige_bei_kommentar()                  from public, anon, authenticated;
revoke execute on function public.lege_benachrichtigung_an(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;

-- `mein_app_benutzer_id()` wird in den Zugriffsregeln der Benachrichtigungen
-- ausgewertet und muss deshalb für angemeldete Nutzer aufrufbar bleiben.
grant execute on function public.mein_app_benutzer_id() to authenticated;
