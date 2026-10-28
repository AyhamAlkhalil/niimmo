-- 28.10.2026: Eine Zahlung mit Kostenpositionen darf weder ihr Objekt wechseln
-- noch in eine Kategorie ohne Betriebskosten wandern noch ihren Betrag ändern.
--
-- Befund: Der Nebenkosten-Arbeitsplatz (zuordnen, aufheben, „Als Nichtmiete“)
-- und der Kategorie-Editor schrieben immobilie_id und kategorie ungeprüft. Die
-- Kostenpositionen blieben am alten Objekt, im neuen erschien die Zahlung als
-- unverteilt — derselbe Betrag wurde zweimal umgelegt. Die richtige Sperre gab
-- es nur im Dialog „Auf anderes Objekt buchen“. Die Oberfläche prüft seit
-- diesem Tag selbst (utils/nebenkostenUmbuchung.ts); dieser Trigger setzt die
-- Regel für alle Schreibwege durch, auch für Edge Functions und Altdialoge.
--
-- Live geprüft am 28.10.2026: Verknüpfung ist kostenpositionen.zahlung_id
-- (FK, ON DELETE SET NULL); 98 Positionen hängen an Zahlungen, davon 35 an
-- Kategorie „Nichtmiete“ und keine an einem anderen Objekt als ihre Zahlung.
-- Deshalb gelten bei Ausgaben Nebenkosten UND Nichtmiete als zulässige
-- Kategorien; ein Wechsel zwischen beiden ändert an der Abrechnung nichts.
-- Eine Gutschrift (betrag > 0) ist in Schritt 1 nur unter Nebenkosten
-- zuordenbar: Unter Nichtmiete bliebe ihre negative Position in der Abrechnung,
-- die Zahlung verschwände aber aus Schritt 1 und ließe sich nicht mehr
-- entkoppeln. Für sie ist deshalb nur Nebenkosten zulässig.
--
-- Betrag: Die Kostenpositionen tragen den Betrag der Zahlung (gesamtbetrag =
-- -betrag). Ändert sich Betrag oder Vorzeichen, passen beide nicht mehr
-- zusammen. Am 28.10.2026 geprüft: Kein Pfad ändert betrag per UPDATE —
-- Aufteilen und Rückgängig (PaymentSplitModal, PaymentUndoSplitModal) legen
-- neue Zeilen an und löschen die alte, der CSV-Abgleich und process-payments
-- schreiben betrag nur beim Einfügen, keine DB-Funktion aktualisiert zahlungen.
--
-- Kein Fehlalarm: Der Trigger feuert nur, wenn immobilie_id, kategorie oder
-- betrag im UPDATE stehen, und lehnt nur ab, wenn sich der Wert tatsächlich ändert.
-- Dasselbe Objekt noch einmal zu setzen bleibt erlaubt.
--
-- SECURITY DEFINER, weil kostenpositionen per RLS nur für Admins lesbar ist:
-- Ohne Definer sähe ein anderer Nutzer keine Positionen und käme durch.
-- Der Meldungstext beginnt fest mit „Die Zahlung ist“ — die Oberfläche
-- erkennt daran die fachliche Ablehnung (umbuchungSperrMeldung).

create or replace function public.zahlung_umbuchung_pruefen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anzahl integer;
  v_anderes_objekt boolean;
  v_zuordnung text;
  v_abhilfe constant text :=
    'Bitte die Zuordnung zuerst im Objekt unter Nebenkosten, Schritt 1, entfernen — sonst würde der Betrag doppelt umgelegt.';
begin
  if new.immobilie_id is not distinct from old.immobilie_id
     and new.kategorie is not distinct from old.kategorie
     and new.betrag is not distinct from old.betrag then
    return new;
  end if;

  select count(*), coalesce(bool_or(kp.immobilie_id is distinct from new.immobilie_id), false)
    into v_anzahl, v_anderes_objekt
    from public.kostenpositionen kp
   where kp.zahlung_id = new.id;

  if v_anzahl = 0 then
    return new;
  end if;

  v_zuordnung := format(
    'Die Zahlung ist in der Betriebskostenabrechnung %s zugeordnet.',
    case when v_anzahl = 1 then 'einer Kostenposition' else v_anzahl::text || ' Kostenpositionen' end
  );

  if new.immobilie_id is distinct from old.immobilie_id and v_anderes_objekt then
    raise exception using
      errcode = 'P0001',
      message = v_zuordnung || ' Der Objektbezug lässt sich deshalb nicht ändern. ' || v_abhilfe;
  end if;

  if new.betrag is distinct from old.betrag then
    raise exception using
      errcode = 'P0001',
      message = v_zuordnung || ' Der Betrag lässt sich deshalb nicht ändern. ' || v_abhilfe;
  end if;

  -- Nach der Betragsprüfung ist new.betrag = old.betrag.
  if new.kategorie is distinct from old.kategorie
     and (new.kategorie is null
          or new.kategorie::text not in ('Nebenkosten', 'Nichtmiete')
          or (new.betrag > 0 and new.kategorie::text <> 'Nebenkosten')) then
    raise exception using
      errcode = 'P0001',
      message = v_zuordnung
        || format(' Die Kategorie „%s“ ist deshalb nicht möglich.', coalesce(new.kategorie::text, 'ohne'))
        || case when new.betrag > 0 then ' Eine Gutschrift bleibt unter Nebenkosten.' else '' end
        || ' ' || v_abhilfe;
  end if;

  return new;
end;
$$;

comment on function public.zahlung_umbuchung_pruefen() is
  'Lehnt Objekt-, Kategorie- oder Betragswechsel einer Zahlung mit Kostenpositionen ab (doppelte Umlage), seit 28.10.2026.';

-- Trigger-Funktionen werden nie direkt aufgerufen; Default-Privilegien entziehen.
revoke execute on function public.zahlung_umbuchung_pruefen() from public;
revoke execute on function public.zahlung_umbuchung_pruefen() from anon;
revoke execute on function public.zahlung_umbuchung_pruefen() from authenticated;

drop trigger if exists zahlung_umbuchung_pruefen on public.zahlungen;
create trigger zahlung_umbuchung_pruefen
  before update of immobilie_id, kategorie, betrag on public.zahlungen
  for each row
  execute function public.zahlung_umbuchung_pruefen();
