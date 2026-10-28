-- 28.10.2026: Eine Mieterhöhung gilt erst ab wirksam_ab (§ 558b Abs. 1 BGB)
--
-- Bis heute setzte der Erhöhungsdialog bei erfasster Zustimmung die Vertragsmiete sofort
-- (RentIncreaseModal.tsx, mieteNachZustimmungSetzen), obwohl die erhöhte Miete erst ab Beginn des
-- dritten Kalendermonats nach Zugang geschuldet ist. Der Trigger update_forderungen_on_rent_change
-- hob damit sofort die Forderung des laufenden Monats, und die Sollstellung legte bis zum
-- Wirksamwerden jeden Monat mit der neuen Miete an: Rückstand, Mahnung und Verzugszinsen rechneten
-- zwei bis drei Monate lang gegen Mieter, die richtig zahlten. Der Dialog warnte nur davor.
--
-- Neu:
-- 1. Eine Zustimmung macht den Vorgang 'zugestimmt'; die Vertragsmiete bleibt.
-- 2. mieterhoehungen_anwenden() läuft in generate_monthly_mietforderungen nach
--    staffelmieten_anwenden und vor der Sollstellung. Es übernimmt zugestimmte Vorgänge mit
--    wirksam_ab <= heute: Kaltmiete (Betriebskosten nur, wenn das Verlangen sie ändert),
--    letzte_mieterhoehung_am = wirksam_ab, Status 'wirksam'.
-- 3. Wird die Zustimmung erst nach wirksam_ab erfasst, übernimmt mieterhoehung_zustimmen sofort und
--    hebt auch die zurückliegenden Monatsforderungen ab wirksam_ab, die noch unverändert die alte
--    Miete tragen. Den laufenden Monat und spätere zieht der Trigger nach.
-- 4. Hat sich die Vertragsmiete seit dem Verlangen geändert, wird nicht automatisch übernommen
--    (Hinweis MIETE_GEAENDERT); die Oberfläche zeigt „überfällig, nicht übernommen“ und bietet
--    „Trotzdem übernehmen“ (mieterhoehung_anwenden mit p_trotz_abweichung).
-- 5. Der Status 'wirksam' entsteht nur hier (Wächter-Trigger mit transaktionslokaler Einstellung):
--    wirksam heißt jetzt in der Datenbank selbst „Miete am Vertrag übernommen“.
-- 6. Eine irrtümlich erfasste Zustimmung nimmt mieterhoehung_zustimmung_zuruecknehmen zurück (vor der
--    Übernahme, zurück auf 'verlangt'); 'zugestimmt' verlässt ein Vorgang nur über diese Funktion oder
--    die Übernahme.
-- 7. Schon beim Zustimmen — auch beim Anlegen mit Haken — wird geprüft, was die Übernahme später
--    verhindern würde: Staffel-/Indexmiete, Vertragsende vor wirksam_ab, schon vereinbarte Erhöhung.
--
-- Voraussetzungen: 20261028130000 (monatsanteil, Trigger ab dem laufenden Monat) und
-- 20261028140000 (mietforderungen.ruecklastschrift_am kennzeichnet Gebühren).
-- Die Tabelle mieterhoehungen war beim Schreiben leer (28.10.2026 geprüft), die neuen Regeln
-- treffen keinen Bestand.

-- ── 0. Datenregeln ───────────────────────────────────────────────────────────────────────────
-- § 558b Abs. 1 BGB: Beginn eines Kalendermonats. Ein Monat muss so nie zwischen alter und neuer
-- Miete geteilt werden.
alter table public.mieterhoehungen
  add constraint mieterhoehungen_wirksam_monatserster
    check (wirksam_ab = date_trunc('month', wirksam_ab)::date),
  add constraint mieterhoehungen_zustimmung_datiert
    check (status not in ('zugestimmt', 'wirksam') or zugestimmt_am is not null);

-- Höchstens eine vereinbarte, noch nicht übernommene Erhöhung je Vertrag
create unique index if not exists mieterhoehungen_eine_vereinbarte_je_vertrag
  on public.mieterhoehungen (mietvertrag_id)
  where status = 'zugestimmt';

