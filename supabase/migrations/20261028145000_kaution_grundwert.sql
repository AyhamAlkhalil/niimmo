-- 28.10.2026: Das Kautions-Ist setzt sich aus einem Anteil von Hand und den Kautionsbuchungen zusammen.
--
-- Befund: update_kaution_ist (20261027121000) addierte jede Kautionsbuchung auf den gerade
-- gespeicherten Wert. Der Wert mischte zwei Quellen, ohne sie zu kennen: Wer das richtig
-- erhaltene Ist von Hand eintrug, bevor der CSV-Abgleich dieselbe Überweisung brachte, bekam es
-- doppelt — beide Angaben stimmten, das Ergebnis nicht. Live am 28.10.2026 kein Fall, die
-- Reihenfolge genügt aber. Außerdem rechnete der Trigger mit Differenzen; ein verpasster Schritt
-- blieb für immer im Wert.
--
-- Neu:
--   - mietvertrag.kaution_ist_grundwert: was außerhalb des Kontos einging (bar, Altbestand vor dem
--     Import) — der einzige von Hand gepflegte Teil.
--   - kaution_ist wird immer berechnet: Grundwert + Summe der Buchungen der Kategorie
--     Mietkaution (Rückzahlungen negativ). NULL nur, wenn weder Grundwert noch Buchungen da sind
--     (nicht erfasst, wie bisher eine leere Kaution).
--   - Backfill: Grundwert = bisheriges Ist minus Summe der Buchungen. Kein Ist ändert sich; die
--     Migration bricht ab, falls doch.
--   - Ein direkt geschriebenes kaution_ist wird bei UPDATE ignoriert und neu berechnet. Am
--     28.10.2026 geprüft: Kein Codepfad (src/, supabase/functions/, SQL-Funktionen live) schreibt
--     kaution_ist mehr; die Vertragsbearbeitung schreibt seither kaution_ist_grundwert. Den
--     Grundwert aus einem geschriebenen Ist abzuleiten, hätte ihn bei jedem veralteten Objekt
--     (geladen vor einer neuen Buchung, dann zurückgeschrieben) still verschoben. Ein Browserfenster
--     von vor der Umstellung, das noch das Ist setzt, ändert damit nichts — falsche Zahlen
--     entstehen nicht. Bei INSERT gilt das mitgegebene Ist als Grundwert: Ein neuer Vertrag hat
--     noch keine Buchungen (aktiviere_mietvertrag_entwurf und NewTenantContractDialog lassen es
--     beim Vorgabewert 0).
--   - Kautionsbuchungen (Einfügen, Ändern, Umhängen, Löschen) lösen eine Neuberechnung aus,
--     absolut statt mit Differenzen.

alter table public.mietvertrag add column if not exists kaution_ist_grundwert numeric;

comment on column public.mietvertrag.kaution_ist_grundwert is
  'Teil des Kautions-Ist, der außerhalb des Kontos einging (bar, Altbestand vor dem Import); von Hand gepflegt. kaution_ist = kaution_ist_grundwert + Summe der Buchungen Mietkaution (seit 28.10.2026).';

-- Ist aus Grundwert und Buchungen; NULL, wenn beides fehlt
create or replace function public.kaution_ist_berechnen(p_mietvertrag_id uuid, p_grundwert numeric)
 returns numeric
 language sql
 stable
 set search_path to ''
as $function$
  select case when p_grundwert is null and b.anzahl = 0 then null
              else coalesce(p_grundwert, 0) + coalesce(b.summe, 0) end
    from (select count(*) as anzahl, sum(z.betrag) as summe
            from public.zahlungen z
           where z.mietvertrag_id = p_mietvertrag_id
             and z.kategorie = 'Mietkaution') b;
$function$;

revoke execute on function public.kaution_ist_berechnen(uuid, numeric) from public, anon, authenticated;

-- Backfill, bevor der Trigger existiert: Summen unverändert
update public.mietvertrag v
   set kaution_ist_grundwert = v.kaution_ist - coalesce((
         select sum(z.betrag) from public.zahlungen z
          where z.mietvertrag_id = v.id and z.kategorie = 'Mietkaution'), 0)
 where v.kaution_ist is not null
   and v.kaution_ist_grundwert is null;

do $pruefung$
declare
  v_abweichend int;
begin
  select count(*) into v_abweichend
    from public.mietvertrag v
   where public.kaution_ist_berechnen(v.id, v.kaution_ist_grundwert) is distinct from v.kaution_ist;
  if v_abweichend > 0 then
    raise exception 'Kautions-Ist würde sich bei % Verträgen ändern — Migration abgebrochen', v_abweichend;
  end if;
end;
$pruefung$;

create or replace function public.kaution_ist_ableiten()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' and new.kaution_ist_grundwert is null then
    -- Ein neuer Vertrag hat noch keine Buchungen: das mitgegebene Ist ist der Anteil von Hand
    new.kaution_ist_grundwert := new.kaution_ist;
  end if;
  -- Bei UPDATE zählt ein direkt geschriebenes Ist nicht (siehe Kopf): immer neu berechnen
  new.kaution_ist := public.kaution_ist_berechnen(new.id, new.kaution_ist_grundwert);
  return new;
end;
$function$;

revoke execute on function public.kaution_ist_ableiten() from public, anon, authenticated;

drop trigger if exists kaution_ist_ableiten on public.mietvertrag;
create trigger kaution_ist_ableiten
  before insert or update of kaution_ist, kaution_ist_grundwert on public.mietvertrag
  for each row execute function public.kaution_ist_ableiten();

-- Kautionsbuchungen: betroffene Verträge neu berechnen lassen (kaution_ist_ableiten). Die Spalte
-- kaution_ist_grundwert steht im SET, damit der Trigger feuert; ihr Wert bleibt gleich.
create or replace function public.update_kaution_ist()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alt_vertrag uuid;
  v_neu_vertrag uuid;
begin
  -- Verschachtelt statt mit AND: NEW gibt es bei DELETE nicht, OLD nicht bei INSERT
  if TG_OP <> 'INSERT' then
    if OLD.kategorie = 'Mietkaution' and OLD.mietvertrag_id is not null then
      v_alt_vertrag := OLD.mietvertrag_id;
    end if;
  end if;
  if TG_OP <> 'DELETE' then
    if NEW.kategorie = 'Mietkaution' and NEW.mietvertrag_id is not null then
      v_neu_vertrag := NEW.mietvertrag_id;
    end if;
  end if;

  if v_alt_vertrag is not null then
    update mietvertrag set kaution_ist_grundwert = kaution_ist_grundwert where id = v_alt_vertrag;
  end if;
  if v_neu_vertrag is not null and v_neu_vertrag is distinct from v_alt_vertrag then
    update mietvertrag set kaution_ist_grundwert = kaution_ist_grundwert where id = v_neu_vertrag;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$function$;

revoke execute on function public.update_kaution_ist() from public, anon, authenticated;

-- AFTER-Trigger, damit die neue bzw. gelöschte Buchung in der Summe schon enthalten ist; Definition
-- wie seit 20261027121000, hier noch einmal angelegt, damit diese Migration nicht davon abhängt
drop trigger if exists trigger_update_kaution_ist on public.zahlungen;
create trigger trigger_update_kaution_ist
  after insert or update of mietvertrag_id, kategorie, betrag or delete on public.zahlungen
  for each row execute function public.update_kaution_ist();

notify pgrst, 'reload schema';
