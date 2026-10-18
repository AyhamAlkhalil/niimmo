-- Mietvertragsentwuerfe (Wunsch vom 16.10.2026): „Neuen Mietvertrag anlegen"
-- legte Mieter und Vertrag sofort aktiv an der Einheit an. Beim Test mit einer
-- Selbstauskunft entstand so eine echte Monatsforderung fuer eine leere Wohnung.
-- Ein neuer Vertrag ist jetzt zuerst ein Entwurf mit PDF-Vorschau; erst das
-- Aktivieren nach der Unterschrift legt Mieter, Vertrag und Forderungen an.
--
-- Entwuerfe liegen bewusst in einer eigenen Tabelle und nicht als weiterer
-- Status in `mietvertrag`: Zahlungszuordnung, Auswertungen, Chat und Mahnwesen
-- lesen `mietvertrag` vielfach ohne Statusfilter und wuerden einen Entwurf
-- mitzaehlen.

-- ─── 1. Objektangaben, die in jeden Vertrag uebernommen werden ──────────────
-- Bisher nahm der Generator immer eine Zentralheizung an.
alter table public.immobilien
  add column if not exists heizungsart text
    check (heizungsart in ('zentral', 'etage', 'fernwaerme', 'keine')),
  add column if not exists warmwasser text
    check (warmwasser in ('zentral', 'dezentral')),
  add column if not exists schliessanlage_art public.schliessanlage_art,
  add column if not exists gemeinschaftseinrichtungen text[],
  add column if not exists gesamtwohnflaeche numeric(10, 2)
    check (gesamtwohnflaeche is null or gesamtwohnflaeche > 0);

comment on column public.immobilien.heizungsart is 'zentral | etage | fernwaerme | keine; steuert § 4 und § 24 des Mietvertrags.';
comment on column public.immobilien.warmwasser is 'zentral | dezentral (Durchlauferhitzer, Boiler in der Wohnung).';
comment on column public.immobilien.gemeinschaftseinrichtungen is 'Zur Mitbenutzung ueberlassene Einrichtungen, z. B. Waschkeller, Fahrradkeller.';
comment on column public.immobilien.gesamtwohnflaeche is 'Bezugsgroesse der Umlage nach Wohnflaeche, wird im Vertrag genannt.';

-- ─── 2. Herkunft am fertigen Vertrag festhalten ─────────────────────────────
-- Welche Werte aus dem Vorvertrag stammen, soll auch nach dem Aktivieren
-- erkennbar bleiben.
alter table public.mietvertrag
  add column if not exists vorvertrag_id uuid references public.mietvertrag(id) on delete set null,
  add column if not exists werte_herkunft jsonb
    check (werte_herkunft is null or jsonb_typeof(werte_herkunft) = 'object');

create index if not exists mietvertrag_vorvertrag_id_idx on public.mietvertrag (vorvertrag_id);

comment on column public.mietvertrag.vorvertrag_id is 'Vertrag derselben Einheit, aus dem Werte uebernommen wurden.';
comment on column public.mietvertrag.werte_herkunft is 'Feld -> Herkunft (vorvertrag, objekt, einheit, selbstauskunft, berechnet).';

-- ─── 3. Entwuerfe ───────────────────────────────────────────────────────────
create table if not exists public.mietvertrag_entwuerfe (
  id uuid primary key default gen_random_uuid(),
  einheit_id uuid not null references public.einheiten(id) on delete cascade,
  vorvertrag_id uuid references public.mietvertrag(id) on delete set null,
  -- Vollstaendige Vertragsdaten in der Form, die der PDF-Generator erwartet.
  daten jsonb not null check (jsonb_typeof(daten) = 'object'),
  -- Interessenten: Mitmieter und Mitbewohner, ggf. mit Verweis auf einen
  -- bestehenden Mieterdatensatz. Mieter entstehen erst beim Aktivieren.
  personen jsonb not null default '[]'::jsonb check (jsonb_typeof(personen) = 'array'),
  herkunft jsonb not null default '{}'::jsonb check (jsonb_typeof(herkunft) = 'object'),
  -- Abgelegte Dateien (Entwurfs-PDF, Selbstauskunft): {pfad, titel, kategorie, dateityp, groesse_bytes}
  dateien jsonb not null default '[]'::jsonb check (jsonb_typeof(dateien) = 'array'),
  erstellt_von uuid,
  erstellt_am timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now()
);

