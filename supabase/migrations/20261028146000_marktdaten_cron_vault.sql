-- 28.10.2026: Der Cron-Job für fetch-marktdaten sendet einen echten Schlüssel.
--
-- Befund (live am 28.10.2026): Job niimmo-fetch-marktdaten (jobid 7, '0 4 1 * *', Eigentümer
-- postgres) rief die Edge Function mit einem festen 16-Zeichen-Bearer auf, der zu keinem Edge-Secret
-- passte. Die Function prüfte nur das Präfix „Bearer “ — jeder mit dem öffentlichen anon-Key konnte
-- sie auslösen. Alle anderen Cron-Jobs (4, 5, 8, 9) rufen nur SQL auf und brauchen keinen Schlüssel.
--
-- Neu: Der Job liest den Schlüssel bei jedem Lauf aus Supabase Vault (Name cron_secret) und sendet
-- ihn als Header x-cron-key; die Function vergleicht ihn mit dem Edge-Secret CRON_SECRET (oder lässt
-- einen Admin per JWT zu). Im Befehl und in dieser Datei steht kein Wert. Fehlt das Vault-Secret,
-- geht null als Header raus und die Function lehnt ab (401) — sie fällt geschlossen aus.
--
-- Reihenfolge beim Ausrollen: 1. Zufallswert als CRON_SECRET (Edge) und als Vault-Secret cron_secret
-- setzen, 2. diese Migration, 3. fetch-marktdaten deployen. Diese Migration bricht ab, wenn das
-- Vault-Secret noch fehlt. Bis zum Deploy prüft die alte Function weiter nur das Bearer-Präfix,
-- das der neue Befehl nicht mehr sendet — zwischen 2. und 3. darf deshalb kein Lauf liegen
-- (nächster Lauf am 1. des Monats, 04:00 UTC).

do $migration$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'niimmo-fetch-marktdaten';
  if v_job is null then
    raise exception 'Cron-Job niimmo-fetch-marktdaten fehlt';
  end if;
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    raise exception 'Vault-Secret cron_secret fehlt — zuerst CRON_SECRET und Vault-Secret einrichten';
  end if;

  perform cron.alter_job(
    job_id  := v_job,
    command := $befehl$
  select net.http_post(
    url     := 'https://kmtgzrnpitlslivdvlyq.supabase.co/functions/v1/fetch-marktdaten',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
$befehl$
  );
end;
$migration$;
