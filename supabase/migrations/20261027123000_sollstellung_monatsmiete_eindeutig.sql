-- 27.10.2026: Zwei Befunde an der Sollstellung.
--
-- 1) Der pg_cron-Job generate-mietforderungen-hourly (jobid 3) ruft stuendlich die Edge Function
--    generate-mietforderungen mit einem anon-Bearer ohne x-cron-key auf. Sie antwortet jedes Mal
--    401, cron.job_run_details fuehrt den Lauf trotzdem als 'succeeded' (net.http_post wartet nicht
--    auf die Antwort). Die Forderungen erzeugt allein der taegliche Job niimmo-generate-mietforderungen
--    mit dieser Funktion. Den toten Job reparieren hiesse, zwei Sollstellungen nebeneinander laufen
--    zu lassen -- er gehoert gestrichen. Er gehoert aber supabase_read_only_user, und postgres darf
--    ihn weder abmelden noch loeschen (am 27.10.2026 geprueft: permission denied, kein SET ROLE).
--    Deshalb nicht hier: im Supabase-Dashboard unter Integrations -> Cron loeschen.
--
-- 2) generate_monthly_mietforderungen suchte die bestehende Forderung des Monats per SELECT ... INTO
--    ohne jeden Filter und nahm irgendeine Zeile. In 21 Vertrag-Monaten stehen neben der Miete
--    Ruecklastschrift-Gebuehren (7,50 EUR, ebenfalls typ 'Miete'); griff die Funktion die Gebuehr,
--    machte sie daraus eine zweite volle Miete. Ebenso eine von Hand angelegte Forderung im selben
--    Monat. Bisher ist es nicht passiert, es hing an der physischen Zeilenreihenfolge.
--    Neu: Steht im Monat schon eine Miete in der erwarteten Hoehe, bleibt alles, wie es ist.
--    Sonst wird die aelteste Mietforderung des Monats angepasst -- nie eine BKA-Forderung und nie
--    eine Ruecklastschrift-Gebuehr (Betrag = Gebuehr des Vertrags, Faelligkeit = Tag einer
--    Ruecklastschrift dieses Vertrags).

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
