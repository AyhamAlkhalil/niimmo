-- Besprechung zum Mietvertragsgenerator (12.11.2026): „Mieterdaten — optionales Feld Ausweisnummer ergänzen“. Die
-- Nummer des Personalausweises oder Passes steht, wenn erfasst, im Mietvertrag unter dem Mieter. Optional, frei
-- formatiert (Personalausweis, Reisepass, Aufenthaltstitel haben verschiedene Formate).
--
-- Die Anlage-Funktionen (`aktiviere_mietvertrag_entwurf`, `lege_mieter_aus_entwurf_an`) übernehmen die Spalten über
-- jsonb_populate_record und brauchen keine Änderung.
alter table public.mieter add column if not exists ausweisnummer text;

comment on column public.mieter.ausweisnummer is
  'Nummer von Personalausweis, Pass oder Aufenthaltstitel (optional, seit 12.11.2026); steht im Mietvertrag unter dem Mieter.';
