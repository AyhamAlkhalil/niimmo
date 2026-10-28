-- 28.10.2026: Datumsänderungen ziehen auch vergangene Grenzmonate nach.
--
-- Befund: update_forderungen_on_rent_change (Fassung 20261028130000) korrigiert nur Monate ab dem
-- laufenden Monat und legt keinen Monat neu an. Offen blieben:
--   (a) Ein nachträglich eingetragenes Ende (am 28.10. das Ende 15.09.) ließ September voll stehen.
--   (b) Eine Verlängerung oder Reaktivierung, die erst später eingetragen wird, holte die Monate
--       seit dem alten Ende nicht nach; der alte Endmonat blieb anteilig. Lag der laufende Monat neu
--       in der Laufzeit, legte ihn der Cron nur bei Status aktiv/gekündigt an.
--   (c) Ein vorgezogener Mietbeginn holte die Monate dazwischen nicht nach.
--
-- Neu (Teil B): Bei einer Änderung von Beginn oder Ende werden die Monate ab 01/2025 bis zum
-- laufenden Monat betrachtet, deren Vertragstage sich ändern (monatstage alt <> neu). Das sind nur
-- die Grenzmonate zwischen alter und neuer Grenze; alle Monate innerhalb beider Laufzeiten haben
-- gleich viele Tage und bleiben unberührt.
--   - Vergangener Monat, der in der alten Laufzeit lag: Nur die Monatsmiete, die noch genau dem
--     Betrag nach den alten Daten entspricht, wird angepasst — oder samt Vermerk gelöscht, wenn der
--     Monat jetzt ganz außerhalb liegt. Von Hand geänderte Forderungen und Gebühren bleiben.
--   - Monat, der vorher ganz außerhalb lag und jetzt hineinfällt (auch der laufende): Fehlt er in
--     sollstellung_monate und gibt es keine Monatsmiete, wird er angelegt; der Vermerk kommt dazu.
--     Ein Monat innerhalb der alten Laufzeit wird nie neu angelegt. Deshalb füllt keine Änderung die
--     Altlücken auf (live am 28.10.2026: 113 Monate ohne Forderung und ohne Vermerk bei 20
--     Verträgen, alle innerhalb ihrer Laufzeit — Altbestand oder vor dem 27.10.2026 von Hand
--     gelöschte Forderungen, die keinen Vermerk hinterließen).
--   - Vergangene Monate rechnen mit der Miete vor der Änderung (bei Staffel: die Stufe des Monats,
--     monatsmiete_am). Eine Mietänderung wirkt weiter nur ab dem laufenden Monat.
--   - Ein beendeter Vertrag ohne Ende bekommt nichts neu angelegt (Laufzeit unbestimmt).
--
-- Teil A (ab dem laufenden Monat) bleibt die Regel aus 20261028130000 — mieterhoehung_anwenden_intern
-- (20261028142000) verlässt sich darauf. Ergänzt nur:
--   - Gebühren (mietforderungen.ruecklastschrift_am, 20261028140000) werden nie angefasst.
--   - Monate, die nach den alten Daten ganz außerhalb lagen (monatstage = 0), werden übersprungen:
--     Dort hat die Sollstellung nichts angelegt; eine Forderung über 0 € galt sonst als
--     „unverändert“ und wäre auf die neue Miete gesetzt worden.

-- Monatsmiete (Kalt + Betriebskosten) in einem Monat: bei Staffel die dann gültige Stufe
-- (wie mietforderungen_nachholen, vom Monat ihres gueltig_ab an), sonst die übergebene Kaltmiete
create or replace function public.monatsmiete_am(
  p_kaltmiete numeric,
  p_betriebskosten numeric,
  p_mietanpassung_art text,
  p_staffelplan jsonb,
  p_monat date
)
 returns numeric
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_kalt numeric := p_kaltmiete;
begin
  if p_mietanpassung_art = 'staffel' then
    select st.kaltmiete into v_kalt
      from public.staffelstufen(p_staffelplan) st
     where st.gueltig_ab <= (date_trunc('month', p_monat) + interval '1 month' - interval '1 day')::date
     order by st.gueltig_ab desc
     limit 1;
    v_kalt := coalesce(v_kalt, p_kaltmiete);
  end if;
  return coalesce(v_kalt, 0) + coalesce(p_betriebskosten, 0);
end;
$function$;

revoke execute on function public.monatsmiete_am(numeric, numeric, text, jsonb, date) from public, anon;

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
  v_laufend   date    := date_trunc('month', current_date)::date;
  v_daten     boolean := old.start_datum is distinct from new.start_datum
                         or coalesce(old.ende_datum, old.kuendigungsdatum)
                            is distinct from coalesce(new.ende_datum, new.kuendigungsdatum);
  v_f         record;
  v_alt       numeric;
  v_neu       numeric;
  v_start_monat boolean;
  v_monat     date;
  v_tage_alt  int;
  v_tage_neu  int;
  v_basis     numeric;
