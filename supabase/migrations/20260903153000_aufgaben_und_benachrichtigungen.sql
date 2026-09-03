-- Aufgaben-Board mit Bildschirmmeldung, Erwähnungen und Benachrichtigungen
--
-- Hintergrund: Wer im Betrieb ein Problem sieht, soll es in wenigen Sekunden melden
-- können — Bildschirmfoto, Titel, verantwortliche Person markieren, fertig. Die
-- markierte Person bekommt das sofort als Benachrichtigung.
--
-- Grundlage ist die bereits vorhandene, aber nie eingebundene Tabelle dev_tickets
-- (0 Zeilen). Sie wird zum Aufgaben-Board ausgebaut, statt ein zweites Board
-- danebenzustellen.
--
-- Der Hausmeister ist bewusst ausgeschlossen: Er pflegt nur Zählerstände. Die
-- Sperre sitzt in der RLS, nicht im Frontend.

-- ---------------------------------------------------------------------------
-- 1. Benutzerverzeichnis für Erwähnungen
-- ---------------------------------------------------------------------------
-- Eigene Tabelle statt direkt auth.users, weil buchhaltung@niimmo.de erwähnbar
-- sein muss, obwohl es dafür noch kein Anmeldekonto gibt. Die Verknüpfung läuft
-- über auth_user_id, ersatzweise über die E-Mail — sobald das Konto angelegt
-- wird, greifen Benachrichtigungen ohne weiteres Zutun.

create table if not exists public.app_benutzer (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  email         text not null unique,
  anzeigename   text not null,
  kuerzel       text not null,
  funktion      text not null check (funktion in ('geschaeftsfuehrung', 'entwicklung', 'buchhaltung', 'hausmeister')),
  -- Wer hier false steht, sieht den Melder nicht und ist nicht erwähnbar.
  darf_aufgaben boolean not null default true,
  aktiv         boolean not null default true,
  sortierung    integer not null default 100,
  erstellt_am   timestamptz not null default now()
);

comment on table public.app_benutzer is
  'Internes Verzeichnis der erwähnbaren Personen. Enthält auch Personen ohne Anmeldekonto.';
comment on column public.app_benutzer.darf_aufgaben is
  'false = kein Zugriff auf Aufgaben/Benachrichtigungen (Hausmeister).';

create index if not exists app_benutzer_aktiv_idx
  on public.app_benutzer (aktiv, sortierung);

-- Auflösung des angemeldeten Kontos auf das Verzeichnis. SECURITY DEFINER, damit
-- die Funktion in RLS-Regeln verwendbar ist, ohne sich selbst auszusperren.
create or replace function public.mein_app_benutzer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.app_benutzer b
  where b.aktiv
    and (
      b.auth_user_id = auth.uid()
      or (b.auth_user_id is null
          and lower(b.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    )
  order by (b.auth_user_id = auth.uid()) desc nulls last
  limit 1
$$;

comment on function public.mein_app_benutzer_id() is
  'Verzeichnis-ID des angemeldeten Kontos; fällt auf die E-Mail zurück, solange auth_user_id fehlt.';

-- ---------------------------------------------------------------------------
-- 2. dev_tickets wird zum Aufgaben-Board
-- ---------------------------------------------------------------------------
-- screenshot_urls hieß irreführend: dort gehören Storage-Pfade hinein, keine
-- URLs (der Bucket ist privat, URLs werden erst beim Anzeigen signiert).
-- Die Tabelle ist leer, die Spalte wird nirgends gelesen — Umbenennen ist gefahrlos.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dev_tickets' and column_name = 'screenshot_urls'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dev_tickets' and column_name = 'screenshot_pfade'
  ) then
    alter table public.dev_tickets rename column screenshot_urls to screenshot_pfade;
  end if;
end $$;

alter table public.dev_tickets
  add column if not exists screenshot_pfade      text[] not null default '{}',
  add column if not exists verantwortlich_id     uuid references public.app_benutzer (id) on delete set null,
  add column if not exists melder_id             uuid references public.app_benutzer (id) on delete set null,
  add column if not exists seiten_pfad           text,
  add column if not exists seiten_titel          text,
  add column if not exists technischer_kontext   jsonb,
  add column if not exists quelle                text not null default 'manuell',
  add column if not exists erledigt_am           timestamptz;

alter table public.dev_tickets
  alter column screenshot_pfade set default '{}';

update public.dev_tickets set screenshot_pfade = '{}' where screenshot_pfade is null;
alter table public.dev_tickets alter column screenshot_pfade set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dev_tickets_quelle_check'
  ) then
    alter table public.dev_tickets
      add constraint dev_tickets_quelle_check check (quelle in ('manuell', 'bildschirmmeldung'));
  end if;