-- ── 1. Prüfung beim Zustimmen ───────────────────────────────────────────────────────────────
-- Was die Übernahme später verhindern würde, soll schon die Zustimmung ablehnen (Review 28.10.2026):
-- sonst hinge ein Vorgang auf 'zugestimmt', den der Nachtlauf nie übernehmen kann. Dieselben Hinweise
-- wie in mieterhoehung_anwenden_intern. Aufgerufen aus mieterhoehung_zustimmen und dem Wächter.
create or replace function public.mieterhoehung_zustimmung_pruefen(p_mietvertrag_id uuid, p_wirksam_ab date, p_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_mv record;
begin
  select mietanpassung_art, coalesce(ende_datum, kuendigungsdatum) as vertragsende
    into v_mv
    from public.mietvertrag
   where id = p_mietvertrag_id;
  if not found then
    raise exception 'Mietvertrag nicht gefunden' using hint = 'NICHT_GEFUNDEN';
  end if;
  -- §§ 557a Abs. 2, 557b Abs. 2 BGB
  if v_mv.mietanpassung_art::text in ('staffel', 'index') then
    raise exception 'Der Vertrag hat eine Staffel- oder Indexmiete' using hint = 'STAFFEL_ODER_INDEX';
  end if;
  -- Vertragsende wie getVertragsende() im Frontend
  if v_mv.vertragsende is not null and v_mv.vertragsende < p_wirksam_ab then
    raise exception 'Der Vertrag endet vor dem Wirksamwerden' using hint = 'VERTRAG_ENDET_VORHER';
  end if;
  -- Statt des rohen Unique-Verstoßes (mieterhoehungen_eine_vereinbarte_je_vertrag) eine klare Meldung
  if exists (
    select 1 from public.mieterhoehungen
     where mietvertrag_id = p_mietvertrag_id
       and status = 'zugestimmt'
       and id is distinct from p_id
  ) then
    raise exception 'Fuer diesen Vertrag ist schon eine Erhoehung vereinbart' using hint = 'SCHON_VEREINBART';
  end if;
end;
$function$;

revoke execute on function public.mieterhoehung_zustimmung_pruefen(uuid, date, uuid) from public, anon, authenticated, service_role;

-- ── 2. Wächter ───────────────────────────────────────────────────────────────────────────────
-- 'wirksam' setzt nur mieterhoehung_anwenden_intern, 'zugestimmt' → 'verlangt' nur
-- mieterhoehung_zustimmung_zuruecknehmen — beide über eine transaktionslokale Einstellung, die
-- PostgREST-Aufrufer nicht setzen können. SECURITY DEFINER, damit die Prüfung beim Zustimmen
-- (für authenticated gesperrt) auch beim Anlegen mit Haken aus dem Browser läuft.
create or replace function public.mieterhoehung_status_waechter()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.status = 'wirksam'
     and (tg_op = 'INSERT' or old.status is distinct from 'wirksam')
     and coalesce(current_setting('niimmo.mieterhoehung_anwenden', true), '') <> 'an' then
    raise exception 'Eine Mieterhoehung wird nur durch mieterhoehung_anwenden wirksam'
      using hint = 'NUR_UEBER_ANWENDEN';
  end if;
  if tg_op = 'UPDATE' and old.status = 'wirksam' and new.status <> 'wirksam' then
    raise exception 'Eine wirksame Mieterhoehung laesst sich nicht zuruecksetzen'
      using hint = 'WIRKSAM_ENDGUELTIG';
  end if;
  -- Eine Zustimmung endet nur durch Übernahme ('wirksam', oben) oder Zurücknehmen ('verlangt')
  if tg_op = 'UPDATE' and old.status = 'zugestimmt' and new.status not in ('zugestimmt', 'wirksam')
     and not (new.status = 'verlangt'
              and coalesce(current_setting('niimmo.mieterhoehung_zuruecknehmen', true), '') = 'an') then
    raise exception 'Eine Zustimmung wird nur ueber mieterhoehung_zustimmung_zuruecknehmen zurueckgenommen'
      using hint = 'NUR_UEBER_ZURUECKNEHMEN';
  end if;
  -- Was vereinbart ist, ändert sich nicht mehr still (die Übernahme rechnet damit)
  if tg_op = 'UPDATE' and old.status in ('zugestimmt', 'wirksam')
     and (new.mietvertrag_id, new.wirksam_ab, new.alte_kaltmiete, new.neue_kaltmiete,
          new.alte_betriebskosten, new.neue_betriebskosten)
         is distinct from
         (old.mietvertrag_id, old.wirksam_ab, old.alte_kaltmiete, old.neue_kaltmiete,
          old.alte_betriebskosten, old.neue_betriebskosten) then
    raise exception 'Betraege und Wirksamkeit einer vereinbarten Mieterhoehung sind fest'
      using hint = 'VEREINBART_FEST';
  end if;
  -- Neu zugestimmt (Anlegen mit Haken oder Zustimmung zum Verlangen): erst prüfen
  if new.status = 'zugestimmt' and (tg_op = 'INSERT' or old.status is distinct from 'zugestimmt') then
    perform public.mieterhoehung_zustimmung_pruefen(new.mietvertrag_id, new.wirksam_ab, new.id);
  end if;
  return new;
end;
$function$;

revoke execute on function public.mieterhoehung_status_waechter() from public, anon, authenticated;

drop trigger if exists mieterhoehungen_status_waechter on public.mieterhoehungen;
create trigger mieterhoehungen_status_waechter
  before insert or update on public.mieterhoehungen
  for each row execute function public.mieterhoehung_status_waechter();

-- ── 3. Kern: eine vereinbarte Erhöhung übernehmen ───────────────────────────────────────────
-- Nur aus den Funktionen unten (SECURITY INVOKER, dort läuft er als Eigentümer). Gibt die Zahl
-- der nachberechneten zurückliegenden Monate zurück.
create or replace function public.mieterhoehung_anwenden_intern(p_id uuid, p_trotz_abweichung boolean default false)
 returns integer
 language plpgsql
 set search_path to ''
as $function$
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
  -- current_date wie in update_forderungen_on_rent_change: Mit einem anderen „heute“ (etwa
  -- deutscher Zeit) zöge der Trigger kurz nach Mitternacht am Monatsersten den Vormonat nach
  if v_mh.wirksam_ab > current_date then
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
         and f.sollmonat < date_trunc('month', current_date)::date
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

revoke execute on function public.mieterhoehung_anwenden_intern(uuid, boolean) from public, anon, authenticated, service_role;

-- ── 4. Nachtlauf ──────────────────────────────────────────────────────────────────────────────
-- Ein Fehler überspringt nur seinen Vorgang; er bleibt 'zugestimmt' und erscheint in der
-- Oberfläche als überfällig.
create or replace function public.mieterhoehungen_anwenden()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id   uuid;
  v_n    int := 0;
  v_hint text;
begin
  for v_id in
    select id
      from public.mieterhoehungen
     where status = 'zugestimmt'
       and wirksam_ab <= current_date
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

-- Auch service_role: Der Cron ruft als postgres über generate_monthly_mietforderungen (Eigentümer)
revoke execute on function public.mieterhoehungen_anwenden() from public, anon, authenticated, service_role;

-- ── 5. Aufrufe aus der Oberfläche ────────────────────────────────────────────────────────────
-- SECURITY DEFINER, weil der Kern für authenticated gesperrt ist; die Admin-Prüfung steht vorn.

-- Zustimmung zu einem offenen Verlangen. Liegt wirksam_ab schon zurück, wird sofort übernommen;
-- scheitert das, rollt auch die Zustimmung zurück (das Verlangen bleibt offen).
create or replace function public.mieterhoehung_zustimmen(p_mieterhoehung_id uuid, p_trotz_abweichung boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  if v_mh.wirksam_ab <= current_date then
    v_n := public.mieterhoehung_anwenden_intern(v_mh.id, p_trotz_abweichung);
  end if;

  return jsonb_build_object(
    'status', case when v_n is null then 'zugestimmt' else 'wirksam' end,
    'wirksam_ab', v_mh.wirksam_ab,
    'nachberechnete_monate', coalesce(v_n, 0)
  );
end;
$function$;

revoke execute on function public.mieterhoehung_zustimmen(uuid, boolean) from public, anon;
grant execute on function public.mieterhoehung_zustimmen(uuid, boolean) to authenticated;

-- Eine zugestimmte, fällige Erhöhung von Hand übernehmen — der Nachtlauf hat sie übersprungen
-- (meist MIETE_GEAENDERT); mit p_trotz_abweichung gilt die neue Miete des Verlangens.
create or replace function public.mieterhoehung_anwenden(p_mieterhoehung_id uuid, p_trotz_abweichung boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_n int;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins duerfen Mieterhoehungen uebernehmen' using hint = 'NUR_ADMIN';
  end if;
  v_n := public.mieterhoehung_anwenden_intern(p_mieterhoehung_id, p_trotz_abweichung);
  return jsonb_build_object('status', 'wirksam', 'nachberechnete_monate', v_n);
end;
$function$;

revoke execute on function public.mieterhoehung_anwenden(uuid, boolean) from public, anon;
grant execute on function public.mieterhoehung_anwenden(uuid, boolean) to authenticated;

-- Eine irrtümlich erfasste Zustimmung zurücknehmen (Review 28.10.2026): nur solange sie nicht
-- übernommen ist. Der Vorgang wird wieder ein offenes Verlangen; das Schreiben bleibt.
create or replace function public.mieterhoehung_zustimmung_zuruecknehmen(p_mieterhoehung_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_mh public.mieterhoehungen%rowtype;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins duerfen Zustimmungen zuruecknehmen' using hint = 'NUR_ADMIN';
  end if;
  select * into v_mh from public.mieterhoehungen where id = p_mieterhoehung_id for update;
  if not found then
    raise exception 'Mieterhoehung nicht gefunden' using hint = 'NICHT_GEFUNDEN';
  end if;
  if v_mh.status <> 'zugestimmt' then
    raise exception 'Mieterhoehung steht auf %, nicht auf zugestimmt', v_mh.status using hint = 'NICHT_ZUGESTIMMT';
  end if;

  perform set_config('niimmo.mieterhoehung_zuruecknehmen', 'an', true);
  update public.mieterhoehungen
     set status = 'verlangt',
         zugestimmt_am = null
   where id = v_mh.id;
  perform set_config('niimmo.mieterhoehung_zuruecknehmen', '', true);

  return jsonb_build_object('status', 'verlangt', 'wirksam_ab', v_mh.wirksam_ab);
end;
$function$;

revoke execute on function public.mieterhoehung_zustimmung_zuruecknehmen(uuid) from public, anon;
grant execute on function public.mieterhoehung_zustimmung_zuruecknehmen(uuid) to authenticated;

-- ── 6. Einbindung in die Sollstellung ────────────────────────────────────────────────────────
-- Die Fassung unten ist die live-Fassung vom 28.10.2026 (pg_get_functiondef) mit einem einzigen
-- neuen Block nach staffelmieten_anwenden. Hat jemand die Funktion inzwischen geändert, bricht die
-- Migration ab, statt die Änderung still zu überschreiben — dann den Block in die neue Fassung setzen.
do $pruefung$
begin
  if md5(pg_get_functiondef('public.generate_monthly_mietforderungen()'::regprocedure))
     <> '2505412a0a1200d554b7e88e275204c3' then
    raise exception 'generate_monthly_mietforderungen weicht von der Fassung vom 28.10.2026 ab — Migration 20261028142000 anpassen';
  end if;
end;
$pruefung$;

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

  v_month := date_trunc('month', current_date)::date;
  v_monatsende := (v_month + interval '1 month' - interval '1 day')::date;
  v_days := extract(day from v_monatsende)::int;

  for v_contract in
    select mv.id, mv.kaltmiete, mv.betriebskosten, mv.start_datum,
           coalesce(mv.ende_datum, mv.kuendigungsdatum) as vertragsende
    from   mietvertrag mv
    where  mv.status in ('aktiv', 'gekuendigt')
      and  mv.start_datum <= current_date
      and  (coalesce(mv.ende_datum, mv.kuendigungsdatum) is null
            or coalesce(mv.ende_datum, mv.kuendigungsdatum) >= current_date)
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

notify pgrst, 'reload schema';
