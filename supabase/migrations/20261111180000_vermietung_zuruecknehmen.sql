-- Nutzer 11.11.2026 abends: „Den Mietvertrag als PDF zu erzeugen ist ein anderer Prozess als einen Mietvertrag im
-- System zu haben … Man soll ganz normal abschließen können, und die Erstellung des Mietvertrags ist optional.“ Die
-- Vermietung schließt seitdem ohne unterschriebene Fassung ab (`unterschrift_ausstehend`). Springt ein Mieter danach
-- und vor der Unterschrift ab, bliebe ein Vertrag stehen, der nie gelaufen ist — löschen ließ er sich bis dahin nicht.
--
-- Zurücknehmen geht nur, solange nichts darauf aufbaut: keine unterschriebene Fassung, keine Kündigung, keine
-- zugeordnete Zahlung, keine Kaution, keine Mahnung, keine Abrechnung, keine Forderung außer der Monatsmiete, keine
-- Mieterhöhung, keine Zählerstände, keine Nachrichten. Geprüft gegen alle Fremdschlüssel auf `mietvertrag` (Stand
-- 11.11.2026): Was nicht geprüft wird, hängt nur am Vertrag (Mieterverknüpfung, Sollstellung, Dokumente) oder wird
-- auf null gesetzt (Zahlungs-Anomalien, Vorvertrag-Verweise). Admins sehen alle geprüften Tabellen (RLS). Gelöscht
-- werden der Vertrag und, über die Fremdschlüssel, Mieterverknüpfung, Forderungen, Sollstellungsmonate und die
-- Dokumentzeilen. Die Mieter bleiben im Bestand. Die Pfade der Dokumente gibt die Funktion zurück — die Dateien
-- entfernt die Anwendung aus dem Storage (eine Datei ohne Zeile in `dokumente` ist im UI ohnehin unsichtbar).
create or replace function public.vermietung_zuruecknehmen(p_vertrag_id uuid)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_vertrag public.mietvertrag%rowtype;
  v_pfade text[];
  v_forderungen integer;
  v_geloescht integer;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins dürfen Verträge ändern';
  end if;

  -- Sperrt den Vertrag: Eine gleichzeitige Zuordnung oder ein Nachreichen wartet und schlägt danach fehl
  select * into v_vertrag from public.mietvertrag where id = p_vertrag_id for update;
  if not found then
    raise exception 'Den Vertrag gibt es nicht mehr.';
  end if;
  if not v_vertrag.unterschrift_ausstehend then
    raise exception 'Zu diesem Vertrag liegt die unterschriebene Fassung vor. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  -- Eine Kündigung ist schon ein Schriftstück an den Mieter (Review 11.11.2026)
  if v_vertrag.status is distinct from 'aktiv' or v_vertrag.kuendigungsdatum is not null then
    raise exception 'Der Vertrag ist gekündigt oder beendet. Zurücknehmen geht nicht mehr.';
  end if;
  if exists (select 1 from public.zahlungen where mietvertrag_id = p_vertrag_id) then
    raise exception 'Dem Vertrag sind schon Zahlungen zugeordnet. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if coalesce(v_vertrag.kaution_ist, 0) > 0 or v_vertrag.kaution_gezahlt_am is not null then
    raise exception 'Zu diesem Vertrag ist schon eine Kaution verbucht. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if exists (select 1 from public.mahnung_versand where mietvertrag_id = p_vertrag_id) then
    raise exception 'Zu diesem Vertrag wurde schon gemahnt. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if exists (select 1 from public.nebenkosten_abrechnungen where mietvertrag_id = p_vertrag_id)
     or exists (select 1 from public.nebenkosten_verbrauch where mietvertrag_id = p_vertrag_id) then
    raise exception 'Der Vertrag steckt schon in einer Nebenkostenabrechnung. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  -- Nur die Monatsmieten der Sollstellung fallen weg — eine Nachzahlung o. Ä. wurde von Hand angelegt (Review 11.11.2026)
  if exists (
    select 1 from public.mietforderungen
     where mietvertrag_id = p_vertrag_id and (coalesce(typ, 'Miete') <> 'Miete' or ruecklastschrift_am is not null)
  ) then
    raise exception 'Zu diesem Vertrag gibt es schon andere Forderungen als die Monatsmiete. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if exists (select 1 from public.mieterhoehungen where mietvertrag_id = p_vertrag_id) then
    raise exception 'Zu diesem Vertrag gibt es schon eine Mieterhöhung. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if exists (select 1 from public.zaehlerstand_historie where mietvertrag_id = p_vertrag_id) then
    raise exception 'Zu diesem Vertrag sind schon Zählerstände erfasst. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;
  if exists (select 1 from public.whatsapp_nachrichten where mietvertrag_id = p_vertrag_id)
     or exists (select 1 from public.mails where mietvertrag_id = p_vertrag_id) then
    raise exception 'Zu diesem Vertrag gibt es schon Nachrichten an den Mieter. Zurücknehmen geht nicht mehr, nur kündigen.';
  end if;

  select coalesce(array_agg(pfad) filter (where pfad is not null), '{}') into v_pfade
    from public.dokumente where mietvertrag_id = p_vertrag_id;
  select count(*) into v_forderungen from public.mietforderungen where mietvertrag_id = p_vertrag_id;

  delete from public.mietvertrag where id = p_vertrag_id;
  -- RLS verweigert ein DELETE still mit 0 Zeilen — das darf nicht wie ein Erfolg aussehen
  get diagnostics v_geloescht = row_count;
  if v_geloescht = 0 then
    raise exception 'Der Vertrag wurde nicht gelöscht (keine Berechtigung).';
  end if;

  return jsonb_build_object('pfade', to_jsonb(v_pfade), 'forderungen', v_forderungen);
end;
$function$;

revoke all on function public.vermietung_zuruecknehmen(uuid) from public, anon;
grant execute on function public.vermietung_zuruecknehmen(uuid) to authenticated;
