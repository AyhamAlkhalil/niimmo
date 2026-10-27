-- 27.10.2026: create_ruecklastschrift_forderung lief bei jedem INSERT und UPDATE einer Zahlung und
-- legte die Gebuehr an, sobald fuer (Vertrag, Monat, Betrag, Buchungstag) noch keine bestand.
--   - "Monat verschieben" (MietvertragTimelineView) erzeugte eine zweite Gebuehr fuer den neuen
--     Monat, die alte blieb stehen.
--   - Umkategorisieren, Loesen oder Loeschen der Ruecklastschrift raeumte die Gebuehr nie ab.
--   - Auch fuer Einzuege nach Vertragsende entstand eine Gebuehr (live 6 Gebuehren, 45 EUR, gegen
--     Ex-Mieter): Ein Einzug fuer einen Monat nach dem Vertragsende war selbst nicht geschuldet,
--     dann ist es die Gebuehr fuer seine Ruecklastschrift auch nicht.
--
-- Neu: Aendert sich an einer Ruecklastschrift etwas Wesentliches (Kategorie, Vertrag, Monat,
-- Buchungstag) oder wird sie geloescht, wird die bisherige Gebuehr entfernt und -- falls die Zahlung
-- noch eine Ruecklastschrift ist -- die passende neu angelegt. Entfernt wird nur, wenn keine andere
-- Ruecklastschrift dieselbe Gebuehr traegt: Das Aufteilen einer Zahlung legt erst die Teile an und
-- loescht dann das Original. Die Gebuehr laesst sich mangels Verweis nur ueber Vertrag, Monat,
-- Faelligkeit (= Buchungstag) und Betrag erkennen; wurde die Gebuehr am Vertrag inzwischen
-- geaendert, bleibt eine alte Gebuehr stehen wie bisher. Bestehende Gebuehren bleiben unberuehrt.

create or replace function public.create_ruecklastschrift_forderung()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_vertrag record;
  v_monat date;
  v_gebuehr numeric;
  v_ende date;
  v_wesentlich boolean := true;
begin
  if TG_OP = 'UPDATE' then
    v_wesentlich := NEW.kategorie is distinct from OLD.kategorie
      or NEW.mietvertrag_id is distinct from OLD.mietvertrag_id
      or NEW.zugeordneter_monat is distinct from OLD.zugeordneter_monat
      or NEW.buchungsdatum is distinct from OLD.buchungsdatum;
    if not v_wesentlich then
      return NEW;
    end if;
  end if;

  -- 1) Gebuehr der bisherigen Fassung abraeumen
  if TG_OP <> 'INSERT' then
    if OLD.kategorie = 'Rücklastschrift' and OLD.mietvertrag_id is not null then
      v_monat := coalesce((OLD.zugeordneter_monat || '-01')::date, date_trunc('month', OLD.buchungsdatum)::date);
      if not exists (
        select 1 from zahlungen z
        where z.id <> OLD.id
          and z.kategorie = 'Rücklastschrift'
          and z.mietvertrag_id = OLD.mietvertrag_id
          and z.buchungsdatum = OLD.buchungsdatum
          and coalesce((z.zugeordneter_monat || '-01')::date, date_trunc('month', z.buchungsdatum)::date) = v_monat
      ) then
        delete from mietforderungen
        where id = (
          select f.id
          from mietforderungen f
          join mietvertrag mv on mv.id = f.mietvertrag_id
          where f.mietvertrag_id = OLD.mietvertrag_id
            and f.sollmonat = v_monat
            and f.faelligkeitsdatum = OLD.buchungsdatum
            and f.sollbetrag = coalesce(mv.ruecklastschrift_gebuehr, 7.50)
            and coalesce(f.typ, 'Miete') = 'Miete'
          order by f.erzeugt_am, f.id
          limit 1
        );
      end if;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  -- 2) Gebuehr fuer die neue Fassung anlegen
  if NEW.kategorie = 'Rücklastschrift' and NEW.mietvertrag_id is not null then
    select * into v_vertrag from mietvertrag where id = NEW.mietvertrag_id and lastschrift = true;
    if found then
      -- zugeordneter_monat ist 'YYYY-MM' (TEXT) -> DATE 'YYYY-MM-01'
      v_monat := coalesce((NEW.zugeordneter_monat || '-01')::date, date_trunc('month', NEW.buchungsdatum)::date);
      v_ende := coalesce(v_vertrag.ende_datum, v_vertrag.kuendigungsdatum);
      if v_ende is null or v_monat <= date_trunc('month', v_ende)::date then
        v_gebuehr := coalesce(v_vertrag.ruecklastschrift_gebuehr, 7.50);
        if not exists (
          select 1 from mietforderungen
          where mietvertrag_id = NEW.mietvertrag_id
            and sollmonat = v_monat
            and sollbetrag = v_gebuehr
            and faelligkeitsdatum = NEW.buchungsdatum
        ) then
          insert into mietforderungen (mietvertrag_id, sollmonat, sollbetrag, ist_faellig, faelligkeitsdatum, faellig_seit)
          values (NEW.mietvertrag_id, v_monat, v_gebuehr, true, NEW.buchungsdatum, current_timestamp);
        end if;
      end if;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists create_ruecklastschrift_forderung_trigger on public.zahlungen;
create trigger create_ruecklastschrift_forderung_trigger
  after insert or update or delete on public.zahlungen
  for each row execute function public.create_ruecklastschrift_forderung();

revoke execute on function public.create_ruecklastschrift_forderung() from public, anon, authenticated;
