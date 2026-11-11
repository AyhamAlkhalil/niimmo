-- Kundenwunsch 11.11.2026: Die Vermietung einer leeren Einheit ist ein Prozess mit Zwischenständen —
-- zuerst der Mieter, dann Miete und Mietbeginn vorgemerkt, den Mietvertrag später. Die Einheit zeigt,
-- wie weit der Vorgang ist.
--
-- `schritt` sagt, wo der Ablauf beim nächsten Öffnen weitergeht; wer zurückblättert und speichert, setzt ihn
-- zurück. Die Stufen an der Einheit („Miete vorgemerkt“) dürfen dadurch nicht wieder offen erscheinen.
-- Deshalb merkt sich der Entwurf zusätzlich den weitesten erreichten Schritt.
alter table public.mietvertrag_entwuerfe add column if not exists weitester_schritt text;

comment on column public.mietvertrag_entwuerfe.weitester_schritt is
  'Weitester im Ablauf gespeicherte Schritt (SchrittId); zeigt den Stand der Vermietung an der Einheit.';

-- Bestehende Entwürfe: Der zuletzt gespeicherte Schritt ist die beste Schätzung. In der alten Reihenfolge kam
-- „Grundlagen“ vor „Miete“ — wer dort stand, hatte die Miete noch nicht gesehen (Review 11.11.2026).
update public.mietvertrag_entwuerfe
   set weitester_schritt = case when schritt = 'grundlagen' then 'mieter' else schritt end
 where weitester_schritt is null;
