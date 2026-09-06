-- Mieterhoehung als nachvollziehbarer Vorgang statt als sofortige Mietaenderung.
--
-- Bisher setzte RentIncreaseModal.tsx:210-214 beim Speichern des Schreibens
-- sofort mietvertrag.kaltmiete und mietvertrag.betriebskosten -- und
-- letzte_mieterhoehung_am auf den heutigen Tag. Das ist in zwei Punkten falsch:
--
--   1. Nach § 558 BGB erhoeht der Vermieter die Miete nicht einseitig, er
--      verlangt die Zustimmung des Mieters. Ohne Zustimmung bleibt es bei der
--      bisherigen Miete.
--   2. Selbst bei Zustimmung ist die erhoehte Miete erst ab Beginn des dritten
--      Kalendermonats nach Zugang geschuldet (§ 558b Abs. 1, 2 BGB).
--
-- Folge im Betrieb: Drei Monate lang stand ein zu hohes Soll -- rueckwirkend
-- auch fuer den laufenden Monat, weil generate-mietforderungen den Sollbetrag
-- aus kaltmiete + betriebskosten zurueckschreibt. Mieter, die korrekt die
-- vereinbarte Miete zahlten, erschienen als saeumig; Verzugszinsen und
-- Mahnlauf starteten gegen sie.
--
-- Diese Tabelle haelt das Verlangen fest, bis es angenommen (oder abgelehnt)
-- ist. Die Miete am Vertrag wird erst geaendert, wenn der Vorgang auf
-- 'wirksam' geht -- das bleibt ein bewusster Schritt der Verwaltung.

create table if not exists public.mieterhoehungen (
  id uuid primary key default gen_random_uuid(),
  mietvertrag_id uuid not null references public.mietvertrag(id) on delete cascade,

  -- Zugang des Verlangens beim Mieter; ab hier laufen die Fristen.
  verlangt_am date not null default current_date,
  -- Beginn des dritten Kalendermonats nach Zugang (§ 558b Abs. 1 BGB).
  wirksam_ab date not null,

  alte_kaltmiete numeric(10,2) not null,
  alte_betriebskosten numeric(10,2) not null default 0,
  neue_kaltmiete numeric(10,2) not null,
  neue_betriebskosten numeric(10,2) not null default 0,

  -- Begruendungsmittel nach § 558a Abs. 2 BGB. Ohne Begruendung ist das
  -- Verlangen formunwirksam, deshalb sind beide Spalten Pflicht.
  begruendungsart text not null,
  begruendung_text text not null,

  status text not null default 'verlangt',
  zugestimmt_am date,
  abgelehnt_am date,
  dokument_pfad text,
  bemerkung text,

  erstellt_am timestamptz not null default now(),
  erstellt_von uuid,
  aktualisiert_am timestamptz not null default now(),

  constraint mieterhoehungen_begruendungsart_bekannt
    check (begruendungsart in ('mietspiegel','mietdatenbank','gutachten','vergleichswohnungen')),
  constraint mieterhoehungen_status_bekannt
    check (status in ('verlangt','zugestimmt','abgelehnt','wirksam','zurueckgezogen')),
  constraint mieterhoehungen_erhoeht_tatsaechlich
    check (neue_kaltmiete > alte_kaltmiete),
  constraint mieterhoehungen_wirksam_nach_verlangen
    check (wirksam_ab > verlangt_am)
);

comment on table public.mieterhoehungen is
  'Zustimmungsverlangen nach § 558 BGB. Die Miete am Vertrag wird erst geaendert, wenn der Vorgang auf status=wirksam steht.';
comment on column public.mieterhoehungen.wirksam_ab is
  'Erster Tag, ab dem die erhoehte Miete geschuldet wird: Beginn des dritten Kalendermonats nach Zugang (§ 558b Abs. 1 BGB).';
comment on column public.mieterhoehungen.begruendung_text is
  'Der Text, den der Mieter nachpruefen kann -- Mietspiegelfeld, Gutachtenfundstelle oder die Vergleichswohnungen.';

create index if not exists mieterhoehungen_vertrag_idx
  on public.mieterhoehungen (mietvertrag_id, verlangt_am desc);
create index if not exists mieterhoehungen_offene_idx
  on public.mieterhoehungen (status, wirksam_ab)
  where status in ('verlangt','zugestimmt');

alter table public.mieterhoehungen enable row level security;

create policy mieterhoehungen_admin_all
  on public.mieterhoehungen
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.setze_mieterhoehung_aktualisiert_am()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.aktualisiert_am := now();
  return new;
end;
$$;

revoke execute on function public.setze_mieterhoehung_aktualisiert_am() from public;
revoke execute on function public.setze_mieterhoehung_aktualisiert_am() from anon;

drop trigger if exists mieterhoehungen_aktualisiert_am on public.mieterhoehungen;
create trigger mieterhoehungen_aktualisiert_am
  before update on public.mieterhoehungen
  for each row execute function public.setze_mieterhoehung_aktualisiert_am();

notify pgrst, 'reload schema';
