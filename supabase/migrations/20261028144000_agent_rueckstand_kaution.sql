-- 28.10.2026: Der Telegram-Assistent (agent-api) rechnet den Rückstand nach dem Kanon und leitet
-- den Kautionsstatus ab.
--
-- Befund Rückstand (live am 28.10.2026). Der Kanon ist calculateMietvertragRueckstand mit
-- nurFaelligeForderungen (src/utils/rueckstandsberechnung.ts), so rechnen Rückstandsliste und
-- Mahnung: je Vertrag alle Forderungen mit Sollmonat, deren Fälligkeit erreicht ist (auch BKA und
-- Gebühren), minus alle Zahlungen der Kategorien Miete, Rücklastschrift und
-- Betriebskostenabrechnung mit Buchungsdatum.
--   - rpc_agent_outstanding: Soll nach Sollmonat statt Fälligkeit (vom 1. bis 7. zählte die
--     nicht fällige Monatsmiete mit), Ist nur Kategorie Miete (Rücklastschriften und BKA-Zahlungen
--     fehlten), nur aktiv/gekündigt. Live: 7 Verträge mit anderem Ist, 21.461,91 € Abweichung,
--     4 anders eingestuft, 18 beendete Verträge mit Rückstand fehlten.
--   - rpc_agent_dunning_summary: „offene_forderungen“ war die Summe aller fälligen Forderungen
--     ohne Abzug der Zahlungen — fünfstellige Beträge, wo der Kanon 0 € ergab.
--   - rpc_agent_tenant_balance: Soll und Ist je Mieter über alle seine Verträge summiert und in
--     jeder Vertragszeile wiederholt (29 Mieter mit mehreren Verträgen).
--   - rpc_agent_portfolio_summary: dieselbe Regel wie outstanding für Anzahl und Gesamtrückstand.
-- Neu: vertrag_saldo() rechnet den Kanon einmal in SQL; die vier Funktionen behalten Namen,
-- Parameter und Spalten (die Tool-Beschreibungen in agent-api nennen sie), nur die Werte ändern
-- sich. Wie die Rückstandsliste zählen alle Verträge, auch beendete, ab 0,01 €.
--
-- Befund Kautionsstatus: kaution_status setzten zwei Trigger — nur beim Einfügen, nur bei Beginn
-- ab 2025, „gezahlt“ bei jeder Kautionsbuchung (auch Teilzahlung oder Rückzahlung), beim Löschen
-- „offen“ trotz von Hand gedecktem Ist; Umkategorisieren blieb unbeachtet. Live wichen 71 Verträge
-- (44 von 98 laufenden) von „Ist >= Soll“ ab. Die Oberfläche zeigt den Status nicht, nur der
-- Assistent (rpc_agent_tenant_deposit). Neu: Er wird dort aus kaution_ist und kaution_betrag
-- abgeleitet, das Zahlungsdatum aus der letzten Kautionsbuchung. Die beiden Trigger entfallen;
-- die Spalte bleibt als Altbestand stehen und wird nicht mehr ausgewertet.

-- Rückstand je Vertrag nach dem Kanon (Stichtag: heute in Berlin, wie die Rückstandsliste)
create or replace function public.vertrag_saldo(
  p_stichtag date default (now() at time zone 'Europe/Berlin')::date
)
 returns table (mietvertrag_id uuid, soll numeric, ist numeric, rueckstand numeric)
 language sql
 stable
 set search_path to ''
as $function$
  with soll as (
    select f.mietvertrag_id, sum(f.sollbetrag) as summe
      from public.mietforderungen f
     where f.sollmonat is not null
       and f.faelligkeitsdatum <= p_stichtag
     group by f.mietvertrag_id
  ),
  ist as (
    select z.mietvertrag_id, sum(z.betrag) as summe
      from public.zahlungen z
     where z.mietvertrag_id is not null
       and z.buchungsdatum is not null
       and z.kategorie::text in ('Miete', 'Rücklastschrift', 'Betriebskostenabrechnung')
     group by z.mietvertrag_id
  )
  select v.id,
         coalesce(s.summe, 0),
         coalesce(i.summe, 0),
         coalesce(s.summe, 0) - coalesce(i.summe, 0)
    from public.mietvertrag v
    left join soll s on s.mietvertrag_id = v.id
    left join ist i on i.mietvertrag_id = v.id;
$function$;

revoke execute on function public.vertrag_saldo(date) from public, anon, authenticated;

