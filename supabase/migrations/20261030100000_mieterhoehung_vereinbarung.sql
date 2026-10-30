-- Mieterhöhung aus der Vertragsbearbeitung als Vorgang (Kundenentscheidung 29.10.2026: „Eine Mieterhöhung ist ein
-- Vorgang“). Wer in der Vertragsbearbeitung oder der Mietübersicht eine Erhöhung erfasst, legt jetzt einen Vorgang an
-- (mieterhoehungAlsVorgangAnlegen): als vereinbarte Erhöhung (§ 557 Abs. 1 BGB) mit gewähltem „gilt ab“, über
-- mieterhoehung_zustimmen — rückwirkend zum 1. des laufenden Monats sofort übernommen, sonst vom Nachtlauf. Dafür
-- braucht die Begründungsart neben den vier Begründungsmitteln des § 558a Abs. 2 BGB den Wert 'vereinbarung'.

alter table public.mieterhoehungen drop constraint mieterhoehungen_begruendungsart_bekannt;
alter table public.mieterhoehungen add constraint mieterhoehungen_begruendungsart_bekannt
  check (begruendungsart = any (array['mietspiegel', 'mietdatenbank', 'gutachten', 'vergleichswohnungen', 'vereinbarung']));
