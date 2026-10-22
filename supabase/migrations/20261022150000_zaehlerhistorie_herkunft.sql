-- 22.10.2026: Herkunft einer Ablesung in der Zählerhistorie.
--
-- Die Übergabe schreibt jede Ablesung in zaehlerstand_historie (quelle „Übergabe (Einzug)" bzw.
-- „Übergabe (Auszug)"), aber ohne Bezug: zu welchem Vertrag, aus welchem Protokoll, nach welchem Foto,
-- von Hand eingetragen oder aus dem Foto erkannt. In der Zähler-Historie erschienen diese Einträge
-- deshalb als „Manuell", und ohne Zählernummer rechnete die Verbrauchsspalte nicht.
--
-- Alle neuen Spalten sind optional. Die übrigen Schreiber (Zählerverwaltung, Vertragsdetails, agent-api)
-- bleiben unverändert und lassen sie leer.

alter table public.zaehlerstand_historie
  add column if not exists mietvertrag_id uuid references public.mietvertrag(id) on delete set null,
  add column if not exists protokoll_pfad text,
  add column if not exists foto_pfad text,
  add column if not exists erfassung text,
  add column if not exists erkannter_stand numeric;

alter table public.zaehlerstand_historie
  drop constraint if exists zaehlerstand_historie_erfassung_check;
alter table public.zaehlerstand_historie
  add constraint zaehlerstand_historie_erfassung_check
  check (erfassung is null or erfassung in ('hand', 'foto', 'foto_korrigiert'));

comment on column public.zaehlerstand_historie.mietvertrag_id is
  'Vertrag, zu dessen Ein- oder Auszug die Ablesung gehört (Übergabe). Leer bei Ablesungen ohne Vertragsbezug.';
comment on column public.zaehlerstand_historie.protokoll_pfad is
  'Storage-Pfad (Bucket dokumente) des Übergabeprotokolls, in dem der Stand steht.';
comment on column public.zaehlerstand_historie.foto_pfad is
  'Storage-Pfad (Bucket dokumente) des Zählerfotos, nach dem der Stand erfasst wurde.';
comment on column public.zaehlerstand_historie.erfassung is
  'Wie der Stand entstand: hand (getippt), foto (aus dem Foto erkannt und übernommen), foto_korrigiert (erkannt, dann von Hand geändert).';
comment on column public.zaehlerstand_historie.erkannter_stand is
  'Stand, den die Erkennung aus dem Foto gelesen hat — bleibt zum Vergleich stehen, auch wenn von Hand korrigiert wurde.';

-- Für den Fremdschlüssel; die Einheit-Historie liest Übergaben je Vertrag
create index if not exists idx_zaehlerstand_historie_mietvertrag
  on public.zaehlerstand_historie (mietvertrag_id)
  where mietvertrag_id is not null;
