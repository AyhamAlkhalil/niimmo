-- Doppelte Fremdschluessel auf mietvertrag bereinigen.
--
-- dokumente und mietforderungen tragen je zwei FKs auf dieselbe Spalte
-- (mietvertrag_id -> mietvertrag.id). Zwei Folgen:
--   1. dokumente_mietvertrag_id_fkey hat kein ON DELETE CASCADE. Der restriktive
--      FK gewinnt, deshalb schlaegt das Loeschen eines Mietvertrags mit Dokumenten
--      mit SQLSTATE 23503 fehl - aktuell bei 1401 verknuepften Dokumenten.
--   2. PostgREST meldet die Beziehung als mehrdeutig (PGRST201), sobald jemand
--      dokumente(...) oder mietforderungen(...) einbettet.
--
-- Behalten wird jeweils die Variante mit ON DELETE CASCADE, benannt nach der
-- Supabase-Konvention <tabelle>_<spalte>_fkey.

-- dokumente: restriktiven FK entfernen, CASCADE-Variante auf den Standardnamen
alter table public.dokumente
  drop constraint if exists dokumente_mietvertrag_id_fkey;

alter table public.dokumente
  rename constraint fk_dokumente_mietvertrag to dokumente_mietvertrag_id_fkey;

-- mietforderungen: beide FKs sind identisch (ON DELETE CASCADE), Duplikat entfernen
alter table public.mietforderungen
  drop constraint if exists fk_mietvertrag_id_on_mietforderungen;
