-- 30.10.2026: Offene Punkte der Prüfung vom 29.10.2026 im Mietkonto, auf Wunsch des Kunden („Alles beheben“).
--
-- F2: Ein „heute“ für alle Funktionen des Mietkontos, in deutscher Zeit wie die Oberfläche (heute_berlin). Mit
--     current_date (UTC) zog eine Korrektur am 1. zwischen 00:00 und 01:00 Uhr (Sommer 02:00) den Vormonat nach.
--     Die Nachtläufe (02:00–08:00 UTC) ändern sich dadurch nicht, dort ist der Kalendertag in UTC und Berlin gleich.
-- F1: update_forderungen_on_rent_change rechnet Monate vor der letzten Erhöhung bei geändertem Beginn oder Ende mit
--     der Miete, die dort steht (miete_vor_erhoehung), statt sie still zu übergehen.
-- L1: Vertragsablauf über das Vertragsende wie getVertragsende() (ende_datum vor kuendigungsdatum). Bis heute
--     beendete ein vergangenes kuendigungsdatum den Vertrag auch, wenn ende_datum später lag.
-- L4: mietforderungen_nachholen lässt sich von einer Rücklastschriftgebühr im Monat nicht mehr abhalten.
-- BK: Verlauf der Betriebskosten-Vorauszahlung (betriebskosten_verlauf), damit die Betriebskostenabrechnung je
--     Monat den Betrag ansetzt, den das Mietkonto verlangt hat, statt den heutigen für das ganze Jahr.

create or replace function public.heute_berlin()
returns date
language sql
stable
set search_path to ''
as $$ select (now() at time zone 'Europe/Berlin')::date $$;

comment on function public.heute_berlin() is
  'Kalendertag in deutscher Zeit. Das eine „heute“ aller Funktionen des Mietkontos (seit 30.10.2026).';

create table if not exists public.betriebskosten_verlauf (
  id                 uuid primary key default gen_random_uuid(),
  mietvertrag_id     uuid not null references public.mietvertrag(id) on delete cascade,
  gueltig_ab         date not null check (extract(day from gueltig_ab) = 1),
  betriebskosten_alt numeric,
  betriebskosten_neu numeric,
  erfasst_am         timestamptz not null default now()
);

comment on table public.betriebskosten_verlauf is
  'Jede Änderung der Betriebskosten-Vorauszahlung am Vertrag mit dem ersten Monat, ab dem die Monatsmieten den neuen '
  'Betrag tragen. Schreibt nur der Trigger update_forderungen_on_rent_change (und mieterhoehung_anwenden_intern '
  'verlegt gueltig_ab auf wirksam_ab). Grundlage der Vorauszahlung in der Betriebskostenabrechnung.';

create index if not exists betriebskosten_verlauf_vertrag_idx
  on public.betriebskosten_verlauf (mietvertrag_id, erfasst_am);

alter table public.betriebskosten_verlauf enable row level security;

drop policy if exists "Angemeldete lesen den Betriebskostenverlauf" on public.betriebskosten_verlauf;
create policy "Angemeldete lesen den Betriebskostenverlauf"
  on public.betriebskosten_verlauf for select to authenticated using (true);


-- F1, F2 und BK-Verlauf im Trigger
-- Volle Monatsmiete hinter einer Monatsmiete aus der Zeit vor der letzten Erhöhung (F1 der Prüfung vom 29.10.2026).
-- Ein voller Monat ist selbst die Monatsmiete. Ein anteiliger nimmt die nächstgelegene volle Monatsmiete vor p_vor,
-- wenn sein Betrag genau ihr Anteil ist; sonst wird er hochgerechnet. Ohne p_betrag (Monat kommt neu in die
-- Laufzeit) nur die nächstgelegene volle Monatsmiete, NULL wenn es keine gibt.
create or replace function public.miete_vor_erhoehung(
  p_vertrag uuid, p_monat date, p_betrag numeric, p_start date, p_ende date, p_vor date)
returns numeric
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_monat date := date_trunc('month', p_monat)::date;
  v_volle int  := extract(day from (v_monat + interval '1 month' - interval '1 day'))::int;
  v_tage  int  := public.monatstage(p_start, p_ende, v_monat);
  v_nb    numeric;
