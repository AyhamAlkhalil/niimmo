-- 30.10.2026: betriebskosten_verlauf nach der Tabellenregel des Projekts (created_at und updated_at statt erfasst_am).
-- Die Tabelle ist seit 20261030120000 live und noch leer; mieterhoehung_anwenden_intern sucht die Zeile des
-- laufenden Speicherns jetzt über created_at.

alter table public.betriebskosten_verlauf rename column erfasst_am to created_at;
alter table public.betriebskosten_verlauf add column if not exists updated_at timestamptz not null default now();

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
       set gueltig_ab = v_mh.wirksam_ab,
           updated_at = now()
     where mietvertrag_id = v_mv.id
       and created_at = now()
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
