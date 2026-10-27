import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { edgeFehlertext } from './edgeFehler';

class FunctionsHttpErrorAttrappe extends Error {
  constructor(public context: Response) {
    super('Edge Function returned a non-2xx status code');
  }
}

describe('edgeFehlertext', () => {
  it('liest den Grund aus der Antwort der Function', async () => {
    const fehler = new FunctionsHttpErrorAttrappe(new Response(JSON.stringify({ error: 'Der Vertrag steht inzwischen auf Mahnstufe 1.' }), { status: 409 }));
    expect(await edgeFehlertext(fehler, 'x')).toBe('Der Vertrag steht inzwischen auf Mahnstufe 1.');
  });

  it('fällt ohne lesbaren Grund auf die Fehlermeldung oder den Ersatztext zurück', async () => {
    expect(await edgeFehlertext(new FunctionsHttpErrorAttrappe(new Response('kaputt', { status: 500 })), 'x')).toBe('Edge Function returned a non-2xx status code');
    expect(await edgeFehlertext(new Error('Netzwerk'), 'x')).toBe('Netzwerk');
    expect(await edgeFehlertext(null, 'Ersatz')).toBe('Ersatz');
  });

  it('wird vom Mahnversand benutzt', () => {
    const modal = readFileSync('src/components/dashboard/MahnungErstellungModal.tsx', 'utf-8');
    expect(modal).toMatch(/await edgeFehlertext\(err, 'E-Mail konnte nicht versendet werden'\)/);
  });
});
