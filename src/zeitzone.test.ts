import { describe, expect, it } from 'vitest';

// Die Tests müssen in der Zeitzone der Nutzer laufen (vite.config.ts, test.env.TZ).
// In UTC bleiben Fehler wie toISOString() auf lokaler Mitternacht unsichtbar.
describe('Testumgebung', () => {
  it('läuft in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin');
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
  });
});
