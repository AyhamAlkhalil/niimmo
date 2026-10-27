-- 22.10.2026: zwei Warnungen des Supabase-Advisors, die seit Monaten offen standen.
--
-- 1) function_search_path_mutable: 31 Funktionen in public liefen mit dem search_path
--    des Aufrufers — bei SECURITY DEFINER die bekannte Lücke, über ein untergeschobenes
--    Schema fremde Tabellen oder Operatoren unterzuschieben. Fest auf public gesetzt.
--    Geprüft am 22.10.2026: Keine der Funktionen nutzt etwas aus dem Schema extensions
--    (pgcrypto, uuid-ossp, pgjwt); pg_trgm (similarity) und vector liegen in public,
--    ts_rank/websearch_to_tsquery in pg_catalog. Das Verhalten bleibt gleich.
--
-- 2) anon_security_definer_function_executable: Trigger-Funktionen waren für anon und
--    authenticated ausführbar. Ein Trigger feuert auch ohne EXECUTE-Recht des Auslösers
--    (am 22.10.2026 an der Live-DB in einer zurückgerollten Transaktion geprüft:
--    execute_recht=f, Trigger trotzdem ausgeführt). Direkt aufrufen muss sie niemand.
--
-- Bewusst nicht angefasst: is_admin, has_role und is_hausmeister bleiben für anon
-- ausführbar — 42 RLS-Policies für die Rolle public rufen sie auf; ohne das Recht
-- bekäme anon statt einer leeren Antwort einen Fehler.

-- 1) Fester search_path
alter function public.calculate_zeitanteil(position_von date, position_bis date, abrechnungs_von date, abrechnungs_bis date) set search_path = public;
alter function public.hybrid_search(query_text text, query_embedding vector, match_count integer, full_text_weight double precision, semantic_weight double precision, rrf_k integer) set search_path = public;
alter function public.rpc_agent_all_tenants(p_status text) set search_path = public;
alter function public.rpc_agent_contract_history(p_search text) set search_path = public;
alter function public.rpc_agent_documents(p_search text) set search_path = public;
alter function public.rpc_agent_dunning_summary() set search_path = public;
alter function public.rpc_agent_find_tenants(p_search text) set search_path = public;
alter function public.rpc_agent_insurance(p_search text) set search_path = public;
alter function public.rpc_agent_loan_details(p_search text) set search_path = public;
alter function public.rpc_agent_loans() set search_path = public;
alter function public.rpc_agent_market_data() set search_path = public;
alter function public.rpc_agent_meter_history(p_search text, p_limit integer) set search_path = public;
alter function public.rpc_agent_meter_readings(p_search text) set search_path = public;
alter function public.rpc_agent_nebenkosten(p_search text, p_year integer) set search_path = public;
alter function public.rpc_agent_outstanding(p_search text) set search_path = public;
alter function public.rpc_agent_portfolio_summary() set search_path = public;
alter function public.rpc_agent_property_details(p_search text) set search_path = public;
alter function public.rpc_agent_property_units(p_search text) set search_path = public;
alter function public.rpc_agent_rent_received(p_year integer, p_month integer) set search_path = public;
alter function public.rpc_agent_revenue_by_property(p_year integer, p_month integer) set search_path = public;
alter function public.rpc_agent_tenant_balance(p_search text, p_mieter_id uuid) set search_path = public;
alter function public.rpc_agent_tenant_contacts(p_search text) set search_path = public;
alter function public.rpc_agent_tenant_deposit(p_search text, p_mieter_id uuid) set search_path = public;
alter function public.rpc_agent_tenant_payments(p_mieter_id uuid, p_search text, p_year integer, p_month integer) set search_path = public;
alter function public.rpc_agent_unassigned_payments(p_limit integer) set search_path = public;
alter function public.rpc_agent_upcoming_endings(p_months integer) set search_path = public;
alter function public.rpc_agent_vacancies() set search_path = public;
alter function public.rpc_agent_whatsapp(p_search text, p_limit integer) set search_path = public;
alter function public.set_updated_at_activity_logs() set search_path = public;
alter function public.update_kaution_ist() set search_path = public;
alter function public.update_updated_at_blacklist() set search_path = public;

-- 2) Trigger-Funktionen nicht mehr direkt ausführbar
revoke execute on function public.auto_set_beendet_status() from public, anon, authenticated;
revoke execute on function public.check_contract_status_on_update() from public, anon, authenticated;
revoke execute on function public.create_ruecklastschrift_forderung() from public, anon, authenticated;
revoke execute on function public.reset_deposit_status_on_payment_delete() from public, anon, authenticated;
revoke execute on function public.set_angespannter_markt() from public, anon, authenticated;
revoke execute on function public.set_faelligkeitsdatum_trigger() from public, anon, authenticated;
revoke execute on function public.set_updated_at_activity_logs() from public, anon, authenticated;
revoke execute on function public.set_updated_at_zahlungs_anomalien() from public, anon, authenticated;
revoke execute on function public.set_zugeordneter_monat_trigger() from public, anon, authenticated;
revoke execute on function public.setze_aktualisiert_am() from public, anon, authenticated;
revoke execute on function public.setze_mieterhoehung_aktualisiert_am() from public, anon, authenticated;
revoke execute on function public.update_deposit_status_on_payment() from public, anon, authenticated;
revoke execute on function public.update_forderungen_on_rent_change() from public, anon, authenticated;
revoke execute on function public.update_kaution_ist() from public, anon, authenticated;
revoke execute on function public.update_updated_at_blacklist() from public, anon, authenticated;
revoke execute on function public.update_updated_at_column() from public, anon, authenticated;
