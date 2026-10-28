-- 28.10.2026: Die Rücklastschrift-Gebühr bekommt ein Kennzeichen und folgt ihrer Buchung.
--
-- Befund (Fassung 20261027132000, live am 28.10.2026):
--   - Abgeräumt wurde die Gebühr über die HEUTIGE Gebühr des Vertrags (sollbetrag =
--     mietvertrag.ruecklastschrift_gebuehr), angelegt nur bei HEUTE gesetztem lastschrift-Flag.
--     Jede wesentliche Änderung lief als „löschen, dann neu anlegen“.
--     A) Lastschrift nach der Rücklastschrift abgeschaltet, Buchung später in einen anderen Monat
--        verschoben: Gebühr gelöscht, nicht neu angelegt.
--     B) Gebühr am Vertrag geändert (7,50 -> 10), alte Rücklastschrift verschoben: Die alte Gebühr
--        wurde nicht gefunden, eine zweite kam dazu.
--   - Das Muster „Fälligkeit = Buchungstag“ allein ist nicht eindeutig: Live ist eine
--     Rücklastschrift am 08. gebucht, und die Monatsmiete September desselben Vertrags ist am
--     08.09. fällig. Ohne Betragsbedingung hätte der Trigger die Monatsmiete erwischt.
--
-- Neu:
--   - mietforderungen.ruecklastschrift_am: Buchungstag der Rücklastschrift, deren Gebühr die
--     Forderung ist; NULL bei allen anderen Forderungen. Eindeutig je Vertrag und Tag (Index).
--     Der Bestand wird über das bisherige Muster gekennzeichnet (Betrag = Gebühr des Vertrags,
--     Fälligkeit = Buchungstag einer Rücklastschrift des Vertrags; live 19 Zeilen, keine doppelt).
--   - Nur der Monat ändert sich (Vertrag und Buchungstag gleich): Die Gebühr wird umgehängt,
--     nie neu angelegt — Betrag und Flag von heute spielen keine Rolle.
--   - Verwaist der Schlüssel (Vertrag, Buchungstag) — gelöscht, umkategorisiert, anderer Vertrag
--     oder Tag — und trägt ihn keine andere Rücklastschrift mehr, entfällt die Gebühr; wird nur der
--     Buchungstag am selben Vertrag berichtigt, wandert sie mit.
--   - Angelegt wird nur für einen neuen Schlüssel: keine andere Rücklastschrift des Vertrags vom
--     selben Tag (Aufteilen und Aufheben legen erst an und löschen dann), Einzugsmonat nicht nach
--     dem Vertragsende (20261027122000) und Gebühr > 0 (0 € ist bewusst „keine Gebühr“,
--     utils/vertragMiete.ts; ohne Eintrag 7,50 €). Das lastschrift-Flag zählt nicht mehr: Eine
--     Rücklastschrift setzt eine Lastschrift voraus, und das Flag wird oft gerade nach einer
--     Rücklastschrift abgeschaltet (Entscheidung 28.10.2026). Eine von Hand gelöschte Gebühr
--     bleibt gelöscht, weil Verschieben und Aufteilen nie neu anlegen.
--   Bestehende Gebühren werden nicht neu berechnet, fehlende nicht nachgelegt.

alter table public.mietforderungen add column if not exists ruecklastschrift_am date;

comment on column public.mietforderungen.ruecklastschrift_am is
  'Buchungstag der Rücklastschrift, deren Gebühr diese Forderung ist; NULL bei allen anderen Forderungen (seit 28.10.2026, Trigger create_ruecklastschrift_forderung).';

update public.mietforderungen f
   set ruecklastschrift_am = f.faelligkeitsdatum
  from public.mietvertrag mv
 where mv.id = f.mietvertrag_id
   and f.ruecklastschrift_am is null
   and coalesce(f.typ, 'Miete') = 'Miete'
   and f.sollbetrag = coalesce(mv.ruecklastschrift_gebuehr, 7.50)
   and exists (
     select 1 from public.zahlungen z
      where z.kategorie = 'Rücklastschrift'
        and z.mietvertrag_id = f.mietvertrag_id
        and z.buchungsdatum = f.faelligkeitsdatum
   );

create unique index if not exists mietforderungen_gebuehr_je_buchungstag
  on public.mietforderungen (mietvertrag_id, ruecklastschrift_am)
  where ruecklastschrift_am is not null;

create or replace function public.create_ruecklastschrift_forderung()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alt_rl  boolean := false;
  v_neu_rl  boolean := false;
  v_monat   date;
  v_vertrag record;
  v_ende    date;
  v_gebuehr numeric;
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
  v_gebuehr := coalesce(v_vertrag.ruecklastschrift_gebuehr, 7.50);
  if v_gebuehr <= 0 then
    return NEW;
  end if;

  insert into mietforderungen (mietvertrag_id, sollmonat, sollbetrag, ist_faellig, faelligkeitsdatum, faellig_seit, ruecklastschrift_am)
  values (NEW.mietvertrag_id, v_monat, v_gebuehr, true, NEW.buchungsdatum, current_timestamp, NEW.buchungsdatum)
  on conflict (mietvertrag_id, ruecklastschrift_am) where ruecklastschrift_am is not null do nothing;

  return NEW;
end;
$function$;

-- Wie seit 20261022020000: Trigger-Funktionen ruft niemand direkt auf
revoke execute on function public.create_ruecklastschrift_forderung() from public, anon, authenticated;

notify pgrst, 'reload schema';
