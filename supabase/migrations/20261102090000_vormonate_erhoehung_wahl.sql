-- 02.11.2026: Wahl bei Monaten vor der letzten Mieterhöhung (Kunde: „falls so ein Fall kommt … kurz hinweisen und dem
-- User die Wahl lassen“). Ändert die Vertragsbearbeitung Mietbeginn oder -ende so, dass Monate vor der letzten Erhöhung
-- betroffen sind, fragt sie nach: anpassen (wie seit 30.10.2026) oder unverändert lassen. Unverändert speichert sie
-- über mietvertrag_speichern, das die Wahl für diese Transaktion setzt; der Trigger lässt die Monate dann aus.

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
  -- „Heute“ in deutscher Zeit wie in der Oberfläche (30.10.2026, F2 der Prüfung vom 29.10.): Mit current_date
  -- (UTC) zog eine Korrektur am 1. zwischen 00:00 und 01:00 Uhr (Sommer 02:00) noch den Vormonat nach.
  v_heute     date    := public.heute_berlin();
  v_laufend   date    := date_trunc('month', v_heute)::date;
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
                                  v_laufend,
                                  case when extract(day from new.letzte_mieterhoehung_am) = 1
                                       then new.letzte_mieterhoehung_am
                                       else (date_trunc('month', new.letzte_mieterhoehung_am) + interval '1 month')::date
                                  end)
                           else v_laufend
                         end;
  -- Erster Monat mit der Miete der bisher letzten Erhöhung (30.10.2026, F1 der Prüfung vom 29.10.). Monate davor
  -- tragen eine frühere Miete: Dort zählt die vorhandene Monatsmiete, nicht die heutige Vertragsmiete. Bis heute
  -- übersprang der Trigger sie still, weil sie nicht zur heutigen Miete passten — ein Auszug am 20.10. nach einer
  -- Erhöhung ließ den Oktober voll stehen (Test K), ein nachgetragenes Ende im Mai den Mai voll (Test L).
  v_erh_alt   date    := case
                           when old.letzte_mieterhoehung_am is null then null
                           when extract(day from old.letzte_mieterhoehung_am) = 1 then old.letzte_mieterhoehung_am
                           else (date_trunc('month', old.letzte_mieterhoehung_am) + interval '1 month')::date
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
  v_gefunden  boolean;
  -- Wahl in der Vertragsbearbeitung (02.11.2026, Kunde: „kurz hinweisen und dem User die Wahl lassen“): Monate vor der
  -- letzten Erhöhung unverändert lassen. Setzt nur die RPC mietvertrag_speichern, für dieses eine Speichern.
  v_behalten  boolean := coalesce(current_setting('niimmo.vor_erhoehung_behalten', true), '') = 'ja';
