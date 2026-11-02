-- 02.11.2026: Wer Mahnung, Kündigung, Kündigungsbestätigung und Mieterhöhung unterzeichnet. Bis heute standen die
-- zwei Geschäftsführer fest in src/config/company.ts. Kundenwunsch: „auswählen zwischen mir, Dennis oder weiteren
-- Personen, die sich mit ihren Daten eintragen“ — eingetragen und geändert wird direkt im Auswahlfeld der Dialoge.
-- Zugeordnet zur Anmeldung wird über die E-Mail; deshalb klein geschrieben und eindeutig.

create table public.briefunterzeichner (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique
                 check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  kontaktname  text not null check (btrim(kontaktname) <> ''),
  unterschrift text not null check (btrim(unterschrift) <> ''),
  funktion     text not null check (btrim(funktion) <> ''),
  telefon      text not null check (btrim(telefon) <> ''),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.briefunterzeichner is
  'Wer Schreiben unterzeichnet: Rückfragenblock oben rechts, Name und Funktion unter dem Gruß. Vorbelegt ist, wessen Anmelde-E-Mail hier steht.';
comment on column public.briefunterzeichner.kontaktname is 'Rückfragenblock, z. B. „Herr Ayhan Yeyrek, M. Sc.“';
comment on column public.briefunterzeichner.unterschrift is 'Unter dem Gruß, z. B. „Ayhan Yeyrek (M. Sc.)“';

alter table public.briefunterzeichner enable row level security;

-- Wie das Benutzerverzeichnis: Telefon und E-Mail der Mitarbeiter nur für die Verwaltung
create policy "Admins lesen die Unterzeichner"
  on public.briefunterzeichner for select to authenticated using (is_admin(auth.uid()));
create policy "Admins pflegen die Unterzeichner"
  on public.briefunterzeichner for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create trigger briefunterzeichner_updated_at
  before update on public.briefunterzeichner
  for each row execute function public.update_updated_at_column();

-- Bisheriger Stand aus company.ts; Herr Yeyrek nach der Briefvorlage des Kunden
insert into public.briefunterzeichner (email, kontaktname, unterschrift, funktion, telefon) values
  ('yeyrek@niimmo.de', 'Herr Ayhan Yeyrek, M. Sc.', 'Ayhan Yeyrek (M. Sc.)', 'Geschäftsführer – CEO', '05138 - 600 72 71'),
  ('mikyas@niimmo.de', 'Herr Dennis Baris Mikyas', 'Dennis Mikyas', 'Geschäftsführer', '05138 - 600 72 72')
on conflict (email) do nothing;
