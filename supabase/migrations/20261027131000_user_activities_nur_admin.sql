-- 27.10.2026: user_activities war mit dem oeffentlichen anon-Key lesbar (Policy "Allow read
-- activities" fuer public mit true). Die INSERT-Policy aus 20260906120000 prueft entgegen ihrem
-- Namen nicht, ob user_id dem eigenen Konto gehoert -- jedes Konto konnte Eintraege im Namen
-- anderer anlegen. Die Tabelle ist leer und im Code ungenutzt (befundliste.md: user_activities);
-- sie bleibt bestehen, nur der Zugriff wird geschlossen.

drop policy if exists "Allow read activities" on public.user_activities;

create policy "Admins lesen Aktivitaeten"
  on public.user_activities for select to authenticated
  using (public.is_admin((select auth.uid())));

drop policy if exists "Angemeldete Konten protokollieren ihre eigene Aktivitaet" on public.user_activities;

create policy "Angemeldete Konten protokollieren ihre eigene Aktivitaet"
  on public.user_activities for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.user_activities from anon;

notify pgrst, 'reload schema';