create or replace function public.rpc_agent_outstanding(p_search text default null)
 returns table(mietvertrag_id uuid, immobilie text, einheit text, mieter_namen text, kaltmiete numeric,
               soll_gesamt numeric, ist_gesamt numeric, rueckstand numeric, mahnstufe integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    v.id,
    i.name,
    e.etage,
    (select string_agg(m.vorname || ' ' || m.nachname, ', ')
       from mietvertrag_mieter vm
       join mieter m on m.id = vm.mieter_id
      where vm.mietvertrag_id = v.id),
    v.kaltmiete,
    s.soll,
    s.ist,
    s.rueckstand,
    v.mahnstufe
  from public.vertrag_saldo() s
  join mietvertrag v on v.id = s.mietvertrag_id
  left join einheiten e on e.id = v.einheit_id
  left join immobilien i on i.id = e.immobilie_id
  where s.rueckstand >= 0.01
    and (
      p_search is null
      or exists (
        select 1 from mietvertrag_mieter vm
        join mieter m on m.id = vm.mieter_id
        where vm.mietvertrag_id = v.id
          and (
            m.vorname ilike '%' || p_search || '%'
            or m.nachname ilike '%' || p_search || '%'
            or (m.vorname || ' ' || m.nachname) ilike '%' || p_search || '%'
          )
      )
    )
  order by s.rueckstand desc
  limit 50;
$function$;

create or replace function public.rpc_agent_dunning_summary()
 returns table(mietvertrag_id uuid, immobilie text, mieter_namen text, mahnstufe integer, kaltmiete numeric,
               offene_forderungen numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    v.id,
    i.name,
    (select string_agg(m.vorname || ' ' || m.nachname, ', ')
       from mietvertrag_mieter vm
       join mieter m on m.id = vm.mieter_id
      where vm.mietvertrag_id = v.id),
    v.mahnstufe,
    v.kaltmiete,
    s.rueckstand
  from mietvertrag v
  join public.vertrag_saldo() s on s.mietvertrag_id = v.id
  left join einheiten e on e.id = v.einheit_id
  left join immobilien i on i.id = e.immobilie_id
  where coalesce(v.mahnstufe, 0) > 0
  order by v.mahnstufe desc;
$function$;

create or replace function public.rpc_agent_tenant_balance(p_search text default null, p_mieter_id uuid default null)
 returns table(mieter_id uuid, mieter_name text, immobilie text, einheit text, kaltmiete numeric,
               warmmiete numeric, start_datum date, ende_datum date, kuendigungsdatum date,
               soll_gesamt numeric, ist_gesamt numeric, rueckstand numeric, monate_soll bigint,
               letzte_zahlung date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with zielmieter as (
    select m.id, m.vorname || ' ' || m.nachname as name
    from mieter m
    where (p_mieter_id is not null and m.id = p_mieter_id)
       or (p_search is not null and (
            m.vorname ilike '%' || p_search || '%'
         or m.nachname ilike '%' || p_search || '%'
         or (m.vorname || ' ' || m.nachname) ilike '%' || p_search || '%'
       ))
  ),
  vertraege as (
    select distinct v.id as vertrag_id, v.kaltmiete, v.betriebskosten,
      v.start_datum, v.ende_datum, v.kuendigungsdatum,
      vm.mieter_id, e.etage, i.name as immo_name
    from mietvertrag v
    join mietvertrag_mieter vm on vm.mietvertrag_id = v.id
    join einheiten e on e.id = v.einheit_id
    join immobilien i on i.id = e.immobilie_id
    where vm.mieter_id in (select id from zielmieter)
  )
  -- Je Vertragszeile die Werte DIESES Vertrags (bis 28.10.2026 die Summe aller Verträge des Mieters)
  select
    zm.id,
    zm.name,
    vt.immo_name,
    vt.etage,
    vt.kaltmiete,
    vt.kaltmiete + coalesce(vt.betriebskosten, 0) as warmmiete,
    vt.start_datum,
    vt.ende_datum,
    vt.kuendigungsdatum,
    s.soll,
    s.ist,
    s.rueckstand,
    -- fällige Monatsforderungen ohne Rücklastschrift-Gebühren (20261028140000)
    (select count(*) from mietforderungen f
      where f.mietvertrag_id = vt.vertrag_id
        and coalesce(f.typ, 'Miete') = 'Miete'
        and f.ruecklastschrift_am is null
        and f.sollmonat is not null
        and f.faelligkeitsdatum <= (now() at time zone 'Europe/Berlin')::date),
    (select max(z.buchungsdatum) from zahlungen z
      where z.mietvertrag_id = vt.vertrag_id
        and z.kategorie = 'Miete'
        and z.betrag > 0)
  from zielmieter zm
  join vertraege vt on vt.mieter_id = zm.id
  join public.vertrag_saldo() s on s.mietvertrag_id = vt.vertrag_id
  order by zm.name, vt.start_datum desc nulls last
  limit 10;
$function$;

create or replace function public.rpc_agent_portfolio_summary()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with vertraege_rueckstand as (
    select s.rueckstand from public.vertrag_saldo() s
  )
  select jsonb_build_object(
    'immobilien_count',        (select count(*) from immobilien),
    'einheiten_count',         (select count(*) from einheiten),
    'aktive_vertraege',        (select count(*) from mietvertrag where status = 'aktiv'),
    'gekuendigt',              (select count(*) from mietvertrag where status = 'gekuendigt'),
    'kaltmiete_monat',         (select coalesce(sum(kaltmiete), 0) from mietvertrag where status = 'aktiv'),
    'warmmiete_monat',         (select coalesce(sum(kaltmiete + coalesce(betriebskosten, 0)), 0) from mietvertrag where status = 'aktiv'),
    'vertraege_mit_rueckstand',(select count(*) from vertraege_rueckstand where rueckstand >= 0.01),
    'gesamtrueckstand',        (select coalesce(sum(greatest(rueckstand, 0)), 0) from vertraege_rueckstand),
    'mahnfaelle',              (select count(*) from mietvertrag where coalesce(mahnstufe, 0) > 0),
    'darlehen_restschuld',     (select coalesce(sum(restschuld), 0) from darlehen),
    'darlehen_rate',           (select coalesce(sum(monatliche_rate), 0) from darlehen),
    'leerstand_count',         (select count(*) from einheiten e
      join immobilien i on i.id = e.immobilie_id
      where not exists (
        select 1 from mietvertrag v2
        where v2.einheit_id = e.id and v2.status in ('aktiv', 'gekuendigt')
      ))
  );
$function$;

create or replace function public.rpc_agent_tenant_deposit(p_search text default null, p_mieter_id uuid default null)
 returns table(mieter_id uuid, mieter_name text, immobilie text, einheit text, kaution_betrag numeric,
               kaution_ist numeric, kaution_status text, kaution_gezahlt_am date, vertrag_status text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select distinct on (m.id)
    m.id,
    m.vorname || ' ' || m.nachname,
    i.name,
    e.etage,
    v.kaution_betrag,
    v.kaution_ist,
    -- Abgeleitet statt gespeichert (28.10.2026): die Spalte kaution_status wurde nie verlässlich nachgezogen
    case
      when coalesce(v.kaution_betrag, 0) > 0 and coalesce(v.kaution_ist, 0) >= v.kaution_betrag then 'gezahlt'
      when coalesce(v.kaution_betrag, 0) > 0 and coalesce(v.kaution_ist, 0) > 0 then 'teilweise'
      when coalesce(v.kaution_ist, 0) > 0 then 'gezahlt'
      when coalesce(v.kaution_betrag, 0) <= 0 then 'keine'
      else 'offen'
    end,
    (select max(z.buchungsdatum) from zahlungen z
      where z.mietvertrag_id = v.id
        and z.kategorie = 'Mietkaution'
        and z.betrag > 0),
    v.status::text
  from mieter m
  join mietvertrag_mieter mv on mv.mieter_id = m.id
  join mietvertrag v on v.id = mv.mietvertrag_id
    and v.status in ('aktiv', 'gekuendigt')
  join einheiten e on e.id = v.einheit_id
  join immobilien i on i.id = e.immobilie_id
  where (p_mieter_id is not null and m.id = p_mieter_id)
     or (p_search is not null and (
          m.vorname ilike '%' || p_search || '%'
       or m.nachname ilike '%' || p_search || '%'
       or (m.vorname || ' ' || m.nachname) ilike '%' || p_search || '%'
     ))
  order by m.id, (case when v.status = 'aktiv' then 0 else 1 end)
  limit 10;
$function$;

-- Nur service_role (agent-api) und postgres, wie bisher (20260824141500)
revoke execute on function public.rpc_agent_outstanding(text) from public, anon, authenticated;
revoke execute on function public.rpc_agent_dunning_summary() from public, anon, authenticated;
revoke execute on function public.rpc_agent_tenant_balance(text, uuid) from public, anon, authenticated;
revoke execute on function public.rpc_agent_portfolio_summary() from public, anon, authenticated;
revoke execute on function public.rpc_agent_tenant_deposit(text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_agent_outstanding(text) to service_role;
grant execute on function public.rpc_agent_dunning_summary() to service_role;
grant execute on function public.rpc_agent_tenant_balance(text, uuid) to service_role;
grant execute on function public.rpc_agent_portfolio_summary() to service_role;
grant execute on function public.rpc_agent_tenant_deposit(text, uuid) to service_role;

-- Kautionsstatus: die beiden Trigger entfallen (siehe Kopf)
drop trigger if exists update_deposit_status_trigger on public.zahlungen;
drop trigger if exists reset_deposit_status_trigger on public.zahlungen;
drop function if exists public.update_deposit_status_on_payment();
drop function if exists public.reset_deposit_status_on_payment_delete();

comment on column public.mietvertrag.kaution_status is
  'Altbestand, seit 28.10.2026 nicht mehr nachgezogen und nicht ausgewertet. Der Status wird aus kaution_ist und kaution_betrag abgeleitet (rpc_agent_tenant_deposit).';

notify pgrst, 'reload schema';
