-- Der aktuelle Zählerstand ist immer die jüngste Ablesung der Historie (26.11.2026).
--
-- Bis dahin führten einheiten.<typ>_stand_aktuell/_stand_datum und immobilien.allgemein_<art>_stand/_datum[_2]
-- dieselbe Aussage wie zaehlerstand_historie, und jede Maske hielt beides auf eigene Art zusammen:
-- - Hausmeister-Ansicht und Hausanschluss in der Objektübersicht schrieben den Stand ohne Historie, ein
--   älteres Datum überschrieb den neueren Stand. Der alte Wert war danach weg (Kundenmeldung 07.11.2026
--   „Gas Hausanschluss … der Alte ist verschwunden“, Objekt 9).
-- - Ein- und Auszugsstände aus der Vertragsbearbeitung standen nur in der Historie; die Zählerliste zeigte „—“.
-- - Ein in der Historie korrigiertes Datum erreichte den angezeigten Stand nie (Kundenmeldung 07.11.2026
--   „ich kann den angezeigten Stand nicht mehr älter machen“, Objekt 11).
-- Live waren am 26.11.2026 sieben Zähler betroffen.
--
-- Seither:
-- 1. Jede Änderung der Historie zieht den aktuellen Stand des Zählers nach (jüngstes Datum, bei gleichem
--    Tag der zuletzt erfasste Eintrag; ohne Ablesung leer).
-- 2. Wer den aktuellen Stand direkt schreibt (ältere Masken, Übergabe), schreibt damit eine Ablesung:
--    Fehlt sie in der Historie, wird sie eingetragen; danach gilt wieder Regel 1.
-- Zählernummern bleiben Stammdaten und werden nicht nachgezogen.

-- ---------- 0. Stände ohne Historie sichern, bevor Regel 1 sie leeren könnte ----------

insert into public.zaehlerstand_historie (einheit_id, zaehler_typ, zaehler_nummer, stand, datum, quelle)
select e.id, t.typ, t.nummer, t.stand, coalesce(t.datum, current_date), 'manuell'
from public.einheiten e
cross join lateral (values
  ('kaltwasser', e.kaltwasser_stand_aktuell, e.kaltwasser_stand_datum, e.kaltwasser_zaehler),
  ('warmwasser', e.warmwasser_stand_aktuell, e.warmwasser_stand_datum, e.warmwasser_zaehler),
  ('strom', e.strom_stand_aktuell, e.strom_stand_datum, e.strom_zaehler),
  ('gas', e.gas_stand_aktuell, e.gas_stand_datum, e.gas_zaehler)
) as t(typ, stand, datum, nummer)
where t.stand is not null
  and not exists (
    select 1 from public.zaehlerstand_historie z
    where z.einheit_id = e.id and z.zaehler_typ = t.typ and z.stand = t.stand
  );

insert into public.zaehlerstand_historie (immobilie_id, zaehler_typ, zaehler_nummer, stand, datum, quelle)
select i.id, t.typ, t.nummer, t.stand, coalesce(t.datum, current_date), 'manuell'
from public.immobilien i
cross join lateral (values
  ('wasser', i.allgemein_wasser_stand, i.allgemein_wasser_datum, i.allgemein_wasser_zaehler),
  ('strom', i.allgemein_strom_stand, i.allgemein_strom_datum, i.allgemein_strom_zaehler),
  ('gas', i.allgemein_gas_stand, i.allgemein_gas_datum, i.allgemein_gas_zaehler),
  ('wasser_2', i.allgemein_wasser_stand_2, i.allgemein_wasser_datum_2, i.allgemein_wasser_zaehler_2),
  ('strom_2', i.allgemein_strom_stand_2, i.allgemein_strom_datum_2, i.allgemein_strom_zaehler_2),
  ('gas_2', i.allgemein_gas_stand_2, i.allgemein_gas_datum_2, i.allgemein_gas_zaehler_2)
) as t(typ, stand, datum, nummer)
where t.stand is not null
  and not exists (
    select 1 from public.zaehlerstand_historie z
    where z.immobilie_id = i.id and z.einheit_id is null and z.zaehler_typ = t.typ and z.stand = t.stand
  );

-- ---------- 1. Aktuellen Stand eines Zählers aus der Historie bestimmen ----------

