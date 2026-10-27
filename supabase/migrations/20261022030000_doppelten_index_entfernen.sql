-- 22.10.2026: Supabase-Advisor duplicate_index. Beide Indizes waren identisch
-- (btree auf mietvertrag.einheit_id), kein Constraint hängt an ihnen. Behalten wird
-- idx_mietvertrag_einheit_id, dessen Name zur Tabelle passt. Er muss vorhanden sein — in einer
-- neu aufgebauten Umgebung zuerst prüfen, sonst fehlt danach der Index auf einheit_id.
drop index if exists public.idx_mietvertraege_einheit;
