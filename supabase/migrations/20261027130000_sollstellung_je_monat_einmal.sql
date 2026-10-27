-- 27.10.2026: Die Sollstellung (generate_monthly_mietforderungen, taeglich 05:00 UTC) pruefte jeden
-- Tag neu, ob im laufenden Monat eine Miete "in erwarteter Hoehe" steht, und setzte sonst die aelteste
-- Miete-Forderung des Monats auf die Vertragsmiete. Am Betrag allein ist aber nicht zu erkennen, welche
-- Forderung die Monatsmiete ist. Folgen:
--   * Eine von Hand geminderte Monatsmiete (Vertragsansicht -> Forderung bearbeiten) stand am naechsten
--     Morgen wieder auf voller Hoehe.
--   * Eine geloeschte Monatsmiete (z. B. erlassen) wurde am naechsten Morgen neu angelegt.
--   * Eine vorab fuer einen kuenftigen Monat angelegte Handforderung (CreateForderungModal, Typ Miete)
--     wurde am Monatsersten auf die volle Miete umgeschrieben, ihr eigener Betrag ging verloren.
-- Neu: Je Vertrag und Monat legt die Sollstellung die Miete genau einmal an und merkt sich das in
-- sollstellung_monate. Danach aendert sie nichts mehr; Mietaenderungen zieht wie bisher der Trigger
-- update_forderungen_on_rent_change nach (ab dem laufenden Monat, nur Forderungen auf der alten Miete).
-- mietforderungen_nachholen (beim Aktivieren eines Vertrags) traegt ihre Monate ebenfalls ein.
--
-- Ausserdem: mietforderungen_nachholen legte jeden vergangenen Monat mit der Anfangsmiete an. Bei einem
-- rueckwirkend erfassten Staffelvertrag blieben so alle Monate nach der ersten Stufe zu niedrig, denn
-- der Trigger zieht nur ab dem laufenden Monat nach. Jetzt gilt je Monat die Stufe, die in ihm gilt.
-- Die Stufen liest an einer Stelle staffelstufen(); staffelmieten_anwenden nimmt nur noch Betraege
-- ueber 0 und warnt, wenn eine Stufe nicht lesbar ist, statt sie still zu uebergehen.

create table if not exists public.sollstellung_monate (
  mietvertrag_id uuid not null references public.mietvertrag(id) on delete cascade,
  sollmonat date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mietvertrag_id, sollmonat)
);

alter table public.sollstellung_monate enable row level security;
revoke all on public.sollstellung_monate from anon;

create policy "Admins lesen Sollstellungsmonate"
  on public.sollstellung_monate for select to authenticated
  using (public.is_admin((select auth.uid())));

-- mietforderungen_nachholen laeuft als aufrufender Admin (SECURITY INVOKER)
create policy "Admins tragen Sollstellungsmonate ein"
  on public.sollstellung_monate for insert to authenticated
  with check (public.is_admin((select auth.uid())));

-- Bestand: jeder Monat, in dem eine Miete-Forderung steht, gilt als erledigt. Massgeblich ist nur der
-- laufende Monat; am 27.10.2026 hatten alle 96 abzurechnenden Vertraege dort ihre Miete.
insert into public.sollstellung_monate (mietvertrag_id, sollmonat)
select distinct mf.mietvertrag_id, mf.sollmonat
from public.mietforderungen mf
where coalesce(mf.typ, 'Miete') = 'Miete'
  and mf.mietvertrag_id is not null
  and mf.sollmonat is not null
on conflict do nothing;

-- Lesbare Stufen eines Staffelplans ([{gueltig_ab, kaltmiete}]): Datum JJJJ-MM-TT, Betrag ueber 0.
-- Der CASE schuetzt den Cast, AND allein garantiert in SQL keine Auswertungsreihenfolge.
create or replace function public.staffelstufen(p_plan jsonb)
 returns table(gueltig_ab date, kaltmiete numeric)
 language sql
 immutable
 set search_path to ''
as $function$
  select st.gueltig_ab, st.kaltmiete
  from (
    select case when s->>'gueltig_ab' ~ '^\d{4}-\d{2}-\d{2}$' then (s->>'gueltig_ab')::date end as gueltig_ab,
           case when jsonb_typeof(s->'kaltmiete') = 'number' then (s->>'kaltmiete')::numeric
                when s->>'kaltmiete' ~ '^\d+(\.\d+)?$' then (s->>'kaltmiete')::numeric end as kaltmiete
    from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else '[]'::jsonb end) s
  ) st
  where st.gueltig_ab is not null
    and st.kaltmiete is not null
    and st.kaltmiete > 0;
