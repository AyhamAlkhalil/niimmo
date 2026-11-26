-- Nacharbeit zu 20261126100000 (Review 26.11.2026).
--
-- 1. Eine Ablesung mit Datum in der Zukunft wird erst an ihrem Tag aktueller Stand. Die Vertragsbearbeitung
--    datiert Ein- und Auszugsstände auf Vertragsbeginn bzw. -ende; liegt das in der Zukunft, hätte dieser Wert
--    bis dahin jede echte Ablesung als „älter“ verdrängt. Bis dahin gilt die jüngste Ablesung bis heute; gibt es
--    nur künftige, die früheste davon. Ein täglicher Lauf zieht nach, sobald eine solche Ablesung fällig wird.
-- 2. „Heute“ nach Berliner Zeit (heute_berlin), nicht current_date (UTC) — Regel aus CLAUDE.md.

create or replace function public.zaehlerstand_aktuell_nachziehen(p_einheit uuid, p_immobilie uuid, p_typ text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_stand numeric;
  v_datum date;
  v_heute date := heute_berlin();
  v_stand_spalte text;
  v_datum_spalte text;
begin
  if p_einheit is not null then
    if p_typ not in ('kaltwasser', 'warmwasser', 'strom', 'gas') then
      return;
    end if;
    select z.stand, z.datum into v_stand, v_datum
    from zaehlerstand_historie z
    where z.einheit_id = p_einheit and z.zaehler_typ = p_typ and z.stand is not null
    order by (z.datum <= v_heute) desc,
             case when z.datum <= v_heute then z.datum end desc nulls last,
             z.datum asc, z.erstellt_am desc nulls last, z.id desc
    limit 1;
    execute format(
      'update einheiten set %1$I = $1, %2$I = $2 where id = $3 and (%1$I is distinct from $1 or %2$I is distinct from $2)',
      p_typ || '_stand_aktuell', p_typ || '_stand_datum'
    ) using v_stand, v_datum, p_einheit;
  elsif p_immobilie is not null then
    if p_typ not in ('wasser', 'strom', 'gas', 'wasser_2', 'strom_2', 'gas_2') then
      return;
    end if;
    select z.stand, z.datum into v_stand, v_datum
    from zaehlerstand_historie z
    where z.immobilie_id = p_immobilie and z.einheit_id is null and z.zaehler_typ = p_typ and z.stand is not null
    order by (z.datum <= v_heute) desc,
             case when z.datum <= v_heute then z.datum end desc nulls last,
             z.datum asc, z.erstellt_am desc nulls last, z.id desc
    limit 1;
    v_stand_spalte := 'allgemein_' || split_part(p_typ, '_', 1) || '_stand' || case when p_typ like '%\_2' then '_2' else '' end;
    v_datum_spalte := 'allgemein_' || split_part(p_typ, '_', 1) || '_datum' || case when p_typ like '%\_2' then '_2' else '' end;
    execute format(
      'update immobilien set %1$I = $1, %2$I = $2 where id = $3 and (%1$I is distinct from $1 or %2$I is distinct from $2)',
      v_stand_spalte, v_datum_spalte
    ) using v_stand, v_datum, p_immobilie;
  end if;
end;
$$;

create or replace function public.zaehlerstand_direkt_als_ablesung()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_alt jsonb := to_jsonb(old);
  v_neu jsonb := to_jsonb(new);
  v_typ text;
  v_stand_spalte text;
  v_datum_spalte text;
  v_nummer_spalte text;
  v_stand numeric;
  v_datum date;
  v_einheit uuid;
  v_immobilie uuid;
begin
  -- Nur direkte Schreibzugriffe; das Nachziehen aus der Historie läuft eine Ebene tiefer
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  foreach v_typ in array case when tg_table_name = 'einheiten'
    then array['kaltwasser', 'warmwasser', 'strom', 'gas']
    else array['wasser', 'strom', 'gas', 'wasser_2', 'strom_2', 'gas_2'] end
  loop
    if tg_table_name = 'einheiten' then
      v_stand_spalte := v_typ || '_stand_aktuell';
      v_datum_spalte := v_typ || '_stand_datum';
      v_nummer_spalte := v_typ || '_zaehler';
      v_einheit := new.id;
      v_immobilie := null;
    else
      v_stand_spalte := 'allgemein_' || split_part(v_typ, '_', 1) || '_stand' || case when v_typ like '%\_2' then '_2' else '' end;
      v_datum_spalte := 'allgemein_' || split_part(v_typ, '_', 1) || '_datum' || case when v_typ like '%\_2' then '_2' else '' end;
      v_nummer_spalte := 'allgemein_' || split_part(v_typ, '_', 1) || '_zaehler' || case when v_typ like '%\_2' then '_2' else '' end;
      v_einheit := null;
      v_immobilie := new.id;
    end if;

    continue when (v_alt -> v_stand_spalte) is not distinct from (v_neu -> v_stand_spalte)
              and (v_alt -> v_datum_spalte) is not distinct from (v_neu -> v_datum_spalte);

    v_stand := (v_neu ->> v_stand_spalte)::numeric;
    v_datum := coalesce((v_neu ->> v_datum_spalte)::date, heute_berlin());

    if v_stand is not null and not exists (
      select 1 from zaehlerstand_historie z
      where z.zaehler_typ = v_typ and z.stand = v_stand and z.datum = v_datum
        and (case when v_einheit is not null then z.einheit_id = v_einheit
                  else z.immobilie_id = v_immobilie and z.einheit_id is null end)
    ) then
      insert into zaehlerstand_historie (einheit_id, immobilie_id, zaehler_typ, zaehler_nummer, stand, datum, quelle, erstellt_von)
      values (v_einheit, v_immobilie, v_typ, nullif(btrim(v_neu ->> v_nummer_spalte), ''), v_stand, v_datum, 'manuell', auth.uid());
    else
      perform zaehlerstand_aktuell_nachziehen(v_einheit, v_immobilie, v_typ);
    end if;
  end loop;
  return null;
end;
$$;

-- Täglich nach der Sollstellung: Zähler mit einer seit kurzem fälligen Ablesung nachziehen
-- (sieben Tage Rückblick, falls ein Lauf ausfällt)
select cron.schedule(
  'niimmo-zaehlerstaende-faellig',
  '30 5 * * *',
  $cron$
  select public.zaehlerstand_aktuell_nachziehen(z.einheit_id, case when z.einheit_id is null then z.immobilie_id end, z.zaehler_typ)
  from (
    select distinct einheit_id, immobilie_id, zaehler_typ
    from public.zaehlerstand_historie
    where datum > public.heute_berlin() - 7 and datum <= public.heute_berlin()
  ) z
  $cron$
);
