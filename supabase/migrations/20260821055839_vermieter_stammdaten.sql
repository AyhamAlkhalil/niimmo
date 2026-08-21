-- Vermieter als echte Vertragspartei
create type public.vertretungsart as enum ('einzel', 'gesamt');

create table public.vermieter (
  id                  uuid primary key default gen_random_uuid(),
  firmenname          text not null,
  rechtsform          text,
  strasse             text not null,
  hausnummer          text not null,
  plz                 text not null,
  ort                 text not null,
  vertreten_durch     text[] not null default '{}',
  vertretung_art      public.vertretungsart not null default 'gesamt',
  registergericht     text,
  handelsregister     text,
  steuernummer        text,
  ust_id              text,
  telefon             text,
  fax                 text,
  email               text,
  miet_iban           text,
  miet_bic            text,
  kaution_iban        text,
  kaution_bic         text,
  glaeubiger_id       text,
  ist_standard        boolean not null default false,
  stammdaten_geprueft boolean not null default false,
  erstellt_am         timestamptz not null default now(),
  aktualisiert_am     timestamptz not null default now()
);

comment on table public.vermieter is
  'Vermietende Rechtstraeger. Ersetzt die hartkodierten Stammdaten im Frontend.';
comment on column public.vermieter.stammdaten_geprueft is
  'false = Angaben stammen aus Code/Altvertraegen und sind noch nicht gegen den Handelsregisterauszug geprueft. Der Vertragsgenerator warnt, solange false.';
comment on column public.vermieter.vertretung_art is
  'Bestimmt, wie viele Unterschriftslinien der Vertrag auf Vermieterseite braucht.';
comment on column public.vermieter.kaution_iban is
  'Getrenntes Kautionskonto nach Paragraf 551 Abs. 3 BGB. Leer lassen, wenn keins existiert.';

create unique index vermieter_ein_standard on public.vermieter (ist_standard) where ist_standard;

alter table public.vermieter enable row level security;

create policy "Authenticated users can read vermieter"
  on public.vermieter for select to authenticated using (true);
create policy "Only admin can insert vermieter"
  on public.vermieter for insert with check (is_admin(auth.uid()));
create policy "Only admin can update vermieter"
  on public.vermieter for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Only admin can delete vermieter"
  on public.vermieter for delete using (is_admin(auth.uid()));

create trigger vermieter_aktualisiert_am
  before update on public.vermieter
  for each row execute function public.update_updated_at_column();

alter table public.immobilien
  add column vermieter_id uuid references public.vermieter(id) on delete restrict;

comment on column public.immobilien.vermieter_id is
  'Vermietender Rechtstraeger dieses Objekts. NULL = Standardvermieter.';

alter table public.immobilien
  add column strasse    text,
  add column hausnummer text,
  add column plz        text,
  add column ort        text,
  add column ortsteil   text;

comment on column public.immobilien.adresse is
  'ALT: unstrukturierte Adresse. Neue Felder strasse/hausnummer/plz/ort verwenden.';

create type public.energieausweis_typ as enum ('bedarf', 'verbrauch');

alter table public.immobilien
  add column energieausweis_typ            public.energieausweis_typ,
  add column energie_kennwert              numeric(8,2),
  add column energietraeger                text,
  add column energieausweis_ausgestellt_am date,
  add column energieausweis_gueltig_bis    date,
  add column energieeffizienzklasse        text,
  add column heizkosten_schluessel         text not null default '70/30';

comment on column public.immobilien.heizkosten_schluessel is
  'Verteilung Verbrauch/Grundkosten nach Paragrafen 7-9 HeizkostenV, z. B. 70/30.';
