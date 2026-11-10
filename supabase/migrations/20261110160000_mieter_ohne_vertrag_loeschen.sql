-- Mieter ohne Mietvertrag löschen (10.11.2026). Seit „Mieter anlegen“ (20261110140000) entstehen Mieter
-- vor dem Vertrag. Sagt der Interessent ab und wird der Entwurf verworfen, blieben Name, Geburtsdatum,
-- Anschrift und Telefon ohne Zweck im Bestand — die Anwendung kannte keinen Weg, einen Mieter zu löschen.
-- Live standen dazu schon fünf Mieter ohne Vertrag aus 2025 (Reste gelöschter Verträge: das Löschen
-- eines Vertrags entfernt nur die Verknüpfung in mietvertrag_mieter).
--
-- Gelöscht wird nur, wer an nichts hängt: kein Mietvertrag (auch kein beendeter — dessen Mieter gehört
-- zur Akte), in keinem offenen Mietvertragsentwurf (dort zuerst den Entwurf verwerfen) und keine
-- WhatsApp-Nachrichten (Fremdschlüssel ohne Kaskade). Wer hängt, bleibt mit Grund in `behalten`; der
-- Aufruf scheitert daran nicht, damit beim Verwerfen eines Entwurfs der Rest gelöscht wird.
-- Ein schon gelöschter Mieter wird übersprungen: Kam nur die Antwort nicht an, geht ein zweiter Versuch.
--
-- Bekannte Lücke: Die Verbindung Entwurf → Mieter ist JSON ohne Fremdschlüssel. Speichert jemand im selben
-- Augenblick einen Entwurf, der genau diesen Mieter aus dem Bestand wählt, zeigt der Entwurf danach ins Leere;
-- die Aktivierung scheitert dann am Fremdschlüssel von mietvertrag_mieter, statt still etwas anzulegen.
create or replace function public.loesche_mieter_ohne_vertrag(p_mieter_ids uuid[])
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_id         uuid;
  v_mieter     public.mieter;
  v_name       text;
  v_grund      text;
  v_geloescht  jsonb := '[]'::jsonb;
  v_behalten   jsonb := '[]'::jsonb;
  v_anzahl     int;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins dürfen Mieter löschen';
  end if;

  -- Sortiert und je einmal: Zwei gleichzeitige Aufrufe sperren die Zeilen in derselben Reihenfolge (keine Verklemmung)
  foreach v_id in array coalesce((select array_agg(distinct x order by x) from unnest(p_mieter_ids) x where x is not null), '{}'::uuid[]) loop
    -- Zeile sperren: Eine gleichzeitige Verknüpfung (Fremdschlüssel nimmt KEY SHARE) wartet, bis hier
    -- entschieden ist, und scheitert dann am gelöschten Mieter, statt einen Vertrag ohne Mieter zu hinterlassen
    select * into v_mieter from public.mieter where id = v_id for update;
    if not found then
      continue;
    end if;
    v_name := coalesce(
      nullif(case when v_mieter.ist_unternehmen then btrim(v_mieter.firmenname) end, ''),
      nullif(btrim(concat_ws(' ', v_mieter.vorname, v_mieter.nachname)), ''),
      'Ohne Namen'
    );

    v_grund := case
      when exists (select 1 from public.mietvertrag_mieter mm where mm.mieter_id = v_id)
        then 'hat einen Mietvertrag'
      when exists (
        select 1
          from public.mietvertrag_entwuerfe e
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(e.personen) = 'array' then e.personen else '[]'::jsonb end
          ) p
         where p ->> 'mieterId' = v_id::text
      )
        then 'steht in einem offenen Mietvertragsentwurf'
      when exists (select 1 from public.whatsapp_nachrichten w where w.mieter_id = v_id)
        then 'hat WhatsApp-Nachrichten'
    end;

    if v_grund is not null then
      v_behalten := v_behalten || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name, 'grund', v_grund));
      continue;
    end if;

    delete from public.mieter where id = v_id;
    -- RLS verweigert ein DELETE still mit 0 Zeilen (27.10.2026) — dann nicht als gelöscht melden
    get diagnostics v_anzahl = row_count;
    if v_anzahl = 0 then
      v_behalten := v_behalten || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name, 'grund', 'Löschen nicht erlaubt'));
      continue;
    end if;
    v_geloescht := v_geloescht || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name));
  end loop;

  return jsonb_build_object('geloescht', v_geloescht, 'behalten', v_behalten);
end;
$function$;

revoke all on function public.loesche_mieter_ohne_vertrag(uuid[]) from public, anon;
grant execute on function public.loesche_mieter_ohne_vertrag(uuid[]) to authenticated;
