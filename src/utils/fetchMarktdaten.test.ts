import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * fetch-marktdaten läuft unter Deno und hier nicht; der Test sichert die Freigaberegel am Quelltext.
 * Bis zum 28.10.2026 genügte ein beliebiger Text nach „Bearer “ — jeder mit dem öffentlichen
 * anon-Key konnte die Function auslösen, die mit Service-Role in marktdaten schreibt.
 */
const quelle = readFileSync('supabase/functions/fetch-marktdaten/index.ts', 'utf-8');
const migration = readFileSync('supabase/migrations/20261028146000_marktdaten_cron_vault.sql', 'utf-8');

describe('fetch-marktdaten Freigabe', () => {
  it('lässt nur den Cron-Schlüssel oder einen Admin durch', () => {
    expect(quelle).toContain("req.headers.get('x-cron-key')");
    expect(quelle).toContain("Deno.env.get('CRON_SECRET')");
    expect(quelle).toMatch(/erwartet\.length >= CRON_SCHLUESSEL_MIN_LAENGE/);
    expect(quelle).toContain("crypto.subtle.digest('SHA-256'");
    expect(quelle).toContain('auth.getUser()');
    expect(quelle).toMatch(/authError \|\| !userData\?\.user\?\.id/);
    expect(quelle).toContain("rpc('is_admin'");
    expect(quelle).toMatch(/istAdmin !== true/);
  });

  it('erzeugt den schreibenden Service-Role-Client erst nach der Freigabe', () => {
    const serve = quelle.slice(quelle.indexOf('Deno.serve('));
    expect(serve.indexOf('await freigabe(req)')).toBeGreaterThan(-1);
    expect(serve.indexOf('await freigabe(req)')).toBeLessThan(serve.indexOf('SUPABASE_SERVICE_ROLE_KEY'));
  });

  it('schickt im Cron-Job den Schlüssel aus dem Vault, nie einen Wert im Befehl', () => {
    expect(migration).toContain("'x-cron-key'");
    expect(migration).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/Bearer [A-Za-z0-9._-]{8,}/);
    expect(migration).toContain('cron.alter_job');
  });
});
