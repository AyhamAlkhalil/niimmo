-- 28.10.2026: Telegram-Assistent entfernt, Kautionsstatus-Trigger entfallen.
--
-- Der Telegram-Assistent („Chilla“, Edge Function agent-api) scheiterte seit Juli 2026 am
-- ungültigen OpenAI-Schlüssel und wird laut Kunde nicht mehr gebraucht. Mit ihm entfallen seine
-- Datenbankfunktionen rpc_agent_* (27, nur für service_role ausführbar, sonst ungenutzt). Sie
-- rechneten den Rückstand zudem anders als der Kanon (calculateMietvertragRueckstand). Die
-- Protokolltabelle agent_logs bleibt mit ihren Daten stehen.
--
-- Kautionsstatus: kaution_status setzten zwei Trigger — nur beim Einfügen, nur bei Beginn ab
-- 2025, „gezahlt“ bei jeder Kautionsbuchung (auch Teilzahlung oder Rückzahlung), beim Löschen
-- „offen“ trotz von Hand gedecktem Ist; Umkategorisieren blieb unbeachtet. Live wichen 71
-- Verträge (44 von 98 laufenden) von „Ist >= Soll“ ab. Gelesen hat den Status nur der
-- Assistent. Die beiden Trigger entfallen; die Spalte bleibt als Altbestand stehen.

do $entfernen$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like 'rpc\_agent\_%'
  loop
    -- ohne cascade: Hinge noch etwas daran, bricht die Migration ab statt still mitzulöschen
    execute format('drop function %s', v_fn);
  end loop;
end
$entfernen$;

drop trigger if exists update_deposit_status_trigger on public.zahlungen;
drop trigger if exists reset_deposit_status_trigger on public.zahlungen;
drop function if exists public.update_deposit_status_on_payment();
drop function if exists public.reset_deposit_status_on_payment_delete();

comment on table public.agent_logs is
  'Archiv: Protokoll des Telegram-Assistenten, der am 28.10.2026 entfernt wurde. Es schreibt nichts mehr hinein.';

comment on column public.mietvertrag.kaution_status is
  'Altbestand, seit 28.10.2026 nicht mehr nachgezogen und nicht ausgewertet. Maßgeblich sind kaution_ist (Grundwert + Kautionsbuchungen) und kaution_betrag.';

notify pgrst, 'reload schema';
