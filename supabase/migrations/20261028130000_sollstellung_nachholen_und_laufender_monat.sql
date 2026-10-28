-- 28.10.2026 (Gesamtprüfung): Nachholen und laufender Monat
--
-- 1. mietforderungen_nachholen legte jeden Monat ab Mietbeginn an. Ein direkt erfasster Altvertrag
--    mit Beginn 2019 bekam so rund 90 Monatsforderungen, obwohl Forderungen und Zahlungen in der
--    Datenbank erst 2025 beginnen (erste Forderung 01/2025, erste Zahlung 27.12.2024) — der
--    Rückstand wäre um Jahresmieten zu hoch gewesen und in Mahnung und Zinsen gegangen. Nachgeholt
--    wird jetzt frühestens ab 01/2025. Monate, die schon in sollstellung_monate stehen, bleiben
--    unberührt: Was danach mit der Forderung geschah (gelöscht, gemindert), entscheidet der Mensch
--    — wie in generate_monthly_mietforderungen.
-- 2. update_forderungen_on_rent_change zog nur volle Monatsforderungen nach, die genau die alte
--    Miete trugen. Ein anteiliger Ein- oder Auszugsmonat blieb auf dem alten Betrag, und eine
--    Änderung von Beginn oder Ende (Auszug mitten im laufenden Monat, Räumungsende aus Mahnstufe 3,
--    Verlängerung) änderte die schon angelegte Forderung gar nicht. Jetzt wird jede Monatsmiete ab
--    dem laufenden Monat so gestellt, wie die Sollstellung sie mit den neuen Vertragsdaten angelegt
--    hätte — aber nur, solange sie noch genau dem Betrag nach den alten Daten entspricht (von Hand
--    geänderte Forderungen, Gebühren und BKA bleiben). Liegt der Monat nach der Änderung ganz
--    außerhalb der Laufzeit, entfällt die Forderung samt Vermerk in sollstellung_monate, damit eine
--    spätere Verlängerung ihn wieder sollstellt — auf mietforderungen verweist kein Fremdschlüssel,
--    Zahlungen hängen über den Monat am Vertrag. Eine Miete von 0 € innerhalb der Laufzeit löscht
--    nichts, sie setzt den Betrag. Verschiebt sich der Mietbeginn, wird die Fälligkeit der
--    betroffenen Forderung neu bestimmt (set_faelligkeitsdatum_trigger: nie vor Mietbeginn).
--    Vergangene Monate bleiben wie bisher unberührt.

-- Vertragstage in einem Monat (0, wenn der Monat außerhalb der Laufzeit liegt)
create or replace function public.monatstage(p_start date, p_ende date, p_monat date)
 returns int
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_monat date := date_trunc('month', p_monat)::date;
  v_letzter date;
  v_von date;
  v_bis date;
begin
  v_letzter := (v_monat + interval '1 month' - interval '1 day')::date;
  v_von := greatest(v_monat, coalesce(p_start, v_monat));
  v_bis := least(v_letzter, coalesce(p_ende, v_letzter));
  return greatest(v_bis - v_von + 1, 0);
end;
$function$;

revoke execute on function public.monatstage(date, date, date) from public, anon;

-- Monatsmiete taggenau anteilig wie in generate_monthly_mietforderungen und mietforderungen_nachholen:
-- round(miete / monatstage_gesamt * vertragstage, 2), ein voller Monat ungerundet
create or replace function public.monatsanteil(p_betrag numeric, p_start date, p_ende date, p_monat date)
 returns numeric
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_monat date := date_trunc('month', p_monat)::date;
  v_tage  int;
  v_n     int;
begin
  v_tage := extract(day from (v_monat + interval '1 month' - interval '1 day'))::int;
  v_n    := public.monatstage(p_start, p_ende, v_monat);
  if v_n = v_tage then
    return p_betrag;
  end if;
  return round((p_betrag / v_tage::numeric) * v_n, 2);
end;
$function$;

