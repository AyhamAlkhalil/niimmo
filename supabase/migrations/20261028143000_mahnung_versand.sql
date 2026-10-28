-- 28.10.2026: Versandprotokoll der Mahnungen (E-Mail und Post) und Sperre gegen das Erhöhen der
-- Mahnstufe außerhalb des Versands.
--
-- Befund: Die Mahnstufe stieg nur durch erfolgreichen Mailversand in send-mahnung. 34 von 98
-- laufenden Verträgen haben keine Mailadresse — dort stieg sie nie, Stufe 3 (fristlose Kündigung
-- samt Vertragsstatus) war unerreichbar, und jedes Schreiben hieß wieder „1. Mahnung“. Für einen
-- Postversand gab es keinen Ort für Datum und Person; letzte_mahnung_am wird bei jeder Stufe
-- überschrieben, und system_logs kennt weder den Nutzer noch hat es eine Oberfläche.
--
-- 1. mahnung_versand: eine Zeile je gespeichertem Mahnschreiben.
--    - „vorgemerkt“ legt send-mahnung beim Speichern an, nach denselben Prüfungen wie beim
--      Versand (Admin, Pfad, Dokumentzeile, Stufe, Frist, Kündigungsfelder). Stufe, Frist,
--      Kündigungsfelder und Beträge stehen danach hier.
--    - „wird_versendet“: Vor dem Mailversand bzw. vor der Stufenbuchung beansprucht send-mahnung
--      die Zeile atomar (update … where status = 'vorgemerkt'). Ein zweiter Aufruf (Doppelklick,
--      zweiter Tab, Wiederholung nach Zeitlimit) findet sie nicht mehr und versendet nicht doppelt.
--      Scheitert der Mailversand sicher, wird sie wieder 'vorgemerkt'; bleibt sie nach einem
--      Abbruch stehen, klärt sie der Dialog („Versand unklar“, Aktion 'freigeben'): abschließen, wenn
--      mails 'gesendet' zeigt oder ein Admin den Versand von Hand bestätigt (von_hand_bestaetigt),
--      freigeben nur nach ausdrücklicher Bestätigung „nicht versendet“.
--    - „versendet“ setzt send-mahnung nach dem Mailversand bzw. nach der Stufenbuchung.
--      Stufe, Frist und Kündigung des Versands liest die Function aus dieser Zeile, nicht aus der
--      Anfrage. Deshalb lässt sich ein gespeichertes Schreiben auch später noch versenden.
--    - Mailversand alter App-Fassungen ohne Vormerkung: Die Function legt die Zeile gleich als
--      „versendet“ mit herkunft 'altclient' an (dokument_pfad, Frist und Kündigung können fehlen).
--    - Höchstens eine Zeile je Schreiben (dokument_pfad). erstellt_von ist bei „versendet“ die
--      Person, die versendet bzw. den Postversand gebucht hat.
--    - Geschrieben wird nur von send-mahnung mit Service-Role; Admins lesen (Mahnungsdialog,
--      Vertragsansicht). Clients dürfen nicht schreiben — sonst ließe sich eine Vormerkung mit
--      beliebiger Stufe oder Frist anlegen, die der Versand dann übernähme.
--
-- 2. Sperre: Die Regel „Die Mahnstufe steigt nur durch Versand“ stand bisher nur in der
--    Oberfläche, in useMietvertragMutations und im set_mahnstufe-Tool der agent-api. Die Policy
--    „Only admin can update mietvertrag“ gilt für alle Spalten: Jeder Admin konnte die Stufe per
--    REST-PATCH erhöhen. Jetzt erhöht nur noch die Service-Role (JWT-Rolle service_role — so
--    schreibt send-mahnung) oder ein DB-interner Aufruf ohne JWT (postgres, Migration, Cron).
--    Senken (Zurücksetzen) bleibt immer erlaubt.
--    Live geprüft am 28.10.2026: auth.role() liest request.jwt.claim.role bzw.
--    request.jwt.claims ->> 'role'; über die CLI (postgres, ohne JWT) ist es null. Entschieden
--    wird nach dem JWT, nicht nach current_user: Eine SECURITY-DEFINER-Funktion, die ein
--    angemeldeter Nutzer aufruft, läuft als postgres, trägt aber dessen JWT — sie darf nicht erhöhen.

