-- Anonymen Zugriff auf personenbezogene Daten schliessen.
--
-- Befund (am 24.08.2026 gegen die Live-API geprueft): Mit dem anon-Key, der im
-- Frontend-Bundle steht und damit jedem Besucher vorliegt, waren ohne Login
-- moeglich:
--
--   GET    /rest/v1/mieter?select=vorname,telnr        -> 200, echte Daten
--   PATCH  /rest/v1/mieter?id=eq.<uuid>                -> 200 (Schreibrecht)
--   DELETE /rest/v1/einheiten?id=eq.<uuid>             -> 204 (Loeschrecht)
--   POST   /rest/v1/rpc/rpc_agent_blacklist            -> 200, vollstaendige Liste
--
-- Zwei unabhaengige Ursachen:
--
-- 1. Die Policy "Policy_documents" liegt als FOR ALL TO anon, authenticated
--    USING (true) auf mieter, einheiten, immobilien und mietvertrag_mieter.
--    FOR ALL bedeutet auch INSERT/UPDATE/DELETE. Der Name legt nahe, dass sie
--    urspruenglich fuer Dokumente gedacht war.
--
-- 2. Die rpc_agent_*-Funktionen sind SECURITY DEFINER und umgehen RLS damit
--    vollstaendig. Ueber sie waren auch Tabellen erreichbar, deren RLS korrekt
--    gesperrt ist - etwa Rueckstaende aus mietvertrag und zahlungen.
--
-- Beides trifft personenbezogene Daten Dritter (Mietername, Telefonnummer,
-- Geburtsdatum, Anschrift).

-- ── 1. RLS-Policies auf angemeldete Nutzer beschraenken ───────────────────
alter policy "Policy_documents" on public.mieter             to authenticated;
alter policy "Policy_documents" on public.einheiten          to authenticated;
alter policy "Policy_documents" on public.immobilien         to authenticated;
alter policy "Policy_documents" on public.mietvertrag_mieter to authenticated;

alter policy "Public access csv_uploads" on public.csv_uploads to authenticated;

-- system_logs waren fuer jeden lesbar (TO public USING true)
alter policy "Allow read access to system logs" on public.system_logs to authenticated;

-- ── 2. EXECUTE auf SECURITY-DEFINER-Funktionen entziehen ──────────────────
-- Betrifft die 27 rpc_agent_*-Funktionen und sechs schreibende
-- Wartungsfunktionen. Aufgerufen werden sie ausschliesslich von der agent-api
-- und den Cron-Jobs, beide mit dem service_role-Key - der behaelt sein Recht.
-- Das Frontend ruft keine davon auf (einziger .rpc()-Aufruf dort:
-- replace_kostenposition_anteile).
--
-- Ausgenommen bleiben has_role, is_admin und is_hausmeister: Sie werden in
-- RLS-Policies ausgewertet und muessen fuer authenticated aufrufbar bleiben.
-- Trigger-Funktionen (RETURNS trigger) bleiben ebenfalls unangetastet, sie
-- lassen sich ohnehin nicht direkt aufrufen.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signatur
    from   pg_proc p
    join   pg_namespace n on n.oid = p.pronamespace
    where  n.nspname = 'public'
      and  p.prosecdef
      and  pg_get_function_result(p.oid) <> 'trigger'
      and  p.proname not in ('has_role', 'is_admin', 'is_hausmeister')
      and  has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.signatur);
  end loop;
end $$;

notify pgrst, 'reload schema';