$function$;

-- Rein rechnend; mietforderungen_nachholen ruft sie als angemeldeter Admin auf
revoke execute on function public.staffelstufen(jsonb) from public, anon;
grant execute on function public.staffelstufen(jsonb) to authenticated;

create or replace function public.staffelmieten_anwenden()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_vertrag record;
  v_stufe record;
  v_angepasst int := 0;
begin
  for v_vertrag in
    select mv.id, mv.kaltmiete, mv.staffelplan, mv.letzte_mieterhoehung_am
    from mietvertrag mv
    where mv.mietanpassung_art = 'staffel'
      and mv.status in ('aktiv', 'gekuendigt')
      and jsonb_typeof(mv.staffelplan) = 'array'
  loop
    begin
      if jsonb_array_length(v_vertrag.staffelplan) > (select count(*) from staffelstufen(v_vertrag.staffelplan)) then
        raise warning 'Staffelplan von Vertrag % enthaelt nicht lesbare Stufen, sie werden uebergangen', v_vertrag.id;
      end if;

      select st.gueltig_ab, st.kaltmiete
      into v_stufe
      from staffelstufen(v_vertrag.staffelplan) st
      where st.gueltig_ab <= current_date
      order by st.gueltig_ab desc
      limit 1;

      if found
         and v_stufe.kaltmiete is distinct from v_vertrag.kaltmiete
         and (v_vertrag.letzte_mieterhoehung_am is null or v_stufe.gueltig_ab > v_vertrag.letzte_mieterhoehung_am)
      then
        update mietvertrag
        set kaltmiete = v_stufe.kaltmiete,
            letzte_mieterhoehung_am = v_stufe.gueltig_ab,
            aktualisiert_am = now()
        where id = v_vertrag.id;
        v_angepasst := v_angepasst + 1;
      end if;
    exception when others then
      raise warning 'Staffelmiete fuer Vertrag % uebersprungen: %', v_vertrag.id, sqlerrm;
    end;
  end loop;
  return v_angepasst;
end;
$function$;

revoke execute on function public.staffelmieten_anwenden() from public, anon, authenticated;

