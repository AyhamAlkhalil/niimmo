-- Geführter Ablauf für neue Mietverträge (20.10.2026): Der Entwurf merkt sich
-- den Schritt, in dem zuletzt gespeichert wurde. „Fortsetzen" auf der
-- Einheitskarte steigt dort wieder ein.

alter table public.mietvertrag_entwuerfe
  add column if not exists schritt text
    check (schritt is null or schritt in ('grundlagen', 'mieter', 'miete', 'mietsache', 'betriebskosten', 'vereinbarungen', 'pruefen', 'start'));

comment on column public.mietvertrag_entwuerfe.schritt is 'Zuletzt bearbeiteter Schritt des Ablaufs „Neuer Mietvertrag".';