create table public.mahnung_versand (
  id               uuid primary key default gen_random_uuid(),
  mietvertrag_id   uuid not null references public.mietvertrag(id) on delete cascade,
  stufe            smallint not null check (stufe between 1 and 3),
  status           text not null default 'vorgemerkt' check (status in ('vorgemerkt', 'wird_versendet', 'versendet')),
  -- 'vormerkung': über die Vormerkung beim Speichern; 'altclient': Mailversand einer älteren App-Fassung
  herkunft         text not null default 'vormerkung' check (herkunft in ('vormerkung', 'altclient')),
  -- Storage-Pfad des Schreibens im Bucket dokumente (mahnungen/<vertrag>/<datei>.pdf)
  dokument_pfad    text,
  -- Zahlungsfrist aus dem Schreiben
  zahlungsfrist    date,
  -- Nur Stufe 3: { status, kuendigungsdatum, ende_datum } wie fristloseKuendigungFelder()
  kuendigung       jsonb,
  -- Beträge des Schreibens für eine spätere Mail: gesamtRueckstand, mahnkostenGesamt,
  -- verzugszinsenGesamt, zahlungsfristTage
  betraege         jsonb,
  versandart       text check (versandart in ('email', 'post')),
  -- Mail: Versandtag; Post: Tag der Aufgabe zur Post (jeweils deutscher Kalendertag)
  versendet_am     date,
  -- Mail: = versendet_am; Post: versendet_am + 3 Tage (POST_ZUGANG_TAGE in send-mahnung)
  zugang_am        date,
  mail_id          uuid references public.mails(id) on delete set null,
  -- Nur Post, optional: Sendungsnummer eines Einschreibens
  sendungsnummer   text,
  erstellt_von     uuid references auth.users(id) on delete set null,
  -- Unklarer Mailversand, den ein Admin nach Prüfung des Postausgangs als versendet bestätigt hat
  -- (send-mahnung 'freigeben' mit bestaetigtVersendet): Selbstauskunft wie die Postbuchung. Die Person
  -- steht mit Nutzer-ID in system_logs.
  von_hand_bestaetigt boolean not null default false,
  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  -- Über die Vormerkung: Schreiben und Frist stehen fest, in jedem Status
  constraint mahnung_versand_vormerkung_mit_schreiben
    check (herkunft <> 'vormerkung' or (dokument_pfad is not null and zahlungsfrist is not null)),
  -- Stufe 3 kündigt fristlos: über die Vormerkung immer mit Kündigungsfeldern. Ältere App-Fassungen
  -- setzten den Status im Browser und schickten die Felder nicht immer mit (herkunft 'altclient').
  constraint mahnung_versand_stufe3_mit_kuendigung
    check (stufe <> 3 or herkunft <> 'vormerkung' or kuendigung is not null),
  constraint mahnung_versand_altclient_nur_versendete_mail
    check (herkunft <> 'altclient' or (status = 'versendet' and versandart = 'email')),
  constraint mahnung_versand_vorgemerkt_ohne_versand
    check (status <> 'vorgemerkt'
           or (versandart is null and versendet_am is null and zugang_am is null
               and mail_id is null and sendungsnummer is null)),
  -- Beansprucht: Der Weg steht fest; Aufgabetag, Zugang und Sendungsnummer trägt nur die Post schon hier
  constraint mahnung_versand_wird_versendet_mit_weg
    check (status <> 'wird_versendet'
           or (versandart = 'email' and versendet_am is null and zugang_am is null)
           or (versandart = 'post' and versendet_am is not null and zugang_am is not null)),
  constraint mahnung_versand_versendet_vollstaendig
    check (status <> 'versendet' or (versandart is not null and versendet_am is not null and zugang_am is not null)),
  constraint mahnung_versand_post_mit_schreiben
    check (versandart is distinct from 'post' or dokument_pfad is not null),
  constraint mahnung_versand_mail_nur_bei_email
    check (mail_id is null or versandart = 'email'),
  constraint mahnung_versand_sendungsnummer_nur_post
    check (sendungsnummer is null or (versandart = 'post' and length(sendungsnummer) between 1 and 64)),
  constraint mahnung_versand_zugang_nach_versand
    check (zugang_am is null or zugang_am >= versendet_am),
  constraint mahnung_versand_kuendigung_nur_stufe_3
    check (kuendigung is null or (stufe = 3 and jsonb_typeof(kuendigung) = 'object')),
  constraint mahnung_versand_von_hand_nur_versendete_mail
    check (not von_hand_bestaetigt or (status = 'versendet' and versandart = 'email')),
  constraint mahnung_versand_betraege_objekt
    check (betraege is null or jsonb_typeof(betraege) = 'object')
);

