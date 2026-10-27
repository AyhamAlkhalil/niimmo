-- 27.10.2026: update_kaution_ist rechnete kaution_ist nur nach, wenn die NEUE Zeile eine
-- Mietkaution mit Vertrag war, und den alten Vertrag nur bei OLD.mietvertrag_id != NEW.mietvertrag_id.
-- Drei Faelle blieben stehen:
--   (a) Loeschen einer Kautionsbuchung (es gab keinen DELETE-Trigger),
--   (b) Umkategorisieren am selben Vertrag (Mietkaution -> Miete),
--   (c) Loesen des Vertrags (NEW.mietvertrag_id NULL: der Vergleich ergibt NULL).
-- Live stand so Vertrag 103001 auf kaution_ist = -540 ohne eine einzige Kautionsbuchung.
-- Ausserdem setzte jede neue Kautionsbuchung den Wert auf die reine Buchungssumme und
-- ueberschrieb damit von Hand gepflegte Ist-Kautionen (28 Vertraege ohne Kautionsbuchung).
--
-- Neu: Jede Buchung traegt ihren Betrag bei, solange sie Mietkaution mit Vertrag ist. Einfuegen,
-- Aendern, Umhaengen und Loeschen buchen genau diese Differenz. Ein von Hand gepflegter
-- Grundwert bleibt erhalten; ein erneutes Speichern ohne Aenderung (Re-Import) bewegt nichts.
-- Bestehende Werte werden nicht neu berechnet.

create or replace function public.update_kaution_ist()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_alt numeric := 0;
  v_neu numeric := 0;
  v_alt_vertrag uuid;
  v_neu_vertrag uuid;
begin
  -- Verschachtelt statt mit AND: NEW gibt es bei DELETE nicht, OLD nicht bei INSERT
  if TG_OP <> 'INSERT' then
    if OLD.kategorie = 'Mietkaution' and OLD.mietvertrag_id is not null then
      v_alt := coalesce(OLD.betrag, 0);
      v_alt_vertrag := OLD.mietvertrag_id;
    end if;
  end if;
  if TG_OP <> 'DELETE' then
    if NEW.kategorie = 'Mietkaution' and NEW.mietvertrag_id is not null then
      v_neu := coalesce(NEW.betrag, 0);
      v_neu_vertrag := NEW.mietvertrag_id;
    end if;
  end if;

  if v_alt_vertrag is not null and v_alt_vertrag = v_neu_vertrag then
    if v_neu <> v_alt then
      update mietvertrag set kaution_ist = coalesce(kaution_ist, 0) + v_neu - v_alt where id = v_neu_vertrag;
    end if;
  else
    if v_alt_vertrag is not null and v_alt <> 0 then
      update mietvertrag set kaution_ist = coalesce(kaution_ist, 0) - v_alt where id = v_alt_vertrag;
    end if;
    if v_neu_vertrag is not null and v_neu <> 0 then
      update mietvertrag set kaution_ist = coalesce(kaution_ist, 0) + v_neu where id = v_neu_vertrag;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trigger_update_kaution_ist on public.zahlungen;
create trigger trigger_update_kaution_ist
  after insert or update of mietvertrag_id, kategorie, betrag or delete on public.zahlungen
  for each row execute function public.update_kaution_ist();

-- Wie seit 20261022020000: Trigger-Funktionen ruft niemand direkt auf
revoke execute on function public.update_kaution_ist() from public, anon, authenticated;
