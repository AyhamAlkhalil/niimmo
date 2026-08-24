-- mietvertrag_einheiten hatte einen zusammengesetzten Primaerschluessel aus
-- genau zwei Fremdschluesseln. PostgREST erkennt darin eine m:n-Beziehung und
-- konnte danach fuer 'mietvertrag <-> einheiten' nicht mehr entscheiden, ob der
-- direkte Fremdschluessel oder der Umweg ueber diese Tabelle gemeint ist:
-- jedes Embed ohne expliziten Hint antwortete mit HTTP 300 (PGRST201).
--
-- Betroffen waren neun bestehende Abfragen, darunter die Uebergabeseite, die
-- globale Suche und fuenf Edge Functions (Mahnung, Mieterhoehung, Uebergabe,
-- Zahlungsverarbeitung).
--
-- Ein eigener Primaerschluessel nimmt der Tabelle dieses Muster. Die Eindeutigkeit
-- des Paares bleibt ueber einen UNIQUE-Constraint erhalten.

alter table public.mietvertrag_einheiten
  drop constraint mietvertrag_einheiten_pkey;

alter table public.mietvertrag_einheiten
  add column id uuid not null default gen_random_uuid();

alter table public.mietvertrag_einheiten
  add constraint mietvertrag_einheiten_pkey primary key (id);

create unique index mietvertrag_einheiten_paar
  on public.mietvertrag_einheiten (mietvertrag_id, einheit_id);

comment on table public.mietvertrag_einheiten is
  'Zusaetzlich mitvermietete Einheiten. Das Hauptobjekt steht weiterhin in mietvertrag.einheit_id. Eigener Primaerschluessel, damit PostgREST hier keine m:n-Beziehung zwischen mietvertrag und einheiten ableitet.';

notify pgrst, 'reload schema';
