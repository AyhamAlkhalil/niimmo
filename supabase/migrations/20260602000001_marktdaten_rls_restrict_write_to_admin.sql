-- Overly permissive policy allowed any authenticated user to write marktdaten.
-- Restrict writes to admin role only; reads remain open to all authenticated users.

DROP POLICY IF EXISTS "marktdaten_authenticated_write" ON public.marktdaten;

CREATE POLICY "marktdaten_admin_write"
  ON public.marktdaten
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "marktdaten_authenticated_read"
  ON public.marktdaten
  FOR SELECT TO authenticated
  USING (true);
