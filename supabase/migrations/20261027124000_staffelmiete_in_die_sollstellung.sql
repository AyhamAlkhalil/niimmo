-- 27.10.2026: Eine Staffelmiete erreichte die Sollstellung nie. Der Vertragsentwurf speichert die
-- Stufen in mietvertrag.staffelplan (jsonb: [{gueltig_ab, kaltmiete}]), kaltmiete bleibt die
-- Anfangsmiete -- und keine Datenbankfunktion, keine Edge Function und keine Ansicht ausserhalb des
-- Formulars las staffelplan. Ab der ersten Stufe haetten Sollstellung, Rueckstand, Mietsummen und
-- Mahnung mit der alten Miete gerechnet. Live gab es noch keinen Staffelvertrag.
--
-- Neu: staffelmieten_anwenden() setzt bei laufenden Vertraegen mit mietanpassung_art = 'staffel' die
-- Kaltmiete auf die juengste Stufe, deren gueltig_ab erreicht ist, und letzte_mieterhoehung_am auf
-- deren Datum. Jede Stufe wirkt genau einmal: nur, wenn ihr gueltig_ab nach letzte_mieterhoehung_am
-- liegt -- eine spaetere Korrektur der Miete von Hand wird so nicht taeglich zurueckgesetzt.
-- Ein fehlerhafter Plan (Datum oder Betrag nicht lesbar) betrifft nur seinen Vertrag: Er wird mit
-- einer Warnung uebersprungen, die Sollstellung aller anderen Vertraege laeuft weiter. Den Rest erledigt der bestehende Trigger update_forderungen_on_rent_change: Er zieht
-- die Forderungen ab dem laufenden Monat nach, die noch auf der alten Miete stehen. Die Funktion
-- laeuft am Anfang von generate_monthly_mietforderungen (taeglich 05:00 UTC), also vor der
-- Sollstellung desselben Tages. Eine Stufe gilt vom Monat ihres gueltig_ab an; Staffeln beginnen
-- ueblicherweise am Monatsersten.

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
      -- Nur lesbare Stufen: Datum JJJJ-MM-TT, Betrag als Zahl. Der CASE schuetzt den Cast,
      -- AND allein garantiert in SQL keine Auswertungsreihenfolge.
      select st.gueltig_ab, st.kaltmiete
      into v_stufe
      from (
        select case when s->>'gueltig_ab' ~ '^\d{4}-\d{2}-\d{2}$' then (s->>'gueltig_ab')::date end as gueltig_ab,
               case when jsonb_typeof(s->'kaltmiete') = 'number' then (s->>'kaltmiete')::numeric
                    when s->>'kaltmiete' ~ '^\d+(\.\d+)?$' then (s->>'kaltmiete')::numeric end as kaltmiete
        from jsonb_array_elements(v_vertrag.staffelplan) s
      ) st
      where st.gueltig_ab is not null
        and st.kaltmiete is not null
        and st.gueltig_ab <= current_date
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
  v_exist_id     uuid;
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
    select mv.id, mv.kaltmiete, mv.betriebskosten, mv.start_datum, mv.ruecklastschrift_gebuehr
    from   mietvertrag mv
    where  mv.status in ('aktiv', 'gekuendigt')
      and  mv.start_datum <= current_date
      and  (mv.ende_datum is null or mv.ende_datum >= current_date)
      and  (mv.kuendigungsdatum is null or mv.kuendigungsdatum > current_date)
  loop
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

    -- Miete in erwarteter Hoehe vorhanden: nichts zu tun
    if exists (
      select 1 from mietforderungen mf
      where mf.mietvertrag_id = v_contract.id
        and mf.sollmonat = v_month
        and coalesce(mf.typ, 'Miete') = 'Miete'
        and abs(mf.sollbetrag - v_betrag) <= 0.01
    ) then
      continue;
    end if;

    select mf.id
    into   v_exist_id
    from   mietforderungen mf
    where  mf.mietvertrag_id = v_contract.id
      and  mf.sollmonat = v_month
      and  coalesce(mf.typ, 'Miete') = 'Miete'
      and  not (
             mf.sollbetrag = coalesce(v_contract.ruecklastschrift_gebuehr, 7.50)
             and exists (
               select 1 from zahlungen z
               where z.kategorie = 'Rücklastschrift'
                 and z.mietvertrag_id = mf.mietvertrag_id
                 and z.buchungsdatum = mf.faelligkeitsdatum
             )
           )
    order by mf.erzeugt_am, mf.id
    limit 1;

    if v_exist_id is null then
      insert into mietforderungen (id, mietvertrag_id, sollmonat, sollbetrag)
      values (gen_random_uuid(), v_contract.id, v_month, v_betrag);
      action := 'created';
      mietvertrag_id := v_contract.id;
      sollbetrag := v_betrag;
      return next;
    else
      update mietforderungen set sollbetrag = v_betrag where id = v_exist_id;
      action := 'updated';
      mietvertrag_id := v_contract.id;
      sollbetrag := v_betrag;
      return next;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.generate_monthly_mietforderungen() from public, anon, authenticated;
