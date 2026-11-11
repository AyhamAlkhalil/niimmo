-- Kundenwunsch 11.11.2026: „erst jemanden anlegen und das ist dann auch aktiviert und alles, und dann sagen, wir
-- erstellen jetzt einen Mietvertrag — oder sofort einen Mietvertrag erstellen“. Bis dahin ließ sich ein Entwurf nur
-- mit hochgeladener unterschriebener Fassung aktivieren (Entscheidung vom 18.10.2026).
--
-- Jetzt geht beides: Ohne unterschriebene Fassung aktiviert, trägt der Vertrag `unterschrift_ausstehend`. Die Einheit
-- zeigt das, bis die unterschriebene Fassung über `unterschrift_nachreichen` hochgeladen ist. Das Aktivieren selbst
-- (`aktiviere_mietvertrag_entwurf`) bleibt unverändert: Es schreibt nur die übergebenen Vertragsspalten.
alter table public.mietvertrag add column if not exists unterschrift_ausstehend boolean not null default false;

comment on column public.mietvertrag.unterschrift_ausstehend is
  'Ohne unterschriebene Fassung aktiviert (seit 11.11.2026); false, sobald sie über unterschrift_nachreichen vorliegt.';

-- Unterschriebene Fassung nachreichen: Dokument anlegen und Merker löschen, in einer Transaktion. Die Datei liegt
-- schon im Bucket `dokumente` (Pfad unter mietvertraege/<vertrag>/); scheitert dies, löscht die Anwendung sie wieder.
create or replace function public.unterschrift_nachreichen(p_vertrag_id uuid, p_dokument jsonb)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins dürfen Verträge ändern';
  end if;
  if not exists (select 1 from public.mietvertrag where id = p_vertrag_id) then
    raise exception 'Den Vertrag gibt es nicht.';
  end if;
  if coalesce(p_dokument ->> 'pfad', '') not like 'mietvertraege/' || p_vertrag_id::text || '/%' then
    raise exception 'Die Datei gehört nicht zu diesem Vertrag.';
  end if;

  -- Nur solange sie aussteht: Zwei Tabs reichen sonst zweimal nach (Review 11.11.2026)
  update public.mietvertrag set unterschrift_ausstehend = false where id = p_vertrag_id and unterschrift_ausstehend;
  if not found then
    raise exception 'Die unterschriebene Fassung ist schon nachgereicht.';
  end if;

  insert into public.dokumente (titel, pfad, kategorie, dateityp, groesse_bytes, mietvertrag_id, erstellt_von, geloescht)
  values (
    p_dokument ->> 'titel', p_dokument ->> 'pfad', 'Mietvertrag'::public.kategorie, p_dokument ->> 'dateityp',
    (p_dokument ->> 'groesse_bytes')::bigint, p_vertrag_id, (select auth.uid())::text, false
  );
end;
$function$;

revoke all on function public.unterschrift_nachreichen(uuid, jsonb) from public, anon;
grant execute on function public.unterschrift_nachreichen(uuid, jsonb) to authenticated;