end $$;

-- Melder und Ersteller füllen sich selbst, damit der Melde-Weg ohne Zusatzfelder auskommt.
alter table public.dev_tickets alter column erstellt_von set default auth.uid();
alter table public.dev_tickets alter column melder_id    set default public.mein_app_benutzer_id();

comment on column public.dev_tickets.screenshot_pfade is
  'Pfade im privaten Bucket "dokumente" unter aufgaben/. Keine URLs.';
comment on column public.dev_tickets.quelle is
  'bildschirmmeldung = über den Melder unten rechts erfasst, manuell = im Board angelegt.';

create index if not exists dev_tickets_verantwortlich_idx
  on public.dev_tickets (verantwortlich_id, status);

-- Erledigt-Zeitpunkt mitführen, damit "seit wann fertig" nicht geraten werden muss.
create or replace function public.setze_erledigt_am()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'fertig' and coalesce(old.status, '') <> 'fertig' then
    new.erledigt_am := now();
  elsif new.status <> 'fertig' then
    new.erledigt_am := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dev_tickets_erledigt_am on public.dev_tickets;
create trigger dev_tickets_erledigt_am
  before insert or update of status on public.dev_tickets
  for each row execute function public.setze_erledigt_am();

-- ---------------------------------------------------------------------------
-- 3. Erwähnungen
-- ---------------------------------------------------------------------------
create table if not exists public.dev_ticket_erwaehnungen (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.dev_tickets (id) on delete cascade,
  benutzer_id uuid not null references public.app_benutzer (id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  unique (ticket_id, benutzer_id)
);

comment on table public.dev_ticket_erwaehnungen is
  'Wer auf einer Aufgabe markiert ist. Erzeugt beim Anlegen eine Benachrichtigung.';

create index if not exists dev_ticket_erwaehnungen_benutzer_idx
  on public.dev_ticket_erwaehnungen (benutzer_id);

-- Kommentare bekommen einen Verfasser aus dem Verzeichnis, damit im Verlauf
-- ein Name statt einer Konto-Kennung steht.
alter table public.dev_ticket_kommentare
  add column if not exists verfasser_id uuid references public.app_benutzer (id) on delete set null;

alter table public.dev_ticket_kommentare alter column erstellt_von set default auth.uid();
alter table public.dev_ticket_kommentare alter column verfasser_id set default public.mein_app_benutzer_id();

-- ---------------------------------------------------------------------------
-- 4. Benachrichtigungen
-- ---------------------------------------------------------------------------
create table if not exists public.benachrichtigungen (
  id             uuid primary key default gen_random_uuid(),
  empfaenger_id  uuid not null references public.app_benutzer (id) on delete cascade,
  ticket_id      uuid references public.dev_tickets (id) on delete cascade,
  typ            text not null check (typ in ('erwaehnung', 'zuweisung', 'kommentar', 'status')),
  titel          text not null,
  text           text,
  ausgeloest_von uuid references public.app_benutzer (id) on delete set null,
  gelesen_am     timestamptz,
  erstellt_am    timestamptz not null default now()
);

comment on table public.benachrichtigungen is
  'Posteingang je Person. Wird ausschließlich von Triggern gefüllt, nie vom Client.';

create index if not exists benachrichtigungen_offen_idx
  on public.benachrichtigungen (empfaenger_id, erstellt_am desc)
  where gelesen_am is null;

create index if not exists benachrichtigungen_empfaenger_idx
  on public.benachrichtigungen (empfaenger_id, erstellt_am desc);

-- Hilfsfunktion: legt eine Benachrichtigung an, überspringt aber die Person,
-- die die Änderung selbst ausgelöst hat, und alle ohne Aufgaben-Berechtigung.
create or replace function public.lege_benachrichtigung_an(
  _empfaenger uuid,
  _ticket     uuid,
  _typ        text,
  _titel      text,
  _text       text,
  _ausloeser  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _empfaenger is null or _empfaenger = _ausloeser then
    return;
  end if;

  if not exists (
    select 1 from public.app_benutzer
    where id = _empfaenger and aktiv and darf_aufgaben
  ) then
    return;
  end if;

  insert into public.benachrichtigungen (empfaenger_id, ticket_id, typ, titel, text, ausgeloest_von)
  values (_empfaenger, _ticket, _typ, _titel, _text, _ausloeser);
end;
$$;

-- Neue Aufgabe: die verantwortliche Person erfährt davon.
create or replace function public.benachrichtige_bei_aufgabe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ausloeser uuid := public.mein_app_benutzer_id();
begin
  perform public.lege_benachrichtigung_an(
    new.verantwortlich_id, new.id, 'zuweisung',
    'Neue Aufgabe für dich: ' || new.titel,
    coalesce(new.kurzbeschreibung, new.beschreibung),
    _ausloeser
  );
  return null;
end;
$$;

drop trigger if exists dev_tickets_benachrichtigung_neu on public.dev_tickets;
create trigger dev_tickets_benachrichtigung_neu
  after insert on public.dev_tickets
  for each row execute function public.benachrichtige_bei_aufgabe();

-- Zuständigkeit gewechselt oder Status geändert.
create or replace function public.benachrichtige_bei_aufgaben_aenderung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ausloeser uuid := public.mein_app_benutzer_id();
  _empf      uuid;
begin
  if new.verantwortlich_id is distinct from old.verantwortlich_id then
    perform public.lege_benachrichtigung_an(
      new.verantwortlich_id, new.id, 'zuweisung',
      'Aufgabe dir zugewiesen: ' || new.titel,
      coalesce(new.kurzbeschreibung, new.beschreibung),
      _ausloeser
    );
  end if;

  if new.status is distinct from old.status then
    for _empf in
      select distinct b from unnest(array[new.melder_id, new.verantwortlich_id]) as b
      where b is not null
    loop
      perform public.lege_benachrichtigung_an(
        _empf, new.id, 'status',
        'Status geändert: ' || new.titel,
        'Jetzt „' || new.status || '“ statt „' || old.status || '“.',
        _ausloeser
      );
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists dev_tickets_benachrichtigung_aenderung on public.dev_tickets;
create trigger dev_tickets_benachrichtigung_aenderung
  after update of status, verantwortlich_id on public.dev_tickets
  for each row execute function public.benachrichtige_bei_aufgaben_aenderung();

-- Erwähnung: die markierte Person erfährt davon.
create or replace function public.benachrichtige_bei_erwaehnung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ausloeser uuid := public.mein_app_benutzer_id();
  _titel     text;
  _kurz      text;
begin
  select t.titel, coalesce(t.kurzbeschreibung, t.beschreibung)
    into _titel, _kurz
  from public.dev_tickets t where t.id = new.ticket_id;

  perform public.lege_benachrichtigung_an(
    new.benutzer_id, new.ticket_id, 'erwaehnung',
    'Du wurdest markiert: ' || coalesce(_titel, 'Aufgabe'),
    _kurz,
    _ausloeser
  );
  return null;
end;
$$;

drop trigger if exists erwaehnungen_benachrichtigung on public.dev_ticket_erwaehnungen;
create trigger erwaehnungen_benachrichtigung
  after insert on public.dev_ticket_erwaehnungen
  for each row execute function public.benachrichtige_bei_erwaehnung();

-- Kommentar: verantwortliche Person, Melder und alle Markierten erfahren davon.
create or replace function public.benachrichtige_bei_kommentar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ausloeser uuid := public.mein_app_benutzer_id();
  _titel     text;
  _verant    uuid;
  _melder    uuid;
  _empf      uuid;
begin
  select t.titel, t.verantwortlich_id, t.melder_id
    into _titel, _verant, _melder
  from public.dev_tickets t where t.id = new.ticket_id;

  for _empf in
    select distinct e from (
      select unnest(array[_verant, _melder]) as e
      union
      select benutzer_id from public.dev_ticket_erwaehnungen where ticket_id = new.ticket_id
    ) q where e is not null
  loop
    perform public.lege_benachrichtigung_an(
      _empf, new.ticket_id, 'kommentar',
      'Neuer Kommentar: ' || coalesce(_titel, 'Aufgabe'),
      left(new.kommentar, 300),
      _ausloeser
    );
  end loop;

  return null;
end;
$$;

drop trigger if exists kommentare_benachrichtigung on public.dev_ticket_kommentare;
create trigger kommentare_benachrichtigung
  after insert on public.dev_ticket_kommentare
  for each row execute function public.benachrichtige_bei_kommentar();

-- ---------------------------------------------------------------------------
-- 5. Zugriffsschutz
-- ---------------------------------------------------------------------------
alter table public.app_benutzer             enable row level security;
alter table public.dev_ticket_erwaehnungen  enable row level security;
alter table public.benachrichtigungen       enable row level security;

-- Verzeichnis: nur Verwaltung, und nur die aktiven Einträge.
drop policy if exists "Admins lesen das Benutzerverzeichnis" on public.app_benutzer;
create policy "Admins lesen das Benutzerverzeichnis"
  on public.app_benutzer for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins pflegen das Benutzerverzeichnis" on public.app_benutzer;
create policy "Admins pflegen das Benutzerverzeichnis"
  on public.app_benutzer for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Aufgaben waren bisher für JEDEN angemeldeten Nutzer lesbar — auch für den
-- Hausmeister. Das wird hier geschlossen.
drop policy if exists "Authenticated users can read dev_tickets" on public.dev_tickets;
drop policy if exists "Admins lesen Aufgaben" on public.dev_tickets;
create policy "Admins lesen Aufgaben"
  on public.dev_tickets for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "Authenticated users can read dev_ticket_kommentare" on public.dev_ticket_kommentare;
drop policy if exists "Admins lesen Aufgaben-Kommentare" on public.dev_ticket_kommentare;
create policy "Admins lesen Aufgaben-Kommentare"
  on public.dev_ticket_kommentare for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins lesen Erwaehnungen" on public.dev_ticket_erwaehnungen;
create policy "Admins lesen Erwaehnungen"
  on public.dev_ticket_erwaehnungen for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins setzen Erwaehnungen" on public.dev_ticket_erwaehnungen;
create policy "Admins setzen Erwaehnungen"
  on public.dev_ticket_erwaehnungen for insert to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins entfernen Erwaehnungen" on public.dev_ticket_erwaehnungen;
create policy "Admins entfernen Erwaehnungen"
  on public.dev_ticket_erwaehnungen for delete to authenticated
  using (public.is_admin(auth.uid()));

-- Posteingang: jeder sieht ausschließlich seinen eigenen. Angelegt wird nur
-- durch die Trigger (SECURITY DEFINER) — es gibt bewusst keine INSERT-Regel.
drop policy if exists "Eigene Benachrichtigungen lesen" on public.benachrichtigungen;
create policy "Eigene Benachrichtigungen lesen"
  on public.benachrichtigungen for select to authenticated
  using (empfaenger_id = public.mein_app_benutzer_id());

drop policy if exists "Eigene Benachrichtigungen als gelesen markieren" on public.benachrichtigungen;
create policy "Eigene Benachrichtigungen als gelesen markieren"
  on public.benachrichtigungen for update to authenticated
  using (empfaenger_id = public.mein_app_benutzer_id())
  with check (empfaenger_id = public.mein_app_benutzer_id());

drop policy if exists "Eigene Benachrichtigungen loeschen" on public.benachrichtigungen;
create policy "Eigene Benachrichtigungen loeschen"
  on public.benachrichtigungen for delete to authenticated
  using (empfaenger_id = public.mein_app_benutzer_id());

-- Anonymer Zugriff bleibt ausgeschlossen (siehe Sperre vom 24.08.2026):
-- Postgres vergibt EXECUTE per Default an PUBLIC, ein REVOKE nur von anon wirkt nicht.
revoke execute on function public.mein_app_benutzer_id()               from public;
revoke execute on function public.lege_benachrichtigung_an(uuid, uuid, text, text, text, uuid) from public;
revoke execute on function public.benachrichtige_bei_aufgabe()          from public;
revoke execute on function public.benachrichtige_bei_aufgaben_aenderung() from public;
revoke execute on function public.benachrichtige_bei_erwaehnung()       from public;
revoke execute on function public.benachrichtige_bei_kommentar()        from public;
revoke execute on function public.setze_erledigt_am()                   from public;

grant execute on function public.mein_app_benutzer_id() to authenticated, service_role;
grant execute on function public.lege_benachrichtigung_an(uuid, uuid, text, text, text, uuid) to service_role;

-- Bildschirmfotos liegen im Dokumenten-Bucket unter aufgaben/. Sie gehören nicht
-- in die Dokumentenverwaltung des Kunden und sollen dem Hausmeister verborgen
-- bleiben — deshalb schließen die bestehenden Bucket-Regeln diesen Präfix aus.
-- Für alle übrigen Dokumente ändert sich nichts (kein Objekt nutzt den Präfix).
drop policy if exists "Authenticated users can view documents" on storage.objects;
create policy "Authenticated users can view documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dokumente'
    and (name not like 'aufgaben/%' or public.is_admin(auth.uid()))
  );

drop policy if exists "Authenticated users can download documents" on storage.objects;
create policy "Authenticated users can download documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dokumente'
    and (name not like 'aufgaben/%' or public.is_admin(auth.uid()))
  );

