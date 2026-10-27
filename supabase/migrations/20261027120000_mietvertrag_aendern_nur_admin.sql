-- 27.10.2026: Die Policy "Admin or Hausmeister can update mietvertrag" erlaubte dem Hausmeister
-- per REST-PATCH jede Spalte: Kaltmiete und Betriebskosten (der Trigger
-- update_forderungen_on_rent_change schreibt daraufhin als SECURITY DEFINER die Forderungen um,
-- an der Admin-RLS von mietforderungen vorbei), Mahnstufe, IBAN, ende_datum (der Vertrag faellt
-- auf 'beendet' und aus der Sollstellung). Die Oberflaeche braucht das nicht: Der Hausmeister
-- bekommt nur das HausmeisterDashboard, das mietvertrag ausschliesslich liest; die Uebergabe ist
-- ihm ueber die Admin-RLS von dokumente und Storage ohnehin verschlossen. Kein Trigger auf
-- einheiten, immobilien oder zaehlerstand_historie schreibt in mietvertrag.
-- 20260906110000_offene_schreibrechte_schliessen.sql nannte als Ausnahme nur einheiten und immobilien.

drop policy if exists "Admin or Hausmeister can update mietvertrag" on public.mietvertrag;

create policy "Only admin can update mietvertrag"
  on public.mietvertrag
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