begin
  if p_betrag is not null and v_tage = v_volle then
    return p_betrag;
  end if;

  -- Nur Monate mit genau einer Monatsmiete: zwei im selben Monat (Handforderung daneben) sagen nichts
  select f.sollbetrag into v_nb
    from public.mietforderungen f
   where f.mietvertrag_id = p_vertrag
     and coalesce(f.typ, 'Miete') = 'Miete'
     and f.ruecklastschrift_am is null
     and f.sollmonat <> v_monat
     and f.sollmonat < p_vor
     and public.monatstage(p_start, p_ende, f.sollmonat)
         = extract(day from (date_trunc('month', f.sollmonat) + interval '1 month' - interval '1 day'))::int
     and not exists (
           select 1 from public.mietforderungen g
            where g.mietvertrag_id = f.mietvertrag_id
              and g.sollmonat = f.sollmonat
              and coalesce(g.typ, 'Miete') = 'Miete'
              and g.ruecklastschrift_am is null
              and g.id <> f.id)
   order by abs(f.sollmonat - v_monat), f.sollmonat desc
   limit 1;

  if p_betrag is null then
    return v_nb;
  end if;
  if v_nb is not null and round(public.monatsanteil(v_nb, p_start, p_ende, v_monat), 2) = p_betrag then
    return v_nb;
  end if;
  if v_tage = 0 then
    return null;
  end if;
  return p_betrag / v_tage * v_volle;
end;
$function$;

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
        if v_tage_alt = v_tage_neu then
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
        if v_monat < v_erh_alt then
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
            and not (new.status::text = 'beendet' and v_neu_ende is null) then
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


-- L1: Vertragsablauf über das Vertragsende
CREATE OR REPLACE FUNCTION public.auto_set_beendet_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  -- Vertragsende wie getVertragsende(): ende_datum führt, kuendigungsdatum nur als Ersatz (30.10.2026, L1)
  v_ende  date := coalesce(new.ende_datum, new.kuendigungsdatum);
  v_heute date := public.heute_berlin();