drop policy if exists "Authenticated users can upload documents" on storage.objects;
create policy "Authenticated users can upload documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dokumente'
    and (name not like 'aufgaben/%' or public.is_admin(auth.uid()))
  );

drop policy if exists "Authenticated users can update documents" on storage.objects;
create policy "Authenticated users can update documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'dokumente'
    and (name not like 'aufgaben/%' or public.is_admin(auth.uid()))
  );

drop policy if exists "Authenticated users can delete documents" on storage.objects;
create policy "Authenticated users can delete documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dokumente'
    and (name not like 'aufgaben/%' or public.is_admin(auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 6. Live-Zustellung
-- ---------------------------------------------------------------------------
-- Ohne Eintrag in der Publikation kommt beim Empfänger nichts an; die Publikation
-- war bisher komplett leer.
alter table public.benachrichtigungen replica identity full;
alter table public.dev_tickets        replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'benachrichtigungen'
  ) then
    alter publication supabase_realtime add table public.benachrichtigungen;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_tickets'
  ) then
    alter publication supabase_realtime add table public.dev_tickets;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Die fünf internen Personen
-- ---------------------------------------------------------------------------
insert into public.app_benutzer (auth_user_id, email, anzeigename, kuerzel, funktion, darf_aufgaben, sortierung)
values
  ('6e40a868-b85d-4b67-9880-a358724b8e9a', 'info@kitdienstleistungen.de',   'Ayham Alkhalil',       'AA', 'entwicklung',        true,  10),
  ('104a56c9-4a17-47c2-a75c-95051431837a', 'yeyrek@niimmo.de',              'Ayhan Yeyrek',         'AY', 'geschaeftsfuehrung', true,  20),
  ('59879a5d-38e4-4c2a-b655-53c968984a9d', 'mikyas@niimmo.de',              'Dennis Mikyas',         'DM', 'geschaeftsfuehrung', true,  30),
  (null,                                   'buchhaltung@niimmo.de',         'Buchhaltung',          'BH', 'buchhaltung',        true,  40),
  ('5f8c4da6-2904-4c97-9e60-95ae1b3e7cdc', 'info@leine-gebaeudeservice.de', 'Leine Gebäudeservice', 'LG', 'hausmeister',        false, 90)
on conflict (email) do update set
  auth_user_id  = excluded.auth_user_id,
  anzeigename   = excluded.anzeigename,
  kuerzel       = excluded.kuerzel,
  funktion      = excluded.funktion,
  darf_aufgaben = excluded.darf_aufgaben,
  sortierung    = excluded.sortierung;
