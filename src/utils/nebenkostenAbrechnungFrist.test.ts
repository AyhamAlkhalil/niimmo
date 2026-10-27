import { describe, expect, it } from 'vitest';
import { zahlungsfristAus } from './nebenkostenAbrechnungPdfGenerator';

describe('zahlungsfristAus', () => {
  it('setzt die Frist auf Briefdatum plus 30 Tage statt fest auf den 30. März', () => {
    // 27.10.2026: Eine heute erstellte Abrechnung 2025 verlangte Zahlung bis 30. März 2026
    expect(zahlungsfristAus('27.10.2026')).toBe('26. November 2026');
    expect(zahlungsfristAus('15.12.2026')).toBe('14. Januar 2027');
  });
});
