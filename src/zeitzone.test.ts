import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Die Tests müssen in der Zeitzone der Nutzer laufen (vite.config.ts, test.env.TZ).
// In UTC bleiben Fehler wie toISOString() auf lokaler Mitternacht unsichtbar.
describe('Testumgebung', () => {
  it('läuft in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin');
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
  });
});

describe('Kalendertage im Dashboard', () => {
  it('zählt einen Vertrag, der heute endet, noch als nächstes Vertragsende', () => {
    // 27.10.2026: `new Date(ende) > heute` blendete ihn ab 1 bzw. 2 Uhr deutscher Zeit aus
    const quelle = readFileSync('src/components/dashboard/DashboardStats.tsx', 'utf-8');
    expect(quelle).not.toMatch(/ende && new Date\(ende\) > heute \?/);
    expect(quelle).toMatch(/if \(!ende \|\| ende < heuteTag\) return frueheste;/);
  });
});
