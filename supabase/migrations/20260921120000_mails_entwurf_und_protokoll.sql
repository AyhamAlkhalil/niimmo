-- Mails mit vollem Inhalt speichern (Wunsch vom 21.09.2026): Bisher entstanden
-- Betreff und Text erst beim Versand in den Edge Functions und waren danach weg.
-- Ein Entwurf wartet auf die Freigabe, eine versendete Mail bleibt als Protokoll
-- nachlesbar, ein Fehlversuch geht nicht mehr verloren.

create table if not exists public.mails (
  id uuid primary key default gen_random_uuid(),
  typ text not null check (typ in ('mahnung', 'nebenkostenabrechnung', 'uebergabe', 'kuendigungsbestaetigung')),
  status text not null default 'entwurf' check (status in ('entwurf', 'gesendet', 'fehler')),
  betreff text not null,
  text text not null default '',
  html text,
  empfaenger text[] not null default '{}',
  kopie text[] not null default '{}',
  anhang_pfad text,
  anhang_name text,
  mietvertrag_id uuid references public.mietvertrag(id) on delete set null,
  immobilie_id uuid references public.immobilien(id) on delete set null,
  -- Alles, was der spaetere Versand aus dem Entwurf heraus noch braucht.
  nutzlast jsonb,
  fehler text,
  erstellt_am timestamptz not null default now(),
  erstellt_von uuid,
  gesendet_am timestamptz
);

comment on table public.mails is 'Vorbereitete, versendete und fehlgeschlagene Mails mit vollem Inhalt.';

create index if not exists mails_erstellt_am_idx on public.mails (erstellt_am desc);
create index if not exists mails_status_idx on public.mails (status);

alter table public.mails enable row level security;

drop policy if exists "Only admin can access mails" on public.mails;
create policy "Only admin can access mails"
  on public.mails
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
