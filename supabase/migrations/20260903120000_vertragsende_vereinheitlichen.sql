-- Vertragsende vereinheitlichen
--
-- mietvertrag.ende_datum und mietvertrag.kuendigungsdatum trugen dieselbe
-- fachliche Aussage ("wann endet das Mietverhaeltnis") getrennt und ohne
-- Abgleich: Der Kuendigungs-Workflow schrieb ausschliesslich kuendigungsdatum,
-- die Einheiten-Karte zeigte kuendigungsdatum, die Vertragsdetails zeigten
-- ende_datum. Bei 23 Vertraegen wichen beide Werte voneinander ab -- zwei
-- gekuendigte Vertraege standen in der Detailansicht auf "Unbefristet",
-- waehrend die Karte einen Kuendigungstermin nannte.
--
-- Ab jetzt ist ende_datum das Ende des Mietverhaeltnisses. Liegt eine
-- Kuendigung vor, ist das der Kuendigungstermin. kuendigungsdatum bleibt als
-- Beleg der Kuendigung erhalten, ist aber nicht mehr die Anzeigequelle.

-- ---------------------------------------------------------------------------
-- 1) Altwerte sichern. Eigenes Schema, damit PostgREST die Sicherung nicht
--    ausliefert -- exponiert wird nur public.
-- ---------------------------------------------------------------------------
create schema if not exists archiv;
revoke all on schema archiv from public;
revoke all on schema archiv from anon, authenticated;

create table if not exists archiv.mietvertrag_ende_20260903 (
  mietvertrag_id   uuid primary key,
  ende_datum_alt   date,
  kuendigungsdatum date,
  status_alt       text,
  gesichert_am     timestamptz not null default now()
);
revoke all on archiv.mietvertrag_ende_20260903 from public;
revoke all on archiv.mietvertrag_ende_20260903 from anon, authenticated;

insert into archiv.mietvertrag_ende_20260903 (mietvertrag_id, ende_datum_alt, kuendigungsdatum, status_alt)
select mv.id, mv.ende_datum, mv.kuendigungsdatum, mv.status::text
from public.mietvertrag mv
where mv.kuendigungsdatum is not null
  and mv.ende_datum is distinct from mv.kuendigungsdatum
on conflict (mietvertrag_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Trigger zuerst korrigieren, damit das Update darunter schon die neue
--    Logik trifft.
--
--    Bisher setzte der Trigger einen aktiven Vertrag automatisch auf
--    "gekuendigt", sobald irgendein ende_datum in der Zukunft eingetragen
--    wurde. Damit erschien jede blosse Befristung als Kuendigung -- fuenf
--    Vertraege stehen deshalb auf "gekuendigt", obwohl niemand gekuendigt hat.
--    Nur eine belegte Kuendigung (kuendigungsdatum gesetzt) darf den Status
--    aendern.
-- ---------------------------------------------------------------------------
create or replace function public.auto_set_beendet_status()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- Ende liegt in der Vergangenheit -> beendet, gleich ob Befristung oder Kuendigung.
  if new.ende_datum is not null and new.ende_datum < current_date then
    new.status := 'beendet';

  -- Ende liegt in der Zukunft: nur eine belegte Kuendigung macht aus einem
  -- aktiven Vertrag einen gekuendigten. Eine Befristung laesst ihn aktiv.
  elsif new.ende_datum is not null
        and new.ende_datum >= current_date
        and new.kuendigungsdatum is not null
        and new.status = 'aktiv' then
    new.status := 'gekuendigt';

  -- Ende entfernt: nur zuruecksetzen, solange keine Kuendigung vorliegt.
  elsif tg_op = 'UPDATE'
        and new.ende_datum is null
        and old.ende_datum is not null
        and new.status = 'gekuendigt'
        and new.kuendigungsdatum is null then
    new.status := 'aktiv';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Bestand nachziehen: Wo eine Kuendigung belegt ist, ist der
--    Kuendigungstermin das Ende des Mietverhaeltnisses.
-- ---------------------------------------------------------------------------
update public.mietvertrag
set ende_datum = kuendigungsdatum
where kuendigungsdatum is not null
  and ende_datum is distinct from kuendigungsdatum;
