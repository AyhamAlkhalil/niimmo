-- Rücklastschrift: nur die Pauschale (Kundenentscheidung 29.10.2026)
--
-- Bisher zahlte der Mieter die Bankgebühr doppelt: einmal im Rückbuchungsbetrag (−503 € für 500 € Miete) und dazu die
-- Pauschale aus dem Vertrag (7,50 €) als eigene Forderung. Jetzt wird nur der Rest der Pauschale angelegt, sodass er
-- insgesamt genau die Pauschale trägt. Die bestehenden Gebühren werden ebenso berichtigt (live 19 Forderungen).

CREATE OR REPLACE FUNCTION public.create_ruecklastschrift_forderung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alt_rl  boolean := false;
  v_neu_rl  boolean := false;
  v_monat   date;
  v_vertrag record;
  v_ende    date;
  v_gebuehr numeric;
  v_bankgebuehr numeric;
begin
  if TG_OP = 'UPDATE' then
    if NEW.kategorie is not distinct from OLD.kategorie
       and NEW.mietvertrag_id is not distinct from OLD.mietvertrag_id
       and NEW.zugeordneter_monat is not distinct from OLD.zugeordneter_monat
       and NEW.buchungsdatum is not distinct from OLD.buchungsdatum then
      return NEW;
    end if;
  end if;

  -- Verschachtelt statt mit AND: NEW gibt es bei DELETE nicht, OLD nicht bei INSERT
  if TG_OP <> 'INSERT' then
    v_alt_rl := OLD.kategorie = 'Rücklastschrift' and OLD.mietvertrag_id is not null and OLD.buchungsdatum is not null;
  end if;
  if TG_OP <> 'DELETE' then
    v_neu_rl := NEW.kategorie = 'Rücklastschrift' and NEW.mietvertrag_id is not null and NEW.buchungsdatum is not null;
  end if;
  if not v_alt_rl and not v_neu_rl then
    return coalesce(NEW, OLD);
  end if;

  if v_neu_rl then
    -- zugeordneter_monat ist 'YYYY-MM' (TEXT); Unlesbares -> Buchungsmonat
    v_monat := coalesce(
      case when NEW.zugeordneter_monat ~ '^\d{4}-(0[1-9]|1[0-2])$' then (NEW.zugeordneter_monat || '-01')::date end,
      date_trunc('month', NEW.buchungsdatum)::date
    );
  end if;

  -- 1) Dieselbe Rücklastschrift, nur ein anderer Monat: Gebühr umhängen, nie neu anlegen.
  --    Tragen noch andere Rücklastschriften desselben Tages sie (Aufteilung), bleibt der Monat.
  if v_alt_rl and v_neu_rl
     and NEW.mietvertrag_id = OLD.mietvertrag_id
     and NEW.buchungsdatum = OLD.buchungsdatum then
    if not exists (
      select 1 from zahlungen z
       where z.id <> NEW.id
         and z.kategorie = 'Rücklastschrift'
         and z.mietvertrag_id = NEW.mietvertrag_id
         and z.buchungsdatum = NEW.buchungsdatum
    ) then
      update mietforderungen
         set sollmonat = v_monat
       where mietvertrag_id = NEW.mietvertrag_id
         and ruecklastschrift_am = NEW.buchungsdatum
         and sollmonat is distinct from v_monat;
    end if;
    return NEW;
  end if;

  -- 2) Der alte Schlüssel (Vertrag, Buchungstag) verwaist?
  if v_alt_rl and not exists (
    select 1 from zahlungen z
     where z.id <> OLD.id
       and z.kategorie = 'Rücklastschrift'
       and z.mietvertrag_id = OLD.mietvertrag_id
       and z.buchungsdatum = OLD.buchungsdatum
  ) then
    if v_neu_rl
       and NEW.mietvertrag_id = OLD.mietvertrag_id
       and not exists (
         select 1 from mietforderungen
          where mietvertrag_id = NEW.mietvertrag_id
            and ruecklastschrift_am = NEW.buchungsdatum
       ) then
      -- Nur der Buchungstag wurde berichtigt: dieselbe Gebühr wandert mit (kein Neuanlegen)
      update mietforderungen
         set ruecklastschrift_am = NEW.buchungsdatum,
             faelligkeitsdatum   = NEW.buchungsdatum,
             sollmonat           = v_monat
       where mietvertrag_id = OLD.mietvertrag_id
         and ruecklastschrift_am = OLD.buchungsdatum;
      return NEW;
    end if;
    delete from mietforderungen
     where mietvertrag_id = OLD.mietvertrag_id
       and ruecklastschrift_am = OLD.buchungsdatum;
  end if;

  if not v_neu_rl then
    return coalesce(NEW, OLD);
  end if;

  -- 3) Anlegen nur für einen neuen Schlüssel
  if exists (
    select 1 from zahlungen z
     where z.id <> NEW.id
       and z.kategorie = 'Rücklastschrift'
       and z.mietvertrag_id = NEW.mietvertrag_id
       and z.buchungsdatum = NEW.buchungsdatum
  ) then
    return NEW;
  end if;

  select * into v_vertrag from mietvertrag where id = NEW.mietvertrag_id;
  if not found then
    return NEW;
  end if;
  v_ende := coalesce(v_vertrag.ende_datum, v_vertrag.kuendigungsdatum);
  if v_ende is not null and v_monat > date_trunc('month', v_ende)::date then
    return NEW;
  end if;
  -- Nur die Pauschale (Kundenentscheidung 29.10.2026): Die Bank bucht den Rückbetrag samt ihrer Gebühr ab (−503 € für
  -- 500 € Miete). Diese Bankgebühr trägt der Mieter schon über die Rücklastschrift; angelegt wird nur der Rest der
  -- Pauschale. Zurückgebucht ist die jüngste Mietzahlung desselben Vertrags in den 70 Tagen davor, höchstens 15 € unter
  -- dem Rückbetrag (live alle 29 Rücklastschriften so zugeordnet, Bankgebühr 1,80–4,21 €). Ohne Treffer die volle Pauschale.
  select round((-NEW.betrag) - z.betrag, 2) into v_bankgebuehr
    from zahlungen z
   where z.mietvertrag_id = NEW.mietvertrag_id
     and z.kategorie = 'Miete'
     and z.betrag > 0
     and z.buchungsdatum between NEW.buchungsdatum - 70 and NEW.buchungsdatum
     and z.betrag <= -NEW.betrag
     and (-NEW.betrag) - z.betrag <= 15
   order by (-NEW.betrag) - z.betrag, z.buchungsdatum desc
   limit 1;
  v_gebuehr := round(coalesce(v_vertrag.ruecklastschrift_gebuehr, 7.50) - coalesce(v_bankgebuehr, 0), 2);
  if v_gebuehr <= 0 then
    return NEW;
  end if;

  insert into mietforderungen (mietvertrag_id, sollmonat, sollbetrag, ist_faellig, faelligkeitsdatum, faellig_seit, ruecklastschrift_am)
  values (NEW.mietvertrag_id, v_monat, v_gebuehr, true, NEW.buchungsdatum, current_timestamp, NEW.buchungsdatum)
  on conflict (mietvertrag_id, ruecklastschrift_am) where ruecklastschrift_am is not null do nothing;

  return NEW;
