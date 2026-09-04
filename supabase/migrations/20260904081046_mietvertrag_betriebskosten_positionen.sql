-- Aufschluesselung der Betriebskosten-Vorauszahlung je BetrKV-Position.
--
-- Die Hausvorlage weist im Vertrag jede Position mit ihrem monatlichen Anteil
-- aus und darunter die Summe. Bisher kannte das System nur den Gesamtbetrag
-- (mietvertrag.betriebskosten), die Aufstellung liess sich also nicht drucken.
--
-- Bewusst als Schnappschuss: Bezeichnung und Verteilerschluessel werden
-- mitgespeichert und nicht zur Laufzeit aus nebenkostenarten nachgeladen.
-- Ein unterschriebener Vertrag muss auch dann noch identisch erzeugbar sein,
-- wenn die Kostenarten der Immobilie spaeter geaendert werden.
--
-- Form: [{"nummer":"2.1","bezeichnung":"...","schluessel":"qm",
--         "umgelegt":true,"betrag":17.00}, ...]
alter table public.mietvertrag
  add column if not exists betriebskosten_positionen jsonb;

comment on column public.mietvertrag.betriebskosten_positionen is
  'Schnappschuss der Betriebskostenaufstellung fuer § 4 des Mietvertrags. '
  'Array aus {nummer, bezeichnung, schluessel, umgelegt, betrag}. '
  'Die Summe der Betraege umgelegter Positionen muss mietvertrag.betriebskosten entsprechen.';

-- Nur ein Array oder gar nichts. Verhindert, dass ein Objekt oder ein
-- Skalar hineinlaeuft und der Generator beim Lesen bricht.
alter table public.mietvertrag
  drop constraint if exists mietvertrag_betriebskosten_positionen_ist_array;
alter table public.mietvertrag
  add constraint mietvertrag_betriebskosten_positionen_ist_array
  check (betriebskosten_positionen is null
         or jsonb_typeof(betriebskosten_positionen) = 'array');