revoke execute on function public.monatsanteil(numeric, date, date, date) from public, anon;

create or replace function public.update_forderungen_on_rent_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alt_miete numeric := coalesce(old.kaltmiete, 0) + coalesce(old.betriebskosten, 0);
  v_neu_miete numeric := coalesce(new.kaltmiete, 0) + coalesce(new.betriebskosten, 0);
  v_alt_ende  date    := coalesce(old.ende_datum, old.kuendigungsdatum);
  v_neu_ende  date    := coalesce(new.ende_datum, new.kuendigungsdatum);
  v_f         record;
  v_alt       numeric;
  v_neu       numeric;
  v_start_monat boolean;
begin
  if v_alt_miete is distinct from v_neu_miete
     or old.start_datum is distinct from new.start_datum
     or v_alt_ende is distinct from v_neu_ende then
    for v_f in
      select f.id, f.sollmonat, f.sollbetrag, f.faelligkeitsdatum
        from public.mietforderungen f
       where f.mietvertrag_id = new.id
         and coalesce(f.typ, 'Miete') = 'Miete'
         and f.sollmonat >= date_trunc('month', current_date)::date
    loop
      v_alt := public.monatsanteil(v_alt_miete, old.start_datum, v_alt_ende, v_f.sollmonat);
      -- Nur, was noch so dasteht, wie die Sollstellung es angelegt hat
      if v_f.sollbetrag is distinct from round(v_alt, 2) then
        continue;
      end if;
      if public.monatstage(new.start_datum, v_neu_ende, v_f.sollmonat) = 0 then
        -- Monat liegt ganz außerhalb der neuen Laufzeit
        delete from public.mietforderungen where id = v_f.id;
        delete from public.sollstellung_monate
         where mietvertrag_id = new.id and sollmonat = v_f.sollmonat;
        continue;
      end if;
      v_neu := round(public.monatsanteil(v_neu_miete, new.start_datum, v_neu_ende, v_f.sollmonat), 2);
      -- Fälligkeit nur neu bestimmen, wenn sie noch der Vorgabe nach dem alten Beginn entspricht
      -- (8. des Monats, frühestens der Mietbeginn) — eine von Hand verschobene (Stundung) bleibt
      v_start_monat := coalesce(old.start_datum is distinct from new.start_datum
        and v_f.sollmonat in (date_trunc('month', old.start_datum)::date, date_trunc('month', new.start_datum)::date)
        and v_f.faelligkeitsdatum is not distinct from
            case when date_trunc('month', old.start_datum)::date = v_f.sollmonat
                 then greatest(v_f.sollmonat + 7, old.start_datum)
                 else v_f.sollmonat + 7 end, false);
      if v_neu = round(v_alt, 2) and not v_start_monat then
        continue;
      end if;
      -- faelligkeitsdatum null: set_faelligkeitsdatum_trigger bestimmt es neu (nie vor Mietbeginn)
      update public.mietforderungen
         set sollbetrag = v_neu,
             faelligkeitsdatum = case when v_start_monat then null else faelligkeitsdatum end
       where id = v_f.id;
    end loop;
  end if;
  return new;
end;
$function$;

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
  -- Frühestens ab Beginn der Buchhaltung in dieser Datenbank (siehe Kopf)
  v_monat := greatest(date_trunc('month', v_vertrag.start_datum)::date, date '2025-01-01');
  v_bis   := date_trunc('month', current_date)::date;
  if v_ende is not null then
    v_bis := least(v_bis, date_trunc('month', v_ende)::date);
  end if;

  while v_monat <= v_bis loop
    -- Schon sollgestellt: nicht noch einmal (gelöschte oder geminderte Forderung bleibt so)
    if exists (
      select 1 from public.sollstellung_monate sm
       where sm.mietvertrag_id = v_vertrag.id
         and sm.sollmonat = v_monat
    ) then
      v_monat := (v_monat + interval '1 month')::date;
      continue;
    end if;

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

notify pgrst, 'reload schema';