create or replace function public.zaehlerstand_aktuell_nachziehen(p_einheit uuid, p_immobilie uuid, p_typ text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_stand numeric;
  v_datum date;
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
    order by z.datum desc, z.erstellt_am desc nulls last, z.id desc
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
    order by z.datum desc, z.erstellt_am desc nulls last, z.id desc
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

comment on function public.zaehlerstand_aktuell_nachziehen(uuid, uuid, text) is
  'Setzt den aktuellen Stand eines Zählers auf die jüngste Ablesung der Historie (26.11.2026).';

-- ---------- 2. Regel 1: Historie geändert → aktuellen Stand nachziehen ----------

create or replace function public.zaehlerstand_historie_nachziehen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform zaehlerstand_aktuell_nachziehen(old.einheit_id, old.immobilie_id, old.zaehler_typ);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform zaehlerstand_aktuell_nachziehen(new.einheit_id, new.immobilie_id, new.zaehler_typ);
  end if;
  return null;
end;
$$;

drop trigger if exists zaehlerstand_historie_nachziehen on public.zaehlerstand_historie;
create trigger zaehlerstand_historie_nachziehen
  after insert or delete or update of stand, datum, zaehler_typ, einheit_id, immobilie_id
  on public.zaehlerstand_historie
  for each row execute function public.zaehlerstand_historie_nachziehen();

-- ---------- 3. Regel 2: aktueller Stand direkt geschrieben → als Ablesung eintragen ----------

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
  -- Nur direkte Schreibzugriffe; das Nachziehen aus Regel 1 läuft eine Ebene tiefer
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
    v_datum := coalesce((v_neu ->> v_datum_spalte)::date, current_date);

    if v_stand is not null and not exists (
      select 1 from zaehlerstand_historie z
      where z.zaehler_typ = v_typ and z.stand = v_stand and z.datum = v_datum
        and (case when v_einheit is not null then z.einheit_id = v_einheit
                  else z.immobilie_id = v_immobilie and z.einheit_id is null end)
    ) then
      -- Fügt die Ablesung ein; Regel 1 zieht danach den Stand nach
      insert into zaehlerstand_historie (einheit_id, immobilie_id, zaehler_typ, zaehler_nummer, stand, datum, quelle, erstellt_von)
      values (v_einheit, v_immobilie, v_typ, nullif(btrim(v_neu ->> v_nummer_spalte), ''), v_stand, v_datum, 'manuell', auth.uid());
    else
      -- Bekannte Ablesung oder geleert: Es gilt die jüngste Ablesung
      perform zaehlerstand_aktuell_nachziehen(v_einheit, v_immobilie, v_typ);
    end if;
  end loop;
  return null;
end;
$$;

comment on function public.zaehlerstand_direkt_als_ablesung() is
  'Ein direkt geschriebener aktueller Zählerstand wird als Ablesung in die Historie übernommen (26.11.2026).';

drop trigger if exists zaehlerstand_direkt_als_ablesung on public.einheiten;
create trigger zaehlerstand_direkt_als_ablesung
  after update of kaltwasser_stand_aktuell, kaltwasser_stand_datum, warmwasser_stand_aktuell, warmwasser_stand_datum,
    strom_stand_aktuell, strom_stand_datum, gas_stand_aktuell, gas_stand_datum
  on public.einheiten
  for each row execute function public.zaehlerstand_direkt_als_ablesung();

drop trigger if exists zaehlerstand_direkt_als_ablesung on public.immobilien;
create trigger zaehlerstand_direkt_als_ablesung
  after update of allgemein_wasser_stand, allgemein_wasser_datum, allgemein_strom_stand, allgemein_strom_datum,
    allgemein_gas_stand, allgemein_gas_datum, allgemein_wasser_stand_2, allgemein_wasser_datum_2,
    allgemein_strom_stand_2, allgemein_strom_datum_2, allgemein_gas_stand_2, allgemein_gas_datum_2
  on public.immobilien
  for each row execute function public.zaehlerstand_direkt_als_ablesung();

-- ---------- 4. Bestand einmal nachziehen ----------

select public.zaehlerstand_aktuell_nachziehen(e.id, null, t.typ)
from public.einheiten e cross join unnest(array['kaltwasser', 'warmwasser', 'strom', 'gas']) as t(typ);

select public.zaehlerstand_aktuell_nachziehen(null, i.id, t.typ)
from public.immobilien i cross join unnest(array['wasser', 'strom', 'gas', 'wasser_2', 'strom_2', 'gas_2']) as t(typ);
