-- Kundenwunsch 10.11.2026: „erst einmal die Mieter anlegen“ — den Mietvertrag später oder gar nicht.
-- Bis dahin entstand ein Mieter nur beim Aktivieren mit unterschriebenem Vertrag; wer nur die Person
-- erfassen wollte (etwa vor der Zusage des Jobcenters), kam aus dem Ablauf nicht heraus.
--
-- Legt die übergebenen Mitmieter eines Entwurfs in einer Transaktion als Mieter an und vermerkt den
-- Datensatz an der Person im Entwurf (mieterId, quelle 'bestand', bestandStand). Beim Aktivieren
-- gelten sie dann als Bestandsmieter — es entsteht keine Dublette. Die Zeilen baut die Anwendung mit
-- derselben Abbildung wie die Aktivierung (mieterZeile in utils/mietvertrag/entwurf.ts).
create or replace function public.lege_mieter_aus_entwurf_an(p_entwurf_id uuid, p_stand timestamptz, p_neue_mieter jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_personen   jsonb;
  v_stand      timestamptz;
  v_neu        jsonb;
  v_index      int;
  v_person     jsonb;
  v_mieter     public.mieter;
  v_spalten    text;
  v_unbekannt  text;
  v_ids        jsonb := '{}'::jsonb;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins dürfen Mieter anlegen';
  end if;

  -- Entwurf sperren: Zwei gleichzeitige Klicks legen die Person nicht zweimal an
  select personen, aktualisiert_am into v_personen, v_stand
    from public.mietvertrag_entwuerfe
   where id = p_entwurf_id
     for update;
  if not found then
    raise exception 'Der Entwurf existiert nicht mehr — er wurde bereits aktiviert oder verworfen.';
  end if;
  if p_stand is distinct from v_stand then
    raise exception 'Der Entwurf wurde inzwischen geändert. Bitte schließen und neu öffnen — es wurde niemand angelegt.';
  end if;
  if jsonb_typeof(v_personen) is distinct from 'array' then
    raise exception 'Der Entwurf hat keine Personen.';
  end if;

  for v_neu in select * from jsonb_array_elements(coalesce(p_neue_mieter, '[]'::jsonb)) loop
    -- Nur Mitmieter, die im Entwurf stehen und noch keinen Datensatz haben
    select t.i - 1, t.e into v_index, v_person
      from jsonb_array_elements(v_personen) with ordinality as t(e, i)
     where t.e ->> 'schluessel' = v_neu ->> 'schluessel';
    if v_person is null then
      raise exception 'Die Person steht nicht im Entwurf.';
    end if;
    if v_person ->> 'rolle' is distinct from 'mitmieter' then
      raise exception 'Nur Mitmieter werden als Mieter angelegt, nicht Mitbewohner.';
    end if;
    if nullif(v_person ->> 'mieterId', '') is not null then
      raise exception 'Die Person ist schon als Mieter angelegt.';
    end if;

    -- Wie in aktiviere_mietvertrag_entwurf: nur die übergebenen Spalten, damit Vorgabewerte greifen
    select string_agg(k, ', ') filter (where c.column_name is null),
           string_agg(format('%I', k), ', ') filter (where c.column_name is not null)
      into v_unbekannt, v_spalten
      from jsonb_object_keys(v_neu -> 'zeile') k
      left join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = 'mieter' and c.column_name = k;
    if v_unbekannt is not null then
      raise exception 'Unbekannte Mieterspalten: %', v_unbekannt;
    end if;
    if v_spalten is null then
      raise exception 'Leere Mieterzeile.';
    end if;
    execute format(
      'insert into public.mieter (%1$s) select %1$s from jsonb_populate_record(null::public.mieter, $1) returning *',
      v_spalten
    ) using v_neu -> 'zeile' into v_mieter;

    -- bestandStand in Spaltenform wie bestandsStammdaten(): Beim Aktivieren gehen nur danach geänderte Felder mit
    v_personen := jsonb_set(v_personen, array[v_index::text], v_person || jsonb_build_object(
      'mieterId', v_mieter.id,
      'quelle', 'bestand',
      'bestandStand', jsonb_build_object(
        'anrede', v_mieter.anrede,
        'hauptmail', v_mieter.hauptmail,
        'telnr', v_mieter.telnr,
        'geburtsdatum', v_mieter.geburtsdatum,
        'vertreten_durch', v_mieter.vertreten_durch,
        'strasse', v_mieter.strasse,
        'hausnummer', v_mieter.hausnummer,
        'plz', v_mieter.plz,
        'ort', v_mieter.ort
      )
    ));
    v_ids := v_ids || jsonb_build_object(v_neu ->> 'schluessel', v_mieter.id);
  end loop;

  update public.mietvertrag_entwuerfe
     set personen = v_personen
   where id = p_entwurf_id
  returning aktualisiert_am into v_stand;

  return jsonb_build_object('ids', v_ids, 'personen', v_personen, 'aktualisiert_am', v_stand);
end;
$function$;

revoke all on function public.lege_mieter_aus_entwurf_an(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.lege_mieter_aus_entwurf_an(uuid, timestamptz, jsonb) to authenticated;
