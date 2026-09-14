-- Benachrichtigungen nur noch, wenn eine Meldung erledigt ist (Wunsch vom 14.09.2026).
-- Neue Aufgabe, Zuweisung, Erwaehnung, Kommentar und sonstige Statuswechsel loesen
-- nichts mehr aus. Die Benachrichtigung geht an den Melder.

drop trigger if exists dev_tickets_benachrichtigung_neu on public.dev_tickets;
drop trigger if exists erwaehnungen_benachrichtigung on public.dev_ticket_erwaehnungen;
drop trigger if exists kommentare_benachrichtigung on public.dev_ticket_kommentare;

drop function if exists public.benachrichtige_bei_aufgabe();
drop function if exists public.benachrichtige_bei_erwaehnung();
drop function if exists public.benachrichtige_bei_kommentar();

alter table public.benachrichtigungen drop constraint if exists benachrichtigungen_typ_check;
alter table public.benachrichtigungen add constraint benachrichtigungen_typ_check
  check (typ = any (array['erwaehnung', 'zuweisung', 'kommentar', 'status', 'erledigt']));

create or replace function public.benachrichtige_bei_aufgaben_aenderung()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status = 'fertig' and old.status is distinct from 'fertig' then
    perform public.lege_benachrichtigung_an(
      new.melder_id, new.id, 'erledigt',
      'Erledigt: ' || new.titel,
      'Die Meldung ist umgesetzt.',
      public.mein_app_benutzer_id()
    );
  end if;
  return null;
end;
$function$;