begin
  -- Verlauf der Betriebskosten-Vorauszahlung für die Betriebskostenabrechnung (30.10.2026): ab welchem Monat die
  -- Monatsmieten den neuen Betrag tragen. mieterhoehung_anwenden_intern setzt gueltig_ab auf wirksam_ab zurück,
  -- wenn es zurückliegende Monate nachzieht.
  if old.betriebskosten is distinct from new.betriebskosten then
    insert into public.betriebskosten_verlauf (mietvertrag_id, gueltig_ab, betriebskosten_alt, betriebskosten_neu)
    values (new.id, v_ab, old.betriebskosten, new.betriebskosten);
  end if;

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
      v_tage_alt := public.monatstage(old.start_datum, v_alt_ende, v_f.sollmonat);
      -- Lag der Monat nach den alten Daten ganz außerhalb, hat die Sollstellung dort nichts angelegt
      if v_tage_alt = 0 then
        continue;
      end if;
      v_tage_neu := public.monatstage(new.start_datum, v_neu_ende, v_f.sollmonat);

      if v_f.sollmonat < v_erh_alt then
        -- Monat vor der letzten Erhöhung: Eine Mietänderung gilt hier nicht, nur die geänderte Laufzeit — und nur
        -- an der einzigen Monatsmiete des Monats
        if v_tage_alt = v_tage_neu or v_behalten then
          continue;
        end if;
        if exists (
             select 1 from public.mietforderungen g
              where g.mietvertrag_id = new.id
                and g.sollmonat = v_f.sollmonat
                and coalesce(g.typ, 'Miete') = 'Miete'
                and g.ruecklastschrift_am is null
                and g.id <> v_f.id) then
          continue;
        end if;
        v_basis := public.miete_vor_erhoehung(new.id, v_f.sollmonat, v_f.sollbetrag,
                                               old.start_datum, v_alt_ende, v_erh_alt);
      else
        v_alt := public.monatsanteil(v_alt_miete, old.start_datum, v_alt_ende, v_f.sollmonat);
        -- Nur, was noch so dasteht, wie die Sollstellung es angelegt hat
        if v_f.sollbetrag is distinct from round(v_alt, 2) then
          continue;
        end if;
        v_basis := case when v_f.sollmonat < v_ab then v_alt_miete else v_neu_miete end;
      end if;

      if v_tage_neu = 0 then
        -- Monat liegt ganz außerhalb der neuen Laufzeit
        delete from public.mietforderungen where id = v_f.id;
        delete from public.sollstellung_monate
         where mietvertrag_id = new.id and sollmonat = v_f.sollmonat;
        continue;
      end if;
      v_neu := round(public.monatsanteil(v_basis, new.start_datum, v_neu_ende, v_f.sollmonat), 2);
      -- Fälligkeit nur neu bestimmen, wenn sie noch der Vorgabe nach dem alten Beginn entspricht
      -- (8. des Monats, frühestens der Mietbeginn) — eine von Hand verschobene (Stundung) bleibt
      v_start_monat := coalesce(old.start_datum is distinct from new.start_datum
        and v_f.sollmonat in (date_trunc('month', old.start_datum)::date, date_trunc('month', new.start_datum)::date)
        and v_f.faelligkeitsdatum is not distinct from
            case when date_trunc('month', old.start_datum)::date = v_f.sollmonat
                 then greatest(v_f.sollmonat + 7, old.start_datum)
                 else v_f.sollmonat + 7 end, false);
      if v_neu = v_f.sollbetrag and not v_start_monat then
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
        if v_monat < v_erh_alt and v_behalten then
          v_gefunden := false;  -- auf Wunsch unverändert
        elsif v_monat < v_erh_alt then
          -- Vor der letzten Erhöhung: die einzige Monatsmiete des Monats, gleich mit welchem Betrag
          select f.id, f.sollbetrag, f.faelligkeitsdatum into v_f
            from public.mietforderungen f
           where f.mietvertrag_id = new.id
             and f.sollmonat = v_monat
             and coalesce(f.typ, 'Miete') = 'Miete'
             and f.ruecklastschrift_am is null
             and not exists (
                   select 1 from public.mietforderungen g
                    where g.mietvertrag_id = new.id
                      and g.sollmonat = v_monat
                      and coalesce(g.typ, 'Miete') = 'Miete'
                      and g.ruecklastschrift_am is null
                      and g.id <> f.id);
          v_gefunden := found;
          if v_gefunden then
            v_basis := public.miete_vor_erhoehung(new.id, v_monat, v_f.sollbetrag,
                                                   old.start_datum, v_alt_ende, v_erh_alt);
          end if;
        else
          v_basis := public.monatsmiete_am(old.kaltmiete, old.betriebskosten, old.mietanpassung_art::text, old.staffelplan, v_monat);
          v_alt := round(public.monatsanteil(v_basis, old.start_datum, v_alt_ende, v_monat), 2);
          select f.id, f.sollbetrag, f.faelligkeitsdatum into v_f
            from public.mietforderungen f
           where f.mietvertrag_id = new.id
             and f.sollmonat = v_monat
             and coalesce(f.typ, 'Miete') = 'Miete'
             and f.ruecklastschrift_am is null
             and f.sollbetrag = v_alt
           order by f.erzeugt_am, f.id
           limit 1;
          v_gefunden := found;
        end if;
        if v_gefunden then
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
            and not (new.status::text = 'beendet' and v_neu_ende is null)
            and not (v_monat < v_erh_alt and v_behalten) then
        -- Monat kommt neu in die Laufzeit: vor der letzten Erhöhung mit der vollen Monatsmiete daneben,
        -- sonst vergangene mit der Miete vor der Änderung, der laufende mit der neuen (wie die Sollstellung
        -- an diesem Tag)
        if v_monat < v_erh_alt then
          v_basis := coalesce(
            public.miete_vor_erhoehung(new.id, v_monat, null, old.start_datum, v_alt_ende, v_erh_alt),
            public.monatsmiete_am(old.kaltmiete, old.betriebskosten, old.mietanpassung_art::text, old.staffelplan, v_monat));
        elsif v_monat < v_laufend then
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


-- Speichert Felder eines Mietvertrags wie ein PostgREST-Update (gleiche RLS: security invoker, nur Admins dürfen
-- mietvertrag ändern), mit der Wahl, Monate vor der letzten Mieterhöhung unverändert zu lassen.
create or replace function public.mietvertrag_speichern(
  p_id uuid, p_aenderungen jsonb, p_vor_erhoehung_anpassen boolean default true)
returns void
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_spalten text;
  v_zeilen  int;
begin
  if p_aenderungen is null or jsonb_typeof(p_aenderungen) <> 'object' then
    raise exception 'Die Änderungen fehlen' using hint = 'UNGUELTIG';
  end if;
  if p_aenderungen ? 'id' then
    raise exception 'Die ID eines Vertrags lässt sich nicht ändern' using hint = 'UNGUELTIG';
  end if;
  perform set_config('niimmo.vor_erhoehung_behalten', case when p_vor_erhoehung_anpassen then '' else 'ja' end, true);
  select string_agg(format('%I = r.%I', k, k), ', ') into v_spalten
    from jsonb_object_keys(p_aenderungen) k;
  if v_spalten is null then
    return;
  end if;
  execute format(
    'update public.mietvertrag m set %s from jsonb_populate_record(null::public.mietvertrag, $1) r where m.id = $2',
    v_spalten) using p_aenderungen, p_id;
  -- EXECUTE setzt FOUND nicht; ohne Zeile (fremder Vertrag, RLS) wäre der Fehler still als Erfolg durchgegangen
  get diagnostics v_zeilen = row_count;
  if v_zeilen = 0 then
    raise exception 'Der Vertrag wurde nicht gefunden oder darf nicht geändert werden' using hint = 'NICHT_GEFUNDEN';
  end if;
  perform set_config('niimmo.vor_erhoehung_behalten', '', true);
end;
$function$;

revoke execute on function public.mietvertrag_speichern(uuid, jsonb, boolean) from public, anon;
grant execute on function public.mietvertrag_speichern(uuid, jsonb, boolean) to authenticated;