end;
$function$;

-- Bestehende Gebühren: Pauschale minus die Bankgebühr der Rücklastschriften desselben Tages und Vertrags
with rl as (
  select r.mietvertrag_id, r.buchungsdatum,
         (select round((-r.betrag) - z.betrag, 2)
            from public.zahlungen z
           where z.mietvertrag_id = r.mietvertrag_id
             and z.kategorie = 'Miete'
             and z.betrag > 0
             and z.buchungsdatum between r.buchungsdatum - 70 and r.buchungsdatum
             and z.betrag <= -r.betrag
             and (-r.betrag) - z.betrag <= 15
           order by (-r.betrag) - z.betrag, z.buchungsdatum desc
           limit 1) as bankgebuehr
    from public.zahlungen r
   where r.kategorie = 'Rücklastschrift' and r.mietvertrag_id is not null and r.buchungsdatum is not null
), je_tag as (
  select mietvertrag_id, buchungsdatum, sum(coalesce(bankgebuehr, 0)) as bankgebuehr
    from rl group by mietvertrag_id, buchungsdatum
)
update public.mietforderungen f
   set sollbetrag = round(coalesce(mv.ruecklastschrift_gebuehr, 7.50) - j.bankgebuehr, 2)
  from je_tag j, public.mietvertrag mv
 where f.mietvertrag_id = j.mietvertrag_id
   and f.ruecklastschrift_am = j.buchungsdatum
   and mv.id = f.mietvertrag_id
   and j.bankgebuehr > 0
   and f.sollbetrag = coalesce(mv.ruecklastschrift_gebuehr, 7.50)
   and round(coalesce(mv.ruecklastschrift_gebuehr, 7.50) - j.bankgebuehr, 2) > 0;
