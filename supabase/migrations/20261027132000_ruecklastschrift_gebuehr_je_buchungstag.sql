-- 27.10.2026, Nachtrag zu 20261027122000: Die Gebuehr einer Ruecklastschrift hing an Vertrag, Monat und
-- Buchungstag. Wer eine Ruecklastschrift auf zwei Monate aufteilte (Zahlung aufteilen), bekam fuer den
-- zweiten Teil eine zweite Gebuehr -- ein Bankruecklauf, zwei Gebuehren. Jetzt gilt: eine Gebuehr je
-- Vertrag und Buchungstag. Abgeraeumt wird sie erst, wenn keine Ruecklastschrift des Vertrags von
-- diesem Tag mehr uebrig ist; "Monat verschieben" raeumt sie im alten Monat ab und legt sie im neuen an.
--
-- Ausserdem scheiterte der Trigger an einem zugeordneten Monat, der nicht JJJJ-MM lautet (Cast auf
-- date) -- jede Aenderung oder Loeschung der Zahlung brach dann ab. Live waren alle Werte sauber; ein
-- unlesbarer Monat faellt jetzt auf den Buchungsmonat zurueck.

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

  -- 1) Gebuehr der bisherigen Fassung abraeumen, sofern keine andere Ruecklastschrift des Vertrags
  --    vom selben Tag sie traegt (Aufteilen legt erst die Teile an und loescht dann das Original).
  if TG_OP <> 'INSERT' then
    if OLD.kategorie = 'Rücklastschrift' and OLD.mietvertrag_id is not null then
      if not exists (
        select 1 from zahlungen z
        where z.id <> OLD.id
          and z.kategorie = 'Rücklastschrift'
          and z.mietvertrag_id = OLD.mietvertrag_id
          and z.buchungsdatum = OLD.buchungsdatum
      ) then
        delete from mietforderungen
        where id = (
          select f.id
          from mietforderungen f
          join mietvertrag mv on mv.id = f.mietvertrag_id
          where f.mietvertrag_id = OLD.mietvertrag_id
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

  -- 2) Gebuehr fuer die neue Fassung anlegen -- eine je Vertrag und Buchungstag
  if NEW.kategorie = 'Rücklastschrift' and NEW.mietvertrag_id is not null then
    select * into v_vertrag from mietvertrag where id = NEW.mietvertrag_id and lastschrift = true;
    if found then
      -- zugeordneter_monat ist 'YYYY-MM' (TEXT) -> DATE 'YYYY-MM-01'; Unlesbares -> Buchungsmonat
      v_monat := coalesce(
        case when NEW.zugeordneter_monat ~ '^\d{4}-(0[1-9]|1[0-2])$' then (NEW.zugeordneter_monat || '-01')::date end,
        date_trunc('month', NEW.buchungsdatum)::date
      );
      v_ende := coalesce(v_vertrag.ende_datum, v_vertrag.kuendigungsdatum);
      if v_ende is null or v_monat <= date_trunc('month', v_ende)::date then
        v_gebuehr := coalesce(v_vertrag.ruecklastschrift_gebuehr, 7.50);
        if not exists (
          select 1 from mietforderungen
          where mietvertrag_id = NEW.mietvertrag_id
            and sollbetrag = v_gebuehr
            and faelligkeitsdatum = NEW.buchungsdatum
            and coalesce(typ, 'Miete') = 'Miete'
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

revoke execute on function public.create_ruecklastschrift_forderung() from public, anon, authenticated;