create or replace function public.generate_monthly_mietforderungen()
 returns table(action text, mietvertrag_id uuid, sollbetrag numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_month        date;
  v_contract     record;
  v_betrag       numeric;
  v_start_day    int;
  v_days         int;
  v_remaining    int;
begin
  -- Zuerst faellige Staffelstufen in die Vertragsmiete (staffelmieten_anwenden). Scheitert das
  -- unerwartet, laeuft die Sollstellung trotzdem -- sie darf an der Staffel nie haengen.
  begin
    perform public.staffelmieten_anwenden();
  exception when others then
    raise warning 'staffelmieten_anwenden gescheitert: %', sqlerrm;
  end;

  v_month := date_trunc('month', current_date)::date;

  for v_contract in
    select mv.id, mv.kaltmiete, mv.betriebskosten, mv.start_datum
    from   mietvertrag mv
    where  mv.status in ('aktiv', 'gekuendigt')
      and  mv.start_datum <= current_date
      and  (mv.ende_datum is null or mv.ende_datum >= current_date)
      and  (mv.kuendigungsdatum is null or mv.kuendigungsdatum > current_date)
  loop
    -- Je Vertrag und Monat genau einmal: Was danach mit der Forderung geschieht (Minderung,
    -- Loeschen, Korrektur), entscheidet der Mensch, nicht der naechste Lauf.
    if exists (
      select 1 from sollstellung_monate sm
      where sm.mietvertrag_id = v_contract.id
        and sm.sollmonat = v_month
    ) then
      continue;
    end if;

    v_betrag := coalesce(v_contract.kaltmiete, 0) + coalesce(v_contract.betriebskosten, 0);

    if v_contract.start_datum is not null
       and date_trunc('month', v_contract.start_datum)::date = v_month
    then
      v_start_day := extract(day from v_contract.start_datum)::int;
      if v_start_day > 1 then
        v_days      := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
        v_remaining := v_days - v_start_day + 1;
        v_betrag    := round((v_betrag / v_days::numeric) * v_remaining, 2);
      end if;
    end if;

    -- Steht die Miete schon (von Hand oder anders angelegt), nicht doppelt anlegen. Eine Forderung
    -- mit anderem Betrag (Handforderung, Gebuehr, BKA) ist nicht die Monatsmiete und bleibt daneben.
    if not exists (
      select 1 from mietforderungen mf
      where mf.mietvertrag_id = v_contract.id
        and mf.sollmonat = v_month
        and coalesce(mf.typ, 'Miete') = 'Miete'
        and abs(mf.sollbetrag - v_betrag) <= 0.01
    ) then
      insert into mietforderungen (id, mietvertrag_id, sollmonat, sollbetrag)
      values (gen_random_uuid(), v_contract.id, v_month, v_betrag);
      action := 'created';
      mietvertrag_id := v_contract.id;
      sollbetrag := v_betrag;
      return next;
    end if;

    insert into sollstellung_monate (mietvertrag_id, sollmonat)
    values (v_contract.id, v_month)
    on conflict do nothing;
  end loop;
end;
$function$;

revoke execute on function public.generate_monthly_mietforderungen() from public, anon, authenticated;

create or replace function public.mietforderungen_nachholen(p_mietvertrag_id uuid)
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  v_vertrag   record;
  v_monat     date;
  v_bis       date;
  v_betrag    numeric;
  v_kalt      numeric;
  v_tage      int;
  v_angelegt  int := 0;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins duerfen Forderungen anlegen';
  end if;

  select id, kaltmiete, betriebskosten, start_datum, ende_datum, kuendigungsdatum, status,
         mietanpassung_art, staffelplan
    into v_vertrag
    from public.mietvertrag
   where id = p_mietvertrag_id;

  if not found then
    raise exception 'Mietvertrag % nicht gefunden', p_mietvertrag_id;
  end if;

  if v_vertrag.status not in ('aktiv', 'gekuendigt') or v_vertrag.start_datum is null then
    return 0;
  end if;

  v_monat := date_trunc('month', v_vertrag.start_datum)::date;
  v_bis   := date_trunc('month', current_date)::date;
  if v_vertrag.ende_datum is not null then
    v_bis := least(v_bis, date_trunc('month', v_vertrag.ende_datum)::date);
  end if;

  while v_monat <= v_bis loop
    -- Staffel: die Stufe, die in diesem Monat gilt (vom Monat ihres gueltig_ab an, wie
    -- staffelmieten_anwenden). kaltmiete ist beim Aktivieren noch die Anfangsmiete.
    v_kalt := v_vertrag.kaltmiete;
    if v_vertrag.mietanpassung_art::text = 'staffel' then
      select st.kaltmiete into v_kalt
        from public.staffelstufen(v_vertrag.staffelplan) st
       where st.gueltig_ab <= (v_monat + interval '1 month' - interval '1 day')::date
       order by st.gueltig_ab desc
       limit 1;
      v_kalt := coalesce(v_kalt, v_vertrag.kaltmiete);
    end if;

    v_betrag := coalesce(v_kalt, 0) + coalesce(v_vertrag.betriebskosten, 0);

    if v_monat = date_trunc('month', v_vertrag.start_datum)::date
       and extract(day from v_vertrag.start_datum) > 1 then
      v_tage   := extract(day from (v_monat + interval '1 month' - interval '1 day'))::int;
      v_betrag := round((v_betrag / v_tage::numeric)
                        * (v_tage - extract(day from v_vertrag.start_datum)::int + 1), 2);
    end if;

    if not exists (
      select 1 from public.mietforderungen
       where mietvertrag_id = v_vertrag.id
         and sollmonat = v_monat
         and coalesce(typ, 'Miete') = 'Miete'
    ) then
      insert into public.mietforderungen (mietvertrag_id, sollmonat, sollbetrag)
      values (v_vertrag.id, v_monat, v_betrag);
      v_angelegt := v_angelegt + 1;
    end if;

    insert into public.sollstellung_monate (mietvertrag_id, sollmonat)
    values (v_vertrag.id, v_monat)
    on conflict do nothing;

    v_monat := (v_monat + interval '1 month')::date;
  end loop;

  return v_angelegt;
end;
$function$;

revoke execute on function public.mietforderungen_nachholen(uuid) from public, anon;

notify pgrst, 'reload schema';
