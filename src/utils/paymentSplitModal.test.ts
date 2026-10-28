import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Aufteilen und Aufheben im PaymentSplitModal schreiben in zwei Schritten (einfügen, dann löschen) und
 * nehmen den ersten Schritt zurück, wenn der zweite scheitert. Bis zum 28.10.2026 war dieses Zurücknehmen
 * ungeprüft: Scheiterte es, zählte die Zahlung doppelt, ohne Meldung. Außerdem blieb die Rückstands-
 * übersicht auf dem alten Stand, weil ['rueckstaende'] nicht invalidiert wurde.
 */
const quelle = readFileSync('src/components/dashboard/PaymentSplitModal.tsx', 'utf-8');

describe('PaymentSplitModal', () => {
  it('prüft jedes Zurücknehmen und meldet eine verbliebene Doppelbuchung', () => {
    expect(quelle.match(/const \{ error: rueckError \} = await supabase/g)).toHaveLength(2);
    expect(quelle.match(/if \(rueckError\) \{[\s\S]{0,200}throw new Error\(\s*`Die Zahlung ist jetzt doppelt gebucht/g)).toHaveLength(2);
    // Kein Löschen mehr, dessen Ergebnis verworfen wird
    expect(quelle).not.toMatch(/^\s*await supabase\s*\.from\("zahlungen"\)\s*\.delete\(\)/m);
  });

  it('lädt nach jeder Änderung auch die Rückstände neu', () => {
    expect(quelle).toMatch(/queryClient\.invalidateQueries\(\{ queryKey: \["rueckstaende"\] \}\)/);
    // Erfolg beim Aufteilen, Erfolg beim Aufheben, und beide Doppelbuchungsfälle
    expect(quelle.match(/await zahlungsAnsichtenNeuLaden\(\);/g)).toHaveLength(4);
  });
});