comment on table public.mahnung_versand is
  'Mahnschreiben je Vertrag: vorgemerkt beim Speichern, wird_versendet (beansprucht), versendet per E-Mail oder gebuchtem Postversand. Schreibt nur send-mahnung (seit 28.10.2026).';

-- Ein Schreiben wird höchstens einmal vorgemerkt und einmal versendet
create unique index mahnung_versand_schreiben_einmal
  on public.mahnung_versand (dokument_pfad)
  where dokument_pfad is not null;

-- Je Vertrag höchstens ein beanspruchter Versand (Review 28.10.2026): Ist einer unklar oder läuft,
-- scheitert das Beanspruchen eines anderen Schreibens desselben Vertrags (23505) -- erst klären.
create unique index mahnung_versand_ein_versand_je_vertrag
  on public.mahnung_versand (mietvertrag_id)
  where status = 'wird_versendet';

-- Mahnungsdialog (offene und unklare Vormerkungen) und Vertragsansicht (letzter Versand)
create index mahnung_versand_vertrag_idx
  on public.mahnung_versand (mietvertrag_id, erstellt_am desc);

create trigger mahnung_versand_aktualisiert_am
  before update on public.mahnung_versand
  for each row
  execute function public.setze_aktualisiert_am();

alter table public.mahnung_versand enable row level security;

create policy "Only admin can read mahnung_versand"
  on public.mahnung_versand
  for select
  to authenticated
  using (public.is_admin((select auth.uid())));

-- Keine Schreib-Policy: send-mahnung schreibt mit Service-Role (umgeht RLS). Die
-- Default-Privilegien im Schema public vergäben anon und authenticated sonst alle Rechte.
revoke all on table public.mahnung_versand from anon;
revoke insert, update, delete, truncate, references, trigger on table public.mahnung_versand from authenticated;

-- ── mails: Clients nur lesen (Review 28.10.2026) ─────────────────────────────
-- Die Policy „Only admin can access mails“ galt für ALL: Ein Admin konnte per REST mails.status auf
-- 'gesendet' setzen. Das Klären eines abgebrochenen Mahnungsversands (send-mahnung 'freigeben')
-- wertet genau diesen Status aus und bucht dann die Stufe -- er darf deshalb nicht fälschbar sein.
-- Geprüft am 28.10.2026: Das Frontend liest mails nur (MailProtokoll, useUebergabeVersand);
-- geschrieben wird ausschließlich von send-mahnung, send-uebergabe-email, send-nebenkostenabrechnung
-- und send-kuendigungsbestaetigung, jeweils mit Service-Role; keine DB-Funktion schreibt mails.
drop policy if exists "Only admin can access mails" on public.mails;
create policy "Only admin can read mails"
  on public.mails
  for select
  to authenticated
  using (public.is_admin((select auth.uid())));
revoke all on table public.mails from anon;
revoke insert, update, delete, truncate, references, trigger on table public.mails from authenticated;

-- ── Sperre: Mahnstufe erhöhen nur durch send-mahnung ─────────────────────────
create or replace function public.mahnstufe_nur_durch_versand()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rolle text := (select auth.role());
begin
  -- Ohne JWT (postgres, Migration, Cron) und mit Service-Role erlaubt, Senken immer
  if coalesce(new.mahnstufe, 0) > coalesce(old.mahnstufe, 0)
     and v_rolle is not null
     and v_rolle <> 'service_role' then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Die Mahnstufe kann nicht erhöht werden (aktuell %s, angefragt %s). Sie steigt ausschließlich beim Versand einer Mahnung per E-Mail oder beim gebuchten Postversand.',
        coalesce(old.mahnstufe, 0), coalesce(new.mahnstufe, 0));
  end if;
  return new;
end;
$$;

comment on function public.mahnstufe_nur_durch_versand() is
  'Lehnt das Erhöhen von mietvertrag.mahnstufe ab, außer für die Service-Role (send-mahnung) und DB-interne Aufrufe ohne JWT (seit 28.10.2026).';

-- Trigger-Funktionen werden nie direkt aufgerufen; Default-Privilegien entziehen.
revoke execute on function public.mahnstufe_nur_durch_versand() from public;
revoke execute on function public.mahnstufe_nur_durch_versand() from anon;
revoke execute on function public.mahnstufe_nur_durch_versand() from authenticated;

drop trigger if exists mahnstufe_nur_durch_versand on public.mietvertrag;
create trigger mahnstufe_nur_durch_versand
  before update of mahnstufe on public.mietvertrag
  for each row
  execute function public.mahnstufe_nur_durch_versand();
