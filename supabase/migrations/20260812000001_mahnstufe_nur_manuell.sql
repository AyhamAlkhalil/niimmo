-- Automatische Mahnstufen-Erhoehung vollstaendig entfernen.
--
-- Hintergrund: Der taegliche Cron-Job `niimmo-check-mahnstufen` rief
-- `check_and_update_mahnstufen()` auf. Die Funktion erhoehte die Mahnstufe bei
-- JEDEM Lauf um 1, ohne das gesetzte `naechste_mahnung_am` je auszuwerten.
-- Ergebnis: nach drei Tagen stand jeder Vertrag mit irgendeiner offenen
-- Altforderung auf Maximalstufe 3 — am 12.08.2026 waren das 60 von 90 aktiven
-- Vertraegen, davon 32 ohne jeden Rueckstand (teilweise mehrere tausend Euro
-- ueberzahlt). Versendet wurde nie eine Mahnung; die Stufen waren reine
-- Cron-Artefakte.
--
-- Neue Regel: Die Mahnstufe steigt ausschliesslich beim tatsaechlichen
-- Mahnungsversand (Edge Function `send-mahnung`). Manuell ist nur das
-- Zuruecksetzen moeglich.

-- 1. Sicherung der bisherigen Werte (Rollback-Grundlage)
create table if not exists public.mahnstufe_backup_20260812 (
  mietvertrag_id      uuid primary key,
  mahnstufe           integer,
  letzte_mahnung_am   timestamptz,
  naechste_mahnung_am timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.mahnstufe_backup_20260812 enable row level security;

drop policy if exists "admin_read_mahnstufe_backup" on public.mahnstufe_backup_20260812;
create policy "admin_read_mahnstufe_backup" on public.mahnstufe_backup_20260812
  for select using (has_role(auth.uid(), 'admin'::app_role));

insert into public.mahnstufe_backup_20260812 (mietvertrag_id, mahnstufe, letzte_mahnung_am, naechste_mahnung_am)
select id, mahnstufe, letzte_mahnung_am, naechste_mahnung_am
from public.mietvertrag
where coalesce(mahnstufe, 0) > 0
   or letzte_mahnung_am is not null
   or naechste_mahnung_am is not null
on conflict (mietvertrag_id) do nothing;

-- 2. Cron-Job abbestellen
select cron.unschedule('niimmo-check-mahnstufen');

-- 3. Automatik-Funktion entfernen
drop function if exists public.check_and_update_mahnstufen();

-- 4. Cron-Artefakte zuruecksetzen.
--    Nur die vom Job hochgezaehlten Stufe-3-Verträge; die drei gekuendigten
--    Altfaelle auf Stufe 1 bleiben unangetastet.
update public.mietvertrag mv
set mahnstufe = 0,
    letzte_mahnung_am = null,
    naechste_mahnung_am = null
from public.mahnstufe_backup_20260812 b
where b.mietvertrag_id = mv.id
  and b.mahnstufe = 3
  and mv.mahnstufe = 3;
