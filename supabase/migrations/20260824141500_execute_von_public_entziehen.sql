-- Nachtrag zu 20260824140000.
--
-- Dort wurde EXECUTE nur "from anon, authenticated" entzogen. Das reicht nicht:
-- Postgres vergibt EXECUTE auf Funktionen standardmaessig an PUBLIC, und anon
-- erbt es darueber. In pg_proc.proacl sichtbar als Eintrag ohne Grantee:
--
--   =X/postgres | postgres=X/postgres | service_role=X/postgres
--    ^ das ist PUBLIC
--
-- Nach dem ersten Anlauf lieferten rpc_agent_all_tenants, rpc_agent_blacklist
-- und rpc_agent_outstanding dem anon-Key deshalb weiterhin Daten, und
-- generate_monthly_mietforderungen liess sich anonym ausfuehren und schrieb.
--
-- Richtig ist REVOKE ... FROM PUBLIC. service_role hat ein eigenes, explizites
-- Recht und behaelt es; zur Sicherheit wird es hier nochmal gesetzt.

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
  loop
    execute format('revoke execute on function %s from public', r.signatur);
    execute format('grant  execute on function %s to service_role', r.signatur);
  end loop;
end $$;

notify pgrst, 'reload schema';