comment on table public.mietvertrag_entwuerfe is 'Mietvertraege vor der Unterschrift. Zaehlen nirgends mit; erst das Aktivieren legt den Vertrag an.';

create index if not exists mietvertrag_entwuerfe_einheit_id_idx on public.mietvertrag_entwuerfe (einheit_id);
create index if not exists mietvertrag_entwuerfe_vorvertrag_id_idx on public.mietvertrag_entwuerfe (vorvertrag_id);

create or replace function public.setze_aktualisiert_am()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.aktualisiert_am := now();
  return new;
end;
$$;

drop trigger if exists mietvertrag_entwuerfe_aktualisiert_am on public.mietvertrag_entwuerfe;
create trigger mietvertrag_entwuerfe_aktualisiert_am
  before update on public.mietvertrag_entwuerfe
  for each row execute function public.setze_aktualisiert_am();

-- Enthaelt Daten aus Selbstauskuenften: nur Admins, wie mieter und dokumente.
alter table public.mietvertrag_entwuerfe enable row level security;

drop policy if exists "Nur Admin darf Mietvertragsentwuerfe nutzen" on public.mietvertrag_entwuerfe;
create policy "Nur Admin darf Mietvertragsentwuerfe nutzen"
  on public.mietvertrag_entwuerfe
  for all
  to authenticated
  using (public.is_admin((select auth.uid())))
  with check (public.is_admin((select auth.uid())));

-- ─── 4. Forderungen nachholen ───────────────────────────────────────────────
-- Die Sollstellung (generate_monthly_mietforderungen) legt nur den laufenden
-- Monat an. Wird ein Entwurf erst nach Mietbeginn aktiviert, fehlten sonst die
-- Monate dazwischen. Berechnung wie dort: erster Monat taggenau anteilig.
create or replace function public.mietforderungen_nachholen(p_mietvertrag_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vertrag   record;
  v_monat     date;
  v_bis       date;
  v_betrag    numeric;
  v_tage      int;
  v_angelegt  int := 0;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'Nur Admins duerfen Forderungen anlegen';
  end if;

  select id, kaltmiete, betriebskosten, start_datum, ende_datum, kuendigungsdatum, status
    into v_vertrag
    from public.mietvertrag
   where id = p_mietvertrag_id;

  if not found then
    raise exception 'Mietvertrag % nicht gefunden', p_mietvertrag_id;
  end if;

  if v_vertrag.status not in ('aktiv', 'gekuendigt') or v_vertrag.start_datum is null then
    return 0;
  end if;

  v_monat := date_trunc('month', v_vertrag.start_datum)::date;
  v_bis   := date_trunc('month', current_date)::date;
  if v_vertrag.ende_datum is not null then
    v_bis := least(v_bis, date_trunc('month', v_vertrag.ende_datum)::date);
  end if;

  while v_monat <= v_bis loop
    v_betrag := coalesce(v_vertrag.kaltmiete, 0) + coalesce(v_vertrag.betriebskosten, 0);

    if v_monat = date_trunc('month', v_vertrag.start_datum)::date
       and extract(day from v_vertrag.start_datum) > 1 then
      v_tage   := extract(day from (v_monat + interval '1 month' - interval '1 day'))::int;
      v_betrag := round((v_betrag / v_tage::numeric)
                        * (v_tage - extract(day from v_vertrag.start_datum)::int + 1), 2);
    end if;

    if not exists (
      select 1 from public.mietforderungen
       where mietvertrag_id = v_vertrag.id
         and sollmonat = v_monat
         and coalesce(typ, 'Miete') = 'Miete'
    ) then
      insert into public.mietforderungen (mietvertrag_id, sollmonat, sollbetrag)
      values (v_vertrag.id, v_monat, v_betrag);
      v_angelegt := v_angelegt + 1;
    end if;

    v_monat := (v_monat + interval '1 month')::date;
  end loop;

  return v_angelegt;
end;
$$;

revoke all on function public.mietforderungen_nachholen(uuid) from public, anon;
grant execute on function public.mietforderungen_nachholen(uuid) to authenticated;
