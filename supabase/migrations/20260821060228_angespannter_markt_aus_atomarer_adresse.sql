-- immobilien.ist_angespannt stand bei allen 13 Objekten auf false, obwohl fuenf
-- davon in Gemeinden der Nds. Mieterschutzverordnung liegen (Wolfsburg, Hannover,
-- Seelze, Langenhagen, Hildesheim). Ursache: die Erkennung lief gegen das
-- Freitextfeld immobilien.adresse. Jetzt gibt es ein sauberes ort-Feld.
--
-- Wirkung ueber die Vertragsvorlage hinaus: Kappungsgrenze 15 statt 20 Prozent
-- (Paragraf 558 Abs. 3 S. 2 BGB), Mietpreisbremse (Paragrafen 556d ff. BGB),
-- verlaengerte Kuendigungssperrfrist (Paragraf 577a Abs. 2 BGB).

create or replace function public.ist_angespannter_markt(_ort text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.angespannte_maerkte am
     where lower(btrim(am.gemeinde)) = lower(btrim(_ort))
       and (am.gueltig_bis is null or am.gueltig_bis >= current_date)
  );
$$;

comment on function public.ist_angespannter_markt(text) is
  'Prueft eine Gemeinde gegen die Liste der Gebiete mit angespanntem Wohnungsmarkt.';

create or replace function public.set_angespannter_markt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.ort is not null and btrim(new.ort) <> '' then
    new.ist_angespannt := public.ist_angespannter_markt(new.ort);
  end if;
  return new;
end;
$$;

drop trigger if exists immobilien_angespannter_markt on public.immobilien;
create trigger immobilien_angespannter_markt
  before insert or update of ort on public.immobilien
  for each row execute function public.set_angespannter_markt();

-- Bestand einmalig nachziehen
update public.immobilien
   set ist_angespannt = public.ist_angespannter_markt(ort)
 where ort is not null and btrim(ort) <> '';
