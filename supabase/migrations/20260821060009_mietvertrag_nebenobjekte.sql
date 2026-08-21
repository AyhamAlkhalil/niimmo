-- Ein Vertrag kann mehrere Einheiten umfassen: Wohnung + Garage, Wohnung + Stellplatz.
-- mietvertrag.einheit_id bleibt als Hauptobjekt bestehen, damit nichts bricht.
create type public.objektrolle as enum ('hauptobjekt','nebenobjekt');

create table public.mietvertrag_einheiten (
  mietvertrag_id uuid not null references public.mietvertrag(id) on delete cascade,
  einheit_id     uuid not null references public.einheiten(id)   on delete restrict,
  rolle          public.objektrolle not null default 'nebenobjekt',
  teilmiete      numeric(10,2),
  bemerkung      text,
  erstellt_am    timestamptz not null default now(),
  primary key (mietvertrag_id, einheit_id)
);

comment on table public.mietvertrag_einheiten is
  'Zusaetzlich mitvermietete Einheiten. Das Hauptobjekt steht weiterhin in mietvertrag.einheit_id.';
comment on column public.mietvertrag_einheiten.teilmiete is
  'Auf diese Einheit entfallender Mietanteil, sofern im Vertrag gesondert ausgewiesen.';

create index mietvertrag_einheiten_einheit on public.mietvertrag_einheiten (einheit_id);

alter table public.mietvertrag_einheiten enable row level security;

create policy "Authenticated users can read mietvertrag_einheiten"
  on public.mietvertrag_einheiten for select to authenticated using (true);
create policy "Only admin can insert mietvertrag_einheiten"
  on public.mietvertrag_einheiten for insert with check (is_admin(auth.uid()));
create policy "Only admin can update mietvertrag_einheiten"
  on public.mietvertrag_einheiten for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
create policy "Only admin can delete mietvertrag_einheiten"
  on public.mietvertrag_einheiten for delete using (is_admin(auth.uid()));

-- Genau ein Hauptobjekt je Vertrag, falls die Tabelle es doch mitfuehrt
create unique index mietvertrag_einheiten_ein_hauptobjekt
  on public.mietvertrag_einheiten (mietvertrag_id)
  where rolle = 'hauptobjekt';
