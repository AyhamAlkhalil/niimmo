-- Den Dokumenten-Bucket auf dieselbe Grenze ziehen wie die Tabelle dokumente.
--
-- Die Tabelle ist seit jeher admin-only ("Only admin can access dokumente"),
-- der Bucket dagegen stand jedem angemeldeten Konto offen -- geschuetzt war
-- allein das Praefix aufgaben/. Ein Hausmeisterkonto sah zwar keine
-- Dokumentenliste, konnte den Bucket aber auflisten, jede Datei herunterladen,
-- per upsert ueberschreiben und endgueltig loeschen. Betroffen sind Mahnungen
-- und Kuendigungen, deren Dateinamen Mieternamen tragen, dazu Mietvertraege,
-- Uebergabeprotokolle und Zaehlerfotos.
--
-- Wer mit Dokumenten arbeitet, arbeitet ohnehin in der Verwaltung: Der
-- Hausmeister hat weder Zugang zur Dokumentenansicht noch zur Uebergabe und
-- laedt im HausmeisterDashboard nichts hoch.

drop policy if exists "Authenticated users can view documents" on storage.objects;
drop policy if exists "Authenticated users can download documents" on storage.objects;
drop policy if exists "Authenticated users can upload documents" on storage.objects;
drop policy if exists "Authenticated users can update documents" on storage.objects;
drop policy if exists "Authenticated users can delete documents" on storage.objects;

create policy "Nur Admin darf Dokumente lesen"
  on storage.objects for select to authenticated
  using (bucket_id = 'dokumente' and public.is_admin(auth.uid()));

create policy "Nur Admin darf Dokumente hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dokumente' and public.is_admin(auth.uid()));

create policy "Nur Admin darf Dokumente ersetzen"
  on storage.objects for update to authenticated
  using (bucket_id = 'dokumente' and public.is_admin(auth.uid()))
  with check (bucket_id = 'dokumente' and public.is_admin(auth.uid()));

create policy "Nur Admin darf Dokumente loeschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'dokumente' and public.is_admin(auth.uid()));

-- WhatsApp-Nachrichten: Aendern stand jedem Angemeldeten offen
-- (auth.role() = 'authenticated' ohne Rollenpruefung).
drop policy if exists "Authenticated users can update WhatsApp messages" on public.whatsapp_nachrichten;
create policy "Nur Admin darf WhatsApp-Nachrichten aendern"
  on public.whatsapp_nachrichten for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- user_activities: INSERT stand der Rolle public offen, also auch anon.
-- Ein Aktivitaetsprotokoll, in das jeder von aussen schreiben darf, ist als
-- Nachweis wertlos.
drop policy if exists "Allow insert activities" on public.user_activities;
create policy "Angemeldete Konten protokollieren ihre eigene Aktivitaet"
  on public.user_activities for insert to authenticated
  with check (true);

notify pgrst, 'reload schema';
