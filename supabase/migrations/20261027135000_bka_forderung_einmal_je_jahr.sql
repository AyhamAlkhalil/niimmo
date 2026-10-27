-- 27.10.2026 (Systemprüfung): Je Vertrag und Abrechnungsjahr höchstens eine BKA-Forderung. Schritt 3
-- der Betriebskostenabrechnung legte über „Als Forderung anlegen“ und „Alle BKA-Salden eintragen“
-- dieselbe Nachzahlung zweimal an; der Rückstand verdoppelte sich und ging nach 30 Tagen in die
-- Mahnung. Die Oberfläche prüft jetzt vorher; der Index sperrt es auch für jeden anderen Weg.
-- Live gab es beim Anlegen noch keine BKA-Forderung.
create unique index if not exists mietforderungen_bka_je_jahr
  on public.mietforderungen (mietvertrag_id, sollmonat)
  where typ = 'BKA';
