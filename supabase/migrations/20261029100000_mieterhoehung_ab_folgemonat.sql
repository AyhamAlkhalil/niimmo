-- Mieterhöhung ab Folgemonat: Eine offizielle Mieterhöhung in der Vertragsbearbeitung hebt den
-- laufenden Monat nicht mehr rückwirkend an (Entscheidung 29.10.2026). Reine Korrekturen und
-- Datumsänderungen ziehen den laufenden Monat weiter nach, bis zur Wirksamkeit mit der alten Miete.

CREATE OR REPLACE FUNCTION public.update_forderungen_on_rent_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alt_miete numeric := coalesce(old.kaltmiete, 0) + coalesce(old.betriebskosten, 0);
  v_neu_miete numeric := coalesce(new.kaltmiete, 0) + coalesce(new.betriebskosten, 0);
  v_alt_ende  date    := coalesce(old.ende_datum, old.kuendigungsdatum);
  v_neu_ende  date    := coalesce(new.ende_datum, new.kuendigungsdatum);
  v_laufend   date    := date_trunc('month', current_date)::date;
  -- Ab welchem Monat die neue Miete gilt (29.10.2026, Entscheidung des Nutzers): Eine offizielle
  -- Mieterhöhung (letzte_mieterhoehung_am neu gesetzt) gilt ab dem Folgemonat, fällt sie auf einen
  -- Monatsersten (Wirksamkeitstag aus mieterhoehungen, Staffelstufe), ab diesem Monat. Eine reine
  -- Korrektur der Miete gilt ab dem laufenden Monat; ebenso eine zweite Änderung mit unverändertem
  -- letzte_mieterhoehung_am. Monate davor rechnen mit der alten Miete — auch wenn im selben Speichern
  -- Beginn oder Ende geändert werden (Review 29.10.2026). Seit Migration 20261028130000 hob die
  -- Vertragsbearbeitung eine Erhöhung rückwirkend für den ganzen laufenden Monat an.
  v_ab        date    := case
                           when new.letzte_mieterhoehung_am is not null
                            and new.letzte_mieterhoehung_am is distinct from old.letzte_mieterhoehung_am
                           then greatest(
                                  date_trunc('month', current_date)::date,
                                  case when extract(day from new.letzte_mieterhoehung_am) = 1
                                       then new.letzte_mieterhoehung_am
                                       else (date_trunc('month', new.letzte_mieterhoehung_am) + interval '1 month')::date
                                  end)
                           else date_trunc('month', current_date)::date
                         end;
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
      v_neu := round(public.monatsanteil(
                 case when v_f.sollmonat < v_ab then v_alt_miete else v_neu_miete end,
                 new.start_datum, v_neu_ende, v_f.sollmonat), 2);
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
        elsif v_monat < v_ab then
          v_basis := v_alt_miete;  -- offizielle Erhöhung erst ab Folgemonat
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
