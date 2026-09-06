-- Offene Schreibrechte fuer angemeldete Konten schliessen.
--
-- Auf einheiten, immobilien, mieter und mietvertrag_mieter lag eine Policy
-- namens "Policy_documents" mit ALL / using true / with check true fuer die
-- Rolle authenticated. Policies sind in Postgres permissiv, also ODER-verknuepft:
-- Diese eine Policy hat saemtliche daneben stehenden Admin-Regeln ausgehebelt
-- ("Only admin can delete mieter" und so weiter waren wirkungslos).
--
-- Folge: Jedes Konto mit gueltigem Login -- Hausmeister wie ein neu angelegtes
-- Konto ganz ohne Rolle -- konnte per REST-Aufruf Mieterstammdaten aendern und
-- Einheiten samt Vertragshistorie loeschen. Die Rollentrennung in der
-- Oberflaeche war damit reine Kosmetik.
--
-- Was bleibt (bewusst):
--   * Lesen: alle angemeldeten Konten duerfen weiterhin Objekte, Einheiten,
--     Mieter und Vertragszuordnungen lesen. Der Hausmeister braucht das, um
--     Zaehler der richtigen Wohnung zuzuordnen.
--   * Der Hausmeister darf weiterhin einheiten UND immobilien aendern -- er
--     traegt dort die Zaehlerstaende ein (HausmeisterDashboard.tsx:135-155).
-- Was faellt weg: jedes Schreibrecht ohne Rollenpruefung.

-- 1. Die vier Allzweck-Policies entfernen.
drop policy if exists "Policy_documents" on public.einheiten;
drop policy if exists "Policy_documents" on public.immobilien;
drop policy if exists "Policy_documents" on public.mieter;
drop policy if exists "Policy_documents" on public.mietvertrag_mieter;

-- 2. immobilien: Aendern nur mit Rolle. Der Hausmeister bleibt drin, weil er
--    die Hausanschlusszaehler pflegt.
drop policy if exists "Authenticated users can update immobilien data" on public.immobilien;
create policy "Admin oder Hausmeister koennen immobilien aendern"
  on public.immobilien
  for update
  to authenticated
  using (public.is_admin(auth.uid()) or public.is_hausmeister(auth.uid()))
  with check (public.is_admin(auth.uid()) or public.is_hausmeister(auth.uid()));

-- 3. mietvertrag_mieter: Die Zuordnung von Mietern zu Vertraegen entsteht nur
--    bei der Vertragsanlage (NewTenantContractDialog.tsx:540) -- das ist eine
--    Verwaltungsaufgabe. Lesen bleibt fuer alle angemeldeten Konten offen.
drop policy if exists "Authenticated users can insert mietvertrag_mieter data" on public.mietvertrag_mieter;
drop policy if exists "Authenticated users can update mietvertrag_mieter data" on public.mietvertrag_mieter;
drop policy if exists "Authenticated users can delete mietvertrag_mieter data" on public.mietvertrag_mieter;

create policy "Nur Admin darf mietvertrag_mieter anlegen"
  on public.mietvertrag_mieter for insert to authenticated
  with check (public.is_admin(auth.uid()));
create policy "Nur Admin darf mietvertrag_mieter aendern"
  on public.mietvertrag_mieter for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy "Nur Admin darf mietvertrag_mieter loeschen"
  on public.mietvertrag_mieter for delete to authenticated
  using (public.is_admin(auth.uid()));

-- 4. csv_uploads: Das Protokoll der Zahlungsimporte. Importieren darf nur die
--    Verwaltung, also gehoert auch das Protokoll ihr.
drop policy if exists "Public access csv_uploads" on public.csv_uploads;
create policy "Nur Admin darf csv_uploads nutzen"
  on public.csv_uploads for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
