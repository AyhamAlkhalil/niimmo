-- 27.10.2026 (Review zu 20261027130000): staffelstufen() pruefte das Datum nur auf das Format
-- JJJJ-MM-TT. Ein unmoegliches Datum wie 2026-02-30 bestand die Pruefung, der Cast auf date warf --
-- in mietforderungen_nachholen ohne Faenger, die Aktivierung des Vertrags brach dann ab. Jetzt wird
-- jede Stufe einzeln gelesen; eine unlesbare faellt heraus, und staffelmieten_anwenden warnt wie bisher.

create or replace function public.staffelstufen(p_plan jsonb)
 returns table(gueltig_ab date, kaltmiete numeric)
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_stufe jsonb;
  v_datum date;
  v_betrag numeric;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' then
    return;
  end if;
  for v_stufe in select value from jsonb_array_elements(p_plan) loop
    begin
      v_datum := case when v_stufe->>'gueltig_ab' ~ '^\d{4}-\d{2}-\d{2}$' then (v_stufe->>'gueltig_ab')::date end;
      v_betrag := case when jsonb_typeof(v_stufe->'kaltmiete') = 'number' then (v_stufe->>'kaltmiete')::numeric
                       when v_stufe->>'kaltmiete' ~ '^\d+(\.\d+)?$' then (v_stufe->>'kaltmiete')::numeric end;
    exception when others then
      v_datum := null;
      v_betrag := null;
    end;
    if v_datum is not null and v_betrag is not null and v_betrag > 0 then
      gueltig_ab := v_datum;
      kaltmiete := v_betrag;
      return next;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.staffelstufen(jsonb) from public, anon;
grant execute on function public.staffelstufen(jsonb) to authenticated;
