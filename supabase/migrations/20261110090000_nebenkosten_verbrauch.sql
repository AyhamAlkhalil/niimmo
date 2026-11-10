-- 10.11.2026: Verteilerschlüssel „nach tatsächlichem Verbrauch“.
--
-- Bis hierher kannte die Betriebskostenabrechnung nur Wohnfläche, Personentage und Einheit; ein Schlüssel
-- „verbrauch“ wurde still nach Wohnfläche gerechnet, und der Vertrag durfte ihn deshalb nicht nennen. Jetzt
-- trägt Schritt 2 der Abrechnung je Kostenart und Nutzungsperiode (Mietvertrag oder Leerstand) den erfassten
-- Verbrauch ein; der Anteil ist eigener Verbrauch durch Summe aller Perioden.
--
-- Eine Zeile gilt nur für genau diese Periode (Einheit, Beginn, Ende, Vertrag). Ändert sich ein Vertragsdatum,
-- passt sie nicht mehr, und die Abrechnung sperrt, bis der Verbrauch neu eingetragen ist — ein Wert für einen
-- anderen Zeitraum wird nie still übernommen.
create table public.nebenkosten_verbrauch (
  id uuid primary key default gen_random_uuid(),
  immobilie_id uuid not null references public.immobilien(id) on delete cascade,
  abrechnungsjahr integer not null check (abrechnungsjahr between 2000 and 2100),
  -- Kostenart der Abrechnung: BetrKV-Kategorie („wasserversorgung“) oder custom_<nebenkostenart_id>
  kategorie text not null check (length(btrim(kategorie)) > 0),
  einheit_id uuid not null references public.einheiten(id) on delete cascade,
  -- null = Leerstand; dessen Verbrauch trägt der Eigentümer
  mietvertrag_id uuid references public.mietvertrag(id) on delete cascade,
  zeitraum_von date not null,
  zeitraum_bis date not null,
  verbrauch numeric not null check (verbrauch >= 0),
  erfasst_von uuid default auth.uid(),
  erstellt_am timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  constraint nebenkosten_verbrauch_zeitraum check (zeitraum_bis >= zeitraum_von),
  constraint nebenkosten_verbrauch_eindeutig unique (abrechnungsjahr, kategorie, einheit_id, zeitraum_von)
);

create index nebenkosten_verbrauch_objekt_jahr on public.nebenkosten_verbrauch (immobilie_id, abrechnungsjahr);

comment on table public.nebenkosten_verbrauch is
  'Erfasster Verbrauch je Kostenart und Nutzungsperiode für den Verteilerschlüssel „verbrauch“ (seit 10.11.2026).';

alter table public.nebenkosten_verbrauch enable row level security;

-- Wie alle Tabellen der Betriebskostenabrechnung: nur Admins
create policy "Only admin can access nebenkosten_verbrauch"
  on public.nebenkosten_verbrauch
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create trigger update_nebenkosten_verbrauch_aktualisiert_am
  before update on public.nebenkosten_verbrauch
  for each row execute function public.update_updated_at_column();
