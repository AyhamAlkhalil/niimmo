-- Wartezeit zwischen zwei Zurücksetz-Mails
--
-- Der Endpunkt muss ohne Anmeldung erreichbar sein — sonst käme niemand an sein
-- Passwort. Damit lässt er sich auch von außen auslösen. Ein Angreifer kann nur
-- Mails an die hinterlegten internen Adressen anstoßen, lästig wäre es trotzdem.
-- Der Zeitpunkt steht in der Personentabelle, weil es dort ohnehin genau eine
-- Zeile je interner Person gibt — eine eigene Tabelle wäre Ballast.

alter table public.app_benutzer
  add column if not exists letzte_reset_mail timestamptz;

comment on column public.app_benutzer.letzte_reset_mail is
  'Zeitpunkt der letzten Passwort-Zurücksetzung per Mail. Sperrt erneutes Senden für kurze Zeit.';
