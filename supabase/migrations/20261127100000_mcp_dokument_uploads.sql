-- 27.11.2026: Claude legt über den MCP-Konnektor Dateien im Reiter „Dokumente“ ab (Leitfaden des Kunden vom 27.11.2026).
--
-- Ablauf: dokument_upload_vorbereiten liefert eine signierte Upload-URL des Speichers, Claude lädt die Datei per PUT
-- aus seiner Arbeitsumgebung hoch, dokument_upload_abschliessen prüft sie und legt die Zeile in dokumente an — mit
-- denselben Feldern wie der Hochladen-Knopf der App (hooks/useDocumentUpload.ts).
--
-- Diese Tabelle merkt sich zwischen den beiden Schritten Ziel, Titel, Kategorie, Typ und Größe. Abgeschlossene
-- Zeilen bleiben als Herkunftsnachweis stehen: welches Dokument Claude abgelegt hat und von welchem Konto.

create table public.mcp_dokument_uploads (
  id               uuid primary key default gen_random_uuid(),
  -- Schema der App: <Vertrag oder Objekt>/<Zeitstempel>_<Zufall>.<Endung>; nur ASCII (utils/storagePfad.ts)
  pfad             text not null unique
                     check (pfad ~ '^[0-9a-f-]{36}/[0-9]{13}_[a-z0-9]{4,16}\.(pdf|jpg|png|docx|xlsx)$'),
  -- Cascade: ein Vorgang darf das Löschen eines Vertrags (vermietung_zuruecknehmen) nicht sperren
  mietvertrag_id   uuid references public.mietvertrag(id) on delete cascade,
  immobilie_id     uuid references public.immobilien(id) on delete cascade,
  dateiname        text not null check (btrim(dateiname) <> ''),
  titel            text not null check (btrim(titel) <> ''),
  -- Mietvertrags-Dokumente tragen die Vertragsfassungen (utils/mietvertrag/fassungen.ts) und gehen nur in der App
  kategorie        public.kategorie not null check (kategorie <> 'Mietvertrag'),
  mime_type        text not null check (mime_type in (
                     'application/pdf',
                     'image/jpeg',
                     'image/png',
                     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                   )),
  groesse_bytes    bigint not null check (groesse_bytes between 1 and 52428800),
  -- Frist für den Abschluss; die signierte URL des Speichers selbst gilt fest 2 Stunden
  gueltig_bis      timestamptz not null,
  dokument_id      uuid references public.dokumente(id) on delete set null,
  abgeschlossen_am timestamptz,
  erstellt_von     uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mcp_dokument_uploads_genau_ein_ziel check (num_nonnulls(mietvertrag_id, immobilie_id) = 1)
);

comment on table public.mcp_dokument_uploads is
  'Uploads von Claude über den MCP-Konnektor: offen zwischen vorbereiten und abschließen, danach Herkunftsnachweis des Dokuments.';

alter table public.mcp_dokument_uploads enable row level security;

-- Wie dokumente und der Bucket: nur die Verwaltung
create policy "Admins sehen Claude-Uploads"
  on public.mcp_dokument_uploads for select to authenticated using (is_admin(auth.uid()));
create policy "Admins merken eigene Claude-Uploads vor"
  on public.mcp_dokument_uploads for insert to authenticated
  with check (is_admin(auth.uid()) and erstellt_von = auth.uid());
create policy "Admins schliessen Claude-Uploads ab"
  on public.mcp_dokument_uploads for update to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
-- Weggeräumt werden nur offene Vorgänge; der Nachweis abgeschlossener bleibt
create policy "Admins raeumen offene Claude-Uploads weg"
  on public.mcp_dokument_uploads for delete to authenticated
  using (is_admin(auth.uid()) and abgeschlossen_am is null);

-- Eigene Funktion wie bei briefunterzeichner: update_updated_at_column() setzt live aktualisiert_am
create or replace function public.set_updated_at_mcp_dokument_uploads()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger mcp_dokument_uploads_updated_at
  before update on public.mcp_dokument_uploads
  for each row execute function public.set_updated_at_mcp_dokument_uploads();

-- Abschluss in einer Transaktion: Zeile in dokumente anlegen und Vorgang als abgeschlossen markieren. Die Sperre
-- (for update) macht zwei gleichzeitige Aufrufe mit derselben upload_id harmlos; ein zweiter Aufruf liefert das
-- schon angelegte Dokument (neu = false). Größe und Typ der Datei prüft die Edge Function vorher an den Bytes.
-- Läuft mit den Rechten des Aufrufers (RLS wie in der App). Ein Admin kann sie auch direkt aufrufen, ohne die Prüfung
-- der Bytes; das gibt ihm nicht mehr, als ein direkter Insert in dokumente ohnehin erlaubt (Review 27.11.2026).
-- Meldungen sind für den Nutzer bestimmt (P0001).
create or replace function public.mcp_dokument_upload_abschliessen(p_upload_id uuid, p_groesse_bytes bigint)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_upload public.mcp_dokument_uploads;
  v_dokument uuid;
begin
  if not is_admin(auth.uid()) then
    raise exception 'Nur die Verwaltung darf Dokumente ablegen.';
  end if;

  select * into v_upload from public.mcp_dokument_uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception 'Diesen Upload gibt es nicht. Bitte die upload_id aus dokument_upload_vorbereiten verwenden.';
  end if;

  if v_upload.abgeschlossen_am is not null then
    return jsonb_build_object('dokument_id', v_upload.dokument_id, 'neu', false);
  end if;

  if v_upload.gueltig_bis < now() then
    raise exception 'Die Upload-URL ist abgelaufen. Bitte dokument_upload_vorbereiten erneut aufrufen.';
  end if;

  if p_groesse_bytes is distinct from v_upload.groesse_bytes then
    raise exception 'Die Größe der hochgeladenen Datei passt nicht zur Angabe aus dokument_upload_vorbereiten.';
  end if;

  insert into public.dokumente (pfad, titel, dateityp, groesse_bytes, mietvertrag_id, immobilie_id, kategorie, erstellt_von)
  values (v_upload.pfad, v_upload.titel, v_upload.mime_type, v_upload.groesse_bytes, v_upload.mietvertrag_id,
          v_upload.immobilie_id, v_upload.kategorie, auth.uid()::text)
  returning id into v_dokument;

  update public.mcp_dokument_uploads
     set dokument_id = v_dokument, abgeschlossen_am = now()
   where id = v_upload.id;

  return jsonb_build_object('dokument_id', v_dokument, 'neu', true);
end;
$function$;

revoke all on function public.mcp_dokument_upload_abschliessen(uuid, bigint) from public, anon;
grant execute on function public.mcp_dokument_upload_abschliessen(uuid, bigint) to authenticated;
