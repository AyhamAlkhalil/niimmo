-- 27.10.2026 (Systemprüfung): Sollstellung und Fälligkeit
--
-- 1. Der letzte Vertragsmonat wurde voll sollgestellt, nur der erste anteilig: Vormieter bis 14.11.,
--    Nachmieter ab 15.11. ergab vom 15. bis 30.11. doppeltes Soll; ein Räumungsende aus Mahnstufe 3
--    oder fristloser Kündigung liegt fast immer mitten im Monat. Jetzt taggenau wie der Startmonat,
--    in generate_monthly_mietforderungen und mietforderungen_nachholen.
-- 2. Der Lauf verlangte kuendigungsdatum > heute, aber ende_datum >= heute: Endete ein Vertrag am
--    Monatsersten, bekam dieser Monat keine Forderung. Maßgeblich ist jetzt wie im Frontend
--    getVertragsende(): coalesce(ende_datum, kuendigungsdatum), verglichen mit >=.
-- 3. set_faelligkeitsdatum_trigger: Die erste, anteilige Miete war am 8. des Monats fällig, auch bei
--    Mietbeginn am 15. (Rückstand und Verzug vor Mietbeginn) — jetzt frühestens am Mietbeginn.
--    faellig_seit wurde bei jedem UPDATE einer fälligen Forderung auf jetzt gesetzt, auch über den
--    Wert, den update_faellige_forderungen gerade schrieb; jetzt nur beim Fälligwerden.
-- 4. Auf mietvertrag liefen auto_set_beendet_status_trigger und trigger_auto_set_beendet mit
--    derselben Funktion; der zweite entfällt (die Funktion ist idempotent, das Ergebnis bleibt gleich).

create or replace function public.generate_monthly_mietforderungen()
 returns table(action text, mietvertrag_id uuid, sollbetrag numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_month        date;
  v_monatsende   date;
  v_contract     record;
  v_betrag       numeric;
  v_von          int;
  v_bis          int;
  v_days         int;
  v_ende         date;
begin
  -- Zuerst faellige Staffelstufen in die Vertragsmiete (staffelmieten_anwenden). Scheitert das
  -- unerwartet, laeuft die Sollstellung trotzdem -- sie darf an der Staffel nie haengen.
  begin
    perform public.staffelmieten_anwenden();
  exception when others then
    raise warning 'staffelmieten_anwenden gescheitert: %', sqlerrm;
  end;

  v_month := date_trunc('month', current_date)::date;
  v_monatsende := (v_month + interval '1 month' - interval '1 day')::date;
  v_days := extract(day from v_monatsende)::int;

  for v_contract in
    select mv.id, mv.kaltmiete, mv.betriebskosten, mv.start_datum,
           coalesce(mv.ende_datum, mv.kuendigungsdatum) as vertragsende
    from   mietvertrag mv
    where  mv.status in ('aktiv', 'gekuendigt')
      and  mv.start_datum <= current_date
      and  (coalesce(mv.ende_datum, mv.kuendigungsdatum) is null
            or coalesce(mv.ende_datum, mv.kuendigungsdatum) >= current_date)
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

    -- Anteilig, wenn der Vertrag in diesem Monat beginnt oder endet (taggenau)
    v_von := 1;
    v_bis := v_days;
    if v_contract.start_datum is not null and date_trunc('month', v_contract.start_datum)::date = v_month then
      v_von := extract(day from v_contract.start_datum)::int;
    end if;
    v_ende := v_contract.vertragsende;
    if v_ende is not null and date_trunc('month', v_ende)::date = v_month then
      v_bis := extract(day from v_ende)::int;
    end if;
    if v_von > 1 or v_bis < v_days then
      v_betrag := round((v_betrag / v_days::numeric) * greatest(v_bis - v_von + 1, 0), 2);
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
  v_ende      date;
  v_betrag    numeric;
  v_kalt      numeric;
  v_tage      int;
  v_von_tag   int;
  v_bis_tag   int;
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

  -- Vertragsende wie getVertragsende() im Frontend
  v_ende  := coalesce(v_vertrag.ende_datum, v_vertrag.kuendigungsdatum);
  v_monat := date_trunc('month', v_vertrag.start_datum)::date;
  v_bis   := date_trunc('month', current_date)::date;
  if v_ende is not null then
    v_bis := least(v_bis, date_trunc('month', v_ende)::date);
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

    -- Anteilig im Start- und im Endmonat (taggenau)
    v_tage    := extract(day from (v_monat + interval '1 month' - interval '1 day'))::int;
    v_von_tag := 1;
    v_bis_tag := v_tage;
    if v_monat = date_trunc('month', v_vertrag.start_datum)::date then
      v_von_tag := extract(day from v_vertrag.start_datum)::int;
    end if;
    if v_ende is not null and v_monat = date_trunc('month', v_ende)::date then
      v_bis_tag := extract(day from v_ende)::int;
    end if;
    if v_von_tag > 1 or v_bis_tag < v_tage then
      v_betrag := round((v_betrag / v_tage::numeric) * greatest(v_bis_tag - v_von_tag + 1, 0), 2);
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

create or replace function public.set_faelligkeitsdatum_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date;
begin
  if new.faelligkeitsdatum is null then
    if coalesce(new.typ, 'Miete') = 'BKA' then
      new.faelligkeitsdatum := current_date + interval '30 days';
    else
      -- sollmonat ist DATE (erster des Monats), +7 Tage = 8. des Monats ...
      new.faelligkeitsdatum := new.sollmonat + interval '7 days';
      -- ... aber nie vor Mietbeginn: die erste, anteilige Miete bei Beginn am 15.
      select mv.start_datum into v_start from mietvertrag mv where mv.id = new.mietvertrag_id;
      if v_start is not null
         and date_trunc('month', v_start)::date = new.sollmonat
         and v_start > new.faelligkeitsdatum then
        new.faelligkeitsdatum := v_start;
      end if;
    end if;
  end if;

  -- Guthaben ist keine Forderung.
  if coalesce(new.sollbetrag, 0) < 0 then
    new.ist_faellig := false;
    new.faellig_seit := null;
  elsif new.faelligkeitsdatum <= current_date then
    -- Nur beim Faelligwerden setzen; einen vorhandenen Zeitpunkt (z. B. von
    -- update_faellige_forderungen) nicht ueberschreiben
    if tg_op = 'INSERT' or not coalesce(old.ist_faellig, false) or new.faellig_seit is null then
      new.ist_faellig := true;
      new.faellig_seit := coalesce(new.faellig_seit, current_timestamp);
    end if;
  else
    -- Faelligkeit in die Zukunft verschoben: nicht mehr faellig
    new.ist_faellig := false;
    new.faellig_seit := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists trigger_auto_set_beendet on public.mietvertrag;

notify pgrst, 'reload schema';
