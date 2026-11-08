-- 08.11.2026: Jede Änderung an briefunterzeichner scheiterte mit „record new has no field aktualisiert_am“: Der Trigger aus
-- 20261102100000 nutzte update_updated_at_column(), das aktualisiert_am setzt — die Tabelle hat updated_at. Dadurch ging
-- „Angaben ändern“ im Unterzeichner-Dialog nie. Eigene Funktion wie bei activity_logs und zahlungs_anomalien.
create or replace function public.set_updated_at_briefunterzeichner()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger briefunterzeichner_updated_at on public.briefunterzeichner;

create trigger briefunterzeichner_updated_at
  before update on public.briefunterzeichner
  for each row execute function public.set_updated_at_briefunterzeichner();