begin
  -- Teil A (20261028130000): Monatsmieten ab dem laufenden Monat auf neue Miete und Daten
  if v_alt_miete is distinct from v_neu_miete or v_daten then
    for v_f in
      select f.id, f.sollmonat, f.sollbetrag, f.faelligkeitsdatum
        from public.mietforderungen f
       where f.mietvertrag_id = new.id
         and coalesce(f.typ, 'Miete') = 'Miete'
         and f.ruecklastschrift_am is null
         and f.sollmonat >= v_laufend
    loop
      -- Lag der Monat nach den alten Daten ganz außerhalb, hat die Sollstellung dort nichts angelegt
      if public.monatstage(old.start_datum, v_alt_ende, v_f.sollmonat) = 0 then
        continue;
      end if;
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

  -- Teil B (28.10.2026): Grenzmonate ab 01/2025 bis zum laufenden Monat bei Datumsänderung
  if v_daten and new.start_datum is not null then
    for v_monat in
      select gs::date
        from generate_series(
               greatest(date '2025-01-01', date_trunc('month', least(old.start_datum, new.start_datum))::date),
               v_laufend,
               interval '1 month') gs
    loop
      v_tage_alt := public.monatstage(old.start_datum, v_alt_ende, v_monat);
      v_tage_neu := public.monatstage(new.start_datum, v_neu_ende, v_monat);
      if v_tage_alt = v_tage_neu then
        continue;  -- kein Grenzmonat
      end if;

      if v_tage_alt > 0 and v_monat < v_laufend then
        -- Vergangener Monat der alten Laufzeit (den laufenden behandelt Teil A)
        v_basis := public.monatsmiete_am(old.kaltmiete, old.betriebskosten, old.mietanpassung_art::text, old.staffelplan, v_monat);
        v_alt := round(public.monatsanteil(v_basis, old.start_datum, v_alt_ende, v_monat), 2);
        select f.id, f.faelligkeitsdatum into v_f
          from public.mietforderungen f
         where f.mietvertrag_id = new.id
           and f.sollmonat = v_monat
           and coalesce(f.typ, 'Miete') = 'Miete'
           and f.ruecklastschrift_am is null
           and f.sollbetrag = v_alt
         order by f.erzeugt_am, f.id
         limit 1;
        if found then
          if v_tage_neu = 0 then
            delete from public.mietforderungen where id = v_f.id;
            delete from public.sollstellung_monate
             where mietvertrag_id = new.id and sollmonat = v_monat;
          else
            v_start_monat := coalesce(old.start_datum is distinct from new.start_datum
              and v_monat in (date_trunc('month', old.start_datum)::date, date_trunc('month', new.start_datum)::date)
              and v_f.faelligkeitsdatum is not distinct from
                  case when date_trunc('month', old.start_datum)::date = v_monat
                       then greatest(v_monat + 7, old.start_datum)
                       else v_monat + 7 end, false);
            update public.mietforderungen
               set sollbetrag = round(public.monatsanteil(v_basis, new.start_datum, v_neu_ende, v_monat), 2),
                   faelligkeitsdatum = case when v_start_monat then null else faelligkeitsdatum end
             where id = v_f.id;
          end if;
        end if;

      elsif v_tage_alt = 0 and v_tage_neu > 0
            and not (new.status::text = 'beendet' and v_neu_ende is null) then
        -- Monat kommt neu in die Laufzeit: vergangene mit der Miete vor der Änderung, der laufende
        -- mit der neuen (wie die Sollstellung an diesem Tag)
        if v_monat < v_laufend then
          v_basis := public.monatsmiete_am(old.kaltmiete, old.betriebskosten, old.mietanpassung_art::text, old.staffelplan, v_monat);
        else
          v_basis := v_neu_miete;
        end if;
        if not exists (
             select 1 from public.sollstellung_monate sm
              where sm.mietvertrag_id = new.id and sm.sollmonat = v_monat)
           and not exists (
             select 1 from public.mietforderungen f
              where f.mietvertrag_id = new.id
                and f.sollmonat = v_monat
                and coalesce(f.typ, 'Miete') = 'Miete'
                and f.ruecklastschrift_am is null) then
          insert into public.mietforderungen (mietvertrag_id, sollmonat, sollbetrag)
          values (new.id, v_monat, round(public.monatsanteil(v_basis, new.start_datum, v_neu_ende, v_monat), 2));
        end if;
        insert into public.sollstellung_monate (mietvertrag_id, sollmonat)
        values (new.id, v_monat)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return new;
end;
$function$;

-- Wie seit 20261022020000: Trigger-Funktionen ruft niemand direkt auf
revoke execute on function public.update_forderungen_on_rent_change() from public, anon, authenticated;
