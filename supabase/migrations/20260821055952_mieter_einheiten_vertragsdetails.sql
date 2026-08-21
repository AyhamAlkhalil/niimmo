-- Mieterseite: Anrede, juristische Person, Anschrift vor Einzug
create type public.anrede as enum ('Herr','Frau','Divers','Firma');

alter table public.mieter
  add column anrede          public.anrede,
  add column ist_unternehmen boolean not null default false,
  add column firmenname      text,
  add column vertreten_durch text,
  add column strasse         text,
  add column hausnummer      text,
  add column plz             text,
  add column ort             text;

comment on column public.mieter.firmenname is
  'Bei juristischen Personen. Verhindert, dass der Firmenname per split auf vorname/nachname zerlegt wird.';
comment on column public.mieter.strasse is
  'Anschrift VOR Einzug. Im Vertragsrubrum als "zur Zeit wohnhaft in" gedruckt.';

alter table public.mieter
  add constraint mieter_firma_braucht_firmenname
    check (ist_unternehmen = false or coalesce(btrim(firmenname), '') <> '');

-- Mieterrolle und Reihenfolge. Das Enum mieterrolle existierte bereits ungenutzt.
alter table public.mietvertrag_mieter
  add column rolle    public.mieterrolle not null default 'Hauptmieter',
  add column position smallint not null default 1;

comment on column public.mietvertrag_mieter.position is
  'Reihenfolge im Vertragsrubrum und im Unterschriftsblock.';

-- Mietsache genauer beschreiben
alter table public.einheiten
  add column bezeichnung   text,
  add column anzahl_zimmer numeric(3,1),
  add column raeume        jsonb not null default '{}'::jsonb,
  add column nebenraeume   text,
  add column ausstattung   text,
  add column einbaukueche  boolean not null default false;

comment on column public.einheiten.bezeichnung is
  'Einheitenkennung wie im Vertrag, z. B. "WE 12". Bisher wurde dafuer faelschlich die Spalte zaehler gelesen.';
comment on column public.einheiten.raeume is
  'Raumaufstellung, z. B. {"zimmer":3.5,"kueche":1,"bad":1,"gaeste_wc":1,"balkon":1,"keller":1}.';
comment on column public.einheiten.anzahl_zimmer is
  'Zimmerzahl fuer Paragraf 1 Mietgegenstand. Halbe Zimmer moeglich.';

create unique index einheiten_bezeichnung_je_immobilie
  on public.einheiten (immobilie_id, bezeichnung)
  where bezeichnung is not null;