begin
  -- Ende liegt in der Vergangenheit -> beendet, gleich ob Befristung oder Kuendigung.
  if v_ende is not null and v_ende < v_heute then
    new.status := 'beendet';

  -- Ende liegt in der Zukunft: nur eine belegte Kuendigung macht aus einem
  -- aktiven Vertrag einen gekuendigten. Eine Befristung laesst ihn aktiv.
  elsif new.ende_datum is not null
        and new.ende_datum >= v_heute
        and new.kuendigungsdatum is not null
        and new.status = 'aktiv' then
    new.status := 'gekuendigt';

  -- Ende entfernt: nur zuruecksetzen, solange keine Kuendigung vorliegt.
  elsif tg_op = 'UPDATE'
        and new.ende_datum is null
        and old.ende_datum is not null
        and new.status = 'gekuendigt'
        and new.kuendigungsdatum is null then
    new.status := 'aktiv';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_contract_status_on_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Gekündigt → beendet, wenn das Vertragsende abgelaufen ist. Vertragsende wie getVertragsende(): ende_datum
  -- führt, kuendigungsdatum nur als Ersatz. Bis zum 30.10.2026 genügte ein vergangenes kuendigungsdatum, auch
  -- wenn ende_datum (etwa das Räumungsende) später lag (L1).
  IF NEW.status = 'gekuendigt'
     AND coalesce(NEW.ende_datum, NEW.kuendigungsdatum) < public.heute_berlin() THEN
    NEW.status = 'beendet';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_expired_terminated_contracts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Vertragsende wie getVertragsende() (30.10.2026, L1): ende_datum führt, kuendigungsdatum nur als Ersatz
  UPDATE public.mietvertrag
  SET
    status = 'beendet',
    aktualisiert_am = now()
  WHERE status IN ('aktiv', 'gekuendigt')
    AND coalesce(ende_datum, kuendigungsdatum) < public.heute_berlin();

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  BEGIN
    INSERT INTO public.system_logs (message, created_at)
    VALUES (
      'Automatisch ' || updated_count || ' Mietverträge auf beendet gesetzt (Vertragsende abgelaufen)',
      now()
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  RETURN updated_count;
END;
$function$;


-- F2: dieselben Funktionen wie live, nur current_date durch heute_berlin() ersetzt

CREATE OR REPLACE FUNCTION public.generate_monthly_mietforderungen()
 RETURNS TABLE(action text, mietvertrag_id uuid, sollbetrag numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 28.10.2026: Danach zugestimmte Mieterhoehungen, deren wirksam_ab erreicht ist -- vor der
  -- Sollstellung, damit der Monat des Wirksamwerdens gleich mit der neuen Miete entsteht.
  begin
    perform public.mieterhoehungen_anwenden();
  exception when others then
    raise warning 'mieterhoehungen_anwenden gescheitert: %', sqlerrm;
  end;

  v_month := date_trunc('month', public.heute_berlin())::date;
  v_monatsende := (v_month + interval '1 month' - interval '1 day')::date;
  v_days := extract(day from v_monatsende)::int;

  for v_contract in
    select mv.id, mv.kaltmiete, mv.betriebskosten, mv.start_datum,
           coalesce(mv.ende_datum, mv.kuendigungsdatum) as vertragsende
    from   mietvertrag mv
    where  mv.status in ('aktiv', 'gekuendigt')
      and  mv.start_datum <= public.heute_berlin()
      and  (coalesce(mv.ende_datum, mv.kuendigungsdatum) is null
            or coalesce(mv.ende_datum, mv.kuendigungsdatum) >= public.heute_berlin())
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

CREATE OR REPLACE FUNCTION public.mieterhoehungen_anwenden()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id   uuid;
  v_n    int := 0;
  v_hint text;
begin
  for v_id in
    select id
      from public.mieterhoehungen
     where status = 'zugestimmt'
       and wirksam_ab <= public.heute_berlin()
     order by wirksam_ab, verlangt_am
  loop
    begin
      perform public.mieterhoehung_anwenden_intern(v_id, false);
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      raise warning 'Mieterhoehung % nicht uebernommen: % (%)', v_id, sqlerrm, v_hint;
    end;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mieterhoehung_zustimmen(p_mieterhoehung_id uuid, p_trotz_abweichung boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mh public.mieterhoehungen%rowtype;
  v_n  int;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins duerfen Zustimmungen erfassen' using hint = 'NUR_ADMIN';
  end if;
  select * into v_mh from public.mieterhoehungen where id = p_mieterhoehung_id for update;
  if not found then
    raise exception 'Das Verlangen wurde nicht gefunden' using hint = 'NICHT_GEFUNDEN';
  end if;
  if v_mh.status <> 'verlangt' then
    raise exception 'Das Verlangen ist nicht mehr offen' using hint = 'NICHT_OFFEN';
  end if;
  -- Schon vereinbart, Staffel/Index, Vertragsende vor wirksam_ab: vor dem Update ablehnen
  perform public.mieterhoehung_zustimmung_pruefen(v_mh.mietvertrag_id, v_mh.wirksam_ab, v_mh.id);

  -- Kalendertag der Erfassung in deutscher Zeit (nur festgehalten, keine Fristgrenze)
  update public.mieterhoehungen
     set status = 'zugestimmt',
         zugestimmt_am = (now() at time zone 'Europe/Berlin')::date
   where id = v_mh.id;

  if v_mh.wirksam_ab <= public.heute_berlin() then
    v_n := public.mieterhoehung_anwenden_intern(v_mh.id, p_trotz_abweichung);
  end if;

  return jsonb_build_object(
    'status', case when v_n is null then 'zugestimmt' else 'wirksam' end,
    'wirksam_ab', v_mh.wirksam_ab,
    'nachberechnete_monate', coalesce(v_n, 0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mieterhoehung_anwenden_intern(p_id uuid, p_trotz_abweichung boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_mh       public.mieterhoehungen%rowtype;
  v_mv       record;
  v_ende     date;
  v_bk       numeric;
  v_schon    boolean;
  v_alt_ges  numeric;
  v_neu_ges  numeric;
  v_f        record;
  v_alt      numeric;
  v_neu      numeric;
  v_n        int := 0;
begin
  select * into v_mh from public.mieterhoehungen where id = p_id for update;
  if not found then
    raise exception 'Mieterhoehung % nicht gefunden', p_id using hint = 'NICHT_GEFUNDEN';
  end if;
  if v_mh.status <> 'zugestimmt' then
    raise exception 'Mieterhoehung % steht auf %, nicht auf zugestimmt', p_id, v_mh.status
      using hint = 'NICHT_ZUGESTIMMT';
  end if;
  -- Dasselbe „heute“ wie update_forderungen_on_rent_change, seit 30.10.2026 für beide deutsche Zeit
  -- (heute_berlin). Mit verschiedenen zöge der Trigger kurz nach Mitternacht am Monatsersten den Vormonat nach.
  if v_mh.wirksam_ab > public.heute_berlin() then
    raise exception 'Mieterhoehung % wird erst am % wirksam', p_id, v_mh.wirksam_ab
      using hint = 'NOCH_NICHT_WIRKSAM';
  end if;

  select id, kaltmiete, betriebskosten, start_datum, ende_datum, kuendigungsdatum, mietanpassung_art
    into v_mv
    from public.mietvertrag
   where id = v_mh.mietvertrag_id
     for update;
  if not found then
    raise exception 'Mietvertrag zur Mieterhoehung % nicht gefunden', p_id using hint = 'NICHT_GEFUNDEN';
  end if;
  -- §§ 557a Abs. 2, 557b Abs. 2 BGB: neben Staffel- und Indexmiete keine Erhöhung nach § 558
  if v_mv.mietanpassung_art::text in ('staffel', 'index') then
    raise exception 'Der Vertrag hat eine Staffel- oder Indexmiete' using hint = 'STAFFEL_ODER_INDEX';
  end if;
  -- Vertragsende wie getVertragsende() im Frontend
  v_ende := coalesce(v_mv.ende_datum, v_mv.kuendigungsdatum);
  if v_ende is not null and v_ende < v_mh.wirksam_ab then
    raise exception 'Der Vertrag endet vor dem Wirksamwerden' using hint = 'VERTRAG_ENDET_VORHER';
  end if;

  -- Betriebskosten nur, wenn das Verlangen sie ändert: Eine Anpassung der Vorauszahlung seit dem
  -- Verlangen (§ 560 BGB) bliebe sonst überschrieben. Bis heute schrieb der Dialog sie immer.
  v_bk := case when v_mh.neue_betriebskosten <> v_mh.alte_betriebskosten
               then v_mh.neue_betriebskosten
               else v_mv.betriebskosten end;
  -- Schon von Hand übernommen (etwa über die Vertragsbearbeitung): nur Status und Datum.
  -- is not distinct from: Eine fehlende Kaltmiete ergab mit „=“ NULL, und die Konfliktprüfung unten
  -- wäre still übersprungen worden (Review 28.10.2026)
  v_schon := v_mv.kaltmiete is not distinct from v_mh.neue_kaltmiete
             and v_mv.betriebskosten is not distinct from v_bk;

  if not v_schon and not p_trotz_abweichung and (
       v_mv.kaltmiete is distinct from v_mh.alte_kaltmiete
       or (v_mh.neue_betriebskosten <> v_mh.alte_betriebskosten
           and v_mv.betriebskosten is distinct from v_mh.alte_betriebskosten)) then
    raise exception 'Die Miete am Vertrag hat sich seit dem Verlangen geaendert'
      using hint = 'MIETE_GEAENDERT';
  end if;

  v_alt_ges := coalesce(v_mv.kaltmiete, 0) + coalesce(v_mv.betriebskosten, 0);
  v_neu_ges := v_mh.neue_kaltmiete + coalesce(v_bk, 0);

  -- Die Vertragsmiete; update_forderungen_on_rent_change zieht den laufenden Monat und spätere nach.
  -- Die Sperrfrist (§ 558 Abs. 1) zählt ab dem Wirksamwerden; ein späteres Datum bleibt.
  update public.mietvertrag
     set kaltmiete = v_mh.neue_kaltmiete,
         betriebskosten = v_bk,
         letzte_mieterhoehung_am = greatest(coalesce(letzte_mieterhoehung_am, v_mh.wirksam_ab), v_mh.wirksam_ab),
         aktualisiert_am = now()
   where id = v_mv.id;

  -- Betriebskostenverlauf (30.10.2026): Zieht die Schleife unten zurückliegende Monate nach, gilt die neue
  -- Vorauszahlung ab wirksam_ab, nicht erst ab dem laufenden Monat, den der Trigger eingetragen hat.
  if not v_schon and v_bk is distinct from v_mv.betriebskosten then
    update public.betriebskosten_verlauf
       set gueltig_ab = v_mh.wirksam_ab
     where mietvertrag_id = v_mv.id
       and erfasst_am = now()
       and gueltig_ab > v_mh.wirksam_ab;
  end if;

  -- Zurückliegende Monate ab wirksam_ab (späte Zustimmung oder verpasster Lauf): wie der Trigger
  -- nur Monatsmieten, die noch genau so dastehen, wie die Sollstellung sie mit der alten Miete
  -- angelegt hat. Geminderte oder von Hand geänderte bleiben, Gebühren (ruecklastschrift_am) und
  -- BKA ebenso.
  if not v_schon then
    for v_f in
      select f.id, f.sollmonat, f.sollbetrag
        from public.mietforderungen f
       where f.mietvertrag_id = v_mv.id
         and coalesce(f.typ, 'Miete') = 'Miete'
         and f.ruecklastschrift_am is null
         and f.sollmonat >= v_mh.wirksam_ab
         and f.sollmonat < date_trunc('month', public.heute_berlin())::date
    loop
      v_alt := round(public.monatsanteil(v_alt_ges, v_mv.start_datum, v_ende, v_f.sollmonat), 2);
      continue when v_f.sollbetrag is distinct from v_alt;
      v_neu := round(public.monatsanteil(v_neu_ges, v_mv.start_datum, v_ende, v_f.sollmonat), 2);
      continue when v_neu = v_alt;
      update public.mietforderungen set sollbetrag = v_neu where id = v_f.id;
      v_n := v_n + 1;
    end loop;
  end if;

  perform set_config('niimmo.mieterhoehung_anwenden', 'an', true);
  update public.mieterhoehungen set status = 'wirksam' where id = p_id;
  perform set_config('niimmo.mieterhoehung_anwenden', '', true);

  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.staffelmieten_anwenden()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      where st.gueltig_ab <= public.heute_berlin()
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

CREATE OR REPLACE FUNCTION public.mietforderungen_nachholen(p_mietvertrag_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_bis   := date_trunc('month', public.heute_berlin())::date;
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
         and ruecklastschrift_am is null  -- eine Rücklastschriftgebühr ist keine Monatsmiete (30.10.2026, L4)
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

CREATE OR REPLACE FUNCTION public.set_faelligkeitsdatum_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
begin
  if new.faelligkeitsdatum is null then
    if coalesce(new.typ, 'Miete') = 'BKA' then
      new.faelligkeitsdatum := public.heute_berlin() + interval '30 days';
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
  elsif new.faelligkeitsdatum <= public.heute_berlin() then
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

CREATE OR REPLACE FUNCTION public.update_faellige_forderungen()
 RETURNS TABLE(forderung_id uuid, mietvertrag_id uuid, sollmonat date, sollbetrag numeric, faelligkeitsdatum date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE mietforderungen
  SET
    ist_faellig = true,
    faellig_seit = mietforderungen.faelligkeitsdatum::timestamptz
  WHERE
    mietforderungen.faelligkeitsdatum <= public.heute_berlin()
    AND mietforderungen.ist_faellig = false
  RETURNING
    mietforderungen.id as forderung_id,
    mietforderungen.mietvertrag_id,
    mietforderungen.sollmonat,
    mietforderungen.sollbetrag,
    mietforderungen.faelligkeitsdatum;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_zahlungs_anomalien(p_tage_zurueck integer DEFAULT 60)
 RETURNS TABLE(action text, zahlung_id uuid, regel_typ text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_z RECORD;
  v_current RECORD;
  v_linked RECORD;
  v_mieter_ids uuid[];
  v_current_soll numeric;
  v_current_diff numeric;
  v_linked_diff numeric;
  v_best_id uuid;
  v_best_diff numeric;
  v_regel text;
  v_begruendung text;
  v_toleranz numeric := 5;
  v_mismatched_ids uuid[] := ARRAY[]::uuid[];
  v_window_start date := public.heute_berlin() - (p_tage_zurueck || ' days')::interval;
BEGIN
  FOR v_z IN
    SELECT z.id, z.betrag, z.buchungsdatum, z.mietvertrag_id, z.kategorie
    FROM zahlungen z
    WHERE z.mietvertrag_id IS NOT NULL
      AND z.kategorie IN ('Miete','Mietkaution')
      AND z.buchungsdatum >= v_window_start
    -- Jede Zahlung im Fenster wird jeden Lauf neu bewertet; abgehakte Fälle behalten ihren Status (ON CONFLICT).
  LOOP
    SELECT mv.kaltmiete, mv.betriebskosten, mv.kaution_betrag
    INTO v_current
    FROM mietvertrag mv WHERE mv.id = v_z.mietvertrag_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT array_agg(mieter_id) INTO v_mieter_ids
    FROM mietvertrag_mieter WHERE mietvertrag_id = v_z.mietvertrag_id;
    CONTINUE WHEN v_mieter_ids IS NULL;

    v_current_soll := COALESCE(v_current.kaltmiete,0) + COALESCE(v_current.betriebskosten,0);
    v_current_diff := CASE WHEN v_z.kategorie = 'Mietkaution'
      THEN ABS(v_z.betrag - v_current.kaution_betrag)
      ELSE ABS(v_z.betrag - v_current_soll)
    END;

    v_best_id := NULL; v_best_diff := NULL;

    FOR v_linked IN
      SELECT DISTINCT mv2.id, mv2.kaltmiete, mv2.betriebskosten, mv2.kaution_betrag,
             mv2.start_datum, mv2.ende_datum
      FROM mietvertrag_mieter mm2
      JOIN mietvertrag mv2 ON mv2.id = mm2.mietvertrag_id
      WHERE mm2.mieter_id = ANY(v_mieter_ids)
        AND mv2.id <> v_z.mietvertrag_id
        AND mv2.status IN ('aktiv','gekuendigt')
    LOOP
      CONTINUE WHEN v_linked.start_datum IS NULL;
      CONTINUE WHEN v_z.buchungsdatum < (v_linked.start_datum - INTERVAL '1 month');
      CONTINUE WHEN v_linked.ende_datum IS NOT NULL AND v_z.buchungsdatum > (v_linked.ende_datum + INTERVAL '1 month');
      -- Ein Vertrag ohne Soll (Stellplatz in der Wohnungsmiete) trägt keine Mietzahlung
      CONTINUE WHEN v_z.kategorie = 'Miete' AND COALESCE(v_linked.kaltmiete,0) + COALESCE(v_linked.betriebskosten,0) <= 0;

      v_linked_diff := CASE WHEN v_z.kategorie = 'Mietkaution'
        THEN (CASE WHEN v_linked.kaution_betrag IS NULL THEN NULL ELSE ABS(v_z.betrag - v_linked.kaution_betrag) END)
        ELSE ABS(v_z.betrag - (COALESCE(v_linked.kaltmiete,0) + COALESCE(v_linked.betriebskosten,0)))
      END;
      CONTINUE WHEN v_linked_diff IS NULL;

      IF v_best_diff IS NULL OR v_linked_diff < v_best_diff THEN
        v_best_diff := v_linked_diff; v_best_id := v_linked.id;
      END IF;
    END LOOP;

    CONTINUE WHEN v_best_id IS NULL;

    v_regel := NULL;
    IF v_z.kategorie = 'Miete' AND v_z.betrag > 0 AND v_current_soll <= 0 THEN
      v_regel := 'miete_an_vertrag_ohne_soll';
      v_begruendung := format('Mietzahlung %s€ hängt an einem Vertrag ohne Sollmiete; ein verbundener Vertrag desselben Mieters hat eine (Diff %s€).',
                              v_z.betrag, v_best_diff);
    ELSIF (v_current_diff IS NULL OR v_current_diff > v_toleranz) AND v_best_diff <= v_toleranz THEN
      v_regel := CASE WHEN v_z.kategorie = 'Mietkaution' THEN 'kaution_abweichung_verbundener_vertrag'
                      ELSE 'betrag_abweichung_verbundener_vertrag' END;
      v_begruendung := format('Zahlung %s€ passt nicht zum zugeordneten Vertrag (Diff %s€), aber zu verbundenem Vertrag desselben Mieters (Diff %s€).',
                              v_z.betrag, COALESCE(v_current_diff::text,'n/a'), v_best_diff);
    ELSIF v_current_diff IS NOT NULL AND v_current_diff <= v_toleranz AND v_best_diff <= v_toleranz
          AND (v_current_diff - v_best_diff) > 0.50 THEN
      v_regel := 'betrag_naeher_bei_verbundenem_vertrag';
      v_begruendung := format('Zahlung %s€ passt bei verbundenem Vertrag deutlich näher (Diff %s€) als beim zugeordneten Vertrag (Diff %s€).',
                              v_z.betrag, v_best_diff, v_current_diff);
    ELSIF v_z.kategorie = 'Miete' AND v_z.betrag - v_current_soll > v_toleranz
          AND v_best_diff * 2 <= v_current_diff THEN
      v_regel := 'betrag_deutlich_naeher_bei_verbundenem_vertrag';
      v_begruendung := format('Zahlung %s€ übersteigt das Soll des zugeordneten Vertrags (%s€) um %s€; bei verbundenem Vertrag desselben Mieters weicht sie nur um %s€ ab.',
                              v_z.betrag, v_current_soll, v_current_diff, v_best_diff);
    END IF;

    CONTINUE WHEN v_regel IS NULL;

    v_mismatched_ids := array_append(v_mismatched_ids, v_z.id);
    INSERT INTO zahlungs_anomalien
      (zahlung_id, zugeordneter_mietvertrag_id, vermuteter_mietvertrag_id, regel_typ,
       betrag, zugeordneter_vertrag_diff, vermuteter_vertrag_diff, begruendung, status,
       geprueft_von, geprueft_am)
    VALUES (v_z.id, v_z.mietvertrag_id, v_best_id, v_regel,
      v_z.betrag, v_current_diff, v_best_diff, v_begruendung, 'offen', NULL, NULL)
    ON CONFLICT (zahlung_id) DO UPDATE SET
      zugeordneter_mietvertrag_id = EXCLUDED.zugeordneter_mietvertrag_id,
      vermuteter_mietvertrag_id = EXCLUDED.vermuteter_mietvertrag_id,
      regel_typ = EXCLUDED.regel_typ,
      betrag = EXCLUDED.betrag,
      zugeordneter_vertrag_diff = EXCLUDED.zugeordneter_vertrag_diff,
      vermuteter_vertrag_diff = EXCLUDED.vermuteter_vertrag_diff,
      begruendung = EXCLUDED.begruendung,
      status = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                    THEN zahlungs_anomalien.status ELSE 'offen' END,
      geprueft_von = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                          THEN zahlungs_anomalien.geprueft_von END,
      geprueft_am = CASE WHEN zahlungs_anomalien.zugeordneter_mietvertrag_id IS NOT DISTINCT FROM EXCLUDED.zugeordneter_mietvertrag_id
                         THEN zahlungs_anomalien.geprueft_am END,
      updated_at = now();
    action := 'flagged'; zahlung_id := v_z.id; regel_typ := v_regel;
    RETURN NEXT;
  END LOOP;

  -- Auto-Resolve: Findings im geprueften Zeitfenster, die jetzt nicht mehr
  -- mismatchen, automatisch entfernen (Problem wurde offenbar anderweitig,
  -- z.B. durch manuelle Korrektur der Zuordnung, behoben).
  DELETE FROM zahlungs_anomalien za
  USING zahlungen z
  WHERE za.zahlung_id = z.id
    AND z.buchungsdatum >= v_window_start
    AND NOT (za.zahlung_id = ANY(v_mismatched_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ist_angespannter_markt(_ort text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.angespannte_maerkte am
     where lower(btrim(am.gemeinde)) = lower(btrim(_ort))
       and (am.gueltig_bis is null or am.gueltig_bis >= public.heute_berlin())
  );
$function$;
