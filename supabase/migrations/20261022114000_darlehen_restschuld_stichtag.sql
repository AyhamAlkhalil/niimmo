-- 22.10.2026: Restschuld mit Stichtag.
--
-- darlehen.restschuld war ein Betrag ohne Datum. Die Anwendung nahm ihn jeden Monat als heutigen Stand,
-- der Tilgungsplan begann also immer wieder bei derselben Zahl. Mit dem Stichtag schreibt sie Zins und
-- Tilgung von dort aus Monat für Monat fort (src/utils/darlehenBerechnung.ts). Wer restschuld ändert,
-- setzt den Stichtag mit.
--
-- Bestand: Alle 15 Restschulden sind der Stand nach der Rate per 28.02.2026. Am 22.10.2026 an der
-- Live-DB nachgerechnet: Von diesem Stand aus trifft der Plan bei allen zwölf Annuitätendarlehen jede
-- Buchung März bis September 2026 auf den Cent (Zins und Tilgung stehen im Verwendungszweck).

alter table public.darlehen
  add column if not exists restschuld_stichtag date;

comment on column public.darlehen.restschuld_stichtag is
  'Tag, zu dem restschuld gilt: Stand nach allen bis dahin fälligen Raten. Ab hier rechnet die Anwendung Zins und Tilgung fort.';

update public.darlehen
   set restschuld_stichtag = date '2026-02-28'
 where restschuld_stichtag is null
   and restschuld is not null;
