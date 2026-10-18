-- Aktivieren eines Mietvertragsentwurfs in einer Transaktion (18.10.2026).
--
-- Vorher legte das Frontend Mieter, Vertrag, Verknüpfungen und Dokumente in
-- Einzelschritten an und baute bei einem Fehler selbst zurück. Das Review fand
-- drei Lücken: Rückbaufehler blieben unbemerkt, zwei Tabs konnten denselben
-- Entwurf zweimal aktivieren, und ein hängengebliebener Entwurf ließ sich
-- danach verwerfen — samt Dateien, die schon zum aktiven Vertrag gehörten.
--
-- Jetzt: Der Entwurf wird zuerst gelöscht („beansprucht"). Wer ihn nicht mehr
-- findet, bricht ab. Alles Weitere läuft in derselben Transaktion; scheitert
-- ein Schritt, ist nichts angelegt und der Entwurf wieder da.
--
-- Die Zeilen baut das Frontend (`utils/mietvertrag/entwurf.ts`, mit Tests);
-- hier werden nur die übergebenen Spalten geschrieben, Vorgabewerte der
-- Tabellen bleiben wirksam.

create or replace function public.aktiviere_mietvertrag_entwurf(
  p_entwurf_id uuid,
  p_vertrag jsonb,           -- Zeile für mietvertrag (inkl. id und einheit_id)
  p_neue_mieter jsonb,       -- [{ "schluessel": "...", "zeile": { mieter-Spalten } }]
  p_verknuepfungen jsonb,    -- [{ "mieter_id": uuid | null, "schluessel": "...", "rolle": "...", "position": n }]
  p_dokumente jsonb          -- [{ titel, pfad, kategorie, dateityp, groesse_bytes }]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_einheit_id  uuid;
  v_vertrag_id  uuid;
  v_mieter_id   uuid;
  v_neu         jsonb;
  v_link        jsonb;
  v_dok         jsonb;
  v_ids         jsonb := '{}'::jsonb;
  v_spalten     text;
  v_unbekannt   text;
  v_nachgeholt  int;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins dürfen Mietverträge aktivieren';
  end if;

  -- 1. Entwurf beanspruchen
  delete from public.mietvertrag_entwuerfe where id = p_entwurf_id returning einheit_id into v_einheit_id;
  if not found then
    raise exception 'Der Entwurf existiert nicht mehr — er wurde bereits aktiviert oder verworfen.';
  end if;
  if (p_vertrag ->> 'einheit_id')::uuid is distinct from v_einheit_id then
    raise exception 'Der Vertrag gehört zu einer anderen Einheit als der Entwurf.';
  end if;

  -- 2. Neue Mieter (nur die übergebenen Spalten, damit Vorgabewerte greifen)
  for v_neu in select * from jsonb_array_elements(coalesce(p_neue_mieter, '[]'::jsonb)) loop
    select string_agg(k, ', ') filter (where c.column_name is null),
           string_agg(format('%I', k), ', ') filter (where c.column_name is not null)
      into v_unbekannt, v_spalten
      from jsonb_object_keys(v_neu -> 'zeile') k
      left join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = 'mieter' and c.column_name = k;
    if v_unbekannt is not null then
      raise exception 'Unbekannte Mieterspalten: %', v_unbekannt;
    end if;
    execute format(
      'insert into public.mieter (%1$s) select %1$s from jsonb_populate_record(null::public.mieter, $1) returning id',
      v_spalten
    ) using v_neu -> 'zeile' into v_mieter_id;
    v_ids := v_ids || jsonb_build_object(v_neu ->> 'schluessel', v_mieter_id);
  end loop;

  -- 3. Vertrag
  select string_agg(k, ', ') filter (where c.column_name is null),
         string_agg(format('%I', k), ', ') filter (where c.column_name is not null)
    into v_unbekannt, v_spalten
    from jsonb_object_keys(p_vertrag) k
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = 'mietvertrag' and c.column_name = k;
  if v_unbekannt is not null then
    raise exception 'Unbekannte Vertragsspalten: %', v_unbekannt;
  end if;
  execute format(
    'insert into public.mietvertrag (%1$s) select %1$s from jsonb_populate_record(null::public.mietvertrag, $1) returning id',
    v_spalten
  ) using p_vertrag into v_vertrag_id;

  -- 4. Verknüpfungen mit Rolle und Position
  for v_link in select * from jsonb_array_elements(coalesce(p_verknuepfungen, '[]'::jsonb)) loop
    v_mieter_id := coalesce((v_link ->> 'mieter_id')::uuid, (v_ids ->> (v_link ->> 'schluessel'))::uuid);
    if v_mieter_id is null then
      raise exception 'Verknüpfung ohne Mieter';
    end if;
    insert into public.mietvertrag_mieter (mietvertrag_id, mieter_id, rolle, position)
    values (v_vertrag_id, v_mieter_id, (v_link ->> 'rolle')::public.mieterrolle, (v_link ->> 'position')::smallint);
  end loop;

  if not exists (select 1 from public.mietvertrag_mieter where mietvertrag_id = v_vertrag_id) then
    raise exception 'Der Vertrag hat keinen Mieter.';
  end if;

  -- 5. Dokumente: unterschriebene Fassung, Entwurfs-PDF, Selbstauskunft
  for v_dok in select * from jsonb_array_elements(coalesce(p_dokumente, '[]'::jsonb)) loop
    insert into public.dokumente (titel, pfad, kategorie, dateityp, groesse_bytes, mietvertrag_id, erstellt_von, geloescht)
    values (
      v_dok ->> 'titel', v_dok ->> 'pfad', (v_dok ->> 'kategorie')::public.kategorie, v_dok ->> 'dateityp',
      (v_dok ->> 'groesse_bytes')::bigint, v_vertrag_id, (select auth.uid())::text, false
    );
  end loop;

  -- 6. Forderungen seit Mietbeginn
  v_nachgeholt := public.mietforderungen_nachholen(v_vertrag_id);

  return jsonb_build_object('vertrag_id', v_vertrag_id, 'nachgeholt', v_nachgeholt, 'mieter', v_ids);
end;
$$;

revoke all on function public.aktiviere_mietvertrag_entwurf(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.aktiviere_mietvertrag_entwurf(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
